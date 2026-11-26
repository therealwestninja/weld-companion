// The shipped window.weldProjectHost object must offer every member the src/ modules call. An object literal keeps
// only the LAST of two equal keys, so 1.90.0-1.93.4 shipped two `gh` entries and the repo store's gh.config() was
// missing: every repo-backed read threw, which broke GitHub data sync and the Backups tab. Module tests use their
// own mock hosts, so this test evaluates the real literal from weld-companion.user.js instead.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const C = require('../src/backup-core.js');

const src = fs.readFileSync('weld-companion.user.js', 'utf8');
const from = src.indexOf('  window.weldProjectHost = {'), to = src.indexOf('\n  };\n', from);
assert.ok(from > 0 && to > from, 'weldProjectHost literal not found');
const literal = src.slice(from + '  window.weldProjectHost = '.length, to + 4);

// Duplicate top-level keys (depth 1 of the literal) silently drop the earlier one.
(function () {
  let depth = 0, str = null, line = '', keys = [];
  for (let i = 0; i < literal.length; i++) {
    const ch = literal[i];
    if (str) { if (ch === '\\') { i++; continue; } if (ch === str) str = null; continue; }
    if (ch === '"' || ch === "'") { str = ch; continue; }
    if (ch === '/' && literal[i + 1] === '/') { while (i < literal.length && literal[i] !== '\n') i++; line = ''; continue; }
    if ('{(['.includes(ch)) depth++;
    else if ('})]'.includes(ch)) depth--;
    if (ch === '\n') line = '';
    else { line += ch; const m = depth === 1 && /^\s*([A-Za-z_$][\w$]*)\s*:$/.exec(line); if (m) keys.push(m[1]); }
  }
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
  assert.deepEqual(dup, [], 'duplicate weldProjectHost keys: ' + dup.join(', '));
  assert.ok(keys.includes('gh') && keys.includes('backup') && keys.includes('vault'), 'key scan found the main entries');
})();

// Evaluate the literal with every free name resolved to a stub (and a few real ones).
const calls = [];
const real = {
  Promise, Object, Array, JSON, String, Number, Error, Math, Date, Blob: class { constructor(p, o) { this.parts = p; this.type = o && o.type; } },
  ghToken: () => 'tok', ghCfg: () => ({ owner: 'me', repo: 'weld', branch: 'main' }), ghResolve: s => ({ cfg: { slug: s } }),
  ghApi: (m, p, t, b, cb) => { calls.push([m, p, t]); cb(null, 200, { ok: true }); }, ghFetch: (u, cb) => cb(null, 'text'),
  downloadBlob: (n, b) => calls.push(['download', n, b.type, b.parts.length])
};
const stub = function () {};
const scope = new Proxy(real, { has: () => true, get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[k] : stub) });
const ctx = vm.createContext({ scope });
const H = vm.runInContext('with (scope) { (' + literal + ') }', ctx);

// Every H.<a> and H.<a>.<b> the modules reach must exist, unless the module guards it with typeof / a truthiness check.
const used = new Map();
for (const f of fs.readdirSync('src').filter(f => f.endsWith('.js'))) {
  const text = fs.readFileSync('src/' + f, 'utf8');
  if (!/\bH = window\.weldProjectHost\b|weldProjectHost/.test(text)) continue;
  for (const m of text.matchAll(/\bH\.([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?/g)) {
    const guarded = new RegExp("typeof H\\." + m[1] + (m[2] ? '\\.' + m[2] : '') + "\\b|!H\\." + m[1] + '\\b|H\\.' + m[1] + ' \\?|H\\.' + m[1] + ' &&|\\|\\| !H\\.' + m[1]).test(text);
    if (!guarded) used.set(m[1] + (m[2] ? '.' + m[2] : ''), f);
  }
}
const missing = [];
for (const [name, file] of used) {
  const [a, b] = name.split('.');
  if (!(a in H)) missing.push(name + ' (' + file + ')');
  else if (b && H[a] && typeof H[a] === 'object' && !(b in H[a])) missing.push(name + ' (' + file + ')');
}
assert.deepEqual(missing, [], 'host members used by src/ but missing: ' + missing.join(', '));

(async () => {
  // gh: the repo store's config + promise api, and the Dev tab's callback api, on ONE object.
  assert.deepEqual(JSON.parse(JSON.stringify(H.gh.config())), { owner: 'me', repo: 'weld', branch: 'main', token: 'tok' });
  const r = await H.gh.api('GET', '/repos/me/weld');
  assert.equal(r.status, 200); assert.equal(r.json.ok, true);
  await new Promise(done => H.gh.api('POST', '/x', {}, (err, st) => { assert.equal(err, null); assert.equal(st, 200); done(); }));
  assert.equal(H.gh.token(), true); assert.equal(H.gh.resolve('a').cfg.slug, 'a');
  assert.ok(typeof H.backup.pageHtml === 'function' && typeof H.backup.published === 'function' && typeof H.backup.hasSrc === 'function');
  H.backup.download('x.zip', [new Uint8Array(1), new Uint8Array(2)], 'application/zip');
  assert.deepEqual(calls.at(-1), ['download', 'x.zip', 'application/zip', 2]);

  // The working-copy zip opens in a standard unzip tool, byte for byte.
  const bin = Uint8Array.from({ length: 70000 }, (_, i) => (i * 7) % 256);
  const parts = C.zip([{ path: 'w/README.txt', bytes: 'hé\n' }, { path: 'w/src/a b.bin', bytes: bin }, { path: 'w/page/rendered-page.html', bytes: '<!DOCTYPE html>' }], Date.UTC(2026, 9, 29));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weld-zip-')), file = path.join(tmp, 'w.zip');
  fs.writeFileSync(file, Buffer.concat(parts.map(p => Buffer.from(p))));
  const py = spawnSync('python3', ['-I', '-c', 'import sys,zipfile\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nfor n in z.namelist(): print(n, len(z.read(n)))', file], { encoding: 'utf8' });
  if (py.error) console.log('python3 not found: zip checked by structure only');
  else { assert.equal(py.status, 0, py.stderr); assert.match(py.stdout, /w\/README\.txt 4\n/); assert.match(py.stdout, /w\/src\/a b\.bin 70000\n/); }
  assert.equal(C.crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.throws(() => C.zip([{ path: '../x', bytes: '' }]), /Unsafe/);
  assert.throws(() => C.zip([{ path: 'a', bytes: '' }, { path: 'a', bytes: '' }]), /duplicate/);
  assert.match(C.workingCopyName('dad-chat', new Date(2026, 9, 29, 8, 5, 3).getTime()), /^dad-chat-working-copy-20261029-080503$/);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('Host contract (no duplicate keys, every used member present, gh promise + callback api) and working-copy zip tests passed');
})().catch(err => { console.error(err); process.exit(1); });
