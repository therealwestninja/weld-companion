const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const B = require('../src/github-backup');

(async () => {
  for (const p of ['../x', 'a/../x', 'a//x', 'C:/x', 'a\\x', '.git/config', '/x', 'src/.env', 'src/private.pem']) assert.equal(B.safePath(p), false);
  assert.equal(B.safePath('dad/src/sub/module.js'), true);
  const model = Buffer.alloc(B.PART + 11); for (let i = 0; i < model.length; i++) model[i] = i % 251;
  let listing = { 'main.js': { size: 4, rev: 1 } };
  const opts = { name: 'dad', dslPath: 'dad/dad-top-panel.txt', htmlPath: 'dad/dad-html-panel.html', dsl: 'x', html: 'src/main.js',
    state: { ready: async () => {}, list: () => listing, readFile: async () => Uint8Array.of(0, 255, 13, 10).buffer }, crypto: webcrypto,
    evaluate: async (op, a) => op === 'inventory' ? { origin: 'https://x.perchance.org', entries: [{ kind: 'opfs', path: 'browser-model/model.gguf', size: model.length, modified: 1 }], unavailable: [] }
      : model.subarray(a.offset, a.offset + a.length).toString('base64') };
  const result = await B.collect(opts);
  const sourceOnly = await B.collect({ ...opts, includeCache: false, evaluate: async () => { throw new Error('GitHub must not inspect browser storage'); } });
  assert.equal(sourceOnly.manifest.includeCache, false);
  assert.ok(sourceOnly.manifest.files.every(f => f.kind === 'project'));
  assert.ok(!sourceOnly.files.some(f => /\/assets\//.test(f.path)), 'GitHub source-only backups contain no cached assets');
  for (const f of sourceOnly.files) if (f.read) await f.read();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weld-backup-test-')), root = path.join(tmp, 'dad');
  for (const file of result.files) {
    const content = file.read ? await file.read() : file.content;
    const dest = path.join(tmp, file.path); fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, file.encoding === 'base64' ? Buffer.from(content, 'base64') : content);
  }
  const rec = result.manifest.files.find(f => f.kind === 'opfs');
  assert.equal(rec.parts.length, 2); assert.ok(rec.parts.every(p => /^[a-f0-9]{64}$/.test(p.sha256)));
  const out = path.join(tmp, 'restored');
  const restored = spawnSync('python', [path.join(root, '.weld-backup/restore.py'), '--output', out], { encoding: 'utf8' });
  assert.equal(restored.status, 0, restored.stderr);
  assert.deepEqual(fs.readFileSync(path.join(out, '.weld-backup/assets/0/model.gguf')), model);
  assert.deepEqual(fs.readFileSync(path.join(out, 'src/main.js')), Buffer.from([0, 255, 13, 10]));
  const again = spawnSync('python', [path.join(root, '.weld-backup/restore.py'), '--output', out], { encoding: 'utf8' });
  assert.notEqual(again.status, 0, 'restore never overwrites existing files');
  fs.writeFileSync(path.join(tmp, rec.parts[0].path), 'broken');
  const broken = spawnSync('python', [path.join(root, '.weld-backup/restore.py'), '--output', path.join(tmp, 'bad')], { encoding: 'utf8' });
  assert.notEqual(broken.status, 0); assert.match(broken.stderr, /integrity/);
  listing = { 'main.js': { size: 4, rev: 2 } };
  assert.throws(result.validate, /changed/);
  await assert.rejects(result.files.find(f => f.path.endsWith('src/main.js')).read(), /changed/);
  await assert.rejects(B.collect({ ...opts, state: null }), /unavailable/);
  await assert.rejects(B.collect({ ...opts, state: { ready: async () => {}, list: () => ({}) } }), /manifest empty/);
  await assert.rejects(B.collect({ ...opts, evaluate: async () => { throw new Error('unreadable'); } }), /unreadable/);

  const url = 'https://huggingface.co/example/model/resolve/main/model.onnx';
  const cache = new Map([[url, new Response(Buffer.from([0, 255, 1]))], ['https://example.com/api/session.json', new Response('private')]]);
  const env = { URL, Uint8Array, Number, btoa, location: { origin: 'https://x.perchance.org' },
    navigator: { storage: { getDirectory: async () => ({ getDirectoryHandle: async () => { const e = new Error(); e.name = 'NotFoundError'; throw e; } }) } },
    caches: { keys: async () => ['models'], open: async () => ({ keys: async () => [...cache.keys()].map(url => new Request(url)), match: async r => cache.get(typeof r === 'string' ? r : r.url).clone() }) } };
  vm.createContext(env); vm.runInContext('var run = ' + B.runtime.toString(), env);
  const inventory = await env.run('inventory'); assert.equal(inventory.entries.length, 1, 'private/unrelated cache is excluded');
  assert.equal(await env.run('read', { ...inventory.entries[0], offset: 0, length: 3 }), 'AP8B');
  await assert.rejects(env.run('read', { ...inventory.entries[0], size: 4, offset: 0, length: 3 }), /changed/);
  await assert.rejects(env.run('read', { kind: 'cache', url: 'https://example.com/api/session.json' }), /Unsafe/);
  // Failed lazy reads or changed source must never advance the branch.
  const shipped = fs.readFileSync(path.join(__dirname, '../weld-companion.user.js'), 'utf8');
  const collected = [];
  const collectorContext = { Promise, setTimeout, clearTimeout, toast() {}, pageProp() {}, ghBackupEval() {},
    window: { crypto: webcrypto, WeldGitHubBackup: { collect: async options => { collected.push(options); return {}; } } } };
  vm.createContext(collectorContext);
  vm.runInContext(shipped.slice(shipped.indexOf('function ghCollectBackup('), shipped.indexOf('function ghBackupNote(')), collectorContext);
  await collectorContext.ghCollectBackup('dad', opts.dslPath, opts.htmlPath, opts.dsl, opts.html);
  assert.equal(collected[0].includeCache, false, 'shared collector disables cache capture unless requested');
  const localAdapter = shipped.match(/backup:\s*\{\s*collect:\s*(function[^\n]+),\s*\n\s*crypto:/)[1];
  vm.runInContext('var localCollect = ' + localAdapter, collectorContext);
  await collectorContext.localCollect('dad', { dsl: opts.dslPath, html: opts.htmlPath }, { dsl: opts.dsl, html: opts.html }, true);
  assert.equal(collected[1].includeCache, true, 'local download continues to capture requested assets');
  // Push / Push as pull request commit the panels plus the generator's src files (when it has a src store).
  const tick = () => new Promise(r => setTimeout(r, 5));
  async function pushFlow(mock) {
    const pushes = [], confirms = [], opts = [], toasts = [];
    const ctx = { console, Promise, genName: () => 'dad', ghToken: () => 'test-token',
      dslView: () => ({ state: { doc: { toString: () => 'output' } } }), htmlView: () => ({ state: { doc: { toString: () => '<p>hi</p>' } } }),
      ghResolve: () => ({ cfg: { owner: 'o', repo: 'r', branch: 'main', dslPath: '{name}/{name}-top-panel.txt', htmlPath: '{name}/{name}-html-panel.html' } }),
      window: {}, Date, confirm: m => { confirms.push(m); return true; }, toast: m => toasts.push(m), lintHtmlScripts: () => [], ghGateNote: () => '',
      ghPushStatus: () => ({ step() {}, end() {} }), pageProp: () => mock.srcState, ghCollectBackup: mock.collect || (() => { throw new Error('must not collect'); }),
      ghPushFilesAtomic: (owner, repo, branch, files, token, msg, cb, o) => { pushes.push(files); opts.push(o); } };
    vm.createContext(ctx);
    vm.runInContext(shipped.slice(shipped.indexOf('function ghPushPayload('), shipped.indexOf('function ghPushFilesAtomic(')) +
      shipped.slice(shipped.indexOf('function pushAsPullRequest('), shipped.indexOf('function ghConfigure(')), ctx);
    ctx.pushToGitHub(); ctx.pushAsPullRequest(); await tick();
    return { pushes, confirms, opts, toasts };
  }
  const panelsOnly = [{ path: 'dad/dad-top-panel.txt', content: 'output' }, { path: 'dad/dad-html-panel.html', content: '<p>hi</p>' }];
  const plain = await pushFlow({});
  assert.equal(plain.pushes.length, 2);
  for (const files of plain.pushes) assert.deepEqual(JSON.parse(JSON.stringify(files)), panelsOnly, 'a generator without src pushes exactly the two panels');
  const srcFiles = panelsOnly.concat([{ path: 'dad/src/a.js', encoding: 'base64', read: async () => 'AP8B' }, { path: 'dad/.weld-backup/manifest.json', read: () => '{}' }]);
  let validated = 0;
  const withSrc = await pushFlow({ srcState: {}, collect: async () => ({ files: srcFiles, bytes: 3, validate: () => { validated++; }, manifest: { files: [{ path: 'dad/src/a.js' }] } }) });
  assert.equal(withSrc.pushes.length, 2);
  for (const files of withSrc.pushes) assert.equal(files, srcFiles, 'Push and PR commit panels + src together (one atomic commit)');
  for (const m of withSrc.confirms) assert.ok(/1 src file/.test(m) && m.includes('dad/src/a.js') && /nothing is deleted/.test(m), 'confirmation lists the src files');
  withSrc.opts[0].validate(); assert.equal(validated, 1, 'validate guard is passed to the atomic push');
  assert.ok(!JSON.stringify(withSrc.confirms).includes('test-token'));
  const emptySrc = await pushFlow({ srcState: {}, collect: async () => ({ files: srcFiles, bytes: 0, manifest: { files: [] } }) });
  for (const files of emptySrc.pushes) assert.deepEqual(JSON.parse(JSON.stringify(files)), panelsOnly, 'empty src store: panels only');
  const failed = await pushFlow({ srcState: {}, collect: async () => { throw new Error('Secret-shaped project content detected'); } });
  for (const files of failed.pushes) assert.deepEqual(JSON.parse(JSON.stringify(files)), panelsOnly, 'unreadable src falls back to the panels');
  for (const m of failed.confirms) assert.ok(/src files NOT included: Secret-shaped/.test(m), 'fallback is announced in the confirmation');
  const uploader = shipped.slice(shipped.indexOf('function ghApiError('), shipped.indexOf('function ghGateNote('));
  async function push(file, validate, mock = {}) {
    const calls = [], progress = [];
    const stalled = () => Object.assign(new Error('GitHub request timed out.'), { stalled: true });
    const context = { console, Promise, setInterval, clearInterval, ghApi(method, url, token, body, cb) {
      calls.push({ method, url, body });
      if (mock.stallFirst && calls.length === 1) return cb(stalled(), 0, null);
      if (mock.stallAll) return cb(stalled(), 0, null);
      if (method === 'PATCH' && mock.patchTimeout) return cb(stalled(), 0, null);
      if (method === 'GET' && url.includes('/ref/')) {
        const recheck = calls.filter(c => c.method === 'GET' && c.url.includes('/ref/')).length > 1;
        return cb(null, 200, { object: { sha: recheck && mock.landed ? 'new' : 'parent' } });
      }
      if (method === 'POST' && url.endsWith('/trees')) return cb(null, 201, { sha: mock.sameTree ? 'tree' : 'tree2' });
      cb(null, method === 'POST' ? 201 : 200, { sha: 'new', tree: { sha: 'tree' } });
    } };
    vm.createContext(context); vm.runInContext(uploader, context);
    const [error, result, info] = await new Promise(resolve => context.ghPushFilesAtomic('o', 'r', 'main', [file], 'test-token', 'test',
      (e, r, i) => resolve([e, r, i]), { validate, onProgress: t => progress.push(t) }));
    return { error, result, info, calls, progress };
  }
  const binaryPush = await push({ path: 'dad/src/x.bin', encoding: 'base64', read: async () => 'AP8B' });
  assert.equal(binaryPush.error, null);
  assert.equal(binaryPush.calls.find(c => c.url.endsWith('/blobs')).body.encoding, 'base64');
  assert.equal(binaryPush.calls.filter(c => c.method === 'PATCH').length, 1);
  const failedPush = await push({ path: 'dad/src/x.bin', read: async () => { throw new Error('unreadable'); } });
  assert.ok(failedPush.error); assert.equal(failedPush.calls.filter(c => c.method === 'PATCH').length, 0);
  const changedPush = await push({ path: 'dad/x', content: 'x' }, () => { throw new Error('changed'); });
  assert.match(changedPush.error.message, /changed/); assert.equal(changedPush.calls.filter(c => c.method === 'PATCH').length, 0);
  // Success reports the commit, and progress lines are emitted for the on-screen status.
  assert.equal(binaryPush.result, 'updated'); assert.equal(binaryPush.info.sha, 'new');
  assert.equal(binaryPush.info.url, 'https://github.com/o/r/commit/new');
  assert.ok(binaryPush.progress.some(t => /Uploading dad\/src\/x\.bin/.test(t)) && binaryPush.progress.some(t => /Moving main/.test(t)));
  // Files identical to the branch head: no empty commit, no ref move, reported as 'unchanged'.
  const samePush = await push({ path: 'dad/x', content: 'x' }, null, { sameTree: true });
  assert.equal(samePush.error, null); assert.equal(samePush.result, 'unchanged');
  assert.equal(samePush.calls.filter(c => c.url.endsWith('/commits') && c.method === 'POST').length, 0);
  assert.equal(samePush.calls.filter(c => c.method === 'PATCH').length, 0);
  // Final step times out but GitHub did move the branch: report success, not failure.
  const landed = await push({ path: 'dad/x', content: 'x' }, null, { patchTimeout: true, landed: true });
  assert.equal(landed.error, null); assert.equal(landed.result, 'updated');
  // Final step times out and the branch did not move: still a failure.
  const lost = await push({ path: 'dad/x', content: 'x' }, null, { patchTimeout: true });
  assert.ok(lost.error); assert.match(lost.error.message, /PATCH branch/);
  // Files already on the branch with the same git hash are not re-uploaded; all unchanged -> no tree, no commit.
  {
    const gitSha = s => require('crypto').createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + Buffer.byteLength(s) + '\0'), Buffer.from(s)])).digest('hex');
    assert.equal(gitSha('hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a', 'git blob hash formula');
    async function hashedPush(files, onGitHub) {
      const calls = [];
      const context = { console, Promise, setInterval, clearInterval, crypto: webcrypto, TextEncoder, atob, ghApi(method, url, token, body, cb) {
        calls.push({ method, url, body });
        if (method === 'GET' && url.includes('/ref/')) return cb(null, 200, { object: { sha: 'parent' } });
        if (method === 'GET' && url.includes('/commits/')) return cb(null, 200, { tree: { sha: 'tree' } });
        if (method === 'GET' && url.includes('/trees/parent:dad')) return cb(null, 200, { tree: Object.entries(onGitHub).map(([p, c]) => ({ path: p, type: 'blob', sha: gitSha(c) })) });
        if (method === 'POST' && url.endsWith('/trees')) return cb(null, 201, { sha: 'tree2' });
        cb(null, method === 'POST' ? 201 : 200, { sha: 'new' });
      } };
      vm.createContext(context); vm.runInContext(uploader, context);
      const [error, result] = await new Promise(r => context.ghPushFilesAtomic('o', 'r', 'main', files, 't', 'm', (e, res) => r([e, res]), { transport: 'rest' }));
      return { error, result, calls, blobs: calls.filter(c => c.url.endsWith('/blobs')).map(c => c.body.content) };
    }
    const pair = [{ path: 'dad/a.txt', content: 'top ü' }, { path: 'dad/b.html', content: '<p>big</p>' }];
    const same = await hashedPush(pair, { 'a.txt': 'top ü', 'b.html': '<p>big</p>' });
    assert.equal(same.error, null); assert.equal(same.result, 'unchanged');
    assert.equal(same.blobs.length, 0); assert.equal(same.calls.filter(c => c.method === 'POST' || c.method === 'PATCH').length, 0);
    const oneChanged = await hashedPush(pair, { 'a.txt': 'top ü', 'b.html': '<p>old</p>' });
    assert.equal(oneChanged.result, 'updated'); assert.deepEqual(oneChanged.blobs, ['<p>big</p>']);
    const tree = oneChanged.calls.find(c => c.method === 'POST' && c.url.endsWith('/trees')).body.tree;
    assert.equal(tree.length, 2); assert.equal(tree[0].sha, gitSha('top ü'));
    // Lazy base64 src files: unchanged (same git hash of the bytes) are skipped, changed ones uploaded.
    const withBin = pair.concat([{ path: 'dad/src/x.bin', encoding: 'base64', read: async () => 'AP8B' }]);
    const binSame = await hashedPush(withBin, { 'a.txt': 'top ü', 'b.html': '<p>big</p>', 'x.bin': Buffer.from([0, 255, 1]) });
    assert.equal(binSame.result, 'unchanged'); assert.equal(binSame.blobs.length, 0);
    const binOld = await hashedPush(withBin, { 'a.txt': 'top ü', 'b.html': '<p>big</p>', 'x.bin': Buffer.from([9]) });
    assert.equal(binOld.result, 'updated'); assert.deepEqual(binOld.blobs, ['AP8B']);
    assert.ok(binOld.calls.some(c => c.method === 'GET' && c.url.includes('trees/parent:dad/src')), 'src folders are listed to compare hashes');
    assert.ok(binOld.calls.every(c => c.method !== 'DELETE') && binOld.calls.find(c => c.url.endsWith('/trees') && c.method === 'POST').body.tree.every(t => t.sha), 'nothing is deleted');
    const fresh = await hashedPush(pair, {});
    assert.equal(fresh.result, 'updated'); assert.equal(fresh.blobs.length, 2);
  }
  // GraphQL fast path: one read (head + blob hashes), one commit; unchanged = one request; failures before the commit fall back to REST.
  {
    const gitSha = s => require('crypto').createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + Buffer.byteLength(s) + '\0'), Buffer.from(s)])).digest('hex');
    async function gqlPush(files, onGitHub, mock = {}) {
      const calls = []; let reads = 0;
      const context = { console, Promise, setInterval, clearInterval, crypto: webcrypto, TextEncoder, btoa, ghApi(method, url, token, body, cb) {
        calls.push({ method, url, body });
        if (url === '/graphql' && /^query/.test(body.query)) {
          reads++;
          if (mock.noBranch) return cb(null, 200, { data: { repository: { ref: null } } });
          const landed = reads > 1 && mock.landed, repo = { ref: { target: { oid: landed ? 'head2' : 'head1', url: 'https://github.com/o/r/commit/x' } } };
          files.forEach((f, n) => { const c = landed ? f.content : onGitHub[f.path]; repo['f' + n] = c == null ? null : { oid: gitSha(c) }; });
          return cb(null, 200, { data: { repository: repo } });
        }
        if (url === '/graphql') {
          if (mock.stallCommit) return cb(Object.assign(new Error('GitHub request timed out.'), { stalled: true }), 0, null);
          if (mock.refuse) return cb(null, 200, { errors: [{ message: 'Expected branch to point to head1' }] });
          return cb(null, 200, { data: { createCommitOnBranch: { commit: { oid: 'c0ffee', url: 'https://github.com/o/r/commit/c0ffee' } } } });
        }
        if (method === 'GET' && url.includes('/ref/')) return cb(null, 200, { object: { sha: 'parent' } });
        if (method === 'GET' && url.includes('/commits/')) return cb(null, 200, { tree: { sha: 'tree' } });
        if (method === 'POST' && url.endsWith('/trees')) return cb(null, 201, { sha: 'tree2' });
        cb(null, method === 'POST' ? 201 : 200, { sha: 'new' });
      } };
      vm.createContext(context); vm.runInContext(uploader, context);
      const [error, result, info] = await new Promise(r => context.ghPushFilesAtomic('o', 'r', 'main', files, 't', 'm', (e, res, i) => r([e, res, i])));
      return { error, result, info, calls, gql: calls.filter(c => c.url === '/graphql'), rest: calls.filter(c => c.url.includes('/git/')) };
    }
    const pair = [{ path: 'dad/a.txt', content: 'top ü' }, { path: 'dad/b.html', content: '<p>big</p>' }];
    const same = await gqlPush(pair, { 'dad/a.txt': 'top ü', 'dad/b.html': '<p>big</p>' });
    assert.equal(same.result, 'unchanged'); assert.equal(same.calls.length, 1, 'unchanged push is a single request');
    assert.equal(same.gql[0].body.variables.f1, 'main:dad/b.html');
    const one = await gqlPush(pair, { 'dad/a.txt': 'top ü', 'dad/b.html': '<p>old</p>' });
    assert.equal(one.error, null); assert.equal(one.result, 'updated'); assert.equal(one.info.sha, 'c0ffee'); assert.equal(one.calls.length, 2);
    const input = one.gql[1].body.variables.input;
    assert.equal(input.expectedHeadOid, 'head1'); assert.equal(input.branch.branchName, 'main');
    assert.deepEqual(input.fileChanges.additions.map(a => [a.path, Buffer.from(a.contents, 'base64').toString('utf8')]), [['dad/b.html', '<p>big</p>']]);
    const utf = await gqlPush([{ path: 'dad/a.txt', content: 'top ü ✓' }], {});
    assert.equal(Buffer.from(utf.gql[1].body.variables.input.fileChanges.additions[0].contents, 'base64').toString('utf8'), 'top ü ✓');
    const noBranch = await gqlPush(pair, {}, { noBranch: true });
    assert.ok(noBranch.rest.length > 0, 'missing branch falls back to REST for its diagnostics');
    const refused = await gqlPush(pair, {}, { refuse: true });
    assert.equal(refused.result, 'updated'); assert.equal(refused.gql.length, 2); assert.ok(refused.rest.some(c => c.method === 'PATCH'), 'refused commit retried via REST');
    const landedLate = await gqlPush(pair, {}, { stallCommit: true, landed: true });
    assert.equal(landedLate.error, null); assert.equal(landedLate.result, 'updated'); assert.equal(landedLate.rest.length, 0);
    const lostCommit = await gqlPush(pair, {}, { stallCommit: true });
    assert.match(lostCommit.error.message, /branch was not changed/); assert.equal(lostCommit.rest.length, 0, 'a commit that may have landed is never resent');
  }
  // Src push batching: changed files go through createCommitOnBranch in size-bounded batches, panels in the last commit.
  {
    const gitSha = s => require('crypto').createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + Buffer.byteLength(s) + '\0'), Buffer.from(s)])).digest('hex');
    async function batchPush(files, onGitHub, mock = {}, o = {}) {
      const calls = [], progress = [];
      let headNow = 'head0', prevHead = 'p', okCount = 0;
      const context = { console, Promise, setTimeout, setInterval, clearInterval, crypto: webcrypto, TextEncoder, atob, btoa, Uint8Array, ghApi(method, url, token, body, cb) {
        calls.push({ method, url, body });
        if (url === '/graphql' && /^query/.test(body.query)) return cb(null, 200, { data: { repository: { ref: { target: { oid: headNow, url: 'u', parents: { nodes: [{ oid: prevHead }] } } } } } });
        if (url === '/graphql') {
          const attempt = calls.filter(c => c.url === '/graphql' && /^mutation/.test(c.body.query)).length, act = mock.script && mock.script[attempt - 1];
          if (mock.refuse) return cb(null, 200, { errors: [{ message: 'nope' }] });
          if (typeof act === 'number') return cb(null, act, {});
          if (act === 'stall') return cb(Object.assign(new Error('GitHub request timed out.'), { stalled: true }), 0, null);
          if (act === 'landed') { prevHead = headNow; headNow = 'cL'; return cb(null, 499, {}); }
          if (typeof act === 'function' && act(body.variables.input)) return cb(null, 499, {});
          const n = ++okCount; prevHead = headNow; headNow = 'c' + n;
          return cb(null, 200, { data: { createCommitOnBranch: { commit: { oid: 'c' + n, url: 'https://github.com/o/r/commit/c' + n } } } });
        }
        if (method === 'GET' && url.includes('?recursive=1')) return cb(null, 200, { tree: Object.entries(onGitHub).map(([p, c]) => ({ path: p, type: 'blob', sha: gitSha(c) })) });
        if (method === 'GET' && url.includes('/ref/')) return cb(null, 200, { object: { sha: 'head0' } });
        if (method === 'GET' && url.includes('/commits/')) return cb(null, 200, { tree: { sha: 'tree' } });
        if (method === 'POST' && url.endsWith('/trees')) return cb(null, 201, { sha: 'tree2' });
        cb(null, method === 'POST' ? 201 : 200, { sha: 'new' });
      } };
      vm.createContext(context); vm.runInContext(uploader, context);
      const [error, result, info] = await new Promise(r => context.ghPushFilesAtomic('o', 'r', 'main', files, 't', 'msg', (e, res, i) => r([e, res, i]), { last: ['dad/p.txt', 'dad/h.html'], retryDelayMs: 0, onProgress: t => progress.push(t), ...o }));
      const commits = calls.filter(c => c.url === '/graphql' && /^mutation/.test(c.body.query)).map(c => c.body.variables.input);
      return { error, result, info, calls, commits, progress, requests: calls.length };
    }
    const big = () => 'A'.repeat(1200000);
    const mk = () => [{ path: 'dad/p.txt', content: 'panel' }, { path: 'dad/h.html', content: '<p>h</p>' },
      { path: 'dad/src/same.bin', encoding: 'base64', read: async () => 'AP8B' }, { path: 'dad/src/new.bin', encoding: 'base64', read: async () => 'AQID' },
      { path: 'dad/src/big1.bin', encoding: 'base64', read: async () => big() }, { path: 'dad/src/big2.bin', encoding: 'base64', read: async () => big() }];
    const gh = { 'src/same.bin': Buffer.from([0, 255, 1]) };
    const two = await batchPush(mk(), gh);
    assert.equal(two.error, null); assert.equal(two.result, 'updated'); assert.equal(two.commits.length, 2, 'size-bounded batches');
    const names = two.commits.map(c => c.fileChanges.additions.map(a => a.path));
    assert.ok(!names.flat().includes('dad/src/same.bin'), 'unchanged src file skipped by blob sha');
    assert.deepEqual(JSON.parse(JSON.stringify(names[1].slice(-2))), ['dad/p.txt', 'dad/h.html'], 'panels are in the last commit ' + JSON.stringify(names));
    assert.equal(two.commits[0].expectedHeadOid, 'head0'); assert.equal(two.commits[1].expectedHeadOid, 'c1', 'commits chain on each other');
    assert.match(two.commits[0].message.headline, /part 1 of 2/); assert.equal(two.info.sha, 'c2');
    assert.ok(two.calls.every(c => c.method !== 'DELETE' && !/_weld-data/.test(JSON.stringify(c.body || {}))), 'no deletions, no _weld-data');
    assert.ok(two.calls.filter(c => c.url.includes('/blobs')).length === 0, 'no per-file blob requests');
    assert.ok(two.requests <= 7, 'few requests: ' + two.requests);
    assert.ok(two.progress.some(t => /Committing batch 1 of 2/.test(t)));
    const small = await batchPush([mk()[0], mk()[1], mk()[2], mk()[3]], gh);
    assert.equal(small.commits.length, 1); assert.equal(small.commits[0].message.headline, 'msg');
    assert.equal(small.requests, 3, 'head + tree listing + one commit, regardless of file count');
    const allSame = await batchPush([{ path: 'dad/p.txt', content: 'panel' }, { path: 'dad/src/same.bin', encoding: 'base64', read: async () => 'AP8B' }], { 'p.txt': 'panel', 'src/same.bin': Buffer.from([0, 255, 1]) });
    assert.equal(allSame.result, 'unchanged'); assert.equal(allSame.commits.length, 0);
    const pr = await batchPush(mk().slice(0, 4), gh, {}, { newBranch: 'weld/dad-x' });
    assert.equal(pr.result, 'created'); assert.equal(pr.commits[0].branch.branchName, 'weld/dad-x');
    assert.ok(pr.calls.some(c => c.method === 'POST' && c.url.endsWith('/refs') && c.body.sha === 'head0'));
    const refused = await batchPush(mk().slice(0, 4), gh, { refuse: true });
    assert.ok(refused.calls.some(c => c.method === 'PATCH') || refused.error, 'refused first commit falls back to REST');
    // Retries: 499/5xx/timeouts retry the same batch, then split it; a commit that landed anyway is not repeated.
    const flaky = await batchPush(mk(), gh, { script: [499, 499] });
    assert.equal(flaky.error, null); assert.equal(flaky.result, 'updated'); assert.equal(flaky.commits.length, 4, 'two failed attempts + the rest');
    assert.ok(flaky.progress.some(t => t.includes('Retrying the same batch (1 of 2)')));
    const stalled = await batchPush(mk(), gh, { script: ['stall', 503] });
    assert.equal(stalled.error, null); assert.equal(stalled.result, 'updated');
    const landedAnyway = await batchPush(mk(), gh, { script: ['landed'] });
    assert.equal(landedAnyway.error, null); assert.equal(landedAnyway.commits.length, 2, 'the commit that landed despite the 499 is not sent again');
    assert.equal(landedAnyway.commits[1].expectedHeadOid, 'cL', 'the next batch builds on the landed commit');
    const splitFiles = [{ path: 'dad/p.txt', content: 'panel' }, { path: 'dad/h.html', content: '<p>h</p>' }]
      .concat([1, 2, 3, 4].map(i => ({ path: 'dad/src/s' + i + '.bin', encoding: 'base64', read: async () => ['AQID', 'AQIE', 'AQIF', 'AQIG'][i - 1] })));
    const failBigBatch = input => input.fileChanges.additions.length > 3;
    const halved = await batchPush(splitFiles, {}, { script: [failBigBatch, failBigBatch, failBigBatch].map(f => f) });
    assert.equal(halved.error, null, 'a persistently failing batch is split in halves');
    assert.ok(halved.progress.some(t => /Splitting the batch/.test(t)));
    const lastFiles = halved.commits[halved.commits.length - 1].fileChanges.additions.map(a => a.path);
    assert.deepEqual(JSON.parse(JSON.stringify(lastFiles.slice(-2))), ['dad/p.txt', 'dad/h.html'], 'panels still go in the last commit after splitting');
    const dead = await batchPush(mk().slice(0, 3), gh, { script: [499, 499, 499, 499, 499, 499, 499, 499, 499, 499] });
    assert.ok(dead.error && /Press Push again to resume/.test(dead.error.message), 'failure tells you to press Push again');
    const midFail = await batchPush(mk(), gh, { script: [null, 499, 499, 499, 499, 499, 499, 499, 499, 499, 499, 499] });
    assert.ok(/^Commit of .* failed after retries/.test(midFail.error.message) && midFail.error.message.includes(' commit(s) are already on main'), midFail.error.message);
    // Resume after that partial failure: what landed is on GitHub now, so only the rest is sent and the panels still end it.
    const resumed = await batchPush(mk(), Object.assign({}, gh, { 'src/new.bin': Buffer.from([1, 2, 3]), 'src/big1.bin': Buffer.alloc(900000) }));
    assert.equal(resumed.error, null);
    const resumedPaths = resumed.commits.flatMap(c => c.fileChanges.additions.map(a => a.path));
    assert.ok(!resumedPaths.includes('dad/src/new.bin') && !resumedPaths.includes('dad/src/same.bin'), 'already-pushed files are not sent again');
    assert.deepEqual(JSON.parse(JSON.stringify(resumed.commits[resumed.commits.length - 1].fileChanges.additions.slice(-2).map(a => a.path))), ['dad/p.txt', 'dad/h.html']);
    // Batches stay small: many small files are capped per commit.
    const many = [{ path: 'dad/p.txt', content: 'panel' }, { path: 'dad/h.html', content: 'h' }].concat(Array.from({ length: 320 }, (_, i) => ({ path: 'dad/src/f' + i, encoding: 'base64', read: async () => 'AQID' })));
    const capped = await batchPush(many, {});
    assert.equal(capped.commits.length, 3); assert.ok(capped.commits.every(c => c.fileChanges.additions.length <= 150));
    let guard = 0;
    const guarded = await batchPush(mk().slice(0, 4), gh, {}, { validate: () => { guard++; throw new Error('changed'); } });
    assert.match(guarded.error.message, /changed/); assert.equal(guarded.commits.length, 0); assert.equal(guard, 1);
    const unreadable = await batchPush([mk()[0], { path: 'dad/src/x', read: async () => { throw new Error('Secret-shaped'); } }], {});
    assert.match(unreadable.error.message, /branch not updated/); assert.equal(unreadable.commits.length, 0);
  }
  // A read that gets no reply at all is sent once more, then the push carries on.
  const retried = await push({ path: 'dad/x', content: 'x' }, null, { stallFirst: true });
  assert.equal(retried.error, null); assert.equal(retried.result, 'updated');
  assert.equal(retried.calls.filter(c => c.method === 'GET' && c.url.includes('/ref/')).length, 2);
  // Never any reply: two tries, then a plain failure that says nothing changed; no ref move.
  const dead = await push({ path: 'dad/x', content: 'x' }, null, { stallAll: true });
  assert.ok(dead.error); assert.match(dead.error.message, /Nothing was changed on GitHub/);
  assert.equal(dead.calls.length, 2); assert.equal(dead.calls.filter(c => c.method === 'PATCH').length, 0);
  console.log('GitHub backup binary, chunk restore, integrity, mutation and cache privacy tests passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
