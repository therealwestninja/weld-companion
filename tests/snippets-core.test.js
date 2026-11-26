// Code-snippet catalog: tree structure, node lookups, and search. (AI prompt-skills moved to
// the Skills tab; this tab is code-only now.)
const assert = require('node:assert/strict');
const C = require('../src/snippets-core.js');

// ---- counts + shape ----
const n = C.counts();
assert.equal(n.code, 14, '14 code snippets');
assert.equal(n.total, 14, 'tree holds only code leaves');
assert.equal(n.skill, undefined, 'no skill count any more');
const t = C.tree();
assert.deepEqual(t.children.map(f => f.id), ['code'], 'one top folder: code');
assert.deepEqual(t.children[0].children.map(f => f.id), ['code-dsl', 'code-html'], 'code split by pane');

// ---- node kinds: every leaf is a code node with a pane + text ----
const leaves = C.leaves();
assert.equal(leaves.length, 14);
leaves.forEach(l => { assert.equal(l.kind, 'code'); assert.ok(l.pane === 'dsl' || l.pane === 'html'); assert.ok(l.text && l.text.length); });
const meta = C.codeById('meta');
assert.ok(meta && meta.pane === 'dsl' && /\$meta/.test(meta.text), 'code node resolves with pane+text');
assert.equal(C.findById('nope-xyz'), null, 'unknown id -> null');

// ---- search prunes the tree, keeping folder structure ----
const t2i = C.search('textToImage');
const hits = C.walk(t2i).filter(x => !C.isFolder(x) && x.id !== 'root');
assert.ok(hits.length >= 1 && hits.every(l => /t2i|image/i.test(l.name + l.desc)), 'search matches by name/desc');
assert.equal(C.walk(C.search('zzzznope')).filter(x => !C.isFolder(x) && x.id !== 'root').length, 0, 'no matches -> empty');
assert.equal(C.search('').children.length, 1, 'empty query -> full (code) tree');

console.log('Snippets core (code-only) tests passed');
