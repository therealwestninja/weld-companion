// Studio 1.63 features: migration, macros, regex, advanced lore, cards (JSON/PNG), World Info, chats, assist, sample.
const assert = require('node:assert/strict');
const C = require('../src/studio-core.js');

// Migration: a project saved before 1.63 (no new fields) still validates and gains defaults.
const legacy = C.project('Legacy', 'character');
delete legacy.persona; delete legacy.quickReplies; delete legacy.regex;
['authorNote', 'authorNoteDepth', 'loreRecursion'].forEach(k => delete legacy.settings[k]);
const legacyChar = legacy.characters[0];
['scenario', 'alternateGreetings', 'tags', 'systemPrompt', 'postHistory', 'talkativeness'].forEach(k => delete legacyChar[k]);
const migrated = C.validate(legacy);
assert.equal(migrated.persona.name, 'User');
assert.deepEqual(migrated.characters[0].alternateGreetings, []);
assert.equal(migrated.characters[0].talkativeness, 50);
assert.equal(migrated.settings.authorNoteDepth, 4);
for (const template of Object.keys(C.templates)) assert.equal(C.validate(C.project('T', template)).template, template);
assert.ok(Object.keys(C.templates).length >= 9);

// Macros.
const vars = { user: 'Sam', char: 'Mira', rng: () => 0 };
assert.equal(C.expand('Hi {{user}}, I am {{char}} and <USER> is <BOT>.', vars), 'Hi Sam, I am Mira and Sam is Mira.');
assert.equal(C.expand('{{random:red,blue}}', vars), 'red');
assert.equal(C.expand('{{roll:2d6}}', { rng: () => 0 }), '2');
assert.equal(C.expand('{{mystery}} {{user}}', vars), '{{mystery}} Sam', 'unknown macros stay literal');
assert.equal(C.expand('{{random:{{user}}}}', vars).includes('{{'), true, 'no recursion');
assert.deepEqual(C.unresolvedMacros('{{user}} {{oops}} {{Roll:1d4}}'), ['{{oops}}']);

// Regex rules apply per target and skip bad patterns.
const rules = [{ id: 'a', name: 'x', find: 'foo', replace: 'bar', flags: 'g', target: 'prompt', enabled: true },
  { id: 'b', name: 'y', find: '(', replace: '', flags: '', target: 'both', enabled: true },
  { id: 'c', name: 'z', find: 'bar', replace: 'baz', flags: 'g', target: 'display', enabled: true }];
assert.equal(C.applyRegex('foo foo', rules, 'prompt'), 'bar bar');
assert.equal(C.applyRegex('foo bar', rules, 'display'), 'foo baz');

// ReDoS guard: nested quantifiers are refused, large inputs skipped, and imported rules arrive disabled.
assert.ok(C.riskyPattern('(a+)+$') && C.riskyPattern('(x*)*') && C.riskyPattern('(\w+\s?)+'));
assert.ok(!C.riskyPattern('colou?r') && !C.riskyPattern('(cat|dog)s') && !C.riskyPattern('a+b'));
const evil = [{ id: 'e', name: 'e', find: '(a+)+$', replace: '', flags: '', target: 'both', enabled: true }];
const started = Date.now(); assert.equal(C.applyRegex('a'.repeat(40) + '!', evil, 'prompt'), 'a'.repeat(40) + '!'); assert.ok(Date.now() - started < 500);
assert.equal(C.applyRegex('x'.repeat(30000), [{ id: 'g', name: 'g', find: 'x', replace: 'y', flags: 'g', target: 'both', enabled: true }], 'prompt').length, 30000);
const shared = C.project('Shared', 'character'); shared.regex.push({ id: 'r', name: 'r', find: 'a', replace: 'b', flags: 'g', target: 'both', enabled: true });
assert.equal(C.importBundle(C.bundle(shared)).regex[0].enabled, false);
assert.equal(shared.regex[0].enabled, true);

