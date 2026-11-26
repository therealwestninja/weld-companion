const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { webcrypto, randomUUID } = require('node:crypto');
const B = require('../src/github-backup');
const L = require('../src/local-backup');

// File System Access adapter writes real temporary files, staging until close.
let stagedWrites = 0;
class Directory {
  constructor(dir) { this.dir = dir; }
  async getDirectoryHandle(name, { create = false } = {}) {
    const dir = path.join(this.dir, name);
    if (create) await fs.mkdir(dir, { recursive: true });
    else await fs.stat(dir).catch(e => { e.name = 'NotFoundError'; throw e; });
    return new Directory(dir);
  }
  async getFileHandle(name, { create = false } = {}) {
    const file = path.join(this.dir, name);
    try { await fs.stat(file); }
    catch (e) { if (!create) { e.name = 'NotFoundError'; throw e; } await fs.writeFile(file, ''); }
    return {
      getFile: async () => new Blob([await fs.readFile(file)]),
      createWritable: async () => {
        stagedWrites++;
        const tmp = file + '.' + randomUUID(), fd = await fs.open(tmp, 'wx'); let done = false;
        return {
          write: async bytes => { await fd.writeFile(bytes); },
          close: async () => { await fd.close(); await fs.rename(tmp, file); done = true; },
          abort: async () => { if (!done) { await fd.close(); await fs.unlink(tmp); done = true; } }
        };
      }
    };
  }
}
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'weld-local-backup-')), root = new Directory(temp);
  let source = Buffer.from([0, 255, 13, 10]);
  const model = Buffer.alloc(B.PART + 11); for (let i = 0; i < model.length; i++) model[i] = i % 251;
  const opts = { name: 'dad', dslPath: 'dad/dad-top-panel.txt', htmlPath: 'dad/dad-html-panel.html', dsl: 'output\n  hi', html: 'src/file.bin',
    state: { ready: async () => {}, list: () => ({ 'file.bin': { size: source.length } }), readFile: async () => Uint8Array.from(source).buffer }, crypto: webcrypto,
    evaluate: async (op, a) => op === 'inventory' ? { origin: 'https://example.perchance.org', entries: [{ kind: 'opfs', path: 'browser-model/model.gguf', size: model.length }], unavailable: [] }
      : model.subarray(a.offset, a.offset + a.length).toString('base64') };
  const save = async overwrite => L.save({ root, slug: 'dad', backup: await B.collect(opts), crypto: webcrypto, overwrite });
  const first = await save(true);
  assert.equal(first.files, 4);
  assert.deepEqual(await fs.readFile(path.join(temp, 'dad/src/file.bin')), source);
  assert.deepEqual(await fs.readFile(path.join(temp, 'dad/.weld-backup/assets/0/model.gguf')), model, 'large model is assembled into one complete file');
  const manifest = JSON.parse(await fs.readFile(path.join(temp, 'dad/.weld-backup/local-manifest.json')));
  assert.equal(manifest.files.find(f => f.kind === 'opfs').originalPath, 'browser-model/model.gguf');
  stagedWrites = 0;
  assert.equal((await save(false)).written, 0, 'unchanged browser data is not rewritten');
  assert.equal(stagedWrites, 0, 'unchanged models never stage temporary disk writes');
  await fs.writeFile(path.join(temp, 'dad/src/file.bin'), 'computer edit');
  await save(false);
  assert.equal(await fs.readFile(path.join(temp, 'dad/src/file.bin'), 'utf8'), 'computer edit', 'unchanged browser file preserves local edits');
  source = Buffer.from('new browser data');
  await assert.rejects(save(false), /Computer copy changed/);
  assert.equal(await fs.readFile(path.join(temp, 'dad/src/file.bin'), 'utf8'), 'computer edit');
  await save(true);
  assert.deepEqual(await fs.readFile(path.join(temp, 'dad/src/file.bin')), source, 'manual download resolves the conflict');
  await fs.writeFile(path.join(temp, 'dad/src/file.bin'), '');
  source = Buffer.from('another revision');
  await assert.rejects(save(false), /Computer copy changed/, 'truncating a computer file is also an edit');
  await save(true);
  const before = await fs.readFile(path.join(temp, 'dad/src/file.bin'));
  let active = true;
  const backup = await B.collect(opts), original = backup.files.find(f => f.path === 'dad/src/file.bin').read;
  backup.files.find(f => f.path === 'dad/src/file.bin').read = async () => { const bytes = await original(); active = false; return bytes; };
  await assert.rejects(L.save({ root, slug: 'dad', backup, crypto: webcrypto, overwrite: true, active: () => active }), /paused/);
  assert.deepEqual(await fs.readFile(path.join(temp, 'dad/src/file.bin')), before, 'cancelled staged writes do not replace the computer file');
  const unsafe = await B.collect(opts); unsafe.manifest.files[0].path = 'other/src/file.bin';
  await assert.rejects(L.save({ root, slug: 'dad', backup: unsafe, crypto: webcrypto }), /selected generator/);
  assert.equal((await fs.readdir(temp)).join(), 'dad', 'no other generator is downloaded');
  console.log('Local backup: assembled binary files, unchanged writes, conflicts, cancellation and generator scope passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
