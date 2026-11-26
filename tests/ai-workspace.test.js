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

function load(names, code, extras = {}) {
  const context = { ...extras };
  vm.createContext(context);
  vm.runInContext(code, context);
  return Object.fromEntries(names.map((name) => [name, context[name]]));
}

const extraction = load(
  ['aiExtractCode'],
  between('function aiExtractCode(', 'function aiWorkspaceSystem('),
);

const mixedReply = [
  'Here is the change.',
  '```html',
  '<main>new</main>',
  '```',
  '```perchance',
  'output = new value',
  '```',
].join('\n');

assert.equal(extraction.aiExtractCode(mixedReply, 'dsl'), 'output = new value');
assert.equal(extraction.aiExtractCode(mixedReply, 'html'), '<main>new</main>');
assert.equal(extraction.aiExtractCode('plain proposed code', 'dsl'), 'plain proposed code');
assert.throws(() => extraction.aiExtractCode('```html\n<p>wrong pane</p>\n```', 'dsl'), /differently labeled/);
assert.throws(() => extraction.aiExtractCode('```dsl\none\n```\n```dsl\ntwo\n```', 'dsl'), /ambiguous/);
assert.equal(extraction.aiExtractCode('```dsl\n  indented\n```', 'dsl'), '  indented');

const defaults = load(
  ['aiConfig'],
  between('function aiConfig(', '// D4 consumer:'),
  { gget: () => ({ provider: 'localai' }) },
).aiConfig();

assert.equal(defaults.provider, 'localai');
assert.equal(defaults.interceptAgent, false);
assert.equal(defaults.maxTokens, 4096);
assert.equal(JSON.stringify(defaults.keys), '{}');
assert.equal(JSON.stringify(defaults.models), '{}');
assert.equal(JSON.stringify(defaults.endpoints), '{}');

