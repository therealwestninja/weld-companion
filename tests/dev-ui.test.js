// The Dev tab end to end: folder sync against an in-memory folder, and the agent bridge against the REAL
// bridge server with a raw MCP client. Every editor change must go through a diff and a confirmation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const http = require('node:http');
const P = require('../src/project-core.js');
const D = require('../src/dev-core.js');
const { createBridge } = require('../bridge/weld-bridge.js');

// ------------------------------------------------------------------ fake DOM
class Element {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = tag; this.attrs = attrs; this.children = []; this.events = {}; this.open = false; this.style = {}; this.checked = false;
    this.value = attrs.value == null ? '' : attrs.value; this.disabled = false; this.className = attrs.class || '';
    (children || []).forEach(c => this.appendChild(c));
    if (attrs.onclick) this.events.click = attrs.onclick; if (attrs.ontoggle) this.events.toggle = attrs.ontoggle;
    this.title = attrs.title || '';
  }
  appendChild(c) { if (c) { c.parentNode = this; this.children.push(c); } return c; }
  removeChild(c) { this.children = this.children.filter(x => x !== c); c.parentNode = null; return c; }
  get firstChild() { return this.children[0] || null; }
  setAttribute(k, v) { this.attrs[k] = v; if (k === 'open') this.open = true; }
  addEventListener(type, fn) { const prev = this.events[type]; this.events[type] = prev ? (...a) => { prev(...a); fn(...a); } : fn; }
  get isConnected() { return true; }
  click() { if (!this.disabled) this.events.click?.(); }
}
const parent = new Element('main');
const walk = n => [n, ...n.children.flatMap(walk)];
const text = n => (n.attrs.text || '') + n.children.map(text).join('');
const bodyText = () => text(parent);
const findBtn = label => walk(parent).find(n => n.tagName === 'button' && n.attrs.text === label);
function click(label) { const n = findBtn(label); assert.ok(n, 'missing button "' + label + '". Buttons: ' + walk(parent).filter(x => x.tagName === 'button').map(x => x.attrs.text).join(' | ')); assert.ok(!n.disabled, '"' + label + '" is disabled'); n.click(); }
function openSection(prefix) { const d = walk(parent).find(n => n.tagName === 'details' && n.children[0] && text(n.children[0]).startsWith(prefix)); assert.ok(d, 'missing section ' + prefix); d.open = true; d.events.toggle?.({ target: d }); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 4000, what = 'condition') { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return; await sleep(15); } throw new Error('timed out waiting for ' + what); }

// ---------------------------------------------------------- fake file system
const NF = () => Object.assign(new Error('not found'), { name: 'NotFoundError' });
const TM = () => Object.assign(new Error('type mismatch'), { name: 'TypeMismatchError' });
class FakeFileHandle {
  constructor(name) { this.name = name; this.kind = 'file'; this.text = ''; this.mtime = Date.now(); }
  async getFile() { const t = this.text, m = this.mtime; return { text: async () => t, lastModified: m }; }
  async createWritable() { let buf = ''; return { write: async x => { buf += x; }, close: async () => { this.text = buf; this.mtime = Date.now(); } }; }
}
class FakeDir {
  constructor(name) { this.name = name; this.kind = 'directory'; this.items = new Map(); this.perm = 'granted'; }
  async getDirectoryHandle(n, o = {}) { let d = this.items.get(n); if (!d) { if (!o.create) throw NF(); d = new FakeDir(n); this.items.set(n, d); } if (!(d instanceof FakeDir)) throw TM(); return d; }
  async getFileHandle(n, o = {}) { let f = this.items.get(n); if (!f) { if (!o.create) throw NF(); f = new FakeFileHandle(n); this.items.set(n, f); } if (f instanceof FakeDir) throw TM(); return f; }
  async *entries() { for (const e of this.items) yield e; }
  async queryPermission() { return this.perm; }
  async requestPermission() { this.perm = 'granted'; return 'granted'; }
  put(path, text) { const segs = path.split('/'), name = segs.pop(); let d = this; segs.forEach(s => { if (!d.items.has(s)) d.items.set(s, new FakeDir(s)); d = d.items.get(s); }); const f = new FakeFileHandle(name); f.text = text; f.mtime = Date.now() + 5; d.items.set(name, f); }
  read(path) { const segs = path.split('/'); let d = this; for (const s of segs) { d = d.items.get(s); if (!d) return null; } return d.text; }
}

