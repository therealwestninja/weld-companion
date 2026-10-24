const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('weld-companion.user.js', 'utf8');

function between(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.notEqual(from, -1, `missing ${start}`);
  assert.notEqual(to, -1, `missing ${end}`);
  return source.slice(from, to);
}

function load(names, code, extras) {
  const context = { URL, Number, isFinite, Array, console, setInterval() { return 0; }, clearInterval() {}, ...extras };
  vm.createContext(context);
  vm.runInContext(code, context);
  return Object.fromEntries(names.map((name) => [name, context[name]]));
}

const fetchGuard = load(
  ['sbPrivateIpv4', 'sbIpv6Parts', 'sbPrivateIpv6', 'sbFetchGuard'],
  between('function sbPrivateIpv4(', 'function sbServiceFetch('),
);

for (const url of [
  'http://127.0.0.1:1234/v1/models',
  'http://10.0.0.1/',
  'http://[::1]/',
  'http://[fe81::1]/',
  'http://[fc00::1]/',
  'http://[::ffff:127.0.0.1]:1234/v1/models',
]) {
  assert.equal(fetchGuard.sbFetchGuard(url).ok, false, `must block ${url}`);
}
assert.equal(fetchGuard.sbFetchGuard('https://example.com/resource').ok, true);

// With "Perchance built-in" selected the bridge cannot run a model: replies keep the legacy reason strings and add a code and a hint.
{
  const toasts = [];
  const cfg = { provider: 'builtin' };
  const env = { aiConfig: () => cfg, toast: (m) => toasts.push(String(m)), Date, PROVIDERS: {}, lookupModelLimits: () => ({}), Promise };
  const code = between('var sbNoModelToastAt', 'function sbServiceAI(') + between('function sbServiceModel(', 'function sbOriginOk(');
  const m = load(['sbNoModel', 'sbServiceModel'], code, env);
  const r = m.sbNoModel('no-own-model');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-own-model'); // legacy string stays: generators match on it
  assert.equal(r.code, 'no-own-model');
  assert.match(r.hint, /Perchance built-in/);
  assert.match(r.hint, /Model connection and AI settings/);
  assert.equal(toasts.length, 1, 'first request shows one toast');
  m.sbNoModel('no-own-model');
  assert.equal(toasts.length, 1, 'toast is throttled');
  m.sbServiceModel().then((x) => {
    assert.equal(x.ok, false);
    assert.equal(x.reason, 'no own model configured');
    assert.ok(x.hint && x.code === 'no-own-model');
  }).catch((e) => { console.error(e); process.exit(1); });
}
// A streamed reply with no answer text (reasoning model out of budget) must fail with a reason, never succeed with ''.
{
  const sse = (...objs) => objs.map((o) => 'data: ' + JSON.stringify(o) + '\n\n').join('') + 'data: [DONE]\n\n';
  const run = (text) => new Promise((resolve) => {
    const env = {
      PROVIDERS: { localai: { noKey: true, defaultEndpoint: 'http://localhost:1234', defaultModel: 'm', headers: () => ({}), body: () => '{"stream":false}' } },
      sbApplyMaxTokens() {}, sbApplyTemperature() {}, aiUserForProvider: (p, u) => u, aiErr: (s) => 'http ' + s, JSON, String, Array, Object,
      aiCooldownMsg: () => "", aiNoteRateLimit() {},
      GM_xmlhttpRequest: (o) => { setTimeout(() => { o.onprogress({ status: 200, responseText: text }); o.onload({ status: 200, responseText: text }); }, 0); },
    };
    const f = load(['callOwnAIStream'], between('var STREAM = {', 'var AI_WORKSPACE'), env);
    const chunks = [];
    f.callOwnAIStream({ provider: 'localai', keys: {}, models: {}, endpoints: {} }, 's', 'u', false, 0, null, (c) => chunks.push(c), (err, val) => resolve({ err, val, chunks }));
  });
  const delta = (d, finish) => ({ choices: [{ index: 0, delta: d, finish_reason: finish || null }] });
  Promise.all([
    run(sse(delta({ reasoning_content: 'thinking' }), delta({}, 'length'))),
    run(sse(delta({ reasoning_content: 'thinking' }), delta({ content: 'ok' }), delta({}, 'stop'))),
    run(sse(delta({}, 'stop'))),
  ]).then(([budget, good, empty]) => {
    assert.match(budget.err, /token budget for reasoning/);
    assert.equal(budget.val, null);
    assert.equal(good.err, null);
    assert.equal(good.val, 'ok');
    assert.deepEqual(Array.from(good.chunks), ['ok']);
    assert.match(empty.err, /no final text/);
    console.log('Skybridge streamed reasoning-model replies tests passed');
  }).catch((e) => { console.error(e); process.exit(1); });
}
// Automatic saving into Weld storage is off by default: a generator write is refused and nothing is stored; reads still work.
{
  const store = new Map();
  const gget = (k, d) => (store.has(k) ? store.get(k) : d), gset = (k, v) => { store.set(k, v); return true; };
  const off = load(['sbServiceStorage'], between('function sbStoreKey(', 'function sbServiceAI('), { NS: 'weldCompanion', autoSaveOn: () => false, gget, gset, GM_listValues: () => [], Promise, window: { WeldBackupCore: require('../src/backup-core.js') } });
  off.sbServiceStorage('gen-a', { op: 'set', key: 'slot', value: 1 }).then((r) => {
    assert.equal(r.ok, false);
    assert.equal(r.code, 'autosave-off');
    assert.equal(store.size, 0);
    return off.sbServiceStorage('gen-a', { op: 'set', key: 'weld:genvault:gen-a/snapshot', value: { v: 1, generator: 'gen-a' } });
  }).then((r) => {
    assert.deepEqual([r.ok, r.code], [false, 'no-backup-folder'], 'Weld keeps no vault copy: with no backup folder the save is refused');
    assert.equal(store.size, 0);
    return off.sbServiceStorage('gen-a', { op: 'set', key: 'weld:genvault:gen-b/snapshot', value: { v: 1, generator: 'gen-b' } });
  }).then((r) => {
    assert.equal(r.ok, false);   // another generator's vault key is still refused
    assert.equal(r.code, 'autosave-off');
    return off.sbServiceStorage('gen-a', { op: 'set', key: 'weld:genvault:gen-a/chat/snap-1720000000000-abc123', value: { v: 1, generator: 'gen-a' } });
  }).then((r) => {
    assert.deepEqual([r.ok, r.code], [false, 'vault-chats-off'], 'chat copies are refused while vault chat saving is off');
    return off.sbServiceStorage('gen-a', { op: 'set', key: 'weld:genvault:gen-a/chat/index', value: [] });
  }).then((r) => {
    assert.deepEqual([r.ok, r.code], [false, 'vault-chats-off'], 'the chat index is refused too');
    assert.equal(store.has('sbk:gen-a:weld:genvault:gen-a/chat/index'), false);
    store.set('vaultChats', true);
    return off.sbServiceStorage('gen-a', { op: 'set', key: 'weld:genvault:gen-a/chat/index', value: [] });
  }).then((r) => {
    assert.equal(r.code, 'no-backup-folder', 'turning chat saving on passes the gate; still no folder');
    console.log('Skybridge storage writes are refused while automatic saving is off (vault saves need a backup folder, chat copies only when enabled)');
  }).catch((e) => { console.error(e); process.exit(1); });
}
// Pass-through vault: with a backup folder ready, vault saves go to the folder and never into Weld storage; reads and
// lists come back from the folder, and an older copy still in storage is the fallback for keys the folder lacks.
{
  const store = new Map([['vaultChats', true], ['sbk:gen-a:weld:genvault:gen-a/chat/snap-1-old', { old: true }]]);
  const folder = new Map(), calls = [];
  const gget = (k, d) => (store.has(k) ? store.get(k) : d), gset = (k, v) => { store.set(k, v); return true; };
  const pt = {
    ready: () => true, noFolder: 'nf',
    set: async (gen, key, value) => { calls.push(['set', gen, key]); folder.set(key, value); return { ok: true, where: 'folder' }; },
    get: async (gen, key) => (folder.has(key) ? folder.get(key) : undefined),
    list: async (gen, prefix) => Array.from(folder.keys()).filter((k) => k.indexOf(prefix) === 0)
  };
  const GM_listValues = () => Array.from(store.keys()).map((k) => 'weldCompanion:' + k);
  const m = load(['sbServiceStorage'], between('function sbStoreKey(', 'function sbServiceAI('), { NS: 'weldCompanion', autoSaveOn: () => false, gget, gset, GM_listValues, Promise, String, window: { WeldBackupCore: require('../src/backup-core.js'), weldBackup: { vault: pt } } });
  const before = store.size, snap = { v: 1, at: 5, generator: 'gen-a', title: 'A' };
  m.sbServiceStorage('gen-a', { op: 'set', key: 'weld:genvault:gen-a/snapshot', value: snap }).then((r) => {
    assert.deepEqual([r.ok, r.where], [true, 'folder']);
    assert.equal(store.size, before, 'nothing written to Weld storage');
    return m.sbServiceStorage('gen-a', { op: 'set', key: 'weld:genvault:gen-a/snapshot', value: { v: 1, generator: 'gen-b' } });
  }).then((r) => {
    assert.equal(r.code, 'owner-mismatch'); assert.equal(calls.length, 1, 'a mismatched owner never reaches the folder');
    return m.sbServiceStorage('gen-a', { op: 'get', key: 'weld:genvault:gen-a/snapshot' });
  }).then((r) => {
    assert.deepEqual(r.value, snap);
    return m.sbServiceStorage('gen-a', { op: 'get', key: 'weld:genvault:gen-a/chat/snap-1-old' });
  }).then((r) => {
    assert.deepEqual(r.value, { old: true }, 'older stored copy still readable');
    return m.sbServiceStorage('gen-a', { op: 'list', prefix: 'weld:genvault:gen-a/' });
  }).then((r) => {
    assert.deepEqual(Array.from(r.value).sort(), ['weld:genvault:gen-a/chat/snap-1-old', 'weld:genvault:gen-a/snapshot']);
    return m.sbServiceStorage('gen-a', { op: 'list', prefix: 'slot' });
  }).then((r) => {
    assert.deepEqual(Array.from(r.value), [], 'a non-vault prefix does not touch the folder');
    console.log('Skybridge vault saves pass through to the backup folder');
  }).catch((e) => { console.error(e); process.exit(1); });
}
// Anchor storage: list must see keys that set wrote, using the real NS-prefixed names (it returned [] before 1.65.3).
{
  const store = new Map();
  const NS = 'weldCompanion';
  const GM_setValue = (k, v) => store.set(k, v), GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
  const gget = (k, d) => { const v = GM_getValue(NS + ':' + k, undefined); return v === undefined ? d : JSON.parse(v); };
  const gset = (k, v) => { GM_setValue(NS + ':' + k, JSON.stringify(v)); return true; };
  const GM_listValues = () => Array.from(store.keys());
  const anchorStorage = load(['sbServiceStorage'], between('function sbStoreKey(', 'function sbServiceAI('), { NS, autoSaveOn: () => true, gget, gset, GM_listValues, Promise, window: { WeldBackupCore: require('../src/backup-core.js') } });
  const call = (gen, payload) => anchorStorage.sbServiceStorage(gen, payload);
  call('gen-a', { op: 'set', key: 'slot1', value: { n: 1 } })
    .then(() => call('gen-a', { op: 'set', key: 'slot2', value: 2 }))
    .then(() => call('gen-b', { op: 'set', key: 'other', value: 3 }))
    .then(() => call('gen-a', { op: 'list' }))
    .then((r) => {
      assert.deepEqual(Array.from(r.value).sort(), ['slot1', 'slot2']);
      return call('gen-a', { op: 'list', prefix: 'slot2' });
    })
    .then((r) => {
      assert.deepEqual(Array.from(r.value), ['slot2']);
      return call('gen-a', { op: 'get', key: 'slot1' });
    })
    .then((r) => {
      assert.deepEqual(r.value, { n: 1 });
      return call('alpha', { op: 'set', key: 'weld:genvault:alpha/snapshot', value: { generator: 'beta' } });
    })
    .then((r) => {
      assert.deepEqual([r.ok, r.reason], [false, 'owner-mismatch'], 'a record naming another owner is refused');
      return call('alpha', { op: 'get', key: 'weld:genvault:alpha/snapshot' });
    })
    .then((r) => {
      assert.equal(r.value, null, 'nothing was stored by the refused write');
      return call('alpha', { op: 'set', key: 'weld:genvault:alpha/snapshot', value: { generator: 'alpha' } });
    })
    .then((r) => { assert.deepEqual([r.ok, r.code], [false, 'no-backup-folder'], 'vault saves never land in Weld storage'); assert.equal(store.has(NS + ':sbk:alpha:weld:genvault:alpha/snapshot'), false); return call('alpha', { op: 'set', key: '', value: 1 }); })
    .then((r) => { assert.deepEqual([r.ok, r.reason], [false, 'bad-key']); console.log('Skybridge anchor storage set/get/list tests passed'); })
    .catch((e) => { console.error(e); process.exit(1); });
}

