/* Studio interop for Dad Chat (dad-chat-v2) files: characters, chats, personas, lorebooks, world books,
   Tavern/Chub cards (PNG and JSON), Story Forge packs and full backups. Pure logic: no DOM, network or storage. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./studio-core.js'));
  else root.WeldStudioDad = factory(root.WeldStudioCore);
})(typeof window === 'object' ? window : globalThis, function (C) {
  'use strict';
  const MAX_ENTRY = 60000000, MAX_TOTAL = 100000000;
  const LIMITS = { characters: 200, lore: 1000, sessions: 100, messages: 2000, proposals: 100, text: 100000 };
  const FIELD_SECTIONS = { voice: 'Voice', motivations: 'Goals and fears', boundaries: 'Boundaries', beliefs: 'Beliefs' };
  const str = v => (v == null ? '' : String(v));
  const cap = (v, n) => str(v).slice(0, n || LIMITS.text);
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const obj = v => v && typeof v === 'object' && !Array.isArray(v);
  const values = v => Array.isArray(v) ? v : obj(v) ? Object.values(v) : [];
  const keyArray = k => Array.isArray(k) ? k.map(s => str(s).trim()).filter(Boolean) : typeof k === 'string' ? k.split(',').map(s => s.trim()).filter(Boolean) : [];
  function uniqueId(prefix) { return prefix + C.id().replace(/-/g, '').slice(0, 14); }

  // ---- detection ----
  function detect(raw) {
    if (Array.isArray(raw)) return raw.length && raw.every(x => obj(x) && typeof x.name === 'string' && ('appearance' in x || 'personality' in x || 'role' in x)) ? { kind: 'forge-cast', label: 'Story Forge cast list' } : { kind: 'unknown' };
    if (!obj(raw)) return { kind: 'unknown' };
    if (raw.type === 'dad-char') return { kind: 'dad-char', label: 'Dad Chat character' };
    if (raw.type === 'dad-char-chat') return { kind: 'dad-char-chat', label: 'Dad Chat character and chat' };
    if (raw.type === 'dad-user-profile' || raw.type === 'dad-chat-user-profile') return { kind: 'dad-user-profile', label: 'Dad Chat user profile' };
    if (raw.type === 'dad-world') return { kind: 'dad-world', label: 'Dad Chat world book' };
    if (raw.type === 'dad-full' || (obj(raw.config) && obj(raw.threads))) return { kind: 'dad-full', label: 'Dad Chat full backup' };
    if (raw.format === 'weld-studio') return { kind: 'studio', label: 'Studio project' };
    if (raw.spec === 'chara_card_v2' || raw.spec === 'chara_card_v3') return { kind: 'card', label: 'Character card (' + raw.spec.replace('chara_card_', 'V') + ')' };
    if (Array.isArray(raw.entries)) return { kind: 'lorebook', label: 'Lorebook' };
    if (obj(raw.entries)) return { kind: 'worldinfo', label: 'World Info lorebook' };
    if (obj(raw.character_book) && Array.isArray(raw.character_book.entries)) return { kind: 'lorebook', label: 'Lorebook' };
    if (typeof raw.name === 'string' && (raw.first_mes !== undefined || raw.description !== undefined || raw.personality !== undefined)) return { kind: 'card', label: 'Character card (flat)' };
    return { kind: 'unknown' };
  }

  // ---- lore ----
  function loreFromDad(e) {
    const keys = keyArray(e.keys).concat(keyArray(e.key));
    return C.loreEntry({ title: cap(e.name || e.comment, 2000).trim() || 'Lore entry', kind: 'imported', body: cap(e.content), keywords: [...new Set(keys)].join(', '),
      priority: num(e.priority, 10), activation: e.enabled === false || e.disable === true ? 'manual' : e.constant ? 'always' : 'keywords', recursive: !(e.excludeRecursion || e.exclude_recursion) });
  }
  function loreList(src) { return values(src).filter(obj).slice(0, LIMITS.lore).map(loreFromDad); }

  // ---- examples <-> Tavern <START> blocks ----
  function examplesFromRows(rows) {
    const lines = [];
    values(rows).slice(0, 12).forEach(r => {
      if (!obj(r)) return;
      lines.push('<START>');
      if (str(r.content1).trim()) lines.push('{{user}}: ' + str(r.content1).trim());
      const body = str(r.content2).trim();
      if (body) lines.push(/\n/.test(body) && /(^|\n)[^:\n]{1,40}:/.test(body) ? body : '{{char}}: ' + body);
    });
    return lines.join('\n');
  }
  function rowsFromExamples(text) {
    const rows = [];
    str(text).split(/<START>/i).map(b => b.trim()).filter(Boolean).forEach(block => {
      const user = [], reply = [];
      block.split(/\n/).forEach(line => {
        const m = /^\s*(\{\{user\}\}|<USER>|You|User)\s*:\s*(.*)$/i.exec(line);
        if (m) user.push(m[2]);
        else reply.push(line.replace(/^\s*(\{\{char\}\}|<BOT>)\s*:\s*/i, ''));
      });
      if (user.length || reply.length) rows.push({ name1: 'User', content1: user.join('\n'), name2: 'Character', content2: reply.join('\n').trim() });
    });
    return rows.slice(0, 12);
  }

  // ---- Dad Chat character <-> Studio character ----
  function characterFromDad(d, notes) {
    notes = notes || [];
    if (!obj(d) || typeof d.name !== 'string' || !d.name.trim()) throw new Error('This Dad Chat character has no name.');
    const prof = obj(d.profile) ? d.profile : {};
    const c = C.character(cap(d.name, 500).trim());
    const sections = values(d.customSections).filter(s => obj(s) && (str(s.header).trim() || str(s.content).trim()));
    const named = {};
    const extra = [];
    sections.forEach(s => {
      const field = Object.keys(FIELD_SECTIONS).find(k => FIELD_SECTIONS[k].toLowerCase() === str(s.header).trim().toLowerCase());
      if (field && !named[field]) named[field] = str(s.content); else extra.push('## ' + str(s.header).trim() + '\n' + str(s.content).trim());
    });
    const sheet = [['Appearance', prof.appearance], ['Personality', prof.personality], ['Background', prof.background]].filter(([, v]) => str(v).trim());
    const facts = [str(prof.age).trim() && 'Age: ' + str(prof.age).trim(), str(prof.gender).trim() && 'Gender: ' + str(prof.gender).trim()].filter(Boolean);
    const body = sheet.length + facts.length > 1 ? facts.concat(sheet.map(([k, v]) => k + ': ' + str(v).trim())) : sheet.map(([, v]) => str(v).trim());
    c.personality = cap(body.concat(extra).join('\n\n'));
    Object.keys(named).forEach(k => { c[k] = cap(named[k]); });
    c.creatorNotes = cap(d.description);
    c.systemPrompt = cap([d.preInstruction === 'custom' ? d.preInstructionCustom : '', d.systemPrompt, prof.systemNote].map(str).filter(x => x.trim()).join('\n\n'));
    c.scenario = cap(prof.scenario);
    const greetings = (Array.isArray(d.firstMessage) ? d.firstMessage : [d.firstMessage]).map(str).filter(g => g.trim());
    c.opening = cap(greetings[0] || '');
    c.alternateGreetings = greetings.slice(1, 51).map(g => cap(g));
    c.examples = cap(examplesFromRows(d.exampleDialogue));
    c.postHistory = cap(d.reminderMessage);
    const an = obj(d.authorNote) ? d.authorNote : null;
    if (an && str(an.text).trim()) {
      if (an.enabled !== false) { c.depthPrompt = cap(an.text); c.depthPromptDepth = Math.min(100, Math.max(0, Math.round(num(an.depth, 4)))); }
      else notes.push('"' + c.name + '": the disabled author note was kept in the private notes.');
    }
    c.tags = Array.isArray(d.tags) ? d.tags.map(str).filter(Boolean).join(', ') : cap(d.tags, 2000);
    if (/^https?:\/\//i.test(str(d.avatar))) c.avatar = cap(d.avatar, 2000);
    else if (str(d.avatar)) notes.push('"' + c.name + '": the embedded avatar image is not stored (Studio keeps only an image address).');
    const dropped = ['imagePrefix', 'visualMap', 'chatBackground', 'sceneCast'].filter(k => str(typeof d[k] === 'object' ? JSON.stringify(d[k]) : d[k]).trim());
    if (dropped.length) notes.push('"' + c.name + '": not carried over: ' + dropped.join(', ') + '.');
    const preset = str(d.preInstruction);
    c.notes = cap([preset && preset !== 'custom' && 'Imported Dad Chat preset: ' + preset + '.', an && an.enabled === false && str(an.text).trim() && 'Disabled author note: ' + str(an.text).trim()].filter(Boolean).join('\n'));
    const persona = obj(d.userOverride) && (str(d.userOverride.name).trim() || str(d.userOverride.description).trim()) ? { name: cap(d.userOverride.name, 200), description: cap(d.userOverride.description) } : null;
    return { character: c, lore: loreList(d.lorebook), persona };
  }
  function dadLoreEntries(p, c) {
    const out = {};
    p.lore.filter(l => C.visible(l, c.id)).forEach(l => {
      const id = 'lore_' + l.id.replace(/[^a-z0-9]/gi, '').slice(0, 16);
      const keys = [...new Set(l.keywords.split(',').concat(l.secondaryKeys.split(',')).map(k => k.trim()).filter(Boolean))];
      out[id] = { id, name: l.title, keys, content: l.body, priority: Math.min(100, Math.max(1, Math.round(l.priority) || 10)), constant: l.activation === 'always',
        enabled: l.activation !== 'manual', vectorized: false, excludeRecursion: !l.recursive, scanDepth: null };
    });
    return out;
  }
  // The persona (your name and description) is only written when includePersona is true.
  function toDadChar(p, c, options) {
    const withPersona = !!(options && options.includePersona);
    const rows = rowsFromExamples(c.examples);
    const sections = Object.keys(FIELD_SECTIONS).filter(k => c[k].trim()).map(k => ({ header: FIELD_SECTIONS[k], content: c[k] }));
    return { type: 'dad-char', version: 2, data: {
      id: 'char_studio_' + c.id.replace(/[^a-z0-9]/gi, '').slice(0, 16), name: c.name, avatar: c.avatar || '',
      description: c.creatorNotes || c.personality.replace(/\s+/g, ' ').slice(0, 240), systemPrompt: c.systemPrompt,
      profile: { name: c.name, age: '', gender: '', appearance: '', personality: c.personality, background: '', scenario: c.scenario, systemNote: '' },
      customSections: sections, exampleDialogue: rows,
      firstMessage: [c.opening].concat(c.alternateGreetings).filter(g => g.trim()), reminderMessage: c.postHistory,
      userOverride: { name: withPersona ? p.persona.name : '', description: withPersona ? p.persona.description : '', avatar: null }, preInstruction: c.systemPrompt.trim() ? 'custom' : 'roleplay',
      preInstructionCustom: c.systemPrompt, tags: c.tags.split(',').map(t => t.trim()).filter(Boolean),
      chatBackground: '', bgBlur: '0', bgOpacity: '1', imagePrefix: '', visualMap: '', lorebook: dadLoreEntries(p, c),
      authorNote: { text: c.depthPrompt, depth: c.depthPromptDepth, role: 'system', enabled: !!c.depthPrompt.trim() }, lastModified: Date.now() } };
  }
  function toDadUserProfile(p) {
    return { type: 'dad-user-profile', version: 1, profileLabel: p.persona.name, chatName: p.persona.name, avatar: '', systemPromptContext: p.persona.description };
  }
  function toDadLorebook(p, c) {
    const book = C.toV2Book(p, c);
    const entries = book.entries.map((e, i) => Object.assign({ entry_id: i, vectorized: false, exclude_recursion: false, scan_depth: null, display_index: i }, e, { extensions: {} }));
    return { name: c.name + ' lorebook', description: 'Exported from Weld Studio', characterName: c.name, characterId: c.id, scan_depth: book.scan_depth, token_budget: book.token_budget,
      recursive_scanning: book.recursive_scanning, extensions: {}, entries, character_book: { name: c.name + ' lorebook', description: 'Exported from Weld Studio', entries, extensions: {} } };
  }
  function toDadWorld(p) {
    const entries = {};
    p.lore.forEach(l => {
      const id = 'we_' + l.id.replace(/[^a-z0-9]/gi, '').slice(0, 16);
      entries[id] = { id, name: l.title, keys: l.keywords.split(',').map(k => k.trim()).filter(Boolean), content: l.body, priority: Math.min(100, Math.max(1, Math.round(l.priority) || 10)),
        constant: l.activation === 'always', vectorized: false, enabled: l.activation !== 'manual', excludeRecursion: !l.recursive, scanDepth: null };
    });
    return { type: 'dad-world', version: 1, world: { id: 'world_' + p.id.replace(/[^a-z0-9]/gi, '').slice(0, 16), name: p.name, description: [p.world.description, p.world.rules && 'RULES\n' + p.world.rules].filter(Boolean).join('\n\n'), entries } };
  }
  function toBibleText(p) { return [p.world.description, p.world.rules].filter(x => x.trim()).join('\n\n') + '\n'; }
  function chatText(p, s) {
    const ch = p.characters.find(c => c.id === s.characterId) || { name: 'Character' };
    return s.messages.filter(m => !m.hidden).map(m => (m.role === 'user' ? p.persona.name : ch.name) + ': ' + m.content).join('\n\n') + '\n';
  }
  function toDadChat(p, s, options) {
    const c = p.characters.find(x => x.id === s.characterId);
    if (!c) throw new Error('This playthrough has no character.');
    const nodes = {}, rootId = uniqueId('n');
    nodes[rootId] = { id: rootId, role: 'system-root', content: '', timestamp: new Date().toISOString(), parentId: null, children: [], selectedChild: null };
    let parent = rootId;
    s.messages.forEach(m => {
      const variants = Array.isArray(m.swipes) && m.swipes.length ? m.swipes : [m.content], picked = Array.isArray(m.swipes) ? m.swipeId : 0, ids = [];
      variants.forEach((text, i) => {
        const id = uniqueId('n');
        nodes[id] = { id, role: m.role, displayRole: m.role, content: text, timestamp: new Date().toISOString(), parentId: parent, children: [], selectedChild: null, archived: !!m.hidden, isAnchor: false, customCharId: null, systemType: null };
        ids.push(id); nodes[parent].children.push(id);
      });
      nodes[parent].selectedChild = ids[picked];
      parent = ids[picked];
    });
    const facts = {};
    s.memories.forEach((m, i) => { const id = 'mem_' + Date.now() + '_' + i; facts[id] = { id, type: 'fact', content: m.text, scene: null, keywords: [], confidence: 1, timestamp: new Date().toISOString(), accessCount: 0, relatedCharId: '', originNodeId: '', aiImproved: false }; });
    const char = toDadChar(p, c, options).data;
    return { type: 'dad-char-chat', version: 2, character: char, thread: { id: uniqueId('t'), title: s.name, characterId: char.id, nodes, rootId, created: new Date().toISOString(), smartRenamed: false, draft: '',
      authorNote: { text: p.settings.authorNote, depth: p.settings.authorNoteDepth, role: 'system', enabled: !!p.settings.authorNote.trim() }, memoryStore: { facts, version: 1 }, contextSummary: s.summary } };
  }

  // ---- Dad Chat thread (branching tree) -> flat messages with variants ----
  function threadMessages(thread) {
    if (!obj(thread) || !obj(thread.nodes)) return [];
    const nodes = thread.nodes;
    // Follow the selected branch from the root; alternatives under the same parent become variants.
    const path = [];
    let cursor = thread.rootId && nodes[thread.rootId] ? thread.rootId : Object.keys(nodes).find(k => !nodes[k].parentId);
    const guard = new Set();
    while (cursor && nodes[cursor] && !guard.has(cursor)) {
      guard.add(cursor);
      path.push(nodes[cursor]);
      const kids = values(nodes[cursor].children).filter(k => obj(nodes[k]));
      cursor = kids.includes(nodes[cursor].selectedChild) ? nodes[cursor].selectedChild : kids[kids.length - 1];
    }
    const messages = [];
    path.forEach(node => {
      if (node.role !== 'user' && node.role !== 'assistant') return;
      const parent = nodes[node.parentId], sibs = parent ? values(parent.children).map(k => nodes[k]).filter(n => obj(n) && n.role === node.role) : [node];
      const m = { role: node.role, content: cap(node.content) };
      if (node.archived) m.hidden = true;
      if (sibs.length > 1 && sibs.length <= 50) { m.swipes = sibs.map(n => cap(n.content)); m.swipeId = Math.max(0, sibs.indexOf(node)); }
      messages.push(m);
    });
    return messages;
  }
  function sessionFromThread(thread, character) {
    const messages = threadMessages(thread);
    const memories = values(obj(thread.memoryStore) ? thread.memoryStore.facts : null).filter(f => obj(f) && str(f.content).trim()).slice(0, LIMITS.proposals).map(f => cap(f.content, 2000));
    const ledger = obj(thread.continuityLedger) ? str(thread.continuityLedger.text) : '';
    const summary = cap(str(thread.contextSummary).trim() || ledger.trim(), 20000);
    return { name: cap(thread.title, 200) || (character ? character + ' chat' : 'Imported chat'), messages, memories, summary };
  }

  // ---- text and jsonl chats, bible text ----
  // A speaker label is a short name (up to 3 words, 24 characters) followed by a colon at the start of a paragraph.
  function speakerOf(block) {
    const m = /^([^\n:]{1,24}):\s([\s\S]*)$/.exec(block.trim());
    return m && m[1].trim().split(/\s+/).length <= 3 ? { speaker: m[1].trim(), text: m[2].trim() } : null;
  }
  function fromChatText(raw, userNames) {
    const names = (userNames || ['You', 'User']).map(n => n.toLowerCase());
    const messages = [];
    String(raw).replace(/\r\n/g, '\n').split(/\n{2,}/).forEach(block => {
      const s = speakerOf(block);
      if (s) messages.push({ role: names.includes(s.speaker.toLowerCase()) ? 'user' : 'assistant', content: cap(s.text) });
      else if (messages.length) messages[messages.length - 1].content += '\n\n' + block.trim();
    });
    return messages.slice(-LIMITS.messages);
  }
  // Chat text needs at least two labelled paragraphs and few distinct speakers; prose with the odd colon is not a chat.
  function looksLikeChat(raw) {
    const labelled = String(raw).replace(/\r\n/g, '\n').split(/\n{2,}/).map(speakerOf).filter(Boolean);
    return labelled.length >= 2 && new Set(labelled.map(s => s.speaker.toLowerCase())).size <= 8;
  }

  // Dad Chat user-profile import scripts hold a plain { label, name, text } object; read its string values without running anything.
  function personaFromScript(src) {
    const field = k => { const m = new RegExp('(?:^|[\\s,{])' + k + '\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")').exec(src); if (!m) return null; try { return JSON.parse(m[1]); } catch (e) { return null; } };
    if (!/DadChat user-profile import/i.test(src)) return null;
    const name = field('name') || field('label'), text = field('text');
    return name && text !== null ? { name: cap(name, 200), description: cap(text) } : null;
  }

  // ---- ZIP (stored/deflate reader, stored writer) ----
  const TD = typeof TextDecoder === 'function' ? new TextDecoder('utf-8') : null;
  // Inflate with a hard cap on the real output size: sizes declared in a zip header are not trusted.
  async function inflateRaw(bytes, limit) {
    if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot unpack compressed zip files.');
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(), chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { try { await reader.cancel(); } catch (e) { /* already stopped */ } throw new Error('The zip expands to more than the allowed size.'); }
      chunks.push(value);
    }
    const out = new Uint8Array(size); let o = 0;
    chunks.forEach(c => { out.set(c, o); o += c.length; });
    return out;
  }
  async function unzip(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
    if (end < 0) throw new Error('Not a zip file.');
    const count = view.getUint16(end + 10, true);
    if (count > 200) throw new Error('The zip has more than 200 files.');
    let pos = view.getUint32(end + 16, true), total = 0;
    const files = [];
    for (let i = 0; i < count; i++) {
      if (view.getUint32(pos, true) !== 0x02014b50) throw new Error('Corrupt zip directory.');
      const method = view.getUint16(pos + 10, true), csize = view.getUint32(pos + 20, true), usize = view.getUint32(pos + 24, true);
      const nlen = view.getUint16(pos + 28, true), elen = view.getUint16(pos + 30, true), clen = view.getUint16(pos + 32, true), local = view.getUint32(pos + 42, true);
      const name = TD.decode(bytes.subarray(pos + 46, pos + 46 + nlen));
      pos += 46 + nlen + elen + clen;
      if (name.endsWith('/')) continue;
      if (usize > MAX_ENTRY || total + usize > MAX_TOTAL) throw new Error('The zip is too large to open here.');
      const lnlen = view.getUint16(local + 26, true), lelen = view.getUint16(local + 28, true), start = local + 30 + lnlen + lelen;
      const raw = bytes.subarray(start, start + csize);
      if (method !== 0 && method !== 8) throw new Error('Unsupported zip compression in ' + name + '.');
      const data = method === 0 ? raw : await inflateRaw(raw, Math.min(MAX_ENTRY, MAX_TOTAL - total));
      total += data.length;
      if (total > MAX_TOTAL) throw new Error('The zip is too large to open here.');
      files.push({ name: name.split('/').pop(), path: name, bytes: data });
    }
    return files;
  }
  function zip(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    files.forEach(f => {
      const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = C.crc32(data);
      const local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, name.length, true);
      local.set(name, 30); parts.push(local, data);
      const cd = new Uint8Array(46 + name.length), cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); cd.set(name, 46); central.push(cd);
      offset += local.length + data.length;
    });
    const size = central.reduce((n, a) => n + a.length, 0), endRec = new Uint8Array(22), ev = new DataView(endRec.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, size, true); ev.setUint32(16, offset, true);
    const all = parts.concat(central, [endRec]), out = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
    let o = 0; all.forEach(a => { out.set(a, o); o += a.length; });
    return out;
  }

  // ---- import plans: everything a file would add, shown to the user before anything changes ----
  function newPlan(name, format) { return { name: name || 'Imported project', format: format || '', items: [], notes: [] }; }
  let seq = 0;
  function item(plan, kind, label, detail, payload) { const it = Object.assign({ id: 'i' + (++seq), kind, label, detail, checked: true }, payload); plan.items.push(it); return it; }
  function addCharacter(plan, d, extra) {
    const res = characterFromDad(d, plan.notes);
    const it = item(plan, 'character', res.character.name, [res.lore.length && res.lore.length + ' lore entries', res.character.alternateGreetings.length && res.character.alternateGreetings.length + ' alternate greetings'].filter(Boolean).join(', ') || 'character', { character: res.character, lore: res.lore });
    if (res.persona && !(extra && extra.skipPersona)) item(plan, 'persona', 'Persona "' + (res.persona.name || 'User') + '"', 'from ' + res.character.name, { persona: res.persona, checked: false });
    return it;
  }
  function addLore(plan, entries, label) { if (entries.length) item(plan, 'lore', label, entries.length + ' entries', { lore: entries.slice(0, LIMITS.lore) }); }
  function addSession(plan, session, charItem, userName) {
    item(plan, 'session', 'Chat "' + session.name + '"', session.messages.length + ' messages' + (session.memories.length ? ', ' + session.memories.length + ' memories (as proposals)' : ''), { session, characterRef: charItem ? charItem.id : '', characterName: charItem ? charItem.character.name : '', userName: userName || '' });
  }
  function cardPlan(plan, raw, fileName) {
    const res = C.fromCard(raw), ch = res.character;
    const flat = res.spec === 'v1';
    const extensions = obj(flat ? raw.extensions : raw.data && raw.data.extensions) ? (flat ? raw.extensions : raw.data.extensions) : {};
    const forge = obj(extensions.forge) ? extensions.forge : null;
    item(plan, 'character', ch.name, [res.lore.length && res.lore.length + ' lore entries', ch.alternateGreetings.length && ch.alternateGreetings.length + ' alternate greetings', flat ? 'flat card' : res.spec].filter(Boolean).join(', '), { character: ch, lore: res.lore });
    if (forge && obj(forge.user_persona) && (str(forge.user_persona.name).trim() || str(forge.user_persona.description).trim()))
      item(plan, 'persona', 'Persona "' + str(forge.user_persona.name || 'User') + '"', 'from the card (Forge extension)', { persona: { name: cap(forge.user_persona.name, 200), description: cap(forge.user_persona.description) }, checked: false });
    const bible = typeof forge === 'object' && forge ? (typeof forge.world_bible === 'string' ? forge.world_bible : obj(forge.world_bible) ? str(forge.world_bible.description || forge.world_bible.text || forge.world_bible.content) : '') : '';
    if (bible.trim()) item(plan, 'world', 'World bible', bible.length + ' characters, from the card', { description: cap(bible), checked: false });
    if (!plan.name || plan.name === 'Imported project') plan.name = ch.name + ' project';
  }
  function jsonPlan(plan, raw, fileName) {
    const kind = detect(raw);
    plan.format = kind.label || plan.format;
    switch (kind.kind) {
      case 'dad-char': { plan.name = str(raw.data && raw.data.name) + ' project'; addCharacter(plan, raw.data); break; }
      case 'dad-char-chat': {
        const ch = addCharacter(plan, raw.character); plan.name = ch.character.name + ' project';
        addSession(plan, sessionFromThread(raw.thread, ch.character.name), ch, obj(raw.character.userOverride) ? str(raw.character.userOverride.name) : ''); break;
      }
      case 'dad-user-profile': item(plan, 'persona', 'Persona "' + str(raw.chatName || raw.profileLabel || 'User') + '"', 'user profile', { persona: { name: cap(raw.chatName || raw.profileLabel || 'User', 200), description: cap(raw.systemPromptContext) }, checked: true }); break;
      case 'dad-world': {
        const w = obj(raw.world) ? raw.world : {};
        plan.name = str(w.name) || plan.name;
        if (str(w.description).trim()) item(plan, 'world', 'World "' + str(w.name) + '"', 'description', { description: cap(w.description), checked: true });
        addLore(plan, loreList(w.entries), 'World book entries'); break;
      }
      case 'dad-full': {
        const cfg = raw.config, book = values(cfg.characterBook).filter(c => obj(c) && typeof c.name === 'string');
        const idMap = {};
        book.slice(0, LIMITS.characters).forEach(d => { const it = addCharacter(plan, d, { skipPersona: true }); it.checked = !/^char_preset_/.test(str(d.id)); idMap[str(d.id)] = it; if (!it.checked) it.detail += ' (built-in preset)'; });
        values(obj(cfg.worldBook) ? cfg.worldBook.worlds : null).filter(obj).forEach(w => {
          const entries = loreList(w.entries);
          if (str(w.description).trim()) item(plan, 'world', 'World "' + str(w.name) + '"', 'description', { description: cap(w.description), checked: false });
          if (entries.length) item(plan, 'lore', 'World "' + str(w.name) + '" entries', entries.length + ' entries', { lore: entries, checked: false });
        });
        const gu = obj(cfg.globalUser) ? cfg.globalUser : {};
        values(gu.profiles).filter(obj).forEach(pr => item(plan, 'persona', 'Persona "' + str(pr.name || pr.label) + '"', 'saved profile', { persona: { name: cap(pr.name || pr.label, 200), description: cap(pr.text) }, checked: false }));
        values(raw.threads).filter(obj).slice(0, LIMITS.sessions).forEach(t => {
          const ref = idMap[str(t.characterId)];
          const s = sessionFromThread(t, ref && ref.character.name); if (!s.messages.length) return;
          addSession(plan, s, ref, ''); plan.items[plan.items.length - 1].checked = false;
        });
        plan.notes.push('Full backups list everything; characters are selected by default and chats, worlds and personas are not.');
        plan.name = 'Dad Chat import'; break;
      }
      case 'lorebook': {
        const entries = loreList(raw.entries && raw.entries.length ? raw.entries : raw.character_book && raw.character_book.entries);
        plan.name = str(raw.name || raw.characterName) || plan.name; addLore(plan, entries, 'Lorebook "' + str(raw.name || raw.characterName) + '"'); break;
      }
      case 'worldinfo': plan.name = str(raw.name) || plan.name; addLore(plan, C.fromWorldInfo(raw), 'World Info "' + str(raw.name) + '"'); break;
      case 'card': cardPlan(plan, raw, fileName); break;
      case 'forge-cast': raw.slice(0, LIMITS.characters).forEach(m => {
        const c = C.character(cap(m.name, 500));
        c.personality = cap([m.role && 'Role: ' + str(m.role), m.appearance && 'Appearance: ' + str(m.appearance), m.personality && 'Personality: ' + str(m.personality), m.background && 'Background: ' + str(m.background), m.relationships && 'Relationships: ' + str(m.relationships), values(m.aliases).length && 'Also known as: ' + values(m.aliases).map(str).join(', ')].filter(Boolean).join('\n\n'));
        c.scenario = cap(m.scenario); c.postHistory = cap(m.systemNote); c.opening = cap(m.firstMessage);
        c.examples = values(m.quotes).filter(q => str(q).trim()).slice(0, 12).map(q => '<START>\n{{char}}: ' + str(q).trim()).join('\n');
        c.tags = values(m.tags).map(str).join(', ');
        item(plan, 'character', c.name, 'Story Forge cast member', { character: c, lore: [] });
      }); break;
      case 'studio': plan.notes.push('This is a Studio project bundle. Use "Preview project import" in Export & snapshots to import it.'); break;
      default: throw new Error('This file is not a format Studio recognizes. Expected a Dad Chat export, a character card, a lorebook or a chat.');
    }
  }
  async function readFile(file, options) {
    const opts = options || {}, name = str(file.name), lower = name.toLowerCase(), plan = newPlan(name.replace(/\.[^.]+$/, ''));
    const apply = async (f, sub) => {
      const n = str(f.name).toLowerCase();
      if (n.endsWith('.png') || f.type === 'image/png') {
        const buf = f.bytes || new Uint8Array(await f.arrayBuffer());
        cardPlan(sub, C.pngReadCard(buf).card, f.name); sub.format = 'Character card (PNG)';
      } else if (n.endsWith('.jsonl')) {
        const res = C.fromChatJsonl(typeof f.text === 'function' ? await f.text() : TD.decode(f.bytes));
        item(sub, 'session', 'Chat "' + str(f.name).replace(/\.[^.]+$/, '') + '"', res.messages.length + ' messages', { session: { name: str(f.name).replace(/\.[^.]+$/, ''), messages: res.messages, memories: [], summary: '' }, characterRef: '', characterName: res.characterName, userName: res.userName });
        sub.format = 'Chat log (JSONL)';
      } else if (n.endsWith('.txt') || n.endsWith('.md') || f.type === 'text/plain') {
        const t = typeof f.text === 'function' ? await f.text() : TD.decode(f.bytes);
        if (t.length > 5000000) throw new Error('Text file exceeds 5 MB.');
        if (looksLikeChat(t)) { const m = fromChatText(t, opts.userNames); item(sub, 'session', 'Chat "' + str(f.name).replace(/\.[^.]+$/, '') + '"', m.length + ' messages (from text)', { session: { name: str(f.name).replace(/\.[^.]+$/, ''), messages: m, memories: [], summary: '' }, characterRef: '', characterName: '', userName: '' }); sub.format = 'Chat text'; }
        else { item(sub, 'world', 'World bible "' + str(f.name).replace(/\.[^.]+$/, '') + '"', t.length + ' characters', { description: cap(t.trim()), checked: true }); sub.format = 'World bible text'; }
      } else if (n.endsWith('.js')) {
        const t = typeof f.text === 'function' ? await f.text() : TD.decode(f.bytes);
        const persona = personaFromScript(t);
        if (!persona) throw new Error('This script is not a Dad Chat user-profile import script.');
        item(sub, 'persona', 'Persona "' + persona.name + '"', 'from a Dad Chat import script', { persona, checked: true }); sub.format = 'Dad Chat user-profile script';
      } else {
        const t = typeof f.text === 'function' ? await f.text() : TD.decode(f.bytes);
        if (t.length > 60000000) throw new Error('JSON file exceeds 60 MB.');
        let json; try { json = JSON.parse(t); } catch (e) { throw new Error(str(f.name) + ' is not valid JSON.'); }
        jsonPlan(sub, json, f.name);
      }
    };
    if (lower.endsWith('.zip') || file.type === 'application/zip') {
      const files = await unzip(new Uint8Array(await file.arrayBuffer()));
      plan.format = 'Zip pack (' + files.length + ' files)';
      for (const f of files) {
        if (/readme/i.test(f.name) || !/\.(json|jsonl|png|txt|md|js)$/i.test(f.name)) continue;
        const sub = newPlan(plan.name);
        try { await apply(f, sub); } catch (e) { plan.notes.push(f.name + ': ' + e.message); continue; }
        sub.items.forEach(it => { it.label = it.label + ' (' + f.name + ')'; plan.items.push(it); });
        sub.notes.forEach(n => plan.notes.push(n));
        if (sub.name && sub.name !== plan.name && /\.json$/i.test(f.name) === false) plan.name = sub.name;
      }
      if (!plan.items.length) throw new Error('Nothing Studio can import was found in this zip.');
    } else {
      await apply(file, plan);
    }
    if (!plan.items.length) throw new Error('Nothing importable was found in this file.');
    return plan;
  }

  // Apply the checked items of a plan to a project (mutates it). Returns a short summary string.
  function applyPlan(p, plan) {
    const made = new Map(), counts = { characters: 0, lore: 0, personas: 0, worlds: 0, chats: 0 };
    const chosen = plan.items.filter(i => i.checked);
    if (!chosen.length) throw new Error('Nothing is selected to import.');
    chosen.filter(i => i.kind === 'character').forEach(i => {
      if (p.characters.length >= LIMITS.characters) throw new Error('The project already has the maximum of ' + LIMITS.characters + ' characters.');
      if (p.lore.length + i.lore.length > LIMITS.lore) throw new Error('The project would exceed ' + LIMITS.lore + ' lore entries.');
      const c = C.copy(i.character); c.id = C.id(); p.characters.push(c); made.set(i.id, c); counts.characters++;
      i.lore.forEach(l => { const e = C.copy(l); e.id = C.id(); p.lore.push(e); counts.lore++; });
    });
    chosen.filter(i => i.kind === 'lore').forEach(i => {
      if (p.lore.length + i.lore.length > LIMITS.lore) throw new Error('The project would exceed ' + LIMITS.lore + ' lore entries.');
      i.lore.forEach(l => { const e = C.copy(l); e.id = C.id(); p.lore.push(e); counts.lore++; });
    });
    chosen.filter(i => i.kind === 'persona').slice(-1).forEach(i => { p.persona = { name: i.persona.name || 'User', description: i.persona.description }; counts.personas++; });
    chosen.filter(i => i.kind === 'world').forEach(i => {
      p.world.description = p.world.description.trim() ? p.world.description.replace(/\s+$/, '') + '\n\n' + i.description : i.description; counts.worlds++;
    });
    chosen.filter(i => i.kind === 'session').forEach(i => {
      if (p.sessions.length >= LIMITS.sessions) throw new Error('The project already has the maximum of ' + LIMITS.sessions + ' playthroughs.');
      const c = made.get(i.characterRef) || p.characters.find(x => i.characterName && x.name.toLowerCase() === i.characterName.toLowerCase()) || p.characters[0];
      if (!c) throw new Error('Add a character before importing a chat.');
      const s = C.session(p, c.id, i.session.name); s.messages = i.session.messages.slice(-LIMITS.messages).map(m => C.copy(m)); s.summary = i.session.summary || '';
      s.proposals = (i.session.memories || []).slice(0, LIMITS.proposals).map(t => ({ id: C.id(), text: t }));
      p.sessions.push(s); counts.chats++;
      if (i.userName && p.persona.name === 'User' && !p.persona.description) p.persona.name = i.userName;
    });
    C.validate(p);
    const parts = [counts.characters && counts.characters + ' character(s)', counts.lore && counts.lore + ' lore entries', counts.worlds && 'world text', counts.personas && 'persona', counts.chats && counts.chats + ' chat(s)'].filter(Boolean);
    return 'Imported ' + parts.join(', ') + '.';
  }

  // ---- export pack ----
  function exportPack(p) {
    const safe = s => str(s).replace(/[^a-z0-9._-]+/gi, '_').slice(0, 60) || 'item';
    const files = [{ name: 'README.txt', data: 'Exported from Weld Studio (' + p.name + ').\nFiles: *.dad-char.json (Dad Chat characters), *_lorebook.json, worldbook.json (dad-world), bible.txt, *.UserProfile.json, chats/*.txt.\n' }];
    p.characters.forEach(c => {
      files.push({ name: safe(c.name) + '.dad-char.json', data: JSON.stringify(toDadChar(p, c, { includePersona: true }), null, 2) });
      if (p.lore.some(l => C.visible(l, c.id))) files.push({ name: safe(c.name) + '_lorebook.json', data: JSON.stringify(toDadLorebook(p, c), null, 2) });
    });
    if (p.lore.length) files.push({ name: 'worldbook.json', data: JSON.stringify(toDadWorld(p), null, 2) });
    if (p.world.description.trim() || p.world.rules.trim()) files.push({ name: 'bible.txt', data: toBibleText(p) });
    files.push({ name: safe(p.persona.name) + '.UserProfile.json', data: JSON.stringify(toDadUserProfile(p), null, 2) });
    p.sessions.forEach((s, i) => files.push({ name: 'chats/' + (i + 1) + '_' + safe(s.name) + '.txt', data: chatText(p, s) }));
    return zip(files);
  }

  return { detect, characterFromDad, toDadChar, toDadUserProfile, toDadLorebook, toDadWorld, toDadChat, toBibleText, chatText, threadMessages, sessionFromThread,
    fromChatText, looksLikeChat, unzip, zip, readFile, applyPlan, exportPack, examplesFromRows, rowsFromExamples, LIMITS };
});