// Advanced lore: secondary keys, whole word, case, probability, groups, recursion, sticky/cooldown/delay.
const p = C.project('Lore world', 'adventure');
const hero = p.characters[0];
const L = (title, over) => C.loreEntry(Object.assign({ title, body: title + ' body' }, over));
p.lore.push(
  L('Tower', { keywords: 'tower' }),
  L('Only with fire', { keywords: 'dragon', secondaryKeys: 'fire', secondaryLogic: 'and' }),
  L('Not in winter', { keywords: 'lake', secondaryKeys: 'winter', secondaryLogic: 'not' }),
  L('Whole word cat', { keywords: 'cat', wholeWord: true }),
  L('Case Sensitive', { keywords: 'Rome', caseSensitive: true }),
  L('Chain start', { keywords: 'trigger', body: 'mentions the hidden vault' }),
  L('Vault', { keywords: 'vault' }),
  L('No chain', { keywords: 'vault2', recursive: true }),
  L('Always', { activation: 'always' }),
  L('Manual', { activation: 'manual', keywords: 'tower' }),
  L('Group low', { keywords: 'guild', group: 'g1', priority: 1 }),
  L('Group high', { keywords: 'guild', group: 'g1', priority: 5 }));
const titles = text => C.lorePreview(p, hero.id, text).map(x => x.title);
assert.ok(titles('a tower').includes('Tower') && !titles('a tower').includes('Manual'));
assert.ok(!titles('a dragon').includes('Only with fire') && titles('a dragon with fire').includes('Only with fire'));
assert.ok(titles('the lake').includes('Not in winter') && !titles('the lake in winter').includes('Not in winter'));
assert.ok(!titles('category').includes('Whole word cat') && titles('a cat!').includes('Whole word cat'));
assert.ok(!titles('rome').includes('Case Sensitive') && titles('Rome').includes('Case Sensitive'));
assert.ok(titles('trigger').includes('Vault'), 'recursive activation through body text');
p.lore.find(l => l.title === 'Vault').recursive = false;
assert.ok(!titles('trigger').includes('Vault'), 'recursive:false entries are not chained');
assert.ok(titles('guild').includes('Group high') && !titles('guild').includes('Group low'), 'inclusion group keeps the highest priority');
assert.ok(titles('anything').includes('Always'));
const odds = L('Rare', { keywords: 'rare', probability: 30 }); p.lore.push(odds);
const sess = C.session(p, hero.id, 'S'); p.sessions.push(sess);
assert.ok(C.context(p, sess, 'rare', { rng: () => 0.1 }).selected.some(x => x.title === 'Rare'));
assert.ok(!C.context(p, sess, 'rare', { rng: () => 0.9 }).selected.some(x => x.title === 'Rare'));
const timed = L('Timed', { keywords: 'bell', sticky: 2, cooldown: 2, delay: 2 }); p.lore.push(timed);
const t = C.session(p, hero.id, 'T'); p.sessions.push(t);
const fired = () => C.context(p, t, 'the bell', { rng: () => 0 }).selected.some(x => x.title === 'Timed');
const quiet = () => C.context(p, t, 'nothing here', { rng: () => 0 }).selected.some(x => x.title === 'Timed');
assert.equal(fired(), false, 'delay blocks it early in the chat');
for (let i = 0; i < 2; i++) t.messages.push({ role: 'user', content: 'x' });
assert.equal(fired(), true); C.recordLore(t, ['Timed'].map(() => timed.id));
t.messages.push({ role: 'user', content: 'y' });
assert.equal(quiet(), true, 'sticky keeps it active without the keyword');
t.messages.push({ role: 'user', content: 'y' }, { role: 'user', content: 'y' });
assert.equal(fired(), false, 'cooldown blocks the keyword after sticky ends');
for (let i = 0; i < 4; i++) t.messages.push({ role: 'user', content: 'z' });
assert.equal(fired(), true, 'available again after cooldown');
assert.ok(C.validate(p).sessions.length === 2);

