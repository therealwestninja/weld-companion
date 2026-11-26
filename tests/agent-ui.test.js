// Agents tab, as wired: a fake DOM + host + aiAsk drive the shipped agent-ui against the
// real agent-core + dev-core loop. Covers render, selection, the no-model/no-generator
// guards, a full run to an answer, Stop, and custom-agent create/persist/delete.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const A = require('../src/agent-core.js');
const Dev = require('../src/dev-core.js');
const P = require('../src/project-core.js');

class Element {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = tag; this.attrs = attrs; this.children = []; this.events = {}; this.style = {};
    this.value = attrs.value || ''; this.checked = false; this.disabled = false; this.textContent = attrs.text || '';
    children.forEach(c => this.appendChild(c));
    if (attrs.onclick) this.events.click = attrs.onclick;
  }
  appendChild(c) { if (c) { c.parentNode = this; this.children.push(c); } return c; }
  removeChild(c) { this.children = this.children.filter(x => x !== c); }
  replaceChild(next, old) { const i = this.children.indexOf(old); if (i >= 0) { next.parentNode = this; this.children[i] = next; } }
  get firstChild() { return this.children[0] || null; }
  querySelector(sel) { const id = sel.replace('#', ''); return walk(this).find(n => n.attrs.id === id) || null; }
  addEventListener(type, fn) { this.events[type] = fn; }
  click() { if (!this.disabled) return this.events.click?.(); }
}
const parent = new Element('main'), walk = n => [n, ...n.children.flatMap(walk)];
const agentCard = id => walk(parent).find(n => n.attrs['data-agent'] === id);
const agentCards = () => walk(parent).filter(n => n.attrs['data-agent']);
const byText = t => walk(parent).find(n => n.attrs.text === t);
const textDump = () => walk(parent).map(n => n.attrs.text || '').join(' | ');
const tick = () => new Promise(r => setTimeout(r, 0));

let slug = 'demo', aiReady = true, project = { name: 'demo', dsl: 'a = [1]\n  2\noutput\n  [a]\n', html: null };
let askScript = [], askCalls = [], aborts = 0;
const saved = new Map();
const host = {
  el: (tag, attrs, children) => new Element(tag, attrs, children),
  get: (k, d) => saved.has(k) ? saved.get(k) : d,
  set: (k, v) => { saved.set(k, v); return true; },
  slug: () => slug, isEdit: () => true,
  aiReady: () => aiReady,
  aiAsk: (system, user) => { askCalls.push({ system, user }); const r = askScript.shift(); return { ok: true, abort: () => { aborts++; }, promise: Promise.resolve(r == null ? 'done' : r) }; },
  copy: async () => true, toast: () => {}
};
const window = { WeldAgentCore: A, WeldDevCore: Dev, WeldProjectCore: P, weldProjectHost: host, weldProject: { current: () => project } };
window.top = window;
vm.runInNewContext(fs.readFileSync('src/agent-ui.js', 'utf8'), { window, console });
const render = () => window.weldAgents.render(parent);

(async () => {
  // ---- render: all built-in agents appear ----
  render();
  assert.equal(agentCards().length, A.DEFAULT_AGENTS.length, 'one card per built-in agent');
  assert.ok(byText('Agents'), 'header present');
  assert.ok(agentCard('explain'), 'explain agent card present');

  // ---- guards ----
  aiReady = false; render();
  assert.ok(textDump().includes('need your own AI model'), 'no-model warning when AI not ready');
  aiReady = true; const savedProject = project; project = null; render();
  assert.ok(textDump().includes('No generator analysis is loaded'), 'no-generator warning');
  project = savedProject;

  // ---- select an agent ----
  render(); agentCard('bug-hunt').click();
  assert.equal(walk(parent).find(n => n.attrs['data-agent'] === 'bug-hunt').attrs['aria-pressed'], 'true', 'selection reflected');

  // ---- run to an answer: the agent looks up once, then answers ----
  agentCard('explain').click();
  askScript = ['```weld-tool\n{"tool":"get_outline","args":{}}\n```', 'This generator picks a line from list a.'];
  byText('Run agent').click();
  for (let i = 0; i < 8 && !textDump().includes('picks a line from list a'); i++) await tick();
  assert.ok(textDump().includes('picks a line from list a'), 'final answer rendered in transcript');
  assert.ok(askCalls.length >= 2, 'the loop called the model more than once');
  assert.ok(/Perchance generator analyst/.test(askCalls[0].system), 'explain role reached the model');

  // ---- Stop aborts a running agent ----
  askScript = []; // empty -> aiAsk resolves 'done' with no tool call; use a looping script instead
  let loop = 0;
  host.aiAsk = (s, u) => ({ ok: true, abort: () => { aborts++; }, promise: new Promise(res => { loop++; setTimeout(() => res('```weld-tool\n{"tool":"get_outline","args":{}}\n```'), 5); }) });
  byText('Run agent').click();
  await tick();
  const stopBtn = byText('Stop'); assert.ok(stopBtn && !stopBtn.disabled, 'Stop enabled while running');
  stopBtn.click();
  assert.ok(textDump().includes('Stopped'), 'Stop surfaces a stopped state');

  // ---- create a custom agent, persist, appears in the list ----
  render(); byText('+ New agent').click();
  const nameIn = walk(parent).find(n => n.tagName === 'input' && n.attrs.placeholder === 'Agent name');
  nameIn.value = 'My Helper'; nameIn.events.input();
  const roleIn = walk(parent).find(n => n.tagName === 'textarea' && /analyst/.test(n.attrs.placeholder || ''));
  roleIn.value = 'You help.'; roleIn.events.input();
  // tick a tool on
  const toolCb = walk(parent).find(n => n.tagName === 'input' && n.attrs['aria-label'] === 'get_outline');
  toolCb.checked = true; toolCb.events.change();
  byText('Save agent').click();
  assert.ok(Array.isArray(saved.get('agents')) && saved.get('agents').some(a => a.name === 'My Helper'), 'custom agent persisted');
  assert.ok(agentCard('my-helper'), 'custom agent now in the list');

  // ---- delete the custom agent ----
  agentCard('my-helper').click();
  byText('Delete').click();
  assert.ok(!agentCard('my-helper'), 'custom agent removed from the list');
  assert.ok(!(saved.get('agents') || []).some(a => a.name === 'My Helper'), 'custom agent removed from storage');

  console.log('Agents UI tests passed');
})().catch(e => { console.error(e); process.exit(1); });
