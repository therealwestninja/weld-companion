/* Local project downloads share the GitHub collector, but store assembled files. */
(function (host) {
  'use strict';
  const B = typeof module === 'object' && module.exports ? require('./github-backup') : host.WeldGitHubBackup;
  const MANIFEST = '.weld-backup/local-manifest.json';
  async function fileHandle(root, path, create) {
    if (!B.safePath(path)) throw new Error('Unsafe local backup path');
    const bits = path.split('/'), name = bits.pop();
    for (const bit of bits) root = await root.getDirectoryHandle(bit, { create });
    return root.getFileHandle(name, { create });
  }
  async function existing(root, path) {
    try { return await (await fileHandle(root, path, false)).getFile(); }
    catch (e) { if (e.name === 'NotFoundError') return null; throw e; }
  }
  const digest = async (crypto, bytes) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  const same = (a, b) => !!a && a.size === b.size && JSON.stringify(a.parts) === JSON.stringify(b.parts);
  async function matches(file, record, crypto) {
    if (!file || !record || file.size !== record.size) return false;
    let offset = 0;
    for (const part of record.parts) {
      if (await digest(crypto, await file.slice(offset, offset + part.size).arrayBuffer()) !== part.sha256) return false;
      offset += part.size;
    }
    return offset === file.size;
  }
  async function save({ root, slug, backup, crypto, overwrite = false, active = () => true, progress = () => {} }) {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(slug)) throw new Error('Unsafe generator name');
    const prefix = slug + '/', manifestPath = prefix + MANIFEST;
    const previousFile = await existing(root, manifestPath);
    let previous = null;
    if (previousFile) {
      try { previous = JSON.parse(await previousFile.text()); }
      catch (e) { if (!overwrite) throw new Error('Local backup manifest is unreadable; download manually to replace it'); }
      if (previous && (previous.format !== 'weld-local-project-backup' || previous.generator !== slug || !Array.isArray(previous.files))) {
        if (!overwrite) throw new Error('Local backup manifest is not valid for this generator');
        previous = null;
      }
    }
    const prior = new Map((previous ? previous.files : []).map(r => [r.path, r]));
    const byPath = new Map(backup.files.map(f => [f.path, f]));
    const partPaths = new Set(backup.manifest.files.flatMap(r => r.parts.map(p => p.path)));
    const records = backup.manifest.files.map(r => ({ path: r.path, parts: r.parts, kind: r.kind, url: r.url, originalPath: r.originalPath }));
    for (const f of backup.files) {
      if (!partPaths.has(f.path) && !f.path.includes('/.weld-backup/')) records.push({ path: f.path, kind: 'panel', parts: [{ path: f.path }] });
    }
    const manifest = { format: 'weld-local-project-backup', version: 1, generator: slug,
      origin: backup.manifest.origin, coverage: backup.manifest.coverage, unavailable: backup.manifest.unavailable, files: [] };
    let written = 0;
    function check() {
      if (!active()) throw new Error('Local backup paused or generator/location changed; download stopped');
      backup.validate();
    }
    async function readPart(part) {
      check();
      const source = byPath.get(part.path);
      if (!source) throw new Error('Missing local backup part');
      const content = source.read ? await source.read() : source.content;
      return source.encoding === 'base64' ? Uint8Array.from(atob(content), c => c.charCodeAt(0)) : new TextEncoder().encode(content);
    }
    const metadata = record => ({ path: record.path, kind: record.kind, url: record.url, originalPath: record.originalPath, size: 0, parts: [] });
    check();
    for (const [index, record] of records.entries()) {
      if (!B.safePath(record.path) || !record.path.startsWith(prefix)) throw new Error('Backup file leaves the selected generator folder');
      check(); progress(index + 1, records.length);
      const before = await existing(root, record.path);
      const old = prior.get(record.path);
      let scanned = null;
      if (!overwrite && old && before) {
        // Read/hash first: unchanged models never create temporary disk writes.
        scanned = metadata(record);
        for (const part of record.parts) {
          const bytes = await readPart(part);
          scanned.parts.push({ size: bytes.length, sha256: await digest(crypto, bytes) }); scanned.size += bytes.length;
        }
        check();
        if (same(old, scanned)) { manifest.files.push(scanned); continue; }
        if (!await matches(before, old, crypto) && !await matches(before, scanned, crypto)) {
          throw new Error('Computer copy changed: ' + record.path + '. Download manually to replace it.');
        }
      }
      const target = await fileHandle(root, record.path, true), stream = await target.createWritable();
      const next = metadata(record);
      let closed = false;
      try {
        for (const part of record.parts) {
          const bytes = await readPart(part);
          next.parts.push({ size: bytes.length, sha256: await digest(crypto, bytes) }); next.size += bytes.length;
          await stream.write(bytes);
        }
        check();
        if (scanned && !same(scanned, next)) throw new Error('Cached file changed during local backup; retry');
        const disk = await target.getFile();
        if (!overwrite && before && !await matches(disk, old, crypto) && !await matches(disk, next, crypto)) {
          throw new Error('Computer copy changed: ' + record.path + '. Download manually to replace it.');
        } else { await stream.close(); written++; }
        closed = true; manifest.files.push(next);
      } finally { if (!closed) await stream.abort().catch(() => {}); }
    }
    check();
    const text = JSON.stringify(manifest, null, 2);
    if (!previousFile || await previousFile.text() !== text) {
      const stream = await (await fileHandle(root, manifestPath, true)).createWritable();
      try { await stream.write(text); check(); await stream.close(); }
      catch (e) { await stream.abort().catch(() => {}); throw e; }
    }
    return { written, files: manifest.files.length, bytes: backup.bytes, unavailable: manifest.unavailable };
  }
  const api = { save };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else host.WeldLocalBackup = api;
})(typeof window === 'object' ? window : globalThis);