const providerOptions = load(
  ['sbApplyMaxTokens', 'sbApplyTemperature'],
  between('function sbApplyMaxTokens(', 'function classifyAIError('),
);

const localAi = {};
providerOptions.sbApplyMaxTokens('localai', localAi, 77);
providerOptions.sbApplyTemperature('localai', localAi, 0.25);
assert.equal(JSON.stringify(localAi), JSON.stringify({ max_tokens: 77, temperature: 0.25 }));

const ollama = {};
providerOptions.sbApplyMaxTokens('ollama', ollama, 88);
providerOptions.sbApplyTemperature('ollama', ollama, 0);
assert.equal(JSON.stringify(ollama), JSON.stringify({ options: { num_predict: 88, temperature: 0 } }));

const google = {};
providerOptions.sbApplyMaxTokens('google', google, 99);
providerOptions.sbApplyTemperature('google', google, 0.5);
assert.equal(JSON.stringify(google), JSON.stringify({ generationConfig: { maxOutputTokens: 99, temperature: 0.5 } }));

assert.match(source, /redirect:\s*'error'/);
assert.match(source, /request\.abort\(\)/);
assert.match(source, /callOwnAIStream\(cfg, sys, user, !!payload\.json, maxTokens, temperature, emit, done\)/);

// AI agent panel selectors. Upstream covered these with helperSubmitButton()/helperPromptInput();
// this fork's equivalents are aiAgentButton()/aiAgentInput() (current aiAgent* ids first,
// legacy aiHelper* ids as the fallback).
const helperSelectors = load(
  ['aiAgentButton', 'aiAgentInput'],
  between('function aiAgentButton(', 'function aiAgentPrompt('),
  {
    $(selector) {
      return ({ '#aiHelperSubmitBtn': null, '#aiAgentSendBtn': 'new-send', '#aiHelperInputEl': null, '#aiAgentInputEl': 'new-input' })[selector] || null;
    },
  },
);
assert.equal(helperSelectors.aiAgentButton(), 'new-send');
assert.equal(helperSelectors.aiAgentInput(), 'new-input');

