/* Backup Manager core: read-only inventory, record inspection and export bundles for generator backup copies.
   The companion is a storekeeper, not an owner: nothing here rewrites, moves or repairs a record. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WeldBackupCore = factory();
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const GEN_RE = /^[a-z0-9-]{1,64}$/;
  const MAX_VALUE_BYTES = 2 * 1024 * 1024;       // values are documented as "up to ~2MB"
  const MAX_CHAT_COPIES = 10;                     // documented per-generator cap
  const SECRET_NAME = /api[-_ ]?key|secret|token|webhook/i;
  const PREFIX = 'weld:genvault:';
  const LEGACY_PREFIX = 'dadchat:vault:';
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
  const atOf = x => isObj(x) ? (num(x.at) || 0) : 0;   // a record's numeric timestamp, or 0
  const text = (v, max) => typeof v === 'string' ? v.slice(0, max || 120) : '';

  // key -> { kind, gen, sub }. kind: snapshot | chat-index | chat-copy | legacy | operational | other
  function parseKey(key) {
    key = String(key == null ? '' : key);
    if (key.indexOf(PREFIX) === 0) {
      const rest = key.slice(PREFIX.length), slash = rest.indexOf('/');
      if (slash > 0) {
        const gen = rest.slice(0, slash), sub = rest.slice(slash + 1);
        if (GEN_RE.test(gen)) {
          if (sub === 'snapshot') return { kind: 'snapshot', gen, sub };
          if (sub === 'chat/index') return { kind: 'chat-index', gen, sub };
          if (/^chat\/snap-[^/]+$/.test(sub)) return { kind: 'chat-copy', gen, sub };
          return { kind: 'other', gen, sub };
        }
      }
      return { kind: 'other', gen: '', sub: rest };
    }
    if (key === 'dadchat:vault:index' || key.indexOf(LEGACY_PREFIX) === 0) return { kind: 'legacy', gen: '', sub: key.slice(LEGACY_PREFIX.length) };
    if (key === 'weld:link-record' || key.indexOf('weld:selftest:') === 0) return { kind: 'operational', gen: '', sub: key };
    return { kind: 'other', gen: '', sub: key };
  }
  // Is this stored key part of the backup domain at all?
  const inScope = key => { const k = parseKey(key).kind; return k !== 'other' || String(key).indexOf(PREFIX) === 0; };

  // Which generator-copy shape is this? Both shapes are valid; unknown shapes are only flagged.
  function snapshotShape(r) {
    if (!isObj(r)) return 'unknown';
    if (isObj(r.bundle) && typeof r.bundle.code === 'string') return 'bundle';
    if (r.bundle === null && isObj(r.source) && r.source.truncated === true) return 'bundle-pointer';   // over the size cap: only the re-fetch pointer was kept
    if (typeof r.modelText === 'string' || typeof r.outputTemplate === 'string') return 'model-text';
    return 'unknown';
  }
  const COMMON = ['v', 'at', 'protocol', 'generator', 'folder', 'savedBy'];
  const CHAT_REQUIRED = COMMON.concat(['name', 'kind', 'size', 'data']);   // `redacted` is optional (siblings may omit it)
  function missingFields(record, kind, shape) {
    if (!isObj(record)) return ['(not an object)'];
    let need = COMMON;
    if (kind === 'chat-copy') need = CHAT_REQUIRED;
    else if (kind === 'snapshot') need = COMMON.concat(['title']).concat(shape === 'bundle' ? ['bundle'] : (shape === 'model-text' || shape === 'bundle-pointer') ? [] : ['bundle|modelText']);
    return need.filter(f => record[f] === undefined || record[f] === null);
  }

  function indexRefs(index) {
    const list = Array.isArray(index) ? index : isObj(index) ? (Array.isArray(index.entries) ? index.entries : Array.isArray(index.items) ? index.items : Array.isArray(index.list) ? index.list : null) : null;
    if (!list) return null;
    const refs = [];
    list.forEach(e => {
      const id = typeof e === 'string' ? e : isObj(e) ? (typeof e.key === 'string' ? e.key : typeof e.id === 'string' ? e.id : '') : '';
      if (id) refs.push(id);
    });
    return refs;
  }
  const refToKey = (gen, ref) => ref.indexOf(PREFIX) === 0 ? ref : PREFIX + gen + '/' + (ref.indexOf('chat/') === 0 ? ref : 'chat/' + ref);

  function chatSummary(data) {
    const out = { threads: [], characters: [], configKeys: [] };
    if (!isObj(data)) return out;
    const threads = Array.isArray(data.threads) ? data.threads : isObj(data.threads) ? Object.keys(data.threads).map(k => Object.assign({ id: k }, isObj(data.threads[k]) ? data.threads[k] : {})) : [];
    const chars = new Set();
    threads.forEach(t => {
      if (!isObj(t)) return;
      const msgs = Array.isArray(t.messages) ? t.messages.length : (num(t.messageCount) || 0);
      out.threads.push({ title: text(t.title || t.name || t.id || '(untitled)'), messages: msgs });
      const c = t.characterName || (isObj(t.character) && t.character.name) || (isObj(t.char) && t.char.name);
      if (typeof c === 'string' && c) chars.add(text(c, 80));
    });
    const cfg = isObj(data.config) ? data.config : {};
    const cc = cfg.characters;
    (Array.isArray(cc) ? cc : isObj(cc) ? Object.keys(cc).map(k => cc[k]) : []).forEach(c => { const n = isObj(c) ? c.name : null; if (typeof n === 'string' && n) chars.add(text(n, 80)); });
    out.characters = Array.from(chars);
    out.configKeys = Object.keys(cfg);     // names only, never values
    return out;
  }

  // Plaintext secret-shaped config values -> [{ path }]. Values never leave this function.
  function secretScan(data) {
    const hits = [];
    (function walk(v, path, depth) {
      if (depth > 8 || v === null || typeof v !== 'object') return;
      Object.keys(v).forEach(k => {
        const val = v[k], p = path ? path + '.' + k : k;
        if (SECRET_NAME.test(k) && typeof val === 'string' && val.trim() && val !== '[redacted]') hits.push({ path: p });
        else walk(val, p, depth + 1);
      });
    })(isObj(data) && isObj(data.config) ? data.config : {}, 'config', 0);
    return hits;
  }

  /* Inspect one record. `rec` is { key, raw (string or null), size, value, parseError, stale }.
     `siblings` is the list of every in-scope key (strings) plus a getter for the generator's chat index, so
     index <-> copy consistency can be reported. Nothing is changed. */
  function inspect(rec, ctx) {
    ctx = ctx || {};
    const p = parseKey(rec.key), v = rec.value, anomalies = [], meta = [];
    const add = (label, value) => { if (value !== undefined && value !== null && value !== '') meta.push([label, String(value)]); };
    add('Key', rec.key); add('Stored by', rec.caller); add('Size', fmtBytes(rec.size));
    let shape = null, sum = null;
    if (rec.stale) anomalies.push('Stale: the key is listed but its value is null (set to null by a generator). Left in place.');
    else if (rec.parseError) anomalies.push('Value is not valid JSON, so it cannot be inspected.');
    else if (isObj(v)) {
      add('Generator', v.generator); add('Folder', v.folder); add('Saved by', v.savedBy); add('Saved', fmtDate(v.at)); add('Protocol', v.protocol);
      if (p.kind === 'chat-copy') {
        add('Kind', v.kind); add('Name', text(v.name)); add('Redacted fields', v.redacted === undefined ? '(not reported)' : v.redacted);
        sum = chatSummary(v.data);
        add('Threads', sum.threads.length); add('Messages', sum.threads.reduce((a, t) => a + t.messages, 0)); add('Characters', sum.characters.length);
        shape = isObj(v.data) && v.data.threads !== undefined ? 'chat-copy' : 'unknown';
      } else if (p.kind === 'snapshot') {
        shape = snapshotShape(v); add('Shape', shape); add('Title', text(v.title));
        if (shape === 'bundle') { add('Bundle', text(v.bundle.name)); add('Imports', Array.isArray(v.bundle.imports) ? v.bundle.imports.length : ''); }
        if (isObj(v.source)) {
          add('Source bytes', v.source.bytes); add('Fetched', fmtDate(v.source.fetchedAt));
          add('Truncated', v.source.truncated === true ? 'yes' + (v.source.reason ? ' (' + text(v.source.reason) + ')' : '') : v.source.truncated === false ? 'no' : '(not reported)');
          add('Coverage', text(v.source.coverage, 200));
        }
        if (shape === 'bundle-pointer') add('Bundle', 'not stored (truncated); re-fetch from ' + text(isObj(v.source) ? v.source.apiUrl : '', 160));
        if (shape === 'model-text') add('Lists text', (v.modelText || '').length + ' chars');
      }
      const miss = (p.kind === 'chat-copy' || p.kind === 'snapshot') ? missingFields(v, p.kind, shape) : [];
      if (miss.length) anomalies.push('Missing expected fields: ' + miss.join(', ') + '.');
      if ((p.kind === 'chat-copy' || p.kind === 'snapshot') && shape === 'unknown') anomalies.push('Unknown record shape (neither a known generator copy nor chat copy).');
      if (p.gen && typeof v.generator === 'string' && v.generator && v.generator !== p.gen) anomalies.push('Owner mismatch: the key belongs to "' + p.gen + '" but the record says generator "' + v.generator + '".');
      // the folder may name the generator or a sub-folder of it (for example .../chat/)
      if (p.gen && typeof v.folder === 'string' && v.folder && v.folder !== p.gen && v.folder !== PREFIX + p.gen && v.folder.indexOf(PREFIX + p.gen + '/') !== 0) anomalies.push('Folder field "' + text(v.folder) + '" does not match the key owner "' + p.gen + '".');
    } else if (!rec.parseError && p.kind !== 'legacy' && p.kind !== 'operational' && p.kind !== 'chat-index' && p.kind !== 'other') anomalies.push('Unknown record shape: expected an object.');
    if (rec.size > MAX_VALUE_BYTES) anomalies.push('Oversized value: ' + fmtBytes(rec.size) + ' is over the ~2 MB limit.');
    if (p.kind === 'other' && p.gen === '' && String(rec.key).indexOf(PREFIX) === 0) anomalies.push('Key is under the vault prefix but its generator folder name is invalid.');
    if (p.kind === 'chat-index' && !rec.stale && !rec.parseError) {
      const refs = indexRefs(v);
      if (refs === null) anomalies.push('Index shape not recognized, so its entries could not be checked.');
      else {
        const have = new Set(ctx.keys || []);
        const dangling = refs.filter(r => !have.has(refToKey(p.gen, r)));
        if (dangling.length) anomalies.push(dangling.length + ' index entr' + (dangling.length === 1 ? 'y points' : 'ies point') + ' at missing keys: ' + dangling.slice(0, 5).join(', ') + (dangling.length > 5 ? ', ...' : '') + '. Index cleanup is the generator\'s job.');
        meta.push(['Index entries', String(refs.length)]);
      }
    }
    if (p.kind === 'chat-copy' && ctx.index !== undefined) {
      const refs = indexRefs(ctx.index);
      if (refs && !refs.some(r => refToKey(p.gen, r) === rec.key)) anomalies.push('This copy is not listed in its generator\'s chat index.');
    }
    return { kind: p.kind, gen: p.gen, shape, meta, anomalies, chat: sum };
  }

  // Inventory rows come from the host: [{ key, caller, size, stale, parseError, at }]
  function buildInventory(rows) {
    const gens = new Map(), legacy = [], operational = [], other = [];
    (rows || []).forEach(r => {
      const p = parseKey(r.key);
      if (p.kind === 'legacy') return legacy.push(r);
      if (p.kind === 'operational') return operational.push(r);
      if (!p.gen) return other.push(r);
      let g = gens.get(p.gen);
      if (!g) gens.set(p.gen, g = { gen: p.gen, snapshot: null, chats: 0, chatIndex: null, bytes: 0, newest: null, oldest: null, stale: 0, keys: [] });
      g.keys.push(r); g.bytes += r.size || 0; if (r.stale) g.stale++;
      if (p.kind === 'snapshot') g.snapshot = r;
      else if (p.kind === 'chat-index') g.chatIndex = r;
      else if (p.kind === 'chat-copy' && !r.stale) g.chats++;
      if (num(r.at) !== null && !r.stale) { g.newest = g.newest === null ? r.at : Math.max(g.newest, r.at); g.oldest = g.oldest === null ? r.at : Math.min(g.oldest, r.at); }
    });
    const list = Array.from(gens.values()).sort((a, b) => a.gen < b.gen ? -1 : 1);
    list.forEach(g => { if (g.chats > MAX_CHAT_COPIES) g.overCap = true; g.keys.sort((a, b) => a.key < b.key ? -1 : 1); });
    const bytes = list.reduce((a, g) => a + g.bytes, 0) + [legacy, operational, other].reduce((a, l) => a + l.reduce((s, r) => s + (r.size || 0), 0), 0);
    return { generators: list, legacy, operational, other, bytes, count: (rows || []).length };
  }

  function fmtBytes(n) { n = Number(n) || 0; return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB'; }
  function fmtDate(t) { const n = num(t); if (n === null || n <= 0) return ''; try { return new Date(n).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'; } catch (e) { return ''; } }
  const slugPart = s => String(s || 'unknown').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'unknown';
  const keyTail = k => slugPart(String(k).slice(String(k).lastIndexOf('/') + 1).replace(/^.*:/, ''));   // storage key -> slugged filename tail
  const datePart = t => { try { return new Date(t).toISOString().slice(0, 10); } catch (e) { return 'undated'; } };

  // Export bundles. Values are copied exactly as stored; owner identity stays in the key and filename.
  function entryFor(rec) { return { key: rec.key, storedBy: rec.caller, size: rec.size, stale: !!rec.stale, value: rec.value === undefined ? null : rec.value }; }
  function exportRecord(rec, now) {
    const p = parseKey(rec.key), who = p.gen || (p.kind === 'legacy' ? 'legacy' : 'misc');
    const tail = keyTail(rec.key);
    return { filename: 'weld-backup-' + slugPart(who) + '-' + (p.kind === 'snapshot' ? 'snapshot' : tail) + '-' + datePart(now) + '.json',
      text: JSON.stringify({ format: 'weld-backup-record', v: 1, exportedAt: now, record: entryFor(rec) }, null, 2) };
  }
  function exportBundle(label, recs, now) {
    return { filename: 'weld-backup-' + slugPart(label) + '-' + datePart(now) + '.json',
      text: JSON.stringify({ format: 'weld-backup-bundle', v: 1, exportedAt: now, scope: label, count: recs.length, records: recs.map(entryFor) }, null, 2) };
  }

  // ---- bus envelopes (dad:genvault, dad-chat:presence): validate before relaying or displaying
  const BUS_MAX_CHARS = 2048, PRESENCE_TTL_MS = 60000, PRESENCE_SKEW_MS = 5 * 60000;
  const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
  function serializedLength(m) { try { return JSON.stringify(m).length; } catch (e) { return Infinity; } }
  // -> { ok:true } | { ok:false, reason }. Channels without a rule are not judged here (relayed as before).
  function validateEnvelope(channel, m, now) {
    now = now == null ? Date.now() : now;
    if (channel !== 'dad:genvault' && channel !== 'dad-chat:presence') return { ok: true, known: false };
    if (!isObj(m)) return { ok: false, reason: 'not-an-object' };
    if (serializedLength(m) > BUS_MAX_CHARS) return { ok: false, reason: 'too-large' };
    if (m.v !== 1) return { ok: false, reason: 'bad-version' };
    if (channel === 'dad:genvault') {
      if (m.type !== 'vault-updated') return { ok: false, reason: 'unknown-type' };
      if (!str(m.generator, 64)) return { ok: false, reason: 'bad-generator' };
      if (num(m.at) === null) return { ok: false, reason: 'bad-time' };
      if (m.from !== undefined && !str(m.from, 64)) return { ok: false, reason: 'bad-from' };
      return { ok: true, known: true };
    }
    if (m.type !== 'presence' && m.type !== 'presence-bye') return { ok: false, reason: 'unknown-type' };
    if (!str(m.from, 64)) return { ok: false, reason: 'bad-from' };
    if (!str(m.id, 96)) return { ok: false, reason: 'bad-id' };
    if (typeof m.gen !== 'string' || m.gen.length > 64) return { ok: false, reason: 'bad-gen' };
    if (num(m.at) === null || Math.abs(now - m.at) > PRESENCE_SKEW_MS) return { ok: false, reason: 'bad-time' };
    return { ok: true, known: true };
  }
  // Counts live tabs per generator tag from validated presence beats. Observes only; never publishes or synthesizes.
  function presenceTracker() {
    const tabs = new Map(), lastId = new Map();   // gen -> Map(from -> lastAt); from -> last id
    let ignored = 0;
    function observe(m, now) {
      now = now == null ? Date.now() : now;
      if (!validateEnvelope('dad-chat:presence', m, now).ok) { ignored++; return false; }
      if (lastId.get(m.from) === m.id) { ignored++; return false; }   // duplicate id
      lastId.set(m.from, m.id);
      const gen = text(m.gen, 64) || '(unknown)';
      if (m.type === 'presence-bye') { tabs.forEach(t => t.delete(m.from)); return true; }
      let t = tabs.get(gen); if (!t) tabs.set(gen, t = new Map());
      t.set(m.from, now); return true;
    }
    function snapshot(now) {
      now = now == null ? Date.now() : now;
      const out = {};
      tabs.forEach((t, gen) => { t.forEach((at, from) => { if (now - at > PRESENCE_TTL_MS) t.delete(from); }); if (t.size) out[gen] = t.size; });
      return { tabs: out, ignored };
    }
    return { observe, snapshot, countIgnored: () => { ignored++; } };
  }
  // Storage writes: refuse a vault record that names a different owner than its key. Null tombstones pass.
  function checkStoreWrite(key, value) {
    if (typeof key !== 'string' || !key || key.length > 512) return { ok: false, reason: 'bad-key' };
    const p = parseKey(key);
    if (p.gen && isObj(value) && typeof value.generator === 'string' && value.generator !== p.gen) return { ok: false, reason: 'owner-mismatch' };
    return { ok: true };
  }

  // ---- backup folder layout. Names are derived from the content/time so a file is never rewritten:
  // a changed record gets a NEW file, an unchanged one is skipped.
  function hash8(t) { let h = 5381; t = String(t); for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0; return ('00000000' + h.toString(16)).slice(-8); }
  const stampPart = t => { const n = num(t); if (n === null || n <= 0) return ''; try { return new Date(n).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15); } catch (e) { return ''; } };
  // rec: { key, value } -> { dir: [segments], name }
  function backupTarget(rec) {
    const p = parseKey(rec.key), v = rec.value, body = JSON.stringify(v === undefined ? null : v), at = isObj(v) ? stampPart(v.at) : '';
    const tail = keyTail(rec.key);
    if (p.kind === 'snapshot') return { dir: [p.gen, 'snapshot'], name: 'snapshot-' + (at || hash8(body)) + '-' + hash8(body).slice(0, 4) + '.json' };
    if (p.kind === 'chat-copy') return { dir: [p.gen, 'chat'], name: tail + '.json' };
    if (p.kind === 'chat-index') return { dir: [p.gen, 'chat'], name: 'index-' + hash8(body) + '.json' };
    if (p.gen) return { dir: [p.gen, 'other'], name: slugPart(p.sub) + '-' + hash8(body) + '.json' };
    return { dir: [p.kind === 'legacy' ? '_legacy' : p.kind === 'operational' ? '_operational' : '_other'], name: slugPart(p.sub || rec.key) + '-' + hash8(body) + '.json' };
  }
  const isVaultUpdate = m => isObj(m) && m.type === 'vault-updated';

  // ---- cleanup: find duplicate copies. recs: [{ key, caller, value }]. Pure; deletes nothing.
  // exact: byte-identical content (compared in full, not by hash alone) -> keep the newest, offer the rest.
  // near: same generator, same thread and message counts, different content -> only for a human or the AI helper to judge.
  // Copies holding secret-shaped values are left out entirely: they are never copied to a folder, so they must not be deleted here.
  function canonical(v, depth) {
    depth = depth || 0;
    if (depth > 300) throw new Error('Value nested too deeply to compare.');   // real backups nest a handful deep; this only trips a crafted/corrupt value, well before a stack overflow
    if (Array.isArray(v)) return '[' + v.map(x => canonical(x, depth + 1)).join(',') + ']';
    if (isObj(v)) return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k], depth + 1)).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  function findDuplicates(recs) {
    const out = { exact: [], near: [], left: 0, skipped: 0 };
    const buckets = new Map();   // gen|kind|content hash -> [{ rec, body }]
    (recs || []).forEach(rec => {
      const p = parseKey(rec.key), v = rec.value;
      if (!p.gen || !isObj(v) || (p.kind !== 'chat-copy' && p.kind !== 'snapshot')) return;
      if (p.kind === 'chat-copy' && secretScan(v.data).length) { out.left++; return; }
      // what the copy IS, not when or why it was taken
      let body;
      try { body = canonical(p.kind === 'chat-copy' ? v.data : { bundle: v.bundle, modelText: v.modelText, outputTemplate: v.outputTemplate, srcManifest: v.srcManifest }); }
      catch (e) { out.skipped++; return; }   // surfaced via out.skipped (this module never logs content); fail safe: an uncomparable copy is never a duplicate, so it is never offered for deletion
      const id = p.gen + '|' + p.kind + '|' + hash8(body) + '|' + body.length;
      let b = buckets.get(id); if (!b) buckets.set(id, b = []);
      b.push({ rec, p, body, at: atOf(v) });
    });
    const newest = (a, b) => b.at - a.at || (a.rec.key < b.rec.key ? 1 : -1);
    const singles = new Map();   // gen -> [{...}] one representative per distinct content, for the near pass
    buckets.forEach(items => {
      const groups = [];
      items.forEach(it => { const g = groups.find(x => x[0].body === it.body); if (g) g.push(it); else groups.push([it]); });   // hash match is confirmed by full comparison
      groups.forEach(g => {
        g.sort(newest);
        if (g.length > 1) out.exact.push({ gen: g[0].p.gen, kind: g[0].p.kind, keep: g[0].rec.key, keepAt: g[0].at, drop: g.slice(1).map(x => ({ key: x.rec.key, caller: x.rec.caller, at: x.at })) });
        if (g[0].p.kind === 'chat-copy') { let a = singles.get(g[0].p.gen); if (!a) singles.set(g[0].p.gen, a = []); a.push(g[0]); }
      });
    });
    singles.forEach((list, gen) => {
      const by = new Map();
      list.forEach(it => {
        const s = chatSummary(it.rec.value.data), sig = s.threads.length + '/' + s.threads.reduce((a, t) => a + t.messages, 0);
        if (s.threads.length === 0) return;
        let a = by.get(sig); if (!a) by.set(sig, a = []); a.push({ key: it.rec.key, caller: it.rec.caller, at: it.at, name: text(it.rec.value.name), threads: s.threads.length, messages: s.threads.reduce((x, t) => x + t.messages, 0) });
      });
      by.forEach(a => { if (a.length > 1) out.near.push({ gen, items: a.sort((x, y) => y.at - x.at) }); });
    });
    const order = (a, b) => (a.keep || a.gen) < (b.keep || b.gen) ? -1 : 1;
    out.exact.sort(order); out.near.sort(order);
    return out;
  }
  // Metadata-only report for the AI helper: names, dates and counts. Never chat text, config or source.
  function duplicateReport(found) {
    const d = t => fmtDate(t) || 'undated', L = ['Backup copies that look like duplicates. Metadata only; no chat text is included.', ''];
    found.exact.forEach(g => { L.push('EXACT (identical content) in ' + g.gen + ' [' + g.kind + ']: keep ' + g.keep + ' (' + d(g.keepAt) + '); candidates to delete: ' + g.drop.map(x => x.key + ' (' + d(x.at) + ')').join('; ')); });
    found.near.forEach(g => { L.push('POSSIBLE in ' + g.gen + ' (same thread and message counts, content differs): ' + g.items.map(x => x.key + ' "' + x.name + '" ' + x.threads + ' threads, ' + x.messages + ' messages, ' + d(x.at)).join('; ')); });
    return L.join('\n');
  }

  // ---- load from folder: decide what a folder of weld-backup files would change here. Pure; writes nothing.
  // docs: parsed JSON files. local: { get(caller, key) -> value | null (stale/unreadable) | undefined (absent), has(key) -> bool }.
  // Never overwrites a chat copy or other key that exists. A snapshot is replaced only by a strictly newer one;
  // a chat index only gains entries whose chat copy is present. Device-specific and legacy keys are skipped.
  function planImport(docs, local) {
    const skipped = { operational: 0, legacy: 0, invalid: 0, held: 0, unchanged: 0, older: 0, present: 0, tombstoned: 0, unreadable: 0 };
    const groups = new Map();
    (docs || []).forEach(doc => {
      let recs = null;
      if (isObj(doc) && doc.format === 'weld-backup-record' && isObj(doc.record)) recs = [doc.record];
      else if (isObj(doc) && doc.format === 'weld-backup-bundle' && Array.isArray(doc.records)) recs = doc.records;
      if (!recs) { skipped.invalid++; return; }
      const ex = num(doc.exportedAt) || 0;
      recs.forEach(r => {
        if (!isObj(r) || typeof r.key !== 'string' || r.stale === true || r.value === null || r.value === undefined) { skipped.invalid++; return; }
        const p = parseKey(r.key);
        if (p.kind === 'operational') { skipped.operational++; return; }
        if (p.kind === 'legacy') { skipped.legacy++; return; }
        if (!p.gen || checkStoreWrite(r.key, r.value).ok !== true) { skipped.invalid++; return; }
        if (p.kind !== 'snapshot' && p.kind !== 'chat-copy' && p.kind !== 'chat-index') { skipped.invalid++; return; }   // only the three documented key shapes
        const caller = p.gen;   // never trust a file's storedBy: a record can only land in the namespace its own key names
        if (p.kind === 'chat-copy' && secretScan(isObj(r.value) ? r.value.data : null).length) { skipped.held++; return; }
        const id = caller + '\u0000' + r.key, at = atOf(r.value), c = { id, caller, key: r.key, p, value: r.value, ex, at };
        const g = groups.get(id);
        const better = !g || (p.kind === 'snapshot' ? (at > g.at || (at === g.at && ex > g.ex)) : ex > g.ex);
        if (better) groups.set(id, c);
      });
    });
    const add = [], update = [], adding = new Set();
    const bytes = v => { try { return JSON.stringify(v).length; } catch (e) { return 0; } };
    const item = (c, action, note, value) => ({ caller: c.caller, key: c.key, kind: c.p.kind, gen: c.p.gen, action, note, value: value === undefined ? c.value : value, bytes: bytes(value === undefined ? c.value : value) });
    const indexes = [];
    groups.forEach(c => {
      if (c.p.kind === 'chat-index') { indexes.push(c); return; }
      const cur = local.get(c.caller, c.key);
      if (cur === undefined) { add.push(item(c, 'new', 'not here yet')); adding.add(c.key); return; }
      if (cur === null) { skipped.tombstoned++; return; }
      if (c.p.kind === 'snapshot') {
        const have = atOf(cur);
        if (c.at > have) update.push(item(c, 'newer', 'folder copy ' + fmtDate(c.at) + ' replaces ' + (have ? fmtDate(have) : 'an undated copy')));
        else if (c.at < have) skipped.older++; else skipped.unchanged++;
        return;
      }
      skipped.present++;
    });
    const haveKey = k => adding.has(k) || local.has(k);
    indexes.forEach(c => {
      const gen = c.p.gen, cur = local.get(c.caller, c.key);
      if (cur === null) { skipped.tombstoned++; return; }
      if (!Array.isArray(c.value) || (cur !== undefined && !Array.isArray(cur)) || indexRefs(c.value) === null) { skipped.invalid++; return; }
      const refOf = e => { const r = indexRefs([e]); return r && r.length ? refToKey(gen, r[0]) : null; };
      const known = new Set(cur === undefined ? [] : cur.map(refOf).filter(Boolean));
      const fresh = c.value.filter(e => { const k = refOf(e); return k && !known.has(k) && haveKey(k); });
      if (!fresh.length) { skipped.unchanged++; return; }
      let merged = (cur === undefined ? [] : cur).concat(fresh);
      if (merged.every(e => isObj(e) && num(e.takenAt) !== null)) merged = merged.slice().sort((a, b) => b.takenAt - a.takenAt);
      if (cur === undefined) add.push(item(c, 'new', fresh.length + ' chat cop' + (fresh.length === 1 ? 'y' : 'ies') + ' listed', merged));
      else update.push(item(c, 'merge-index', 'adds ' + fresh.length + ' chat cop' + (fresh.length === 1 ? 'y' : 'ies') + ' to the list', merged));
    });
    const order = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    add.sort(order); update.sort(order);
    return { add, update, skipped };
  }

  // ---- working copy: one .zip a person can unpack anywhere (stored, not compressed: no dependency, and models do not
  // shrink anyway). entries: [{ path, bytes: Uint8Array | string }]. Plain zip32, so the whole archive must stay under 4 GiB.
  const ZIP_MAX = 0xfffffffe;
  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) { crcTable = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; } }
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function zip(entries, at) {
    const d = new Date(typeof at === 'number' ? at : Date.now());
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const enc = new TextEncoder(), seen = new Set(), heads = [], centrals = [];
    let offset = 0;
    if (entries.length > 65000) throw new Error('Too many files for one zip');
    for (const e of entries) {
      const path = String(e.path || '');
      if (!path || seen.has(path) || /^\/|(^|\/)\.\.(\/|$)|\\|[\x00-\x1f]/.test(path)) throw new Error('Unsafe or duplicate zip path: ' + path);
      seen.add(path);
      // ArrayBuffer.isView, not instanceof: bytes made in the page or a userscript sandbox are another realm's Uint8Array.
      const name = enc.encode(path), b = e.bytes, data = ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : enc.encode(String(b == null ? '' : b)), crc = crc32(data);
      const local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true);
      lv.setUint16(10, time, true); lv.setUint16(12, date, true); lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true); local.set(name, 30);
      const cen = new Uint8Array(46 + name.length), cv = new DataView(cen.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
      cv.setUint16(12, time, true); cv.setUint16(14, date, true); cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); cen.set(name, 46);
      heads.push(local, data); centrals.push(cen);
      offset += local.length + data.length;
      if (offset > ZIP_MAX) throw new Error('The working copy is over 4 GiB; save it to the backup folder instead');
    }
    const cenSize = centrals.reduce((n, c) => n + c.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, cenSize, true); ev.setUint32(16, offset, true);
    return heads.concat(centrals, [end]);   // parts for new Blob(parts): no single giant buffer is ever built
  }
  function workingCopyName(slug, at) {
    const d = new Date(at), p = n => String(n).padStart(2, '0');
    return String(slug).replace(/[^a-zA-Z0-9_-]+/g, '-') + '-working-copy-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  return { GEN_RE, MAX_VALUE_BYTES, MAX_CHAT_COPIES, parseKey, inScope, snapshotShape, missingFields, indexRefs, chatSummary, secretScan,
    inspect, buildInventory, fmtBytes, fmtDate, exportRecord, exportBundle, isVaultUpdate, validateEnvelope, presenceTracker, checkStoreWrite, hash8, backupTarget, entryFor, planImport, findDuplicates, duplicateReport, refToKey, canonical,
    crc32, zip, workingCopyName };
});
