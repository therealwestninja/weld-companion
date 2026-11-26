/* Shared collector: generator sources, with optional public cached/model bytes for local downloads. */
(function (host) {
  'use strict';
  const PART = 4 * 1024 * 1024;
  function safePath(path) {
    return typeof path === 'string' && path.length > 0 && path.length < 1024 &&
      !/[\\\x00-\x1f:]/.test(path) && path.split('/').every(p => p && p !== '.' && p !== '..' && p !== '.git' &&
        !/^\.env(?:\.|$)|\.(pem|key|p12|pfx)$/i.test(p));
  }
  function base64(bytes) {
    let text = '';
    for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    return btoa(text);
  }
  // Runs only in the generator preview via Perchance's existing evaluateJs channel.
  // Read operations are stateless, so a timed-out request never leaves retained model buffers.
  async function runtime(op, arg) {
    const staticUrl = value => {
      const u = new URL(value);
      return u.protocol === 'https:' && !u.username && !u.password && (!u.search || u.search === '?download=true') &&
        /(^|\.)(huggingface\.co|cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|user\.uploads\.dev|perchance\.org)$/.test(u.hostname) &&
        /\.(gguf|onnx|bin|safetensors|wasm|json|js|css|woff2?|ttf|png|jpe?g|svg|webp)$/i.test(u.pathname) &&
        !/\/(api|chat|session|user|account)(\/|\.)/i.test(u.pathname);
    };
    async function opfs(path) {
      let dir = await navigator.storage.getDirectory();
      const bits = path.split('/'), name = bits.pop();
      for (const bit of bits) dir = await dir.getDirectoryHandle(bit);
      return (await dir.getFileHandle(name)).getFile();
    }
    if (op === 'inventory') {
      const entries = [], unavailable = [];
      if (typeof caches === 'undefined') unavailable.push('Cache Storage unavailable');
      else {
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          for (const req of await cache.keys()) {
            if (!staticUrl(req.url) || req.method !== 'GET' || req.headers.has('authorization')) continue;
            const res = await cache.match(req);
            if (!res || !res.ok || res.type === 'opaque') throw new Error('Cached asset unreadable');
            const blob = await res.blob();
            entries.push({ kind: 'cache', cache: name, url: req.url, size: blob.size,
              version: res.headers.get('etag') || res.headers.get('last-modified') || '' });
          }
        }
      }
      // Perchance's on-device GGUF runtime uses browser-model in origin-private storage.
      if (!navigator.storage || !navigator.storage.getDirectory) unavailable.push('OPFS unavailable');
      else {
        const root = await navigator.storage.getDirectory();
        let models;
        try { models = await root.getDirectoryHandle('browser-model'); }
        catch (e) { if (e.name !== 'NotFoundError') throw e; }
        async function walk(dir, prefix) {
          for await (const [name, handle] of dir.entries()) {
            const path = prefix + '/' + name;
            if (handle.kind === 'directory') await walk(handle, path);
            else { const f = await handle.getFile(); entries.push({ kind: 'opfs', path, size: f.size, modified: f.lastModified }); }
          }
        }
        if (models) await walk(models, 'browser-model');
      }
      return { entries, unavailable, origin: location.origin };
    }
    let blob;
    if (arg.kind === 'cache') {
      if (!staticUrl(arg.url)) throw new Error('Unsafe cached URL');
      const res = await (await caches.open(arg.cache)).match(arg.url);
      if (!res || !res.ok) throw new Error('Cached file disappeared');
      if ((res.headers.get('etag') || res.headers.get('last-modified') || '') !== arg.version) throw new Error('Cached file changed during backup');
      blob = await res.blob();
    } else if (arg.kind === 'opfs' && arg.path.startsWith('browser-model/') && !arg.path.split('/').includes('..')) {
      blob = await opfs(arg.path);
      if (blob.lastModified !== arg.modified) throw new Error('Model changed during backup');
    } else throw new Error('Unknown backup asset');
    if (blob.size !== arg.size) throw new Error('Asset size changed during backup');
    if (!Number.isSafeInteger(arg.offset) || arg.offset < 0 || !Number.isSafeInteger(arg.length) || arg.length < 0 || arg.length > 4 * 1024 * 1024) throw new Error('Invalid asset range');
    const bytes = new Uint8Array(await blob.slice(arg.offset, arg.offset + arg.length).arrayBuffer());
    let text = '';
    for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    return btoa(text);
  }
  async function collect(opts) {
    const { name, dslPath, htmlPath, dsl, html, state, evaluate, crypto } = opts;
    if (!safePath(dslPath) || !safePath(htmlPath) || dslPath === htmlPath) throw new Error('Unsafe or duplicate GitHub panel paths');
    const slash = dslPath.lastIndexOf('/'), prefix = slash < 0 ? name + '/' : dslPath.slice(0, slash + 1);
    const files = [{ path: dslPath, content: dsl }, { path: htmlPath, content: html }];
    const seen = new Set(files.map(f => f.path)), records = [];
    function add(file) { if (!safePath(file.path) || seen.has(file.path)) throw new Error('Unsafe or duplicate backup path'); seen.add(file.path); files.push(file); }
    let listing = {};
    if (state) { await state.ready(); listing = state.list(); }
    else if (/\bsrc\//.test(html)) throw new Error('Project file store unavailable; select the correct editor draft first');
    if (!Object.keys(listing).length && /\bsrc\//.test(html)) throw new Error('Project manifest empty; select the correct editor draft first');
    const fingerprint = JSON.stringify(listing);
    function asset(path, size, read, metadata) {
      if (!safePath(path) || !Number.isSafeInteger(size) || size < 0) throw new Error('Invalid project file metadata');
      const rec = Object.assign({ path, size, parts: [] }, metadata); records.push(rec);
      const count = Math.max(1, Math.ceil(size / PART));
      for (let n = 0; n < count; n++) {
        const offset = n * PART, length = Math.min(PART, size - offset);
        const target = count === 1 ? path : prefix + '.weld-backup/parts/' + (records.length - 1) + '/' + String(n).padStart(6, '0');
        const part = { path: target, size: length }; rec.parts.push(part);
        add({ path: target, encoding: 'base64', read: async () => {
          const content = await read(offset, length);
          const binary = atob(content), bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
          if (bytes.length !== length) throw new Error('Incomplete backup read');
          part.sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
          return content;
        } });
      }
    }
    for (const path of Object.keys(listing).sort()) {
      const entry = listing[path];
      // A project source file is small enough for the platform's readFile API; models use slices below.
      asset(prefix + 'src/' + path, entry.size, async (offset, length) => {
        if (JSON.stringify(state.list()) !== fingerprint) throw new Error('Project changed during backup; retry after editing finishes');
        const data = new Uint8Array(await state.readFile(path));
        if (data.byteLength !== entry.size) throw new Error('Project file size mismatch');
        const text = new TextDecoder().decode(data);
        if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:gh[opusr]_|github_pat_|sk-proj-|sk-ant-api)[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{30,}/.test(text)) throw new Error('Secret-shaped project content detected; branch not updated');
        return base64(data.subarray(offset, offset + length));
      }, { kind: 'project' });
    }
    const includeCache = opts.includeCache !== false;
    const inventory = includeCache ? await evaluate('inventory') : { entries: [], unavailable: [], origin: null };
    for (const [i, item] of inventory.entries.entries()) {
      const label = item.kind === 'opfs' ? item.path.split('/').pop() : new URL(item.url).pathname.split('/').pop();
      asset(prefix + '.weld-backup/assets/' + i + '/' + encodeURIComponent(label), item.size,
        (offset, length) => evaluate('read', Object.assign({}, item, { offset, length })),
        item.kind === 'opfs' ? { kind: item.kind, originalPath: item.path } : { kind: item.kind, url: item.url });
    }
    const manifest = { format: 'weld-project-backup', version: 1, generator: name, origin: inventory.origin, includeCache, files: records,
      unavailable: inventory.unavailable,
      coverage: includeCache ? 'Editor panels, complete selected src tree, readable public static/model Cache Storage responses, and browser-model OPFS files in the visible preview origin. HTTP cache, other origins, IndexedDB, cookies, credentials and private chat data are not exported.'
        : 'Editor panels and complete selected src tree only. Browser caches, model downloads, OPFS, IndexedDB, cookies, credentials and private chat data are not exported.' };
    add({ path: prefix + '.weld-backup/manifest.json', read: () => JSON.stringify(manifest, null, 2) });
    add({ path: prefix + '.weld-backup/restore.py', content: restoreSource });
    return { files, manifest, bytes: records.reduce((sum, r) => sum + r.size, 0), validate: () => {
      if (state && JSON.stringify(state.list()) !== fingerprint) throw new Error('Project changed during backup; branch not updated');
      if (opts.panels && !opts.panels(dsl, html)) throw new Error('Editor panels changed during backup; branch not updated');
    } };
  }
  const restoreSource = `"""Restore chunked files to a separate directory; verify every part before writing.
Run: python .weld-backup/restore.py --output restored
Cache/model files are restored to disk, not inserted into browser storage.
"""
import argparse, hashlib, json, pathlib, os, tempfile
p = argparse.ArgumentParser()
p.add_argument('--output', required=True)
a = p.parse_args()
root = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(a.output).resolve()
if out == root or root in out.parents:
    raise SystemExit('Choose an output directory outside the generator backup')
m = json.loads((root / '.weld-backup/manifest.json').read_text(encoding='utf-8'))
def safe(base, path):
    bits = pathlib.PurePosixPath(path).parts
    if not bits or '..' in bits or pathlib.PurePosixPath(path).is_absolute() or ':' in path or '\\\\' in path:
        raise ValueError('Unsafe manifest path')
    dest = base.joinpath(*bits).resolve()
    if base not in dest.parents: raise ValueError('Path leaves backup directory')
    return dest
# Stored paths are repository-relative. Resolve using the generator directory's suffix.
for rec in m['files']:
    marker = '/src/' if rec['kind'] == 'project' else '/.weld-backup/'
    rel = ('src/' if rec['kind'] == 'project' else '.weld-backup/') + rec['path'].split(marker, 1)[1]
    dest = safe(out, rel)
    if dest.exists(): raise FileExistsError(str(dest))
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(dir=dest.parent, delete=False) as f:
            tmp = pathlib.Path(f.name)
            total = 0
            for part in rec['parts']:
                part_marker = '/.weld-backup/' if '/.weld-backup/' in part['path'] else '/src/'
                part_rel = part_marker[1:] + part['path'].split(part_marker, 1)[1]
                data = safe(root, part_rel).read_bytes()
                if len(data) != part['size'] or hashlib.sha256(data).hexdigest() != part['sha256']:
                    raise ValueError('Part integrity check failed')
                f.write(data); total += len(data)
            if total != rec['size']: raise ValueError('File size mismatch')
        os.link(tmp, dest)  # fails if another process created the destination
    finally:
        if tmp is not None: tmp.unlink(missing_ok=True)
    print(rel, rec['size'])
`;
  const api = { collect, runtime, safePath, base64, PART, restoreSource };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else host.WeldGitHubBackup = api;
})(typeof window === 'object' ? window : globalThis);
