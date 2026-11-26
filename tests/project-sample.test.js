// Exercise the in-frame 'sample' agent op (the code that re-rolls a generator) against stubs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('weld-companion.user.js', 'utf8');
const from = source.search(/case ['"]sample['"]:\s*return \(function \(\) \{/);
const to = from + source.slice(from).search(/case ['"]estimate['"]:/);
assert.ok(from > 0 && to > from, 'sample op not found');
const body = source.slice(from, to);
assert.doesNotMatch(body, /localStorage|GM_setValue|indexedDB|fetch\(|XMLHttpRequest/, 'the sample op never touches storage or the network');
assert.match(source, /ENGINE_FREE =\s*\(?d\.op === ['"]pageText['"] \|\| d\.op === ['"]ping['"] \|\| d\.op === ['"]sample['"]\)?/, 'sample must answer even without an IndexedDB engine');

function run(args, world) {
  const code = 'function op(runOp, eng, a, unsafeWindow, window, setTimeout) { switch ("sample") {\n' + body + '\n} }';
  const context = {}; vm.createContext(context); vm.runInContext(code, context);
  return context.op(world.runOp, null, args, world.win, world.win, fn => { fn(); return 1; });
}

(async () => {
  // A generator whose output changes on every update().
  let n = 0, updates = 0;
  const win = { update() { updates++; n++; } };
  const ok = { win, runOp: async () => ({ kind: 'output', text: 'result ' + (n % 3) }) };
  let res = await run({ n: 7 }, ok);
  assert.equal(res.samples.length, 7);
  assert.equal(updates, 7, 'one update() per sample');
  assert.equal(res.samples[0], 'result 1');

  // The count is capped and defaults sensibly.
  updates = 0; res = await run({ n: 99999 }, ok);
  assert.equal(res.samples.length, 200);
  updates = 0; res = await run({}, ok);
  assert.equal(res.samples.length, 30);

  // update() may be asynchronous.
  const asyncWin = { async update() { await null; } };
  res = await run({ n: 3 }, { win: asyncWin, runOp: async () => ({ kind: 'output', text: 'x' }) });
  assert.equal(res.samples.length, 3);

  // Refusals: no update(), chat generators, nothing to read.
  await assert.rejects(run({ n: 3 }, { win: {}, runOp: ok.runOp }), /no update\(\)/);
  let chatUpdates = 0;
  await assert.rejects(run({ n: 3 }, { win: { update() { chatUpdates++; } }, runOp: async () => ({ kind: 'chat', text: 'hi' }) }), /chat generator/);
  assert.equal(chatUpdates, 0, 'a chat generator is never re-rolled');
  await assert.rejects(run({ n: 3 }, { win: { update() {} }, runOp: async () => ({ kind: 'none', text: '' }) }), /No readable output/);

  // A slow first render is waited for.
  let reads = 0;
  res = await run({ n: 2 }, { win: { update() {} }, runOp: async () => (++reads < 3 ? { kind: 'none', text: '' } : { kind: 'output', text: 'late' }) });
  assert.equal(res.samples.length, 2);

  // Long output is trimmed per sample.
  res = await run({ n: 1 }, { win: { update() {} }, runOp: async () => ({ kind: 'output', text: 'z'.repeat(5000) }) });
  assert.equal(res.samples[0].length, 2000);

  // An error inside update() surfaces instead of hanging.
  await assert.rejects(run({ n: 2 }, { win: { update() { throw new Error('boom'); } }, runOp: ok.runOp }), /boom/);
  console.log('Frame sample op re-roll, cap, refusal and failure tests passed');
})().catch(err => { console.error(err); process.exit(1); });
