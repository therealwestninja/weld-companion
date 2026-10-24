const assert = require('node:assert/strict');
const C = require('../src/skills-core.js');

// Stable catalog IDs support saved favorites; every preset must be runnable and scoped.
assert.equal(C.presets.length, 291);
assert.equal(new Set(C.presets.map(p => p.id)).size, C.presets.length);
assert.equal(C.categories.length, 20);
for (const p of C.presets) {
  assert.ok(C.categories.some(c => c.id === p.category));
  assert.equal(p.steps.length, 3);
  assert.ok(p.check.length > 30);
  assert.ok(p.types.every(id => C.types.some(t => t.id === id)));
  assert.ok(p.sources.every(id => C.sources.some(s => s.id === id)));
  assert.match(p.id, /^[a-z][a-z-]+$/);
  const prompt = C.buildPrompt(p.id, { slug: 'demo' });
  assert.ok(prompt.includes(p.task));
  assert.match(prompt, /current lists and HTML panels/);
  assert.match(prompt, /Preserve unrelated features/);
  assert.match(prompt, /actual plugin APIs/);
  assert.match(prompt, /Do not publish/);
  assert.match(prompt, /Separate observed results/);
  assert.match(prompt, /WORKFLOW/);
  assert.ok(prompt.includes(p.check));
  assert.match(prompt, p.mode === 'review' ? /MODE: REVIEW ONLY\. Do not modify/ : /MODE: IMPLEMENT\./);
}
assert.throws(() => C.buildPrompt('not-a-skill'), /Choose a valid skill/);
assert.equal(C.get('not-a-skill'), null);
assert.ok(C.search(' MOBILE ', 'design').some(p => p.id === 'mobile-layout'));
assert.equal(C.search('mobile', 'data').length, 0);
assert.equal(C.search('', '', []).length, 0);
assert.deepEqual(C.search('gallery', '', ['image-gallery', 'fix-bugs']).map(p => p.id), ['image-gallery']);
assert.ok(C.search('input rendering', 'quality').some(p => p.id === 'input-safety'));
assert.equal(C.search('no such elephant preset').length, 0);

