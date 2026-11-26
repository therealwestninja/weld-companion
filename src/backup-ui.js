/* Backups tab: manage, examine, extract and maintain generator backup copies held in companion storage.
   Read-only except the exact-key Delete action. Record contents are never logged or sent anywhere. */
(function () {
  'use strict';
  if (window.top !== window) return;
  const C = window.WeldBackupCore, H = window.weldProjectHost;
  if (!C || !H) return;
  const E = H.el;
  const S = { pick: '', rows: null, inv: null, error: '', selected: null, inspected: null, pendingDelete: null, secrets: null, msg: '', stamp: 0 };
  let host = null, unsub = null;
  const note = t => E('div', { class: 'wc-section-note', text: t });
  const small = { fontSize: '12px', opacity: '.75' };
  const LINE = '1px solid var(--wc-line,#555)';   // the standard divider/border (the red #c0392b border is a deliberate exception)
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
    S.pendingDelete = null;
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
    const rec = full(gmKey); S.selected = gmKey; S.pendingDelete = null; S.secrets = null;
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
  function runDelete(gmKey) {
    const row = (S.rows || []).find(r => r.gmKey === gmKey);
    if (!row) { say('That key no longer exists.', true); return; }
    let res; try { res = V().remove(gmKey); } catch (e) { res = { ok: false, reason: 'error' }; }
    say(res && res.ok ? 'Deleted ' + row.key + '. Only that key was removed.' : 'Delete failed: ' + ((res && res.reason) || 'unknown') + '.', !(res && res.ok));
    S.selected = null; S.inspected = null; load();
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
    if (canDelete) line.appendChild(btn('Delete', () => { S.pendingDelete = r.gmKey; rerender(); }, { 'aria-label': 'Delete ' + r.key }));
    return line;
  }
  function confirmBar(rerender) {
    const row = (S.rows || []).find(r => r.gmKey === S.pendingDelete); if (!row) return null;
    const p = C.parseKey(row.key);
    return E('div', { role: 'alertdialog', 'aria-label': 'Confirm delete', style: { border: '1px solid #c0392b', borderRadius: '8px', padding: '10px', margin: '8px 0' } }, [
      E('div', { text: 'Delete ' + (p.gen ? 'generator "' + p.gen + '"' : 'record') + ' key ' + row.key + '? This removes only that one key and cannot be undone.' }),
      E('div', { style: Object.assign({ marginTop: '4px' }, small), text: 'If this is a chat copy, its generator\'s chat index is not edited. Index cleanup is the generator\'s job.' }),
      E('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } }, [
        btn('Confirm delete', () => runDelete(row.gmKey)),
        btn('Cancel', () => { S.pendingDelete = null; rerender(); })
      ])
    ]);
  }
  function inspector(rerender) {
    const i = S.inspected; if (!i) return note('Select Inspect on a record to see its details.');
    const wrap = E('div', { 'aria-label': 'Record inspector', style: { borderTop: LINE, marginTop: '12px', paddingTop: '10px' } });
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
    const card = E('div', { 'data-family': '1', style: { border: LINE, borderRadius: '8px', padding: '10px', margin: '8px 0' } });
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
  const AUTO_KEY = 'backupFolderAuto';
  const F = { supported: false, handle: null, name: '', perm: 'none', auto: false, busy: false, error: '', last: null };
  const folderReady = () => !!F.handle && F.perm === 'granted';   // the backup folder is chosen AND access is allowed
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
    } catch (e) { if (!(e && e.name === 'AbortError')) F.error = (e && e.message) || String(e); }
    draw();
  }
  async function allowFolder() {
    if (!F.handle) return;
    F.perm = await permission(F.handle, true); F.error = F.perm === 'granted' ? '' : 'Permission was not granted.'; draw();
  }
  async function forgetFolder() {
    F.handle = null; F.name = ''; F.perm = 'none'; await kvDel('handle'); say('Backup folder disconnected. Nothing in it was deleted.'); draw();
  }
  function setAuto(on) { F.auto = !!on; H.set(AUTO_KEY, F.auto); if (F.auto) scheduleSync(300); draw(); }
  async function dirAt(root, segs, create) { let d = root; for (const s of segs) d = await d.getDirectoryHandle(s, { create }); return d; }
  async function exists(dir, name) {
    try { await dir.getFileHandle(name); return true; } catch (e) { if (e && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')) return false; throw e; }
  }
  // Copy every readable, non-stale record into the folder. Records holding plaintext secret-shaped values are held back.
  async function syncToFolder(manual) {
    if (F.busy) return; if (!folderReady()) { if (manual) { F.error = 'Choose a backup folder and allow access first.'; draw(); } return; }
    F.busy = true; const res = { at: Date.now(), written: 0, skipped: 0, held: [], failed: 0 };
    try {
      load();
      for (const row of (S.rows || [])) {
        const rec = full(row.gmKey);
        if (!rec || rec.unreadable || rec.parseError) { res.failed++; continue; }
        if (rec.stale) { res.skipped++; continue; }
        if (C.parseKey(rec.key).kind === 'chat-copy' && rec.value && C.secretScan(rec.value.data).length) { res.held.push(rec.key); continue; }
        try {
          const t = C.backupTarget(rec), dir = await dirAt(F.handle, t.dir, true);
          if (await exists(dir, t.name)) { res.skipped++; continue; }
          const w = await (await dir.getFileHandle(t.name, { create: true })).createWritable();
          await w.write(JSON.stringify({ format: 'weld-backup-record', v: 1, exportedAt: Date.now(), record: C.entryFor(rec) }, null, 2)); await w.close(); res.written++;
        } catch (e) { res.failed++; if (e && e.name === 'NotAllowedError') { F.perm = 'prompt'; break; } }
      }
      F.last = res; F.error = '';
      say('Saved ' + res.written + ' new file' + (res.written === 1 ? '' : 's') + ' to ' + F.name + ' (' + res.skipped + ' already there' + (res.held.length ? ', ' + res.held.length + ' held back for secret-shaped values' : '') + (res.failed ? ', ' + res.failed + ' failed' : '') + ').', res.failed > 0);
    } catch (e) { F.error = 'Save to folder failed: ' + ((e && e.message) || e); }
    F.busy = false; if (manual || host) draw();
  }
  // ---- load from folder: the other direction. Reads weld-backup files already in the folder (for example saved by
  // Weld on another computer into a shared Google Drive folder), shows what would change, and writes only after Apply.
  const L = { busy: false, plan: null, files: 0, unreadable: 0, msg: '' };
  async function readJsonFiles(dir, depth, out) {
    for await (const entry of dir.entries()) {
      const name = entry[0], h = entry[1];
      if (out.length + L.unreadable > 5000) return;
      if (h.kind === 'directory') { if (depth < 5) await readJsonFiles(h, depth + 1, out); continue; }
      if (!/\.json$/i.test(name)) continue;
      try { const f = await h.getFile(); if (f.size > 64 * 1048576) { L.unreadable++; continue; } out.push(JSON.parse(await f.text())); } catch (e) { L.unreadable++; }
    }
  }
  async function scanFolder() {
    if (L.busy) return;
    if (!folderReady()) { F.error = 'Choose a backup folder and allow access first.'; draw(); return; }
    L.busy = true; L.plan = null; L.unreadable = 0; L.msg = ''; draw();
    try {
      load();
      const byId = new Map(), keys = new Set();
      (S.rows || []).forEach(r => { byId.set(r.caller + '\u0000' + r.key, r); keys.add(r.key); });
      const docs = []; await readJsonFiles(F.handle, 0, docs); L.files = docs.length;
      L.plan = C.planImport(docs, {
        has: k => keys.has(k),
        get: (c, k) => { const r = byId.get(c + '\u0000' + k); if (!r) return undefined; if (r.stale || r.parseError) return null; const rec = full(r.gmKey); return rec && !rec.unreadable && !rec.parseError ? rec.value : null; }
      });
      F.error = '';
    } catch (e) { F.error = 'Could not read the folder: ' + ((e && e.message) || e); }
    L.busy = false; draw();
  }
  async function applyImport() {
    const plan = L.plan; if (!plan || L.busy) return;
    L.busy = true; draw();
    try {
      await syncToFolder(false);   // first save what is here, so a replaced snapshot still exists as a file in the folder
      let ok = 0, bad = 0;
      plan.add.concat(plan.update).forEach(it => { let r; try { r = V().write(it.caller, it.key, it.value); } catch (e) { r = { ok: false }; } if (r && r.ok) ok++; else bad++; });
      L.plan = null; load();
      L.msg = 'Loaded ' + ok + ' record' + (ok === 1 ? '' : 's') + ' from ' + F.name + (bad ? ' (' + bad + ' failed)' : '') + '. Reload the generator tab so it reads them.';
      say(L.msg, bad > 0);
    } catch (e) { F.error = 'Load failed: ' + ((e && e.message) || e); }
    L.busy = false; draw();
  }
  function importCard() {
    const wrap = E('div', { 'data-import': '1', style: { marginTop: '8px', paddingTop: '8px', borderTop: LINE } });
    wrap.appendChild(E('div', { style: Object.assign({ marginBottom: '6px' }, small), text: 'Load copies that other computers saved into this folder. You see what would change first. Chat copies already here are never overwritten; a source copy is replaced only by a newer one.' }));
    wrap.appendChild(btn(L.busy ? 'Working...' : 'Check folder for new saves', () => { scanFolder(); }, { disabled: !folderReady() || L.busy || F.busy }));
    const p = L.plan;
    if (p) {
      const n = p.add.length + p.update.length, sk = p.skipped;
      wrap.appendChild(E('div', { 'data-import-summary': '1', style: { fontSize: '12px', margin: '6px 0' }, text: 'Read ' + L.files + ' file' + (L.files === 1 ? '' : 's') + (L.unreadable ? ' (' + L.unreadable + ' unreadable)' : '') + ': ' + p.add.length + ' new, ' + p.update.length + ' updated. Left alone: ' + (sk.present + sk.unchanged + sk.older) + ' already here or older, ' + (sk.operational + sk.legacy) + ' device-specific or legacy' + (sk.held ? ', ' + sk.held + ' held back for secret-shaped values' : '') + (sk.tombstoned ? ', ' + sk.tombstoned + ' deleted here on purpose' : '') + (sk.invalid ? ', ' + sk.invalid + ' not recognized or malformed' : '') + '.' }));
      p.add.concat(p.update).slice(0, 60).forEach(it => wrap.appendChild(E('div', { style: { fontSize: '12px', wordBreak: 'break-all' }, text: (it.action === 'new' ? 'NEW ' : it.action === 'newer' ? 'NEWER ' : 'MERGE ') + it.key + ' · ' + C.fmtBytes(it.bytes) + ' · ' + it.note })));
      if (n > 60) wrap.appendChild(E('div', { style: small, text: '...and ' + (n - 60) + ' more.' }));
      if (!n) wrap.appendChild(E('div', { style: { fontSize: '12px' }, text: 'Everything in the folder is already here.' }));
      else wrap.appendChild(E('div', { style: { display: 'flex', gap: '8px', marginTop: '6px' } }, [btn('Apply ' + n + ' change' + (n === 1 ? '' : 's'), () => { applyImport(); }, { disabled: L.busy }), btn('Cancel', () => { L.plan = null; draw(); })]));
    }
    return wrap;
  }
  // ---- cleanup: duplicates. Exact duplicates can be removed in one step (after they are safely in the folder);
  // near duplicates are only listed and can be sent to the AI helper for a second opinion.
  const D = { found: null, sel: new Set(), busy: false, secretsLeft: 0 };
  function findDups() {
    load();
    const recs = [];
    (S.rows || []).forEach(r => { const k = C.parseKey(r.key).kind; if (r.stale || r.parseError || (k !== 'chat-copy' && k !== 'snapshot')) return; const rec = full(r.gmKey); if (rec && !rec.unreadable && !rec.parseError) recs.push({ key: r.key, caller: r.caller, value: rec.value }); });
    try { D.found = C.findDuplicates(recs); }
    catch (e) { D.found = { exact: [], near: [], left: 0, skipped: 0 }; say('Could not scan for duplicates — some copies could not be compared. Nothing was changed.'); draw(); return; }
    D.sel = new Set();
    D.found.exact.forEach(g => g.drop.forEach(x => D.sel.add(x.caller + '\u0000' + x.key)));
    const skipNote = D.found.skipped ? ' ' + D.found.skipped + ' cop' + (D.found.skipped === 1 ? 'y' : 'ies') + ' could not be compared and were left alone.' : '';
    say((D.found.exact.length || D.found.near.length ? 'Found ' + D.found.exact.length + ' exact duplicate group' + (D.found.exact.length === 1 ? '' : 's') + ' and ' + D.found.near.length + ' possible group' + (D.found.near.length === 1 ? '' : 's') + '.' : 'No duplicates found.') + skipNote);
    draw();
  }
  function askAIAboutDups() {
    if (!D.found) return;
    try { H.openAI('Review these backup copies. For each group say which copies are safe to delete and which to keep, and why. Prefer keeping the newest, and keep any copy whose message count is higher.\n\n' + C.duplicateReport(D.found), 'none'); }
    catch (e) { say('Could not open the AI helper: ' + ((e && e.message) || e), true); draw(); }
  }
  async function runCleanup() {
    if (!D.found || D.busy) return;
    if (!folderReady()) { say('Choose a backup folder and allow access first. Duplicates are only deleted after they are safely saved there.', true); return draw(); }
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
    const card = E('div', { 'data-cleanup': '1', style: { border: LINE, borderRadius: '8px', padding: '10px', margin: '8px 0' } });
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
    if (f.exact.length) row.appendChild(btn('Delete ' + D.sel.size + ' selected duplicate' + (D.sel.size === 1 ? '' : 's'), () => { runCleanup(); }, { disabled: D.busy || !D.sel.size || !folderReady() }));
    card.appendChild(row);
    if (f.exact.length && (!folderReady())) card.appendChild(note('Deleting needs a backup folder with access allowed, so every copy is saved first.'));
    return card;
  }
  let syncTimer = null;
  function scheduleSync(ms) { if (syncTimer) clearTimeout(syncTimer); syncTimer = setTimeout(() => { syncTimer = null; syncToFolder(false).catch(() => {}); }, ms || 1500); }
  async function bootFolder() {
    F.supported = typeof pageWin().showDirectoryPicker === 'function'; F.auto = H.get(AUTO_KEY, false) === true;
    try { const h = await kvGet('handle'); if (h && typeof h.queryPermission === 'function') { F.handle = h; F.name = h.name; F.perm = await permission(h, false); } } catch (e) {}
    const v = V(); if (v && typeof v.onChange === 'function') v.onChange(() => { if (F.auto) scheduleSync(1500); });   // a generator saved: mirror it
    if (F.auto) scheduleSync(3000);
    if (host) draw();
  }
  function folderCard() {
    const card = E('div', { 'data-folder': '1', style: { border: LINE, borderRadius: '8px', padding: '10px', margin: '8px 0' } });
    card.appendChild(E('div', { text: 'Backup location', style: { fontWeight: '600' } }));
    card.appendChild(E('div', { style: Object.assign({ marginBottom: '6px' }, small), text: 'Choose any folder on a drive or inside a cloud-synced folder (Google Drive, OneDrive, iCloud, Dropbox). Copies are saved there as files that are only ever added: nothing is overwritten or deleted, so browser cache clears cannot touch them.' }));
    if (!F.supported) card.appendChild(E('div', { style: { fontSize: '12px', color: '#e0a030' }, text: 'This browser cannot open folders (Chrome or Edge can). The Download buttons below still work.' }));
    card.appendChild(E('div', { 'data-folder-state': '1', style: { fontSize: '12px', margin: '4px 0' }, text: F.handle ? 'Folder: ' + F.name + ' · ' + (F.perm === 'granted' ? 'access allowed' : 'needs permission (press Allow access)') : 'No folder chosen yet.' }));
    if (F.error) card.appendChild(E('div', { role: 'alert', style: { fontSize: '12px', color: '#ff9e92' }, text: F.error }));
    const row = E('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', margin: '6px 0' } });
    row.appendChild(btn(F.handle ? 'Change folder...' : 'Choose folder...', () => { chooseFolder(); }, { disabled: !F.supported }));
    if (F.handle && F.perm !== 'granted') row.appendChild(btn('Allow access', () => { allowFolder(); }));
    row.appendChild(btn('Save all to folder now', () => { syncToFolder(true); }, { disabled: !folderReady() || F.busy }));
    if (F.handle) row.appendChild(btn('Disconnect folder', () => { forgetFolder(); }, { 'aria-label': 'Disconnect folder (nothing in it is deleted)' }));
    card.appendChild(row);
    const auto = E('input', { type: 'checkbox', 'aria-label': 'Save new backups to the folder automatically' }); auto.checked = F.auto;
    auto.addEventListener('change', () => setAuto(auto.checked));
    card.appendChild(E('label', { style: { display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px' } }, [auto, E('span', { text: 'Save new backups to the folder automatically while Weld is open (needs access allowed)' })]));
    if (F.handle) card.appendChild(importCard());
    if (F.last && F.last.held.length) card.appendChild(E('div', { 'data-held': '1', style: { fontSize: '12px', marginTop: '6px', color: '#e0a030' }, text: 'Held back (plaintext secret-shaped values; not copied to your folder): ' + F.last.held.join(', ') }));
    return card;
  }
  function render(parent) {
    host = parent; S.msg = '';
    load();
    if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
    const v = V();
    if (v && typeof v.onChange === 'function') unsub = v.onChange(() => { if (host && host.isConnected !== false && !S.pendingDelete) { load(); draw(); } });
    draw();
  }
  function draw() {
    const parent = host; if (!parent) return;
    while (parent.firstChild) parent.removeChild(parent.firstChild);
    const rerender = () => draw();
    const wrap = E('div', { id: 'wc-backup-body' });
    wrap.appendChild(E('div', { text: 'Backup Manager', style: { fontWeight: '600', fontSize: '15px' } }));
    wrap.appendChild(note('Look after the generator backup copies kept in this companion. You can inspect and download them, and delete a single key. This tab never edits, moves or repairs a record; generators own their own data.'));
    const top = E('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', margin: '8px 0' } });
    top.appendChild(btn('Refresh', () => { load(); draw(); }));
    top.appendChild(btn('Export all', () => exportRows('all-generators', S.rows || []), { disabled: !(S.rows && S.rows.length) }));
    top.appendChild(btn('Scan for plaintext secrets', () => { scanSecrets(); draw(); }, { disabled: !(S.rows && S.rows.length) }));
    wrap.appendChild(top);
    if (S.msg) wrap.appendChild(E('div', { role: 'status', 'aria-live': 'polite', style: { fontSize: '12px', margin: '4px 0', color: S.msgErr ? '#ff9e92' : '' }, text: S.msg }));
    if (S.error) { wrap.appendChild(E('div', { role: 'alert', style: { color: '#ff9e92', margin: '8px 0' }, text: S.error })); parent.appendChild(wrap); return; }
    const inv = S.inv, info = (V() && V().info && V().info()) || {};
    wrap.appendChild(E('div', { 'data-summary': '1', style: Object.assign({ margin: '4px 0 10px' }, small), text:
      (info.backend || 'Userscript storage') + ' · ' + inv.count + ' backup key' + (inv.count === 1 ? '' : 's') + ' · ' + C.fmtBytes(inv.bytes) + ' used by backups' +
      (info.quota ? ' · browser storage ' + C.fmtBytes(info.usage || 0) + ' of ' + C.fmtBytes(info.quota) : '') }));
    if (!inv.count) wrap.appendChild(note('No generator backups are stored yet. They appear here after a generator saves a copy through Skybridge storage.'));
    wrap.appendChild(folderCard());
    wrap.appendChild(cleanupCard());
    wrap.appendChild(familyCard(rerender));
    const bar = confirmBar(rerender); if (bar) wrap.appendChild(bar);
    inv.generators.forEach(g => {
      const d = E('details', { 'data-gen': g.gen, style: { margin: '6px 0' } });
      if (S.selected && g.keys.some(k => k.gmKey === S.selected) || g.keys.some(k => k.gmKey === S.pendingDelete)) d.open = true;
      d.appendChild(E('summary', { text: g.gen + ' — ' + (g.snapshot ? 'source copy ' + (g.snapshot.stale ? '(stale)' : (g.snapshot.at ? C.fmtDate(g.snapshot.at) : 'present')) : 'no source copy') + ', ' + g.chats + ' chat cop' + (g.chats === 1 ? 'y' : 'ies') + ', ' + C.fmtBytes(g.bytes) +
        (g.newest ? ', newest ' + C.fmtDate(g.newest).slice(0, 10) : '') + (g.oldest && g.oldest !== g.newest ? ', oldest ' + C.fmtDate(g.oldest).slice(0, 10) : '') + (g.stale ? ', ' + g.stale + ' stale' : '') }));
      d.appendChild(E('div', { style: { padding: '2px 0 4px 12px' } }, [btn('Export folder', () => exportRows(g.gen, g.keys), { 'aria-label': 'Export folder ' + g.gen })]));
      g.keys.forEach(r => d.appendChild(E('div', { style: { paddingLeft: '12px' } }, [rowLine(r, true, rerender)])));
      wrap.appendChild(d);
    });
    function plain(title, rows, canDelete, why) {
      if (!rows.length) return;
      const d = E('details', { 'data-section': title, style: { margin: '6px 0' } });
      d.appendChild(E('summary', { text: title + ' (' + rows.length + ')' }));
      d.appendChild(E('div', { style: Object.assign({ padding: '2px 0 4px 12px' }, small), text: why }));
      rows.forEach(r => d.appendChild(E('div', { style: { paddingLeft: '12px' } }, [rowLine(r, canDelete, rerender)])));
      wrap.appendChild(d);
    }
    plain('Legacy (dadchat:vault)', inv.legacy, false, 'Read-only. Generators own the migration of these keys; this tab never migrates, renames or cleans them.');
    plain('Operational keys', inv.operational, false, 'Small link and self-test records. Display only.');
    plain('Other vault-prefix keys', inv.other, true, 'Keys under weld:genvault: whose folder name is not a valid generator name.');
    if (S.secrets) {
      wrap.appendChild(E('div', { text: 'Secret scan', style: { fontWeight: '600', marginTop: '10px' } }));
      if (!S.secrets.length) wrap.appendChild(note('No plaintext secret-shaped config values found.'));
      S.secrets.forEach(h => wrap.appendChild(E('div', { 'data-secret': '1', style: { fontSize: '12px' }, text: '⚠ ' + h.key + ': ' + h.paths.join(', ') + ' (value hidden)' })));
    }
    wrap.appendChild(inspector(rerender));
    parent.appendChild(wrap);
  }
  bootFolder().catch(() => {});
  window.weldBackup = { render, _sync: syncToFolder, _state: F };
})();
