// Red-room regression gate: frozen repros for the defects found in the 2026-11-25
// adversarial shakedown. Each assertion is the crafted input an agent confirmed; it
// must degrade (friendly error / dropped bad element), never throw a raw
// TypeError/RangeError/stack overflow, and never silently merge/delete.
const assert = require('node:assert/strict');
const C = require('../src/studio-core.js');
const D = require('../src/studio-dad.js');
const Dev = require('../src/dev-core.js');
const B = require('../src/backup-core.js');

const file = (name, content, type) => {
  const buf = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
  return { name, size: buf.length, type: type || '', text: async () => buf.toString('utf8'), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
};

(async () => {
  // ---- S1: fromWorldInfo must not crash on a null/primitive entry (SillyTavern World-Info with a hole)
  const wiNull = C.fromWorldInfo({ entries: { 0: null, 1: { key: ['a'], content: 'b' } } });
  assert.equal(wiNull.length, 1, 'S1: null World-Info entry dropped, the valid one kept');
  assert.doesNotThrow(() => C.fromWorldInfo({ entries: [null, 5, { key: ['x'], content: 'y' }] }), 'S1: array form with holes');

  // ---- S2: fromV2Book must not crash on a null character-book entry
  const v2 = C.fromV2Book({ entries: [null, { keys: ['a'], content: 'b', comment: 'Kept' }] });
  assert.equal(v2.length, 1, 'S2: null character-book entry dropped');
  assert.equal(v2[0].title, 'Kept');

  // ---- S3: dad-full with missing/null config degrades to a FRIENDLY error, not a raw TypeError
  const notRawType = (e) => { assert.ok(!/Cannot read properties/i.test(e.message), 'S3: not a raw TypeError'); return true; };
  await assert.rejects(D.readFile(file('x.json', JSON.stringify({ type: 'dad-full' }))), notRawType, 'S3: dad-full no config');
  await assert.rejects(D.readFile(file('x.json', JSON.stringify({ type: 'dad-full', config: null }))), notRawType, 'S3: dad-full null config');

  // ---- S4: a zip with an out-of-bounds central-directory local offset throws a FRIENDLY error, not a RangeError
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt32LE(0xffffff00, 42);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(0, 16);
  const evilZip = Buffer.concat([cd, eocd]);
  await assert.rejects(D.readFile(file('evil.zip', evilZip)), (e) => {
    assert.ok(!/outside the bounds of the DataView/i.test(e.message), 'S4: not a raw RangeError');
    assert.match(e.message, /zip/i, 'S4: friendly zip error');
    return true;
  });

  // ---- D1: toolbox find_usages rejects a regex-metachar name instead of building a bad RegExp
  const box = Dev.makeToolbox(() => ({ name: 'g', dsl: 'alist = [1]\n', html: '<script>root.alist</script>' }));
  const bad = box.call('find_usages', { name: '(' });
  assert.ok(bad.error && /not a valid/.test(bad.error), 'D1: invalid name -> error, not throw');
  assert.deepEqual(bad.uses, []);
  assert.doesNotThrow(() => box.call('find_usages', { name: '(.*(.*)*)+x' }), 'D1: ReDoS-shaped name cannot reach RegExp');
  const good = box.call('find_usages', { name: 'alist' });
  assert.ok(Array.isArray(good.uses) && !good.error, 'D1: a valid name still scans');

  // ---- B1: canonical is depth-bounded; findDuplicates fails SAFE (skips, never merges) on a too-deep value
  assert.throws(() => { let v = 1; for (let i = 0; i < 1000; i++) v = { a: v }; B.canonical(v); }, /too deeply/, 'B1: canonical throws past the depth cap');
  assert.equal(B.canonical({ b: 1, a: [1, 2] }), '{"a":[1,2],"b":1}', 'B1: shallow canonical byte-identical');
  let deep = { x: 1 }; for (let i = 0; i < 5000; i++) deep = { n: deep };
  const key = 'weld:genvault:gen/chat/snap-1-aaaaaa';
  const dupOut = B.findDuplicates([{ key, caller: 'gen', value: { at: 1, data: deep } }, { key, caller: 'gen', value: { at: 2, data: deep } }]);
  assert.deepEqual(dupOut.exact, [], 'B1: uncomparable deep copies are NOT reported as duplicates (no false delete)');
  assert.equal(dupOut.skipped, 2, 'B1: the skip surfaces via the out.skipped counter (this module never logs)');

  // ---- B1 control: genuine shallow duplicates ARE still detected (no over-fix)
  const d2 = B.findDuplicates([
    { key, caller: 'gen', value: { at: 1, data: { threads: [{ id: 't', messages: [{}, {}] }] } } },
    { key, caller: 'gen', value: { at: 2, data: { threads: [{ id: 't', messages: [{}, {}] }] } } }
  ]);
  assert.equal(d2.exact.length, 1, 'B1 control: identical shallow copies still detected as a duplicate group');

  console.log('Red-room regression gate passed (S1 S2 S3 S4 D1 B1)');
})().catch(e => { console.error(e); process.exit(1); });
