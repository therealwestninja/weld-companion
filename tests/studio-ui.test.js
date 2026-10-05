// Execute the real UI handlers with a small DOM and persistent GM-store harness.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../src/studio-core.js');
class Element {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = tag; this.attrs = attrs; this.children = []; this.events = {};
    this.value = attrs.value || ''; this.disabled = false;
    children.forEach(c => this.appendChild(c));
    if (attrs.onclick) this.events.click = attrs.onclick;
  }
  appendChild(c) { if (c) { c.parentNode = this; this.children.push(c); } }
  addEventListener(type, fn) { this.events[type] = fn; }
  set innerHTML(value) { this.children = []; }
  get isConnected() { return true; }
  click() { if (!this.disabled) this.events.click?.(); }
}
const store = new Map();
let pending, lastRequest, aborts = 0, lastNotice = '', downloads = [];
const parent = new Element('main');
const walk = n => [n, ...n.children.flatMap(walk)];
const find = (tag, label) => walk(parent).find(n => n.tagName === tag && (n.attrs.text === label || n.attrs['aria-label'] === label));
function click(label) { const n = find('button', label); assert.ok(n, 'missing button ' + label); n.click(); }
function fill(label, value) { const n = find('textarea', label) || find('input', label); assert.ok(n, 'missing field ' + label); n.value = value; n.events.change?.(); n.events.input?.(); }
function select(label, value) { const n = find('select', label); assert.ok(n); n.value = value; n.events.change(); }
const window = { confirm: () => true }; window.top = window;
const context = {
  window, console, document: { getElementById: id => walk(parent).find(n => n.attrs.id === id) },
};
window.WeldStudioCore = C;
window.weldStudioHost = {
  el: (tag, attrs, children) => new Element(tag, attrs, children),
  get: (key, fallback) => store.has(key) ? C.copy(store.get(key)) : fallback,
  set(key, value) { store.set(key, C.copy(value)); return true; },
  toast(message) { lastNotice = message; }, model: () => 'test-provider / test-model',
  download(name, content) { downloads.push({ name, content }); },
  ask(system, user, done) { lastRequest = { system, user }; pending = done; return { abort() { aborts++; } }; }
};
function loadUI() {
  vm.runInNewContext(fs.readFileSync('src/studio-ui.js', 'utf8'), context);
  window.weldStudio.render(parent);
}
function stored() { return [...store.entries()].find(([k]) => k.startsWith('studio:project:'))[1]; }
loadUI();
fill('New project name', 'UI test world'); click('Create project');
assert.equal(stored().project.name, 'UI test world');
fill('Public world description', 'Public realm');
click('Characters');
fill('Name', 'Arin'); fill('Opening message', 'Welcome');
click('Lore'); click('Add lore');
fill('Title', 'Secret'); fill('Canon / lore text', 'SECRET_UI_SENTINEL');
select('Who can know this?', 'private');
click('Test chat & memory'); click('New playthrough');
assert.equal(stored().project.sessions[0].messages[0].content, 'Welcome');
fill('Message / test scenario', 'Hello');
click('Send test message');
assert.doesNotMatch(lastRequest.system, /SECRET_UI_SENTINEL/);
assert.match(lastRequest.system, /Public realm/);
pending(null, 'Greetings!');
assert.equal(stored().project.sessions[0].messages.length, 3);
assert.equal(stored().project.sessions[0].runs.length, 1);
fill('Message / test scenario', 'A cancelled request');
click('Send test message');
const late = pending; click('Stop generation'); late(null, 'Must not appear');
assert.equal(aborts, 1);
assert.equal(stored().project.sessions[0].messages.length, 3);
click('Suggest memories from conversation');
pending(null, '["Arin welcomed the traveler."]');
assert.equal(stored().project.sessions[0].memories.length, 0);
assert.equal(stored().project.sessions[0].proposals.length, 1);
click('Approve');
assert.equal(stored().project.sessions[0].memories.length, 1);
assert.equal(stored().project.sessions[0].proposals.length, 0);
click('Branch this playthrough');
assert.equal(stored().project.sessions.length, 2);
click('Export & snapshots'); click('Snapshot now');
assert.equal(stored().snapshots.length, 1);
click('World & settings'); fill('Public world description', 'Changed realm');
click('Export & snapshots'); click('Restore snapshot');
assert.equal(stored().project.world.description, 'Public realm');
click('Export project JSON');
assert.equal(C.importBundle(downloads.at(-1).content).sessions.length, 2);
// Recreate the whole UI module to represent a page reload, then explicitly reopen.
const id = stored().project.id;
loadUI(); select('Project', id); click('World & settings');
assert.equal(find('textarea', 'Public world description').value, 'Public realm');
// Simulate another tab writing before this UI saves.
const key = 'studio:project:v1:' + id, external = store.get(key);
external.revision++; external.project.world.description = 'Other tab'; store.set(key, external);
fill('Public world description', 'Stale change');
assert.match(lastNotice, /another tab/);
assert.equal(stored().project.world.description, 'Other tab');
console.log('Studio UI create/edit/chat/stop/memory/branch/snapshot/export/reopen/conflict workflows passed');
