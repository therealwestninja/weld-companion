/* Backups tab: Weld keeps no backups of its own. Generator vault saves pass straight through to the backup folder
   (a drive or cloud-synced folder); this tab shows, exports, deletes and purges anything older still held in browser
   storage. Record contents are never logged or sent anywhere. */
(function () {
  'use strict';
  if (window.top !== window) return;
  const C = window.WeldBackupCore, H = window.weldProjectHost;
  if (!C || !H || !window.WeldRepoStore) return;
  const E = H.el;
  const S = { pick: '', rows: null, inv: null, error: '', selected: null, inspected: null, secrets: null, msg: '', stamp: 0, openGens: new Set(), busy: false };
  let host = null, unsub = null;
  const note = t => E('div', { class: 'wc-section-note', text: t });
  const small = { fontSize: '12px', opacity: '.75' };
  // el() sets attributes with setAttribute, so a false `disabled` would still disable the button: only pass it when true.
  const btn = (label, fn, extra) => { const a = Object.assign({ type: 'button', class: 'wc-btn wc-mini', text: label, onclick: fn }, extra || {}); if (!a.disabled) delete a.disabled; return E('button', a); };
  const V = () => H.vault || null;

  function say(t, isErr) { S.msg = t; S.msgErr = !!isErr; }

  // One pass over the stored keys. Values are parsed only to read their size, date and staleness, then dropped.
  function load() {
    const v = V();
    S.rows = null; S.inv = null; S.error = ''; S.stamp = Date.now();
    if (!v) { S.error = 'Storage access is unavailable in this build. Update the complete Weld userscript.'; return; }
    let listed;
    try { listed = v.list(); } catch (e) { listed = { ok: false, reason: String((e && e.message) || e) }; }
    if (!listed || listed.ok !== true) { S.error = 'Could not list stored backups: ' + ((listed && listed.reason) || 'unknown error') + '.'; return; }
    const rows = [];
    (listed.items || []).forEach(it => {
      if (!C.inScope(it.key)) return;
      let r;
      try { r = v.read(it.gmKey); } catch (e) { r = { ok: false, reason: 'read-failed' }; }
      const row = { key: it.key, gmKey: it.gmKey, caller: it.caller, size: 0, stale: false, parseError: false, at: null };
      if (!r || r.ok !== true) row.parseError = true;
      else {
        row.size = r.size || 0;
        if (r.parseError) row.parseError = true;
        else if (r.value === null || r.value === undefined) row.stale = true;
        else if (r.value && typeof r.value === 'object' && typeof r.value.at === 'number') row.at = r.value.at;
      }
      rows.push(row);
    });
    S.rows = rows; S.inv = C.buildInventory(rows);
    if (S.selected && !rows.some(r => r.gmKey === S.selected)) { S.selected = null; S.inspected = null; }
  }
  function full(gmKey) {   // fresh read of a single record for inspect / export
    const row = (S.rows || []).find(r => r.gmKey === gmKey); if (!row) return null;
    let r; try { r = V().read(gmKey); } catch (e) { r = { ok: false, reason: 'read-failed' }; }
    if (!r || r.ok !== true) return Object.assign({}, row, { unreadable: true });
    return Object.assign({}, row, { size: r.size || 0, value: r.value === undefined ? null : r.value, parseError: !!r.parseError, stale: !r.parseError && (r.value === null || r.value === undefined) });
  }
  function indexFor(gen) {
    const row = (S.rows || []).find(r => C.parseKey(r.key).kind === 'chat-index' && C.parseKey(r.key).gen === gen);
    const rec = row && full(row.gmKey); return rec && !rec.parseError && !rec.stale ? rec.value : undefined;
  }
  function inspectRow(gmKey) {
    const rec = full(gmKey); S.selected = gmKey; S.secrets = null;
    if (!rec) { S.inspected = null; return; }
    const keys = (S.rows || []).map(r => r.key), gen = C.parseKey(rec.key).gen;
    S.inspected = rec.unreadable ? { rec, report: { meta: [['Key', rec.key]], anomalies: ['The value could not be read.'], chat: null } }
      : { rec, report: C.inspect(rec, { keys, index: gen ? indexFor(gen) : undefined }) };
  }

  const stamp = () => Date.now();
  function saveFile(file) {
    try { H.vault.download(file.filename, file.text); say('Saved ' + file.filename + '.'); } catch (e) { say('Download failed.', true); }
  }
  function exportRows(label, rows) {
    const recs = rows.map(r => full(r.gmKey)).filter(Boolean);
    if (!recs.length) { say('Nothing to export.', true); return; }
    saveFile(C.exportBundle(label, recs, stamp()));
  }
  // One click, no confirmation. Only that exact key is removed; the open sections and scroll position stay put.
  function runDelete(gmKey) {
    const row = (S.rows || []).find(r => r.gmKey === gmKey);
    if (!row) { say('That key no longer exists.', true); return; }
    let res; try { res = V().remove(gmKey); } catch (e) { res = { ok: false, reason: 'error' }; }
    const ok = !!(res && res.ok), t = ok ? 'Deleted ' + (C.parseKey(row.key).sub || row.key) + '.' : 'Delete failed: ' + ((res && res.reason) || 'unknown') + '.';
    say(t, !ok); try { H.toast(t); } catch (e) {}
    if (S.selected === gmKey) { S.selected = null; S.inspected = null; }
    load();
  }
  function scanSecrets() {
    const hits = [];
    (S.rows || []).forEach(r => {
      if (C.parseKey(r.key).kind !== 'chat-copy' || r.stale || r.parseError) return;
      const rec = full(r.gmKey); if (!rec || rec.parseError || !rec.value) return;
      const found = C.secretScan(rec.value.data);
      if (found.length) hits.push({ key: r.key, paths: found.map(f => f.path) });
    });
    S.secrets = hits; say(hits.length ? 'Found secret-shaped values in ' + hits.length + ' chat cop' + (hits.length === 1 ? 'y' : 'ies') + '. Values are not shown.' : 'No plaintext secret-shaped config values found.');
  }

  function rowLine(r, canDelete, rerender) {
    const p = C.parseKey(r.key), label = p.sub || r.key;
    const sel = S.selected === r.gmKey;
    const bits = [label, C.fmtBytes(r.size)];
    if (r.at) bits.push(C.fmtDate(r.at));
    if (r.stale) bits.push('STALE (null value)');
    if (r.parseError) bits.push('unreadable');
    const line = E('div', { 'data-key': r.key, style: { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', padding: '4px 0', fontWeight: sel ? '600' : '' } }, [
      E('span', { text: bits.join(' · '), style: { flex: '1', minWidth: '160px', fontSize: '12px', wordBreak: 'break-all' } }),
      btn('Inspect', () => { inspectRow(r.gmKey); rerender(); }, { 'aria-label': 'Inspect ' + r.key }),
      btn('Download', () => { const rec = full(r.gmKey); if (rec) saveFile(C.exportRecord(rec, stamp())); rerender(); }, { 'aria-label': 'Download ' + r.key })
    ]);
    if (canDelete) line.appendChild(btn('Delete', () => { runDelete(r.gmKey); rerender(); }, { 'aria-label': 'Delete ' + r.key }));
    return line;
  }
  function inspector(rerender) {
    const i = S.inspected; if (!i) return note('Select Inspect on a record to see its details.');
    const wrap = E('div', { 'aria-label': 'Record inspector', style: { borderTop: '1px solid var(--wc-line,#555)', marginTop: '12px', paddingTop: '10px' } });
    wrap.appendChild(E('div', { text: 'Inspector', style: { fontWeight: '600', marginBottom: '6px' } }));
    i.report.meta.forEach(m => wrap.appendChild(E('div', { style: { display: 'flex', gap: '8px', fontSize: '12px' } }, [E('span', { text: m[0], style: { minWidth: '110px', opacity: '.7' } }), E('span', { text: m[1], style: { wordBreak: 'break-all' } })])));
    const chat = i.report.chat;
    if (chat) {
      if (chat.threads.length) { wrap.appendChild(E('div', { text: 'Threads', style: { fontWeight: '600', marginTop: '8px' } })); chat.threads.slice(0, 50).forEach(t => wrap.appendChild(E('div', { style: { fontSize: '12px' }, text: t.title + ' — ' + t.messages + ' message' + (t.messages === 1 ? '' : 's') }))); }
      if (chat.characters.length) wrap.appendChild(E('div', { style: { fontSize: '12px', marginTop: '6px' }, text: 'Characters: ' + chat.characters.join(', ') }));
      if (chat.configKeys.length) wrap.appendChild(E('div', { style: { fontSize: '12px', marginTop: '6px' }, text: 'Config keys (names only): ' + chat.configKeys.join(', ') }));
    }
    if (i.report.anomalies.length) {
      wrap.appendChild(E('div', { text: 'Warnings (read-only, nothing is changed)', style: { fontWeight: '600', marginTop: '10px', color: '#e0a030' } }));
      i.report.anomalies.forEach(a => wrap.appendChild(E('div', { 'data-anomaly': '1', style: { fontSize: '12px' }, text: '⚠ ' + a })));
    } else wrap.appendChild(E('div', { style: { fontSize: '12px', marginTop: '8px' }, text: 'No anomalies found.' }));
    return wrap;
  }


  // Dad-Chat family: one generator at a time (keyed by tag), four persistence rungs. The companion can only see the
  // vault rung and presence; the rest live in the generator's own page, so they are reported as not visible, not guessed.
  function familyCard(rerender) {
    const inv = S.inv, v = V(), pres = (v && typeof v.presence === 'function' && v.presence()) || { tabs: {}, ignored: 0 };
    const tags = new Set(inv.generators.map(g => g.gen));
    Object.keys(pres.tabs || {}).forEach(t => { if (C.GEN_RE.test(t)) tags.add(t); });
    const here = typeof H.slug === 'function' ? H.slug() : ''; if (here && C.GEN_RE.test(here)) tags.add(here);
    const list = Array.from(tags).sort();
    const card = E('div', { 'data-family': '1', style: { border: '1px solid var(--wc-line,#555)', borderRadius: '8px', padding: '10px', margin: '8px 0' } });
    card.appendChild(E('div', { text: 'Dad-Chat family', style: { fontWeight: '600' } }));
    card.appendChild(E('div', { style: Object.assign({ marginBottom: '6px' }, small), text: 'Any generator that stores copies under its own tag appears here. The companion only watches; it never routes chats or subscribes channels for a generator.' }));
    if (!list.length) { card.appendChild(note('No generator tags seen yet.')); return card; }
    if (!S.pick || !tags.has(S.pick)) S.pick = list.indexOf(here) >= 0 ? here : list[0];
    const sel = E('select', { 'aria-label': 'Generator', style: { margin: '4px 0 8px' } }, list.map(t => E('option', { value: t, text: t })));
    sel.value = S.pick; sel.addEventListener('change', () => { S.pick = sel.value; rerender(); });
    card.appendChild(sel);
    const g = inv.generators.find(x => x.gen === S.pick);
    const vaultState = !g ? 'No vault copies stored' : [g.snapshot ? (g.snapshot.stale ? 'source copy is stale' : 'source copy ' + (g.snapshot.at ? C.fmtDate(g.snapshot.at) : 'present')) : 'no source copy', g.chats + ' chat cop' + (g.chats === 1 ? 'y' : 'ies'), C.fmtBytes(g.bytes)].join(', ');
    const open = (pres.tabs || {})[S.pick] || 0;
    [['Live session', 'Not visible to the companion (kept in the generator\'s own page storage)'],
     ['Named slots', 'Not visible to the companion (local to the generator; the companion never syncs or manages them)'],
     ['Vault copies', vaultState],
     ['Cloud Backup mirror', 'Not visible to the companion (a public file the generator keeps itself)']].forEach(r =>
      card.appendChild(E('div', { 'data-rung': r[0], style: { display: 'flex', gap: '8px', fontSize: '12px', padding: '2px 0' } }, [E('span', { text: r[0], style: { minWidth: '130px', fontWeight: '600' } }), E('span', { text: r[1] })])));
    card.appendChild(E('div', { 'data-presence': '1', style: Object.assign({ marginTop: '6px' }, small), text: 'Presence: ' + open + ' open tab' + (open === 1 ? '' : 's') + ' seen for ' + S.pick + ' · ' + (pres.ignored || 0) + ' malformed or duplicate message' + (pres.ignored === 1 ? '' : 's') + ' ignored' }));
    return card;
  }

  // ------------------------------------------------------------- backup folder (any drive or cloud-sync folder)
  // The user picks a folder with the browser's folder picker (Chrome/Edge). Records are copied there as JSON files.
  // Files are only ever ADDED: a changed record gets a new file, an unchanged one is skipped, nothing is overwritten or deleted.
  const AUTO_KEY = 'backupFolderAuto', KEEP_KEY = 'backupFolderKeep';
  const F = { supported: false, handle: null, name: '', perm: 'none', auto: false, keep: true, busy: false, error: '', last: null };
  const memKv = new Map();
  let dbp = null;
  function kvdb() {
    if (dbp) return dbp;
    dbp = new Promise(resolve => {
      try {
        const open = indexedDB.open('weldCompanionBackupFolder', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onsuccess = () => resolve(open.result); open.onerror = () => resolve(null); open.onblocked = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return dbp;
  }
  const kvOp = (mode, fn) => kvdb().then(d => new Promise((resolve, reject) => {
    if (!d) return reject(new Error('no-db'));
    try { const t = d.transaction('kv', mode), r = fn(t.objectStore('kv')); t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error); } catch (e) { reject(e); }
  }));
  const kvGet = k => kvOp('readonly', st => st.get(k)).then(v => (v === undefined ? memKv.get(k) : v), () => memKv.get(k));
  const kvSet = (k, v) => kvOp('readwrite', st => st.put(v, k)).catch(() => { memKv.set(k, v); });
  const kvDel = k => kvOp('readwrite', st => st.delete(k)).catch(() => {}).then(() => { memKv.delete(k); });
  const pageWin = () => { try { return H.pageWindow ? H.pageWindow() : window; } catch (e) { return window; } };
  async function permission(handle, ask) {
    try {
      let st = await handle.queryPermission({ mode: 'readwrite' });
      if (st !== 'granted' && ask) st = await handle.requestPermission({ mode: 'readwrite' });
      return st;
    } catch (e) { return 'denied'; }
  }
  async function chooseFolder() {
    F.supported = typeof pageWin().showDirectoryPicker === 'function';
    if (!F.supported) { F.error = 'This browser cannot open folders. Use Chrome or Edge, or use the Download buttons.'; return draw(); }
    try {
      const h = await pageWin().showDirectoryPicker({ id: 'weld-backup-folder', mode: 'readwrite' });
      F.handle = h; F.name = h.name; F.perm = await permission(h, true); F.error = F.perm === 'granted' ? '' : 'Folder chosen, but write permission was not granted.';
      await kvSet('handle', h); say(F.perm === 'granted' ? 'Backup folder set: ' + h.name : F.error, F.perm !== 'granted');
      fkReset(); afterGrant();
    } catch (e) { if (!(e && e.name === 'AbortError')) F.error = (e && e.message) || String(e); }
    draw();
  }
  async function allowFolder() {
    if (!F.handle) return;
    F.perm = await permission(F.handle, true); F.error = F.perm === 'granted' ? '' : 'Permission was not granted.'; afterGrant(); draw();
  }
  async function forgetFolder() {
    if (FK.pending.size) await fkFlush().catch(() => {});
    F.handle = null; F.name = ''; F.perm = 'none'; await kvDel('handle'); fkReset(); say('Backup folder disconnected. Nothing in it was deleted.'); draw();
  }
  // Chrome drops folder permission on restart; requestPermission() needs a user gesture, so with "Keep access
  // allowed" on, the first click or key press anywhere re-grants it (no need to open Weld's panel).
  let regrantArmed = false;
  function armRegrant() {
    if (regrantArmed || !F.handle || F.perm === 'granted' || !F.keep || typeof document === 'undefined') return;
    regrantArmed = true;
    const go = async () => {
      document.removeEventListener('pointerdown', go, true); document.removeEventListener('keydown', go, true); regrantArmed = false;
      if (!F.handle || F.perm === 'granted' || !F.keep) return;
      F.perm = await permission(F.handle, true); if (F.perm === 'granted') F.error = '';
      if (F.perm === 'granted' && F.auto) scheduleSync(500);
      afterGrant();
      if (host) draw();
    };
    document.addEventListener('pointerdown', go, true); document.addEventListener('keydown', go, true);
  }
  async function recheckAccess() {
    if (!F.handle || !F.keep) return;
    const was = F.perm; F.perm = await permission(F.handle, false);
    if (F.perm !== 'granted') armRegrant(); else afterGrant();   // also refreshes data files changed in another tab
    if (F.perm !== was && host) draw();
  }
  function setKeep(on) { F.keep = !!on; H.set(KEEP_KEY, F.keep); if (F.keep) recheckAccess(); draw(); }
  function setAuto(on) { F.auto = false; H.set(AUTO_KEY, false); if (on) say('Automatic folder saving was removed in 1.90.0: your data lives in your GitHub repo. Use Save all to folder now for a manual copy.', true); draw(); }
  async function dirAt(root, segs, create) { let d = root; for (const s of segs) d = await d.getDirectoryHandle(s, { create }); return d; }
  async function exists(dir, name) {
    try { await dir.getFileHandle(name); return true; } catch (e) { if (e && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')) return false; throw e; }
  }
  // Copy every readable, non-stale record into the folder. Records holding plaintext secret-shaped values are held back.
  // onlyStarred: automatic saves cover starred generators only; manual and pre-restore saves cover everything.
  async function syncToFolder(manual, onlyStarred) {
    if (F.busy) return; if (!F.handle || F.perm !== 'granted') { if (manual) { F.error = 'Choose a backup folder and allow access first.'; draw(); } return; }
    F.busy = true; const res = { at: Date.now(), written: 0, skipped: 0, held: [], failed: 0, saved: [] };   // saved: keys provably in the folder
    try {
      load();
      let stars = null; if (onlyStarred) { try { stars = H.favorites() || []; } catch (e) { stars = []; } }
      for (const row of (S.rows || [])) {
        if (stars && stars.indexOf(C.parseKey(row.key).gen || row.caller) === -1) { res.skipped++; continue; }
        const rec = full(row.gmKey);
        if (!rec || rec.unreadable || rec.parseError) { res.failed++; continue; }
        if (rec.stale) { res.skipped++; continue; }
        if (C.parseKey(rec.key).kind === 'chat-copy' && rec.value && C.secretScan(rec.value.data).length) { res.held.push(rec.key); continue; }
        try {
          const t = C.backupTarget(rec), dir = await dirAt(F.handle, t.dir, true);
          if (await exists(dir, t.name)) { res.skipped++; res.saved.push(row.gmKey); continue; }
          // Reads return the newest-written chat index, so an old index from browser storage must never be stamped as new.
          if (C.parseKey(rec.key).kind === 'chat-index' && (await ptNames(dir)).some(n => /^index-/.test(n))) { res.skipped++; continue; }
          const w = await (await dir.getFileHandle(t.name, { create: true })).createWritable();
          await w.write(JSON.stringify({ format: 'weld-backup-record', v: 1, exportedAt: Date.now(), record: C.entryFor(rec) }, null, 2)); await w.close(); res.written++; res.saved.push(row.gmKey);
        } catch (e) { res.failed++; if (e && e.name === 'NotAllowedError') { F.perm = 'prompt'; break; } }
      }
      F.last = res; F.error = '';
      say('Saved ' + res.written + ' new file' + (res.written === 1 ? '' : 's') + ' to ' + F.name + ' (' + res.skipped + ' already there' + (res.held.length ? ', ' + res.held.length + ' held back for secret-shaped values' : '') + (res.failed ? ', ' + res.failed + ' failed' : '') + ').', res.failed > 0);
    } catch (e) { F.error = 'Save to folder failed: ' + ((e && e.message) || e); }
    F.busy = false; if (manual || host) draw();
  }
  // ---- pass-through vault: a generator's vault save (source copy, chat index, chat copy) is written straight into the
  // backup folder and never kept in Weld storage; reads come back from the folder. Files are only ever added, except a
  // chat index file, which is re-stamped when the same list is saved again so the newest list wins.
  const NO_FOLDER = 'Weld keeps no backups. Choose a backup folder in Weld > Backups (a drive or a cloud-synced folder) and allow access to receive vault saves.';
  const VAULT_KINDS = ['snapshot', 'chat-index', 'chat-copy'];
  const ptReady = () => !!(F.handle && F.perm === 'granted');   // the manual-export folder
  const vaultReady = () => RP.ready();   // the GitHub repo: where vault saves go
  async function ptDoc(dir, name) {
    try { const doc = JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text()); return doc && doc.format === 'weld-backup-record' && doc.record ? doc : null; } catch (e) { return null; }
  }
  async function ptNames(dir) {
    const out = []; if (!dir) return out;
    try { for await (const entry of dir.entries()) if (entry[1].kind === 'file' && /\.json$/i.test(entry[0])) out.push(entry[0]); } catch (e) {}
    return out;
  }
  async function ptDir(gen, sub) { try { return await dirAt(F.handle, [gen, sub], false); } catch (e) { return null; } }
  // A folder file is trusted for a generator only if that generator stored it and the record names no other owner.
  // (The folder also holds older copies from browser storage, where one generator may have written another's key.)
  const ownDoc = (doc, key, caller) => !!(doc && doc.record.key === key && doc.record.storedBy === caller && doc.record.stale !== true && C.checkStoreWrite(key, doc.record.value).ok);
  // Disk guard: the folder never rotates files out, so a generator gets a write budget and a per-folder file cap.
  const PT_RATE_MAX = 30, PT_RATE_MS = 10 * 60000, PT_MAX_FILES = 500, ptWrites = new Map();
  function ptBudget(caller, now) {
    const recent = (ptWrites.get(caller) || []).filter(t => now - t < PT_RATE_MS);
    ptWrites.set(caller, recent);
    if (recent.length >= PT_RATE_MAX) return false;
    recent.push(now); return true;
  }
  async function ptSet(caller, key, value) {
    if (!ptReady()) return { ok: false, code: 'no-backup-folder', reason: NO_FOLDER };
    const p = C.parseKey(key);
    if (!p.gen || p.gen !== caller || VAULT_KINDS.indexOf(p.kind) === -1) return { ok: false, code: 'bad-key', reason: 'bad-key' };
    if (value === null || value === undefined) return { ok: true, where: 'folder', note: 'the backup folder only gains files; nothing was deleted from it' };
    if (C.checkStoreWrite(key, value).ok !== true) return { ok: false, code: 'owner-mismatch', reason: 'owner-mismatch' };
    if (p.kind === 'chat-copy' && C.secretScan(value && value.data).length) return { ok: false, code: 'secret-shaped', reason: 'this chat copy holds a plaintext secret-shaped value, so it was not written to the backup folder' };
    const rec = { key, caller, size: 0, stale: false, value };
    try { rec.size = JSON.stringify(value).length; } catch (e) {}
    try {
      const t = C.backupTarget(rec), dir = await dirAt(F.handle, t.dir, true);
      const there = await exists(dir, t.name);
      let oldText = null;
      if (there && p.kind === 'chat-copy') {
        // Same chat copy id saved again: if the content changed, the new one must win (reads return this file), so the
        // previous version is kept under chat/_history first. Identical content is a no-op.
        try { oldText = await (await (await dir.getFileHandle(t.name)).getFile()).text(); } catch (e) { oldText = null; }
        let oldDoc = null; try { oldDoc = JSON.parse(oldText); } catch (e) {}
        if (oldDoc && oldDoc.record && C.canonical(oldDoc.record.value) === C.canonical(value)) return { ok: true, where: 'folder' };
      } else if (p.kind !== 'chat-index' && there) return { ok: true, where: 'folder' };
      if (!ptBudget(caller, Date.now())) return { ok: false, code: 'rate-limited', reason: 'too many vault saves from this generator; try again in a few minutes' };
      if (oldText !== null) {
        const hdir = await dirAt(F.handle, [p.gen, 'chat', '_history'], true), stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
        if ((await ptNames(hdir)).length >= PT_MAX_FILES) return { ok: false, code: 'folder-full', reason: 'this generator already has ' + PT_MAX_FILES + ' files in its chat history folder; move or delete some there first' };
        if (!await fkWriteVerified(hdir, t.name.replace(/\.json$/, '') + '-' + stamp + '-' + C.hash8(oldText).slice(0, 4) + '.json', oldText)) return { ok: false, code: 'folder-write-failed', reason: 'could not keep the previous version, so the chat copy was not replaced' };
      }
      if (!there && (await ptNames(dir)).length >= PT_MAX_FILES) return { ok: false, code: 'folder-full', reason: 'this generator already has ' + PT_MAX_FILES + ' files in its backup folder; move or delete some there first' };
      const w = await (await dir.getFileHandle(t.name, { create: true })).createWritable();
      await w.write(JSON.stringify({ format: 'weld-backup-record', v: 1, exportedAt: Date.now(), record: C.entryFor(rec) }, null, 2)); await w.close();
      if (host) scheduleDraw();
      return { ok: true, where: 'folder' };
    } catch (e) {
      if (e && e.name === 'NotAllowedError') { F.perm = 'prompt'; armRegrant(); }
      return { ok: false, code: 'folder-write-failed', reason: 'could not write to the backup folder' };
    }
  }
  // -> the stored value, or undefined when the folder has no copy of that key
  async function ptGet(caller, key) {
    if (!ptReady()) return undefined;
    const p = C.parseKey(key); if (!p.gen || p.gen !== caller || VAULT_KINDS.indexOf(p.kind) === -1) return undefined;
    if (p.kind === 'chat-copy') {
      const dir = await ptDir(p.gen, 'chat'), doc = dir && await ptDoc(dir, C.backupTarget({ key, value: null }).name);
      return ownDoc(doc, key, caller) ? doc.record.value : undefined;
    }
    const dir = await ptDir(p.gen, p.kind === 'snapshot' ? 'snapshot' : 'chat'), re = p.kind === 'snapshot' ? /^snapshot-/ : /^index-/;
    let best = null;
    for (const name of (await ptNames(dir)).filter(n => re.test(n))) {
      const doc = await ptDoc(dir, name); if (!ownDoc(doc, key, caller)) continue;
      const v = doc.record.value, score = [p.kind === 'snapshot' && v && typeof v.at === 'number' ? v.at : 0, Number(doc.exportedAt) || 0];
      if (!best || score[0] > best.score[0] || (score[0] === best.score[0] && score[1] > best.score[1])) best = { score, value: v };
    }
    return best ? best.value : undefined;
  }
  async function ptList(caller, prefix) {
    if (!ptReady() || !C.GEN_RE.test(String(caller || ''))) return [];
    const base = 'weld:genvault:' + caller + '/', out = [];
    if ((await ptNames(await ptDir(caller, 'snapshot'))).some(n => /^snapshot-/.test(n))) out.push(base + 'snapshot');
    const chat = await ptNames(await ptDir(caller, 'chat'));
    if (chat.some(n => /^index-/.test(n))) out.push(base + 'chat/index');
    chat.filter(n => /^snap-/.test(n)).sort().forEach(n => out.push(base + 'chat/' + n.slice(0, -5)));
    return out.filter(k => k.indexOf(String(prefix || '')) === 0);
  }
  let drawTimer = null;
  function scheduleDraw() { if (drawTimer) return; drawTimer = setTimeout(() => { drawTimer = null; if (host) draw(); }, 400); }

  // ---- purge: remove every backup Weld still holds in browser storage, in one click with no confirmation: vault keys
  // (including legacy dadchat:vault keys) and the Project tab's saved generator copies and snapshots. What is not yet
  // on disk goes there first: into the backup folder when one is connected (secret-shaped chat copies, which never go
  // to a folder, are downloaded instead), otherwise as one downloaded file. Small operational link records are kept.
  const PROJECT_DB = 'weldCompanionProjects';
  function dropProjectDb() {
    return new Promise(resolve => {
      try {
        const idb = pageWin().indexedDB || indexedDB, r = idb.deleteDatabase(PROJECT_DB);
        r.onsuccess = () => resolve('ok'); r.onerror = () => resolve('failed'); r.onblocked = () => resolve('blocked');
      } catch (e) { resolve('unavailable'); }
    });
  }
  async function purgeAll() {
    if (S.busy) return;
    S.busy = true; draw();
    let gone = 0, bad = 0, keptNote = '';
    try {
      let saved = new Set();
      if (ptReady()) {
        while (F.busy) await new Promise(r => setTimeout(r, 100));   // an automatic save is running: let it finish, then save everything
        F.last = null; await syncToFolder(false); if (F.last && F.last.saved) saved = new Set(F.last.saved);
      }
      load();
      const rows = (S.rows || []).filter(r => C.parseKey(r.key).kind !== 'operational');
      const toFile = rows.filter(r => !r.stale && !saved.has(r.gmKey));   // not provably on disk yet (held back, failed, or no folder)
      if (toFile.length) {
        const recs = toFile.map(r => full(r.gmKey)).filter(Boolean), file = C.exportBundle('purged', recs, stamp());
        V().download(file.filename, file.text);
        keptNote = ' ' + recs.length + ' record' + (recs.length === 1 ? ' was' : 's were') + ' downloaded first as ' + file.filename + '.';
      } else if (saved.size) keptNote = ' Every record is in ' + F.name + '.';
      for (const r of rows) { let res; try { res = V().remove(r.gmKey); } catch (e) { res = null; } if (res && res.ok) gone++; else bad++; }
      const proj = await dropProjectDb();
      S.selected = null; S.inspected = null; S.secrets = null; D.found = null; D.sel = new Set();
      load();
      const t = 'Purged ' + gone + ' backup key' + (gone === 1 ? '' : 's') + ' from Weld storage' + (bad ? ' (' + bad + ' failed)' : '') + '.' + keptNote +
        (proj === 'ok' ? ' Project tab copies and snapshots removed.' : proj === 'blocked' ? ' Project tab copies are removed once other Perchance tabs are closed.' : proj === 'failed' ? ' Project tab copies could not be removed.' : '');
      say(t, bad > 0 || proj === 'failed'); try { H.toast(t, 8000); } catch (e) {}
    } catch (e) { say('Purge stopped: ' + ((e && e.message) || e), true); }
    S.busy = false; draw();
  }
  // ---- cleanup: duplicates. Exact duplicates can be removed in one step (after they are safely in the folder);
  // near duplicates are only listed and can be sent to the AI helper for a second opinion.
  const D = { found: null, sel: new Set(), busy: false, secretsLeft: 0 };
  function findDups() {
    load();
    const recs = [];
    (S.rows || []).forEach(r => { const k = C.parseKey(r.key).kind; if (r.stale || r.parseError || (k !== 'chat-copy' && k !== 'snapshot')) return; const rec = full(r.gmKey); if (rec && !rec.unreadable && !rec.parseError) recs.push({ key: r.key, caller: r.caller, value: rec.value }); });
    D.found = C.findDuplicates(recs); D.sel = new Set();
    D.found.exact.forEach(g => g.drop.forEach(x => D.sel.add(x.caller + '\u0000' + x.key)));
    say(D.found.exact.length || D.found.near.length ? 'Found ' + D.found.exact.length + ' exact duplicate group' + (D.found.exact.length === 1 ? '' : 's') + ' and ' + D.found.near.length + ' possible group' + (D.found.near.length === 1 ? '' : 's') + '.' : 'No duplicates found.');
    draw();
  }
  function askAIAboutDups() {
    if (!D.found) return;
    try { H.openAI('Review these backup copies. For each group say which copies are safe to delete and which to keep, and why. Prefer keeping the newest, and keep any copy whose message count is higher.\n\n' + C.duplicateReport(D.found), 'none'); }
    catch (e) { say('Could not open the AI helper: ' + ((e && e.message) || e), true); draw(); }
  }
  async function runCleanup() {
    if (!D.found || D.busy) return;
    if (!F.handle || F.perm !== 'granted') { say('Choose a backup folder and allow access first. Duplicates are only deleted after they are safely saved there.', true); return draw(); }
    D.busy = true; draw();
    let gone = 0, unsaved = 0;
    try {
      await syncToFolder(false);   // copy everything not yet in the folder first
      const drops = []; D.found.exact.forEach(g => g.drop.forEach(x => { if (D.sel.has(x.caller + '\u0000' + x.key)) drops.push(x); }));
      const removed = new Map();   // caller|gen -> keys removed
      for (const x of drops) {
        const row = (S.rows || []).find(r => r.key === x.key && r.caller === x.caller), rec = row && full(row.gmKey);
        if (!rec || rec.unreadable || rec.parseError || rec.stale) { unsaved++; continue; }
        let saved = false;
        try { const t = C.backupTarget(rec), dir = await dirAt(F.handle, t.dir, false), doc = JSON.parse(await (await (await dir.getFileHandle(t.name)).getFile()).text()); saved = !!(doc && doc.record && doc.record.key === rec.key && C.canonical(doc.record.value) === C.canonical(rec.value)); } catch (e) { saved = false; }   // the file must hold this exact content, not just share its name
        if (!saved) { unsaved++; continue; }   // never delete what is not provably in the folder
        let r; try { r = V().remove(row.gmKey); } catch (e) { r = { ok: false }; }
        if (r && r.ok) { gone++; const id = x.caller + '\u0000' + C.parseKey(x.key).gen; (removed.get(id) || removed.set(id, []).get(id)).push(x.key); } else unsaved++;
      }
      removed.forEach((keys, id) => {   // drop the deleted copies from their generator's chat index so nothing points at a missing key
        const caller = id.split('\u0000')[0], gen = id.split('\u0000')[1];
        const ir = (S.rows || []).find(r => r.caller === caller && C.parseKey(r.key).kind === 'chat-index' && C.parseKey(r.key).gen === gen), idx = ir && full(ir.gmKey);
        if (!idx || idx.parseError || idx.stale || !Array.isArray(idx.value)) return;
        const dropped = new Set(keys), next = idx.value.filter(e => { const r = C.indexRefs([e]); return !(r && r.length && dropped.has(C.refToKey(gen, r[0]))); });
        if (next.length !== idx.value.length) { try { V().write(caller, idx.key, next); } catch (e) {} }
      });
      say('Removed ' + gone + ' duplicate cop' + (gone === 1 ? 'y' : 'ies') + (unsaved ? '; ' + unsaved + ' kept because they were not confirmed in the folder' : '') + '. The folder still has every copy.', unsaved > 0);
    } catch (e) { say('Cleanup stopped: ' + ((e && e.message) || e), true); }
    D.found = null; D.sel = new Set(); D.busy = false; load(); draw();
  }
  function cleanupCard() {
    const card = E('div', { 'data-cleanup': '1', style: { border: '1px solid var(--wc-line,#555)', borderRadius: '8px', padding: '10px', margin: '8px 0' } });
    card.appendChild(E('div', { text: 'Cleanup duplicates', style: { fontWeight: '600' } }));
    card.appendChild(E('div', { style: Object.assign({ marginBottom: '6px' }, small), text: 'Finds copies with identical content. Only exact duplicates can be deleted here, the newest copy is always kept, and each one is deleted only after it is confirmed saved in your backup folder. Possible duplicates (same size, different content) are listed for you or the AI helper to judge.' }));
    card.appendChild(btn('Find duplicates', () => findDups(), { disabled: D.busy || !(S.rows && S.rows.length) }));
    const f = D.found; if (!f) return card;
    if (!f.exact.length && !f.near.length) card.appendChild(note('No duplicates found.'));
    f.exact.forEach(g => {
      card.appendChild(E('div', { 'data-dup-group': '1', style: { fontSize: '12px', marginTop: '8px', fontWeight: '600', wordBreak: 'break-all' }, text: g.gen + ' · keep ' + g.keep.slice(g.keep.lastIndexOf('/') + 1) + ' (' + (C.fmtDate(g.keepAt) || 'undated') + ')' }));
      g.drop.forEach(x => {
        const id = x.caller + '\u0000' + x.key, cb = E('input', { type: 'checkbox', 'aria-label': 'Delete duplicate ' + x.key }); cb.checked = D.sel.has(id);
        cb.addEventListener('change', () => { if (cb.checked) D.sel.add(id); else D.sel.delete(id); draw(); });
        card.appendChild(E('label', { style: { display: 'flex', gap: '7px', fontSize: '12px', alignItems: 'center', wordBreak: 'break-all' } }, [cb, E('span', { text: 'delete ' + x.key + ' (' + (C.fmtDate(x.at) || 'undated') + ')' })]));
      });
    });
    if (f.near.length) {
      card.appendChild(E('div', { style: { fontSize: '12px', fontWeight: '600', marginTop: '10px' }, text: 'Possible duplicates (not selectable; use Delete on a single key after you check)' }));
      f.near.forEach(g => g.items.forEach(x => card.appendChild(E('div', { style: { fontSize: '12px', wordBreak: 'break-all' }, text: g.gen + ' · ' + x.key.slice(x.key.lastIndexOf('/') + 1) + ' · "' + x.name + '" · ' + x.threads + ' threads, ' + x.messages + ' messages · ' + (C.fmtDate(x.at) || 'undated') }))));
    }
    if (f.exact.length || f.near.length) card.appendChild(E('div', { style: { fontSize: '12px', marginTop: '6px', opacity: '.75' }, text: 'The AI helper gets names, dates and counts only, never chat text. You press Ask yourself there.' }));
    const row = E('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' } });
    if (f.exact.length || f.near.length) row.appendChild(btn('Ask the AI helper to review', () => askAIAboutDups(), { disabled: D.busy }));
    if (f.exact.length) row.appendChild(btn('Delete ' + D.sel.size + ' selected duplicate' + (D.sel.size === 1 ? '' : 's'), () => { runCleanup(); }, { disabled: D.busy || !D.sel.size || !F.handle || F.perm !== 'granted' }));
    card.appendChild(row);
    if (f.exact.length && (!F.handle || F.perm !== 'granted')) card.appendChild(note('Deleting needs a backup folder with access allowed, so every copy is saved first.'));
    return card;
  }
  // ---- Weld data files: Studio projects and the Scrapbook live as files in <backup folder>/_weld-data, not in Weld
  // storage. Weld's storage helpers route those keys here (see gget/gset). Reads come from an in-memory cache filled
  // from the folder; writes update the cache and are written to the folder shortly after. A file another tab or
  // computer changed since this tab read it is never overwritten: the newer file wins and the tab is told.
  // Older copies still in browser storage are moved into the folder once access is allowed (verified, then removed).
  const FK_DIR = '_weld-data', FK_DELAY = 500;
  const FK = { cache: new Map(), seen: new Map(), pending: new Map(), loaded: false, loading: null, timer: null, flushing: null, moved: 0, conflicts: 0, error: '' };
  const LG = () => H.legacy || null;
  const fkName = key => String(key).replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) + '-' + C.hash8(key) + '.json';
  const fkDoc = (key, raw) => '{"format":"weld-data","v":1,"key":' + JSON.stringify(key) + ',"savedAt":' + Date.now() + ',"value":' + raw + '}';
  async function fkDirHandle(create) { return dirAt(F.handle, [FK_DIR], create); }
  async function fkFile(dir, name) { try { return await (await dir.getFileHandle(name)).getFile(); } catch (e) { return null; } }
  function fkReset() { FK.cache.clear(); FK.seen.clear(); FK.pending.clear(); FK.loaded = false; if (FK.timer) { clearTimeout(FK.timer); FK.timer = null; } fkChanged(); }
  function fkChanged() { try { if (typeof H.refreshTab === 'function') H.refreshTab(); } catch (e) {} }
  // Read every data file whose content changed since this tab last saw it (all of them the first time).
  async function fkLoad() {
    if (!ptReady()) return false;
    if (FK.loading) return FK.loading;
    FK.loading = (async () => {
      let changed = false;
      try {
        let dir = null; try { dir = await fkDirHandle(false); } catch (e) { dir = null; }
        if (dir) for (const name of await ptNames(dir)) {
          const f = await fkFile(dir, name); if (!f) continue;
          let doc; try { doc = JSON.parse(await f.text()); } catch (e) { continue; }
          if (!doc || doc.format !== 'weld-data' || typeof doc.key !== 'string' || fkName(doc.key) !== name || FK.pending.has(doc.key)) continue;
          if (FK.seen.get(doc.key) === f.lastModified && FK.cache.has(doc.key)) continue;
          FK.cache.set(doc.key, JSON.stringify(doc.value === undefined ? null : doc.value)); FK.seen.set(doc.key, f.lastModified); changed = true;
        }
        const first = !FK.loaded; FK.loaded = true; FK.error = '';
        if (first) { await fkMigrate(); changed = true; }
      } catch (e) { FK.error = 'Could not read Weld data files: ' + ((e && e.message) || e); }
      FK.loading = null;
      if (changed) fkChanged();
      if (host) scheduleDraw();
      return true;
    })();
    return FK.loading;
  }
  function fkGet(key, dflt) {
    if (FK.cache.has(key)) { const raw = FK.cache.get(key); if (raw === null) return dflt; try { return JSON.parse(raw); } catch (e) { return dflt; } }
    const lg = LG(), old = lg ? lg.get(key) : undefined;   // not moved yet (no folder access so far)
    return old === undefined ? dflt : old;
  }
  function fkSet(key, value) {
    if (!ptReady() || !FK.loaded) return false;
    let raw = null;
    if (value !== null && value !== undefined) { try { raw = JSON.stringify(value); } catch (e) { return false; } if (raw === undefined) return false; }
    FK.cache.set(key, raw); FK.pending.set(key, raw);
    if (!FK.timer) FK.timer = setTimeout(() => { FK.timer = null; fkFlush().catch(() => {}); }, FK_DELAY);
    return true;
  }
  async function fkFlush() {
    if (FK.flushing) { await FK.flushing; if (FK.pending.size && !FK.timer) return fkFlush(); return; }
    FK.flushing = (async () => {
      const batch = Array.from(FK.pending.entries()); FK.pending.clear();
      let dir; try { dir = await fkDirHandle(true); } catch (e) { batch.forEach(b => { if (!FK.pending.has(b[0])) FK.pending.set(b[0], b[1]); }); fkFail(e); return; }
      for (const [key, raw] of batch) {
        const name = fkName(key);
        try {
          const cur = await fkFile(dir, name);
          if (cur && (!FK.seen.has(key) || cur.lastModified > FK.seen.get(key))) {   // changed elsewhere since this tab read it: keep the newer file
            try { const doc = JSON.parse(await cur.text()); FK.cache.set(key, JSON.stringify(doc.value === undefined ? null : doc.value)); FK.seen.set(key, cur.lastModified); } catch (e) {}
            FK.conflicts++;
            try { H.toast('This was changed in another tab or on another computer, so your latest edit was not saved. The newer copy is shown.', 9000); } catch (e) {}
            fkChanged(); continue;
          }
          if (raw === null) { if (cur) await dir.removeEntry(name); FK.seen.delete(key); continue; }
          const w = await (await dir.getFileHandle(name, { create: true })).createWritable(); await w.write(fkDoc(key, raw)); await w.close();
          const after = await fkFile(dir, name); if (after) FK.seen.set(key, after.lastModified);
        } catch (e) { if (!FK.pending.has(key)) FK.pending.set(key, raw); fkFail(e); }
      }
    })();
    try { await FK.flushing; } finally { FK.flushing = null; }
  }
  function fkFail(e) {
    if (e && e.name === 'NotAllowedError') { F.perm = 'prompt'; armRegrant(); }
    FK.error = 'Could not save to the backup folder: ' + ((e && e.message) || e) + '. Weld retries on the next save.';
    try { H.toast(FK.error, 9000); } catch (x) {}
    if (host) scheduleDraw();
  }
  // Merge rules when the folder already has a key that browser storage also holds.
  function fkMerge(key, folderVal, oldVal) {
    const byId = (a, b) => { const seen = new Set((a || []).map(x => x && x.id)); return (a || []).concat((b || []).filter(x => x && !seen.has(x.id))); };
    if (key === 'scrapbook' && Array.isArray(folderVal) && Array.isArray(oldVal)) return { value: byId(folderVal, oldVal).sort((x, y) => ((y && y.t) || 0) - ((x && x.t) || 0)) };
    if (key === 'studio:index:v1' && Array.isArray(folderVal) && Array.isArray(oldVal)) return { value: byId(folderVal, oldVal) };
    const rev = v => (v && typeof v.revision === 'number' ? v.revision : -1);
    return rev(oldVal) > rev(folderVal) ? { value: oldVal, loser: folderVal } : { value: folderVal, loser: oldVal };
  }
  async function fkWriteVerified(dir, name, text) {
    const w = await (await dir.getFileHandle(name, { create: true })).createWritable(); await w.write(text); await w.close();
    const f = await fkFile(dir, name); return f && (await f.text()) === text ? f : null;
  }
  async function fkMigrate() {
    const lg = LG(); if (!lg || typeof lg.keys !== 'function') return;
    const keys = lg.keys().filter(k => lg.owns(k)); if (!keys.length) return;
    const dir = await fkDirHandle(true);
    let moved = 0;
    for (const key of keys) {
      const old = lg.get(key); if (old === undefined) continue;
      if (FK.cache.has(key) && FK.cache.get(key) === null) { lg.del(key); continue; }
      let value = old, loser;
      if (FK.cache.has(key)) { const m = fkMerge(key, JSON.parse(FK.cache.get(key)), old); value = m.value; loser = m.loser; }
      try {
        if (loser !== undefined && loser !== null) {   // keep the version that lost a revision tie-break as its own file
          const cdir = await dirAt(F.handle, [FK_DIR, 'conflicts'], true), stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
          if (!await fkWriteVerified(cdir, fkName(key).replace(/\.json$/, '') + '-' + stamp + '.json', fkDoc(key, JSON.stringify(loser)))) continue;
        }
        const raw = JSON.stringify(value), f = await fkWriteVerified(dir, fkName(key), fkDoc(key, raw));
        if (!f) continue;   // never remove from storage what is not provably on disk
        FK.cache.set(key, raw); FK.seen.set(key, f.lastModified); lg.del(key); moved++;
      } catch (e) { fkFail(e); return; }
    }
    if (moved) { FK.moved += moved; try { H.toast('Moved ' + moved + ' Studio/Scrapbook record' + (moved === 1 ? '' : 's') + ' out of browser storage into ' + F.name + '/' + FK_DIR + '.', 8000); } catch (e) {} }
  }
  function fkStatus() {
    if (!F.handle) return 'Saved in your backup folder. Choose one in Weld > Backups to save.';
    if (F.perm !== 'granted') return 'Saved in ' + F.name + '. Press Allow access in Weld > Backups (or click anywhere) to load and save.';
    return FK.loaded ? 'Saved in ' + F.name + '/' + FK_DIR : 'Loading from ' + F.name + '...';
  }
  // ---- GitHub repo store (1.90.0): ALL of Weld's work data and the generator vault live in <repo>/_weld-data/ (see
  // src/repo-store.js). Nothing is kept in browser storage and nothing is written to the backup folder any more.
  // A write that another computer got to first is merged, not overwritten; deletions are kept.
  const RP = window.WeldRepoStore.create({
    api: (m, path, body) => H.gh.api(m, path, body), config: () => H.gh.config(), toast: (t, ms) => { try { H.toast(t, ms); } catch (e) {} },
    encode: s => btoa(unescape(encodeURIComponent(s))), decode: b => decodeURIComponent(escape(atob(b)))
  });
  const rpLegacy = () => H.legacy || null;
  const repoFiles = {
    // Until the repo has been read, an older copy still in browser storage is shown (read-only) so screens are not blank.
    get: (key, dflt) => { if (RP.ready()) return RP.get(key, dflt); const lg = rpLegacy(), old = lg ? lg.get(key) : undefined; return old === undefined ? dflt : old; },
    set: (key, value) => RP.set(key, value), ready: () => RP.ready(), status: () => RP.status(), flush: () => RP.flush(), load: () => RP.load(), keys: () => RP.keys()
  };
  // One-time move of browser-storage copies (and of 1.89.x files in the backup folder) into the repo. The repo always wins:
  // a copy of a key the repo does not have is imported; any other copy is filed under _weld-data/legacy/ and then removed
  // from storage, so an old computer can never bring back something that was deleted.
  async function repoMigrate() {
    const lg = rpLegacy(); let moved = 0, filed = 0, held = 0;
    if (lg && typeof lg.keys === 'function') {
      for (const key of lg.keys().filter(k => lg.owns(k))) {
        const old = lg.get(key); if (old === undefined) continue;
        // Same rule as live vault saves: a chat copy with a plaintext secret-shaped config value stays on this computer.
        const vk = key.indexOf('sbk:') === 0 ? key.slice(key.indexOf(':', 4) + 1) : key;
        if (C.parseKey(vk).kind === 'chat-copy' && C.secretScan(old && old.data).length) { held++; continue; }
        const r = await RP.importLegacy(key, old, 'browser');
        if (r) { lg.del(key); if (r === 'moved') moved++; else filed++; }
      }
    }
    if (ptReady()) {   // 1.89.x kept these as files in the backup folder
      try {
        const dir = await fkDirHandle(false);
        for (const name of await ptNames(dir)) {
          const f = await fkFile(dir, name); if (!f) continue;
          let doc; try { doc = JSON.parse(await f.text()); } catch (e) { continue; }
          if (!doc || doc.format !== 'weld-data' || typeof doc.key !== 'string' || !/^(scrapbook|studio:.*)$/.test(doc.key)) continue;
          const mark = 'repoMigrated:' + name, sig = String(f.lastModified) + ':' + f.size;
          if ((await kvGet(mark)) === sig) continue;
          const r = await RP.importLegacy(doc.key, doc.value === undefined ? null : doc.value, 'folder');
          if (r) { await kvSet(mark, sig); if (r === 'moved') moved++; else filed++; }
        }
      } catch (e) {}
    }
    if (moved || filed) { try { H.toast('Moved ' + moved + ' record' + (moved === 1 ? '' : 's') + ' from this computer into your GitHub repo' + (filed ? ' (' + filed + ' older local cop' + (filed === 1 ? 'y' : 'ies') + ' filed under _weld-data/legacy)' : '') + '.', 9000); } catch (e) {} }
    if (held) { try { H.toast(held + ' chat cop' + (held === 1 ? 'y holds' : 'ies hold') + ' a plaintext secret-shaped value (an API key or token), so ' + (held === 1 ? 'it was' : 'they were') + ' kept in this browser and not sent to GitHub.', 9000); } catch (e) {} }
  }
  let repoTimer = null;
  async function repoRefresh() { try { await RP.load(); } catch (e) {} if (host) scheduleDraw(); }
  async function repoBoot() {
    RP.onChange(() => { try { if (typeof H.refreshTab === 'function') H.refreshTab(); } catch (e) {} });
    if (RP.configured()) { await RP.load(); if (RP.ready()) await repoMigrate(); }
    if (!repoTimer) repoTimer = setInterval(() => { if ((typeof document === 'undefined' || !document.hidden) && RP.configured()) RP.load().catch(() => {}); }, 60000); if (repoTimer && typeof repoTimer.unref === 'function') repoTimer.unref();   // pick up another computer's saves
    try { window.addEventListener('focus', () => { if (RP.configured()) RP.load().catch(() => {}); }); } catch (e) {}
    try { window.addEventListener('beforeunload', e => { if (RP.pending()) { RP.flush().catch(() => {}); e.preventDefault(); e.returnValue = ''; } }); } catch (e) {}
    if (host) scheduleDraw();
  }
  // Generator vault saves (Skybridge storage) go to the same repo store.
  async function rpVaultSet(caller, key, value) {
    if (!vaultReady()) return { ok: false, code: 'no-github-repo', reason: 'Weld keeps your data in your GitHub repo. Set owner, repo and token in Weld > GitHub and wait for it to load.' };
    const p = C.parseKey(key);
    if (!p.gen || p.gen !== caller || VAULT_KINDS.indexOf(p.kind) === -1) return { ok: false, code: 'bad-key', reason: 'bad-key' };
    if (value === null || value === undefined) { RP.set(key, null); return { ok: true, where: 'github' }; }
    if (C.checkStoreWrite(key, value).ok !== true) return { ok: false, code: 'owner-mismatch', reason: 'owner-mismatch' };
    if (p.kind === 'chat-copy' && C.secretScan(value && value.data).length) return { ok: false, code: 'secret-shaped', reason: 'this chat copy holds a plaintext secret-shaped value, so it was not written to the repo' };
    if (RP.get(key, undefined) !== undefined && C.canonical(RP.get(key, undefined)) === C.canonical(value)) return { ok: true, where: 'github' };
    if (!ptBudget(caller, Date.now())) return { ok: false, code: 'rate-limited', reason: 'too many vault saves from this generator; try again in a few minutes' };
    if (RP.get(key, undefined) === undefined && RP.truncated()) return { ok: false, code: 'folder-full', reason: 'the repo listing is too large to count vault entries safely; new entries are refused until some are deleted' };
    if (RP.get(key, undefined) === undefined && RP.keys().filter(k => k.indexOf('weld:genvault:' + caller + '/') === 0).length >= PT_MAX_FILES) return { ok: false, code: 'folder-full', reason: 'this generator already has ' + PT_MAX_FILES + ' vault entries in the repo; delete some first' };
    return RP.set(key, value) ? { ok: true, where: 'github' } : { ok: false, code: 'github-write-failed', reason: 'could not queue the save' };
  }
  async function rpVaultGet(caller, key) {
    if (!vaultReady()) return undefined;
    const p = C.parseKey(key); if (!p.gen || p.gen !== caller || VAULT_KINDS.indexOf(p.kind) === -1) return undefined;
    return RP.get(key, undefined);
  }
  async function rpVaultList(caller, prefix) {
    if (!vaultReady() || !C.GEN_RE.test(String(caller || ''))) return [];
    const base = 'weld:genvault:' + caller + '/';
    return RP.keys().filter(k => k.indexOf(base) === 0 && k.indexOf(String(prefix || '')) === 0).sort();
  }
  let migrating = null;
  function afterGrant() { if (RP.ready() && !migrating) migrating = repoMigrate().catch(() => {}).then(() => { migrating = null; }); }   // the folder holds manual exports only; Weld's data is in the GitHub repo (repoBoot)
  let syncTimer = null;
  function scheduleSync(ms) { if (syncTimer) clearTimeout(syncTimer); syncTimer = setTimeout(() => { syncTimer = null; syncToFolder(false, true).catch(() => {}); }, ms || 1500); }
  async function bootFolder() {
    F.supported = typeof pageWin().showDirectoryPicker === 'function'; F.auto = false; F.keep = H.get(KEEP_KEY, true) !== false;
    try { const h = await kvGet('handle'); if (h && typeof h.queryPermission === 'function') { F.handle = h; F.name = h.name; F.perm = await permission(h, false); } } catch (e) {}
    repoBoot().catch(() => {});
    try { window.addEventListener('pagehide', () => { if (FK.pending.size) fkFlush().catch(() => {}); }); } catch (e) {}
    try { window.addEventListener('focus', () => { recheckAccess().catch(() => {}); }); } catch (e) {}
    armRegrant();
    const v = V(); if (v && typeof v.onChange === 'function') v.onChange(() => { if (F.auto) scheduleSync(1500); });   // a generator saved: mirror it
    if (F.auto) scheduleSync(3000);
    if (host) draw();
  }
  function folderCard() {
    const card = E('div', { 'data-folder': '1', style: { border: '1px solid var(--wc-line,#555)', borderRadius: '8px', padding: '10px', margin: '8px 0' } });
    card.appendChild(E('div', { text: 'Backup location', style: { fontWeight: '600' } }));
    card.appendChild(E('div', { style: Object.assign({ marginBottom: '6px' }, small), text: 'Optional, for manual copies only. Weld keeps your data (Studio projects, Scrapbook, notes, pins, favorites, generator vault saves) in your GitHub repo under _weld-data/, set in Weld > GitHub. This folder is used only by the Save all to folder now button.' }));
    if (!F.supported) card.appendChild(E('div', { style: { fontSize: '12px', color: '#e0a030' }, text: 'This browser cannot open folders (Chrome or Edge can). The Download buttons below still work.' }));
    card.appendChild(E('div', { 'data-folder-state': '1', style: { fontSize: '12px', margin: '4px 0' }, text: F.handle ? 'Folder: ' + F.name + ' · ' + (F.perm === 'granted' ? 'access allowed' : 'needs permission (press Allow access)') : 'No folder chosen yet.' }));
    if (F.error) card.appendChild(E('div', { role: 'alert', style: { fontSize: '12px', color: '#ff9e92' }, text: F.error }));
    const row = E('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', margin: '6px 0' } });
    row.appendChild(btn(F.handle ? 'Change folder...' : 'Choose folder...', () => { chooseFolder(); }, { disabled: !F.supported }));
    if (F.handle && F.perm !== 'granted') row.appendChild(btn('Allow access', () => { allowFolder(); }));
    row.appendChild(btn('Save all to folder now', () => { syncToFolder(true); }, { disabled: !F.handle || F.perm !== 'granted' || F.busy }));
    if (F.handle) row.appendChild(btn('Disconnect folder', () => { forgetFolder(); }, { 'aria-label': 'Disconnect folder (nothing in it is deleted)' }));
    card.appendChild(row);
    const auto = E('input', { type: 'checkbox', 'aria-label': 'Save new backups to the folder automatically' }); auto.checked = F.auto;
    auto.addEventListener('change', () => setAuto(auto.checked));
    card.appendChild(E('label', { style: { display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px' } }, [auto, E('span', { text: 'Save new backups of starred generators to the folder automatically while Weld is open (needs access allowed; unstarred ones use the button above)' })]));
    const keep = E('input', { type: 'checkbox', 'aria-label': 'Keep folder access allowed' }); keep.checked = F.keep;
    keep.addEventListener('change', () => setKeep(keep.checked));
    card.appendChild(E('label', { style: { display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px' }, title: 'Chrome forgets folder access when it restarts. With this on, Weld re-requests it on your first click or key press. Pick "Allow on every visit" in Chrome\'s prompt to stop it forgetting at all.' }, [keep, E('span', { text: 'Keep access allowed (re-ask on my next click after a browser restart)' })]));
    card.appendChild(E('div', { 'data-weld-data': '1', style: { fontSize: '12px', marginTop: '6px' }, text: 'Studio projects and Scrapbook: ' + fkStatus() + (FK.loaded ? ' (' + Array.from(FK.cache.values()).filter(v => v !== null).length + ' file' + (Array.from(FK.cache.values()).filter(v => v !== null).length === 1 ? '' : 's') + ')' : '') + (FK.moved ? ' · moved ' + FK.moved + ' out of browser storage' : '') + '. Changing folder does not move these files; copy the ' + FK_DIR + ' folder yourself.' }));
    if (FK.error) card.appendChild(E('div', { role: 'alert', style: { fontSize: '12px', color: '#ff9e92' }, text: FK.error }));
    if (F.last && F.last.held.length) card.appendChild(E('div', { 'data-held': '1', style: { fontSize: '12px', marginTop: '6px', color: '#e0a030' }, text: 'Held back (plaintext secret-shaped values; not copied to your folder): ' + F.last.held.join(', ') }));
    return card;
  }
  function render(parent) {
    host = parent; S.msg = '';
    load();
    if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
    const v = V();
    if (v && typeof v.onChange === 'function') unsub = v.onChange(() => { if (host && host.isConnected !== false) { load(); draw(); } });
    draw();
  }
  // Redraws keep the reader where they were: scroll offsets of the panel and every opened section are restored.
  function scrolled(n) { const out = []; for (let x = n; x && x.nodeType === 1; x = x.parentNode) if (x.scrollTop > 0) out.push([x, x.scrollTop]); return out; }
  function remembered(d, id) { if (S.openGens.has(id)) d.open = true; d.addEventListener('toggle', () => { if (d.open) S.openGens.add(id); else S.openGens.delete(id); }); return d; }
  function draw() {
    const parent = host; if (!parent) return;
    const keepScroll = scrolled(parent);
    while (parent.firstChild) parent.removeChild(parent.firstChild);
    try { build(parent); } finally { keepScroll.forEach(x => { x[0].scrollTop = x[1]; }); }
  }
  function build(parent) {
    const rerender = () => draw();
    const wrap = E('div', { id: 'wc-backup-body' });
    wrap.appendChild(E('div', { text: 'Backup Manager', style: { fontWeight: '600', fontSize: '15px' } }));
    wrap.appendChild(note('Weld keeps no backups of its own and no data in browser storage: everything lives in your GitHub repo (_weld-data/). This tab lists, exports and purges anything older still held in browser storage.'));
    const top = E('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', margin: '8px 0' } });
    top.appendChild(btn('Refresh', () => { load(); draw(); }));
    top.appendChild(btn('Export all', () => exportRows('all-generators', S.rows || []), { disabled: !(S.rows && S.rows.length) }));
    top.appendChild(btn('Scan for plaintext secrets', () => { scanSecrets(); draw(); }, { disabled: !(S.rows && S.rows.length) }));
    top.appendChild(btn(S.busy ? 'Purging...' : 'Purge all Weld-stored backups', () => { purgeAll(); }, { disabled: S.busy, title: 'Removes every vault backup and the Project tab copies and snapshots from browser storage. Anything not yet on disk is saved to your backup folder (or downloaded) first.' }));
    wrap.appendChild(top);
    if (S.msg) wrap.appendChild(E('div', { role: 'status', 'aria-live': 'polite', style: { fontSize: '12px', margin: '4px 0', color: S.msgErr ? '#ff9e92' : '' }, text: S.msg }));
    if (S.error) { wrap.appendChild(E('div', { role: 'alert', style: { color: '#ff9e92', margin: '8px 0' }, text: S.error })); parent.appendChild(wrap); return; }
    const inv = S.inv, info = (V() && V().info && V().info()) || {};
    wrap.appendChild(E('div', { 'data-summary': '1', style: Object.assign({ margin: '4px 0 10px' }, small), text:
      (info.backend || 'Userscript storage') + ' · ' + inv.count + ' backup key' + (inv.count === 1 ? '' : 's') + ' still in browser storage · ' + C.fmtBytes(inv.bytes) +
      (info.quota ? ' · browser storage ' + C.fmtBytes(info.usage || 0) + ' of ' + C.fmtBytes(info.quota) : '') }));
    if (!inv.count) wrap.appendChild(note('Nothing is held in Weld storage. Generator vault saves land in your backup folder.'));
    wrap.appendChild(folderCard());
    wrap.appendChild(cleanupCard());
    wrap.appendChild(familyCard(rerender));
    inv.generators.forEach(g => {
      const d = remembered(E('details', { 'data-gen': g.gen, style: { margin: '6px 0' } }), 'gen:' + g.gen);
      if (S.selected && g.keys.some(k => k.gmKey === S.selected)) { d.open = true; S.openGens.add('gen:' + g.gen); }
      d.appendChild(E('summary', { text: g.gen + ' — ' + (g.snapshot ? 'source copy ' + (g.snapshot.stale ? '(stale)' : (g.snapshot.at ? C.fmtDate(g.snapshot.at) : 'present')) : 'no source copy') + ', ' + g.chats + ' chat cop' + (g.chats === 1 ? 'y' : 'ies') + ', ' + C.fmtBytes(g.bytes) +
        (g.newest ? ', newest ' + C.fmtDate(g.newest).slice(0, 10) : '') + (g.oldest && g.oldest !== g.newest ? ', oldest ' + C.fmtDate(g.oldest).slice(0, 10) : '') + (g.stale ? ', ' + g.stale + ' stale' : '') }));
      d.appendChild(E('div', { style: { padding: '2px 0 4px 12px' } }, [btn('Export folder', () => exportRows(g.gen, g.keys), { 'aria-label': 'Export folder ' + g.gen })]));
      g.keys.forEach(r => d.appendChild(E('div', { style: { paddingLeft: '12px' } }, [rowLine(r, true, rerender)])));
      wrap.appendChild(d);
    });
    function plain(title, rows, canDelete, why) {
      if (!rows.length) return;
      const d = remembered(E('details', { 'data-section': title, style: { margin: '6px 0' } }), 'section:' + title);
      d.appendChild(E('summary', { text: title + ' (' + rows.length + ')' }));
      d.appendChild(E('div', { style: Object.assign({ padding: '2px 0 4px 12px' }, small), text: why }));
      rows.forEach(r => d.appendChild(E('div', { style: { paddingLeft: '12px' } }, [rowLine(r, canDelete, rerender)])));
      wrap.appendChild(d);
    }
    plain('Legacy (dadchat:vault)', inv.legacy, true, 'Old-format vault keys. This tab never migrates or renames them; Delete or Purge removes them.');
    plain('Operational keys', inv.operational, false, 'Small link and self-test records. Display only.');
    plain('Other vault-prefix keys', inv.other, true, 'Keys under weld:genvault: whose folder name is not a valid generator name.');
    if (S.secrets) {
      wrap.appendChild(E('div', { text: 'Secret scan', style: { fontWeight: '600', marginTop: '10px' } }));
      if (!S.secrets.length) wrap.appendChild(note('No plaintext secret-shaped values found.'));
      S.secrets.forEach(h => wrap.appendChild(E('div', { 'data-secret': '1', style: { fontSize: '12px' }, text: '⚠ ' + h.key + ': ' + h.paths.join(', ') + ' (value hidden)' })));
    }
    wrap.appendChild(inspector(rerender));
    parent.appendChild(wrap);
  }
  bootFolder().catch(() => {});
  // vault: the pass-through store Skybridge storage uses for weld:genvault: keys (see sbServiceStorage).
  // files: the folder store behind Weld's storage helpers for Studio projects and the Scrapbook (see gget/gset).
  window.weldBackup = { render, purge: purgeAll, _sync: syncToFolder, _state: F, vault: { ready: vaultReady, set: rpVaultSet, get: rpVaultGet, list: rpVaultList, noFolder: 'Weld keeps your data in your GitHub repo. Set owner, repo and token in Weld > GitHub.' },
    files: repoFiles, repo: RP };
})();
