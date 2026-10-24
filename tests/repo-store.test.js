// Repo store: three-way merge rules and sha-checked writes against a fake GitHub Contents API.
const assert = require('node:assert/strict');
const R = require('../src/repo-store.js');

// ---- merge: deletions and edits from both computers survive
{
  const m = (b, a, t) => R.merge('k', b, a, t);
  const base = [{ id: 1, t: 1 }, { id: 2, t: 2 }, { id: 3, t: 3 }];
  // this computer deleted 2; the other added 4: 2 stays gone, 4 arrives
  assert.deepEqual(m(base, [base[0], base[2]], base.concat([{ id: 4, t: 4 }])).value.map(x => x.id).sort(), [1, 3, 4]);
  // the other computer deleted 3; this one added 5: 3 stays gone
  assert.deepEqual(m(base, base.concat([{ id: 5, t: 5 }]), [base[0], base[1]]).value.map(x => x.id).sort(), [1, 2, 5]);
  // this computer deleted 2 but the other edited it: the edit wins over the delete
  assert.ok(m(base, [base[0], base[2]], [base[0], { id: 2, t: 2, text: 'edited' }, base[2]]).value.some(x => x.id === 2 && x.text === 'edited'));
  // same entry edited on both: the newer stamp wins and the loser is reported
  const both = m(base, [{ id: 1, t: 10, text: 'mine' }, base[1], base[2]], [{ id: 1, t: 20, text: 'theirs' }, base[1], base[2]]);
  assert.equal(both.value.find(x => x.id === 1).text, 'theirs'); assert.equal(both.losers.length, 1);
  // an old local copy with no base never deletes anything of the repo's
  assert.deepEqual(m(undefined, [{ id: 9, t: 9 }], base).value.map(x => x.id).sort(), [1, 2, 3, 9]);
}
{
  // objects: per-field three-way; a key removed here stays removed
  const out = R.merge('k', { a: 1, b: 2, c: 3 }, { a: 1, b: 20 }, { a: 10, b: 2, c: 3, d: 4 }).value;
  assert.deepEqual(out, { a: 10, b: 20, d: 4 });
  // projects with a revision: the higher one wins whole and the other is kept as a conflict
  const p = R.merge('studio:project:v1:p', { revision: 1 }, { revision: 2, name: 'mine' }, { revision: 3, name: 'theirs' });
  assert.equal(p.value.name, 'theirs'); assert.deepEqual(p.losers.map(x => x.name), ['mine']);
}

// ---- store against a fake API
function fakeGitHub() {
  const files = new Map(); let n = 0, puts = 0;
  const api = async (method, path, body) => {
    const mt = path.match(/\/contents\/([^?]+)/); if (!mt) return { status: 200, json: { private: path.indexOf('/pub') < 0 } };
    const p = decodeURIComponent(mt[1]);
    if (method === 'GET') {
      if (files.has(p)) return { status: 200, json: { sha: files.get(p).sha, content: Buffer.from(files.get(p).text).toString('base64') } };
      const list = [...files].filter(([f]) => f.startsWith(p + '/') && !f.slice(p.length + 1).includes('/')).map(([f, v]) => ({ type: 'file', name: f.slice(p.length + 1), sha: v.sha }));
      return list.length ? { status: 200, json: list } : { status: 404, json: null };
    }
    const cur = files.get(p);
    if (method === 'PUT') {
      puts++;
      if (cur && !body.sha) return { status: 422, json: { message: 'sha' } };
      if (cur && body.sha !== cur.sha) return { status: 409, json: { message: 'conflict' } };
      files.set(p, { text: Buffer.from(body.content, 'base64').toString('utf8'), sha: 's' + (++n) });
      return { status: cur ? 200 : 201, json: { content: { sha: files.get(p).sha } } };
    }
    if (!cur) return { status: 404, json: null };
    if (body.sha !== cur.sha) return { status: 409, json: {} };
    files.delete(p); return { status: 200, json: {} };
  };
  return { files, api, puts: () => puts };
}
const mk = (gh, name) => R.create({ api: gh.api, config: () => ({ owner: 'o', repo: 'r', branch: 'main', token: 't' }), toast: m => { mk.toasts.push(name + ': ' + m); }, delay: 0 });
mk.toasts = [];

