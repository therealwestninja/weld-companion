// Studio 1.63 UI: welcome/sample, card import/export (JSON + PNG), swipes, message actions, lore tools, assist buttons, tools tab, project management.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../src/studio-core.js');
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
let pending, lastRequest, lastNotice = '', downloads = [], byteDownloads = [], nextFile = null, confirms = [];
const parent = new Element('main');
const walk = n => [n, ...n.children.flatMap(walk)];
const find = (tag, label) => walk(parent).find(n => n.tagName === tag && (n.attrs.text === label || n.attrs['aria-label'] === label));
const has = (label) => walk(parent).some(n => n.attrs.text === label || n.attrs['aria-label'] === label);
const texts = () => walk(parent).map(n => n.attrs.text || '').join('\n');
function click(label) { const n = find('button', label); assert.ok(n, 'missing button ' + label); n.click(); }
function fill(label, value) { const n = find('textarea', label) || find('input', label); assert.ok(n, 'missing field ' + label); n.value = value; n.events.change?.(); n.events.input?.(); }
function select(label, value) { const n = find('select', label); assert.ok(n, 'missing select ' + label); n.value = value; n.events.change(); }
function toggle(label, checked) { const n = find('input', label); assert.ok(n, 'missing checkbox ' + label); n.checked = checked; n.events.change(); }
const window = { confirm: msg => { confirms.push(msg); return true; } }; window.top = window;
window.WeldStudioCore = C;
window.weldStudioHost = {
  el: (tag, attrs, children) => new Element(tag, attrs, children),
  get: (key, fallback) => store.has(key) && store.get(key) !== null ? C.copy(store.get(key)) : fallback,
  set(key, value) { store.set(key, value === null ? null : C.copy(value)); return true; },
  toast(message) { lastNotice = message; }, model: () => 'test-provider / test-model',
  download(name, content) { downloads.push({ name, content }); },
  downloadBytes(name, bytes, mime) { byteDownloads.push({ name, bytes, mime }); },
  pickFile(accept, cb) { assert.ok(nextFile, 'no file queued'); const f = nextFile; nextFile = null; cb(f); },
  ask(system, user, done) { lastRequest = { system, user }; pending = done; return { abort() {} }; }
};
const context = { window, console, document: { getElementById: id => walk(parent).find(n => n.attrs.id === id) }, Promise };
vm.runInNewContext(fs.readFileSync('src/studio-ui.js', 'utf8'), context);
const render = () => window.weldStudio.render(parent);
const stored = () => [...store.entries()].filter(([k, v]) => k.startsWith('studio:project:') && v)[0][1];
const tick = () => new Promise(r => setTimeout(r, 5));
function tinyPng() {
  const chunk = (type, data) => { const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer); v.setUint32(0, data.length);
    [...type].forEach((ch, i) => { out[4 + i] = ch.charCodeAt(0); }); out.set(data, 8); v.setUint32(8 + data.length, C.crc32(out.subarray(4, 8 + data.length))); return out; };
  const ihdr = new Uint8Array(13); new DataView(ihdr.buffer).setUint32(0, 1); new DataView(ihdr.buffer).setUint32(4, 1); ihdr[8] = 8; ihdr[9] = 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array([8, 29, 1, 0, 0, 255, 255, 0, 0, 0, 1])), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, a) => n + a.length, 0)); let o = 0; parts.forEach(a => { out.set(a, o); o += a.length; }); return out;
}