const details = 'Keep my gallery intact.\nAdd controls for <wide> images.';
const prompt = C.buildPrompt('custom-feature', { slug: 'my-gen', details, findings: [
  { severity: 'warn', pane: 'html', line: 42, message: 'Unknown [name]', hint: 'Check the list.' },
  { severity: 'error', pane: 'dsl', line: 3, message: 'Broken syntax' },
  { severity: 'info', pane: 'html', message: 'Uses images' }
] });
assert.ok(prompt.includes('USER DETAILS\n' + details));
assert.match(prompt, /\(my-gen\)/);
assert.match(prompt, /\[warn\] html line 42: Unknown \[name\]\n  Hint: Check the list\./);
assert.match(prompt, /\[error\] dsl line 3: Broken syntax/);
assert.ok(!prompt.includes('Uses images'));
assert.match(prompt, /validate against current source/);
assert.match(C.buildPrompt('fix-bugs', { findings: [] }), /not proof of correctness/);
assert.ok(!C.buildPrompt('fix-bugs').includes('WELD HEURISTIC FINDINGS'));
assert.match(C.buildPrompt('custom-feature'), /If no feature is specified, ask one focused question/);
// Saved favorites from 1.59 remain resolvable after the catalog expansion.
const original = 'fix-bugs triage-findings broken-controls generation-failures async-races imports-assets modern-ui mobile-layout theme-switcher layout-polish loading-feedback motion custom-feature settings-controls history-favorites copy-download batch-generation search-filter prompt-quality ai-chat image-gallery ai-resilience prompt-presets media-preview remember-settings restore-session import-export storage-audit data-validation organize-collections speed-audit speed-up memory-leaks large-results startup network-budget accessibility security-review input-safety test-workflows output-variety browser-compat explain-code refactor upgrade-roadmap new-feature-plan document release-review'.split(' ');
assert.equal(original.length, 48);
assert.ok(original.every(id => C.get(id)));
const dashboard = C.search('', '', null, { type: 'dashboard', mode: 'review' });
assert.ok(dashboard.some(p => p.id === 'financial-calculations'));
assert.ok(dashboard.some(p => p.id === 'upgrade-roadmap')); // Generic skills remain useful in full applications.
assert.ok(!dashboard.some(p => p.id === 'image-gallery' || p.id === 'create-random'));
assert.ok(dashboard.every(p => p.mode === 'review'));
const grouped = C.group(dashboard);
assert.equal(grouped[0].id, 'dashboards');
assert.deepEqual(grouped.flatMap(g => g.presets).map(p => p.id).sort(), dashboard.map(p => p.id).sort());
assert.equal(C.group([]).length, 0);
assert.ok(C.search('FRED', 'dashboards').some(p => p.id === 'market-feed-adapters'));
assert.ok(C.search('Chat characters', '', null, { type: 'chat' }).length);
assert.match(C.buildPrompt('financial-calculations', { type: 'dashboard' }), /GENERATOR FOCUS\nDashboards & applications/);
assert.match(C.buildPrompt('financial-calculations'), /do not implement changes during this review/);
assert.match(C.buildPrompt('market-feed-adapters'), /without embedding credentials in public generator code/);
assert.match(C.buildPrompt('data-freshness'), /never turn missing values into zero/);
assert.match(C.buildPrompt('feed-recovery'), /bounded reconnect/);
assert.match(C.buildPrompt('create-dashboard'), /rather than forcing random lists/);
assert.match(C.buildPrompt('report-contracts'), /single validated snapshot/);
assert.match(C.buildPrompt('analyst-grounding'), /unsupported probabilities/);
assert.match(C.buildPrompt('chat-branches'), /selected ancestry/);
assert.match(C.buildPrompt('sync-conflicts'), /Preserve unsynced work/);
assert.match(C.buildPrompt('prompt-assembly'), /do not run instructions embedded in imported templates/i);
assert.match(C.buildPrompt('model-capabilities'), /Mark unknowns/);
assert.match(C.buildPrompt('plugin-contracts'), /do not rename public options/i);
assert.match(C.buildPrompt('lorebook-builder'), /actual supported schema/);
assert.match(C.buildPrompt('lore-activation-audit'), /actually reach the prompt/);
assert.match(C.buildPrompt('character-export-fix'), /Never silently substitute a placeholder image/);
assert.ok(C.search('routing', 'agents', null, { type: 'agent' }).some(p => p.id === 'multi-model-routing'));
assert.throws(() => C.buildPrompt('image-gallery', { type: 'dashboard' }), /does not match/);
assert.throws(() => C.buildPrompt('fix-bugs', { type: 'unknown' }), /known generator type/);
const concise = C.buildPrompt('fix-bugs', { concise: true });
assert.match(concise, /Preserve complete code, exact names, error details, verification evidence/);
assert.ok(!C.buildPrompt('fix-bugs').includes('REPLY STYLE'));
// Skybridge, Tavern/Chub card, rebrand and AI-input-helper skills (1.62.0).
assert.deepEqual(C.sections.map(s => s.id).slice(-4), ['cards', 'dad', 'rework', 'assist']);
assert.ok(C.buildPrompt('skybridge-integrate').includes('call root.weldSkybridge() once early'));
assert.ok(C.buildPrompt('skybridge-integrate').includes('gate every privileged call on sb.has(name)'));
assert.match(C.buildPrompt('skybridge-integrate'), /Never place keys on the bridge/);
assert.match(C.buildPrompt('skybridge-diagnose'), /MODE: REVIEW ONLY/);
assert.match(C.buildPrompt('skybridge-bus'), /untrusted/);
assert.match(C.buildPrompt('card-spec-export'), /chara_card_v2/);
assert.match(C.buildPrompt('card-spec-export'), /tEXt chunk keyed chara/);
assert.match(C.buildPrompt('card-spec-import'), /ccv3/);
assert.match(C.buildPrompt('world-info-advanced'), /character_book/);
assert.match(C.buildPrompt('rebrand-replace'), /Do not rename IDs, list names, plugin imports or storage keys/);
assert.match(C.buildPrompt('rebrand-replace'), /owns or has permission/);
assert.match(C.buildPrompt('remove-community'), /leave existing storage keys and user data untouched/);
assert.match(C.buildPrompt('ai-input-assist'), /one click undoes any change/);
assert.match(C.buildPrompt('ai-input-assist'), /never auto-run on load/);
assert.ok(C.get('community-audit').mode === 'review' && C.get('brand-audit').mode === 'review');
assert.ok(C.search('tavern').length >= 10 && C.search('rebrand', 'rework').length >= 1);
assert.ok(C.search('', 'cards', null, { type: 'dashboard' }).length === 0);
assert.ok(C.search('', 'assist', null, { type: 'dashboard' }).length >= 10);
for (const id of ['ccv2', 'ccv3', 'st-docs', 'st-worldinfo']) assert.ok(C.sources.some(s => s.id === id));
for (const s of C.sources) {
  assert.match(s.url, /^https:\/\//);
  if (s.path) assert.match(s.url, /\/blob\/[a-f0-9]{40}\//);
}
// Structure references, worked examples and the Dad-Chat section (1.65.0).
const Refs = require('../src/skills-refs.js');
const fsx = require('node:fs');
for (const [id, list] of Object.entries(Refs.links)) {
  assert.ok(C.get(id), 'link for unknown preset ' + id);
  assert.ok(list.every(r => Refs.byId[r]), 'unknown pack in ' + id);
}
for (const id of Object.keys(Refs.examples)) assert.ok(C.get(id), 'example for unknown preset ' + id);
assert.equal(new Set(Refs.packs.map(p => p.id)).size, Refs.packs.length);
assert.ok(Refs.packs.filter(p => /^dad-skill-/.test(p.id)).every(p => !p.text.includes('\\`') && p.text.includes('`')), 'family skill packs keep their backticks verbatim');
assert.ok(Refs.packs.every(p => p.text.length > 200 && !p.text.includes('\u0000')));
// Every Tavern/Chub card skill and every Dad-Chat skill carries a diagram or schema plus an example.
const cardSkills = C.presets.filter(p => p.category === 'cards'), dadSkills = C.presets.filter(p => p.category === 'dad');
assert.equal(cardSkills.length, 32);
assert.equal(dadSkills.length, 33);
for (const p of cardSkills.concat(dadSkills)) {
  assert.ok(p.refs.length >= 1, p.id + ' needs a structure reference');
  assert.ok(p.example.length > 80, p.id + ' needs a worked example');
  const built = C.buildPrompt(p.id);
  assert.ok(built.includes('STRUCTURE REFERENCE\n'), p.id);
  assert.ok(built.includes('WORKED EXAMPLE'), p.id);
  for (const r of p.refs) assert.ok(built.includes(Refs.byId[r].text), p.id + ' prompt missing pack ' + r);
}
for (const p of dadSkills) {
  assert.deepEqual(Array.from(p.types), ['chat', 'story']);
  assert.ok(p.sources.includes('dad-arch') && p.sources.includes('dad-format'));
  assert.match(C.buildPrompt(p.id), /PROJECT CONTEXT: DAD-CHAT/);
}
assert.ok(!C.buildPrompt('fix-bugs').includes('STRUCTURE REFERENCE'));
assert.ok(!C.buildPrompt('fix-bugs').includes('PROJECT CONTEXT'));
assert.equal(C.sections.find(s => s.id === 'dad').title, 'Dad-Chat projects');
for (const id of ['dad-orient', 'dad-diagnose', 'dad-fix', 'dad-add-feature', 'dad-improve-feature', 'dad-new-module', 'dad-prompt-tune', 'dad-provider-add', 'dad-ui-polish', 'dad-import-export', 'dad-hub-work', 'dad-prompt-audit', 'dad-persistence-audit', 'dad-safety-review', 'dad-perf-size', 'dad-release-check', 'dad-character-create', 'dad-character-improve', 'dad-lore-build', 'dad-lore-audit', 'dad-world-build', 'dad-token-diet', 'dad-convert-tavern', 'dad-greetings-examples', 'dad-file-validate', 'dad-file-chat', 'dad-file-backup', 'dad-file-convert', 'dad-weld-wire', 'dad-vault-bridge', 'dad-session-slots']) assert.ok(C.get(id), id);
assert.ok(C.search('dad-chat').length >= 29 && C.search('', 'dad', null, { type: 'dashboard' }).length === 0);
const diagnose = C.buildPrompt('dad-diagnose', { slug: 'dad-chat', details: 'Lore never appears.' });
assert.match(diagnose, /MODE: REVIEW ONLY/);
assert.match(diagnose, /main\.pjs \.\.\.\.\.\.\.\.\. plugin imports/);
assert.match(diagnose, /SCRIPT LOAD ORDER/);
assert.match(diagnose, /app\.js \(about 2\.4 MB\)/);
assert.match(diagnose, /PROMPT ASSEMBLY/);
assert.match(diagnose, /HOW TO MAKE ONE SAFE EDIT/);
assert.ok(diagnose.indexOf('STRUCTURE REFERENCE') < diagnose.indexOf('USER DETAILS\nLore never appears.'));
assert.match(C.buildPrompt('dad-fix'), /MODE: IMPLEMENT/);
assert.match(C.buildPrompt('dad-character-create'), /"type": "dad-char"/);
assert.match(C.buildPrompt('dad-lore-audit'), /scanDepth \.+ number 1-20 or null/);
assert.match(C.buildPrompt('card-spec-export'), /89 50 4E 47 0D 0A 1A 0A/);
assert.match(C.buildPrompt('card-spec-export'), /FILES IN -----> PARSE/);
assert.match(C.buildPrompt('card-spec-import'), /chara_card_v3/);
assert.match(C.buildPrompt('lore-import-export'), /keysecondary/);
assert.match(C.buildPrompt('author-note-depth'), /PROMPT ASSEMBLY ORDER WITH DEPTH INJECTION/);
assert.match(C.buildPrompt('card-spec-export'), /not the behavior of any app version/);
assert.ok(!C.buildPrompt('dad-fix').includes('not the behavior of any app version'));

// JSON in the packs must parse, and the Dad-native examples must obey the Dad-native rules.
const jsonBlocks = id => Refs.byId[id].text.match(/^\{[\s\S]*?^\}/gm) || [];
const checkEntry = (e, where) => {
  for (const k of ['id', 'name', 'keys', 'content', 'priority', 'constant', 'vectorized', 'enabled', 'excludeRecursion', 'scanDepth']) assert.ok(Object.hasOwn(e, k), where + ' lacks ' + k);
  assert.ok(e.keys.length >= 1 && e.keys.length <= 6 && e.keys.every(k => k === k.toLowerCase()), where + ' keys');
  assert.ok(e.content.split(/\s+/).length <= 70, where + ' content too long');
  assert.equal(e.scanDepth, null);
  assert.ok(!/^Entry \d+$/.test(e.name));
};
const dadChar = JSON.parse(jsonBlocks('dad-character').pop());
assert.equal(dadChar.type, 'dad-char'); assert.equal(dadChar.version, 2);
assert.ok(dadChar.data.id && dadChar.data.name && dadChar.data.systemPrompt && Array.isArray(dadChar.data.firstMessage));
assert.ok(dadChar.data.exampleDialogue.every(x => x.name1 && x.content1 && x.name2 && x.content2));
assert.ok(!('avatar' in dadChar.data) && !('lorebookArchive' in dadChar.data) && !('useCount' in dadChar.data));
Object.values(dadChar.data.lorebook).forEach(e => checkEntry(e, 'dad-character lorebook'));
checkEntry(JSON.parse(jsonBlocks('dad-lore')[0]), 'dad-lore example');
const dadWorld = JSON.parse(jsonBlocks('dad-world').pop());
assert.equal(dadWorld.type, 'dad-world'); assert.equal(dadWorld.version, 1);
Object.values(dadWorld.world.entries).forEach(e => checkEntry(e, 'dad-world entries'));
const v2 = JSON.parse(jsonBlocks('st-card-v2')[0]);
assert.equal(v2.spec, 'chara_card_v2'); assert.equal(v2.spec_version, '2.0'); assert.ok(v2.data.first_mes);
const v3 = JSON.parse(jsonBlocks('st-card-v3')[0]);
assert.equal(v3.spec, 'chara_card_v3'); assert.equal(v3.spec_version, '3.0'); assert.ok(Array.isArray(v3.data.assets));
const lore = jsonBlocks('st-lore'); assert.equal(lore.length, 2);
assert.ok(Array.isArray(JSON.parse(lore[0]).entries)); assert.ok(JSON.parse(lore[1]).entries['0'].keysecondary);
const chat = Refs.byId['st-chatlog'].text.split('\n').filter(l => l.startsWith('{"')).map(l => JSON.parse(l));
assert.equal(chat.length, 3); assert.ok(chat[0].user_name && chat[1].swipes[chat[1].swipe_id] === chat[1].mes);

// Website builder skills and cross-cutting edge-case skills (1.76.0).
const webSkills = C.presets.filter(p => p.category === 'web');
assert.equal(webSkills.length, 24);
assert.equal(C.sections.find(s => s.id === 'web').title, 'Websites & site builders');
assert.ok(C.types.some(t => t.id === 'website'));
for (const p of webSkills) assert.ok(p.refs.length >= 1, p.id + ' needs a structure reference');
const oneClick = C.buildPrompt('site-one-click-builder', { slug: 'demo', details: 'A bakery in Ames.' });
assert.match(oneClick, /ONE textarea|ONE idea/);
assert.match(oneClick, /Single page or Multi page/);
assert.match(oneClick, /ONE-CLICK SITE BUILDER PIPELINE/);
assert.match(oneClick, /SITE SPEC: THE ONE MODEL/);
assert.match(oneClick, /AI FIELD HELPER CONTRACT/);
assert.match(oneClick, /never invent prices, contact details or testimonials/);
assert.match(oneClick, /nothing was published/);
assert.ok(oneClick.indexOf('WORKED EXAMPLE') < oneClick.indexOf('USER DETAILS\nA bakery in Ames.'));
assert.match(C.buildPrompt('site-ai-fields'), /never overwrite text typed while a request was running/);
assert.match(C.buildPrompt('site-pipeline-resilience'), /ignore late replies from a stopped or older run/);
assert.match(C.buildPrompt('site-contact-forms'), /do not pretend a message was sent/);
assert.match(C.buildPrompt('site-multipage'), /relative \.html links that work from disk|work from disk/);
assert.match(C.buildPrompt('site-render-safety'), /MODE: REVIEW ONLY/);
assert.ok(C.get('site-quality-audit').mode === 'review' && C.get('site-edge-cases').mode === 'review');
assert.ok(C.search('', 'web', null, { type: 'website' }).length === webSkills.length);
assert.ok(C.search('', 'web', null, { type: 'dashboard' }).length === 0);
assert.ok(C.search('website').length >= 20);
for (const id of ['ai-json-contract', 'ai-context-budget', 'sandbox-frame-fallbacks', 'unicode-text-safety', 'size-limit-guard', 'cross-tab-state', 'backup-readiness', 'undo-redo', 'large-generator-slicing', 'perchance-syntax-guard']) {
  assert.ok(C.get(id), id);
  assert.ok(C.get(id).refs.length >= 1, id + ' needs a reference');
}
assert.match(C.buildPrompt('size-limit-guard'), /2 MB/);
assert.match(C.buildPrompt('large-generator-slicing'), /6k tokens/);
// The Site Spec example in the pack must be valid JSON once placeholders are read as data.
const specText = Refs.byId['web-spec'].text.match(/^\{[\s\S]*?\}\s*$/m);
assert.ok(specText && JSON.parse(specText[0].replace(/"single" \| "multi"/, '"single"')).pages[0].sections[0].type === 'hero');

// The native AI input is believed to take about 6k tokens: every built-in prompt must leave real headroom.
for (const p of C.presets) assert.ok(C.estimateTokens(C.buildPrompt(p.id, { slug: 'a-long-generator-name', concise: true })) <= 4500, p.id + ' prompt too large');

// Image prompt skills adapted from public Nano Banana prompt collections (1.77.0).
const extraIds = new Set(require('../src/skills-extra.js').rows.map(r => r[1]));
const imgSkills = C.presets.filter(p => p.category === 'imagegen' && !extraIds.has(p.id));
assert.equal(imgSkills.length, 17);
assert.equal(C.sections.find(s => s.id === 'imagegen').title, 'Image prompts & studios');
for (const p of imgSkills) {
  assert.ok(p.refs.length >= 1, p.id + ' needs a reference');
  assert.deepEqual([...p.types], ['image']);
  assert.ok(p.sources.every(id => C.sources.some(s => s.id === id)) && p.sources.length === 2);
}
assert.ok(C.sources.find(s => s.id === 'nano').url.includes('475f02bf67b2cd26d5d9c76ba145b47cb4500700'));
assert.match(C.buildPrompt('img-prompt-slots'), /SLOT SYNTAX/);
assert.match(C.buildPrompt('img-reference-edit'), /LIKENESS AND CONSENT/);
assert.match(C.buildPrompt('img-json-prompt-builder'), /negative_prompt/);
assert.ok(C.get('img-prompt-lint').mode === 'review');
assert.ok(C.search('', 'imagegen', null, { type: 'image' }).length === C.presets.filter(p => p.category === 'imagegen').length);
assert.ok(C.get('img-negative-prompts').refs.includes('img-anatomy') && C.get('img-seed-lock').refs.includes('img-anatomy'));
assert.ok(C.search('', 'imagegen', null, { type: 'dashboard' }).length === 0);
assert.ok(C.search('infographic').some(p => p.id === 'img-infographic-studio'));
const slotText = Refs.byId['img-templates'].text.match(/^\{\n  "id"[\s\S]*?\n\}$/m);
assert.ok(slotText && JSON.parse(slotText[0]).slots[0].name === 'quote');
const anatomyJson = Refs.byId['img-anatomy'].text.match(/^\{\n  "subject"[\s\S]*?\n\}$/m);
assert.ok(anatomyJson && JSON.parse(anatomyJson[0]).photography);

// The bundled copies of the Dad-Chat docs ship in the repo and agree with the packs on key names and numbers.
const archDoc = fsx.readFileSync('docs/dad-chat/architecture.md', 'utf8'), formatDoc = fsx.readFileSync('docs/dad-chat/dad-native-format.md', 'utf8');
for (const fact of ['6,656', 'chatToCardMaxMessages = 40', 'chatToCardMaxCast = 6', 'pjsLiteral', 'Dad_PROVIDER_GROUPS']) {
  assert.ok((archDoc + formatDoc).includes(fact), 'docs lack ' + fact);
  assert.ok(Refs.packs.some(p => p.text.includes(fact)), 'packs lack ' + fact);
}
for (const file of ['main.pjs', 'pjs-globals.js', 'agent-core.js', 'providers.js', 'forge-core.js', 'forge-bridge.js', 'henry-tucker.js', 'image-forge.js', 'app.js', 'forge-studio.js', 'story-forge.js', 'scene-cast.js', 'immersive.js', 'styling.css'])
  assert.ok(archDoc.includes(file) && Refs.byId['dad-layout'].text.includes(file), 'layout drift: ' + file);
for (const key of ['dad_roleplay', 'lorebookArchive', 'lastLoreRun', 'excludeRecursion', 'vectorized', 'reminderMessage', 'userOverride'])
  assert.ok(formatDoc.includes(key) && Refs.packs.some(p => p.text.includes(key)), 'format drift: ' + key);
console.log('Skills catalog, scope, search and prompt composition passed');

// Rows from skills-extra.js carry their own workflow and acceptance check instead of the section defaults.
const extraRow = C.get('dice-notation');
assert.ok(extraRow && extraRow.category === 'games');
assert.equal(extraRow.steps.length, 3);
assert.ok(extraRow.steps[0].startsWith('Write the notation grammar'));
assert.ok(extraRow.check.startsWith('Standard notation rolls correctly'));
assert.notDeepEqual(extraRow.steps, C.get('game-balance').steps);
const extraPrompt = C.buildPrompt('privacy-audit', {});
assert.ok(extraPrompt.includes('MODE: REVIEW ONLY'));
assert.ok(extraPrompt.includes('Inventory scripts, embeds, fetches and plugin calls.'));
assert.ok(C.get('fix-bugs').steps === C.sections.find(s => s.id === 'repair').steps);