const legacyHelperSelectors = load(
  ['aiAgentButton', 'aiAgentInput'],
  between('function aiAgentButton(', 'function aiAgentPrompt('),
  {
    $(selector) {
      return ({ '#aiHelperSubmitBtn': 'legacy-send', '#aiHelperInputEl': 'legacy-input' })[selector] || null;
    },
  },
);
assert.equal(legacyHelperSelectors.aiAgentButton(), 'legacy-send');
assert.equal(legacyHelperSelectors.aiAgentInput(), 'legacy-input');

// AI agent panel: Enter in the prompt box calls Perchance's send() directly (no click),
// so the own-model route must also hook keydown -- capture phase, Enter only, and never
// with Shift/Ctrl/Alt/Meta held, while composing, or on the touch/mobile layout.
function fakeEl() {
  return { dataset: {}, listeners: [], addEventListener(type, fn, capture) { this.listeners.push({ type, fn, capture }); } };
}
const agentBtn = fakeEl(), agentInput = fakeEl();
let routed = 0, touch = false;
const hook = load(
  ['hookHelperSubmit'],
  between('function hookHelperSubmit(', '// ============================================================ bootstrap'),
  {
    aiAgentButton: () => agentBtn,
    aiAgentInput: () => agentInput,
    routeAgentToWorkspace: () => { routed++; return true; },
    aiAgentTouchMode: () => touch,
  },
);
hook.hookHelperSubmit();
hook.hookHelperSubmit(); // idempotent
assert.deepEqual(agentBtn.listeners.map((l) => [l.type, l.capture]), [['click', true]]);
assert.deepEqual(agentInput.listeners.map((l) => [l.type, l.capture]), [['keydown', true]]);
const onKey = agentInput.listeners[0].fn;
onKey({ key: 'Enter', shiftKey: true });
onKey({ key: 'Enter', ctrlKey: true });
onKey({ key: 'Enter', isComposing: true });
onKey({ key: 'a' });
assert.equal(routed, 0);
onKey({ key: 'Enter' });
assert.equal(routed, 1);
touch = true; onKey({ key: 'Enter' }); assert.equal(routed, 1);
agentBtn.listeners[0].fn({}); assert.equal(routed, 2);