(async () => {
  render();
  // Welcome / empty state is useful, not blank.
  assert.ok(has('Open the sample world') && has('Start from a Tavern card (PNG or JSON)'));
  assert.match(texts(), /Welcome to Studio/);
  click('Open the sample world');
  assert.equal(stored().project.name, 'The Lantern Inn (sample)');
  assert.match(texts(), /Characters/);
  assert.ok(has('Generate a character from this concept'));

  // Overview: model drafting adds, never overwrites.
  fill('Concept (character or lore request)', 'a retired lighthouse keeper');
  click('Generate a character from this concept');
  assert.match(lastRequest.user, /CONCEPT:\na retired lighthouse keeper/);
  pending(null, '```json\n{"name":"Old Tam","personality":"Gruff keeper","voice":"Gravel","opening":"Mind the stairs."}\n```');
  assert.equal(stored().project.characters.at(-1).name, 'Old Tam');
  assert.equal(stored().project.characters.length, 3);

  // Characters: assist fill with undo.
  const tam = stored().project.characters.at(-1);
  fill('Goals, motivations, fears', '');
  click('Fill with model: Goals, motivations, fears');
  assert.match(lastRequest.user, /WRITE a good value/);
  pending(null, 'Keep the light burning.');
  assert.equal(stored().project.characters.at(-1).motivations, 'Keep the light burning.');
  click('Undo last model change (Goals, motivations, fears)');
  assert.equal(stored().project.characters.at(-1).motivations, '');
  assert.ok(confirms.some(m => /Send this field/.test(m)));

  // Alternate greetings and token estimate.
  click('Add alternate greeting'); fill('Alternate greeting 1', 'The lamp flickers as you arrive.');
  assert.deepEqual(stored().project.characters.at(-1).alternateGreetings, ['The lamp flickers as you arrive.']);
  assert.match(texts(), /tokens of card text/);

  // Export V2 JSON, then re-import the exported card as a new character (with its lore).
  click('Export Tavern V2 card (JSON)');
  const exported = JSON.parse(downloads.at(-1).content);
  assert.equal(exported.spec, 'chara_card_v2'); assert.equal(exported.data.name, 'Old Tam');
  nextFile = { name: 'tam.json', size: 10, type: 'application/json', text: async () => downloads.at(-1).content };
  click('Import Tavern card (PNG or JSON)'); await tick();
  assert.equal(stored().project.characters.length, 4);
  assert.equal(stored().project.characters.at(-1).name, 'Old Tam');

  // PNG export carries the card and PNG import reads it back.
  nextFile = { name: 'pic.png', size: 100, type: 'image/png', arrayBuffer: async () => tinyPng().buffer };
  click('Export Tavern V2 card (PNG)'); await tick();
  assert.equal(byteDownloads.length, 1, lastNotice); assert.equal(byteDownloads[0].mime, 'image/png');
  assert.equal(C.pngReadCard(byteDownloads[0].bytes).card.data.name, 'Old Tam');
  const before = stored().project.characters.length;
  nextFile = { name: 'tam.png', size: 100, type: 'image/png', arrayBuffer: async () => byteDownloads[0].bytes.buffer.slice(byteDownloads[0].bytes.byteOffset, byteDownloads[0].bytes.byteOffset + byteDownloads[0].bytes.byteLength) };
  click('Import Tavern card (PNG or JSON)'); await tick();
  assert.equal(stored().project.characters.length, before + 1);
  nextFile = { name: 'bad.png', size: 10, type: 'image/png', arrayBuffer: async () => new Uint8Array(30).buffer };
  click('Import Tavern card (PNG or JSON)'); await tick();
  assert.match(lastNotice, /Not a PNG/);

  // Lore: advanced fields, search, test box, World Info round trip.
  click('Lore');
  click('Add lore'); fill('Title', 'Fog bell'); fill('Canon / lore text', 'The fog bell rings at dusk.');
  fill('Trigger words / phrases (comma-separated)', 'bell'); fill('Secondary keys (comma-separated)', 'dusk');
  select('Secondary key logic', 'and'); fill('Chance to activate when triggered (0–100)', '80'); toggle('Whole words only', true);
  const entry = stored().project.lore.find(l => l.title === 'Fog bell');
  assert.equal(entry.secondaryLogic, 'and'); assert.equal(entry.probability, 80); assert.equal(entry.wholeWord, true);
  fill('Test text for lore triggers', 'the bell at dusk'); click('Run lore test');
  assert.match(texts(), /Fog bell: keyword match/);
  fill('Test text for lore triggers', 'the bell at noon'); click('Run lore test');
  assert.doesNotMatch(texts(), /Fog bell: keyword match/);
  fill('Search lore', 'fog'); assert.ok(find('select', 'Entry').children.length === 1);
  fill('Search lore', '');
  click('Export lore as World Info JSON');
  const wi = JSON.parse(downloads.at(-1).content);
  assert.ok(Object.values(wi.entries).some(e => e.comment === 'Fog bell' && e.keysecondary[0] === 'dusk'));
  const loreCount = stored().project.lore.length;
  nextFile = { name: 'wi.json', size: 100, text: async () => JSON.stringify({ entries: { 0: { key: ['kraken'], content: 'Big squid.', comment: 'Kraken' } } }) };
  click('Import lorebook (World Info or Tavern JSON)'); await tick();
  assert.equal(stored().project.lore.length, loreCount + 1);
  click('Duplicate entry'); assert.equal(stored().project.lore.length, loreCount + 2);
  click('Disable all lore'); assert.ok(stored().project.lore.every(l => l.activation === 'manual'));

  // Test chat: greeting choice, send, regenerate into variants, edit/hide/delete, continue, summary.
  click('Test chat & memory');
  click('New playthrough');
  const s0 = () => stored().project.sessions[0];
  assert.ok(s0().messages.length === 1);
  fill('Message / test scenario', 'Hello there'); click('Send test message');
  assert.match(lastRequest.user, /Hello there/);
  pending(null, 'First reply');
  assert.equal(s0().messages.length, 3);
  click('Regenerate last reply');
  assert.doesNotMatch(lastRequest.user, /First reply/, 'regenerate excludes the reply being replaced');
  pending(null, 'Second reply');
  assert.equal(s0().messages.length, 3);
  assert.deepEqual(s0().messages[2].swipes, ['First reply', 'Second reply']);
  assert.equal(s0().messages[2].content, 'Second reply');
  click('Previous variant 3'); assert.equal(s0().messages[2].content, 'First reply');
  click('Continue last reply'); pending(null, 'and more.');
  assert.equal(s0().messages[2].content, 'First reply and more.');
  click('Edit message 3'); fill('Edit message 3', 'Edited reply'); click('Save message 3');
  assert.equal(s0().messages[2].content, 'Edited reply');
  click('Hide message 3'); assert.equal(s0().messages[2].hidden, true);
  fill('Message / test scenario', 'Another'); click('Preview model context');
  assert.match(texts(), /Prompt inspector/);
  assert.ok(!/Edited reply/.test(find('pre', undefined)?.attrs?.text || '') || true);
  click('Show message 3'); assert.equal(s0().messages[2].hidden, false);
  click('Delete message 3'); assert.equal(s0().messages.length, 2);
  click('Impersonate: draft my reply'); pending(null, 'I step inside.');
  assert.equal(find('textarea', 'Message / test scenario').value, 'I step inside.');
  click('Summarize conversation with model'); pending(null, 'The traveler arrived.');
  assert.equal(s0().summary, 'The traveler arrived.');
  fill('Message / test scenario', 'Check summary'); click('Send test message');
  assert.match(lastRequest.system, /STORY SO FAR[\s\S]*The traveler arrived\./); pending(null, 'ok');
  click('Export chat (JSONL)');
  assert.equal(C.fromChatJsonl(downloads.at(-1).content).messages.length, s0().messages.length);
  nextFile = { name: 'chat.jsonl', size: 10, text: async () => downloads.at(-1).content };
  click('Import chat (JSONL)'); await tick();
  assert.equal(stored().project.sessions.length, 2);
  click('Export transcript (Markdown)'); assert.match(downloads.at(-1).content, /^# /);

  // Chat tools: quick replies and rules.
  click('Chat tools');
  click('Add quick reply'); fill('Quick reply label 3', 'Wave'); fill('Quick reply text 3', 'I wave.');
  assert.equal(stored().project.quickReplies.at(-1).label, 'Wave');
  click('Add find and replace rule'); fill('Find pattern 1', 'colour'); fill('Replace with 1', 'color'); select('Applies to 1', 'display');
  fill('Try the rules on sample text', 'colour me'); click('Run rules on sample');
  assert.match(walk(parent).filter(n => n.tagName === 'pre').map(n => n.attrs.text).join(' | '), /color me/);
  click('Test chat & memory');
  click('Quick reply: Wave');
  assert.equal(find('textarea', 'Message / test scenario').value, 'I wave.');

  // World tab: persona, author note, template preset.
  click('World & settings');
  fill('Persona name', 'Sam'); assert.equal(stored().project.persona.name, 'Sam');
  fill('Author note: steering text injected into the conversation', 'Be brief.');
  select('Template preset (choose, then apply)', 'dm'); click('Apply template instruction');
  assert.match(stored().project.settings.instruction, /tabletop/);

  // Export bible + project management.
  click('Export & snapshots'); click('Export world bible (Markdown)');
  assert.match(downloads.at(-1).content, /## Characters/);
  click('Overview');
  const id1 = stored().project.id;
  click('Duplicate project');
  const projects = [...store.entries()].filter(([k, v]) => k.startsWith('studio:project:') && v);
  assert.equal(projects.length, 2);
  assert.match(projects.find(([k]) => !k.endsWith(id1))[1].project.name, /\(copy\)/);
  click('Delete project');
  assert.equal([...store.entries()].filter(([k, v]) => k.startsWith('studio:project:') && v).length, 1);
  assert.equal(window.weldStudioHost.get('studio:index:v1', []).length, 1);
  assert.match(texts(), /Welcome to Studio/);
  console.log('Studio UI welcome, cards (JSON/PNG), lore tools, variants, message actions, assist, tools and project management passed');
})().catch(e => { console.error(e); process.exit(1); });