// Context: persona, author note depth, depth prompt, post-history, system prompt override, hidden messages, summary, sections.
const q = C.project('Ctx', 'character'); const c = q.characters[0];
c.name = 'Mira'; c.systemPrompt = 'Custom. {{original}} End.'; c.postHistory = 'Stay brief.'; c.depthPrompt = 'Remember the ledger.'; c.depthPromptDepth = 1;
c.personality = '{{char}} greets {{user}}.'; c.scenario = 'A rainy inn.';
q.persona = { name: 'Sam', description: 'A traveling cook' }; q.settings.authorNote = 'Keep it short.'; q.settings.authorNoteDepth = 0;
q.regex.push({ id: 'r', name: 'n', find: 'secret', replace: '[redacted]', flags: 'gi', target: 'prompt', enabled: true });
const qs = C.session(q, c.id, 'Q'); q.sessions.push(qs);
qs.messages.push({ role: 'user', content: 'visible one' }, { role: 'assistant', content: 'HIDDEN_SENTINEL', hidden: true }, { role: 'assistant', content: 'a secret reply' });
qs.summary = 'SUMMARY_SENTINEL';
const cx = C.context(q, qs, 'my secret plan');
assert.match(cx.system, /Custom\. You are portraying/);
assert.match(cx.system, /USER PERSONA \(Sam\)/);
assert.match(cx.system, /Mira greets Sam\./);
assert.match(cx.system, /"scenario":"A rainy inn\."/);
assert.match(cx.system, /SUMMARY_SENTINEL/);
assert.doesNotMatch(cx.user, /HIDDEN_SENTINEL/);
assert.match(cx.user, /\[redacted\]/);
assert.doesNotMatch(cx.user, /my secret plan/);
assert.match(cx.user, /POST-HISTORY INSTRUCTIONS:\nStay brief\./);
const transcript = JSON.parse(cx.user.slice(cx.user.indexOf('[{'), cx.user.lastIndexOf('}]') + 2));
assert.equal(transcript.at(-1).content, '[Author note] Keep it short.', 'depth 0 puts the note last');
assert.equal(transcript.at(-2).content, '[Character reminder] Remember the ledger.'.replace('Remember', 'Remember'), 'depth 1 puts the reminder before the last message');
assert.ok(cx.sections.length >= 8 && cx.sections.every(s => s.tokens >= 0) && cx.tokens === C.estTokens(cx.characters));

// Variants (swipes).
const m = { role: 'assistant', content: 'one' };
C.addVariant(m, 'two'); C.addVariant(m, 'three');
assert.deepEqual(m.swipes, ['one', 'two', 'three']); assert.equal(m.content, 'three');
C.pickVariant(m, 1); assert.equal(m.content, 'one');
C.setVariantText(m, 'edited'); assert.equal(m.swipes[0], 'edited');
qs.messages.push(m); assert.ok(C.validate(q));
m.swipeId = 9; assert.throws(() => C.validate(q), /variant index/);

// Tavern V2 card round trip (JSON), including embedded lore and unknown fields.
const full = C.project('Card world', 'character'); const fc = full.characters[0];
Object.assign(fc, { name: 'Ayla', personality: 'Desc', voice: 'Quiet', motivations: 'Goals', boundaries: 'Bounds', opening: 'Hello', examples: '<START>\n{{user}}: hi',
  beliefs: 'Beliefs', scenario: 'Scene', alternateGreetings: ['Alt one', 'Alt two'], tags: 'a, b, A', creator: 'Me', creatorNotes: 'Notes', version: '2',
  systemPrompt: 'Sys', postHistory: 'Post', depthPrompt: 'Dp', depthPromptDepth: 6, talkativeness: 80, notes: 'PRIVATE_AUTHOR_NOTE' });
full.lore.push(C.loreEntry({ title: 'Public', body: 'pub', keywords: 'k1, k2', secondaryKeys: 's', secondaryLogic: 'not', priority: 4, probability: 60, sticky: 1 }),
  C.loreEntry({ title: 'Secret', body: 'SECRET_BODY', visibility: 'private', knownBy: [] }));
const card = C.toV2Card(full, fc);
assert.equal(card.spec, 'chara_card_v2'); assert.equal(card.spec_version, '2.0');
assert.deepEqual(card.data.alternate_greetings, ['Alt one', 'Alt two']); assert.deepEqual(card.data.tags, ['a', 'b']);
assert.equal(card.data.character_book.entries.length, 1, 'private lore the character does not know is not exported');
assert.doesNotMatch(JSON.stringify(card), /PRIVATE_AUTHOR_NOTE|SECRET_BODY/);
assert.match(JSON.stringify(C.toV2Card(full, fc, { includeNotes: true })), /PRIVATE_AUTHOR_NOTE/);
const back = C.fromCard(JSON.parse(JSON.stringify(card)));
['name', 'personality', 'voice', 'motivations', 'boundaries', 'opening', 'examples', 'beliefs', 'scenario', 'creator', 'version', 'systemPrompt', 'postHistory', 'depthPrompt', 'depthPromptDepth', 'talkativeness']
  .forEach(k => assert.deepEqual(back.character[k], fc[k], k));