// GitHub transport settles once, including when the manager never responds.
{
  function transport(throws) {
    const timers = new Map(), responses = [];
    let nextTimer = 0, options, aborted = 0;
    const api = load(['ghApi'], between('function ghApi(', 'function ghApiError('), {
      setTimeout(fn, ms) { timers.set(++nextTimer, { fn, ms }); return nextTimer; },
      clearTimeout(id) { timers.delete(id); },
      GM_xmlhttpRequest(o) {
        if (throws) throw new Error('private transport details');
        options = o;
        return { abort() { aborted++; o.onabort(); } };
      },
    });
    api.ghApi('GET', '/repos/owner/repo/git/ref/heads/main', 'private-token', null,
      (err, status, json) => responses.push({ err, status, json }));
    return { timers, responses, get options() { return options; }, get aborted() { return aborted; } };
  }
  for (const event of ['onerror', 'onabort', 'ontimeout']) {
    const t = transport();
    assert.equal(t.options.timeout, undefined, 'restored manager request options omit the native timeout; the watchdog still bounds requests');
    t.options[event]();
    assert.equal(t.responses.length, 1);
    assert.ok(t.responses[0].err);
    assert.equal(t.timers.size, 0);
    t.options.onload({ status: 200, responseText: '{"object":{"sha":"late"}}' });
    assert.equal(t.responses.length, 1, 'late success must not continue a failed push');
  }
  const hung = transport();
  const watchdog = [...hung.timers.values()][0];
  assert.equal(watchdog.ms, 90000);
  watchdog.fn();
  assert.match(hung.responses[0].err.message, /timed out/);
  assert.equal(hung.aborted, 1);
  assert.equal(hung.responses.length, 1, 'aborting after timeout must not report twice');
  assert.equal(hung.timers.size, 0);
  const ok = transport();
  ok.options.onload({ status: 200, responseText: '{"object":{"sha":"commit"}}' });
  assert.equal(ok.responses[0].err, null);
  assert.equal(ok.responses[0].json.object.sha, 'commit');
  assert.equal(ok.timers.size, 0);
  const failedStart = transport(true);
  assert.match(failedStart.responses[0].err.message, /could not start/);
  assert.doesNotMatch(failedStart.responses[0].err.message, /private/);
  assert.equal(failedStart.timers.size, 0);
}
// A stalled blob upload names its step and never reaches the branch update.
{
  const timers = new Map(), requests = [];
  let id = 0, hanging, outcome;
  const push = load(['ghPushFilesAtomic'], between('function ghApi(', 'function ghGateNote('), {
    setTimeout(fn) { timers.set(++id, fn); return id; },
    clearTimeout(key) { timers.delete(key); },
    setInterval() { return 0; }, clearInterval() {},
    GM_xmlhttpRequest(o) {
      requests.push(o);
      if (o.url.endsWith('/ref/heads/main')) o.onload({ status: 200, responseText: '{"object":{"sha":"parent"}}' });
      else if (o.url.endsWith('/commits/parent')) o.onload({ status: 200, responseText: '{"tree":{"sha":"base-tree"}}' });
      else hanging = o;
      return { abort() { o.onabort(); } };
    },
  });
  push.ghPushFilesAtomic('owner', 'repo', 'main', [{ path: 'a.txt', content: 'dsl' }], 'private-token', 'msg',
    (err, result) => { outcome = { err, result }; });
  assert.equal(timers.size, 1);
  [...timers.values()][0]();   // no reply in 90s: the blob is sent once more
  assert.equal(outcome, undefined);
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert.match(outcome.err.message, /^POST blob:.*no reply after two 90s tries.*Nothing was changed/);
  hanging.onload({ status: 201, responseText: '{"sha":"late-blob"}' });
  assert.equal(requests.length, 4);
  assert.ok(!requests.some(r => r.method === 'PATCH'));
  assert.equal(timers.size, 0);
}

