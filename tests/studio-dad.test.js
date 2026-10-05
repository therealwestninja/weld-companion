// Dad Chat (dad-chat-v2) interop: synthetic fixtures that mirror the real export structures. No personal data.
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const C = require('../src/studio-core.js');
const D = require('../src/studio-dad.js');

const file = (name, content, type) => {
  const buf = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
  return { name, size: buf.length, type: type || '', text: async () => buf.toString('utf8'), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
};
const dadLore = (id, name, keys, content, over) => Object.assign({ id, name, keys, content, priority: 20, constant: false, enabled: true, vectorized: false, excludeRecursion: false, scanDepth: null, keyEmbedding: null }, over);
const dadChar = () => ({
  id: 'char_test_1', name: 'Mira Vale', avatar: 'data:image/png;base64,AAAA', description: 'A harbor innkeeper.',
  systemPrompt: 'You are Mira only. Never speak for {{user}}.',
  profile: { name: 'Mira Vale', age: '34', gender: 'female', appearance: 'Tall, weathered.', personality: 'Dry, protective.', background: 'Ran the inn for ten years.', scenario: 'A rainy night at the inn.', systemNote: 'Third person, past tense.' },
  customSections: [{ header: 'Voice', content: 'Short sentences.' }, { header: 'Goals and fears', content: 'Keep the lamp lit.' }, { header: 'Secret room', content: 'A cellar under the bar.' }],
  exampleDialogue: [{ name1: 'User', content1: 'Any rooms?', name2: 'Mira', content2: 'One. Up the stairs.' }],
  firstMessage: ['Rain hammered the roof. "Sit," Mira said.', 'The door banged open.'], reminderMessage: 'Stay in character.',
  userOverride: { name: 'Sam', description: 'A traveling cook.', avatar: null }, preInstruction: 'roleplay', tags: ['inn', 'slow burn'],
  chatBackground: 'bg.png', bgBlur: '0', bgOpacity: '1', imagePrefix: 'oil painting', visualMap: '',
  lorebook: { lore_a: dadLore('lore_a', 'The Inn', ['inn', 'lamp'], 'The Lantern Inn sits on the quay.', { constant: true, priority: 40 }),
    lore_b: dadLore('lore_b', 'Cellar', ['cellar'], 'Hidden stock.', { enabled: false, excludeRecursion: true }) },
  authorNote: { text: 'Keep scenes short.', depth: 3, role: 'system', enabled: true }, lastModified: 1
});
const node = (id, role, content, parentId, extra) => Object.assign({ id, role, displayRole: role, content, timestamp: '2026-01-01T00:00:00Z', parentId, children: [], selectedChild: null, archived: false, isAnchor: false }, extra || {});
function dadThread() {
  const nodes = {
    r: node('r', 'system-root', '', null), a1: node('a1', 'assistant', 'Welcome in.', 'r'), u1: node('u1', 'user', 'Hello', 'a1'),
    a2: node('a2', 'assistant', 'First answer', 'u1'), a2b: node('a2b', 'assistant', 'Second answer', 'u1'), u2: node('u2', 'user', 'Thanks', 'a2b', { archived: true }),
    s1: node('s1', 'system', 'narration', 'u2'), a3: node('a3', 'assistant', 'You are welcome', 'u2')
  };
  nodes.r.children = ['a1']; nodes.r.selectedChild = 'a1'; nodes.a1.children = ['u1']; nodes.a1.selectedChild = 'u1';
  nodes.u1.children = ['a2', 'a2b']; nodes.u1.selectedChild = 'a2b'; nodes.a2b.children = ['u2']; nodes.a2b.selectedChild = 'u2'; nodes.u2.children = ['a3']; nodes.u2.selectedChild = 'a3';
  return { id: 't1', title: 'Rainy night', characterId: 'char_test_1', nodes, rootId: 'r', created: '2026-01-01T00:00:00Z',
    memoryStore: { facts: { m1: { id: 'm1', type: 'fact', content: 'Sam is a cook.', embedding: [0.1, 0.2] } }, version: 1 }, contextSummary: 'A traveler arrived.', authorNote: { text: '', depth: 4, role: 'system', enabled: false } };
}
const v2Entry = (i, keys, content, over) => Object.assign({ id: i, entry_id: i, keys, secondary_keys: [], comment: 'Entry ' + i, name: 'Entry ' + i, content, constant: false, vectorized: false, selective: false, insertion_order: 10, priority: 10, enabled: true, position: 'before_char', case_sensitive: false, exclude_recursion: false, scan_depth: null, display_index: i, extensions: {} }, over || {});

(async () => {
  // Detection of every file family.
  assert.equal(D.detect({ type: 'dad-char', version: 2, data: dadChar() }).kind, 'dad-char');
  assert.equal(D.detect({ type: 'dad-char-chat' }).kind, 'dad-char-chat');
  assert.equal(D.detect({ type: 'dad-chat-user-profile' }).kind, 'dad-user-profile');
  assert.equal(D.detect({ type: 'dad-world', world: {} }).kind, 'dad-world');
  assert.equal(D.detect({ config: {}, threads: {} }).kind, 'dad-full');
  assert.equal(D.detect({ spec: 'chara_card_v2', data: {} }).kind, 'card');
  assert.equal(D.detect({ name: 'x', entries: [], scan_depth: 1 }).kind, 'lorebook');
  assert.equal(D.detect({ entries: { 0: {} } }).kind, 'worldinfo');
  assert.equal(D.detect([{ name: 'A', role: 'x', appearance: '' }]).kind, 'forge-cast');
  assert.equal(D.detect({ hello: 1 }).kind, 'unknown');

  // Dad Chat character -> Studio character, lore and persona.
  const plan = await D.readFile(file('Mira.json', JSON.stringify({ type: 'dad-char', version: 2, data: dadChar() })));
  assert.equal(plan.format, 'Dad Chat character');
  const ch = plan.items.find(i => i.kind === 'character');
  const c = ch.character;
  assert.equal(c.name, 'Mira Vale'); assert.equal(c.opening, 'Rain hammered the roof. "Sit," Mira said.'); assert.deepEqual(c.alternateGreetings, ['The door banged open.']);
  assert.match(c.systemPrompt, /You are Mira only[\s\S]*Third person, past tense/);
  assert.equal(c.scenario, 'A rainy night at the inn.'); assert.equal(c.postHistory, 'Stay in character.');
  assert.equal(c.voice, 'Short sentences.'); assert.equal(c.motivations, 'Keep the lamp lit.');
  assert.match(c.personality, /Age: 34[\s\S]*Appearance: Tall, weathered\.[\s\S]*Personality: Dry, protective\.[\s\S]*Background:[\s\S]*## Secret room\nA cellar under the bar\./);
  assert.match(c.examples, /<START>\n\{\{user\}\}: Any rooms\?\n\{\{char\}\}: One\. Up the stairs\./);
  assert.equal(c.depthPrompt, 'Keep scenes short.'); assert.equal(c.depthPromptDepth, 3); assert.equal(c.tags, 'inn, slow burn'); assert.equal(c.creatorNotes, 'A harbor innkeeper.');
  assert.equal(c.avatar, ''); assert.ok(plan.notes.some(n => /avatar image is not stored/.test(n)) && plan.notes.some(n => /imagePrefix|chatBackground/.test(n)));
  assert.equal(ch.lore.length, 2);
  const lore = ch.lore.find(l => l.title === 'The Inn'), off = ch.lore.find(l => l.title === 'Cellar');
  assert.equal(lore.activation, 'always'); assert.equal(lore.keywords, 'inn, lamp'); assert.equal(off.activation, 'manual'); assert.equal(off.recursive, false);
  const personaItem = plan.items.find(i => i.kind === 'persona');
  assert.equal(personaItem.persona.name, 'Sam'); assert.equal(personaItem.checked, false, 'persona is opt-in');

  // Apply: project gains character + lore; valid; nothing unchecked is applied.
  const proj = C.project('Host', 'character'); proj.characters = [];
  assert.match(D.applyPlan(proj, plan), /1 character\(s\), 2 lore entries/);
  assert.equal(proj.persona.name, 'User');
  assert.ok(C.validate(proj));
  plan.items.forEach(i => { i.checked = false; }); assert.throws(() => D.applyPlan(proj, plan), /Nothing is selected/);

  // Round trip: Studio -> dad-char -> Studio keeps the content.
  const sp = C.project('Round', 'character'); const sc = sp.characters[0];
  Object.assign(sc, { name: 'Ayla', personality: 'Calm, curious.', voice: 'Quiet.', motivations: 'Find the map.', boundaries: 'No betrayals.', beliefs: 'Trusts the river.', scenario: 'A camp.',
    opening: 'Hello there.', alternateGreetings: ['Alt hello.'], examples: '<START>\n{{user}}: hi\n{{char}}: hello', postHistory: 'Keep it short.', systemPrompt: 'You are Ayla.', tags: 'a, b', creatorNotes: 'Short bio.', depthPrompt: 'Remember the map.', depthPromptDepth: 2 });
  sp.persona = { name: 'Rowan', description: 'A scout.' };
  sp.lore.push(C.loreEntry({ title: 'River', body: 'A wide river.', keywords: 'river, water', secondaryKeys: 'flood', priority: 500, activation: 'always' }), C.loreEntry({ title: 'Hidden', body: 'SECRET', visibility: 'private', knownBy: [] }));
  const exported = D.toDadChar(sp, sc);
  assert.equal(exported.type, 'dad-char'); assert.equal(exported.version, 2); assert.ok(exported.data.id.startsWith('char_studio_'));
  assert.equal(Object.keys(exported.data.lorebook).length, 1, 'private lore is not exported with the character');
  const loreOut = Object.values(exported.data.lorebook)[0];
  assert.deepEqual(loreOut.keys, ['river', 'water', 'flood']); assert.equal(loreOut.priority, 100, 'priority is clamped to 1-100'); assert.equal(loreOut.constant, true);
  assert.deepEqual(exported.data.firstMessage, ['Hello there.', 'Alt hello.']); assert.equal(exported.data.reminderMessage, 'Keep it short.');
  assert.deepEqual(exported.data.exampleDialogue, [{ name1: 'User', content1: 'hi', name2: 'Character', content2: 'hello' }]);
  assert.ok(exported.data.customSections.some(s => s.header === 'Voice') && exported.data.customSections.some(s => s.header === 'Boundaries'));
  assert.doesNotMatch(JSON.stringify(exported), /SECRET/);
  const back = (await D.readFile(file('Ayla.dad-char.json', JSON.stringify(exported)))).items.find(i => i.kind === 'character').character;
  ['name', 'voice', 'motivations', 'boundaries', 'beliefs', 'scenario', 'opening', 'postHistory', 'tags', 'depthPrompt', 'depthPromptDepth'].forEach(k => assert.equal(back[k], sc[k], k));
  assert.deepEqual(back.alternateGreetings, ['Alt hello.']); assert.equal(back.creatorNotes, 'Short bio.'); assert.match(back.personality, /Calm, curious\./);
  assert.match(back.systemPrompt, /You are Ayla\./);
  const up = D.toDadUserProfile(sp);
  assert.deepEqual(up, { type: 'dad-user-profile', version: 1, profileLabel: 'Rowan', chatName: 'Rowan', avatar: '', systemPromptContext: 'A scout.' });
  const upPlan = await D.readFile(file('p.json', JSON.stringify(up)));
  assert.equal(upPlan.items[0].persona.description, 'A scout.'); assert.equal(upPlan.items[0].checked, true);

  // Chat: branching tree flattens along the selected path, siblings become variants, memories become proposals.
  const chatPlan = await D.readFile(file('chat.json', JSON.stringify({ type: 'dad-char-chat', version: 2, character: dadChar(), thread: dadThread() })));
  const sess = chatPlan.items.find(i => i.kind === 'session').session;
  assert.deepEqual(sess.messages.map(m => m.role), ['assistant', 'user', 'assistant', 'user', 'assistant']);
  assert.equal(sess.messages[2].content, 'Second answer'); assert.deepEqual(sess.messages[2].swipes, ['First answer', 'Second answer']); assert.equal(sess.messages[2].swipeId, 1);
  assert.equal(sess.messages[3].hidden, true, 'archived node is hidden from the model'); assert.ok(!sess.messages.some(m => m.content === 'narration'));
  assert.deepEqual(sess.memories, ['Sam is a cook.']); assert.equal(sess.summary, 'A traveler arrived.');
  const hp = C.project('Chat host', 'character'); hp.characters = [];
  D.applyPlan(hp, chatPlan);
  assert.equal(hp.sessions[0].messages.length, 5); assert.equal(hp.sessions[0].proposals.length, 1); assert.equal(hp.sessions[0].memories.length, 0);
  assert.ok(hp.sessions[0].characterId === hp.characters[0].id);
  // Studio chat -> dad-char-chat -> back keeps messages and variants.
  const xp = C.project('X', 'character'); xp.characters[0].name = 'Ayla'; const xs = C.session(xp, xp.characters[0].id, 'Night'); xp.sessions.push(xs);
  xs.messages.push({ role: 'assistant', content: 'Hi' }, { role: 'user', content: 'Yo' }, { role: 'assistant', content: 'two', swipes: ['one', 'two'], swipeId: 1, hidden: false }); xs.memories.push({ id: C.id(), text: 'Fact' }); xs.summary = 'Sum';
  const dadChat = D.toDadChat(xp, xs);
  assert.equal(dadChat.type, 'dad-char-chat'); assert.equal(dadChat.thread.nodes[dadChat.thread.rootId].role, 'system-root');
  const reread = (await D.readFile(file('c.json', JSON.stringify(dadChat)))).items.find(i => i.kind === 'session').session;
  assert.deepEqual(reread.messages.map(m => m.content), ['Hi', 'Yo', 'two']); assert.deepEqual(reread.messages[2].swipes, ['one', 'two']); assert.equal(reread.memories[0], 'Fact'); assert.equal(reread.summary, 'Sum');

  // Lorebook (V2-style with duplicate character_book), World Info (Chub/ST), dad-world, forge cast.
  const book = { name: 'Test lorebook', description: 'x', characterName: 'Ayla', characterId: 'c', scan_depth: 4, token_budget: 512, recursive_scanning: true, extensions: {}, entries: [v2Entry(0, ['river'], 'River lore', { priority: 7 }), v2Entry(1, ['fort'], 'Fort lore', { enabled: false, exclude_recursion: true })] };
  book.character_book = { name: 'Test lorebook', entries: book.entries, extensions: {} };
  const bookPlan = await D.readFile(file('book.json', JSON.stringify(book)));
  assert.equal(bookPlan.format, 'Lorebook'); const bl = bookPlan.items[0].lore;
  assert.equal(bl.length, 2); assert.equal(bl[0].priority, 7); assert.equal(bl[1].activation, 'manual'); assert.equal(bl[1].recursive, false);
  const wi = { name: 'Chub world', entries: { 1: { uid: 1, key: ['k1', 'k2'], keysecondary: ['z'], comment: 'WI entry', content: 'WI body', constant: false, selective: true, selectiveLogic: 0, order: 3, disable: false, probability: 50, useProbability: true, group: 'g' } }, extensions: { chub: { id: 1 } } };
  const wiPlan = await D.readFile(file('wi.json', JSON.stringify(wi)));
  assert.equal(wiPlan.items[0].lore[0].secondaryLogic, 'and'); assert.equal(wiPlan.items[0].lore[0].probability, 50); assert.equal(wiPlan.items[0].lore[0].group, 'g');
  const world = { type: 'dad-world', version: 1, world: { id: 'w1', name: 'Frost Lands', description: 'A cold world.', entries: { we_1: dadLore('we_1', 'Glacier', ['ice'], 'Ice everywhere.') } } };
  const wPlan = await D.readFile(file('worldbook.json', JSON.stringify(world)));
  assert.equal(wPlan.name, 'Frost Lands'); assert.deepEqual(wPlan.items.map(i => i.kind), ['world', 'lore']);
  const wp = C.project('W', 'character'); D.applyPlan(wp, wPlan); assert.equal(wp.world.description, 'A cold world.'); assert.equal(wp.lore[0].title, 'Glacier');
  D.applyPlan(Object.assign(wp, {}), wPlan); assert.match(wp.world.description, /A cold world\.\n\nA cold world\./, 'existing world text is appended to, never replaced');
  const castPlan = await D.readFile(file('characters.json', JSON.stringify([{ id: 'x', name: 'Abby', role: 'Lead', aliases: ['A'], appearance: 'Short', personality: 'Brave', background: 'Raised north', relationships: 'Friend of Jeff', scenario: 'Cold', systemNote: 'Voice her', tags: ['t'], firstMessage: 'Hi', quotes: ['Who are you?'] }])));
  assert.equal(castPlan.items[0].character.name, 'Abby'); assert.match(castPlan.items[0].character.personality, /Role: Lead[\s\S]*Also known as: A/); assert.match(castPlan.items[0].character.examples, /\{\{char\}\}: Who are you\?/);

  // Full backup: characters on, chats/worlds/personas off; built-in presets unchecked; no crash on large structure.
  const full = { type: 'dad-full', version: 2, appVersion: 'Dad-CORE v2.0', date: 'x', currentThreadId: 't1',
    config: { aiName: 'AI', userName: 'U', characterBook: { char_preset_Dad: Object.assign(dadChar(), { id: 'char_preset_Dad', name: 'Dad' }), char_test_1: dadChar() },
      globalUser: { name: 'U', description: 'd', profiles: [{ id: 'p1', label: 'Sam', name: 'Sam', text: 'A cook.' }] },
      worldBook: { version: 1, activeWorldId: 'w1', worlds: { w1: { id: 'w1', name: 'World One', description: 'Desc.', entries: { e1: dadLore('e1', 'E', ['e'], 'body') } } } } },
    threads: { t1: dadThread() } };
  const fp = await D.readFile(file('dad-full-backup.json', JSON.stringify(full)));
  assert.equal(fp.format, 'Dad Chat full backup');
  assert.equal(fp.items.find(i => i.label === 'Dad').checked, false); assert.equal(fp.items.find(i => i.label === 'Mira Vale').checked, true);
  assert.ok(fp.items.filter(i => ['session', 'world', 'lore', 'persona'].includes(i.kind)).every(i => !i.checked));
  const chatItem = fp.items.find(i => i.kind === 'session'); assert.ok(chatItem.characterRef, 'chat is linked to its character');
  chatItem.checked = true; fp.items.find(i => i.kind === 'persona').checked = true;
  const fproj = C.project('F', 'character'); fproj.characters = []; D.applyPlan(fproj, fp);
  assert.equal(fproj.persona.name, 'Sam'); assert.equal(fproj.sessions[0].characterId, fproj.characters.find(x => x.name === 'Mira Vale').id);

  // Text formats: chat text, jsonl, bible text, user-profile console script.
  const chatText = 'Wizard: Greetings, traveler.\n\nYou: Hello there.\n\nWizard: What do you seek?\nI can help.';
  const tp = await D.readFile(file('chat.txt', chatText)); const tm = tp.items[0].session.messages;
  assert.equal(tp.format, 'Chat text'); assert.deepEqual(tm.map(m => m.role), ['assistant', 'user', 'assistant']); assert.match(tm[2].content, /What do you seek\?\nI can help\./);
  const bible = 'Medieval harbor city. Tone: grim.\n\nRiver gate, kiln quarter. Magic is rare: wealth is quiet.\n\nThe captain buried many friends.';
  const bp = await D.readFile(file('world_bible.txt', bible)); assert.equal(bp.format, 'World bible text'); assert.equal(bp.items[0].kind, 'world');
  const jl = [JSON.stringify({ user_name: 'You', character_name: 'Wizard' }), JSON.stringify({ name: 'Wizard', is_user: false, is_name: true, send_date: 1790992051000, mes: 'Hi', swipes: ['Hi', 'Hello'], swipe_id: 1 })].join('\n');
  const jp = await D.readFile(file('chat_1.jsonl', jl)); assert.equal(jp.items[0].session.messages[0].content, 'Hello'); assert.equal(jp.items[0].characterName, 'Wizard');
  const script = '// DadChat user-profile import.\n(() => {\n  const profile = {\n    label: "Rowan",\n    name: "Rowan",\n    text: "A scout.\\nQuiet."\n  };\n  document.title = "x";\n})();';
  const sp2 = await D.readFile(file('import_Rowan.js', script)); assert.equal(sp2.items[0].persona.name, 'Rowan'); assert.equal(sp2.items[0].persona.description, 'A scout.\nQuiet.');
  await assert.rejects(() => D.readFile(file('other.js', 'alert(1)')), /not a Dad Chat user-profile/);
  await assert.rejects(() => D.readFile(file('what.json', '{"hello":1}')), /not a format Studio recognizes/);
  await assert.rejects(() => D.readFile(file('bad.json', 'not json')), /not valid JSON/);

  // PNG cards with two chara chunks (the last wins, as in common apps) and large payloads.
  function pngWith(chunks) {
    const mk = (type, data) => { const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer); v.setUint32(0, data.length); [...type].forEach((ch, i) => { out[4 + i] = ch.charCodeAt(0); }); out.set(data, 8); v.setUint32(8 + data.length, C.crc32(out.subarray(4, 8 + data.length))); return out; };
    const ihdr = new Uint8Array(13); new DataView(ihdr.buffer).setUint32(0, 1); new DataView(ihdr.buffer).setUint32(4, 1); ihdr[8] = 8; ihdr[9] = 2;
    const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), mk('IHDR', ihdr), ...chunks.map(([k, v]) => mk('tEXt', Buffer.from(k + '\0' + Buffer.from(JSON.stringify(v)).toString('base64'), 'latin1'))), mk('IDAT', new Uint8Array([8, 29, 1, 0, 0, 255, 255, 0, 0, 0, 1])), mk('IEND', new Uint8Array(0))];
    const out = new Uint8Array(parts.reduce((n, a) => n + a.length, 0)); let o = 0; parts.forEach(a => { out.set(a, o); o += a.length; }); return out;
  }
  const big = 'x'.repeat(300000);
  const cardV2 = n => ({ spec: 'chara_card_v2', spec_version: '2.0', data: { name: n, description: 'D', first_mes: 'Hi', alternate_greetings: ['Hi', 'Other'], tags: ['t'], extensions: { forge: { kind: 'scenario', world_bible: 'WB text', user_persona: { name: 'Rowan', description: 'Scout' }, source: null } }, character_book: { entries: [v2Entry(0, ['k'], big.slice(0, 5000))] } } });
  const png2 = pngWith([['chara', cardV2('Old')], ['chara', cardV2('Last')]]);
  const pp = await D.readFile(file('main_card_spec_v2.png', png2, 'image/png'));
  assert.equal(pp.format, 'Character card (PNG)'); const pc = pp.items.find(i => i.kind === 'character').character;
  assert.equal(pc.name, 'Last'); assert.deepEqual(pc.alternateGreetings, ['Other'], 'alternate greeting equal to the opening is dropped');
  assert.equal(pp.items.find(i => i.kind === 'persona').persona.name, 'Rowan'); assert.equal(pp.items.find(i => i.kind === 'world').description, 'WB text');
  const bigCard = cardV2('Huge'); bigCard.data.description = big + big;
  await assert.rejects(() => D.readFile(file('huge.png', pngWith([['chara', bigCard]]), 'image/png')), /longer than 100000/);
  await assert.rejects(() => D.readFile(file('plain.png', pngWith([]), 'image/png')), /No character card data/);
  const flat = { name: 'Flat', description: 'long text', personality: 'bio', first_mes: 'hey', creator_notes: 'n', extensions: {}, tags: [] };
  assert.equal((await D.readFile(file('flat.png', pngWith([['chara', flat]]), 'image/png'))).items[0].character.name, 'Flat');

  // ZIP: stored and deflated entries (Story Forge style pack), ignored extras, bad files.
  const crc = C.crc32;
  function makeZip(entries, deflate) {
    const parts = [], central = []; let offset = 0;
    entries.forEach(([name, content]) => {
      const raw = Buffer.from(content), data = deflate ? zlib.deflateRawSync(raw) : raw, nm = Buffer.from(name);
      const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(deflate ? 8 : 0, 8); lh.writeUInt32LE(crc(new Uint8Array(raw)), 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
      parts.push(lh, nm, data);
      const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(deflate ? 8 : 0, 10); cd.writeUInt32LE(crc(new Uint8Array(raw)), 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(nm.length, 28); cd.writeUInt32LE(offset, 42);
      central.push(cd, nm); offset += 30 + nm.length + data.length;
    });
    const cdBuf = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...parts, cdBuf, end]);
  }
  const entries = [['Pack_World.png', Buffer.from(png2)], ['worldbook.json', JSON.stringify(world)], ['characters.json', JSON.stringify([{ name: 'Abby', role: 'Lead', appearance: 'A', personality: 'B' }])], ['README.txt', 'notes'], ['icons/logo.svg', '<svg/>']];
  for (const deflate of [false, true]) {
    const zp = await D.readFile(file('Pack.zip', makeZip(entries, deflate), 'application/zip'));
    assert.equal(zp.format, 'Zip pack (5 files)'); assert.deepEqual(zp.items.map(i => i.kind).sort(), ['character', 'character', 'lore', 'persona', 'world', 'world'].sort());
    assert.ok(zp.items.every(i => /\((Pack_World\.png|worldbook\.json|characters\.json)\)$/.test(i.label)));
  }
  await assert.rejects(() => D.readFile(file('x.zip', Buffer.from('not a zip at all'), 'application/zip')), /Not a zip/);
  await assert.rejects(() => D.readFile(file('empty.zip', makeZip([['readme.txt', 'x'], ['a.svg', '<svg/>']], false), 'application/zip')), /Nothing Studio can import/);
  // Our own zip writer round-trips through the reader.
  const written = D.zip([{ name: 'a.json', data: '{"x":1}' }, { name: 'b/c.txt', data: 'hello' }]);
  const readBack = await D.unzip(written); assert.deepEqual(readBack.map(f => f.name), ['a.json', 'c.txt']); assert.equal(Buffer.from(readBack[0].bytes).toString(), '{"x":1}');

  // Dad world book / lorebook / pack exports are valid and re-importable.
  const wb = D.toDadWorld(sp); assert.equal(wb.type, 'dad-world'); assert.equal(Object.keys(wb.world.entries).length, 2); assert.equal(wb.world.name, 'Round');
  const lb = D.toDadLorebook(sp, sc); assert.equal(lb.characterName, 'Ayla'); assert.equal(lb.entries.length, 1); assert.ok(lb.character_book.entries.length === 1 && lb.entries[0].exclude_recursion === false);
  assert.equal((await D.readFile(file('lb.json', JSON.stringify(lb)))).items[0].lore.length, 1);
  assert.equal(D.toBibleText(sp), '\n', 'an empty world gives an empty bible');
  sp.world.description = 'A wide land.'; sp.world.rules = 'No magic.'; assert.equal(D.toBibleText(sp), 'A wide land.\n\nNo magic.\n');
  assert.equal(D.chatText(xp, xs), 'Ayla: Hi\n\nUser: Yo\n\nAyla: two\n');
  const pack = await D.unzip(D.exportPack(sp));
  const names = pack.map(f => f.path); assert.ok(names.includes('Ayla.dad-char.json') && names.includes('Ayla_lorebook.json') && names.includes('worldbook.json') && names.includes('bible.txt') && names.includes('Rowan.UserProfile.json') && names.includes('README.txt'));
  assert.equal(JSON.parse(Buffer.from(pack.find(f => f.name === 'Ayla.dad-char.json').bytes).toString()).type, 'dad-char');

  // Decompression bomb: a header that lies about its size cannot get past the real output cap.
  const bomb = makeZip([['bomb.json', Buffer.alloc(70000000, 32)]], true);
  for (let i = 0; i < bomb.length - 4; i++) if (bomb.readUInt32LE(i) === 0x02014b50) { bomb.writeUInt32LE(100, i + 24); break; }
  await assert.rejects(() => D.unzip(new Uint8Array(bomb)), /expands to more than the allowed size|too large/);
  // Persona and world text only travel with an export when the user opts in.
  const priv = C.project('Priv', 'character'); priv.persona = { name: 'PrivateName', description: 'PRIVATE_PERSONA' }; priv.world.description = 'PRIVATE_WORLD';
  assert.doesNotMatch(JSON.stringify(D.toDadChar(priv, priv.characters[0])), /PrivateName|PRIVATE_PERSONA/);
  assert.match(JSON.stringify(D.toDadChar(priv, priv.characters[0], { includePersona: true })), /PRIVATE_PERSONA/);
  assert.doesNotMatch(JSON.stringify(C.toV2Card(priv, priv.characters[0])), /PRIVATE_PERSONA|PRIVATE_WORLD|forge/);
  assert.match(JSON.stringify(C.toV2Card(priv, priv.characters[0], { includeForge: true })), /PRIVATE_PERSONA/);
  assert.match(JSON.stringify(C.toV2Card(priv, priv.characters[0], { includeForge: true })), /PRIVATE_WORLD/);
  assert.doesNotMatch(JSON.stringify(D.toDadChat(Object.assign(priv, { sessions: [C.session(priv, priv.characters[0].id, 'S')] }), priv.sessions[0])), /PRIVATE_PERSONA/);

  // Limits and safety: caps are enforced and nothing runs.
  const many = { type: 'dad-full', config: { characterBook: Object.fromEntries(Array.from({ length: 201 }, (_, i) => ['c' + i, Object.assign(dadChar(), { id: 'c' + i })])) }, threads: {} };
  const manyPlan = await D.readFile(file('many.json', JSON.stringify(many))); assert.equal(manyPlan.items.filter(i => i.kind === 'character').length, 200);
  manyPlan.items.forEach(i => { i.checked = i.kind === 'character'; });
  const crowded = C.project('Crowded', 'character'); assert.throws(() => D.applyPlan(crowded, manyPlan), /maximum|exceed/);
  const evil = dadChar(); evil.name = '<img src=x onerror=alert(1)>'; evil.systemPrompt = '{{user}} </script>';
  const evilPlan = await D.readFile(file('evil.json', JSON.stringify({ type: 'dad-char', version: 2, data: evil })));
  assert.equal(evilPlan.items[0].character.name, '<img src=x onerror=alert(1)>', 'text is kept as data (the UI renders text, never HTML)');
  console.log('Dad Chat interop: detection, characters, chats, lorebooks, world books, personas, scripts, PNG, zip, exports and limits passed');
})().catch(e => { console.error(e); process.exit(1); });