(async () => {
  const gh = fakeGitHub();
  const A = mk(gh, 'A'), B = mk(gh, 'B');
  await A.load(); await B.load();
  assert.equal(A.set('scrapbook', [{ id: 'a', t: 1 }, { id: 'b', t: 2 }]), true); await A.flush();
  await B.load(); assert.deepEqual(B.get('scrapbook', []).map(x => x.id), ['a', 'b']);
  // B deletes 'a' and saves; A (stale) adds 'c' and saves: the delete survives, c arrives, nothing is lost
  B.set('scrapbook', [{ id: 'b', t: 2 }]); await B.flush();
  A.set('scrapbook', [{ id: 'a', t: 1 }, { id: 'b', t: 2 }, { id: 'c', t: 3 }]); await A.flush();
  const stored = JSON.parse(gh.files.get('_weld-data/' + R.fileName('scrapbook')).text).value;
  assert.deepEqual(stored.map(x => x.id), ['c', 'b'], 'the deleted entry did not come back');
  assert.deepEqual(A.get('scrapbook', []).map(x => x.id), ['c', 'b']);
  assert.ok(mk.toasts.some(t => /^A: .*changed on another computer/.test(t)));
  // a write with the wrong sha never overwrites: the data of the other computer is in the merge, not replaced
  // nothing is written before the first load, or without a token
  const C0 = R.create({ api: gh.api, config: () => ({ owner: 'o', repo: 'r', branch: 'main', token: '' }) });
  assert.equal(C0.set('x', 1), false); assert.equal(C0.ready(), false);
  const C1 = mk(gh, 'C'); assert.equal(C1.set('x', 1), false, 'not loaded yet');
  // large/odd keys map to safe names
  assert.match(R.fileName('studio:project:v1:p1'), /^studio-project-v1-p1-[0-9a-f]{8}\.json$/);
  // delete removes the file; the other computer sees it go
  await B.load(); B.set('scrapbook', null); await B.flush();
  assert.equal(gh.files.has('_weld-data/' + R.fileName('scrapbook')), false);
  await A.load(); assert.equal(A.get('scrapbook', 'gone'), 'gone');
  // legacy import: a key the repo lacks is imported; one it has is filed, never merged
  assert.equal(await A.importLegacy('notes', [{ id: 1 }], 'browser'), 'moved');
  assert.equal(await A.importLegacy('notes', [{ id: 1 }, { id: 'resurrected' }], 'browser'), 'filed');
  assert.deepEqual(A.get('notes', []), [{ id: 1 }]);
  assert.ok([...gh.files.keys()].some(f => /_weld-data\/legacy\/notes-.*-browser-/.test(f)));
  // a failing write keeps the edit pending and reports it
  const bad = R.create({ api: async (m, p, b) => (m === 'PUT' ? { status: 500, json: { message: 'boom' } } : gh.api(m, p, b)), config: () => ({ owner: 'o', repo: 'r', branch: 'main', token: 't' }), toast: () => { }, delay: 0 });
  await bad.load(); bad.set('z', 1); await bad.flush();
  assert.equal(bad.pending(), 1); assert.match(bad.status(), /boom/);
  // a public repo is refused outright
  const pub = R.create({ api: gh.api, config: () => ({ owner: 'o', repo: 'pub', branch: 'main', token: 't' }), toast: () => { }, delay: 0 });
  await pub.load(); assert.equal(pub.ready(), false); assert.match(pub.status(), /public repo/); assert.equal(pub.set('x', 1), false);
  // switching repo drops everything read from the old one, including queued edits
  let cur = { owner: 'o', repo: 'r', branch: 'main', token: 't' };
  const sw = R.create({ api: gh.api, config: () => cur, toast: () => { }, delay: 100000 });
  await sw.load(); sw.set('pending-key', 1); assert.equal(sw.pending(), 1);
  cur = { owner: 'o', repo: 'other', branch: 'main', token: 't' };
  assert.equal(sw.set('x', 1), false, 'not loaded for the new repo'); assert.equal(sw.pending(), 0); assert.equal(sw.get('pending-key', 'none'), 'none');
  console.log('repo store tests passed');
})().catch(e => { console.error(e); process.exit(1); });