assert.equal(back.character.tags, 'a, b'); assert.equal(back.lore[0].secondaryLogic, 'not'); assert.equal(back.lore[0].probability, 60); assert.equal(back.lore[0].sticky, 1);
// A foreign card keeps description and personality text.
const foreign = C.fromCard({ spec: 'chara_card_v2', spec_version: '2.0', data: { name: 'Foreign', description: 'D', personality: 'P', first_mes: 'Hi', extensions: { chub: { id: 1 } } } });
assert.match(foreign.character.personality, /D[\s\S]*Personality: P/);
assert.equal(C.fromCard({ name: 'Flat', description: 'old v1', first_mes: 'hey' }).spec, 'v1');
assert.equal(C.fromCard({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'V3' } }).character.name, 'V3');
assert.throws(() => C.fromCard({ spec: 'other', data: { name: 'x' } }), /Unsupported card spec/);
assert.throws(() => C.fromCard({ spec: 'chara_card_v2', data: {} }), /name/);

// PNG card embedding with valid chunks and CRCs.
function tinyPng() {
  const chunk = (type, data) => { const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer); v.setUint32(0, data.length);
    [...type].forEach((ch, i) => { out[4 + i] = ch.charCodeAt(0); }); out.set(data, 8); v.setUint32(8 + data.length, C.crc32(out.subarray(4, 8 + data.length))); return out; };
  const ihdr = new Uint8Array(13); new DataView(ihdr.buffer).setUint32(0, 1); new DataView(ihdr.buffer).setUint32(4, 1); ihdr[8] = 8; ihdr[9] = 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array([8, 29, 1, 0, 0, 255, 255, 0, 0, 0, 1])), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, a) => n + a.length, 0)); let o = 0; parts.forEach(a => { out.set(a, o); o += a.length; }); return out;
}
const png = tinyPng(), cardUnicode = C.toV2Card(full, fc); cardUnicode.data.name = 'Ayla ✨ é中';
const written = C.pngWriteCard(png, cardUnicode, 'chara');
const read = C.pngReadCard(written);
assert.equal(read.keyword, 'chara'); assert.equal(read.card.data.name, 'Ayla ✨ é中');
assert.deepEqual(Array.from(written.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
const rewritten = C.pngReadCard(C.pngWriteCard(written, cardUnicode, 'ccv3'));
assert.equal(rewritten.keyword, 'ccv3', 'stale chara chunk is removed');
assert.throws(() => C.pngReadCard(png), /No character card data/);
assert.throws(() => C.pngReadCard(new Uint8Array(30)), /Not a PNG/);
assert.equal(C.bytesToB64(new Uint8Array([72, 105])), 'SGk='); assert.deepEqual(Array.from(C.b64ToBytes('SGk=')), [72, 105]);

// World Info and V2 character_book.
const wi = C.toWorldInfo(full.lore);
assert.equal(Object.keys(wi.entries).length, 2);
const wiBack = C.fromWorldInfo(JSON.parse(JSON.stringify(wi)));
assert.equal(wiBack[0].keywords, 'k1, k2'); assert.equal(wiBack[0].secondaryLogic, 'not'); assert.equal(wiBack[0].probability, 60); assert.equal(wiBack[0].priority, 4);
assert.equal(C.fromWorldInfo({ entries: [{ key: ['a'], content: 'b', constant: true }] })[0].activation, 'always');
assert.equal(C.fromWorldInfo({ entries: { 0: { key: ['a'], content: 'b', disable: true } } })[0].activation, 'manual');
assert.throws(() => C.fromWorldInfo({ nope: 1 }), /entries/);
assert.throws(() => C.fromV2Book({}), /entries/);
assert.equal(C.fromV2Book(card.data.character_book)[0].title, 'Public');

// Chats: JSONL with variants, markdown, bible, stats.
full.sessions.push(Object.assign(C.session(full, fc.id, 'Chat'), { messages: [{ role: 'assistant', content: 'Hello' }, { role: 'user', content: 'Hi' },
  { role: 'assistant', content: 'two', swipes: ['one', 'two'], swipeId: 1 }] }));
const jsonl = C.toChatJsonl(full, full.sessions[0]);
const imported = C.fromChatJsonl(jsonl);
assert.equal(imported.messages.length, 3); assert.equal(imported.messages[2].swipes.length, 2); assert.equal(imported.messages[2].content, 'two');
assert.equal(imported.characterName, 'Ayla');
assert.throws(() => C.fromChatJsonl('{"mes":"ok"}\nnot json'), /Line 2/);
assert.match(C.transcriptMarkdown(full, full.sessions[0]), /\*\*Ayla:\*\* Hello/);
const bible = C.worldBible(full, {});
assert.match(bible, /## Characters[\s\S]*### Ayla/); assert.doesNotMatch(bible, /PRIVATE_AUTHOR_NOTE/); assert.match(C.worldBible(full, { includeNotes: true }), /PRIVATE_AUTHOR_NOTE/);
const st = C.stats(full); assert.equal(st.characters, 1); assert.equal(st.lore, 2); assert.equal(st.privateLore, 1); assert.ok(st.tokens > 0);

// Audit additions.
const aud = C.project('Aud', 'character'); aud.characters[0].personality = '{{wat}}';
aud.lore.push(C.loreEntry({ title: 'Sec', keywords: 'x', secondaryLogic: 'and' }));
const msgs = C.audit(aud).map(i => i.message).join('\n');
assert.match(msgs, /No opening message/); assert.match(msgs, /Unknown macro \{\{wat\}\}/); assert.match(msgs, /no secondary keys/);

// Assist builders and strict parsers.
const world = C.project('Assist', 'character'); world.characters[0].name = 'Ayla'; world.characters.push(C.character('Bo'));
assert.match(C.assist.character(world, 'a pirate').user, /CONCEPT:\na pirate/);
assert.equal(C.assist.parseCharacter('```json\n{"name":"Zed","personality":"Bold","bogus":"x"}\n```').name, 'Zed');
assert.throws(() => C.assist.parseCharacter('{"personality":"no name"}'), /name/);
assert.throws(() => C.assist.parseCharacter('plain text'), /JSON/);
assert.equal(C.assist.parseLore('[{"title":"T","body":"B","keywords":"k"}]')[0].keywords, 'k');
assert.throws(() => C.assist.parseLore('[{"title":"T"}]'), /title and body/);
assert.equal(C.assist.parseRelationships(world, '[{"from":"ayla","to":"BO","description":"friends"}]')[0].description, 'friends');
assert.throws(() => C.assist.parseRelationships(world, '[{"from":"Ayla","to":"Nobody","description":"x"}]'), /unknown character/);
assert.equal(C.assist.parseTimeline('[{"title":"Birth","order":"5"}]')[0].order, 5);
assert.equal(C.assist.parseStrings('["a","b"]').length, 2);
assert.match(C.assist.field(world, world.characters[0], 'Voice', '', '').user, /WRITE a good value/);
assert.match(C.assist.field(world, world.characters[0], 'Voice', 'old text', 'shorter').user, /REWRITE this text \(shorter\)/);
assert.equal(C.assist.plain('```\nhello\n```'), 'hello');

// Sample project is valid, has hidden knowledge and no audit errors beyond informational ones.
const sample = C.sample();
assert.ok(sample.characters.length >= 2 && sample.lore.length >= 4 && sample.quickReplies.length >= 2);
const sampleSession = C.session(sample, sample.characters[0].id, 'x'); sample.sessions.push(sampleSession);
assert.doesNotMatch(C.context(sample, sampleSession, 'harbormaster smuggling').system, /scuttled the Gannet/, 'private secret stays hidden');
assert.match(C.context(sample, sampleSession, 'the harbor').system, /Silver Harbor/);
console.log('Studio migration, macros, regex, advanced lore, cards, PNG, World Info, chats, assist and sample tests passed');