const calls = [];
const atomicPush = load(
  ['ghPushFilesAtomic'],
  between('function ghApiError(', 'function pushToGitHub('),
  {
    ghApi(method, path, token, body, done) {
      calls.push({ method, path, token, body });
      if (path.endsWith('/ref/heads/main')) return done(null, 200, { object: { sha: 'parent' } });
      if (path.endsWith('/commits/parent')) return done(null, 200, { tree: { sha: 'base-tree' } });
      if (path.endsWith('/blobs')) return done(null, 201, { sha: `blob-${calls.filter((call) => call.path.endsWith('/blobs')).length}` });
      if (path.endsWith('/trees')) return done(null, 201, { sha: 'new-tree' });
      if (path.endsWith('/commits')) return done(null, 201, { sha: 'new-commit' });
      if (path.endsWith('/refs/heads/main')) return done(null, 200, { object: { sha: 'new-commit' } });
      throw new Error(`unexpected API request: ${method} ${path}`);
    },
  },
);

let result;
atomicPush.ghPushFilesAtomic('owner', 'repo', 'main', [
  { path: 'generator/a.txt', content: 'dsl' },
  { path: 'generator/b.html', content: 'html' },
], 'token', 'Update generator', (err, value) => { result = { err, value }; });

assert.deepEqual(result, { err: null, value: 'updated' });
assert.equal(calls.filter((call) => call.path.endsWith('/blobs')).length, 2);
assert.equal(calls.at(-1).method, 'PATCH');
assert.match(calls.at(-1).path, /\/refs\/heads\/main$/);

