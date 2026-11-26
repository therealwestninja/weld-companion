// Snippets tab, as wired: a fake DOM + host drive the shipped snippets-ui against the real
// catalog. Covers tree render, folder toggle, code-leaf -> insertSnippet, skill-leaf -> openAI,
// and the filter.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../src/snippets-core.js');

class Element {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = tag; this.attrs = attrs; this.children = []; this.events = {}; this.style = {};
    this.value = attrs.value || ''; this.textContent = attrs.text || '';
    children.forEach(c => this.appendChild(c));
    if (attrs.onclick) this.events.click = attrs.onclick;
  }
  appendChild(c) { if (c) { c.parentNode = this; this.children.push(c); } return c; }
  removeChild(c) { this.children = this.children.filter(x => x !== c); }
  get firstChild() { return this.children[0] || null; }
  addEventListener(type, fn) { this.events[type] = fn; }
  click() { return this.events.click && this.events.click({ preventDefault() {} }); }
}
const parent = new Element('main'), walk = n => [n, ...n.children.flatMap(walk)];
const leaf = id => walk(parent).find(n => n.attrs['data-leaf'] === id);
const folder = id => walk(parent).find(n => n.attrs['data-folder'] === id);
const leaves = () => walk(parent).filter(n => n.attrs['data-leaf']);

const inserts = [], opens = [], toasts = [];
const host = {
  el: (tag, attrs, children) => new Element(tag, attrs, children),
  insertSnippet: (pane, text, label) => { inserts.push({ pane, text, label }); return true; },
  openAI: (prompt, ctx) => { opens.push({ prompt, ctx }); },
  toast: m => toasts.push(m),
  aiReady: () => true
};
const window = { WeldSnippetsCore: Core, weldProjectHost: host };
window.top = window;
vm.runInNewContext(fs.readFileSync('src/snippets-ui.js', 'utf8'), { window, console });
const render = () => window.weldSnippets.render(parent);

render();
// the code tree: top 'code' folder open by default; its pane sub-folders start collapsed.
assert.ok(folder('code'), 'top code folder rendered');
assert.ok(folder('code-dsl') && folder('code-html'), 'pane sub-folders present');
assert.ok(!leaf('meta'), 'code leaf hidden until its sub-folder is expanded');
assert.equal(opens.length, 0, 'no AI-skill actions on this tab any more');

// ---- expand a code sub-folder, then a code leaf -> insertSnippet ----
folder('code-dsl').click();           // toggle open -> re-renders
assert.ok(leaf('meta'), 'code leaf visible after expanding its folder');
leaf('meta').click();
assert.equal(inserts.length, 1, 'code click inserted once');
assert.equal(inserts[0].pane, 'dsl', 'inserted into the DSL pane');
assert.ok(/\$meta/.test(inserts[0].text), 'the real snippet text was inserted');

// ---- collapse a folder hides its children ----
folder('code-dsl').click();
assert.ok(!leaf('meta'), 'collapsing a folder hides its leaves');
folder('code-dsl').click();           // re-open for the filter test
assert.ok(leaf('meta'), 're-expanded');

// ---- filter: typing narrows the tree to matches ----
const search = walk(parent).find(n => n.tagName === 'input' && n.attrs.type === 'search');
search.value = 'kv'; search.events.input();
const after = leaves().map(n => n.attrs['data-leaf']);
assert.ok(after.includes('kv-usage'), 'match shown');
assert.ok(!after.includes('meta'), 'non-matches filtered out');
assert.ok(after.every(id => /kv/i.test(Core.findById(id).name + Core.findById(id).desc)), 'only matches remain');

console.log('Snippets UI (code-only) tests passed');
