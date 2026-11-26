// Snippets & Skills catalog: tree structure, node kinds, lookups, search, and the authored
// skill content (shape + no leaked HTML entities after un-escaping).
const assert = require('node:assert/strict');
const C = require('../src/snippets-core.js');

// ---- counts + top-level shape ----
const n = C.counts();
assert.equal(n.code, 14, '14 code snippets');
assert.ok(n.skill >= 18, 'rules + methods present (>=18 skills)');
assert.equal(n.total, n.code + n.skill);
const t = C.tree();
assert.deepEqual(t.children.map(f => f.id), ['code', 'rules', 'methods'], 'three top folders');
const code = t.children[0];
assert.deepEqual(code.children.map(f => f.id), ['code-dsl', 'code-html'], 'code split by pane');
assert.equal(t.children[1].children.length, 10, '10 working rules');
assert.ok(t.children[2].children.length >= 8, 'curated methods');

// ---- node kinds ----
const meta = C.codeById('meta');
assert.ok(meta && meta.kind === 'code' && meta.pane === 'dsl' && /\$meta/.test(meta.text), 'code node resolves with pane+text');
assert.equal(C.codeById('rule-prove-the-wire'), null, 'a skill id is not a code node');
const prove = C.findById('rule-prove-the-wire');
assert.ok(prove && prove.kind === 'skill' && prove.run === 'single' && prove.prompt.length > 300, 'skill node with a real prompt');
const sweep = C.findById('rule-sweep-for-wins');
assert.equal(sweep.run, 'multi', 'iterative rule is multi-run');

// ---- every skill is well-formed and treats generator text as data ----
const leaves = C.leaves();
const skills = leaves.filter(l => l.kind === 'skill');
skills.forEach(s => {
  assert.ok(s.id && s.name && s.prompt, 'skill has id/name/prompt: ' + s.id);
  assert.ok(s.run === 'single' || s.run === 'multi', 'valid run: ' + s.id);
  assert.ok(s.prompt.length >= 120, 'prompt substantial: ' + s.id);
  // un-escaping worked: no raw HTML entities survived into the shipped prompt
  assert.ok(!/&lt;|&gt;|&amp;(lt|gt|amp);/.test(s.prompt), 'no leaked HTML entities in: ' + s.id);
});
// the author's intent: prompts say to treat generator content as data
const dataAware = skills.filter(s => /as data|not (as )?instructions/i.test(s.prompt)).length;
assert.ok(dataAware >= skills.length - 2, 'nearly every skill marks generator text as data');

// names un-escaped correctly (apostrophe + ampersand)
assert.equal(C.findById('rule-offset-dont-flatten').name, "Offset, Don't Flatten");
assert.equal(C.findById('method-skill-creator').name, 'Generator Spec & Iterate');

// ---- search prunes the tree to matches, keeping folder structure ----
const red = C.search('red-room');
const redLeaves = C.walk(red).filter(x => !C.isFolder(x) && x.id !== 'root');
assert.ok(redLeaves.length >= 1 && redLeaves.every(l => /red/i.test(l.name + l.desc)), 'search matches by name/desc');
assert.equal(C.walk(C.search('zzzznope')).filter(x => !C.isFolder(x) && x.id !== 'root').length, 0, 'no matches -> empty');
assert.equal(C.search('').children.length, 3, 'empty query -> full tree');

console.log('Snippets core tests passed');