// Push as pull request: the commit is published as a NEW branch; the base branch is never moved.
{
  const prCalls = [];
  const pr = load(['ghPushFilesAtomic'], between('function ghApiError(', 'function pushToGitHub('), {
    ghApi(method, path, token, body, done) {
      prCalls.push({ method, path, body });
      if (path.endsWith('/ref/heads/main')) return done(null, 200, { object: { sha: 'parent' } });
      if (path.endsWith('/commits/parent')) return done(null, 200, { tree: { sha: 'base-tree' } });
      if (path.endsWith('/blobs')) return done(null, 201, { sha: 'blob' });
      if (path.endsWith('/trees')) return done(null, 201, { sha: 'new-tree' });
      if (path.endsWith('/commits')) return done(null, 201, { sha: 'new-commit' });
      if (path.endsWith('/refs')) return done(null, 201, { ref: body.ref });
      throw new Error(`unexpected API request: ${method} ${path}`);
    },
  });
  let out;
  pr.ghPushFilesAtomic('o', 'r', 'main', [{ path: 'a/x.txt', content: 'x' }], 't', 'msg', (err, value) => { out = { err, value }; }, { newBranch: 'weld/dad-chat-20261003-0705' });
  assert.deepEqual(out, { err: null, value: 'created' });
  assert.equal(prCalls.at(-1).method, 'POST');
  assert.match(prCalls.at(-1).path, /\/git\/refs$/);
  assert.equal(JSON.stringify(prCalls.at(-1).body), JSON.stringify({ ref: 'refs/heads/weld/dad-chat-20261003-0705', sha: 'new-commit' }));
  assert.ok(!prCalls.some((c) => c.method === 'PATCH'), 'the base branch is never moved');
  assert.ok(prCalls.find((c) => c.path.endsWith('/commits') && c.method === 'POST').body.parents[0] === 'parent', 'the commit sits on top of the base branch');
  for (const bad of ['../x', 'a..b', 'x.lock', '/abs', 'trail/', 'sp ace', 'a//b']) {
    prCalls.length = 0; let r;
    pr.ghPushFilesAtomic('o', 'r', 'main', [{ path: 'a/x.txt', content: 'x' }], 't', 'msg', (err, value) => { r = { err, value }; }, { newBranch: bad });
    assert.ok(r.err && /Unsafe branch name/.test(r.err.message), bad);
    assert.ok(!prCalls.some((c) => c.path.endsWith('/refs')), 'no ref is created for ' + bad);
  }
}

// The analyzer gate only ever adds text to the Push dialog; it never throws and can be switched off.
{
  const P = require('../src/project-core.js'), Dv = require('../src/dev-core.js');
  let gate = true;
  const g = load(['ghGateNote'], between('function ghGateNote(', 'function pushAsPullRequest('), {
    gget: (k, d) => (k === 'ghPushGate' ? gate : d), window: { WeldProjectCore: P, WeldDevCore: Dv },
  });
  assert.equal(g.ghGateNote('x', 'output\n  ok\n', '<p>[output]</p>'), '', 'clean code adds nothing');
  const note = g.ghGateNote('x', 'output\n  [missing]\n', '<p>[output]</p>');
  assert.match(note, /Weld found 1 possible problem/); assert.match(note, /missing/);
  gate = false; assert.equal(g.ghGateNote('x', 'output\n  [missing]\n', '<p>[output]</p>'), '', 'can be switched off');
  gate = true;
  const broken = load(['ghGateNote'], between('function ghGateNote(', 'function pushAsPullRequest('), { gget: () => true, window: { WeldProjectCore: { analyze() { throw new Error('boom'); } }, WeldDevCore: Dv } });
  assert.equal(broken.ghGateNote('x', 'a', 'b'), '', 'an analyzer failure never blocks a push');
  assert.equal(load(['ghGateNote'], between('function ghGateNote(', 'function pushAsPullRequest('), { gget: () => true, window: {} }).ghGateNote('x', 'a', 'b'), '', 'missing modules are tolerated');
}

// Credentials never travel in a state export: the GitHub token, Skybridge grants and the agent-bridge token.
{
  const sec = load(['stateIsSecret'], between('var STATE_SECRET_KEYS', 'function stateScrubOut('), {});
  ['ghToken', 'sb:perm', 'bridge'].forEach((k) => assert.equal(sec.stateIsSecret(k), true, k + ' is excluded from exports'));
  ['favorites', 'ai', 'folderSync', 'baseline:zoo'].forEach((k) => assert.equal(sec.stateIsSecret(k), false, k + ' may be exported'));
}