// ---------------------------------------------------------------- fake host
let slug = 'zoo', edit = true;
let live = { dsl: 'output\n  [animal] and [animal]\nanimal\n  pig\n  cow\n', html: '<p>[output]</p>' };
const store = new Map(), toasts = [], applied = [], jumps = [], confirms = [], clipboard = [], intervals = [], ghCalls = [];
let confirmAnswer = true, root = new FakeDir('perch_backups_folder_sync'), picked = null;
const host = {
  el: (tag, attrs, children) => new Element(tag, attrs, children),
  get: (k, d) => (store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : d), set: (k, v) => { store.set(k, JSON.parse(JSON.stringify(v))); return true; },
  toast: m => toasts.push(m), copy: t => clipboard.push(t),
  slug: () => slug, isEdit: () => edit, live: () => (edit ? { ...live } : null),
  version: '1.58.0',
  pageWindow: () => ({ showDirectoryPicker: async () => { picked = root; return root; } }),
  applyPane(pane, t) { applied.push([pane, t]); if (pane === 'dsl') live.dsl = t; else live.html = t; return true; },
  diff(a, b) { const x = a === b ? { add: 0, del: 0 } : { add: Math.max(1, b.split('\n').length - a.split('\n').length + 1), del: 1 }; return { rows: [{ cls: 'del', num: 1, text: 'old' }, { cls: 'add', num: 1, text: 'new' }], stats: x }; },
  jump(pane, line) { jumps.push([pane, line]); return true; },
  favorites: () => ['zoo', 'castle'],
  views: () => ({ dsl: null, html: null }),
  sample: async (s, via, o) => ({ samples: host.nextSamples || ['Red Fox', 'Blue Owl', 'Green Cat'], ms: 3 }),
  request(o, cb) {
    const u = new URL(o.url);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: o.method || 'GET', headers: o.headers || {}, timeout: o.timeout }, res => {
      const ch = []; res.on('data', c => ch.push(c)); res.on('end', () => cb(null, { status: res.statusCode, text: Buffer.concat(ch).toString('utf8') }));
    });
    req.on('error', () => cb('network error')); if (o.data) req.write(o.data); req.end();
  },
  gh: {
    resolve: s => ({ cfg: { owner: 'me', repo: 'perchance_backups', branch: 'main', dslPath: '{name}/{name}-top-panel.txt', htmlPath: '{name}/{name}-html-panel.html' }, dslUrl: 'https://raw/' + s + '/d', htmlUrl: 'https://raw/' + s + '/h' }),
    token: () => true, fetch: (url, cb) => cb(null, url.endsWith('/d') ? repoCopy.dsl : repoCopy.html),
    api: (method, path, body, cb) => { ghCalls.push({ method, path, body }); const r = ghReplies.shift() || [null, 201, { number: 7, html_url: 'https://github.com/me/perchance_backups/issues/7' }]; cb(...r); }
  },
  openTab() {}
};
let repoCopy = { dsl: live.dsl, html: live.html }; const ghReplies = [];

const window = { confirm: m => { confirms.push(m); return confirmAnswer; }, location: { href: '' }, open() {} }; window.top = window;
window.WeldProjectCore = P; window.WeldDevCore = D; window.weldProjectHost = host;
window.weldProject = { current: () => ({ name: slug, dsl: live.dsl, html: live.html, deps: null, source: 'editor' }), fetchPublished: async s => ({ name: s, dsl: 'output\n  published ' + s + '\n', html: '<p>[output]</p>' }) };
const documentStub = { hidden: false, getElementById: id => walk(parent).find(n => n.attrs.id === id), createElement: () => new Element('div'), querySelector: () => null };
// Shared IndexedDB fixture: two independent generator tabs must reuse one master handle.
const folderDb = new Map();
const indexedDB = { open() {
  const request = {};
  setTimeout(() => {
    request.result = { transaction() {
      const tx = { objectStore: () => ({
        get: key => ({ result: folderDb.get(key) }),
        put: (value, key) => { folderDb.set(key, value); return {}; },
        delete: key => { folderDb.delete(key); return {}; },
      }) };
      setTimeout(() => tx.oncomplete?.(), 0);
      return tx;
    } };
    request.onsuccess?.();
  }, 0);
  return request;
} };
const context = { window, document: documentStub, console, indexedDB, setTimeout, clearTimeout, setInterval: fn => { intervals.push(fn); return intervals.length; }, clearInterval() {}, Promise, JSON, Date, Math, Object, Array, Set, Map, String, Number, Error, RegExp, URL, Blob };
vm.runInNewContext(fs.readFileSync('src/dev-ui.js', 'utf8'), context);
const dev = window.weldDev, render = () => dev.render(parent);
const norm = t => t.replace(/\r\n?/g, '\n');

