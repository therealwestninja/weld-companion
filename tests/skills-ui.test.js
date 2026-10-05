// Exercise shipped UI handlers; native transport itself is covered in ai-workspace tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../src/skills-core.js');
const P = require('../src/project-core.js');

class Element {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = tag; this.attrs = attrs; this.children = []; this.events = {}; this.style = {};
    this.value = attrs.value || ''; this.checked = false; this.disabled = false; this.textContent = attrs.text || '';
    children.forEach(c => this.appendChild(c));
    if (attrs.onclick) this.events.click = attrs.onclick;
  }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter(x => x !== c); }
  get firstChild() { return this.children[0] || null; }
  addEventListener(type, fn) { this.events[type] = fn; }
  click() { if (!this.disabled) return this.events.click?.(); }
}
const parent = new Element('main'), walk = n => [n, ...n.children.flatMap(walk)];
const byLabel = label => walk(parent).find(n => n.attrs['aria-label'] === label || n.attrs.text === label);
const byId = id => walk(parent).find(n => n.attrs.id === id);
const card = id => walk(parent).find(n => n.attrs['data-skill'] === id);
const status = () => walk(parent).find(n => n.attrs.role === 'status').textContent;
const cards = () => walk(parent).filter(n => n.attrs['data-skill']);
const setValue = (el, value, event = 'input') => { el.value = value; el.events[event](); };
let slug = 'demo', edit = true, live = { dsl: 'output\n  [missing]\n', html: '<p>[output]</p>' };
let clipboardOK = true, storageOK = true;
const saved = new Map([['skillsFavorites', ['image-gallery', 'obsolete-id']]]), native = [], copies = [];
const host = {
  el: (tag, attrs, children) => new Element(tag, attrs, children),
  get: (k, d) => saved.has(k) ? saved.get(k) : d,
  set: (k, v) => { if (!storageOK) return false; saved.set(k, v); return true; },
  slug: () => slug, isEdit: () => edit, live: () => live,
  copy: async t => { copies.push(t); return clipboardOK; },
  openPerchanceAI: p => { native.push(p); return true; }
};
const window = { WeldSkillsCore: C, WeldProjectCore: P, weldProjectHost: host }; window.top = window;
vm.runInNewContext(fs.readFileSync('src/skills-ui.js', 'utf8'), { window, console });
const render = () => window.weldSkills.render(parent);