console.log('skybridge and GitHub push contract tests passed');

// Pull/Diff must work on PRIVATE repos: with a token the file is read through the Contents API
// (token only to api.github.com); without one, or if the API refuses, the anonymous raw URL is used.
{
  const sent = [];
  function world(token, responses) {
    sent.length = 0;
    return load(['ghFetch', 'ghFetchRaw'], between('function ghFetchRaw(', 'function cmText('), {
      ghToken: () => token,
      parseGitHubUrl: load(['parseGitHubUrl'], between('function parseGitHubUrl(', '// global defaults overlaid')).parseGitHubUrl,
      encodeURIComponent, Date,
      GM_xmlhttpRequest(o) { sent.push(o); const r = responses.shift(); setTimeout(() => (r.err ? o.onerror() : o.onload({ status: r.status, responseText: r.text })), 0); },
    });
  }
  const raw = 'https://raw.githubusercontent.com/me/private repo/refs/heads/main/dad chat/a b.txt?_=1'.replace(/ /g, '-');
  const run = (w, url) => new Promise((resolve) => w.ghFetch(url, (err, text) => resolve({ err, text })));
  (async () => {
    let w = world('tok123', [{ status: 200, text: 'SECRET LISTS' }]);
    assert.deepEqual(await run(w, raw), { err: null, text: 'SECRET LISTS' });
    assert.equal(sent.length, 1);
    assert.match(sent[0].url, /^https:\/\/api\.github\.com\/repos\/me\/private-repo\/contents\/dad-chat\/a-b\.txt\?ref=main&_=\d+$/);
    assert.equal(sent[0].headers.Authorization, 'Bearer tok123');
    assert.match(sent[0].headers.Accept, /raw/);
    w = world('', [{ status: 200, text: 'PUBLIC' }]);
    assert.deepEqual(await run(w, raw), { err: null, text: 'PUBLIC' });
    assert.equal(sent.length, 1);
    assert.ok(sent[0].url.startsWith('https://raw.githubusercontent.com/') && !(sent[0].headers && sent[0].headers.Authorization), 'no token: anonymous raw, no Authorization');
    w = world('tok', [{ status: 401, text: '' }, { status: 200, text: 'PUBLIC OK' }]);
    assert.deepEqual(await run(w, raw), { err: null, text: 'PUBLIC OK' }, 'a rejected token falls back to the public file');
    assert.ok(!(sent[1].headers && sent[1].headers.Authorization), 'the token is never sent to raw.githubusercontent.com');
    w = world('tok', [{ status: 404, text: '' }, { status: 404, text: '' }]);
    const failed = await run(w, raw);
    assert.match(failed.err, /^HTTP 404 \(private repo\? the token needs access to me\/private-repo/);
    w = world('tok', [{ err: true }, { status: 200, text: 'X' }]);
    assert.equal((await run(w, raw)).text, 'X');
    w = world('tok', [{ status: 200, text: 'Y' }]);
    await run(w, 'https://example.com/file.txt');
    assert.ok(sent[0].url.startsWith('https://example.com/') && !(sent[0].headers && sent[0].headers.Authorization), 'non-GitHub URLs never get the token');
    console.log('Private-repo Pull/Diff fetch tests passed');
  })().catch((e) => { console.error(e); process.exit(1); });
}

// Bus: known channels are validated before relay, presence is observed (never published), other channels pass through as before.
{
  const BC = require('../src/backup-core.js');
  const sent = [];
  const code = between('var sbBusSubs = {};', '// ---- the outer Helper as a bus AGENT') + between('function sbServiceBus(', 'function sbHandleMessage(');
  const env = { window: { WeldBackupCore: BC }, SB: 'weld.skybridge', BroadcastChannel: undefined, Promise, Date, sbMaybeAgent() {} };
  const ctx = { console, ...env }; vm.createContext(ctx); vm.runInContext(code, ctx);
  const frame = { postMessage: (m) => sent.push(m) };
  const run = async () => {
    const pub = (channel, message) => ctx.sbServiceBus({ op: 'publish', channel, message }, frame, 'https://x');
    await ctx.sbServiceBus({ op: 'subscribe', channel: 'dad-chat:presence' }, frame, 'https://x');
    await ctx.sbServiceBus({ op: 'subscribe', channel: 'dad:genvault' }, frame, 'https://x');
    await ctx.sbServiceBus({ op: 'subscribe', channel: 'free:chan' }, frame, 'https://x');
    const now = Date.now(), beat = { v: 1, type: 'presence', id: 'tab12345:1', from: 'tab12345', gen: 'alpha', at: now };
    assert.equal((await pub('dad-chat:presence', beat)).ok, true);
    const bad = await pub('dad-chat:presence', { ...beat, v: 9 });
    assert.deepEqual([bad.ok, bad.code], [false, 'malformed']);
    assert.equal((await pub('dad-chat:presence', beat)).ok, true, 'a duplicate id is accepted by the publisher but never relayed or counted');
    assert.equal((await pub('free:chan', 'anything goes')).ok, true, 'channels without rules are untouched');
    assert.equal((await pub('dad:genvault', { v: 1, type: 'vault-updated', generator: 'alpha', at: now })).ok, true);
    assert.equal((await pub('dad:genvault', { v: 1, type: 'vault-updated' })).ok, false);
    const relayed = sent.filter((m) => m.type === 'bus').map((m) => m.busChannel);
    assert.deepEqual(relayed, ['dad-chat:presence', 'free:chan', 'dad:genvault'], 'only valid, non-duplicate messages are relayed');
    const snap = ctx.sbPresence.snapshot();
    assert.deepEqual(Object.assign({}, snap.tabs), { alpha: 1 }); assert.equal(snap.ignored, 3);   // bad publish + duplicate + bad vault-updated
    console.log('Skybridge bus envelope validation and presence tests passed');
  };
  run().catch((e) => { console.error(e); process.exit(1); });
}
// Generator sb.ai calls are capped (2 at once, 8 queued, 10 a minute to a cloud key) and a 429 pauses the provider.
{
  const run = async () => {
    const toasts = [], started = [];
    let cfg = { provider: 'google', keys: { google: 'k' } };
    const env = { aiConfig: () => cfg, toast: (m) => toasts.push(String(m)), Date, Promise, String, JSON, Math,
      sbNoModel: () => ({ ok: false, code: 'no-own-model' }), callOwnAIStream() {},
      setTimeout: () => 0, callOwnAI: (c, s, u, done) => { if (u === 'throw') throw new Error('boom'); started.push(done); } };
    const ctx = load(['sbServiceAI', 'SB_AI_LIMIT'], between('var SB_AI_LIMIT', 'function sbServiceFetch('), env);
    const calls = []; for (let i = 0; i < 11; i++) calls.push(ctx.sbServiceAI({ prompt: 'p' + i }));
    assert.equal(started.length, 2, 'only two bridge calls run at once');
    const eleventh = await calls[10];
    assert.deepEqual([eleventh.ok, eleventh.code], [false, 'rate-limited'], 'the 11th call in a minute is refused');
    assert.equal(toasts.length, 1);
    started[0](null, 'a'); await calls[0]; await new Promise((r) => setImmediate(r));
    assert.equal(started.length, 3, 'a finished call lets the next queued one start');
    cfg = { provider: 'localai', keys: {} };
    ctx.SB_AI_LIMIT.queue.length = 0; ctx.SB_AI_LIMIT.active = 0;
    for (let i = 0; i < 12; i++) ctx.sbServiceAI({ prompt: 'local' + i });
    assert.ok(started.length > 3, 'local models are not held to the per-minute cap');
    ctx.SB_AI_LIMIT.queue.length = 0; ctx.SB_AI_LIMIT.active = 0;
    const thrown = await ctx.sbServiceAI({ prompt: 'throw' });
    assert.equal(thrown.ok, false);
    assert.equal(ctx.SB_AI_LIMIT.active, 0, 'a call that throws frees its slot');

    const cool = load(['aiCooldownMsg', 'aiNoteRateLimit'], between('var AI_COOL', '// Big context goes BEFORE'), { Date, Math, String });
    assert.equal(cool.aiCooldownMsg('google'), '');
    cool.aiNoteRateLimit('google', 500, {});
    assert.equal(cool.aiCooldownMsg('google'), '', 'only a 429 starts a pause');
    cool.aiNoteRateLimit('google', 429, { responseText: '{"error":{"details":[{"retryDelay":"42s"}]}}' });
    assert.match(cool.aiCooldownMsg('google'), /pausing calls to your model for 4[12]s/);
    assert.equal(cool.aiCooldownMsg('openai'), '', 'another provider is not paused');
    console.log('Skybridge AI rate limit and 429 back-off tests passed');
  };
  run().catch((e) => { console.error(e); process.exit(1); });
}
