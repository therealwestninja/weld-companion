// Studio UI for Dad Chat files: import preview, selection, apply, and the export buttons.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../src/studio-core.js');
const D = require('../src/studio-dad.js');
class Element {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = tag; this.attrs = attrs; this.children = []; this.events = {}; this.value = attrs.value || ''; this.disabled = false;
    children.forEach(c => this.appendChild(c)); if (attrs.onclick) this.events.click = attrs.onclick;
  }
  appendChild(c) { if (c) { c.parentNode = this; this.children.push(c); } }
  addEventListener(type, fn) { this.events[type] = fn; }
  set innerHTML(value) { this.children = []; }
  get isConnected() { return true; }
  click() { if (!this.disabled) this.events.click?.(); }
}
const store = new Map();
let lastNotice = '', downloads = [], byteDownloads = [], nextFile = null, confirms = [];
const parent = new Element('main');
const walk = n => [n, ...n.children.flatMap(walk)];
const find = (tag, label) => walk(parent).find(n => n.tagName === tag && (n.attrs.text === label || n.attrs['aria-label'] === label));
const has = label => walk(parent).some(n => n.attrs.text === label || n.attrs['aria-label'] === label);
const texts = () => walk(parent).map(n => n.attrs.text || n.attrs['aria-label'] || '').join('\n');
function click(label) { const n = find('button', label); assert.ok(n, 'missing button ' + label); n.click(); }
function toggle(label, checked) { const n = find('input', label); assert.ok(n, 'missing checkbox ' + label); n.checked = checked; n.events.change(); }
const window = { confirm: msg => { confirms.push(msg); return true; } }; window.top = window;
window.WeldStudioCore = C; window.WeldStudioDad = D;
window.weldStudioHost = {
  el: (tag, attrs, children) => new Element(tag, attrs, children),
  get: (key, fallback) => store.has(key) && store.get(key) !== null ? C.copy(store.get(key)) : fallback,
  set(key, value) { store.set(key, value === null ? null : C.copy(value)); return true; },
  toast(message) { lastNotice = message; }, model: () => 'test-model',
  download(name, content) { downloads.push({ name, content }); },
  downloadBytes(name, bytes, mime) { byteDownloads.push({ name, bytes, mime }); },
  pickFile(accept, cb) { assert.ok(nextFile, 'no file queued'); const f = nextFile; nextFile = null; cb(f); },
  ask() { return { abort() {} }; }
};
vm.runInNewContext(fs.readFileSync('src/studio-ui.js', 'utf8'), { window, console, document: { getElementById: id => walk(parent).find(n => n.attrs.id === id) }, Promise });
const render = () => window.weldStudio.render(parent);
const stored = () => [...store.entries()].filter(([k, v]) => k.startsWith('studio:project:') && v)[0][1];
const tick = () => new Promise(r => setTimeout(r, 10));
const file = (name, content, type) => { const buf = Buffer.from(content); return { name, size: buf.length, type: type || '', text: async () => buf.toString('utf8'), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) }; };
const dadChar = name => ({ type: 'dad-char', version: 2, data: { id: 'char_' + name, name, avatar: '', description: 'bio', systemPrompt: 'You are ' + name + '.', profile: { name, personality: 'Calm.', scenario: 'Somewhere.' },
  customSections: [], exampleDialogue: [], firstMessage: ['Hello.', 'Hi again.'], reminderMessage: '', userOverride: { name: 'Sam', description: 'A cook.' }, preInstruction: 'roleplay', tags: ['a'],
  lorebook: { l1: { id: 'l1', name: 'Place', keys: ['place'], content: 'A place.', priority: 10, constant: false, enabled: true, vectorized: false, excludeRecursion: false, scanDepth: null } }, authorNote: { text: '', depth: 4, role: 'system', enabled: false } } });

(async () => {
  render();
  assert.ok(has('Import a file (card, lorebook, world, chat, backup, zip)'), 'welcome screen offers a universal import');

  // Import with no project: preview first, then a new project is created.
  nextFile = file('Mira.dad-char.json', JSON.stringify(dadChar('Mira'))); click('Import a file (card, lorebook, world, chat, backup, zip)'); await tick();
  assert.match(texts(), /Import preview: Dad Chat character/);
  assert.equal([...store.keys()].filter(k => k.startsWith('studio:project:')).length, 0, 'nothing is created before confirming');
  assert.ok(has('Mira — 1 lore entries, 1 alternate greetings'));
  assert.ok(has('Persona "Sam" — from Mira'));
  click('Import selected'); await tick();
  const p1 = stored().project;
  assert.equal(p1.characters.length, 1); assert.equal(p1.characters[0].name, 'Mira'); assert.equal(p1.lore.length, 1); assert.equal(p1.persona.name, 'User', 'persona is opt-in');
  assert.match(lastNotice, /Imported 1 character/);

  // Import into the open project: pick items, snapshot first, cancel works.
  nextFile = file('Bo.dad-char.json', JSON.stringify(dadChar('Bo'))); click('Import a file (card, lorebook, world, chat, backup, zip)'); await tick();
  toggle('Persona "Sam" — from Bo', true);
  click('Cancel import'); assert.equal(stored().project.characters.length, 1);
  nextFile = file('Bo.dad-char.json', JSON.stringify(dadChar('Bo'))); click('Import a file (card, lorebook, world, chat, backup, zip)'); await tick();
  toggle('Persona "Sam" — from Bo', true); click('Import selected'); await tick();
  assert.equal(stored().project.characters.length, 2); assert.equal(stored().project.persona.name, 'Sam'); assert.equal(stored().snapshots.length, 1);

  // A file Studio does not understand reports clearly and changes nothing.
  nextFile = file('mystery.json', '{"hello":1}'); click('Import a file (card, lorebook, world, chat, backup, zip)'); await tick();
  assert.match(lastNotice, /not a format Studio recognizes/); assert.equal(stored().project.characters.length, 2);

  // Exports for Dad Chat, with a private-lore confirmation on whole-project files.
  click('Export & snapshots');
  assert.ok(has('Character for exports'));
  click('Export Dad Chat character (JSON)');
  assert.equal(JSON.parse(downloads.at(-1).content).type, 'dad-char'); assert.match(downloads.at(-1).name, /.dad-char.json$/);
  click('Export Dad Chat lorebook (JSON)'); assert.equal(JSON.parse(downloads.at(-1).content).characterName, 'Mira');
  click('Export Dad Chat user profile (JSON)'); assert.equal(JSON.parse(downloads.at(-1).content).type, 'dad-user-profile');
  click('Export world bible (text)'); assert.equal(typeof downloads.at(-1).content, 'string');
  const before = confirms.length; click('Export Dad Chat world book (JSON)');
  assert.equal(JSON.parse(downloads.at(-1).content).type, 'dad-world'); assert.equal(confirms.length, before, 'no private lore, so no prompt');
  click('Export Dad Chat pack (zip)'); assert.equal(byteDownloads.at(-1).mime, 'application/zip');
  assert.ok((await D.unzip(byteDownloads.at(-1).bytes)).some(x => x.name === 'bible.txt' || x.name === 'worldbook.json'));

  // Playthrough exports.
  click('Test chat & memory'); click('New playthrough');
  click('Export Dad Chat chat (JSON)'); assert.equal(JSON.parse(downloads.at(-1).content).type, 'dad-char-chat');
  click('Export chat text (.txt)'); assert.match(downloads.at(-1).content, /^[^:]+: Hello./);
  console.log('Studio UI Dad Chat import preview, selection, apply, cancel, errors and exports passed');
})().catch(e => { console.error(e); process.exit(1); });