(async () => {
  render();
  assert.equal(cards().length, 166);
  assert.equal(walk(parent).filter(n => n.attrs["data-section"]).length, 17);
  assert.equal(walk(parent).find(n => n.attrs['data-section']).attrs['data-section'], 'dashboards');
  assert.ok(walk(parent).filter(n => n.attrs['data-section']).every(n => !Object.hasOwn(n.attrs, 'open')));
  assert.ok(!byLabel('Send to Perchance AI').disabled);
  const initial = byId('wc-skill-prompt').value;
  assert.match(initial, /Plan a complex dashboard upgrade/);
  assert.ok(!initial.includes('HEURISTIC FINDINGS'));

  // Automatically expanded search results must not become permanently expanded sections.
  setValue(byLabel('Search skills'), 'gallery');
  const automatic = walk(parent).find(n => n.attrs['data-section'] === 'ai');
  automatic.open = true; automatic.events.toggle();
  setValue(byLabel('Search skills'), '');
  assert.ok(!Object.hasOwn(walk(parent).find(n => n.attrs['data-section'] === 'ai').attrs, 'open'));
  const manual = walk(parent).find(n => n.attrs['data-section'] === 'repair');
  manual.open = true; manual.events.toggle();
  setValue(byLabel('Search skills'), 'bugs'); setValue(byLabel('Search skills'), '');
  assert.ok(Object.hasOwn(walk(parent).find(n => n.attrs['data-section'] === 'repair').attrs, 'open'));

  // Search/filter updates the catalog without losing a hand-edited prompt or focus field.
  setValue(byId('wc-skill-prompt'), initial + '\nPreserve my custom controls.');
  const search = byLabel('Search skills'); setValue(search, 'gallery');
  assert.ok(cards().length < 166);
  assert.equal(byLabel('Search skills'), search);
  assert.match(byId('wc-skill-prompt').value, /Preserve my custom controls/);
  setValue(byLabel('Skill category'), 'ai', 'change');
  assert.ok(cards().every(n => C.get(n.attrs['data-skill']).category === 'ai'));
  card('image-gallery').click();
  assert.match(byId('wc-skill-prompt').value, /image gallery/);
  assert.ok(!byId('wc-skill-prompt').value.includes('custom controls'));

  // Favorites survive re-opening; failed persistence must not claim to save one.
  byLabel('Remove favorite').click(); assert.deepEqual(Array.from(saved.get('skillsFavorites')), []);
  storageOK = false; byLabel('Save favorite').click(); assert.match(status(), /Could not save/);
  assert.deepEqual(Array.from(saved.get('skillsFavorites')), []);
  storageOK = true; byLabel('Save favorite').click();
  assert.deepEqual(Array.from(saved.get('skillsFavorites')), ['image-gallery']);
  byLabel('Favorites only').checked = true; byLabel('Favorites only').events.change();
  assert.equal(cards().length, 1);
  setValue(search, 'nothing-found'); assert.equal(cards().length, 0);
  setValue(search, ''); byLabel('Favorites only').checked = false; byLabel('Favorites only').events.change();

  // Changed goal requires an explicit rebuild; handoff includes the exact editable prompt.
  setValue(byId('wc-skill-details'), 'Add tags.\nKeep the existing images.');
  assert.ok(byLabel('Send to Perchance AI').disabled);
  assert.ok(byLabel('Copy prompt').disabled);
  byLabel('Build prompt').click();
  assert.match(byId('wc-skill-prompt').value, /Add tags\.\nKeep the existing images/);
  setValue(byId('wc-skill-prompt'), byId('wc-skill-prompt').value + '\nUse the existing CSS classes.');
  byLabel('Send to Perchance AI').click();
  assert.equal(native.at(-1), byId('wc-skill-prompt').value);
  render(); assert.match(byId('wc-skill-prompt').value, /existing CSS classes/);

  // Optional analysis uses the live editor at rebuild time, never a saved Project snapshot.
  byLabel('Include live findings').checked = true; byLabel('Include live findings').events.change();
  byLabel('Build prompt').click(); assert.match(byId('wc-skill-prompt').value, /missing/);
  live = { dsl: 'output\n  OK\n', html: '<script type="module">const a = tiles[id];' };
  byLabel('Build prompt').click();
  assert.match(byId('wc-skill-prompt').value, /No warnings or errors/);
  assert.ok(!byId('wc-skill-prompt').value.includes('Unknown [missing]'));
  live = null; byLabel('Build prompt').click();
  assert.match(status(), /Live analysis is unavailable/);
  assert.ok(byLabel('Send to Perchance AI').disabled);
  byLabel('Include live findings').checked = false; byLabel('Include live findings').events.change();
  byLabel('Build prompt').click();

  const transport = host.openPerchanceAI;
  delete host.openPerchanceAI; byLabel('Send to Perchance AI').click();
  assert.match(status(), /Native AI connection is unavailable/);
  host.openPerchanceAI = () => { throw new Error('AI input was not found.'); };
  byLabel('Send to Perchance AI').click(); assert.match(status(), /AI input was not found/);
  host.openPerchanceAI = () => false; byLabel('Send to Perchance AI').click(); assert.match(status(), /did not confirm/);
  host.openPerchanceAI = transport;

  await byLabel('Copy prompt').click(); assert.equal(copies.at(-1), byId('wc-skill-prompt').value);
  assert.match(status(), /Prompt copied/);
  clipboardOK = false; await byLabel('Copy prompt').click(); assert.match(status(), /Clipboard unavailable/);

  // Quick starts reset browse filters; typed focus and concise output require reviewable rebuilds.
  byLabel('Plan dashboard').click();
  setValue(byLabel('Generator type'), 'dashboard', 'change');
  assert.ok(byLabel('Send to Perchance AI').disabled);
  setValue(byLabel('Task mode'), 'review', 'change');
  assert.ok(cards().every(n => C.get(n.attrs['data-skill']).mode === 'review'));
  assert.ok(!card('image-gallery'));
  card('financial-calculations').click();
  assert.match(byId('wc-skill-prompt').value, /GENERATOR FOCUS\nDashboards & applications/);
  assert.match(byId('wc-skill-prompt').value, /MODE: REVIEW ONLY/);
  assert.ok(walk(parent).some(n => n.tagName === 'a' && n.attrs.href.includes('fred.stlouisfed.org')));
  byLabel('Concise helper replies').checked = true; byLabel('Concise helper replies').events.change();
  assert.ok(byLabel('Copy prompt').disabled);
  byLabel('Build prompt').click(); assert.match(byId('wc-skill-prompt').value, /REPLY STYLE/);
  byLabel('Send to Perchance AI').click(); assert.equal(native.at(-1), byId('wc-skill-prompt').value);
  setValue(byLabel('Generator type'), 'image', 'change');
  byLabel('Build prompt').click(); assert.match(status(), /does not match/);
  assert.ok(byLabel('Send to Perchance AI').disabled);
  byLabel('Build an app').click();
  assert.equal(byLabel('Generator type').value, ''); assert.equal(byLabel('Task mode').value, '');
  assert.match(byId('wc-skill-prompt').value, /Build a dashboard application/);
  assert.ok(!byLabel('Send to Perchance AI').disabled);

  byLabel('Build lorebook').click();
  assert.match(byId('wc-skill-prompt').value, /Build & improve usable lorebooks/);
  assert.ok(byId('wc-skill-prompt').value.includes('receiving bot contracts'));

  // Navigation clears generator-specific instructions and blocks an outdated open UI.
  const calls = native.length; slug = 'other'; byLabel('Send to Perchance AI').click();
  assert.equal(native.length, calls); assert.match(status(), /generator changed/);
  render(); assert.equal(byId('wc-skill-details').value, '');
  assert.match(byId('wc-skill-prompt').value, /\(other\)/);
  assert.ok(!byId('wc-skill-prompt').value.includes('Add tags'));
  edit = false; render(); assert.ok(byLabel('Send to Perchance AI').disabled);
  assert.ok(!byLabel('Copy prompt').disabled);
  slug = ''; render(); assert.ok(byLabel('Send to Perchance AI').disabled);
  assert.ok(!byLabel('Copy prompt').disabled);

  const shipped = fs.readFileSync('weld-companion.user.js', 'utf8');
  assert.match(shipped, /id: 'skills'.*label: 'Skills'/);
  assert.match(shipped, /WC_TAB === 'skills'[\s\S]*?window\.weldSkills\.render\(body\)/);
  assert.match(shipped, /\/\* BEGIN GENERATED SKILLS \*\//);
  console.log('Skills UI filtering, favorites, draft review, live findings and native handoff passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