const hookSource = between('function aiAgentButton(', '// ============================================================ bootstrap');
assert.match(hookSource, /#aiAgentSendBtn/);
assert.match(hookSource, /#aiAgentInputEl/);
assert.match(hookSource, /cfg\.interceptAgent/);
assert.doesNotMatch(hookSource, /viewSet\s*\(/);

let routeConfig = { provider: 'localai', interceptAgent: true, models: { localai: 'saved-model' } };
let routeToggle;
const routeParent = {
  querySelector: () => routeToggle,
  insertBefore(node) { routeToggle = node; },
};
const routeButton = { parentNode: routeParent };
const routeControl = load(['updateHelperRouteToggle'], between('function updateHelperRouteToggle(', 'function hookHelperSubmit('), {
  aiConfig: () => ({ ...routeConfig }),
  gset(key, value) { assert.equal(key, 'ai'); routeConfig = value; return true; },
  document: {
    createElement() { return { style: {}, setAttribute(key, value) { this[key] = value; }, addEventListener(type, fn) { this.click = fn; } }; },
    querySelector: () => null,
  },
});
routeControl.updateHelperRouteToggle(routeButton);
assert.equal(routeToggle.textContent, 'Weld: On');
routeToggle.click();
assert.equal(routeConfig.interceptAgent, false);
assert.equal(routeConfig.models.localai, 'saved-model');
assert.equal(routeToggle.textContent, 'Weld: Off');
routeToggle.click();
assert.equal(routeConfig.interceptAgent, true);
routeConfig.provider = 'builtin';
routeControl.updateHelperRouteToggle(routeButton);
assert.equal(routeToggle.disabled, true);
assert.equal(routeToggle['aria-pressed'], 'false');

const instructionSource = between('function applyHelperInstruction(', 'function aiAgentButton(');
assert.doesNotMatch(instructionSource, /aiHelperInputEl/);

// Exercise actual asynchronous request and review handlers without a browser.
let pending, aborts = 0, writes = 0, throwsOnStart = false;
let provider = 'localai', nativeRequest = '', nativeFailure = false, lastUser = '';
let doc = 'original';
const view = {};
const roots = [];
function node(tag, attrs = {}, children = []) {
  return { tag, attrs, children, appendChild(child) { this.children.push(child); },
    addEventListener() {}, remove() {} };
}
const runtime = load(
  ['AI_WORKSPACE', 'aiAskWorkspace', 'aiStopWorkspace', 'renderAIReviewModal'],
  between('var AI_WORKSPACE =', 'function renderAI(body)'),
  {
    aiConfig: () => ({ provider, maxTokens: 8192 }),
    openPerchanceAI(prompt) { if (nativeFailure) throw new Error('Native input missing'); nativeRequest = prompt; },
    PROVIDERS: { localai: { label: 'Local' } },
    WC_TAB: null, $: () => null, toast() {},
    dslView: () => view, htmlView: () => view, viewText: () => doc,
    genName: () => 'test-project', el: node,
    document: { addEventListener() {}, removeEventListener() {}, body: { appendChild(n) { roots.push(n); } } },
    lineDiffOps: () => [], diffStats: () => ({ add: 1, del: 1 }), diffRows: () => [],
    muteBugFinderError: () => () => {}, setTimeout() {},
    viewSet(v, text) { writes++; doc = text; return true; },
    callOwnAI(cfg, sys, user, callback, json, maxTokens) {
      if (throwsOnStart) throw new Error('transport unavailable');
      assert.equal(maxTokens, 8192);
      lastUser = user;
      pending = callback;
      return { abort() { aborts++; } };
    },
  },
);
const state = runtime.AI_WORKSPACE;
state.prompt = 'fix it'; state.response = 'previous answer';
assert.equal(runtime.aiAskWorkspace(), true);
assert.equal(state.response, 'previous answer');
assert.equal(runtime.aiAskWorkspace(), false, 'duplicate request is blocked');
const oldCallback = pending;
runtime.aiStopWorkspace(true);
assert.equal(aborts, 1);
oldCallback(null, 'late reply');
assert.equal(state.response, '', 'clear cannot be undone by a late callback');
state.prompt = 'retry';
runtime.aiAskWorkspace();
oldCallback(null, 'stale reply during a newer request');
assert.equal(state.busy, true);
pending(null, 'new answer');
assert.equal(state.response, 'new answer');
assert.equal(state.busy, false);
state.prompt = 'Explain that answer';
runtime.aiAskWorkspace();
assert.match(lastUser, /USER:\nretry\nASSISTANT:\nnew answer/);
assert.match(lastUser, /CURRENT USER MESSAGE:\nExplain that answer/);
pending('Server unavailable', null);
assert.equal(state.history.length, 1, 'failed requests do not enter conversation history');
runtime.aiStopWorkspace(true);
assert.equal(state.history.length, 0, 'Clear starts a new conversation');
state.prompt = 'retry'; state.response = 'new answer';
throwsOnStart = true;
runtime.aiAskWorkspace();
assert.equal(state.busy, false, 'synchronous errors release the busy state');
assert.match(state.status, /transport unavailable/);
assert.equal(state.response, 'new answer', 'failure preserves the previous reply');
provider = 'builtin'; state.context = 'none';
assert.equal(runtime.aiAskWorkspace(), true, 'built-in provider opens native helper');
assert.match(nativeRequest, /REQUEST:\nretry/);
assert.match(state.status, /Perchance AI helper/);
assert.equal(state.busy, false, 'native draft handoff starts no model request');
nativeFailure = true;
assert.equal(runtime.aiAskWorkspace(), false);
assert.match(state.status, /Native input missing/);
provider = 'localai';

const conversation = load(['AI_WORKSPACE', 'aiConversationPrompt', 'aiRememberTurn'], between('var AI_WORKSPACE =', 'function aiStopWorkspace('), { genName: () => 'one' });
const chatCfg = { provider: 'localai', models: { localai: 'model-a' } };
conversation.aiConversationPrompt('first', chatCfg);
for (let i = 0; i < 10; i++) conversation.aiRememberTurn('question ' + i, 'reply ' + i);
assert.equal(conversation.AI_WORKSPACE.history.length, 6);
assert.match(conversation.aiConversationPrompt('next', chatCfg), /question 9/);
assert.doesNotMatch(conversation.aiConversationPrompt('next', chatCfg), /question 0/);
conversation.aiRememberTurn('large', 'x'.repeat(25000));
assert.equal(conversation.AI_WORKSPACE.history.length, 0, 'oversized exchanges cannot overflow the conversation budget');
conversation.aiRememberTurn('private local question', 'local answer');
assert.equal(conversation.aiConversationPrompt('other model', { provider: 'openai' }), 'other model', 'history is not sent to a different provider');
conversation.aiRememberTurn('other question', 'other answer');
assert.equal(conversation.aiConversationPrompt('changed model', chatCfg), 'changed model');

// Test the real native adapter with both current and legacy helper controls.
let nativeInput, nativePanel, nativeToggle, drawerCloses = 0, toggles = 0, workspaceOpens = 0, routed = 0;
const nativeEvents = [];
const nativeAdapter = load(['openPerchanceAI', 'routeAgentToWorkspace'], between('function aiAgentButton(', '// ============================================================ bootstrap'), {
  $(selector) { return ({ '#aiAgentInputEl': nativeInput, '#aiHelperInputEl': nativeInput, '#aiAgentPanelEl': nativePanel, '#perchanceConsoleEl button[title="Switch to the AI helper"]': nativeToggle })[selector] || null; },
  aiConfig: () => ({ interceptAgent: true, provider: 'localai' }),
  closeDrawer() { drawerCloses++; }, toast() {},
  openWindow() { workspaceOpens++; }, aiAskWorkspace() { routed++; }, AI_WORKSPACE: { busy: false },
});
function makeNativeInput(value) {
  return { value, ownerDocument: { defaultView: { Event: class { constructor(type) { this.type = type; } } } },
    dispatchEvent(e) { nativeEvents.push(e.type); }, focus() {}, setSelectionRange() {}, scrollIntoView() {} };
}
nativeInput = makeNativeInput('My existing draft'); nativePanel = { hidden: true };
nativeToggle = { click() { toggles++; nativePanel.hidden = false; } };
assert.equal(nativeAdapter.openPerchanceAI('Repair findings'), true);
assert.equal(nativeInput.value, 'My existing draft\n\nRepair findings');
assert.equal(toggles, 1);
assert.deepEqual(nativeEvents, ['input', 'change']);
assert.equal(drawerCloses, 1);
nativeAdapter.openPerchanceAI('Repair findings');
assert.equal(nativeInput.value, 'My existing draft\n\nRepair findings', 'repeated handoff does not duplicate the report');
const sendEvent = { preventDefault() { throw new Error('native send must not be intercepted'); } };
assert.equal(nativeAdapter.routeAgentToWorkspace(sendEvent), false);
assert.equal(workspaceOpens, 0); assert.equal(routed, 0);
nativeInput.value = 'A different request';
nativeAdapter.routeAgentToWorkspace({ stopImmediatePropagation() {}, preventDefault() {} });
assert.equal(routed, 1, 'normal opt-in interception still works for other requests');
nativeInput = null;
assert.throws(() => nativeAdapter.openPerchanceAI('fix'), /input was not found/);
nativeInput = makeNativeInput(''); nativeInput.disabled = true;
assert.throws(() => nativeAdapter.openPerchanceAI('fix'), /unavailable/);
nativeInput.disabled = false; nativePanel.hidden = true; nativeToggle = null;
assert.throws(() => nativeAdapter.openPerchanceAI('fix'), /toggle was not found/);
nativePanel = null;
assert.equal(nativeAdapter.openPerchanceAI('legacy repair'), true, 'legacy helper without the new panel is supported');
assert.equal(nativeInput.value, 'legacy repair');

function findApply(n) {
  if (n.attrs.text === 'Apply to DSL') return n;
  for (const child of n.children) { const found = findApply(child); if (found) return found; }
}
state.response = '```dsl\nreplacement\n```';
runtime.renderAIReviewModal('dsl');
assert.equal(writes, 0, 'opening review must not write');
doc = 'new user edits';
findApply(roots.at(-1)).attrs.onclick();
assert.equal(writes, 0, 'stale diff must not overwrite newer edits');
runtime.renderAIReviewModal('dsl');
findApply(roots.at(-1)).attrs.onclick();
assert.equal(writes, 1, 'explicit apply on a fresh diff writes once');
assert.equal(doc, 'replacement');

let transport, adapterResult;
const adapter = load(['callOwnAI'], between('function callOwnAI(', '// ---- D3:'), {
  PROVIDERS: { localai: {
    noKey: true, defaultModel: 'test', defaultEndpoint: 'http://localhost:1234',
    body: () => '{}', url: () => 'http://localhost:1234/v1/chat/completions',
    headers: () => ({}), extract: (j) => j.choices[0].message.content,
  } },
  GM_xmlhttpRequest(options) { transport = options; return { abort() {} }; },
});
adapter.callOwnAI({ provider: 'localai' }, '', '', (err, text) => { adapterResult = { err, text }; });
transport.onload({ status: 200, responseText: JSON.stringify({
  choices: [{ message: { content: 'partial code' }, finish_reason: 'length' }],
}) });
assert.match(adapterResult.err, /incomplete/);
assert.equal(adapterResult.text, null);
transport.onload({ status: 200, responseText: JSON.stringify({
  choices: [{ message: { content: 'complete answer' }, finish_reason: 'stop' }],
}) });
assert.deepEqual(adapterResult, { err: null, text: 'complete answer' });

console.log('AI workspace extraction, cancellation, failure recovery, truncation, and stale-review tests passed');

// ---- providers, prompt caching, the Perchance primer and investigate mode ---------------------
const DevCore = require('../src/dev-core.js');
{
  const { PROVIDERS: PV } = load(['PROVIDERS'], between('  var PROVIDERS = {', 'function aiConfig('), {});
  assert.ok(PV.openrouter && PV.githubmodels, 'the new gateways are offered');
  assert.equal(PV.openrouter.url(), 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(PV.openrouter.headers('k').Authorization, 'Bearer k');
  const ob = JSON.parse(PV.openrouter.body('m', 'SYS', 'USER', false));
  assert.equal(ob.model, 'm'); assert.equal(ob.messages[0].role, 'system'); assert.equal(ob.messages[1].content, 'USER');
  assert.equal(PV.openrouter.extract({ choices: [{ message: { content: 'hi' } }] }), 'hi');
  assert.equal(PV.githubmodels.url(), 'https://models.github.ai/inference/chat/completions');
  const gh = PV.githubmodels.headers('tok');
  assert.equal(gh.Authorization, 'Bearer tok'); assert.equal(gh.Accept, 'application/vnd.github+json'); assert.ok(gh['X-GitHub-Api-Version']);
  assert.match(PV.githubmodels.defaultModel, /^[a-z]+\/[\w.-]+$/, 'GitHub Models ids look like publisher/model');
  assert.equal(PV.anthropic.defaultModel, 'claude-sonnet-5-5');
  assert.equal(JSON.parse(PV.openrouter.body('m', 's', 'u', true)).response_format.type, 'json_object');

  // cache split: Anthropic gets a cacheable block for big context; every other provider gets plain joined text
  const { aiUserForProvider: split, AI_CACHE_BREAK: BREAK } = load(['aiUserForProvider', 'AI_CACHE_BREAK'], between('var AI_CACHE_BREAK', '// ---- D3:'), {});
  const big = 'x'.repeat(5000), msg = big + BREAK + 'REQUEST: go';
  assert.equal(split('openai', msg), big + '\n\nREQUEST: go');
  assert.equal(split('localai', msg), big + '\n\nREQUEST: go');
  assert.equal(split('anthropic', 'small' + BREAK + 'REQUEST: go'), 'small\n\nREQUEST: go', 'too small to be worth caching');
  const blocks = split('anthropic', msg);
  assert.equal(blocks.length, 2); assert.equal(blocks[0].cache_control.type, 'ephemeral'); assert.equal(blocks[0].text, big); assert.equal(blocks[1].text, 'REQUEST: go');
  assert.equal(blocks[1].cache_control, undefined, 'only the stable context is cached, never the changing request');
  assert.equal(split('anthropic', 'no marker here'), 'no marker here');
  assert.equal(split('anthropic', ['already', 'blocks']).length, 2, 'non-string input passes through');

  // the primer is added to the system prompt unless switched off
  const sysCtx = { window: { WeldDevCore: DevCore } };
  const { aiWorkspaceSystem: sys } = load(['aiWorkspaceSystem'], between('function aiWorkspaceSystem(', "// The Project tab's loaded copy"), sysCtx);
  assert.match(sys({ instruction: '', usePrimer: true }), /PERCHANCE REFERENCE/);
  assert.match(sys({ instruction: 'Be terse.', usePrimer: true }), /^Be terse\.\n\nPERCHANCE REFERENCE/, 'custom instruction first, primer after');
  assert.doesNotMatch(sys({ instruction: 'Be terse.', usePrimer: false }), /PERCHANCE REFERENCE/);
  assert.equal(sys({ instruction: 'x' }).includes('PERCHANCE REFERENCE'), true, 'on unless explicitly disabled');
  assert.equal(load(['aiWorkspaceSystem'], between('function aiWorkspaceSystem(', "// The Project tab's loaded copy"), {}).aiWorkspaceSystem({ instruction: 'only this' }), 'only this', 'no module, no primer, no crash');

  // context first, request last, with the cache marker between them
  const userCtx = { AI_CACHE_BREAK: BREAK, dslView: () => ({}), htmlView: () => null, viewText: () => 'output\n  hi', isCmView: () => false, window: {} };
  const { aiWorkspaceUser: user } = load(['aiWorkspaceUser'], between('function aiProjectSource(', 'function refreshAIWorkspace('), userCtx);
  assert.equal(user('just a question', 'none'), 'REQUEST:\njust a question', 'no context, no marker');
  const full = user('fix it', 'dsl');
  assert.ok(full.indexOf('CURRENT PERCHANCE DSL') < full.indexOf(BREAK) && full.indexOf(BREAK) < full.indexOf('REQUEST:\nfix it'), 'context, marker, request');
  assert.ok(full.endsWith('REQUEST:\nfix it'));
}
(async () => {
  // Native reply copying uses the reply body, keeps formatting, and reports real clipboard failures.
  let copied = '', clipboardMode = 'ok', fallbackOk = true, latestReply = 'First paragraph\n\nSecond paragraph\n  code';
  const copyNotices = [], replyButtons = [];
  let copyField;
  const reply = {
    textContent: 'reply',
    get innerText() { return latestReply + replyButtons.filter(b => b.style.display !== 'none').map(() => '\nCopy reply').join(''); },
    querySelector() { return replyButtons[0] || null; },
    querySelectorAll() { return replyButtons; },
    appendChild(b) { replyButtons.push(b); }
  };
  const clipboardHost = {
    navigator: { clipboard: { writeText(text) { return clipboardMode === 'ok' ? (copied = text, Promise.resolve()) : Promise.reject(new Error('denied')); } } },
    document: { activeElement: { focus() {} }, body: { appendChild(ta) { copyField = ta; } }, execCommand() { if (fallbackOk) copied = copyField.value; return fallbackOk; } },
    toast(text) { copyNotices.push(text); },
    el(tag, attrs) { return { attrs, style: attrs?.style || {}, select() {}, remove() {} }; },
    $(selector) { return selector === '#aiAgentMsgsEl' ? { querySelectorAll() { return [reply]; } } : null; },
  };
  const nativeCopy = load(['copyText', 'enhanceNativeAIReplies', 'nativeAIReplyText'],
    between('function copyText(', 'function download(') + between('function nativeAIReplyText(', 'var AI_NATIVE_DRAFT'), clipboardHost);
  nativeCopy.enhanceNativeAIReplies(); nativeCopy.enhanceNativeAIReplies();
  assert.equal(replyButtons.length, 1, 'enhancing an existing reply adds no duplicate buttons');
  replyButtons[0].attrs.onclick({ stopPropagation() {} }); await Promise.resolve();
  assert.equal(copied, latestReply, 'copy contains only the reply, preserving paragraphs and code');
  latestReply = 'Updated streaming reply ending with Copy reply';
  assert.equal(nativeCopy.nativeAIReplyText(reply), latestReply, 'a literal Copy reply in the answer is preserved');
  assert.equal(replyButtons[0].style.display, 'block', 'copy restores button visibility');
  clipboardMode = 'denied';
  assert.equal(await nativeCopy.copyText('fallback reply'), true);
  assert.equal(copied, 'fallback reply');
  fallbackOk = false; copyNotices.length = 0;
  assert.equal(await nativeCopy.copyText('cannot copy'), false);
  assert.ok(copyNotices.every(n => n !== 'Copied'), 'a denied clipboard must never report fake success');
  assert.match(copyNotices.at(-1), /Copy failed/);
  console.log('Native AI reply controls, formatting, streaming updates and clipboard fallback tests passed');
  // investigate mode: the model asks for a lookup, gets the real answer, then replies
  const seen = []; let n = 0, aborted = 0;
  const iw = load(['AI_WORKSPACE', 'aiAskWorkspace', 'aiStopWorkspace'], between('var AI_WORKSPACE =', 'function renderAI(body)'), {
    aiConfig: () => ({ provider: 'localai', maxTokens: 4096, usePrimer: true }),
    PROVIDERS: { localai: { label: 'Local' } }, WC_TAB: null, $: () => null, toast() {},
    dslView: () => ({}), htmlView: () => null, viewText: () => 'output\n  [a]\na\n  x\n  y\n', isCmView: () => false,
    AI_CACHE_BREAK: '\n<<<weld-cache-break>>>\n',
    window: { WeldDevCore: DevCore, weldProject: { current: () => ({ name: 'zoo', dsl: 'output\n  [a]\na\n  x\n  y\n', html: null, deps: null }) } },
    callOwnAI(cfg, sys, user, cb) {
      seen.push({ sys, user }); n++;
      const reply = n === 1 ? '```weld-tool\n{"tool":"get_outline"}\n```' : 'The list "a" has 2 items.';
      const t = setTimeout(() => cb(null, reply), 5);
      return { abort() { aborted++; clearTimeout(t); } };
    },
  });
  const st = iw.AI_WORKSPACE; st.prompt = 'how big is a?'; st.context = 'none'; st.investigate = true;
  assert.equal(iw.aiAskWorkspace(), true);
  for (let i = 0; i < 200 && st.busy; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(st.response, 'The list "a" has 2 items.');
  assert.equal(seen.length, 2, 'one lookup round, then the answer');
  assert.match(seen[0].sys, /weld-tool/); assert.match(seen[0].sys, /PERCHANCE REFERENCE/);
  assert.match(seen[1].user, /RESULT of get_outline/); assert.match(seen[1].user, /"name": "a"/);
  assert.match(st.status, /Reply ready for review/);
  // stopping mid-investigation aborts the request and ignores the late reply
  n = 0; seen.length = 0; st.response = ''; st.prompt = 'again';
  iw.aiAskWorkspace(); await new Promise((r) => setTimeout(r, 1)); iw.aiStopWorkspace(false);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(aborted >= 1, true); assert.equal(st.response, '', 'a late reply after Stop is discarded');
  // investigate falls back to a plain request when nothing is loaded
  st.investigate = true; n = 5; seen.length = 0; st.prompt = 'plain';
  const iw2 = load(['AI_WORKSPACE', 'aiAskWorkspace'], between('var AI_WORKSPACE =', 'function renderAI(body)'), {
    aiConfig: () => ({ provider: 'localai', maxTokens: 4096, usePrimer: false }), PROVIDERS: { localai: { label: 'Local' } }, WC_TAB: null, $: () => null, toast() {},
    dslView: () => null, htmlView: () => null, viewText: () => '', isCmView: () => false, AI_CACHE_BREAK: '\n\n',
    window: { WeldDevCore: DevCore, weldProject: { current: () => null } },
    callOwnAI(cfg, sys, user, cb) { seen.push({ sys, user }); setTimeout(() => cb(null, 'ok'), 1); return { abort() {} }; },
  });
  iw2.AI_WORKSPACE.investigate = true; iw2.AI_WORKSPACE.prompt = 'plain'; iw2.AI_WORKSPACE.context = 'none'; iw2.aiAskWorkspace();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(seen.length, 1); assert.doesNotMatch(seen[0].sys, /weld-tool/, 'no lookups offered when there is nothing to look at');
  console.log('AI providers, prompt caching, Perchance primer and investigate mode tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
