/* Repo store: Weld's work data (Studio projects, Scrapbook, notes, pins, favorites ...) lives as JSON files in the
   GitHub repo at <repo>/_weld-data/, not in browser storage. Every write carries the file's last-seen sha, so GitHub
   refuses it when another computer changed the file first; the write is then merged (three-way, so a deletion made
   here or there is kept) and retried. Nothing is ever resurrected from an old local copy: legacy copies are only
   imported for keys the repo does not have, and otherwise filed under _weld-data/legacy/. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WeldRepoStore = factory();
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const DIR = '_weld-data';
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  function hash8(t) { let h = 5381; t = String(t); for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0; return ('00000000' + h.toString(16)).slice(-8); }
  const fileName = key => String(key).replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) + '-' + hash8(key) + '.json';
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (isObj(v)) return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  const same = (a, b) => canon(a) === canon(b);
  const stampOf = x => { if (!isObj(x)) return 0; for (const k of ['revision', 'updatedAt', 'savedAt', 'modified', 't']) if (typeof x[k] === 'number') return x[k]; return 0; };
  const idList = a => Array.isArray(a) && a.every(x => isObj(x) && x.id !== undefined && x.id !== null);

  // Three-way merge of one key. base = what this computer last synced, mine = its edit, theirs = what the repo holds now.
  // -> { value, losers: [values that were not kept] }
  function merge(key, base, mine, theirs) {
    const losers = [];
    function rec(b, m, t, top) {
      if (same(m, t)) return m;
      if (same(m, b)) return t;               // only the repo changed
      if (same(t, b)) return m;               // only this computer changed
      if (idList(m) && idList(t) && (b === undefined || b === null || idList(b))) {
        const bm = new Map((b || []).map(x => [x.id, x])), mm = new Map(m.map(x => [x.id, x])), tm = new Map(t.map(x => [x.id, x]));
        const out = [];
        t.forEach(tx => {
          const bx = bm.get(tx.id), mx = mm.get(tx.id);
          if (mx === undefined) { if (bx === undefined || !same(tx, bx)) out.push(tx); return; }   // gone here: drop only if the repo did not edit it
          const mineChanged = bx === undefined || !same(mx, bx), theirsChanged = bx === undefined || !same(tx, bx);
          if (!mineChanged) out.push(tx); else if (!theirsChanged) out.push(mx);
          else if (same(mx, tx)) out.push(tx);
          else if (stampOf(mx) > stampOf(tx)) { losers.push(tx); out.push(mx); } else { losers.push(mx); out.push(tx); }
        });
        m.forEach(mx => { if (!tm.has(mx.id)) { const bx = bm.get(mx.id); if (bx === undefined || !same(mx, bx)) out.push(mx); } });   // added here; or edited here but deleted in the repo
        if (out.every(x => typeof x.t === 'number')) out.sort((x, y) => y.t - x.t);
        return out;
      }
      if (isObj(m) && isObj(t) && !(typeof m.revision === 'number' && typeof t.revision === 'number')) {
        const bb = isObj(b) ? b : {}, out = {};
        new Set(Object.keys(m).concat(Object.keys(t), Object.keys(bb))).forEach(k => {
          const v = rec(bb[k], m[k], t[k], false);
          if (v !== undefined) out[k] = v;
        });
        return out;
      }
      if (m === undefined) return same(t, b) ? undefined : t;
      if (t === undefined) return same(m, b) ? undefined : m;
      if (stampOf(m) > stampOf(t)) { losers.push(t); return m; }
      losers.push(m); return t;                // a tie goes to the repo: the other computer saved first
    }
    const value = rec(base, mine, theirs, true);
    return { value, losers };
  }

  function create(opt) {
    const API = opt.api, cfg = opt.config, toast = opt.toast || (() => {}), DELAY = opt.delay == null ? 1500 : opt.delay;
    const enc = opt.encode || (s => (typeof Buffer !== 'undefined' ? Buffer.from(s, 'utf8').toString('base64') : btoa(unescape(encodeURIComponent(s)))));
    const dec = opt.decode || (b => (typeof Buffer !== 'undefined' ? Buffer.from(b, 'base64').toString('utf8') : decodeURIComponent(escape(atob(b)))));
    const S = { cache: new Map(), base: new Map(), sha: new Map(), pending: new Map(), names: new Map(), loaded: false, loading: null, timer: null, flushing: null, error: '', conflicts: 0, listeners: [], verified: '', truncated: false };
    const changed = () => S.listeners.forEach(f => { try { f(); } catch (e) { } });
    const ident = x => x.owner + '/' + x.repo + '@' + String(x.branch || 'main');
    const c0 = () => { const x = cfg(); return x && x.token && x.owner && x.repo ? x : null; };
    // Writes need a repo that passed the private check. If the configured repo, branch or token changes, everything read
    // from the old one is dropped (including queued edits) so it can never be written to the new one.
    function reset() { S.cache.clear(); S.base.clear(); S.sha.clear(); S.pending.clear(); S.names.clear(); S.loaded = false; S.verified = ''; S.truncated = false; if (S.timer) { clearTimeout(S.timer); S.timer = null; } }
    const c = () => { const x = c0(); if (x && S.verified && S.verified !== ident(x)) reset(); return x; };
    const base = x => '/repos/' + encodeURIComponent(x.owner) + '/' + encodeURIComponent(x.repo);
    const q = x => '?ref=' + encodeURIComponent(String(x.branch || 'main').replace(/^refs\/heads\//, ''));
    const fpath = (x, sub, name) => base(x) + '/contents/' + DIR + (sub ? '/' + sub : '') + '/' + name;
    const docText = (key, raw) => '{"format":"weld-data","v":1,"key":' + JSON.stringify(key) + ',"savedAt":' + Date.now() + ',"value":' + raw + '}';

    async function readFile(x, entry) {   // -> { sha, doc } | null
      let r = await API('GET', fpath(x, '', entry.name) + q(x));
      if (r.status === 404) return null;
      if (r.status !== 200 || !r.json) throw new Error('GitHub answered ' + r.status + ' reading ' + entry.name);
      let text = r.json.content ? dec(String(r.json.content).replace(/\s/g, '')) : null;
      if (text === null) { const b = await API('GET', base(x) + '/git/blobs/' + r.json.sha); if (b.status !== 200 || !b.json) throw new Error('GitHub answered ' + b.status + ' reading ' + entry.name); text = dec(String(b.json.content).replace(/\s/g, '')); }
      let doc = null; try { doc = JSON.parse(text); } catch (e) { }
      return { sha: r.json.sha, doc };
    }
    // Read every file whose sha changed (all the first time); files gone from the repo are dropped unless edited here.
    async function load() {
      const x = c(); if (!x) return false;
      if (S.loading) return S.loading;
      S.loading = (async () => {
        let any = false;
        try {
          if (S.verified && S.verified !== ident(x)) reset();
          const meta = await API('GET', base(x));   // personal notes and chats are only stored in a private repo
          if (meta.status === 200 && meta.json && meta.json.private !== true) { reset(); throw new Error(x.owner + '/' + x.repo + ' is a public repo, so nothing is stored in it. Use a private repo in Weld > GitHub'); }
          const r = await API('GET', base(x) + '/contents/' + DIR + q(x));
          let list = [];
          if (r.status === 200 && Array.isArray(r.json)) list = r.json.filter(e => e.type === 'file' && /\.json$/.test(e.name));
          else if (r.status !== 404) throw new Error('GitHub answered ' + r.status + ' listing ' + DIR + (r.status === 401 || r.status === 403 ? ' (check the token has Contents access to this repo)' : ''));
          const truncated = S.truncated = r.status === 200 && Array.isArray(r.json) && r.json.length >= 1000;   // the directory listing is cut off at 1000 entries
          const seen = new Set();
          for (const e of list) {
            const known = S.names.get(e.name);
            if (known && S.sha.get(known) === e.sha) { seen.add(known); continue; }
            const f = await readFile(x, e);
            if (!f || !f.doc || f.doc.format !== 'weld-data' || typeof f.doc.key !== 'string' || fileName(f.doc.key) !== e.name) continue;
            const key = f.doc.key; seen.add(key);
            S.names.set(e.name, key); S.sha.set(key, f.sha);
            if (S.pending.has(key)) continue;   // an edit made here is merged when it is written
            const raw = JSON.stringify(f.doc.value === undefined ? null : f.doc.value);
            S.cache.set(key, raw); S.base.set(key, raw); any = true;
          }
          if (!truncated) Array.from(S.sha.keys()).forEach(k => { if (!seen.has(k) && !S.pending.has(k)) { S.sha.delete(k); S.cache.delete(k); S.base.delete(k); S.names.delete(fileName(k)); any = true; } });
          const first = !S.loaded; S.loaded = true; S.verified = ident(x); S.error = '';
          if (first) any = true;
        } catch (e) { S.error = 'Could not read Weld data from GitHub: ' + ((e && e.message) || e); }
        S.loading = null;
        if (any) changed();
        return S.loaded;
      })();
      return S.loading;
    }
    function get(key, dflt) {
      if (!S.cache.has(key)) return dflt;
      const raw = S.cache.get(key); if (raw === null) return dflt;
      try { return JSON.parse(raw); } catch (e) { return dflt; }
    }
    function set(key, value) {
      if (!c() || !S.loaded || S.verified !== ident(c())) return false;
      let raw = null;
      if (value !== null && value !== undefined) { try { raw = JSON.stringify(value); } catch (e) { return false; } if (raw === undefined) return false; }
      S.cache.set(key, raw); S.pending.set(key, raw);
      if (!S.timer) S.timer = setTimeout(() => { S.timer = null; flush().catch(() => { }); }, DELAY);
      return true;
    }
    async function writeConflict(x, key, value, why) {
      try {
        const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15), name = fileName(key).replace(/\.json$/, '') + '-' + why + '-' + stamp + '.json';
        await API('PUT', fpath(x, 'conflicts', name), { message: 'Weld: keep a version that lost a merge (' + key + ')', content: enc(docText(key, JSON.stringify(value === undefined ? null : value))), branch: String(x.branch || 'main') });
      } catch (e) { }
    }
    async function writeKey(x, key, raw) {
      const name = fileName(key);
      for (let attempt = 0; attempt < 4; attempt++) {
        const sha = S.sha.get(key);
        let r;
        if (raw === null) { if (!sha) { S.cache.delete(key); return; } r = await API('DELETE', fpath(x, '', name), { message: 'Weld: delete ' + key, sha, branch: String(x.branch || 'main') }); }
        else r = await API('PUT', fpath(x, '', name), { message: 'Weld: update ' + key, content: enc(docText(key, raw)), sha: sha || undefined, branch: String(x.branch || 'main') });
        if (r.status === 200 || r.status === 201) {
          if (raw === null) { S.sha.delete(key); S.cache.delete(key); S.base.delete(key); S.names.delete(name); } else { S.sha.set(key, r.json && r.json.content && r.json.content.sha); S.base.set(key, raw); S.names.set(name, key); }
          return;
        }
        if (r.status === 409 || r.status === 422 || (r.status === 404 && raw === null)) {   // the repo changed under us, or the file is new/gone
          const f = await readFile(x, { name });
          if (!f) { S.sha.delete(key); S.base.delete(key); if (raw === null) { S.cache.delete(key); return; } continue; }   // gone in the repo: write ours as a new file
          if (!f.doc || f.doc.key !== key) throw new Error('the file name for ' + key + ' is taken by another key; nothing was overwritten');
          const theirsRaw = JSON.stringify(f.doc && f.doc.value !== undefined ? f.doc.value : null), baseRaw = S.base.get(key);
          S.sha.set(key, f.sha);
          if (raw === null) { if (theirsRaw === baseRaw) continue; S.conflicts++; raw = theirsRaw; S.cache.set(key, raw); S.base.set(key, raw); toast('A file you deleted was changed on another computer, so it was kept.', 9000); changed(); return; }
          const m = merge(key, baseRaw === undefined ? undefined : JSON.parse(baseRaw), JSON.parse(raw), JSON.parse(theirsRaw));
          for (const l of m.losers) await writeConflict(x, key, l, 'merged');
          raw = JSON.stringify(m.value === undefined ? null : m.value); S.cache.set(key, raw); S.base.set(key, theirsRaw);
          S.conflicts++; toast('This was also changed on another computer. Both sets of changes were merged' + (m.losers.length ? ' (the version that lost is under _weld-data/conflicts).' : '.'), 9000); changed();
          if (raw === theirsRaw) { return; }
          continue;
        }
        const e = new Error('GitHub answered ' + r.status + (r.json && r.json.message ? ' ' + r.json.message : '') + ' saving ' + key); e.status = r.status; throw e;
      }
      throw new Error('Could not save ' + key + ': it kept changing on GitHub. Try again.');
    }
    async function flush() {
      if (S.flushing) { await S.flushing; if (S.pending.size && !S.timer) return flush(); return; }
      S.flushing = (async () => {
        const x = c(); if (!x || !S.loaded || S.verified !== ident(x)) return;
        const batch = Array.from(S.pending.entries()); S.pending.clear();
        for (const [key, raw] of batch) {
          try { await writeKey(x, key, raw); S.error = ''; }
          catch (e) { if (!S.pending.has(key)) S.pending.set(key, S.cache.has(key) ? S.cache.get(key) : raw); S.error = 'Could not save to GitHub: ' + ((e && e.message) || e) + '. Weld retries on the next save.'; try { toast(S.error, 9000); } catch (z) { } }
        }
      })();
      try { await S.flushing; } finally { S.flushing = null; }
    }
    // Legacy copies (browser storage, the old backup folder): the repo wins. A copy of a key the repo lacks is imported;
    // otherwise it is filed under _weld-data/legacy/ so nothing is lost and nothing comes back. -> 'moved' | 'filed' | null (not safe to remove yet)
    async function importLegacy(key, value, source) {
      const x = c(); if (!x || !S.loaded || S.verified !== ident(x)) return null;
      try {
        if (!S.cache.has(key) || S.cache.get(key) === null) { set(key, value); await flush(); return S.pending.has(key) ? null : 'moved'; }
        const raw = JSON.stringify(value);
        if (raw === S.cache.get(key)) return 'moved';
        const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15), name = fileName(key).replace(/\.json$/, '') + '-' + source + '-' + stamp + '.json';
        const r = await API('PUT', fpath(x, 'legacy', name), { message: 'Weld: keep an older local copy of ' + key, content: enc(docText(key, raw)), branch: String(x.branch || 'main') });
        return r.status === 200 || r.status === 201 ? 'filed' : null;
      } catch (e) { return null; }
    }
    function status() {
      if (!c()) return 'Saved in your GitHub repo. Set owner, repo and token in Weld > GitHub to load and save.';
      const x = c();
      if (S.error) return S.error;
      return S.loaded ? 'Saved in GitHub: ' + x.owner + '/' + x.repo + '/' + DIR : 'Loading from GitHub...';
    }
    return { get, set, load, flush, importLegacy, status, ready: () => !!c() && S.loaded, configured: () => !!c(), keys: () => Array.from(S.cache.keys()).filter(k => S.cache.get(k) !== null),
      pending: () => S.pending.size, truncated: () => S.truncated, onChange: f => { S.listeners.push(f); }, _state: S };
  }
  return { create, merge, fileName, DIR, canon };
});
