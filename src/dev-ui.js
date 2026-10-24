/* Dev tab: folder sync, agent bridge, edit proposals, GitHub agent hand-off, refactoring, editor markers
   and regression checks. Every change to the editor is shown as a diff and needs your click. */
(function () {
  'use strict';
  if (window.top !== window) return;
  const P = window.WeldProjectCore, D = window.WeldDevCore, H = window.weldProjectHost;
  if (!P || !D || !H) return;
  const E = H.el;
  const GM_KEYS = { bridge: 'bridge', folder: 'folderSync', agents: 'agentHandoff', markers: 'devMarkers', baseline: 'baseline:' };
  const MARK_COLORS = { error: '#e5534b', warn: '#d29922', info: '#768390' };

  const F = { supported: false, handle: null, name: '', perm: 'none', cfg: { autoMirror: false, watch: true, keepAccess: true, dslPath: '', htmlPath: '' },
    plan: null, slug: '', error: '', busy: false, lastCheck: 0, notified: '', seeding: '', folders: null, bootDone: false, revision: null,
    projectBusy: false, projectCheck: 0, projectSlug: '', projectStatus: '', projectError: '', projectCancel: 0 };
  const B = { cfg: { url: 'http://127.0.0.1:8765', token: '', auto: false, allowSample: false, allowPropose: true }, state: 'off', error: '', running: false, calls: 0, last: '', backoff: 0,
    cid: 'w' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36) };
  const S = { proposals: [], seq: 0, view: null, markers: false, markInfo: false, refactor: { name: '', to: '', usages: null, preview: null, error: '' },
    agents: { request: '', mode: 'auto', agent: 'copilot', result: null, busy: false, repoState: '', error: '' }, regress: { n: 30, via: 'visible', busy: false, result: null, error: '' }, open: {}, status: '' };

  function notice(m) { S.status = m; H.toast(m, 6000); }
  function draw() { const host = document.getElementById('wc-dev-body'); if (host && host.isConnected && host.parentNode) render(host.parentNode); }
  const norm = t => String(t == null ? '' : t).replace(/\r\n?/g, '\n');
  const ago = t => { const s = Math.round((Date.now() - (+t || 0)) / 1000); if (s < 60) return s + 's ago'; const m = Math.round(s / 60); if (m < 90) return m + ' min ago'; return Math.round(m / 60) + ' h ago'; };
  const source = () => (window.weldProject && window.weldProject.current && window.weldProject.current()) || null;

  // ------------------------------------------------------------ small storage
  let dbp = null; const mem = new Map();
  function kvdb() {
    if (dbp) return dbp;
    dbp = new Promise(resolve => {
      try {
        const open = indexedDB.open('weldCompanionFolder', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onsuccess = () => resolve(open.result); open.onerror = () => resolve(null); open.onblocked = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return dbp;
  }
  function kvOp(mode, fn) {
    return kvdb().then(d => new Promise((resolve, reject) => {
      if (!d) return reject(new Error('no-db'));
      try { const t = d.transaction('kv', mode), r = fn(t.objectStore('kv')); t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error); } catch (e) { reject(e); }
    }));
  }
  const kvGet = k => kvOp('readonly', s => s.get(k)).then(v => (v === undefined ? mem.get(k) : v), () => mem.get(k));
  const kvSet = (k, v) => kvOp('readwrite', s => s.put(v, k)).catch(() => { mem.set(k, v); });
  const kvDel = k => kvOp('readwrite', s => s.delete(k)).catch(() => {}).then(() => { mem.delete(k); });

  // ------------------------------------------------------------- folder sync
  const win = () => { try { return H.pageWindow ? H.pageWindow() : window; } catch (e) { return window; } };
  function folderCfg() { const c = H.get(GM_KEYS.folder, {}) || {}; F.cfg = Object.assign({ autoMirror: false, watch: true, keepAccess: true, dslPath: '', htmlPath: '', projectBackups: {}, showPanel: false }, c); F.cfg.autoMirror = false; F.cfg.projectBackups = {}; return F.cfg; }   // 1.90.0: the master folder is manual export only; Weld's data lives in the GitHub repo
  function saveFolderCfg() { H.set(GM_KEYS.folder, F.cfg); }
  function folderBaseKey(slug) { return 'base:' + (F.revision ? F.revision + ':' : '') + slug; }
  async function refreshMasterFolder() {
    folderCfg();
    const revision = F.cfg.revision || '';
    if (F.revision === revision) return;
    // Reuse the existing handle store so already-connected folders survive this update.
    const h = await kvGet('handle');
    F.handle = h && typeof h.queryPermission === 'function' ? h : null;
    F.name = F.handle ? F.handle.name : '';
    F.perm = F.handle ? await permission(F.handle, false) : 'none';
    F.revision = revision; F.plan = null; F.folders = null; F.baseKey = ''; F.notified = ''; F.error = '';
    if (S.view && S.view.kind === 'folder') S.view = null;
    armRegrant(); draw();
  }
  function pauseFolderWrites() {
    F.projectCancel++;
    folderCfg(); F.cfg.autoMirror = false; F.cfg.projectBackups = {}; saveFolderCfg();
    notice('Automatic Dev folder writes paused for all generators and open tabs.'); draw();
  }
  async function dirFor(root, rel, create) {
    const segs = rel.split('/'), name = segs.pop(); let dir = root;
    for (const s of segs) dir = await dir.getDirectoryHandle(s, { create });
    return { dir, name };
  }
  async function fsRead(root, rel) {
    try {
      const { dir, name } = await dirFor(root, rel, false), f = await (await dir.getFileHandle(name)).getFile();
      return { text: await f.text(), mtime: f.lastModified };
    } catch (e) { if (e && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')) return null; throw e; }
  }
  async function fsWrite(root, rel, text) {
    const { dir, name } = await dirFor(root, rel, true), w = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await w.write(text); await w.close();
  }
  const paths = slug => D.folderPaths(slug, F.cfg);
  async function readPair(slug) {
    await refreshMasterFolder();
    if (!F.handle || F.perm !== 'granted') return null;
    const handle = F.handle, p = paths(slug), a = await fsRead(handle, p.dsl);
    if (!a) return null;
    const b = await fsRead(handle, p.html);
    return { dsl: norm(a.text), html: b ? norm(b.text) : null, mtime: Math.max(a.mtime, b ? b.mtime : 0) };
  }
  async function writePair(slug, dsl, html, expectedRevision) {
    await refreshMasterFolder();
    if (expectedRevision !== undefined && (F.revision !== expectedRevision || !F.cfg.autoMirror)) return false;
    if (!F.handle || F.perm !== 'granted') throw new Error('Choose a master Dev folder and allow access first.');
    const handle = F.handle, p = paths(slug);
    await fsWrite(handle, p.dsl, dsl);
    if (html != null) await fsWrite(handle, p.html, html);
    return true;
  }
  async function permission(handle, ask) {
    try {
      let st = await handle.queryPermission({ mode: 'readwrite' });
      if (st !== 'granted' && ask) st = await handle.requestPermission({ mode: 'readwrite' });
      return st;
    } catch (e) { return 'denied'; }
  }
  async function connectFolder() {
    if (!F.supported) return notice('This browser cannot open folders. Use Chrome or Edge.');
    try {
      const h = await win().showDirectoryPicker({ id: 'weld-folder-sync', mode: 'readwrite' });
      F.handle = h; F.name = h.name; F.perm = await permission(h, true); F.error = '';
      await kvSet('handle', h); folderCfg();
      F.cfg.revision = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
      F.cfg.autoMirror = false; F.cfg.projectBackups = {}; saveFolderCfg(); F.revision = null;
      await refreshMasterFolder();
      notice(F.perm === 'granted' ? 'Master Dev folder connected for all generators: ' + h.name + '. Automatic writes are off.' : 'Folder chosen, but write permission was not granted.');
      await tick(true);
    } catch (e) { if (!(e && e.name === 'AbortError')) { F.error = e.message || String(e); } }
    draw();
  }
  // Chrome drops a folder's permission when it restarts. requestPermission() needs a user gesture, so when
  // "Keep access allowed" is on, the first click or key press anywhere on the page re-grants it without
  // opening Weld. (Choose "Allow on every visit" in Chrome's prompt and Chrome stops forgetting it at all.)
  let regrantArmed = false;
  function armRegrant() {
    if (regrantArmed || !F.handle || F.perm === 'granted' || !F.cfg.keepAccess || typeof document === 'undefined') return;
    regrantArmed = true;
    const go = async () => {
      document.removeEventListener('pointerdown', go, true); document.removeEventListener('keydown', go, true); regrantArmed = false;
      if (!F.handle || F.perm === 'granted' || !F.cfg.keepAccess) return;
      F.perm = await permission(F.handle, true);
      if (F.perm === 'granted') { F.error = ''; tick(true).catch(() => {}); }
      draw();
    };
    document.addEventListener('pointerdown', go, true); document.addEventListener('keydown', go, true);
  }
  async function recheckAccess() {
    if (!F.handle || !F.cfg.keepAccess) return;
    const was = F.perm; F.perm = await permission(F.handle, false);
    if (F.perm !== 'granted') armRegrant();
    if (F.perm !== was) draw();
  }
  function setKeepAccess(v) { folderCfg(); F.cfg.keepAccess = !!v; saveFolderCfg(); if (v) recheckAccess(); }
  async function reconnectFolder() {
    if (!F.handle) return;
    F.perm = await permission(F.handle, true); F.error = F.perm === 'granted' ? '' : 'Permission was not granted.';
    if (F.perm === 'granted') await tick(true);
    draw();
  }
  async function disconnectFolder() {
    F.handle = null; F.name = ''; F.perm = 'none'; F.plan = null; F.folders = null;
    await kvDel('handle'); folderCfg(); F.cfg.autoMirror = false; F.cfg.projectBackups = {};
    F.cfg.revision = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2); saveFolderCfg(); F.revision = F.cfg.revision;
    notice('Master Dev folder disconnected for all generators. Nothing in it was deleted.'); draw();
  }
  async function bootFolder() {
    if (F.bootDone) return; F.bootDone = true;
    F.supported = typeof win().showDirectoryPicker === 'function'; folderCfg();
    try { await refreshMasterFolder(); } catch (e) {}
    // 1.92.0: the master-folder panel is off by default (GitHub holds the work). A folder connected earlier is disconnected once; nothing in it is deleted.
    if (!F.cfg.showPanel && F.handle) { try { await disconnectFolder(); } catch (e) {} }
    try { window.addEventListener('focus', () => { refreshMasterFolder().then(recheckAccess).catch(() => {}); }); } catch (e) {}
    armRegrant(); startWatch(); draw();
  }
  let watchTimer = null;
  function startWatch() { if (watchTimer) return; watchTimer = setInterval(() => { tick(false).catch(() => {}); }, 2500); }
  // Automatic writes to the master folder are limited to starred generators; the Mirror button works on any.
  function isStarred(slug) { try { return (H.favorites() || []).indexOf(slug) !== -1; } catch (e) { return false; } }
  async function tick(force) {
    await refreshMasterFolder();
    if (!F.handle || F.perm !== 'granted' || F.busy || (!force && ((!F.cfg.watch && !F.cfg.projectBackups[H.slug()]) || (typeof document !== 'undefined' && document.hidden)))) return;
    const slug = H.slug();
    if (!D.safeSlug(slug)) { F.plan = null; F.slug = ''; return; }
    F.busy = true;
    try {
      const live = H.isEdit() ? H.live() : null, editor = live && live.dsl != null ? { dsl: norm(live.dsl), html: live.html == null ? null : norm(live.html) } : null;
      const revision = F.revision, disk = await readPair(slug), base = await kvGet(folderBaseKey(slug));
      let plan = D.syncPlan(editor, disk, base);
      if (plan.state === 'in-sync' && editor) {
        // both sides agree: remember this as the last sync point (only when it actually moved)
        const bk = slug + ':' + P.hash(D.normForCompare(editor.dsl)) + P.hash(D.normForCompare(editor.html || ''));
        if (F.baseKey !== bk) { F.baseKey = bk; await kvSet(folderBaseKey(slug), { dsl: editor.dsl, html: editor.html }); }
      } else if ((plan.state === 'editor-ahead' || plan.state === 'no-disk') && editor && F.cfg.autoMirror && isStarred(slug)) {
        if (await writePair(slug, editor.dsl, editor.html, revision)) {
          await kvSet(folderBaseKey(slug), { dsl: editor.dsl, html: editor.html }); plan = { state: 'in-sync', mirrored: true };
        }
      }
      const key = plan.state + ':' + (disk ? P.hash(D.normForCompare(disk.dsl)) + P.hash(D.normForCompare(disk.html || '')) : '-');
      if ((plan.state === 'disk-ahead' || plan.state === 'conflict') && F.notified !== key) { F.notified = key; H.toast('The folder copy of "' + slug + '" changed. Open Weld, then the Dev tab, to review it.', 7000); }
      const changed = !F.plan || F.plan.state !== plan.state || F.slug !== slug;
      F.plan = plan; F.slug = slug; F.lastCheck = Date.now(); F.error = '';
      if (!document.hidden && H.isEdit() && F.cfg.projectBackups[slug] && !F.projectBusy &&
          (F.projectSlug !== slug || Date.now() - F.projectCheck >= 60000)) await downloadProject(false);
      if (changed || force) draw();
    } catch (e) { F.error = (e && e.message) || String(e); }
    F.busy = false;
  }
  async function mirrorNow() {
    await tick(true);
    const slug = H.slug(), live = H.isEdit() ? H.live() : null;
    if (!live || live.dsl == null) return notice('Open the generator\u2019s editor first.');
    if (F.plan && (F.plan.state === 'disk-ahead' || F.plan.state === 'conflict') && !window.confirm('The folder copy has changes that are not in the editor. Overwrite them with the editor?')) return;
    await writePair(slug, norm(live.dsl), live.html == null ? null : norm(live.html));
    await kvSet(folderBaseKey(slug), { dsl: norm(live.dsl), html: live.html == null ? null : norm(live.html) });
    notice('Wrote the editor to the folder.'); await tick(true);
  }
  async function applyFolder() {
    const slug = H.slug(), live = H.isEdit() ? H.live() : null;
    if (!live || live.dsl == null) return notice('Open the generator\u2019s editor first.');
    const disk = await readPair(slug); if (!disk) return notice('No folder copy of this generator yet.');
    if (!window.confirm('Replace the editor with the folder copy of "' + slug + '"?\n\nCtrl+Z undoes it, and you still press Save in Perchance.')) return;
    const ok = H.applyPane('dsl', disk.dsl) && (disk.html == null || H.applyPane('html', disk.html));
    if (ok) { await kvSet(folderBaseKey(slug), { dsl: disk.dsl, html: disk.html }); notice('Applied the folder copy. Review it, then Save.'); } else notice('Could not write to the editor.');
    S.view = null; await tick(true);
  }
  async function showFolderDiff() {
    const slug = H.slug(), live = H.isEdit() ? H.live() : null, disk = await readPair(slug);
    if (!live || !disk) return notice('Both an open editor and a folder copy are needed to compare.');
    S.view = { kind: 'folder', title: 'Editor \u2192 folder copy of ' + slug + ' (\u2212 only in the editor, + only in the folder)',
      panes: [['Lists panel', norm(live.dsl), disk.dsl], ['HTML panel', norm(live.html || ''), disk.html == null ? norm(live.html || '') : disk.html]] };
    draw();
  }
  async function useFolderAsBase() { const disk = await readPair(H.slug()); if (disk) { await kvSet(folderBaseKey(H.slug()), disk); await tick(true); } }
  async function useEditorAsBase() { const live = H.live(); if (live) { await kvSet(folderBaseKey(H.slug()), { dsl: norm(live.dsl), html: live.html == null ? null : norm(live.html) }); await tick(true); } }
  async function listFolders() {
    if (!F.handle || F.perm !== 'granted') return;
    const out = [];
    try {
      for await (const [name, h] of F.handle.entries()) {
        if (h.kind !== 'directory' || !D.safeSlug(name)) continue;
        const has = await fsRead(F.handle, D.folderPaths(name, F.cfg).dsl).catch(() => null);
        if (has) out.push({ slug: name, mtime: has.mtime });
      }
    } catch (e) { F.error = e.message || String(e); }
    out.sort((a, b) => b.mtime - a.mtime); F.folders = out; draw();
  }
  async function seedFromPublished(slug) {
    if (!window.weldProject || !window.weldProject.fetchPublished) throw new Error('The Project module is not loaded.');
    const proj = await window.weldProject.fetchPublished(slug);
    await writePair(slug, norm(proj.dsl), proj.html == null ? null : norm(proj.html));
    return proj;
  }
  async function downloadProject(manual = true) {
    if (F.projectBusy) return;
    const slug = H.slug(), live = H.isEdit() ? H.live() : null;
    if (!D.safeSlug(slug) || !live || live.dsl == null) return notice('Open this generator\u2019s editor first.');
    if (!H.backup || !window.WeldLocalBackup) return notice('The project backup module is unavailable.');
    if (!F.handle || F.perm !== 'granted') return notice('Choose the computer save folder and allow access first.');
    if (manual && !window.confirm('Download all project files and readable cached assets/models for "' + slug + '" into its folder in ' + F.name + '?\n\nThis uses the current editor and selected draft. Existing matching files are replaced. Automatic updates are then enabled ONLY for this generator while its editor is visible. Private chat data, credentials, HTTP cache and other origins are excluded.')) return;
    F.projectBusy = true; F.projectError = ''; F.projectSlug = slug; F.projectCheck = Date.now();
    F.projectStatus = 'Reading project and cached assets\u2026'; draw();
    const handle = F.handle, revision = F.revision, cancel = F.projectCancel;
    const active = () => {
      folderCfg();
      return H.slug() === slug && H.isEdit() && F.handle === handle && F.projectCancel === cancel && (F.cfg.revision || '') === revision &&
        (manual || (!document.hidden && !!F.cfg.projectBackups[slug]));
    };
    const run = async () => {
      if (!active()) throw new Error('Local project download paused or location changed');
      const backup = await H.backup.collect(slug, D.folderPaths(slug), live, !manual);
      const result = await window.WeldLocalBackup.save({ root: handle, slug, backup, crypto: H.backup.crypto, overwrite: manual, active,
        progress: (n, total) => { F.projectStatus = 'Saving project files and assets ' + n + '/' + total; draw(); } });
      if (!active()) throw new Error('Local project download paused or location changed');
      const p = paths(slug), canonical = D.folderPaths(slug);
      if (p.dsl === canonical.dsl && p.html === canonical.html) await kvSet(folderBaseKey(slug), { dsl: norm(live.dsl), html: norm(live.html || '') });
      F.projectStatus = 'Saved ' + result.files + ' files (' + (result.bytes / 1048576).toFixed(1) + ' MiB); ' + result.written + ' updated.' +
        (result.unavailable.length ? ' Unavailable: ' + result.unavailable.join('; ') : '');
      if (manual) notice('Downloaded ' + slug + '. Automatic project and asset updates are on for this generator only.');
    };
    try {
      const locks = win().navigator && win().navigator.locks;
      if (locks) await locks.request('weld-local-project:' + revision + ':' + slug, { ifAvailable: true }, lock => {
        if (!lock) throw new Error('Another tab is saving this generator; try again shortly');
        return run();
      });
      else await run();
    } catch (e) { F.projectError = (e && e.message) || String(e); F.projectStatus = 'Project download stopped.'; if (manual) notice(F.projectError); }
    finally { F.projectBusy = false; F.projectCheck = Date.now(); draw(); }
  }
  function pauseProject() {
    F.projectCancel++;
    folderCfg(); F.cfg.projectBackups = Object.assign({}, F.cfg.projectBackups); delete F.cfg.projectBackups[H.slug()]; saveFolderCfg();
    notice('Automatic project and asset updates paused for this generator.'); draw();
  }
  async function seedStarred() {
    const names = H.favorites().filter(n => D.safeSlug(n));
    if (!names.length) return notice('Star some generators first.');
    if (!window.confirm('Download the published copy of ' + names.length + ' starred generator(s) into the folder?\n\nThis makes two requests to Perchance for each. Existing files with the same names are overwritten.')) return;
    let ok = 0, bad = [];
    for (const n of names) {
      F.seeding = n + ' (' + (ok + bad.length + 1) + '/' + names.length + ')'; draw();
      try { await seedFromPublished(n); ok++; } catch (e) { bad.push(n); }
    }
    F.seeding = ''; F.folders = null; notice('Wrote ' + ok + ' generator(s) to the folder' + (bad.length ? '; failed: ' + bad.join(', ') : '.')); draw(); listFolders();
  }

  // ------------------------------------------------------------ agent bridge
  function bridgeCfg() { B.cfg = Object.assign({ url: 'http://127.0.0.1:8765', token: '', auto: false, allowSample: false, allowPropose: true }, H.get(GM_KEYS.bridge, {}) || {}); return B.cfg; }
  function saveBridgeCfg() { H.set(GM_KEYS.bridge, B.cfg); }
  function bridgeBase() { return B.cfg.url.replace(/\/+$/, '') + '/weld/' + B.cfg.token; }
  function loopbackUrl(u) { try { const x = new URL(u); return /^https?:$/.test(x.protocol) && /^(127\.0\.0\.1|localhost|\[::1\])$/.test(x.hostname === '::1' ? '[::1]' : x.hostname); } catch (e) { return false; } }
  function startBridge() {
    bridgeCfg();
    if (!loopbackUrl(B.cfg.url)) { B.state = 'error'; B.error = 'The bridge URL must point to this computer (127.0.0.1 or localhost). Weld never sends editor contents to another host.'; return draw(); }
    if (B.running || B.pairing) return;
    if (!/^[0-9a-f]{16,128}$/i.test(B.cfg.token)) {   // no token yet: ask the bridge for it, so nothing has to be pasted
      B.pairing = true; B.state = 'connecting'; B.error = ''; draw();
      return pairBridge(err => {
        B.pairing = false;
        if (err) { B.state = 'error'; B.error = err; draw(); return void retryPair(); }
        startBridge();
      });
    }
    B.running = true; B.gen = (B.gen || 0) + 1; B.state = 'connecting'; B.error = ''; B.backoff = 0; draw(); poll(B.gen);
  }
  // Pairing: the bridge hands its token to a request that carries the X-Weld-Pair header. A web page cannot send
  // that header cross-origin (the browser preflights it and the bridge refuses), so only the userscript can pair.
  function pairBridge(cb) {
    bridgeCfg();
    if (!loopbackUrl(B.cfg.url)) return cb('The bridge URL must point to this computer (127.0.0.1 or localhost).');
    H.request({ method: 'GET', url: B.cfg.url.replace(/\/+$/, '') + '/pair', headers: { 'X-Weld-Pair': '1' }, timeout: 5000 }, (err, res) => {
      if (err || !res) return cb('Cannot reach the bridge. Is it running? It can start by itself at login: see docs/DEV.md.');
      let tok = ''; try { tok = JSON.parse(res.text).token || ''; } catch (e) {}
      if (res.status !== 200 || !/^[0-9a-f]{16,128}$/i.test(tok)) return cb('The bridge did not accept pairing (HTTP ' + res.status + '). Update the bridge, or paste its token.');
      B.cfg.token = tok; saveBridgeCfg(); cb(null);
    });
  }
  function retryPair() {   // "reconnect automatically" also waits for a bridge that is not up yet
    if (!B.cfg.auto || B.retryTimer) return;
    B.retryTimer = setTimeout(() => { B.retryTimer = null; if (B.cfg.auto && !B.running && !B.pairing) startBridge(); }, 10000);
  }
  function stopBridge() {
    const was = B.running; B.running = false; B.state = 'off';
    if (was) { try { H.request({ method: 'POST', url: bridgeBase() + '/bye', data: JSON.stringify({ cid: B.cid }), headers: { 'Content-Type': 'application/json' }, timeout: 5000 }, () => {}); } catch (e) {} }
    draw();
  }
  function poll(gen) {
    if (!B.running || gen !== B.gen) return;   // a stale loop from before a disconnect/reconnect ends here
    const live = H.isEdit() && H.live(), url = bridgeBase() + '/poll?cid=' + B.cid + '&slug=' + encodeURIComponent(H.slug() || '') + '&mode=' + (live ? 'edit' : 'view') + '&v=' + encodeURIComponent(H.version || '') + '&wait=25';
    H.request({ method: 'GET', url, timeout: 35000 }, (err, res) => {
      if (!B.running || gen !== B.gen) return;
      if (err || !res || res.status !== 200) {
        if (res && res.status === 404 && !B.repaired) {   // the bridge restarted with a new token: fetch it again
          B.repaired = true; return pairBridge(e2 => { if (!e2) { if (B.running && gen === B.gen) poll(gen); return; } B.state = 'error'; B.error = e2; draw(); });
        }
        B.state = 'error'; B.error = err ? 'Cannot reach the bridge. Is it running?' : (res.status === 404 ? 'The bridge rejected the URL or token.' : 'The bridge answered HTTP ' + res.status + '.'); draw();
        B.backoff = Math.min(15000, (B.backoff || 1000) * 2); return void setTimeout(() => poll(gen), B.backoff);
      }
      B.backoff = 0; B.repaired = false; if (B.state !== 'connected') { B.state = 'connected'; B.error = ''; draw(); }
      let cmds = []; try { cmds = JSON.parse(res.text).commands || []; } catch (e) {}
      cmds.forEach(runCommand); poll(gen);
    });
  }
  function reply(id, body) { H.request({ method: 'POST', url: bridgeBase() + '/reply', data: JSON.stringify(Object.assign({ id }, body)), headers: { 'Content-Type': 'application/json' }, timeout: 15000 }, () => {}); }
  function runCommand(cmd) {
    Promise.resolve().then(() => exec(cmd)).then(result => reply(cmd.id, { ok: true, result }), e => reply(cmd.id, { ok: false, error: (e && e.message) || String(e) }));
  }
  function pendingCount() { return S.proposals.filter(p => p.status === 'pending').length; }
  async function exec(cmd) {
    const def = D.BRIDGE_TOOLS.find(t => t.name === cmd.tool);
    if (!def) throw new Error('Unknown tool: ' + cmd.tool);
    const args = (cmd.args && typeof cmd.args === 'object') ? cmd.args : {};
    B.calls++; B.last = def.name.replace(/^weld_/, '') + ' ' + new Date().toLocaleTimeString(); draw();
    if (def.run) return D.makeToolbox(source).call(def.run, args);
    if (cmd.tool === 'weld_propose_edit') return propose(args);
    if (cmd.tool === 'weld_proposal_status') {
      const p = S.proposals.find(x => x.id === args.id); if (!p) throw new Error('No proposal with that id (the list is cleared when the page reloads).');
      const live = H.isEdit() ? H.live() : null, cur = live ? (p.pane === 'html' ? live.html : live.dsl) : null;
      return { id: p.id, status: p.status === 'pending' && cur != null && D.proposalState(p, cur) === 'stale' ? 'stale' : p.status };
    }
    if (cmd.tool === 'weld_sample') return sampleForAgent(args);
    throw new Error('Not implemented: ' + cmd.tool);
  }
  async function sampleForAgent(args) {
    bridgeCfg();
    if (!B.cfg.allowSample) throw new Error('The user has not allowed agents to run samples. They can enable it in Weld, Dev tab, Agent bridge.');
    const n = Math.max(5, Math.min(100, Math.floor(Number(args.count)) || 30)), slug = H.slug();
    const res = await H.sample(slug, document.querySelector && document.querySelector('#outputIframeEl') ? 'visible' : 'published', { n, ms: 25000 });
    const src = source(), a = src ? P.analyze({ name: src.name, dsl: src.dsl, html: src.html }) : null;
    return { stats: P.sampleStats(res.samples, a && a.outputSpace), samples: res.samples.slice(0, 30).map(s => s.slice(0, 300)) };
  }
  function propose(args) {
    bridgeCfg();
    if (!B.cfg.allowPropose) throw new Error('The user has turned off agent proposals in Weld.');
    const live = H.isEdit() ? H.live() : null;
    if (!live || live.dsl == null) throw new Error('The generator\u2019s editor is not open in Weld, so edits cannot be proposed. Ask the user to open the generator with #edit.');
    const pane = args.pane === 'html' ? 'html' : 'dsl', current = pane === 'html' ? live.html : live.dsl;
    if (current == null) throw new Error('The HTML editor pane is not available.');
    if (pendingCount() >= 20) throw new Error('Too many proposals are waiting for the user. Wait for them to review some.');
    const p = D.makeProposal({ id: 'p' + (++S.seq), pane, current, new_text: args.new_text, edits: args.edits, note: args.note, agent: args._agent });
    p.slug = H.slug(); S.proposals.unshift(p);
    H.toast((p.agent || 'An agent') + ' proposed a change to the ' + (pane === 'html' ? 'HTML' : 'lists') + ' panel. Review it in Weld, Dev tab.', 7000); draw();
    return { id: p.id, status: 'pending', message: 'Queued. The user must review and accept it in Weld; check weld_proposal_status for the outcome.' };
  }
  function reviewProposal(p) { S.view = { kind: 'proposal', id: p.id, title: (p.agent || 'agent') + ' proposes a change to the ' + (p.pane === 'html' ? 'HTML' : 'lists') + ' panel of ' + p.slug + (p.note ? ': ' + p.note : ''), panes: [[p.pane === 'html' ? 'HTML panel' : 'Lists panel', p.before, p.after]] }; draw(); }
  function acceptProposal(p) {
    const live = H.isEdit() ? H.live() : null;
    if (!live || p.slug !== H.slug()) return notice('Open the editor of "' + p.slug + '" to accept this.');
    const cur = p.pane === 'html' ? live.html : live.dsl;
    if (D.proposalState(p, cur) === 'stale') return notice('The editor changed after this was proposed, so it cannot be applied safely. Reject it and ask the agent again.');
    if (!window.confirm('Apply this change to the ' + (p.pane === 'html' ? 'HTML' : 'lists') + ' panel?\n\nCtrl+Z undoes it, and you still press Save in Perchance.')) return;
    if (H.applyPane(p.pane, p.after)) { p.status = 'applied'; S.view = null; notice('Applied. Review it, then Save.'); } else notice('Could not write to the editor.');
    draw();
  }
  function rejectProposal(p) { p.status = 'rejected'; if (S.view && S.view.id === p.id) S.view = null; draw(); }

  // ------------------------------------------------------ GitHub agent hand-off
  function repoPaths() { const slug = H.slug(), r = H.gh.resolve(slug); return { slug, cfg: r.cfg, files: D.folderPaths(slug, { dslPath: r.cfg.dslPath, htmlPath: r.cfg.htmlPath }), r }; }
  function fetchText(url) { return new Promise((resolve, reject) => H.gh.fetch(url, (e, t) => (e ? reject(new Error(e)) : resolve(t)))); }
  async function checkRepoCopy() {
    const A = S.agents; A.repoState = 'Checking\u2026'; A.error = ''; draw();
    try {
      const rp = repoPaths(), live = H.live();
      if (!rp.cfg.owner || !rp.cfg.repo) throw new Error('Set your repo in the GitHub tab first.');
      const a = await fetchText(rp.r.dslUrl), b = await fetchText(rp.r.htmlUrl).catch(() => null);
      if (!live) A.repoState = 'The repo has the files. Open the editor to compare them.';
      else if (D.syncPlan({ dsl: live.dsl, html: live.html }, { dsl: a, html: b }, null).state === 'in-sync') A.repoState = '\u2713 The repo copy matches your editor.';
      else A.repoState = '\u26A0 The repo copy differs from your editor. Push first so the agent starts from your latest version.';
    } catch (e) { A.repoState = ''; A.error = e.message || String(e); }
    draw();
  }
  async function createAgentIssue() {
    const A = S.agents; A.error = ''; A.result = null;
    try {
      const rp = repoPaths();
      if (!rp.cfg.owner || !rp.cfg.repo) throw new Error('Set your repo in the GitHub tab first.');
      if (!H.gh.token()) throw new Error('Save a GitHub token in the GitHub tab first.');
      const src = source(), analysis = src ? P.analyze({ name: src.name, dsl: src.dsl, html: src.html }) : null;
      const issue = D.buildAgentIssue({ slug: rp.slug, request: A.request, mode: A.mode, agent: A.agent, repo: rp.cfg, paths: rp.files, findings: analysis ? analysis.findings : [] });
      const label = D.AGENTS[issue.agent].label;
      if (!window.confirm('Create an issue in ' + rp.cfg.owner + '/' + rp.cfg.repo + ' for ' + label + '?\n\n' + issue.title + '\n\nTask mode: ' + (issue.mode === 'analysis' ? 'Analyze and report (read-only). No source edits, commits, pushes or pull requests requested.' : 'Change code. Review and merge the pull request on GitHub, then use Pull to load it.') + '\n\n' + D.AGENTS[issue.agent].how + '\n\nThe issue text includes your request and its task rules. No token or code is included.')) return;
      A.busy = true; draw();
      const body = { title: issue.title, body: issue.body };
      if (issue.assignees.length) { body.assignees = issue.assignees; body.agent_assignment = issue.agent_assignment; }
      const made = await new Promise((resolve, reject) => H.gh.api('POST', '/repos/' + rp.cfg.owner + '/' + rp.cfg.repo + '/issues', body, (e, st, j) => {
        if (e || (st !== 201 && st !== 200) || !j) reject(new Error('GitHub refused (' + (e ? e.message : st) + (j && j.message ? ': ' + j.message : '') + '). The token needs Issues' + (issue.agent === 'copilot' ? ', Pull requests, Actions and Contents' : '') + ' read & write on this repo.')); else resolve(j);
      }));
      if (issue.comment) await new Promise((resolve, reject) => H.gh.api('POST', '/repos/' + rp.cfg.owner + '/' + rp.cfg.repo + '/issues/' + made.number + '/comments', { body: issue.comment }, (e, st, j) => (e || (st !== 201 && st !== 200) ? reject(new Error('The issue was created, but the @-mention comment failed (' + (e ? e.message : st) + '). Add it on GitHub: ' + made.html_url)) : resolve())));
      A.result = { url: made.html_url, number: made.number, agent: issue.agent };
      try { H.copy(made.html_url); } catch (e) {}
      notice('Issue #' + made.number + ' created (link copied).');
    } catch (e) { A.error = e.message || String(e); }
    A.busy = false; draw();
  }

  // ------------------------------------------------------ refactor and usages
  function liveSource() {
    const live = H.isEdit() ? H.live() : null;
    if (live && live.dsl != null) return { dsl: live.dsl, html: live.html, live: true };
    const s = source(); return s && s.dsl != null ? { dsl: s.dsl, html: s.html, live: false } : null;
  }
  function listNames() { const s = liveSource(); if (!s) return []; return P.analyze({ dsl: s.dsl, html: s.html }).lists.filter(l => D.validName(l.name)).map(l => l.name); }
  function findUsagesUi() {
    const R = S.refactor, s = liveSource(); R.error = ''; R.preview = null;
    if (!s) { R.error = 'Open the editor or load the generator in the Project tab first.'; return draw(); }
    const r = D.findUsages(s.dsl, s.html, R.name);
    if (r.error) { R.error = r.error; R.usages = null; } else R.usages = r.hits;
    draw();
  }
  function previewRename() {
    const R = S.refactor, s = liveSource(); R.error = ''; R.usages = null;
    if (!s || !s.live) { R.error = 'Renaming needs the editor open (#edit), because the result is applied to it.'; return draw(); }
    const r = D.rename(s.dsl, s.html, R.name, R.to);
    if (r.error) { R.error = r.error; R.preview = null; } else { R.preview = r; R.previewBase = { dsl: s.dsl, html: s.html }; }
    draw();
  }
  function applyRename() {
    const R = S.refactor, r = R.preview, s = liveSource(); if (!r || !s || !s.live) return;
    if (!R.previewBase || norm(s.dsl) !== norm(R.previewBase.dsl) || norm(s.html || '') !== norm(R.previewBase.html || '')) { R.preview = null; draw(); return notice('The editor changed after the preview. Preview again.'); }
    if (!window.confirm('Rename "' + R.name + '" to "' + R.to + '" in ' + r.total + ' place(s)?\n\nCtrl+Z undoes it, and you still press Save in Perchance.')) return;
    const ok = H.applyPane('dsl', r.dsl) && (s.html == null || H.applyPane('html', r.html));
    if (ok) { notice('Renamed. Review it, then Save.'); R.preview = null; R.name = R.to; R.to = ''; } else notice('Could not write to the editor.');
    draw();
  }
  function jumpTo(h) { if (H.isEdit() && H.jump) H.jump(h.pane, h.line); }

  // ------------------------------------------------------------ editor markers
  let markTimer = null, lastMarkKey = '', markAnalysis = null, paintQueued = false;
  const hooked = new WeakSet();
  function schedulePaint() {
    if (paintQueued) return; paintQueued = true;
    const run = () => { paintQueued = false; paintMarkers(); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else setTimeout(run, 16);
  }
  function layerFor(view) {
    const scroller = view && view.scrollDOM; if (!scroller) return null;
    let layer = null;
    for (const c of Array.from(scroller.children || [])) if (c.className === 'weld-marks') layer = c;
    if (!layer) { layer = document.createElement('div'); layer.className = 'weld-marks'; layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:5'; scroller.appendChild(layer); }
    return layer;
  }
  function paintMarkers() {
    try {
      const views = H.views ? H.views() : {}, live = H.isEdit() ? H.live() : null;
      ['dsl', 'html'].forEach(pane => {
        const view = views[pane]; if (!view) return;
        const layer = layerFor(view); if (!layer) return;
        if (!hooked.has(view) && view.scrollDOM && view.scrollDOM.addEventListener) {   // lines scrolling into view need drawing
          hooked.add(view); view.scrollDOM.addEventListener('scroll', () => { if (S.markers) schedulePaint(); }, { passive: true });
        }
        while (layer.firstChild) layer.removeChild(layer.firstChild);
        if (!S.markers || !markAnalysis) return;
        const byLine = {};
        markAnalysis.findings.filter(f => f.pane === pane && f.line).forEach(f => { (byLine[f.line] = byLine[f.line] || []).push(f); });
        Object.keys(byLine).slice(0, 150).forEach(k => {
          try {
            const n = +k; if (n > view.state.doc.lines) return;
            const fs = byLine[k], worst = fs.some(f => f.severity === 'error') ? 'error' : fs.some(f => f.severity === 'warn') ? 'warn' : 'info';
            if (worst === 'info' && !S.markInfo) return;
            // Measure from the DOM: CodeMirror's cached line heights can lag behind what is rendered (verified on
            // the real editor). coordsAtPos is null for lines that are scrolled out of view, so those are skipped
            // and drawn when they scroll in.
            const from = view.state.doc.line(n).from, sr = view.scrollDOM.getBoundingClientRect(), scale = view.scaleY || 1;
            let top, height;
            if (typeof view.coordsAtPos === 'function') {
              const c = view.coordsAtPos(from); if (!c) return;
              top = (c.top - sr.top) / scale + view.scrollDOM.scrollTop; height = (c.bottom - c.top) / scale;
            } else { const blk = view.lineBlockAt(from); top = ((view.documentPadding && view.documentPadding.top) || 0) + blk.top; height = blk.height; }
            const m = document.createElement('div');
            m.style.cssText = 'position:absolute;left:0;top:' + top + 'px;width:5px;height:' + Math.max(8, height) + 'px;background:' + MARK_COLORS[worst] + ';border-radius:0 3px 3px 0;pointer-events:auto;cursor:help;opacity:.9';
            m.title = fs.map(f => f.message).join('\n'); layer.appendChild(m);
          } catch (e) {}
        });
      });
    } catch (e) {}
  }
  function markTick() {
    try {
      const live = H.isEdit() ? H.live() : null;
      if (!live || live.dsl == null) return;
      const key = P.hash(live.dsl) + '|' + P.hash(live.html || '');
      if (key !== lastMarkKey) { lastMarkKey = key; markAnalysis = P.analyze({ name: H.slug(), dsl: live.dsl, html: live.html }); }
      paintMarkers();
    } catch (e) {}
  }
  function setMarkers(on) {
    S.markers = !!on; H.set(GM_KEYS.markers, { on: S.markers, info: S.markInfo });
    if (on && !markTimer) { markTimer = setInterval(markTick, 1500); markTick(); }
    if (!on) { if (markTimer) { clearInterval(markTimer); markTimer = null; } lastMarkKey = ''; paintMarkers(); }
  }

  // ------------------------------------------------------- regression baseline
  function baselineKey() { return GM_KEYS.baseline + H.slug(); }
  async function runBaselineSample() {
    const R = S.regress, slug = H.slug(); R.busy = true; R.error = ''; draw();
    try {
      const res = await H.sample(slug, R.via, { n: R.n, ms: 25000 }); return res.samples;
    } catch (e) { R.error = e.message || String(e); return null; } finally { R.busy = false; }
  }
  async function saveBaseline() {
    const samples = await runBaselineSample(); if (!samples) return draw();
    H.set(baselineKey(), { t: Date.now(), via: S.regress.via, samples: samples.map(s => s.slice(0, 400)) });
    S.regress.result = null; notice('Saved ' + samples.length + ' results as the baseline for this generator.'); draw();
  }
  async function compareBaseline() {
    const base = H.get(baselineKey(), null); if (!base) { S.regress.error = 'Save a baseline first.'; return draw(); }
    const samples = await runBaselineSample(); if (!samples) return draw();
    S.regress.result = Object.assign(D.compareSamples(base.samples, samples), { baseT: base.t }); draw();
  }

  // --------------------------------------------------------------------- UI
  function btn(label, action, opts) {
    opts = opts || {};
    const b = E('button', { class: 'wc-btn' + (opts.accent ? ' wc-btn-accent' : '') + (opts.mini ? ' wc-mini' : ''), text: label, title: opts.title || '', onclick: () => {
      try { const r = action(); if (r && typeof r.catch === 'function') r.catch(e => { notice((e && e.message) || String(e)); draw(); }); } catch (err) { notice(err.message || String(err)); draw(); }
    } });
    b.disabled = !!opts.disabled; return b;
  }
  const note = (parent, text, style) => parent.appendChild(E('div', { class: 'wc-section-note', text, style: style || {} }));
  const row = (parent, kids, style) => parent.appendChild(E('div', { class: 'wc-row', style: Object.assign({ flexWrap: 'wrap', gap: '8px', margin: '8px 0', alignItems: 'center' }, style || {}) }, kids));
  function field(label, value, onInput, attrs) {
    const i = E('input', Object.assign({ class: 'wc-field', type: 'text', 'aria-label': label, value: value == null ? '' : value }, attrs || {}));
    i.addEventListener('input', () => onInput(i.value)); return i;
  }
  function check(label, checked, onChange, title) {
    const c = E('input', { type: 'checkbox' }); c.checked = !!checked; c.addEventListener('change', () => onChange(c.checked));
    return E('label', { class: 'wc-check', title: title || '', style: { margin: '4px 0' } }, [c, E('span', { class: 'wc-sw' }), E('span', { text: label })]);
  }
  function section(parent, id, title, count, build, openDefault) {
    const open = id in S.open ? S.open[id] : !!openDefault;
    const d = E('details', { class: 'wc-card', style: { marginTop: '10px' }, ontoggle: ev => { S.open[id] = !!(ev && ev.target ? ev.target.open : d.open); } });
    if (open) d.setAttribute('open', '');
    d.appendChild(E('summary', { style: { cursor: 'pointer', fontWeight: '600' }, text: title + (count != null && count !== '' ? '  \u00b7  ' + count : '') }));
    const body = E('div', { style: { marginTop: '8px' } }); d.appendChild(body);
    if (open) build(body); else d.addEventListener('toggle', () => { if (d.open && !body.firstChild) { try { build(body); } catch (e) { note(body, 'Could not render: ' + e.message); } } });
    parent.appendChild(d);
  }
  function diffBlock(parent, title, before, after) {
    const d = H.diff(before, after);
    parent.appendChild(E('div', { class: 'wc-subhead', style: { marginTop: '8px' }, text: title + (d.stats.add + d.stats.del ? '  (+' + d.stats.add + ' \u2212' + d.stats.del + ')' : '  (identical)') }));
    if (!d.stats.add && !d.stats.del) return;
    const box = E('div', { style: { font: '12px/1.45 ui-monospace,Menlo,Consolas,monospace', border: '1px solid var(--wc-line,#333)', borderRadius: '8px', overflow: 'auto', maxHeight: '40vh', marginTop: '4px' } });
    d.rows.forEach(rw => box.appendChild(E('div', { style: { display: 'flex', gap: '8px', padding: '0 8px', background: rw.cls === 'add' ? 'rgba(63,185,80,0.16)' : rw.cls === 'del' ? 'rgba(248,81,73,0.16)' : 'transparent', whiteSpace: 'pre-wrap', wordBreak: 'break-word', opacity: rw.cls === 'gap' ? '0.6' : '1' } }, [
      E('span', { style: { width: '40px', textAlign: 'right', opacity: '0.5', flex: '0 0 auto' }, text: rw.num != null ? String(rw.num) : '' }),
      E('span', { style: { width: '10px', flex: '0 0 auto' }, text: rw.cls === 'add' ? '+' : rw.cls === 'del' ? '\u2212' : '' }), E('span', { text: rw.text == null ? '' : rw.text })])));
    parent.appendChild(box);
  }
  function viewPanel(parent) {
    const v = S.view; if (!v) return false;
    const card = E('div', { class: 'wc-card', style: { marginTop: '10px', borderColor: 'var(--wc-accent,#f97316)' } });
    card.appendChild(E('div', { class: 'wc-label', text: v.title }));
    v.panes.forEach(p => diffBlock(card, p[0], p[1], p[2]));
    const actions = [btn('\u2190 Back', () => { S.view = null; draw(); }, { mini: true })];
    if (v.kind === 'proposal') { const p = S.proposals.find(x => x.id === v.id); if (p && p.status === 'pending') actions.push(btn('Apply to editor', () => acceptProposal(p), { accent: true }), btn('Reject', () => rejectProposal(p))); }
    if (v.kind === 'folder') actions.push(btn('Apply folder copy to editor', applyFolder, { accent: true }), btn('Overwrite folder with editor', mirrorNow));
    row(card, actions); parent.appendChild(card); return true;
  }

  const STATE_TEXT = {
    'in-sync': ['\u2713 In sync: the editor and the folder copy match.', '#3fb950'],
    'no-disk': ['The folder has no copy of this generator yet.', '#d29922'],
    'editor-ahead': ['The editor has changes the folder does not.', '#d29922'],
    'disk-ahead': ['\u26A0 The folder copy changed (an agent or editor saved it). Review it before applying.', '#d29922'],
    'conflict': ['\u26A0 Both the editor and the folder changed since the last sync.', '#e5534b'],
    'unknown': ['The editor and the folder differ and Weld has no earlier sync point to tell which is newer.', '#d29922'],
    'no-editor': ['Open the generator\u2019s editor (#edit) to sync it.', '#768390']
  };
  function hiddenFolderSection(parent) {
    note(parent, 'The local master folder is switched off: your work lives in the GitHub repo (GitHub tab > Push). Turn this panel on only if you want a local folder copy again; you will have to choose the folder again.');
    row(parent, [btn('Show folder sync', () => { folderCfg(); F.cfg.showPanel = true; saveFolderCfg(); draw(); }, { mini: true })]);
  }
  function folderSection(parent) {
    if (!F.supported) { note(parent, 'This browser cannot give web pages a folder to work in. Use Chrome, Edge or another Chromium browser.', { color: '#d29922' }); return; }
    note(parent, 'Master Dev location — choose one folder for all generators in this browser profile. Each generator uses its own subfolder. Open tabs pick up changes within a few seconds. GitHub Push uses its separate owner/repo settings.');
    row(parent, [btn('Pause automatic writes in all tabs', pauseFolderWrites, { mini: true })]);
    if (!F.handle) {
      note(parent, 'Choose your master folder once using the folder picker. The browser remembers it for all generators and may ask you to confirm access after a restart.');
      row(parent, [btn('Choose folder\u2026', connectFolder, { accent: true })]);
      if (F.error) note(parent, F.error, { color: '#e5534b' });
      return;
    }
    parent.appendChild(E('div', { style: { margin: '2px 0' }, text: 'Master Dev folder: ' + F.name + (F.perm === 'granted' ? '' : '  (access not confirmed)') }));
    row(parent, [btn('Change master folder\u2026', connectFolder, { mini: true })]);
    if (F.perm !== 'granted') { note(parent, 'The browser needs you to confirm access to this folder again.' + (F.cfg.keepAccess ? ' Your next click on the page will do it.' : '')); row(parent, [btn('Allow access', reconnectFolder, { accent: true }), btn('Disconnect folder', disconnectFolder, { mini: true })]); row(parent, [check('Keep access allowed (re-ask on my next click after a restart)', F.cfg.keepAccess, setKeepAccess, 'Chrome forgets folder access when it restarts. With this on, Weld re-requests it on your first click or key press.')]); return; }
    const slug = H.slug(), safe = D.safeSlug(slug);
    if (!safe) note(parent, 'Open a generator to sync it.');
    else {
      const st = F.plan ? STATE_TEXT[F.plan.state] : null;
      parent.appendChild(E('div', { style: { margin: '6px 0', color: st ? st[1] : '' }, text: slug + ': ' + (st ? st[0] : 'checking\u2026') + (F.plan && F.plan.mirrored ? ' (just mirrored)' : '') }));
      const state = F.plan && F.plan.state, kids = [];
      kids.push(btn('Write editor to folder', mirrorNow, { disabled: !H.isEdit(), mini: true, title: 'Save the editor\u2019s two panels as files in the folder.' }));
      if (state === 'disk-ahead' || state === 'conflict' || state === 'unknown') kids.push(btn('Review changes\u2026', showFolderDiff, { accent: true, mini: true }));
      if (state === 'disk-ahead') kids.push(btn('Apply folder copy', applyFolder, { mini: true }));
      if (state === 'unknown') kids.push(btn('Treat folder as latest', useFolderAsBase, { mini: true }), btn('Treat editor as latest', useEditorAsBase, { mini: true }));
      kids.push(btn('Download published copy', async () => { await seedFromPublished(slug); notice('Wrote the published copy of ' + slug + ' to the folder.'); await tick(true); }, { mini: true, title: 'Fetch the saved version from Perchance and write it to the folder.' }));
      row(parent, kids);
      row(parent, [btn('Download all files and assets (this generator)', () => downloadProject(true), { mini: true, disabled: !H.isEdit() || F.projectBusy })]);
      note(parent, 'Saves this editor, its selected src files and readable cached assets/models to ' + slug + '/ in the master folder. Models are saved as complete files. Selecting it also enables automatic updates for this generator only.');
      if (F.cfg.projectBackups[slug]) {
        row(parent, [btn('Pause project and asset updates (this generator)', pauseProject, { mini: true })]);
        note(parent, 'Project and asset updates are on for this generator. Checks run once a minute while its editor is visible and folder access is allowed.');
      }
      if (F.projectSlug === slug && F.projectStatus) note(parent, F.projectStatus);
      if (F.projectSlug === slug && F.projectError) note(parent, F.projectError, { color: '#e5534b' });
    }
    row(parent, [check('Write editors to the master folder automatically (starred generators only)', F.cfg.autoMirror, v => { folderCfg(); F.cfg.autoMirror = v; saveFolderCfg(); tick(true); }, 'Local file writes only. The other direction always needs your review.'),
      check('Watch the folder for changes', F.cfg.watch, v => { folderCfg(); F.cfg.watch = v; saveFolderCfg(); })]);
    row(parent, [check('Keep access allowed (re-ask on my next click after a restart)', F.cfg.keepAccess, setKeepAccess, 'Chrome forgets folder access when it restarts. With this on, Weld re-requests it on your first click or key press. Pick "Allow on every visit" in Chrome\u2019s prompt to stop it forgetting at all.')]);
    note(parent, 'Files: ' + (safe ? paths(slug).dsl + ' and ' + paths(slug).html : '{name}/{name}-top-panel.txt and {name}/{name}-html-panel.html') + '. Checked ' + (F.lastCheck ? ago(F.lastCheck) : 'not yet') + '.');
    if (F.error) note(parent, F.error, { color: '#e5534b' });
    row(parent, [btn('Download all starred generators', seedStarred, { mini: true, disabled: !!F.seeding }), btn('List generators in folder', listFolders, { mini: true }), btn('Disconnect folder', disconnectFolder, { mini: true })]);
    if (F.seeding) note(parent, 'Downloading ' + F.seeding + '\u2026');
    if (F.folders) {
      if (!F.folders.length) note(parent, 'No generator folders yet.');
      F.folders.slice(0, 60).forEach(f => parent.appendChild(E('div', { style: { display: 'flex', gap: '8px', padding: '2px 0', alignItems: 'center' } }, [E('span', { style: { flex: '1' }, text: f.slug }), E('span', { style: { opacity: '0.6', fontSize: '12px' }, text: ago(f.mtime) }), btn('Open editor', () => { window.location.href = 'https://perchance.org/' + encodeURIComponent(f.slug) + '#edit'; }, { mini: true })])));
    }
  }
  function bridgeSection(parent) {
    bridgeCfg();
    note(parent, 'Lets AI agents (Claude Code, Codex, Gemini CLI, Antigravity, Copilot agent mode) read the generator open here and propose changes through a small program running on your computer. Agents can never apply anything: every proposal appears below for your review.');
    const colors = { off: '#768390', connecting: '#d29922', connected: '#3fb950', error: '#e5534b' };
    parent.appendChild(E('div', { style: { margin: '4px 0', color: colors[B.state] }, text: 'Bridge: ' + (B.state === 'connected' ? 'connected' + (B.calls ? ' \u00b7 ' + B.calls + ' request(s), last: ' + B.last : '') : B.state === 'connecting' ? 'connecting\u2026' : B.state === 'error' ? B.error : 'off') }));
    parent.appendChild(field('Bridge URL', B.cfg.url, v => { B.cfg.url = v.trim(); saveBridgeCfg(); }, { placeholder: 'http://127.0.0.1:8765' }));
    parent.appendChild(field('Bridge token', B.cfg.token, v => { B.cfg.token = v.trim(); saveBridgeCfg(); }, { type: 'password', placeholder: 'filled in automatically when you press Connect', autocomplete: 'off' }));
    row(parent, [B.running ? btn('Disconnect', stopBridge) : btn('Connect', startBridge, { accent: true }),
      check('Reconnect automatically when I open Perchance', B.cfg.auto, v => { B.cfg.auto = v; saveBridgeCfg(); })]);
    row(parent, [check('Let agents propose edits (they still need your approval)', B.cfg.allowPropose, v => { B.cfg.allowPropose = v; saveBridgeCfg(); }),
      check('Let agents run samples (re-rolls the generator)', B.cfg.allowSample, v => { B.cfg.allowSample = v; saveBridgeCfg(); }, 'Off by default: update() can have side effects on some generators.')]);
    note(parent, 'Press Connect: Weld fetches the token from the bridge by itself, so there is nothing to paste. A userscript cannot start programs, so the bridge has to be running: run bridge\\install-autostart.ps1 once and it starts hidden at every Windows login (see docs/DEV.md), or double-click start-bridge.cmd when you need it.');
  }
  function proposalsSection(parent) {
    if (!S.proposals.length) return note(parent, 'Nothing yet. When an agent proposes a change it appears here with a diff.');
    S.proposals.slice(0, 20).forEach(p => {
      const live = H.isEdit() ? H.live() : null, cur = live && p.slug === H.slug() ? (p.pane === 'html' ? live.html : live.dsl) : null;
      const stale = p.status === 'pending' && cur != null && D.proposalState(p, cur) === 'stale';
      const d = H.diff(p.before, p.after);
      parent.appendChild(E('div', { style: { padding: '6px 0', borderBottom: '1px solid var(--wc-line,#2a2a2a)' } }, [
        E('div', {}, [E('b', { text: p.agent }), E('span', { text: '  \u00b7  ' + p.slug + ' \u00b7 ' + (p.pane === 'html' ? 'HTML' : 'lists') + ' panel \u00b7 +' + d.stats.add + ' \u2212' + d.stats.del + ' \u00b7 ' + ago(p.createdAt) }),
          E('span', { style: { marginLeft: '6px', color: p.status === 'applied' ? '#3fb950' : p.status === 'rejected' ? '#768390' : stale ? '#e5534b' : '#d29922' }, text: stale ? 'out of date' : p.status })]),
        p.note ? E('div', { style: { opacity: '0.8', fontSize: '12px' }, text: p.note }) : null,
        p.status === 'pending' ? E('div', { class: 'wc-row', style: { gap: '6px', marginTop: '4px', flexWrap: 'wrap' } }, [btn('Review diff', () => reviewProposal(p), { mini: true, accent: !stale }), btn('Apply', () => acceptProposal(p), { mini: true, disabled: stale || !live, title: stale ? 'The editor changed since this was proposed.' : '' }), btn('Reject', () => rejectProposal(p), { mini: true })]) : null]));
    });
  }
  function agentsSection(parent) {
    const A = S.agents; let rp = null;
    try { rp = H.slug() ? repoPaths() : null; } catch (e) { rp = null; }
    note(parent, 'Ask an agent to analyze and report, or make requested changes in your GitHub repo. For changes, review and merge the pull request on GitHub, then use Pull to load it here. Nothing in your editor changes until then.');
    if (!rp || !rp.cfg.owner) return note(parent, 'Open a generator and set your repo in the GitHub tab first.');
    parent.appendChild(E('div', { style: { margin: '2px 0' }, text: 'Repo: ' + rp.cfg.owner + '/' + rp.cfg.repo + '@' + rp.cfg.branch + '  \u00b7  ' + rp.files.dsl + ', ' + rp.files.html }));
    const sel = E('select', { class: 'wc-field', 'aria-label': 'Agent' }, Object.keys(D.AGENTS).map(k => { const o = E('option', { value: k, text: D.AGENTS[k].label }); if (k === A.agent) o.selected = true; return o; }));
    sel.addEventListener('change', () => { A.agent = sel.value; draw(); });
    parent.appendChild(sel);
    note(parent, D.AGENTS[A.agent].how);
    const modes = { auto: 'Auto (read-only unless changes are requested)', analysis: 'Analyze and report (read-only)', change: 'Change code' };
    const modeSel = E('select', { class: 'wc-field', 'aria-label': 'Task mode' }, Object.keys(modes).map(k => { const o = E('option', { value: k, text: modes[k] }); if (k === A.mode) o.selected = true; return o; }));
    modeSel.addEventListener('change', () => { A.mode = modeSel.value; draw(); }); parent.appendChild(modeSel);
    note(parent, A.mode === 'change' ? 'Only explicitly requested changes are allowed.' : 'Analysis requests return findings without source edits. Auto keeps uncertain requests read-only; choose Change code for an implementation request it does not recognize.');
    const ta = E('textarea', { class: 'wc-field', rows: '4', 'aria-label': 'What should the agent do?', placeholder: 'Example: analyze this generator and briefly explain what it does.' }); ta.value = A.request;
    ta.addEventListener('input', () => { A.request = ta.value; }); parent.appendChild(ta);
    row(parent, [btn('Check repo copy', checkRepoCopy, { mini: true, title: 'Compares the repo files with your editor.' }), btn(A.busy ? 'Working\u2026' : 'Create issue', createAgentIssue, { accent: true, disabled: A.busy })]);
    if (A.repoState) note(parent, A.repoState);
    if (A.error) note(parent, A.error, { color: '#e5534b' });
    if (A.result) row(parent, [E('span', { text: 'Issue #' + A.result.number + ' created.' }), btn('Open', () => { window.open(A.result.url, '_blank'); }, { mini: true }), btn('Copy link', () => H.copy(A.result.url), { mini: true })]);
    note(parent, 'Needs a fine-grained token with Contents and Issues (read & write). For Copilot also Pull requests and Actions. The agent\u2019s GitHub app or action must be set up on the repo.');
  }
  function refactorSection(parent) {
    const R = S.refactor, names = listNames();
    note(parent, 'Find every place a list or function is used, or rename it across both panels. Renames are shown as a diff and applied only when you confirm; Ctrl+Z undoes them.');
    const sel = E('select', { class: 'wc-field', 'aria-label': 'List to inspect' }, [E('option', { value: '', text: '(choose a list)' })].concat(names.map(n => { const o = E('option', { value: n, text: n }); if (n === R.name) o.selected = true; return o; })));
    sel.addEventListener('change', () => { R.name = sel.value; R.usages = null; R.preview = null; R.error = ''; draw(); });
    row(parent, [sel, btn('Find usages', findUsagesUi, { mini: true, disabled: !R.name })]);
    row(parent, [field('New name', R.to, v => { R.to = v.trim(); }, { placeholder: 'new name', style: { maxWidth: '180px' } }), btn('Preview rename', previewRename, { mini: true, disabled: !R.name })]);
    if (R.error) note(parent, R.error, { color: '#e5534b' });
    if (R.usages) {
      note(parent, R.usages.length + ' place(s) use "' + R.name + '":');
      R.usages.slice(0, 80).forEach(h => parent.appendChild(E('div', { style: { fontSize: '12px', padding: '2px 0', cursor: H.isEdit() ? 'pointer' : 'default', wordBreak: 'break-word' }, onclick: () => jumpTo(h) }, [E('b', { text: h.pane + ' ' + h.line + '  ' }), E('span', { style: { opacity: '0.7' }, text: h.kind + '  ' }), E('span', { text: h.text })])));
    }
    if (R.preview) {
      const p = R.preview, s = R.previewBase;
      note(parent, p.total + ' change(s): ' + p.counts.definition + ' definition, ' + p.counts.reference + ' in lists, ' + p.counts.code + ' in code. Check the diff, especially code lines.');
      diffBlock(parent, 'Lists panel', s.dsl, p.dsl); if (s.html != null) diffBlock(parent, 'HTML panel', s.html, p.html);
      row(parent, [btn('Apply rename', applyRename, { accent: true })]);
    }
  }
  function markersSection(parent) {
    note(parent, 'Draws a small coloured bar beside lines in the editor that have findings (orange = warning, red = error); hover it for the reason. It only decorates; it never edits.');
    row(parent, [check('Show markers in the editor', S.markers, v => { setMarkers(v); draw(); }), check('Include notes', S.markInfo, v => { S.markInfo = v; H.set(GM_KEYS.markers, { on: S.markers, info: S.markInfo }); lastMarkKey = ''; markTick(); })]);
    if (!H.isEdit()) note(parent, 'Open the generator\u2019s editor to see them.');
  }
  function regressSection(parent) {
    const R = S.regress, base = H.get(baselineKey(), null);
    note(parent, 'Re-rolls the generator and compares the results with a saved baseline, so you can see what an edit changed in practice (length, repeats, vocabulary). Do not use it on generators whose update() has side effects.');
    const n = E('input', { class: 'wc-field', type: 'number', min: '10', max: '100', value: R.n, 'aria-label': 'Samples', style: { width: '80px' } }); n.addEventListener('change', () => { R.n = Math.max(10, Math.min(100, Math.floor(+n.value) || 30)); });
    const via = E('select', { class: 'wc-field', 'aria-label': 'Where to sample', style: { maxWidth: '240px' } }, [['visible', 'The preview on this page'], ['published', 'Published copy (hidden frame)']].map(o => { const op = E('option', { value: o[0], text: o[1] }); if (o[0] === R.via) op.selected = true; return op; }));
    via.addEventListener('change', () => { R.via = via.value; });
    row(parent, [n, via]);
    row(parent, [btn(R.busy ? 'Sampling\u2026' : 'Save baseline', saveBaseline, { mini: true, disabled: R.busy }), btn('Compare with baseline', compareBaseline, { mini: true, accent: true, disabled: R.busy || !base })]);
    if (base) note(parent, 'Baseline: ' + base.samples.length + ' results saved ' + ago(base.t) + '.');
    if (R.error) note(parent, R.error, { color: '#e5534b' });
    if (R.result) { R.result.lines.forEach(l => parent.appendChild(E('div', { style: { margin: '2px 0', color: R.result.changed ? '#d29922' : '#3fb950' }, text: '\u2022 ' + l }))); }
  }

  // Starts the folder watcher, restores editor markers and (only if you ticked it) reconnects the bridge. Runs at
  // page load, not when the tab is first opened, so a change an agent makes to the folder is noticed right away.
  let booted = false;
  function boot() {
    if (booted) return; booted = true;
    bootFolder().catch(() => {}); bridgeCfg();
    const m = H.get(GM_KEYS.markers, null); if (m && m.on) { S.markInfo = !!m.info; setMarkers(true); }
    if (B.cfg.auto) startBridge();
  }
  function render(parent) {
    boot();
    while (parent.firstChild) parent.removeChild(parent.firstChild);
    const wrap = E('div', { id: 'wc-dev-body' });
    wrap.appendChild(E('label', { class: 'wc-label', text: 'Dev' + (H.slug() ? ' \u2014 ' + H.slug() : '') }));
    note(wrap, 'Tools for working on a generator with files, AI agents and GitHub. Nothing here changes your editor without showing you a diff first.');
    if (S.status) note(wrap, S.status);
    if (!viewPanel(wrap)) {
      const pend = pendingCount();
      section(wrap, 'proposals', 'Agent proposals', pend ? pend + ' waiting' : S.proposals.length || '', proposalsSection, pend > 0);
      if (!F.cfg.showPanel) section(wrap, 'folder', 'Folder sync', 'off', hiddenFolderSection);
      else section(wrap, 'folder', 'Folder sync', F.handle ? (F.plan && STATE_TEXT[F.plan.state] ? F.plan.state : F.name) : 'off', folderSection, true);
      section(wrap, 'bridge', 'Agent bridge (MCP)', B.state, bridgeSection);
      section(wrap, 'agents', 'GitHub agents', '', agentsSection);
      section(wrap, 'refactor', 'Find usages and rename', '', refactorSection);
      section(wrap, 'markers', 'Editor markers', S.markers ? 'on' : 'off', markersSection);
      section(wrap, 'regress', 'Regression check', '', regressSection);
    }
    parent.appendChild(wrap);
  }
  setTimeout(boot, 1200);
  window.weldDev = {
    render, boot, state: { F, B, S }, exec, tick, startBridge, stopBridge, downloadProject,
    // test hooks
    _folder: { connectWith(handle) { F.handle = handle; F.name = handle.name || 'folder'; F.perm = 'granted'; F.supported = true; F.bootDone = true; folderCfg(); return kvSet('handle', handle); } }
  };
})();