(async () => {
  // ============================================================ folder sync
  render(); await sleep(30); render();
  // 1.92.0: the master-folder panel is off by default and can be switched back on.
  assert.doesNotMatch(bodyText(), /Choose folder/);
  openSection('Folder sync'); assert.match(bodyText(), /switched off/);
  assert.equal(store.get('folderSync') && store.get('folderSync').showPanel, undefined);
  click('Show folder sync'); await sleep(30); render();
  assert.equal(store.get('folderSync').showPanel, true, 'choice is remembered');
  assert.match(bodyText(), /Choose folder/);
  openSection('Folder sync');
  click('Choose folder…'); await until(() => dev.state.F.handle, 2000, 'folder');
  assert.equal(picked, root);
  assert.equal(dev.state.F.perm, 'granted');
  await until(() => dev.state.F.plan, 2000, 'first plan');
  assert.equal(dev.state.F.plan.state, 'no-disk');

  render(); click('Write editor to folder'); await until(() => root.read('zoo/zoo-top-panel.txt'), 2000, 'file written');
  assert.equal(root.read('zoo/zoo-top-panel.txt'), live.dsl);
  assert.equal(root.read('zoo/zoo-html-panel.html'), live.html);
  await until(() => !dev.state.F.busy && dev.state.F.plan?.state === 'in-sync', 2000, 'folder write and sync completion');
  await dev.tick(true); assert.equal(dev.state.F.plan.state, 'in-sync');

  // An agent edits the file on disk: Weld flags it, shows a diff, and applies it only on request.
  const agentDsl = 'output\n  [animal] and [animal]\nanimal\n  pig\n  cow\n  goat\n';
  root.put('zoo/zoo-top-panel.txt', agentDsl.replace(/\n/g, '\r\n'));   // Windows editors save CRLF
  toasts.length = 0;
  await dev.tick(true);
  assert.equal(dev.state.F.plan.state, 'disk-ahead');
  assert.ok(toasts.some(t => /folder copy of "zoo" changed/.test(t)), 'the user is told');
  await dev.tick(true); assert.equal(toasts.filter(t => /folder copy/.test(t)).length, 1, 'but only once per change');
  assert.equal(applied.length, 0, 'nothing is applied automatically');
  render(); assert.match(bodyText(), /folder copy changed/);
  click('Review changes…'); await until(() => dev.state.S.view, 2000, 'diff view');
  render(); assert.match(bodyText(), /Editor → folder copy of zoo/);
  confirms.length = 0; click('Apply folder copy to editor'); await until(() => applied.length >= 1, 2000, 'apply');
  assert.match(confirms[0], /Ctrl\+Z undoes it/);
  assert.deepEqual(applied.map(a => a[0]), ['dsl', 'html']);
  assert.equal(norm(applied[0][1]), agentDsl, 'CRLF from the folder is normalized');
  await until(() => !dev.state.S.view && !dev.state.F.busy && dev.state.F.plan?.state === 'in-sync', 2000, 'folder apply and sync completion');
  await dev.tick(true); assert.equal(dev.state.F.plan.state, 'in-sync');

  // Declining the confirmation applies nothing.
  root.put('zoo/zoo-top-panel.txt', agentDsl + '  duck\n'); await dev.tick(true);
  confirmAnswer = false; applied.length = 0; render(); click('Apply folder copy'); await sleep(50);
  assert.equal(applied.length, 0); confirmAnswer = true;

  // Editor edits while the folder is untouched -> editor-ahead; auto-mirror then writes them out.
  root.put('zoo/zoo-top-panel.txt', live.dsl); await dev.tick(true);          // folder == editor again
  assert.equal(dev.state.F.plan.state, 'in-sync');
  live.dsl += '  eel\n';
  await dev.tick(true); assert.equal(dev.state.F.plan.state, 'editor-ahead');
  dev.state.F.cfg.autoMirror = true; host.set('folderSync', dev.state.F.cfg); await dev.tick(true);
  assert.notEqual(norm(root.read('zoo/zoo-top-panel.txt')), live.dsl, 'auto-mirror was removed in 1.90.0: the folder is only written on request');
  assert.equal(dev.state.F.plan.state, 'editor-ahead'); click('Write editor to folder'); await sleep(60); assert.equal(norm(root.read('zoo/zoo-top-panel.txt')), live.dsl); assert.equal(dev.state.F.plan.state, 'in-sync');

  // Both changed -> conflict, and overwriting asks first.
  live.dsl += '  fox\n'; root.put('zoo/zoo-top-panel.txt', 'output\n  something else\n');
  await dev.tick(true); assert.equal(dev.state.F.plan.state, 'conflict');
  render(); confirms.length = 0; confirmAnswer = false; click('Write editor to folder'); await sleep(60);
  assert.match(confirms[0], /has changes that are not in the editor/);
  assert.equal(root.read('zoo/zoo-top-panel.txt'), 'output\n  something else\n', 'declined: the folder file is untouched'); confirmAnswer = true;

  // Unsafe names never reach the file system.
  slug = '../evil'; await dev.tick(true); assert.equal(dev.state.F.plan, null);
  slug = 'zoo';
  await assert.rejects(async () => { D.folderPaths('../evil'); }, /not a safe/);

  // Download published copy and list folders.
  render(); click('Download published copy'); await until(() => /published zoo/.test(root.read('zoo/zoo-top-panel.txt') || ''), 2000, 'published copy');
  root.put('castle/castle-top-panel.txt', 'output\n  hi\n'); root.put('notes/readme.txt', 'ignored');
  render(); click('List generators in folder'); await until(() => dev.state.F.folders, 2000, 'listing');
  assert.equal(JSON.stringify(dev.state.F.folders.map(f => f.slug).sort()), JSON.stringify(['castle', 'zoo']));

  // Permission lost after a browser restart -> asks the user, never silently.
  root.perm = 'prompt'; dev.state.F.perm = 'prompt'; render();
  assert.match(bodyText(), /confirm access/); click('Allow access'); await until(() => dev.state.F.perm === 'granted', 2000, 'permission');
  // Starred seeding writes both generators.
  root = root; render(); click('Download all starred generators'); await until(() => !dev.state.F.seeding && /published castle/.test(root.read('castle/castle-top-panel.txt') || ''), 3000, 'starred seeding');
  // Another generator tab inherits the master location without opening a picker.
  const otherParent = new Element('main');
  const otherHost = { ...host, slug: () => 'castle', live: () => ({ dsl: 'output\n  castle editor\n', html: '<p>castle</p>' }) };
  const otherWindow = { ...window, weldProjectHost: otherHost }; otherWindow.top = otherWindow;
  const otherDoc = { ...documentStub, getElementById: id => walk(otherParent).find(n => n.attrs.id === id) };
  const otherContext = { ...context, window: otherWindow, document: otherDoc };
  vm.runInNewContext(fs.readFileSync('src/dev-ui.js', 'utf8'), otherContext);
  const otherDev = otherWindow.weldDev;
  picked = null; otherDev.render(otherParent);
  await until(() => otherDev.state.F.handle, 2000, 'inherited master folder');
  assert.equal(otherDev.state.F.handle, root);
  assert.equal(picked, null, 'no per-generator picker needed');
  assert.match(text(otherParent), /Master Dev location/);

  // Change master in one tab: other open tabs switch even with watching disabled.
  const oldRoot = root, oldDsl = oldRoot.read('zoo/zoo-top-panel.txt');
  const oldBaseKey = 'base:' + dev.state.F.revision + ':zoo';
  assert.ok(folderDb.has(oldBaseKey));
  host.set('folderSync', { ...store.get('folderSync'), autoMirror: true, watch: false });
  root = new FakeDir('JawlessEel_perchance_backups');
  otherDev.render(otherParent);
  const changeMaster = walk(otherParent).find(n => n.tagName === 'button' && n.attrs.text === 'Change master folder…');
  assert.ok(changeMaster); changeMaster.click();
  await until(() => otherDev.state.F.handle === root && store.get('folderSync').autoMirror === false, 2000, 'new master folder');
  await dev.tick(false);
  assert.equal(dev.state.F.handle, root);
  assert.equal(dev.state.F.cfg.autoMirror, false);
  assert.equal(dev.state.F.plan, null, 'old sync plan is discarded on folder change');
  assert.equal(oldRoot.read('zoo/zoo-top-panel.txt'), oldDsl, 'old folder is untouched');
  assert.equal(root.read('zoo/zoo-top-panel.txt'), null, 'selecting master does not write');
  assert.equal(root.read('castle/castle-top-panel.txt'), null, 'other generator is not auto-written');
  await dev.tick(true); assert.equal(dev.state.F.plan.state, 'no-disk', 'old-folder baseline is not reused');

  // Global pause reaches another open tab without applying anything to its editor.
  host.set('folderSync', { ...store.get('folderSync'), autoMirror: true });
  render(); click('Pause automatic writes in all tabs');
  await otherDev.tick(false);
  assert.equal(otherDev.state.F.cfg.autoMirror, false);
  assert.equal(root.items.size, 0);
  render(); click('Write editor to folder');
  await until(() => root.read('zoo/zoo-top-panel.txt'), 2000, 'manual master write');
  assert.equal(root.read('zoo/zoo-top-panel.txt'), live.dsl);
  assert.equal(oldRoot.read('zoo/zoo-top-panel.txt'), oldDsl);

  // Disconnect once and every open generator releases the handle.
  render(); click('Disconnect folder');
  await until(() => !folderDb.has('handle'), 2000, 'master disconnect');
  await otherDev.tick(false);
  assert.equal(otherDev.state.F.handle, null);
  assert.equal(otherDev.state.F.cfg.autoMirror, false);
  assert.equal(root.read('zoo/zoo-top-panel.txt'), live.dsl, 'disconnect deletes no files');
  console.log('Dev tab folder sync passed');

  // ============================================================ agent bridge (real server)
  const bridge = createBridge({ token: 'ab12'.repeat(8), toolMs: { default: 3000, weld_sample: 3000 } });
  const { port } = await bridge.listen(0);
  const MCP = '/mcp/' + bridge.token;
  const mcp = (obj, sid) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: MCP, method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(sid ? { 'Mcp-Session-Id': sid } : {}) } }, res => {
      const ch = []; res.on('data', c => ch.push(c)); res.on('end', () => resolve({ headers: res.headers, json: ch.length ? JSON.parse(Buffer.concat(ch).toString()) : null }));
    }); req.on('error', reject); req.end(JSON.stringify(obj));
  });
  const init = await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'codex-test' } } });
  const sid = init.headers['mcp-session-id'];
  const call = async (name, args) => (await mcp({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name, arguments: args } }, sid)).json.result;
  const data = r => JSON.parse(r.content[0].text);
  const flag = (k, v) => host.set('bridge', { ...host.get('bridge', {}), [k]: v });   // what the checkboxes do

  // refuses non-local hosts and bad tokens before sending anything
  render(); openSection('Agent bridge');
  const urlInput = walk(parent).find(n => n.tagName === 'input' && n.attrs['aria-label'] === 'Bridge URL');
  const tokInput = walk(parent).find(n => n.tagName === 'input' && n.attrs['aria-label'] === 'Bridge token');
  urlInput.value = 'https://evil.example.com'; urlInput.events.input(); tokInput.value = bridge.token; tokInput.events.input();
  click('Connect'); assert.match(dev.state.B.error, /must point to this computer/); assert.equal(dev.state.B.running, false);
  urlInput.value = 'http://127.0.0.1:' + port; urlInput.events.input(); tokInput.value = 'short'; tokInput.events.input();
  // an invalid token is replaced by the one the bridge hands out (pairing), so nothing has to be pasted
  render(); click('Connect'); await until(() => dev.state.B.state === 'connected', 4000, 'bridge paired and connected');
  assert.equal(host.get('bridge', {}).token, bridge.token, 'the paired token is saved');
  const st = data(await call('weld_status', {}));
  assert.equal(st.connected, true); assert.equal(st.tabs[0].generator, 'zoo'); assert.match(st.tabs[0].editor, /open/);

  // read tools see the LIVE editor
  const src = data(await call('weld_get_source', { pane: 'dsl' }));
  assert.match(src.text, /1: output/); assert.equal(src.pane, 'dsl');
  assert.ok(data(await call('weld_get_outline', {})).lists.some(l => l.name === 'animal'));
  assert.equal(data(await call('weld_find_usages', { name: 'animal' })).count, 2, 'one definition line and one line of references');
  assert.equal(data(await call('weld_search', { query: 'PIG' })).matches[0].line, 4);
  assert.equal((await call('weld_get_findings', {})).isError, false);
  const unknownList = await call('weld_find_usages', { name: '$bad' }); assert.equal(unknownList.isError, false, 'invalid names answer, not crash');

  // a proposal is queued, never applied
  applied.length = 0; const beforeProposal = live.dsl;
  assert.equal(beforeProposal.split('\n')[3], '  pig', 'line 4 is the "pig" item');
  const pr = data(await call('weld_propose_edit', { pane: 'dsl', edits: [{ start_line: 4, end_line: 4, text: '  pig\n  hen' }], note: 'add a hen' }));
  assert.equal(pr.status, 'pending'); assert.equal(applied.length, 0);
  assert.equal(dev.state.S.proposals[0].agent, 'codex-test', 'agent name comes from the MCP session');
  render(); assert.match(bodyText(), /codex-test/); assert.match(bodyText(), /add a hen/);
  assert.equal(data(await call('weld_proposal_status', { id: pr.id })).status, 'pending');
  click('Review diff'); await until(() => dev.state.S.view, 1000, 'proposal diff'); render();
  assert.match(bodyText(), /codex-test proposes a change/);
  confirms.length = 0; click('Apply to editor'); await until(() => applied.length === 1, 2000, 'accepted');
  assert.equal(applied[0][0], 'dsl');
  assert.equal(applied[0][1], D.applyLineEdits(beforeProposal, [{ start_line: 4, end_line: 4, text: '  pig\n  hen' }]), 'exactly the proposed edit, nothing else');
  assert.match(applied[0][1], /pig\n {2}hen\n/);
  assert.equal(data(await call('weld_proposal_status', { id: pr.id })).status, 'applied');

  // a proposal written against an older editor is refused
  const p2 = data(await call('weld_propose_edit', { pane: 'html', new_text: '<p>changed [output]</p>' }));
  live.html = '<p>edited meanwhile [output]</p>';
  assert.equal(data(await call('weld_proposal_status', { id: p2.id })).status, 'stale');
  render(); assert.match(bodyText(), /out of date/);
  applied.length = 0; dev.state.S.view = null; render();
  const staleApply = walk(parent).filter(n => n.tagName === 'button' && n.attrs.text === 'Apply').find(b => b.disabled);
  assert.ok(staleApply, 'Apply is disabled for a stale proposal');
  assert.equal(applied.length, 0);
  click('Reject'); assert.equal(data(await call('weld_proposal_status', { id: p2.id })).status, 'rejected');
  // bad proposals are explained to the agent
  const bad = await call('weld_propose_edit', { pane: 'dsl', edits: [{ start_line: 99, end_line: 99, text: 'x' }] });
  assert.equal(bad.isError, true); assert.match(bad.content[0].text, /outside the document/);
  const same = await call('weld_propose_edit', { pane: 'dsl', new_text: live.dsl }); assert.match(same.content[0].text, /does not change/);
  flag('allowPropose', false);
  assert.match((await call('weld_propose_edit', { pane: 'dsl', new_text: 'x' })).content[0].text, /turned off agent proposals/);
  flag('allowPropose', true);
  // proposals need the editor
  edit = false; assert.match((await call('weld_propose_edit', { pane: 'dsl', new_text: 'x' })).content[0].text, /editor is not open/); edit = true;

  // samples are off unless the user allows them
  assert.match((await call('weld_sample', { count: 10 })).content[0].text, /not allowed agents to run samples/);
  flag('allowSample', true); host.nextSamples = ['A b', 'A b', 'C d', 'E f', 'G h', 'I j'];
  const smp = data(await call('weld_sample', { count: 10 })); assert.equal(smp.stats.n, 6); assert.ok(smp.samples.length <= 30);
  flag('allowSample', false);

  // disconnect and reconnect do not duplicate poll loops
  const before = bridge.clients.size;
  click('Disconnect'); assert.equal(dev.state.B.running, false);
  await sleep(100);
  render(); click('Connect'); await until(() => dev.state.B.state === 'connected', 4000, 'reconnect');
  assert.equal(data(await call('weld_get_outline', {})).stats.lists, 2);
  await bridge.close();
  console.log('Dev tab agent bridge passed');

  // ============================================================ GitHub agents
  render(); openSection('GitHub agents');
  const ta = walk(parent).find(n => n.tagName === 'textarea' && /What should the agent do/.test(n.attrs['aria-label']));
  ta.value = 'Add more animals to the list'; ta.events.input();
  repoCopy = { dsl: live.dsl, html: live.html };
  render(); click('Check repo copy'); await until(() => /matches your editor/.test(dev.state.S.agents.repoState), 2000, 'repo check');
  repoCopy = { dsl: 'old', html: '<p>old</p>' }; click('Check repo copy'); await until(() => /differs from your editor/.test(dev.state.S.agents.repoState), 2000, 'repo differs');
  ghCalls.length = 0; confirms.length = 0;
  render(); click('Create issue'); await until(() => dev.state.S.agents.result, 2000, 'issue');
  assert.match(confirms[0], /GitHub Copilot cloud agent/); assert.match(confirms[0], /No token or code is included/);
  assert.equal(ghCalls.length, 1); assert.equal(ghCalls[0].path, '/repos/me/perchance_backups/issues');
  assert.deepEqual(ghCalls[0].body.assignees, ['copilot-swe-agent[bot]']);
  assert.equal(ghCalls[0].body.agent_assignment.base_branch, 'main');
  assert.match(ghCalls[0].body.body, /zoo\/zoo-top-panel\.txt/); assert.doesNotMatch(JSON.stringify(ghCalls[0]), /token/i);
  assert.equal(clipboard.at(-1), 'https://github.com/me/perchance_backups/issues/7');
  assert.match(confirms[0], /Task mode: Change code/);
  dev.state.S.agents.result = null; ghCalls.length = 0; confirms.length = 0; render();
  const mode = walk(parent).find(n => n.tagName === 'select' && n.attrs['aria-label'] === 'Task mode');
  assert.equal(mode.children.length, 3);
  mode.value = 'analysis'; mode.events.change();
  assert.equal(dev.state.S.agents.mode, 'analysis');
  click('Create issue'); await until(() => dev.state.S.agents.result, 2000, 'read-only issue');
  assert.match(confirms[0], /Analyze and report \(read-only\)/);
  assert.match(ghCalls[0].body.body, /Do not edit any files/);
  assert.match(ghCalls[0].body.agent_assignment.custom_instructions, /Read-only analysis/);
  assert.doesNotMatch(ghCalls[0].body.body, /After the change is merged|Rules for the change/);
  dev.state.S.agents.mode = 'auto'; dev.state.S.agents.request = 'analyze and tell me what this project is overall, a short quick explanation';
  dev.state.S.agents.result = null; ghCalls.length = 0; render(); click('Create issue');
  await until(() => dev.state.S.agents.result, 2000, 'auto analysis issue');
  assert.match(ghCalls[0].body.agent_assignment.custom_instructions, /Read-only analysis/);
  dev.state.S.agents.agent = 'claude'; dev.state.S.agents.result = null; ghCalls.length = 0; render(); click('Create issue');
  await until(() => dev.state.S.agents.result, 2000, 'claude issue'); assert.equal(ghCalls.length, 2);
  assert.match(ghCalls[1].path, /\/issues\/7\/comments$/); assert.match(ghCalls[1].body.body, /^@claude /);
  assert.match(ghCalls[1].body.body, /without editing files/);
  // GitHub errors are explained
  ghReplies.push([null, 422, { message: 'Copilot is not enabled' }]); dev.state.S.agents.agent = 'copilot'; dev.state.S.agents.result = null; render(); click('Create issue');
  await until(() => dev.state.S.agents.error, 2000, 'issue error'); assert.match(dev.state.S.agents.error, /GitHub refused \(422: Copilot is not enabled\)/); assert.match(dev.state.S.agents.error, /Pull requests, Actions/);
  dev.state.S.agents.error = '';
  confirmAnswer = false; ghCalls.length = 0; render(); click('Create issue'); await sleep(50); assert.equal(ghCalls.length, 0, 'declining the confirmation creates nothing'); confirmAnswer = true;
  console.log('Dev tab GitHub agent hand-off passed');

  // ============================================================ rename
  live.dsl = 'output\n  [animal] and [animal]\nanimal\n  pig\n  cow\n'; live.html = '<p>[output]</p><button onclick="go(animal)">x</button>';
  render(); openSection('Find usages and rename');
  const sel = walk(parent).find(n => n.tagName === 'select' && n.attrs['aria-label'] === 'List to inspect');
  assert.ok(sel.children.some(o => o.attrs.value === 'animal'));
  sel.value = 'animal'; sel.events.change(); render();
  click('Find usages'); render(); assert.match(bodyText(), /place\(s\) use "animal"/);
  const to = walk(parent).find(n => n.tagName === 'input' && n.attrs['aria-label'] === 'New name'); to.value = 'beast'; to.events.input();
  click('Preview rename'); render(); assert.match(bodyText(), /change\(s\): 1 definition/);
  applied.length = 0; confirms.length = 0; click('Apply rename'); await sleep(30);
  assert.match(confirms.at(-1), /Rename "animal" to "beast"/);
  assert.match(applied.find(a => a[0] === 'dsl')[1], /^beast$/m); assert.match(applied.find(a => a[0] === 'html')[1], /go\(beast\)/);
  // a collision is explained, not applied
  live.dsl = 'output\n  [a] [b]\na\n  x\nb\n  y\n'; live.html = '<p>[output]</p>'; dev.state.S.refactor.name = 'a'; dev.state.S.refactor.to = 'b'; render(); click('Preview rename');
  render(); assert.match(bodyText(), /already exists/);
  // stale preview is refused
  live.dsl = 'output\n  [a]\na\n  x\n'; dev.state.S.refactor.to = 'c'; render(); click('Preview rename'); live.dsl += '  z\n'; applied.length = 0; render(); click('Apply rename'); await sleep(30);
  assert.equal(applied.length, 0); assert.ok(toasts.some(t => /editor changed after the preview/.test(t)));
  console.log('Dev tab rename passed');

  // ============================================================ regression baseline
  host.nextSamples = Array.from({ length: 30 }, (_, i) => 'Red Fox runs ' + (i % 5));
  render(); openSection('Regression check'); click('Save baseline'); await until(() => store.has('baseline:zoo'), 2000, 'baseline');
  host.nextSamples = Array.from({ length: 30 }, (_, i) => 'Green Dragon breathes fire loudly ' + (i % 3));
  render(); click('Compare with baseline'); await until(() => dev.state.S.regress.result, 2000, 'comparison'); render();
  assert.match(bodyText(), /no longer appear/); assert.match(bodyText(), /new common word/);
  console.log('Dev tab regression check passed');

  // ============================================================ editor markers
  const layerChildren = [];
  let scrollTop = 30; const scrollListeners = [];
  const scroller = { children: [], appendChild(c) { c.parentNode = scroller; this.children.push(c); return c; }, getBoundingClientRect: () => ({ top: 100 }), get scrollTop() { return scrollTop; }, addEventListener(t, fn) { scrollListeners.push([t, fn]); } };
  // coordsAtPos is viewport-relative; line 2 starts at pos 10 and is drawn 40px below the scroller's top edge.
  const fakeView = { scrollDOM: scroller, scaleY: 1, state: { doc: { lines: 5, line: n => ({ from: (n - 1) * 10 }) } },
    coordsAtPos: pos => (pos === 10 ? { top: 140, bottom: 157 } : null), lineBlockAt: () => { throw new Error('must not use the cached heights'); } };
  host.views = () => ({ dsl: fakeView, html: null });
  live.dsl = 'output\n  [missing] here\n'; live.html = '<p>[output]</p>';
  render(); openSection('Editor markers');
  const markChk = walk(parent).find(n => n.tagName === 'label' && /Show markers in the editor/.test(text(n))).children[0]; markChk.checked = true; markChk.events.change();
  assert.ok(intervals.length >= 1, 'a timer paints the markers');
  intervals.forEach(fn => fn());
  const layer = scroller.children.find(c => c.className === 'weld-marks');
  assert.ok(layer && layer.children.length >= 1, 'a marker is drawn for the finding');
  assert.match(layer.children[0].title, /"missing" is not a list/);
  assert.match(layer.children[0].style.cssText, /top:70px/, 'viewport 140 - scroller top 100 + scrollTop 30');
  assert.match(layer.children[0].style.cssText, /height:17px/);
  assert.ok(scrollListeners.some(l => l[0] === 'scroll'), 'markers are redrawn when the editor scrolls');
  assert.equal(layer.children[0].style.cssText.includes('#d29922'), true, 'warnings are orange');
  const m0 = markChk; m0.checked = false; m0.events.change();
  assert.equal(layer.children.length, 0, 'switching off removes the markers');
  console.log('Dev tab editor markers passed');
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
