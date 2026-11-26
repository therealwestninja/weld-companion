// Skybridge extra capabilities: pure validation plus the anchor service against fake page effects.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const X = require('../src/bridge-extras.js');
const Refs = require('../src/skills-refs.js');
const C = require('../src/skills-core.js');

// filenames
assert.equal(X.sanitizeFilename('../../etc/passwd'), '..-..-etc-passwd'.replace(/^\.+/, ''));
assert.equal(X.sanitizeFilename('  a\u0000b:c?.txt '), 'ab-c-.txt');
assert.equal(X.sanitizeFilename(''), 'download.txt'); assert.equal(X.sanitizeFilename('...'), 'download.txt');
assert.ok(X.sanitizeFilename('x'.repeat(500) + '.json').length <= 120 && X.sanitizeFilename('x'.repeat(500) + '.json').endsWith('.json'));
// downloads
assert.deepEqual(X.checkDownload({ filename: 'notes', text: 'hi' }), { ok: true, filename: 'notes.txt', mime: 'text/plain', text: 'hi' });
assert.equal(X.checkDownload({ filename: 'a.json', text: '{}' }).mime, 'application/json');
for (const [p, why] of [[null, 'bad-request'], [{ filename: 'a.txt' }, 'text-required'], [{ filename: 'a.exe', text: 'x' }, 'blocked-type'], [{ filename: 'run.SH', text: 'x' }, 'blocked-type'],
  [{ filename: 'a.png', text: 'x' }, 'unsupported-type'], [{ filename: 'a.txt', text: 'x', mime: 'application/x-msdownload' }, 'unsupported-type'], [{ filename: 'a.txt', text: 'x'.repeat(5 * 1024 * 1024 + 1) }, 'too-large']])
  assert.equal(X.checkDownload(p).reason, why, JSON.stringify(p && p.filename));
// clipboard / notify / tokens
assert.equal(X.checkClipboard({ text: '' }).reason, 'text-required'); assert.equal(X.checkClipboard({ text: 'x'.repeat(1024 * 1024 + 1) }).reason, 'too-large'); assert.equal(X.checkClipboard({ text: 'ok' }).ok, true);
assert.deepEqual(X.checkNotify({ text: ' a\n\tb ', ms: 99999 }), { ok: true, text: 'a b', ms: 8000 });
assert.equal(X.checkNotify({ text: 'x'.repeat(500) }).text.length, 200); assert.equal(X.checkNotify({ text: ' \n ' }).reason, 'text-required');
assert.deepEqual(X.estimateTokens({ text: 'abcdef ghi' }).value, { tokens: 4, chars: 10, words: 2, method: 'estimate-chars-div-3' });
assert.equal(X.estimateTokens({ text: 5 }).reason, 'text-required');
const rl = X.rateLimiter(2, 1000); assert.deepEqual([rl.allow('a', 0), rl.allow('a', 1), rl.allow('a', 2), rl.allow('b', 2), rl.allow('a', 1500)], [true, true, false, true, true]);

// anchor service
const src = fs.readFileSync('weld-companion.user.js', 'utf8');
const from = src.indexOf('var sbExtraLimit = null;'), to = src.indexOf('function sbHandleMessage(');
assert.ok(from > 0 && to > from);
const toasts = [], clicks = [], copies = []; let clipboardOK = true;
const doc = { createElement: () => ({ click() { clicks.push(this.download); }, remove() {} }), body: { appendChild() {} } };
const ctx = { window: { WeldBridgeExtras: X }, document: doc, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, Blob: class { constructor(p, o) { this.p = p; this.o = o; } }, setTimeout, Promise,
  toast: (m, ms) => toasts.push([m, ms]), copyText: t => { copies.push(t); return Promise.resolve(clipboardOK); }, console };
vm.createContext(ctx); vm.runInContext(src.slice(from, to), ctx);
(async () => {
  const call = (cap, p, gen = 'alpha') => ctx.sbServiceExtra(cap, gen, p);
  let r = await call('download', { filename: 'out.md', text: '# hi' }); assert.deepEqual([r.ok, r.value.filename, r.value.bytes], [true, 'out.md', 4]); assert.deepEqual(clicks, ['out.md']); assert.match(toasts.pop()[0], /Saved out\.md for alpha/);
  r = await call('download', { filename: 'bad.exe', text: 'x' }); assert.deepEqual([r.ok, r.reason], [false, 'blocked-type']); assert.equal(clicks.length, 1, 'refused download clicks nothing');
  r = await call('clipboard', { text: 'copy me' }); assert.equal(r.ok, true); assert.deepEqual(copies, ['copy me']);
  clipboardOK = false; r = await call('clipboard', { text: 'x' }); assert.deepEqual([r.ok, r.reason], [false, 'clipboard-blocked']); clipboardOK = true;
  r = await call('notify', { text: 'Done' }); assert.equal(r.ok, true); assert.deepEqual(toasts.pop(), ['alpha: Done', 3000]);
  for (let i = 0; i < 3; i++) await call('notify', { text: 'n' + i }); r = await call('notify', { text: 'flood' }); assert.deepEqual([r.ok, r.reason], [false, 'rate-limited'], 'notify floods are limited');
  assert.equal((await call('notify', { text: 'other gen' }, 'beta')).ok, true, 'limits are per generator');
  r = await call('tokens', { text: 'abcdef' }); assert.equal(r.value.tokens, 2);
  assert.equal((await call('tokens', null)).ok, false);
  // wiring: advertised, labelled and dispatched
  assert.match(src, /var SB_CAPS = \[[^\]]*['"]download['"],\s*['"]clipboard['"],\s*['"]notify['"],\s*['"]tokens['"],?\s*\]/); assert.match(src, /cap === ['"]download['"]\s*\|\|\s*cap === ['"]clipboard['"]/);
  // skills for the new capabilities exist and carry the wire-shape pack
  for (const id of ['skybridge-download', 'skybridge-clipboard', 'skybridge-notify', 'skybridge-token-meter', 'skybridge-fetch-search', 'skybridge-vault-backup', 'skybridge-presence', 'skybridge-family-adapt', 'skybridge-health-check']) {
    assert.ok(C.get(id), id); const built = C.buildPrompt(id); assert.ok(built.includes('STRUCTURE REFERENCE'), id);
    assert.ok(/sb\.has|sb\.request|Skybridge|Weld/.test(built), id);
  }
  assert.match(C.buildPrompt('skybridge-download'), /download\s+\{ filename, text, mime\? \}/);
  assert.match(C.buildPrompt('skybridge-health-check'), /MODE: REVIEW ONLY/);
  for (const k of ['download', 'clipboard', 'notify', 'tokens']) assert.ok(Refs.byId['weld-caps'].text.includes(k + ' '), 'pack documents ' + k);
  console.log('bridge extras tests passed');
})().catch(e => { console.error(e); process.exit(1); });
