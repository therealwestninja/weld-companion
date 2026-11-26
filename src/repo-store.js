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
    const S = { cache: new Map(), base: new Map(), sha: new Map(), pending: new Map(), names: new Map(), loaded: false, loading: null, timer: null, flushing: null, error: '', conflicts: 0, listeners: [], verified: '', truncated: false, hold: 0, extras: [], gql: true };
    const changed = () => S.listeners.forEach(f => { try { f(); } catch (e) { } });
    const ident = x => x.owner + '/' + x.repo + '@' + String(x.branch || 'main');
    const c0 = () => { const x = cfg(); return x && x.token && x.owner && x.repo ? x : null; };
    // Writes need a repo that passed the private check. If the configured repo, branch or token changes, everything read
    // from the old one is dropped (including queued edits) so it can never be written to the new one.
    function reset() { S.cache.clear(); S.base.clear(); S.sha.clear(); S.pending.clear(); S.names.clear(); S.extras = []; S.gql = true; S.loaded = false; S.verified = ''; S.truncated = false; if (S.timer) { clearTimeout(S.timer); S.timer = null; } }
    const c = () => { const x = c0(); if (x && S.verified && S.verified !== ident(x)) reset(); return x; };
    const base = x => '/repos/' + encodeURIComponent(x.owner) + '/' + encodeURIComponent(x.repo);
    const q = x => '?ref=' + encodeURIComponent(String(x.branch || 'main').replace(/^refs\/heads\//, ''));
    const fpath = (x, sub, name) => base(x) + '/contents/' + DIR + (sub ? '/' + sub : '') + '/' + name;
    const docText = (key, raw) => '{"format":"weld-data","v":1,"key":' + JSON.stringify(key) + ',"savedAt":' + Date.now() + ',"value":' + raw + '}';
    const stampNow = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const branchOf = x => String(x.branch || 'main').replace(/^refs\/heads\//, '');
    // Git's blob hash of what was written, so the next load knows the file is ours (null: the next read re-learns it).
    const subtle = opt.subtle || (typeof crypto !== 'undefined' && crypto && crypto.subtle) || null;
    async function gitSha(text) {
      if (!subtle || typeof TextEncoder === 'undefined') return null;
      try {
        const body = new TextEncoder().encode(text), head = new TextEncoder().encode('blob ' + body.length + '\0'), all = new Uint8Array(head.length + body.length);
        all.set(head); all.set(body, head.length);
        return Array.from(new Uint8Array(await subtle.digest('SHA-1', all)), b => b.toString(16).padStart(2, '0')).join('');
      } catch (e) { return null; }
    }

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
        const stamp = stampNow(), name = fileName(key).replace(/\.json$/, '') + '-' + why + '-' + stamp + '.json';
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
    // While a generator Push runs, writes wait (each one is a commit on the same branch and would move it under the push).
    function hold() { S.hold++; }
    function release() { if (S.hold > 0) S.hold--; if (!S.hold && (S.pending.size || S.extras.length) && !S.timer) S.timer = setTimeout(() => { S.timer = null; flush().catch(() => { }); }, DELAY); }

    // ---- one commit per save cycle (1.96.0). Every waiting key, plus any conflict/legacy copies, goes into ONE GraphQL
    // createCommitOnBranch commit instead of a commit per key. One read first returns the branch head and each file's
    // current blob (oid + text), so the same three-way merge as writeKey runs before anything is sent. The commit names
    // that head (expectedHeadOid): if the branch moved meanwhile, GitHub refuses it and the cycle re-reads and retries.
    // No GraphQL (old token, API refusal): the per-key REST writes below are used instead.
    const MAX_FILES = 60, MAX_CHARS = 1500000;
    function takeBatch() {
      const out = []; let size = 0;
      for (const [key, raw] of S.pending) {
        const n = raw === null ? 0 : raw.length;
        if (out.length && (out.length >= MAX_FILES || size + n > MAX_CHARS)) break;
        out.push([key, raw]); size += n;
      }
      out.forEach(([key]) => S.pending.delete(key));
      return out;
    }
    const gqlOk = r => r && r.status === 200 && r.json && !r.json.errors && r.json.data;
    async function readState(x, names) {   // -> { head, files: [{ oid, text } | null] } | null (no GraphQL or no branch)
      const vars = { owner: x.owner, name: x.repo, ref: 'refs/heads/' + branchOf(x) }, decl = ['$owner:String!', '$name:String!', '$ref:String!'];
      let sel = 'ref(qualifiedName:$ref){target{oid}}';
      names.forEach((n, i) => { vars['e' + i] = branchOf(x) + ':' + DIR + '/' + n; decl.push('$e' + i + ':String!'); sel += ' f' + i + ':object(expression:$e' + i + '){...on Blob{oid text isBinary}}'; });
      const r = await API('POST', '/graphql', { query: 'query(' + decl.join(',') + '){repository(owner:$owner,name:$name){' + sel + '}}', variables: vars });
      const repo = gqlOk(r) && r.json.data.repository;
      if (!repo || !repo.ref || !repo.ref.target || !repo.ref.target.oid) return null;
      return { head: repo.ref.target.oid, files: names.map((n, i) => repo['f' + i] && repo['f' + i].oid ? repo['f' + i] : null) };
    }
    // -> 'ok' | 'rest' (use the REST path for this batch). Throws when GitHub cannot be reached or keeps moving.
    const held = [];   // keys set aside by the last commitBatch (their file name belongs to another key)
    async function commitBatch(x, batch, extras) {
      for (let round = 0; round < 4; round++) {
        const names = batch.map(([key]) => fileName(key)), st = await readState(x, names);
        if (!st) return 'rest';
        const adds = [], dels = [], after = [], merged = []; held.length = 0;
        for (let i = 0; i < batch.length; i++) {
          const key = batch[i][0], name = names[i], f = st.files[i], known = S.sha.get(key);
          let raw = batch[i][1], theirsRaw = null, theirsSha = f ? f.oid : null;
          if (f && f.oid !== known) {   // the repo copy is not the one this computer last synced
            let doc = null;
            if (typeof f.text === 'string') { try { doc = JSON.parse(f.text); } catch (e) { } }
            else { const rf = await readFile(x, { name }); doc = rf && rf.doc; theirsSha = rf ? rf.sha : theirsSha; }   // large or binary: REST read
            if (!doc || doc.key !== key) { held.push(batch[i]); continue; }   // the file name is taken by another key: never overwrite it
            theirsRaw = JSON.stringify(doc.value === undefined ? null : doc.value);
          }
          if (raw === null) {   // delete
            if (!f) { after.push({ key, name, gone: true }); continue; }
            if (f.oid !== known) {
              if (theirsRaw !== S.base.get(key)) { after.push({ key, name, keep: theirsRaw, sha: theirsSha }); merged.push('kept'); continue; }   // changed elsewhere: keep it
            }
            dels.push({ path: DIR + '/' + name }); after.push({ key, name, gone: true }); continue;
          }
          if (theirsRaw !== null) {
            if (theirsRaw === raw) { after.push({ key, name, keep: theirsRaw, sha: theirsSha }); continue; }   // already there (e.g. an earlier commit landed without a reply)
            const baseRaw = S.base.get(key), m = merge(key, baseRaw === undefined ? undefined : JSON.parse(baseRaw), JSON.parse(raw), JSON.parse(theirsRaw));
            m.losers.forEach(l => extras.push({ sub: 'conflicts', name: name.replace(/\.json$/, '') + '-merged-' + stampNow() + '-' + extras.length + '.json', text: docText(key, JSON.stringify(l === undefined ? null : l)) }));
            raw = JSON.stringify(m.value === undefined ? null : m.value); merged.push(m.losers.length ? 'lost' : 'merged');
            if (raw === theirsRaw) { after.push({ key, name, keep: theirsRaw, sha: theirsSha }); continue; }
          }
          const text = docText(key, raw);
          adds.push({ path: DIR + '/' + name, contents: enc(text) }); after.push({ key, name, raw, text });
        }
        extras.forEach(e => adds.push({ path: DIR + '/' + e.sub + '/' + e.name, contents: enc(e.text) }));
        if (adds.length || dels.length) {
          const keys = batch.map(([k]) => k), headline = 'Weld: save ' + (keys.length === 1 ? keys[0] : keys.length + ' items (' + keys.slice(0, 3).join(', ') + (keys.length > 3 ? ', ...' : '') + ')');
          const input = { branch: { repositoryNameWithOwner: x.owner + '/' + x.repo, branchName: branchOf(x) }, message: { headline }, expectedHeadOid: st.head, fileChanges: { additions: adds } };
          if (dels.length) input.fileChanges.deletions = dels;
          const r = await API('POST', '/graphql', { query: 'mutation($input:CreateCommitOnBranchInput!){createCommitOnBranch(input:$input){commit{oid}}}', variables: { input } });
          if (!(gqlOk(r) && r.json.data.createCommitOnBranch && r.json.data.createCommitOnBranch.commit)) {
            const why = (r && r.json && r.json.errors && r.json.errors.map(e => e.message).join('; ')) || (r && r.error) || ('HTTP ' + (r && r.status));
            if (r && r.status === 200 && /expected branch to point to|but it did not|expectedHeadOid/i.test(why)) continue;   // moved: re-read, re-merge
            if (r && r.status === 200) return 'rest';   // refused (permissions, API shape): the REST path reports it properly
            throw new Error('GitHub did not answer the save (' + why + ')');   // may have landed: the next cycle's read sorts it out
          }
        }
        for (const a of after) {   // applied only once the commit is in
          if (a.gone) { S.sha.delete(a.key); S.base.delete(a.key); S.names.delete(a.name); if (!S.pending.has(a.key)) S.cache.delete(a.key); continue; }
          const raw = a.keep !== undefined ? a.keep : a.raw;
          S.base.set(a.key, raw); S.names.set(a.name, a.key);
          const sha = a.keep !== undefined ? a.sha : await gitSha(a.text);
          if (sha) S.sha.set(a.key, sha); else S.sha.delete(a.key);
          if (!S.pending.has(a.key)) S.cache.set(a.key, raw);   // a newer edit made during the save stays
        }
        extras.length = 0;
        if (merged.length) {
          S.conflicts += merged.length;
          toast(merged.includes('kept') && merged.length === 1 ? 'A file you deleted was changed on another computer, so it was kept.'
            : 'Some of this was also changed on another computer. Both sets of changes were merged' + (merged.includes('lost') ? ' (versions that lost are under _weld-data/conflicts).' : '.'), 9000);
          changed();
        }
        return 'ok';
      }
      throw new Error('it kept changing on GitHub. Weld retries on the next save');
    }
    async function restBatch(x, batch, extras) {
      for (const e of extras.splice(0)) {
        const r = await API('PUT', fpath(x, e.sub, e.name), { message: 'Weld: keep a copy (' + e.sub + ')', content: enc(e.text), branch: branchOf(x) });
        if (r.status !== 200 && r.status !== 201) { extras.push(e); throw new Error('GitHub answered ' + r.status + ' saving ' + e.sub + '/' + e.name); }
      }
      for (let i = 0; i < batch.length; i++) {
        const [key, raw] = batch[i];
        try { await writeKey(x, key, raw); }
        catch (e) { batch.slice(i).forEach(([k, v]) => { if (!S.pending.has(k)) S.pending.set(k, S.cache.has(k) ? S.cache.get(k) : v); }); throw e; }
      }
    }
    async function flush() {
      if (S.hold) return;   // kept in pending; release() sends them
      if (S.flushing) { await S.flushing; if ((S.pending.size || S.extras.length) && !S.timer && !S.hold) return flush(); return; }
      S.flushing = (async () => {
        const x = c(); if (!x || !S.loaded || S.verified !== ident(x)) return;
        while ((S.pending.size || S.extras.length) && !S.hold) {
          const batch = takeBatch(), extras = S.extras.splice(0);
          try {
            if (!S.gql || (await commitBatch(x, batch, extras)) === 'rest') { S.gql = false; held.length = 0; await restBatch(x, batch, extras); }
            S.error = '';
            if (held.length) {
              held.forEach(([k, v]) => { if (!S.pending.has(k)) S.pending.set(k, v); });
              S.error = 'Could not save ' + held.map(h => h[0]).join(', ') + ': its file name in _weld-data is taken by another key; nothing was overwritten.'; try { toast(S.error, 9000); } catch (z) { }
              held.length = 0; break;
            }
          } catch (e) {
            batch.forEach(([k, v]) => { if (!S.pending.has(k)) S.pending.set(k, S.cache.has(k) ? S.cache.get(k) : v); });
            S.extras = extras.concat(S.extras);
            S.error = 'Could not save to GitHub: ' + ((e && e.message) || e) + '. Weld retries on the next save.'; try { toast(S.error, 9000); } catch (z) { }
            break;
          }
        }
      })();
      try { await S.flushing; } finally { S.flushing = null; }
    }
    // Legacy copies (browser storage, the old backup folder): the repo wins. A copy of a key the repo lacks is imported;
    // otherwise it is filed under _weld-data/legacy/ so nothing is lost and nothing comes back. -> 'moved' | 'filed' | null (not safe to remove yet)
    async function importLegacy(key, value, source) { return (await importLegacyMany([[key, value]], source)).get(key) || null; }
    // Many at once: everything goes out in as few commits as the size limits allow. -> Map key -> 'moved' | 'filed' | null
    async function importLegacyMany(items, source) {
      const out = new Map(), x = c(); if (!x || !S.loaded || S.verified !== ident(x)) return out;
      const filed = new Map();
      for (const [key, value] of items) {
        let raw; try { raw = JSON.stringify(value === undefined ? null : value); } catch (e) { out.set(key, null); continue; }
        if (!S.cache.has(key) || S.cache.get(key) === null) { out.set(key, set(key, value) ? 'moved' : null); continue; }
        if (raw === S.cache.get(key)) { out.set(key, 'moved'); continue; }
        const e = { sub: 'legacy', name: fileName(key).replace(/\.json$/, '') + '-' + source + '-' + stampNow() + '-' + S.extras.length + '.json', text: docText(key, raw) };
        S.extras.push(e); filed.set(key, e); out.set(key, 'filed');
      }
      if (S.timer) { clearTimeout(S.timer); S.timer = null; }
      try { await flush(); } catch (e) { }
      for (const [key, r] of out) {
        if (r === 'moved' && S.pending.has(key)) out.set(key, null);
        if (r === 'filed' && S.extras.indexOf(filed.get(key)) !== -1) out.set(key, null);
      }
      return out;
    }
    function status() {
      if (!c()) return 'Saved in your GitHub repo. Set owner, repo and token in Weld > GitHub to load and save.';
      const x = c();
      if (S.error) return S.error;
      return S.loaded ? 'Saved in GitHub: ' + x.owner + '/' + x.repo + '/' + DIR : 'Loading from GitHub...';
    }
    return { get, set, load, flush, importLegacy, importLegacyMany, status, hold, release, held: () => S.hold > 0, ready: () => !!c() && S.loaded, configured: () => !!c(), keys: () => Array.from(S.cache.keys()).filter(k => S.cache.get(k) !== null),
      pending: () => S.pending.size + S.extras.length, truncated: () => S.truncated, onChange: f => { S.listeners.push(f); }, _state: S };
  }
  return { create, merge, fileName, DIR, canon };
});
