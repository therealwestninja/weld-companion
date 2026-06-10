// ==UserScript==
// @name         Weld Companion for Perchance
// @namespace    https://github.com/therealwestninja/weld
// @version      1.34.0
// @description  Quality-of-life upgrades for Perchance: favorites & recently-used, theme/reading comfort, save/copy/pin results, result history (undo-reroll), resizable inputs, generator folder management & CRUD, and an AI Helper you can edit or point at your own GPT (OpenAI / Anthropic / Google). All local, account-free. Companion to the Weld plugin suite; plus a federated Data Manager, an AICC pack (Lore Library, character round-trip, repair & recovery with quarantine), a Tools tab (AI Helper, character files), and a Library tab for readers (Scrapbook, chat story export, backup guardian, night light, read-aloud).
// @author       therealwestninja
// @match        https://perchance.org/*
// @match        https://*.perchance.org/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        unsafeWindow
// @grant        GM_registerMenuCommand
// @connect      api.openai.com
// @connect      api.anthropic.com
// @connect      generativelanguage.googleapis.com
// @connect      api.duckduckgo.com
// @connect      perchance.org
// @connect      raw.githubusercontent.com
// @connect      api.github.com
// @connect      editor-copilot.perchance.org
// @connect      *
// @run-at       document-idle
// ==/UserScript==

/*
  Weld Companion
  --------------
  A single userscript that adds the things Perchance leaves out for users and
  authors alike. Everything is feature-detected: Perchance's internals
  (window.modelTextEditor, saveGenerator, the /api/* endpoints, the AI-helper
  DOM) are NOT a documented API, so each module checks for what it needs and
  silently no-ops when it is absent. Nothing here replaces a Perchance built-in;
  it only fills gaps. All user data lives in GM storage (local to this browser).

  Modules:
    A. storage + tiny utils
    B. favorites & recently-used  (+ a "/" command palette launcher)
    C. theme / reading comfort    (per-generator, remembered)
    D. result tools               (copy / save / pin / compare)
    E. result history             (undo-reroll: back/forward through outputs)
    F. resizable inputs           (drag handle + fullscreen on textareas)
    G. generator management       (folder sort/filter + CRUD shortcuts)
    H. AI provider layer          (edit the Helper, or use your own GPT)
*/

(function () {
  'use strict';

  // Top-frame only. With @noframes removed (so the Data Manager agent can run inside
  // generator sandbox frames), every existing module below must stay in the top frame.
  if (window.top !== window) return;

  // ============================================================ A. storage + utils
  var NS = 'weldCompanion';
  function gget(key, dflt) {
    try { var v = GM_getValue(NS + ':' + key, undefined); return v === undefined ? dflt : JSON.parse(v); }
    catch (e) { return dflt; }
  }
  function gset(key, val) {
    try { GM_setValue(NS + ':' + key, JSON.stringify(val)); return true; } catch (e) { return false; }
  }
  function gdel(key) { try { GM_deleteValue(NS + ':' + key); } catch (e) {} }

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'style' && typeof attrs[k] === 'object') { for (var s in attrs[k]) n.style[s] = attrs[k][s]; }
      else if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function debounce(fn, ms) { var t; return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); }; }
  function genName() { return (window.generatorName || (location.pathname.replace(/^\//, '').split('/')[0]) || '').trim(); }
  // ============================================================ G. GitHub updater
  // Pull a generator's source from a GitHub repo (DSL.txt / HTML.txt layout) straight
  // into the CodeMirror 6 editor panes; the user saves manually. Evidence (field probe
  // on #edit): two .cm-content panes -- [0] DSL/top-panel, [1] HTML-panel.
  //
  // Mapping resolves per generator SLUG: global defaults (owner/repo/branch + path
  // templates, {name} = slug) overlaid with an optional per-slug override map, so a
  // generator whose Perchance slug does NOT match its GitHub file names (e.g. a random
  // slug like /fr5y67ygfde456...) can be re-pointed at the right files by hand.
  var GH_DEFAULTS = {
    owner: '', repo: '', branch: 'main',
    dslPath: '{name}/{name}-top-panel.txt', htmlPath: '{name}/{name}-html-panel.html'
  };
  function ghCfg() { var c = gget('github', {}) || {}; var o = {}; for (var k in GH_DEFAULTS) o[k] = (c[k] != null && c[k] !== '') ? c[k] : GH_DEFAULTS[k]; return o; }
  function ghRawUrl(cfg, tpl, name) {
    var path = String(tpl).replace(/\{name\}/g, name);
    return 'https://raw.githubusercontent.com/' + cfg.owner + '/' + cfg.repo + '/refs/heads/' + cfg.branch + '/' + path + '?_=' + Date.now();
  }
  // Parse a GitHub file URL into { owner, repo, branch, path }. Accepts raw URLs
  // (raw.githubusercontent.com, with or without the /refs/heads/ segment) and web
  // URLs (github.com/.../blob|tree|raw/...). Query/hash are stripped. Returns null
  // when the string isn't a recognizable GitHub URL (e.g. a plain path).
  function parseGitHubUrl(u) {
    u = String(u || '').trim();
    if (!/^https?:\/\//i.test(u)) return null;
    u = u.split('#')[0].split('?')[0];
    var m = u.match(/^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/refs\/heads\/([^/]+)\/(.+)$/i);
    if (m) return { owner: m[1], repo: m[2], branch: m[3], path: m[4] };
    m = u.match(/^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/i);
    if (m) return { owner: m[1], repo: m[2], branch: m[3], path: m[4] };
    m = u.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|tree|raw)\/([^/]+)\/(.+)$/i);
    if (m) return { owner: m[1], repo: m[2], branch: m[3], path: m[4] };
    m = u.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/i);
    if (m) return { owner: m[1], repo: m[2], branch: '', path: '' };
    return null;
  }
  // global defaults overlaid with per-slug override from the 'githubMap' config
  // ({ slug: { dslPath, htmlPath, owner?, repo?, branch? } }).
  function ghResolve(name) {
    var base = ghCfg(), map = gget('githubMap', {}) || {}, ov = map[name] || {};
    var cfg = {
      owner: ov.owner || base.owner, repo: ov.repo || base.repo, branch: ov.branch || base.branch,
      dslPath: ov.dslPath || base.dslPath, htmlPath: ov.htmlPath || base.htmlPath
    };
    return { cfg: cfg, overridden: !!map[name], dslUrl: ghRawUrl(cfg, cfg.dslPath, name), htmlUrl: ghRawUrl(cfg, cfg.htmlPath, name) };
  }
  function ghFetch(url, cb) {
    try {
      GM_xmlhttpRequest({
        method: 'GET', url: url,
        onload: function (r) { cb((r.status >= 200 && r.status < 300) ? null : ('HTTP ' + r.status), r.responseText || ''); },
        onerror: function () { cb('network error', ''); },
        ontimeout: function () { cb('timeout', ''); }
      });
    } catch (e) { cb(String((e && e.message) || e), ''); }
  }
  function cmText(elx) { try { return (elx.innerText || elx.textContent || ''); } catch (e) { return ''; } }
  // Drive CM6's own input pipeline: synthetic paste first (CM6 reads clipboardData and
  // preventDefaults), then execCommand insertText as a fallback. Returns which fired.
  // Resolve the live CodeMirror 6 EditorView behind a .cm-content element.
  function isCmView(v) { try { return !!(v && v.state && v.state.doc && typeof v.dispatch === 'function'); } catch (e) { return false; } }
  function cmViewFor(elx) {
    try { var v = elx && elx.cmView && elx.cmView.view; if (isCmView(v)) return v; } catch (e) {}
    // Fallback: match the element against Perchance's exposed view maps.
    try { var maps = window.editorViewsByDocId || {}; for (var k in maps) { var arr = maps[k]; if (arr) for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].contentDOM === elx && isCmView(arr[i])) return arr[i]; } } catch (e) {}
    return null;
  }
  // Canonical pane resolver. The editor exposes its live CM6 EditorViews on
  // window.docIdToView[docId] and window.editorViewsByDocId[docId][...] (docId is
  // "modelText" = DSL/top panel, "outputTemplate" = HTML panel) -- the source of
  // truth. Prefer those, then the legacy named globals, then null. Reads/writes go
  // through the universal CM6 API (state.doc + dispatch), which every EditorView
  // has, rather than the view-specific getValue/setValue -- so a mapped raw view
  // works too. A write via dispatch is recorded in the editor's own undo history.
  function viewForDocId(docId) {
    try { var v = window.docIdToView && window.docIdToView[docId]; if (isCmView(v) && !v.destroyed) return v; } catch (e) {}
    try { var arr = window.editorViewsByDocId && window.editorViewsByDocId[docId]; if (arr) for (var i = 0; i < arr.length; i++) if (isCmView(arr[i]) && !arr[i].destroyed) return arr[i]; } catch (e) {}
    var named = docId === 'modelText' ? window.modelTextEditor : (docId === 'outputTemplate' ? window.outputTemplateEditor : null);
    return isCmView(named) ? named : null;
  }
  function dslView()  { return viewForDocId('modelText'); }
  function htmlView() { return viewForDocId('outputTemplate'); }
  function viewText(v) { try { return isCmView(v) ? v.state.doc.toString() : ''; } catch (e) { return ''; } }
  function viewSet(v, text) { try { if (isCmView(v)) { v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: String(text) } }); return true; } } catch (e) {} return false; }

  // ---- snippet inserter (drops boilerplate at the cursor in the matching pane) ----
  // Uses CM6's state.replaceSelection (canonical insert-at-cursor); manual change as fallback.
  function insertAtCursor(view, text) {
    if (!isCmView(view)) return false;
    text = String(text);
    try {
      view.focus();
      if (typeof view.state.replaceSelection === 'function') { view.dispatch(view.state.replaceSelection(text)); return true; }
      var sel = view.state.selection.main;
      view.dispatch({ changes: { from: sel.from, to: sel.to, insert: text }, selection: { anchor: sel.from + text.length } });
      return true;
    } catch (e) { return false; }
  }
  // Snippet content is grounded in the perchance-api notes + the real weld-* import stack
  // (not invented). DSL snippets target the top panel; 'html' snippets the HTML-panel JS.
  var SNIPPETS = [
    { id: 'meta', pane: 'dsl', label: '$meta block', desc: 'title / description / tags',
      text: ['$meta', '  title = ', '  description = ', '  tags = ', ''].join('\n') },
    { id: 'imports-core', pane: 'dsl', label: 'Core plugin imports', desc: 'ai-text, text-to-image, upload, super-fetch',
      text: ['aiTextPlugin      = {import:ai-text-plugin}', 'textToImagePlugin = {import:text-to-image-plugin}', 'uploadPlugin      = {import:upload-plugin}', 'superFetch        = {import:super-fetch-plugin}', ''].join('\n') },
    { id: 'imports-weld', pane: 'dsl', label: 'Weld import stack', desc: 'common weld-* plugins',
      text: ['weldUi       = {import:weld-ui-plugin}', 'weldState    = {import:weld-state-plugin}', 'weldToast    = {import:weld-toast-plugin}', 'weldStream   = {import:weld-stream-plugin}', 'weldMarkdown = {import:weld-markdown-plugin}', ''].join('\n') },
    { id: 'import-superfetch', pane: 'dsl', label: 'super-fetch import', desc: 'CORS proxy plugin only',
      text: 'superFetch = {import:super-fetch-plugin}\n' },
    { id: 'meta-dynamic', pane: 'dsl', label: '$meta.dynamic', desc: 'self-contained dynamic title/description',
      text: ['$meta', '  header', '    mode = minimal', '  async dynamic(inputs) =>', '    // must be fully self-contained -- no root.*, no external globals', '    return { title: "...", description: "..." }', ''].join('\n') },
    { id: 'grab', pane: 'html', label: 'grab() helper', desc: 'defensive plugin access (Proxy-safe)',
      text: ['// defensive plugin access -- handles Proxy miss + load race', 'function grab(name) {', '  try { if (typeof root !== "undefined" && root[name] !== undefined) return root[name]; } catch (e) {}', '  try { if (window[name] !== undefined) return window[name]; } catch (e) {}', '  return undefined;', '}', ''].join('\n') },
    { id: 'ai-call', pane: 'html', label: 'aiTextPlugin call', desc: 'non-streaming generation',
      text: ['const result = await root.aiTextPlugin({', '  instruction:   "System prompt / task",', '  startWith:     "",', '  stopSequences: ["\\n\\n[[", "\\n[["],', '  hideStartWith: true', '});', 'const text = String(result);            // boxed String -> primitive', 'if (result.stopReason === "error") { /* generatedText is "" */ }', ''].join('\n') },
    { id: 'ai-stream', pane: 'html', label: 'aiTextPlugin stream', desc: 'streaming with onChunk',
      text: ['const stream = root.aiTextPlugin({', '  instruction: "...",', '  stopSequences: ["\\n\\n[[", "\\n[["],', '  hideStartWith: true,', '  onChunk: function (o) {', '    if (o.isFromStartWith) return;', '    /* o.textChunk, o.fullTextSoFar */', '  }', '});', 'const result = await stream;            // stream.stop() to abort', 'const text = String(result);', ''].join('\n') },
    { id: 'superfetch-call', pane: 'html', label: 'superFetch call', desc: 'CORS-bypass fetch (auth in URL)',
      text: ['// auth via URL params -- custom headers are stripped by the proxy', 'const r = await root.superFetch("https://api.example.com/data?_=" + Date.now());', 'const text = await r.text();', ''].join('\n') },
    { id: 't2i-call', pane: 'html', label: 'textToImagePlugin call', desc: 'image gen (await -> dataUrl)',
      text: ['// resolution MUST be one of: 512x512, 512x768, 768x512, 768x768 (others give a 0x0 canvas).', '// weights: use parens like (red:1.5) -- square brackets are eaten by the DSL layer.', '// an empty or inline-only prompt HANGS forever -- always pass real description text.', 'const result = root.textToImagePlugin({', '  prompt:        "a red apple on a wooden table",', '  resolution:    "768x768",', '  guidanceScale: 7', '});', 'const data = await result;        // resolves with canvas, dataUrl, inputs (no iframe key)', 'img.src = String(data.dataUrl);   // String() any boxed values before use', ''].join('\n') },
    { id: 'upload-call', pane: 'html', label: 'uploadPlugin call', desc: 'upload a blob (url is boxed)',
      text: ['// result.url is a BOXED String -- always String() it before compare/use.', 'const result = await root.uploadPlugin(blob);     // blob up to 5 MB', 'if (result.error) {', '  // "disallowed_content" -> make the description explicitly state the subject is 18+', '} else {', '  const url = String(result.url);', '  // result.deletionUrl (undocumented): GET it to permanently delete the upload.', '}', ''].join('\n') },
    { id: 'image-hint', pane: 'html', label: '<image> tag hint', desc: 'reliably trigger image output',
      text: ['// The model emits images reliably only when told about the tag (see skill section 17).', 'const IMAGE_TAG_HINT =', '  "You can embed an AI-generated image using this exact syntax: " +', '  "<image>a detailed description of the scene</image> -- the text inside the tag is " +', '  "used to generate a real image. Use it when the user asks for one or it would help.";', '// Append IMAGE_TAG_HINT to your aiTextPlugin instruction when images should be available.', ''].join('\n') },
    { id: 'imports-data', pane: 'dsl', label: 'Data / persistence imports', desc: 'kv, remember, url-params',
      text: ['kv        = {import:kv-plugin}', 'remember  = {import:remember-plugin}', 'urlParams = {import:url-params-plugin}', ''].join('\n') },
    { id: 'kv-usage', pane: 'html', label: 'kv-plugin usage', desc: 'durable async key-value store',
      text: ['// kv-plugin: durable async key-value store. Import kv-plugin in the DSL panel first.', '// Each store name is its own IndexedDB; data persists across reloads.', 'await kv.scores.set("user42", { score: 100, level: 3 });', 'const rec = await kv.scores.get("user42");   // the stored value, or undefined', 'const all = await kv.scores.entries();        // [[key, value], ...]', '// also: .has(key) .keys() .values() .delete(key) .update(key, fn) .clear()', ''].join('\n') }
  ];
  function snippetById(id) { for (var i = 0; i < SNIPPETS.length; i++) if (SNIPPETS[i].id === id) return SNIPPETS[i]; return null; }
  function insertSnippet(snip) {
    if (!snip) return false;
    var v = (snip.pane === 'html') ? htmlView() : dslView();
    var paneName = (snip.pane === 'html') ? 'HTML panel' : 'DSL (top) panel';
    if (!isCmView(v)) { toast('Open a generator\u2019s #edit page first'); return false; }
    var ok = insertAtCursor(v, snip.text);
    toast(ok ? ('Inserted into ' + paneName + ': ' + snip.label) : 'Insert failed');
    return ok;
  }

  // ---- JS lint (reuse Perchance's own ESLint + htmlparser2) --------------------
  // Perchance lazily loads eslint-linter-browserify + htmlparser2 and leaves a
  // Linter per pane on window.eslintInstances and the parser on window.htmlparser2.
  // We reuse those (no second download): pull the <script> regions out of the HTML
  // pane the same way the editor does, and Linter.verify() each with rules:{} ->
  // pure syntax-error checking, no style nags. Extraction + offset math validated
  // against the real bundles before shipping. Fails open (returns []) if the libs
  // aren't up yet, so a save/push is never wrongly blocked.
  function lintLibs() {
    try { if (window.eslintInstances && window.eslintInstances.outputTemplate && window.htmlparser2 && window.htmlparser2.Parser) return { linter: window.eslintInstances.outputTemplate, ParserCls: window.htmlparser2.Parser }; } catch (e) {}
    return null;
  }
  function lintLineOf(s, idx) { var n = 1; for (var i = 0; i < idx && i < s.length; i++) if (s.charCodeAt(i) === 10) n++; return n; }
  function extractJsRegions(html, ParserCls) {
    var out = [], inScript = false, type = '', start = 0, p;
    p = new ParserCls({
      onopentag: function (name, attrs) {
        if (name !== 'script') return;
        var t = ((attrs && attrs.type) || '').toLowerCase();
        if (t && !/^(text\/javascript|application\/javascript|module)$/.test(t)) { inScript = false; return; }  // skip JSON / template scripts
        inScript = true; type = (t === 'module') ? 'module' : 'script'; start = p.endIndex + 1;
        if (html.charCodeAt(start) === 13) start++;   // skip one leading \r
        if (html.charCodeAt(start) === 10) start++;   // and \n, so a region starts at its first real line
      },
      onclosetag: function (name) {
        if (name !== 'script' || !inScript) return;
        var code = html.slice(start, p.startIndex);
        if (code.trim()) out.push({ code: code, from: start, sourceType: type, startLine: lintLineOf(html, start) });
        inScript = false;
      }
    }, { recognizeSelfClosing: true });
    p.write(html); p.end();
    return out;
  }
  // Lint the HTML pane's <script> blocks. Returns [{line,col,message,sev,ruleId}]
  // with line numbers mapped to the pane. (modelText {...} JS-block linting needs
  // the DSL-aware block ranges Perchance computes internally -- deferred.)
  // Static scan for Perchance parser traps the JS linter cannot see: the engine evaluates
  // {..}/[..] template patterns in the raw HTML-panel source (including <script>) BEFORE JS
  // runs, and decodes HTML entities first. These pass JS parsing but break silently at runtime.
  function perchanceTraps(code) {
    var rules = [
      { re: /\\u\{/g, msg: 'Perchance trap: a unicode brace-escape -- the parser reads the brace expression as a template. Use a surrogate pair or String.fromCodePoint() instead.' },
      { re: /\{import:/g, msg: 'Perchance trap: an import pattern in panel code is parsed as a plugin import. Escape the braces or build the string at runtime.' },
      { re: /&#(?:x0*7b|123|x0*5b|91);/gi, msg: 'Perchance trap: a brace or bracket HTML entity -- entities are decoded before scanning, so this still triggers. Construct the character at runtime.' }
    ];
    var out = [], i, m;
    for (i = 0; i < rules.length; i++) {
      rules[i].re.lastIndex = 0;
      while ((m = rules[i].re.exec(code)) !== null) {
        out.push({ lineOffset: code.slice(0, m.index).split('\n').length, message: rules[i].msg });
        if (m.index === rules[i].re.lastIndex) rules[i].re.lastIndex++;
      }
    }
    return out;
  }

  function lintHtmlScripts() {
    var libs = lintLibs(), hv = htmlView(); if (!libs || !hv) return [];
    var html = viewText(hv); if (!html) return [];
    var out = [], regions; try { regions = extractJsRegions(html, libs.ParserCls); } catch (e) { return []; }
    for (var i = 0; i < regions.length; i++) {
      var reg = regions[i], cfg = { languageOptions: { globals: {}, parserOptions: { ecmaVersion: 2022, sourceType: reg.sourceType } }, rules: {} }, msgs;
      try { msgs = libs.linter.verify(reg.code, cfg); } catch (e) { continue; }
      for (var j = 0; j < msgs.length; j++) { var m = msgs[j]; out.push({ line: reg.startLine + (m.line || 1) - 1, col: m.column || 1, message: m.message, sev: m.severity, ruleId: m.ruleId }); }
      var traps = perchanceTraps(reg.code);
      for (var t = 0; t < traps.length; t++) out.push({ line: reg.startLine + traps[t].lineOffset - 1, col: 1, message: traps[t].message, sev: 1, ruleId: 'perchance-trap' });
    }
    return out;
  }
  function fmtLintProb(p) { return '\u2022 line ' + p.line + (p.col ? (':' + p.col) : '') + ' \u2014 ' + p.message; }
  function confirmLint(action, probs) {
    console.warn('[weld lint]', probs);
    var lines = probs.slice(0, 8).map(fmtLintProb).join('\n');
    var more = probs.length > 8 ? ('\n\u2026 and ' + (probs.length - 8) + ' more (see console)') : '';
    return confirm(action + ': ' + probs.length + ' problem(s) in the HTML pane:\n\n' + lines + more + '\n\nProceed with ' + action + ' anyway?');
  }
  function lintNow() {
    if (!lintLibs()) { toast('Lint unavailable \u2014 open the editor so Perchance loads its linter, then retry'); return; }
    var p = lintHtmlScripts();
    if (!p.length) { toast('\u2713 No problems in the HTML pane'); return; }
    console.warn('[weld lint]', p);
    alert('Problems in the HTML pane (' + p.length + '):\n\n' + p.slice(0, 20).map(fmtLintProb).join('\n') + (p.length > 20 ? '\n\u2026 and ' + (p.length - 20) + ' more (see console)' : ''));
  }

  // ---- AI bug-check: Perchance's own editor copilot, creds-free ----
  // POST {code, contentType, generatorName} to editor-copilot; no sessionToken/email
  // in the body (confirmed). The response SHAPE was never captured, so we parse
  // defensively across plausible containers and always log the raw body — a real
  // run then lets us tighten this. Cookies are sent (default) to match the page.
  function activeEditorPane() {
    var d = dslView(), h = htmlView();
    try { if (h && h.hasFocus) return { v: h, docId: 'outputTemplate', name: 'HTML panel' }; } catch (e) {}
    try { if (d && d.hasFocus) return { v: d, docId: 'modelText', name: 'DSL (top) panel' }; } catch (e) {}
    if (d) return { v: d, docId: 'modelText', name: 'DSL (top) panel' };
    if (h) return { v: h, docId: 'outputTemplate', name: 'HTML panel' };
    return null;
  }
  function bugItems(data) {
    if (data == null) return null;
    var arr = Array.isArray(data) ? data
            : Array.isArray(data.bugs) ? data.bugs
            : Array.isArray(data.issues) ? data.issues
            : Array.isArray(data.results) ? data.results
            : Array.isArray(data.problems) ? data.problems
            : null;
    if (arr) {
      return arr.map(function (it) {
        if (it == null) return { line: null, message: '' };
        if (typeof it === 'string') return { line: null, message: it };
        var line = (it.line != null) ? it.line
                 : (it.lineNumber != null) ? it.lineNumber
                 : (it.from && it.from.line != null) ? it.from.line : null;
        var msg = it.explanation || it.message || it.description || it.snippet || JSON.stringify(it);
        return { line: line, message: String(msg) };
      });
    }
    if (typeof data === 'string') return data.trim() ? [{ line: null, message: data }] : [];
    if (typeof data.text === 'string') return data.text.trim() ? [{ line: null, message: data.text }] : [];
    if (typeof data.result === 'string') return data.result.trim() ? [{ line: null, message: data.result }] : [];
    if (data.bugs === false || data.hasBugs === false || data.ok === true) return [];
    return null;   // unknown -> caller shows raw so we can tighten the parser
  }
  function handleBugCheck(res, paneName) {
    var raw = (res && res.responseText) || '';
    if (window.console) console.log('[weld bug-check] HTTP', res && res.status, 'raw:', raw);
    if (!res || res.status < 200 || res.status >= 300) { toast('Bug check: HTTP ' + (res && res.status) + ' (see console)'); return; }
    var data = null; try { data = JSON.parse(raw); } catch (e) {}
    var items = (data == null) ? null : bugItems(data);
    if (items === null) { alert('AI review of the ' + paneName + ' \u2014 unrecognized response (logged to console):\n\n' + raw.slice(0, 1200)); return; }
    if (!items.length) { toast('\u2713 AI found no bugs in the ' + paneName); return; }
    var lines = items.slice(0, 12).map(function (b) { return '\u2022 ' + (b.line != null ? ('line ' + b.line + ' \u2014 ') : '') + b.message; }).join('\n');
    var more = items.length > 12 ? ('\n\u2026 and ' + (items.length - 12) + ' more (see console)') : '';
    alert('AI review of the ' + paneName + ' \u2014 ' + items.length + ' note(s):\n\n' + lines + more);
  }
  function aiBugCheck() {
    var a = activeEditorPane();
    if (!a) { toast('Open a generator\u2019s #edit page first'); return; }
    var code = viewText(a.v);
    if (!code.trim()) { toast('That pane is empty'); return; }
    toast('Asking Perchance\u2019s AI to review the ' + a.name + '\u2026');
    try {
      GM_xmlhttpRequest({
        method: 'POST', url: 'https://editor-copilot.perchance.org/api/findBugsInCode',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ code: code, contentType: a.docId, generatorName: genName() || '' }),
        timeout: 30000,
        onload: function (res) { handleBugCheck(res, a.name); },
        onerror: function () { toast('Bug check failed (network)'); },
        ontimeout: function () { toast('Bug check timed out'); }
      });
    } catch (e) { toast('Bug check error: ' + ((e && e.message) || e)); }
  }

  // Write text into a CM6 pane. Primary: a real EditorView transaction -- reliable, and
  // recorded in the editor's own undo history, so Ctrl+Z reverts a pull. Fallbacks: a
  // synthetic paste, then execCommand, for any build that doesn't expose the view.
  function cmSet(elx, text) {
    var view = cmViewFor(elx);
    if (view) { try { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: String(text) } }); return 'view'; } catch (e) {} }
    elx.focus();
    function selectAll() { try { var s = window.getSelection(), r = document.createRange(); r.selectNodeContents(elx); s.removeAllRanges(); s.addRange(r); } catch (e) {} }
    selectAll();
    try {
      var dt = new DataTransfer(); dt.setData('text/plain', text);
      var ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      elx.dispatchEvent(ev);
      if (ev.defaultPrevented) return 'paste';
    } catch (e) {}
    try { selectAll(); if (document.execCommand('insertText', false, text)) return 'execCommand'; } catch (e) {}
    return 'failed';
  }
  function ghPanes() {
    // Prefer Perchance's canonical views (docId maps), then named globals, then DOM scan.
    var mt = dslView(), ot = htmlView();
    if (mt && mt.contentDOM && ot && ot.contentDOM) return { dsl: mt.contentDOM, html: ot.contentDOM, all: [mt.contentDOM, ot.contentDOM] };
    var panes = Array.prototype.slice.call(document.querySelectorAll('.cm-content'));
    if (panes.length < 2) return null;
    var dsl = null, html = null;
    panes.forEach(function (p) {
      var t = cmText(p).replace(/^\s+/, '');
      if (t.charAt(0) === '<') { if (!html) html = p; }
      else if (!dsl) dsl = p;
    });
    if (!dsl) dsl = panes[0];
    if (!html) html = (panes[1] === dsl ? panes[0] : panes[1]);
    return { dsl: dsl, html: html, all: panes };
  }
  // Perchance's own backup hooks (confirmed via probe on the #edit page):
  //   window.downloadLocalBackup(i)  -- downloads an EXISTING backup at index i in
  //     localBackupsArray (NOT a current-source snapshot), so we roll our own below.
  //   window.revisionsModal.openModal()  -- opens Perchance's revision history modal.
  function findRevButton() {
    var els = document.querySelectorAll('button, a, [role="button"]');
    for (var i = 0; i < els.length; i++) {
      var t = (els[i].textContent || '').trim().toLowerCase();
      if (t.length < 40 && /load backup\/revision history|revision history/.test(t)) return els[i];
    }
    return null;
  }
  function openRevisions() {
    if (window.revisionsModal && typeof window.revisionsModal.openModal === 'function') { try { window.revisionsModal.openModal(); return; } catch (e) {} }
    var btn = findRevButton();
    if (btn) { try { btn.click(); return; } catch (e) {} }
    toast('Perchance revision history not found here');
  }
  // ---- backup browser ---------------------------------------------------------
  // Perchance keeps local editor backups in window.kv.localBackups (an idb-keyval
  // Proxy), keyed by generator name, newest first; each entry is
  // {modelText, outputTemplate, time}. Perchance only DOWNLOADS them -- we add a
  // browsable list plus RESTORE-into-editor (via the same pane writer Pull uses,
  // so it's Ctrl+Z-undoable). All local; no credentials, no network.
  function pageKv() { return window.kv || (typeof unsafeWindow !== 'undefined' && unsafeWindow && unsafeWindow.kv) || null; }
  function loadBackups(name, cb) {
    var kv = pageKv();
    if (!kv || !kv.localBackups || typeof kv.localBackups.get !== 'function') { cb(new Error('no-store')); return; }
    try {
      var p = kv.localBackups.get(name);
      if (p && typeof p.then === 'function') p.then(function (a) { cb(null, Array.isArray(a) ? a : []); }, function (e) { cb(e || new Error('read')); });
      else cb(null, Array.isArray(p) ? p : []);
    } catch (e) { cb(e); }
  }
  function downloadBlobText(filename, text) {
    try {
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(function () { try { URL.revokeObjectURL(a.href); a.remove(); } catch (e) {} }, 1500);
    } catch (e) { toast('Download failed'); }
  }
  function backupFilename(name, t) {
    var d; try { d = new Date(t).toString().toLowerCase().split(' ').slice(0, 5).join('-').replace(/:/g, '-'); } catch (e) { d = String(t); }
    return (name || 'generator') + '-revision-' + d + '.txt';
  }
  function downloadBackup(name, b) {
    var intro = '<<<<< this file contains your perchance lists first, and your HTML code underneath it >>>>>\n\n\n\n';
    downloadBlobText(backupFilename(name, b.time), intro + (b.modelText || '') + Array(21).join('\n') + (b.outputTemplate || ''));
  }
  function restoreBackup(name, b) {
    var panes = ghPanes();
    if (!panes) { toast('Open the editor (#edit) to restore a backup'); return; }
    var when = (function () { try { return new Date(b.time).toLocaleString(); } catch (e) { return String(b.time); } })();
    if (!confirm('Restore the backup from ' + when + '?\n\nThis REPLACES the editor contents (undoable with Ctrl+Z). You still need to click Save afterwards.')) return;
    var unmute = muteBugFinderError();
    var sDsl = cmSet(panes.dsl, b.modelText || ''), sHtml = cmSet(panes.html, b.outputTemplate || '');
    setTimeout(unmute, 2000);
    console.log('[weld backup] restored', { name: name, time: b.time, dsl: sDsl, html: sHtml });
    toast('Restored backup (DSL:' + sDsl + ', HTML:' + sHtml + ') \u2014 review and Save');
  }
  function openBackupBrowser() {
    var name = genName() || window.generatorName;
    if (!name) { toast('Open a generator (#edit) to browse its backups'); return; }
    loadBackups(name, function (err, arr) {
      if (err) { toast(err.message === 'no-store' ? 'No local backup store found on this page' : 'Couldn\u2019t read local backups'); return; }
      renderBackupModal(name, arr || []);
    });
  }
  function renderBackupModal(name, arr) {
    var prev = document.getElementById('wc-backup-modal'); if (prev) prev.remove();
    var ov = el('div', { id: 'wc-backup-modal', class: 'wc-root', style: { position: 'fixed', inset: '0', zIndex: '2147483646', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' } });
    function close() { ov.remove(); document.removeEventListener('keydown', onEsc, true); }
    function onEsc(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.addEventListener('keydown', onEsc, true);
    var panel = el('div', { style: { width: '92%', maxWidth: '540px', maxHeight: '80vh', overflow: 'auto', padding: '16px', borderRadius: '12px', background: 'var(--wc-surface,#1c1c20)', color: 'var(--wc-ink,#eee)', border: '1px solid var(--wc-line,#333)', boxShadow: 'var(--wc-shadow,0 12px 40px rgba(0,0,0,0.5))' } });
    panel.appendChild(el('div', { class: 'wc-label', text: 'Local backups \u2014 ' + name }));
    panel.appendChild(el('div', { class: 'wc-section-note', text: arr.length + ' backup' + (arr.length === 1 ? '' : 's') + ' in this browser, newest first. Perchance saves these automatically as you edit; Restore fills the editor (undoable), then you Save.' }));
    if (!arr.length) {
      panel.appendChild(el('div', { class: 'wc-gslug', style: { padding: '12px 0' }, text: 'No local backups for this generator yet.' }));
    } else {
      var list = el('ul', { class: 'wc-list' });
      arr.forEach(function (b) {
        var size = (b.modelText || '').length + (b.outputTemplate || '').length;
        var when = (function () { try { return new Date(b.time).toLocaleString(); } catch (e) { return String(b.time); } })();
        list.appendChild(el('li', {}, [
          el('span', { class: 'wc-gname', style: { flex: '1' }, text: when }),
          el('span', { class: 'wc-gslug', text: (size > 999 ? (size / 1000).toFixed(1) + 'k' : size) + ' chars' }),
          el('button', { class: 'wc-btn wc-mini', text: 'download', title: 'Save this backup as a .txt', onclick: function () { downloadBackup(name, b); } }),
          el('button', { class: 'wc-btn wc-mini', text: 'restore', title: 'Replace the editor with this backup (undoable)', onclick: function () { restoreBackup(name, b); } })
        ]));
      });
      panel.appendChild(list);
    }
    panel.appendChild(el('div', { class: 'wc-row', style: { marginTop: '12px', justifyContent: 'space-between' } }, [
      el('button', { class: 'wc-btn wc-mini', text: 'Perchance revisions\u2026', title: 'Open Perchance\u2019s own server-side revision history', onclick: function () { close(); openRevisions(); } }),
      el('button', { class: 'wc-btn', text: 'Close', onclick: close })
    ]));
    ov.appendChild(panel);
    document.body.appendChild(ov);
  }
  // ---- owner actions (rename / delete) ----------------------------------------
  // We drive Perchance's OWN settingsModal so this script never reads or transmits
  // the session token -- Perchance's methods carry their own credentials. Confirmed
  // from the editor source: settingsModal.changeGeneratorName() reads the new name
  // from refs.newGeneratorName (>=4 chars) and on success rewrites window.generatorName
  // + the URL and reloads the iframe; settingsModal.deleteGenerator() shows its own
  // type-"yes" prompt, then deletes and redirects to the homepage.
  function pageSettingsModal() {
    return window.settingsModal || (typeof unsafeWindow !== 'undefined' && unsafeWindow && unsafeWindow.settingsModal) || null;
  }
  function renameThisGenerator() {
    var sm = pageSettingsModal();
    if (!sm || typeof sm.changeGeneratorName !== 'function') { toast('Open this generator\u2019s editor (#edit) to rename'); return; }
    var cur = genName() || window.generatorName || '';
    var next = prompt('Rename this generator \u2014 Perchance performs the rename.\nCurrent: ' + cur + '\n\nNew URL name (lowercase letters, digits, hyphens; at least 4 characters):', cur);
    if (next == null) return;
    next = String(next).trim();
    if (!next || next === cur) return;
    if (next.length < 4) { toast('Name must be at least 4 characters'); return; }
    if (!sm.refs || !sm.refs.newGeneratorName) { toast('Open the editor\u2019s Settings panel once, then retry the rename'); return; }
    try {
      sm.refs.newGeneratorName.value = next;
      sm.changeGeneratorName();
      // Confirm via Perchance's own success signal (it sets window.generatorName +
      // rewrites the URL). No state of ours to trust -- just watch for the change.
      var t0 = Date.now();
      (function poll() {
        if (window.generatorName === next || location.pathname.slice(1).split(/[?#]/)[0] === next) { toast('Renamed to \u201C' + next + '\u201D'); renderTab(); return; }
        if (Date.now() - t0 < 4000) { setTimeout(poll, 500); return; }
        toast('Rename didn\u2019t complete \u2014 the name may be taken or invalid. Open the editor\u2019s Settings to see why.');
      })();
    } catch (e) { console.error('[weld rename]', e); toast('Rename failed to start \u2014 see console'); }
  }
  function deleteThisGenerator() {
    var sm = pageSettingsModal();
    if (!sm || typeof sm.deleteGenerator !== 'function') { toast('Open this generator\u2019s editor (#edit) to delete'); return; }
    // Perchance's own deleteGenerator() already requires the user to type "yes" and
    // handles credentials + redirect. We hand straight off -- no creds, no second guard.
    try { sm.deleteGenerator(); }
    catch (e) { console.error('[weld delete]', e); toast('Delete failed to start \u2014 see console'); }
  }
  // ---- account directory (all your generators + their folders) ----------------
  // Perchance already keeps a per-user directory with folder/tree organization. We
  // surface it WITHOUT touching credentials: drive accountModal.loadGeneratorList()
  // (Perchance fetches getGeneratorsByUser with its own creds), then read the folder
  // map off the global and scrape the rendered [data-generator-name] rows. Result is
  // cached to GM storage so the panel shows it instantly next time; "Load all" re-pulls.
  function pageAccountModal() {
    return window.accountModal || (typeof unsafeWindow !== 'undefined' && unsafeWindow && unsafeWindow.accountModal) || null;
  }
  function loadDirectory(cb) {
    var am = pageAccountModal();
    if (!am || typeof am.loadGeneratorList !== 'function') { toast('Log in to Perchance on this page to load your generators'); if (cb) cb(false); return; }
    toast('Loading your generators\u2026');
    var ran; try { ran = am.loadGeneratorList(); } catch (e) { console.error('[weld directory]', e); toast('Couldn\u2019t load your generators \u2014 see console'); if (cb) cb(false); return; }
    if (ran && typeof ran.then === 'function') ran.catch(function () {});
    var t0 = Date.now();
    (function poll() {
      var ctn = am.refs && am.refs.generatorFoldersCtn;
      var els = ctn ? ctn.querySelectorAll('[data-generator-name]') : [];
      if (els.length) {
        var seen = {}, names = [];
        for (var i = 0; i < els.length; i++) { var n = els[i].getAttribute('data-generator-name'); if (n && !seen[n]) { seen[n] = 1; names.push(n); } }
        var fmap = (am.generatorFolderMap && typeof am.generatorFolderMap === 'object') ? am.generatorFolderMap : {};
        gset('directory', { names: names, folderMap: fmap, t: Date.now() });
        toast('Loaded ' + names.length + ' generators');
        if (cb) cb(true);
        return;
      }
      if (Date.now() - t0 < 8000) { setTimeout(poll, 400); return; }
      toast('Your generator list didn\u2019t render in time \u2014 try Load all again');
      if (cb) cb(false);
    })();
  }
  // A current-source backup: read both editor docs and download them as one .txt, so the
  // pre-pull state is recoverable (the pull itself is also Ctrl+Z-undoable).
  function backupCurrentSource(name) {
    try {
      var mt = dslView(), ot = htmlView();
      if (!mt || !ot || !mt.state || !ot.state) return false;
      var dsl = mt.state.doc.toString(), html = ot.state.doc.toString();
      var body = '<<<<< Weld Companion backup of "' + name + '" -- ' + new Date().toISOString() + '\n'
        + 'Perchance lists / top panel first, HTML panel below >>>>>\n\n\n\n'
        + dsl + '\n\n\n\n===== HTML PANEL =====\n\n' + html;
      var blob = new Blob([body], { type: 'text/plain' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = 'weld-backup-' + (name || 'generator') + '-' + Date.now() + '.txt';
      document.body.appendChild(a); a.click();
      setTimeout(function () { try { URL.revokeObjectURL(a.href); a.remove(); } catch (e) {} }, 1500);
      return true;
    } catch (e) { return false; }
  }
  // Save the generator. The current editor exposes no saveGenerator(); it autosaves and
  // binds Ctrl/Cmd+S, so we trigger that keybinding (legacy saveGenerator() first, if present).
  // window.perchanceSaveState reflects the outcome ('saved' / 'saving' / 'unsaved').
  // Read a property off the real page window (window first, then unsafeWindow).
  function pageProp(name) {
    try { if (typeof window !== 'undefined' && typeof window[name] !== 'undefined') return window[name]; } catch (e) {}
    try { if (typeof unsafeWindow !== 'undefined' && unsafeWindow && typeof unsafeWindow[name] !== 'undefined') return unsafeWindow[name]; } catch (e) {}
    return undefined;
  }
  // "Why won't this save?" preflight -- read-only, creds-free. Works out what Save
  // will do from: ownership (window.userOwnsThisGenerator), a collab link in the hash
  // (#edit:collab=KEY grants edit+save), and a stored edit password
  // (localStorage['perchance_generatorEditKey_<name>']).
  function savePreflight() {
    var owns = pageProp('userOwnsThisGenerator');
    var name = genName() || '';
    var collabKey = null, editKey = null;
    try { var m = (location.hash || '').match(/[#:]collab=([^;&]+)/); if (m) collabKey = decodeURIComponent(m[1]); } catch (e) {}
    try { editKey = localStorage.getItem('perchance_generatorEditKey_' + name); } catch (e) {}
    if (owns === true) return { mode: 'owner', label: 'Save writes in place (you own this)', detail: 'You own this generator, so Save updates it directly.' };
    if (collabKey) return { mode: 'collab', label: 'Save writes in place (collab link)', detail: 'You\u2019re editing through a shared collab link. Save updates the owner\u2019s generator until they regenerate or revoke the link.' };
    if (editKey) return { mode: 'editkey', label: 'Save writes in place (edit password)', detail: 'An edit password is stored for this generator, so Save updates it directly.' };
    if (owns === false) return { mode: 'copy', label: 'Save may ask for a password or make a copy', detail: 'You don\u2019t own this and no edit password is stored. Save will prompt for the edit password if the generator has one, otherwise it saves a copy under your own account.' };
    return { mode: 'unknown', label: 'Save mode unknown', detail: 'Couldn\u2019t read ownership state. If this is your own #edit page, Save writes in place.' };
  }
  function explainSave() { var p = savePreflight(); alert('Save preflight \u2014 ' + p.label + '\n\n' + p.detail); }

  function doSave() {
    if (gget('lintOnSave', true)) { var lp = lintHtmlScripts(); if (lp.length && !confirmLint('Save', lp)) { toast('Save cancelled'); return; } }
    if (typeof window.saveGenerator === 'function') { try { window.saveGenerator(); toast('Save triggered'); return; } catch (e) {} }
    var mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
    function press(t) { try { t.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', keyCode: 83, which: 83, ctrlKey: !mac, metaKey: mac, bubbles: true, cancelable: true })); } catch (e) {} }
    // The editor's save keybinding is bound at the document level (it fires
    // for keydowns dispatched to the editor, body, or document), so a SINGLE
    // dispatch is enough. Dispatching to all three triggered saveGenerator
    // multiple times -> a redundant double save + double output reload.
    var dv = dslView();
    var ed = (dv && dv.contentDOM) || document.querySelector('.cm-content');
    if (ed) { try { ed.focus(); } catch (e) {} }
    press(ed || document);
    // Saving can be gated behind a Cloudflare Turnstile captcha (Perchance returns
    // "captcha-needed"), and a save round-trip can take a second or two. So rather
    // than a single early read, watch the save state briefly and report the most
    // useful outcome -- including telling the user when a captcha is blocking it.
    var t0 = Date.now();
    (function poll() {
      var captcha = document.querySelector('iframe[src*="challenges.cloudflare.com"], iframe[title*="Cloudflare" i], .cf-turnstile');
      if (captcha) { toast('Save needs a captcha \u2014 complete it on the page to finish'); return; }
      var st = window.perchanceSaveState;
      if (st === 'saved') { toast('Saved'); return; }
      if (Date.now() - t0 < 3000) { setTimeout(poll, 500); return; }
      toast(st ? 'Save: ' + st : 'Sent Ctrl/Cmd+S \u2014 watch Perchance\u2019s save indicator');
    })();
  }
  // Perchance's in-editor bug-finder keeps mark decorations tied to the current
  // document. Replacing the whole document in one transaction can collapse one of
  // its cached ranges to an empty span; its CodeMirror StateField then throws an
  // (uncaught, asynchronous) "Mark decorations may not be empty" RangeError while
  // recomputing -- AFTER our write has already landed. The write succeeds and the
  // bug-finder re-scans cleanly on the next tick. This briefly intercepts ONLY that
  // exact error, on the real page window, so a successful pull doesn't spill a
  // scary uncaught error into the console. Returns a function that stops it.
  function muteBugFinderError() {
    var re = /Mark decorations may not be empty/;
    function h(ev) {
      var m = (ev && (ev.message || (ev.error && ev.error.message))) || '';
      if (re.test(String(m))) { ev.preventDefault(); if (ev.stopImmediatePropagation) ev.stopImmediatePropagation(); }
    }
    var w = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
    try { w.addEventListener('error', h, true); } catch (e) {}
    return function () { try { w.removeEventListener('error', h, true); } catch (e) {} };
  }
  function pullFromGitHub(over) {
    var name = genName();
    if (!name) { toast('No generator detected -- open one first'); return; }
    var panes = ghPanes();
    if (!panes) { toast('Open the editor (#edit) first -- no editor panes found'); return; }
    var R = ghResolve(name);
    if (over && (over.dslPath || over.htmlPath || over.owner || over.repo || over.branch)) {
      var cfgO = { owner: over.owner || R.cfg.owner, repo: over.repo || R.cfg.repo, branch: over.branch || R.cfg.branch, dslPath: over.dslPath || R.cfg.dslPath, htmlPath: over.htmlPath || R.cfg.htmlPath };
      R = { cfg: cfgO, overridden: true, dslUrl: ghRawUrl(cfgO, cfgO.dslPath, name), htmlUrl: ghRawUrl(cfgO, cfgO.htmlPath, name) };
    }
    if (!R.cfg.owner || !R.cfg.repo) { toast('Set your GitHub owner/repo first (open the gear, then Repo defaults)'); return; }
    var dslUrl = R.dslUrl, htmlUrl = R.htmlUrl;
    toast('Fetching ' + name + ' from GitHub\u2026');
    var got = {};
    function done() {
      if (!('dsl' in got) || !('html' in got)) return;
      if (got.dsl.err || got.html.err) {
        console.warn('[weld github] fetch error', { dslUrl: dslUrl, htmlUrl: htmlUrl, dsl: got.dsl.err, html: got.html.err });
        toast('Fetch failed (' + (got.dsl.err ? 'DSL ' + got.dsl.err : '') + (got.html.err ? ' HTML ' + got.html.err : '') + ') -- use "Map THIS generator" to re-point');
        return;
      }
      var dslP = R.cfg.dslPath.replace(/\{name\}/g, name), htmlP = R.cfg.htmlPath.replace(/\{name\}/g, name);
      var dirty = false;
      try { var dv = dslView(), hv = htmlView(); dirty = (dv && viewText(dv) !== window.lastModelTextSaved) || (hv && viewText(hv) !== window.lastOutputTemplateSaved); } catch (e) {}
      var msg = (dirty ? '\u26A0 You have UNSAVED edits that this will overwrite.\n\n' : '') + 'Update "' + name + '" from GitHub?' + (R.overridden ? '  [custom mapping]' : '') + '\n\n'
        + 'repo: ' + R.cfg.owner + '/' + R.cfg.repo + '@' + R.cfg.branch + '\n'
        + 'DSL  <- ' + dslP + '   (' + got.dsl.text.length + ' chars)\n'
        + 'HTML <- ' + htmlP + '   (' + got.html.text.length + ' chars)\n\n'
        + 'This REPLACES the editor contents. You will still need to click Save.';
      if (!confirm(msg)) { toast('Cancelled'); return; }
      if (gget('ghBackupBeforePull', true)) { if (backupCurrentSource(name)) toast('Backed up current source first'); }
      var unmute = muteBugFinderError();   // hush Perchance's bug-finder during the whole-document replace
      var sDsl = cmSet(panes.dsl, got.dsl.text), sHtml = cmSet(panes.html, got.html.text);
      setTimeout(unmute, 2000);
      console.log('[weld github] wrote panes', { name: name, dsl: sDsl, html: sHtml, dslChars: got.dsl.text.length, htmlChars: got.html.text.length, panes: panes.all.length, overridden: R.overridden });
      if (sDsl === 'failed' || sHtml === 'failed') toast('Wrote with issues (DSL:' + sDsl + ' HTML:' + sHtml + ') -- see console');
      else toast('Pulled ' + name + ' (DSL:' + sDsl + ', HTML:' + sHtml + ') -- now click Save');
      setTimeout(function () { try { var lp = lintHtmlScripts(); if (lp.length) toast('\u26A0 ' + lp.length + ' JS problem(s) in the pulled HTML \u2014 check before Save', 5000); } catch (e) {} }, 400);
    }
    ghFetch(dslUrl, function (err, text) { got.dsl = { err: err, text: text }; done(); });
    ghFetch(htmlUrl, function (err, text) { got.html = { err: err, text: text }; done(); });
  }
  // ---- Diff vs GitHub (local-only; reads both sides, writes nothing) ----------
  // Compares the live editor panes against the repo version. Reuses Pull's resolve
  // + ghFetch. Direction: GitHub -> editor (a "-" line is only in GitHub, a "+" is
  // only in your editor). LCS after trimming common prefix/suffix; coarse block
  // diff if the changed region is too large for an O(n*m) table.
  function lineDiffOps(aText, bText) {
    var a = String(aText).split('\n'), b = String(bText).split('\n');
    var n = a.length, m = b.length, ops = [];
    var p = 0; while (p < n && p < m && a[p] === b[p]) p++;
    var sa = n, sb = m; while (sa > p && sb > p && a[sa - 1] === b[sb - 1]) { sa--; sb--; }
    var i;
    for (i = 0; i < p; i++) ops.push({ t: '=', a: i, b: i });
    var midA = a.slice(p, sa), midB = b.slice(p, sb);
    if (midA.length || midB.length) {
      if (midA.length * midB.length > 2000000) {
        for (var x = 0; x < midA.length; x++) ops.push({ t: '-', a: p + x });
        for (var y = 0; y < midB.length; y++) ops.push({ t: '+', b: p + y });
      } else {
        var dp = []; for (var r = 0; r <= midA.length; r++) dp.push(new Int32Array(midB.length + 1));
        for (r = midA.length - 1; r >= 0; r--) for (var c = midB.length - 1; c >= 0; c--)
          dp[r][c] = (midA[r] === midB[c]) ? dp[r + 1][c + 1] + 1 : Math.max(dp[r + 1][c], dp[r][c + 1]);
        var ra = 0, rb = 0;
        while (ra < midA.length && rb < midB.length) {
          if (midA[ra] === midB[rb]) { ops.push({ t: '=', a: p + ra, b: p + rb }); ra++; rb++; }
          else if (dp[ra + 1][rb] >= dp[ra][rb + 1]) { ops.push({ t: '-', a: p + ra }); ra++; }
          else { ops.push({ t: '+', b: p + rb }); rb++; }
        }
        while (ra < midA.length) { ops.push({ t: '-', a: p + ra }); ra++; }
        while (rb < midB.length) { ops.push({ t: '+', b: p + rb }); rb++; }
      }
    }
    for (i = sa; i < n; i++) ops.push({ t: '=', a: i, b: sb + (i - sa) });
    return { ops: ops, a: a, b: b };
  }
  function diffStats(d) { var add = 0, del = 0; d.ops.forEach(function (o) { if (o.t === '+') add++; else if (o.t === '-') del++; }); return { add: add, del: del }; }
  function diffRows(d, maxRows) {
    var CTX = 3, rows = [], ops = d.ops, i = 0;
    function ctxRow(o) { return { cls: 'ctx', num: (o.a != null ? o.a + 1 : o.b + 1), text: (o.a != null ? d.a[o.a] : d.b[o.b]) }; }
    while (i < ops.length) {
      if (ops[i].t === '=') {
        var run = 0; while (i + run < ops.length && ops[i + run].t === '=') run++;
        var before = rows.length > 0, after = (i + run) < ops.length;
        if (run > CTX * 2 && (before || after)) {
          if (before) for (var x = 0; x < CTX; x++) rows.push(ctxRow(ops[i + x]));
          rows.push({ cls: 'gap', text: '\u22EF ' + (run - (before ? CTX : 0) - (after ? CTX : 0)) + ' unchanged' });
          if (after) for (var y = run - CTX; y < run; y++) rows.push(ctxRow(ops[i + y]));
        } else { for (var z = 0; z < run; z++) rows.push(ctxRow(ops[i + z])); }
        i += run;
      } else if (ops[i].t === '-') { rows.push({ cls: 'del', num: ops[i].a + 1, text: d.a[ops[i].a] }); i++; }
      else { rows.push({ cls: 'add', num: ops[i].b + 1, text: d.b[ops[i].b] }); i++; }
      if (rows.length > maxRows) { rows.push({ cls: 'gap', text: '\u2026 diff truncated \u2014 use Pull/Push to apply' }); break; }
    }
    return rows;
  }
  function diffVsGitHub(over) {
    var name = genName();
    if (!name) { toast('Open a generator first'); return; }
    var dv = dslView(), hv = htmlView();
    if (!isCmView(dv) || !isCmView(hv)) { toast('Open the editor (#edit) first \u2014 no editor panes found'); return; }
    var R = ghResolve(name);
    if (over && (over.dslPath || over.htmlPath || over.owner || over.repo || over.branch)) {
      var cfgO = { owner: over.owner || R.cfg.owner, repo: over.repo || R.cfg.repo, branch: over.branch || R.cfg.branch, dslPath: over.dslPath || R.cfg.dslPath, htmlPath: over.htmlPath || R.cfg.htmlPath };
      R = { cfg: cfgO, overridden: true, dslUrl: ghRawUrl(cfgO, cfgO.dslPath, name), htmlUrl: ghRawUrl(cfgO, cfgO.htmlPath, name) };
    }
    if (!R.cfg.owner || !R.cfg.repo) { toast('Set your GitHub owner/repo first (gear \u2192 Repo defaults)'); return; }
    toast('Fetching ' + name + ' from GitHub for diff\u2026');
    var got = {};
    function done() {
      if (!('dsl' in got) || !('html' in got)) return;
      if (got.dsl.err || got.html.err) { toast('Diff fetch failed (' + (got.dsl.err ? 'DSL ' + got.dsl.err : '') + (got.html.err ? ' HTML ' + got.html.err : '') + ')'); return; }
      var dDsl = lineDiffOps(got.dsl.text, viewText(dv)), dHtml = lineDiffOps(got.html.text, viewText(hv));
      renderDiffModal(name, R, over, [
        { title: 'DSL \u00b7 modelText', d: dDsl, stats: diffStats(dDsl) },
        { title: 'HTML \u00b7 outputTemplate', d: dHtml, stats: diffStats(dHtml) }
      ]);
    }
    ghFetch(R.dslUrl, function (e, t) { got.dsl = { err: e, text: t }; done(); });
    ghFetch(R.htmlUrl, function (e, t) { got.html = { err: e, text: t }; done(); });
  }
  function renderDiffModal(name, R, over, sections) {
    var prev = document.getElementById('wc-diff-modal'); if (prev) prev.remove();
    var ov = el('div', { id: 'wc-diff-modal', class: 'wc-root', style: { position: 'fixed', inset: '0', zIndex: '2147483646', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' } });
    function close() { ov.remove(); document.removeEventListener('keydown', onEsc, true); }
    function onEsc(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.addEventListener('keydown', onEsc, true);
    var panel = el('div', { style: { width: '94%', maxWidth: '820px', maxHeight: '86vh', overflow: 'auto', padding: '16px', borderRadius: '12px', background: 'var(--wc-surface,#1c1c20)', color: 'var(--wc-ink,#eee)', border: '1px solid var(--wc-line,#333)', boxShadow: 'var(--wc-shadow,0 12px 40px rgba(0,0,0,0.5))' } });
    panel.appendChild(el('div', { class: 'wc-label', text: 'Diff vs GitHub \u2014 ' + name }));
    panel.appendChild(el('div', { class: 'wc-section-note', text: R.cfg.owner + '/' + R.cfg.repo + '@' + R.cfg.branch + (R.overridden ? '  [custom mapping]' : '') + '  \u00b7  GitHub \u2192 editor: \u2212 only in GitHub, + only in your editor. Nothing is written here.' }));
    sections.forEach(function (s) {
      var changed = (s.stats.add + s.stats.del) > 0;
      panel.appendChild(el('div', { class: 'wc-label', style: { marginTop: '12px' }, text: s.title + '  (' + (changed ? ('+' + s.stats.add + ' \u2212' + s.stats.del) : 'identical') + ')' }));
      if (!changed) { panel.appendChild(el('div', { class: 'wc-section-note', text: 'No differences.' })); return; }
      var box = el('div', { style: { font: '12px/1.45 ui-monospace,Menlo,Consolas,monospace', border: '1px solid var(--wc-line,#333)', borderRadius: '8px', overflow: 'auto', maxHeight: '40vh', marginTop: '4px' } });
      diffRows(s.d, 500).forEach(function (rw) {
        var bg = rw.cls === 'add' ? 'rgba(63,185,80,0.16)' : rw.cls === 'del' ? 'rgba(248,81,73,0.16)' : 'transparent';
        var mark = rw.cls === 'add' ? '+' : rw.cls === 'del' ? '\u2212' : ' ';
        box.appendChild(el('div', { style: { display: 'flex', gap: '8px', padding: '0 8px', background: bg, color: (rw.cls === 'gap' ? 'var(--wc-muted,#888)' : 'inherit'), fontStyle: (rw.cls === 'gap' ? 'italic' : 'normal'), whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, [
          el('span', { style: { width: '44px', textAlign: 'right', opacity: '0.5', flex: '0 0 auto' }, text: (rw.num != null ? String(rw.num) : '') }),
          el('span', { style: { width: '10px', opacity: '0.7', flex: '0 0 auto' }, text: (rw.cls === 'gap' ? '' : mark) }),
          el('span', { text: (rw.text == null ? '' : rw.text) })
        ]));
      });
      panel.appendChild(box);
    });
    panel.appendChild(el('div', { class: 'wc-row', style: { marginTop: '14px', justifyContent: 'flex-end', gap: '8px' } }, [
      el('button', { class: 'wc-btn', text: 'Pull (GitHub \u2192 editor)', title: 'Overwrite the editor with the GitHub version', onclick: function () { close(); pullFromGitHub(over); } }),
      el('button', { class: 'wc-btn', text: 'Push (editor \u2192 GitHub)', title: 'Commit the editor contents to GitHub', onclick: function () { close(); pushToGitHub(over); } }),
      el('button', { class: 'wc-btn wc-btn-accent', text: 'Close', onclick: close })
    ]));
    ov.appendChild(panel);
    document.body.appendChild(ov);
  }

  // ---- GitHub push (current generator) ----------------------------------------
  // Symmetric partner to Pull: read both editor panes and commit them to the repo
  // via the GitHub Contents API. Requires a write-scoped Personal Access Token,
  // stored locally and sent ONLY to api.github.com in the Authorization header --
  // never logged, never put in commit messages.
  function ghToken() { return gget('ghToken', '') || ''; }
  function b64utf8(s) { try { return btoa(unescape(encodeURIComponent(String(s)))); } catch (e) { return btoa(String(s)); } }
  function ghApi(method, apiPath, token, body, cb) {
    try {
      GM_xmlhttpRequest({
        method: method, url: 'https://api.github.com' + apiPath,
        headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
        data: body ? JSON.stringify(body) : null,
        onload: function (r) { var j = null; try { j = JSON.parse(r.responseText); } catch (e) {} cb(null, r.status, j); },
        onerror: function () { cb(new Error('network error'), 0, null); },
        ontimeout: function () { cb(new Error('timeout'), 0, null); }
      });
    } catch (e) { cb(new Error(String((e && e.message) || e)), 0, null); }
  }
  // Create-or-update one file: GET its current sha (404 = new file -> create), then PUT.
  function ghPushFile(o, repo, branch, path, content, token, msg, cb) {
    var enc = String(path).split('/').map(encodeURIComponent).join('/');
    ghApi('GET', '/repos/' + o + '/' + repo + '/contents/' + enc + '?ref=' + encodeURIComponent(branch), token, null, function (err, st, json) {
      if (err) return cb(err);
      if (st !== 200 && st !== 404) return cb(new Error('GET ' + st + (json && json.message ? ' ' + json.message : '')));
      var sha = (st === 200 && json && json.sha) ? json.sha : null;
      var body = { message: msg, content: b64utf8(content), branch: branch };
      if (sha) body.sha = sha;
      ghApi('PUT', '/repos/' + o + '/' + repo + '/contents/' + enc, token, body, function (e2, st2, j2) {
        if (e2) return cb(e2);
        if (st2 === 200 || st2 === 201) return cb(null, sha ? 'updated' : 'created');
        cb(new Error('PUT ' + st2 + (j2 && j2.message ? ' ' + j2.message : '')));
      });
    });
  }
  function pushToGitHub(over) {
    var name = genName();
    if (!name) { toast('No generator detected -- open one first'); return; }
    var token = ghToken();
    if (!token) { toast('Set a GitHub token first (gear \u2192 GitHub push)'); return; }
    var mt = dslView(), ot = htmlView();
    if (!mt || !ot || !mt.state || !ot.state) { toast('Open the editor (#edit) first -- panes not ready'); return; }
    var R = ghResolve(name);
    if (over && (over.dslPath || over.htmlPath || over.owner || over.repo || over.branch)) {
      var cfgO = { owner: over.owner || R.cfg.owner, repo: over.repo || R.cfg.repo, branch: over.branch || R.cfg.branch, dslPath: over.dslPath || R.cfg.dslPath, htmlPath: over.htmlPath || R.cfg.htmlPath };
      R = { cfg: cfgO, overridden: true };
    }
    if (!R.cfg.owner || !R.cfg.repo) { toast('Set your GitHub owner/repo first (open the gear, then Repo defaults)'); return; }
    var branch = R.cfg.branch || 'main';
    var dsl = mt.state.doc.toString(), html = ot.state.doc.toString();
    var dslP = R.cfg.dslPath.replace(/\{name\}/g, name), htmlP = R.cfg.htmlPath.replace(/\{name\}/g, name);
    var confirmMsg = 'Push \u201C' + name + '\u201D to GitHub?' + (R.overridden ? '  [custom mapping]' : '') + '\n\n'
      + 'repo: ' + R.cfg.owner + '/' + R.cfg.repo + '@' + branch + '\n'
      + 'DSL  \u2192 ' + dslP + '   (' + dsl.length + ' chars)\n'
      + 'HTML \u2192 ' + htmlP + '   (' + html.length + ' chars)\n\n'
      + 'This COMMITS over the GitHub copies of these two files.';
    var pushLint = lintHtmlScripts();
    if (pushLint.length) { console.warn('[weld lint]', pushLint); confirmMsg += '\n\n\u26A0 ' + pushLint.length + ' JavaScript problem(s) in the HTML pane (see console) \u2014 pushing commits them as-is.'; }
    if (!confirm(confirmMsg)) { toast('Cancelled'); return; }
    toast('Pushing ' + name + ' to GitHub\u2026');
    var commitMsg = 'Update ' + name + ' via Weld Companion';   // sent to GitHub; no token, no local paths
    ghPushFile(R.cfg.owner, R.cfg.repo, branch, dslP, dsl, token, commitMsg, function (e1, r1) {
      if (e1) { console.error('[weld push] DSL', e1.message); toast('Push failed (DSL): ' + e1.message); return; }
      ghPushFile(R.cfg.owner, R.cfg.repo, branch, htmlP, html, token, commitMsg, function (e2, r2) {
        if (e2) { console.error('[weld push] HTML', e2.message); toast('Push failed (HTML; DSL was ' + r1 + '): ' + e2.message); return; }
        console.log('[weld github] pushed', { name: name, dsl: dslP, html: htmlP, dslResult: r1, htmlResult: r2, branch: branch });
        toast('Pushed ' + name + ' (DSL ' + r1 + ', HTML ' + r2 + ')');
      });
    });
  }
  function ghConfigure() {
    var cfg = ghCfg();
    var owner = prompt('GitHub owner (global default):', cfg.owner); if (owner == null) return;
    var repo = prompt('Repo:', cfg.repo); if (repo == null) return;
    var branch = prompt('Branch:', cfg.branch); if (branch == null) return;
    var dslPath = prompt('DSL path template ({name} = generator slug):', cfg.dslPath); if (dslPath == null) return;
    var htmlPath = prompt('HTML path template ({name} = generator slug):', cfg.htmlPath); if (htmlPath == null) return;
    gset('github', { owner: (owner || '').trim(), repo: (repo || '').trim(), branch: (branch || '').trim(), dslPath: (dslPath || '').trim(), htmlPath: (htmlPath || '').trim() });
    toast('Global GitHub config saved');
  }
  // Re-point the CURRENT generator (by slug) at specific GitHub files -- needed when the
  // Perchance slug does not match the file names (e.g. a random slug).
  function ghMapThis() {
    var name = genName();
    if (!name) { toast('Open a generator first'); return; }
    var R = ghResolve(name), map = gget('githubMap', {}) || {}, cur = map[name] || {}, base = ghCfg();
    var dsl = prompt('GitHub DSL path for slug "' + name + '"\n(repo ' + R.cfg.owner + '/' + R.cfg.repo + '@' + R.cfg.branch + '; {name} = ' + name + '):', R.cfg.dslPath); if (dsl == null) return;
    var html = prompt('GitHub HTML path for slug "' + name + '":', R.cfg.htmlPath); if (html == null) return;
    var owner = prompt('Owner override (blank = global "' + base.owner + '"):', cur.owner || ''); if (owner == null) return;
    var repo = prompt('Repo override (blank = global "' + base.repo + '"):', cur.repo || ''); if (repo == null) return;
    var branch = prompt('Branch override (blank = global "' + base.branch + '"):', cur.branch || ''); if (branch == null) return;
    var entry = { dslPath: dsl.trim(), htmlPath: html.trim() };
    if (owner.trim()) entry.owner = owner.trim();
    if (repo.trim()) entry.repo = repo.trim();
    if (branch.trim()) entry.branch = branch.trim();
    map[name] = entry; gset('githubMap', map);
    toast('Mapped slug "' + name + '" -> GitHub files');
  }
  // Power-user: edit the whole per-slug mapping as JSON.
  function ghEditMap() {
    var map = gget('githubMap', {}) || {};
    var txt = prompt('Edit GitHub mapping JSON\n{ "<slug>": { "dslPath", "htmlPath", "owner"?, "repo"?, "branch"? } }', JSON.stringify(map));
    if (txt == null) return;
    try {
      var parsed = JSON.parse(txt);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { toast('Invalid: must be a JSON object'); return; }
      gset('githubMap', parsed); toast('GitHub mapping saved (' + Object.keys(parsed).length + ' entries)');
    } catch (e) { toast('Invalid JSON: ' + ((e && e.message) || e)); }
  }
  try {
    if (typeof GM_registerMenuCommand !== 'undefined') {
      GM_registerMenuCommand('Weld: Update editor from GitHub', pullFromGitHub);
      GM_registerMenuCommand('Weld: Push editor to GitHub', function () { pushToGitHub(); });
      GM_registerMenuCommand('Weld: Diff editor vs GitHub', function () { diffVsGitHub(); });
      GM_registerMenuCommand('Weld: Browse local backups', openBackupBrowser);
      GM_registerMenuCommand('Weld: Map THIS generator -> GitHub files', ghMapThis);
      GM_registerMenuCommand('Weld: Load my generator directory', function () { loadDirectory(); });
      GM_registerMenuCommand('Weld: Rename THIS generator', renameThisGenerator);
      GM_registerMenuCommand('Weld: Delete THIS generator', deleteThisGenerator);
      GM_registerMenuCommand('Weld: Configure GitHub repo (global)', ghConfigure);
      GM_registerMenuCommand('Weld: Insert $meta block at cursor', function () { insertSnippet(snippetById('meta')); });
      GM_registerMenuCommand('Weld: Insert core plugin imports at cursor', function () { insertSnippet(snippetById('imports-core')); });
      GM_registerMenuCommand('Weld: Lint JS in HTML pane now', lintNow);
      GM_registerMenuCommand('Weld: Find bugs in active pane (AI)', aiBugCheck);
      GM_registerMenuCommand('Weld: Explain Save (what will Save do?)', explainSave);
      GM_registerMenuCommand('Weld: Lint-before-Save (toggle)', function () { var on = !gget('lintOnSave', true); gset('lintOnSave', on); toast('Lint before Save: ' + (on ? 'ON' : 'OFF')); });
      GM_registerMenuCommand('Weld: Edit GitHub mapping (JSON)', ghEditMap);
    }
  } catch (e) {}

  function isEditMode() { return /[?&]edit/.test(location.search) || !!dslView(); }
  function toast(msg, ms) {
    var t = el('div', { class: 'wc-root wc-toast', text: msg });
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('wc-toast-in'); });
    setTimeout(function () { t.classList.remove('wc-toast-in'); setTimeout(function () { t.remove(); }, 300); }, ms || 2200);
  }

  // expose a tiny namespace for debugging / other scripts
  window.weldCompanion = { gget: gget, gset: gset, version: '1.0.0' };

  // ---- adopt Perchance's own theme ------------------------------------------
  // Our chrome should belong to the page, not impose a foreign palette. We read
  // the page's actual computed colours (background, text, and the menu bar) and
  // map them onto our --wc-* tokens, so the bar/drawer/inputs match whatever
  // theme Perchance is showing (it honours prefers-color-scheme). Falls back to
  // the dark defaults in :root if anything can't be read.
  function parseRGB(str) {
    var m = (str || '').match(/rgba?\(([^)]+)\)/); if (!m) return null;
    var p = m[1].split(',').map(function (x) { return parseFloat(x); });
    if (p.length < 3 || isNaN(p[0])) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function luminance(c) { return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255; }
  function mix(c, d, t) { return { r: c.r + (d.r - c.r) * t, g: c.g + (d.g - c.g) * t, b: c.b + (d.b - c.b) * t }; }
  function rgb(c) { return 'rgb(' + Math.round(c.r) + ',' + Math.round(c.g) + ',' + Math.round(c.b) + ')'; }
  function adoptTheme() {
    try {
      var bodyStyle = getComputedStyle(document.body);
      var bg = parseRGB(bodyStyle.backgroundColor);
      // many pages have a transparent body bg — walk to html, else default
      if (!bg || bg.a === 0) bg = parseRGB(getComputedStyle(document.documentElement).backgroundColor);
      if (!bg || bg.a === 0) bg = null;
      var ink = parseRGB(bodyStyle.color);
      if (!bg && !ink) return; // nothing reliable — keep dark defaults

      var dark = bg ? luminance(bg) < 0.5 : (ink ? luminance(ink) > 0.5 : true);
      var base = bg || (dark ? { r: 19, g: 23, b: 30 } : { r: 247, g: 248, b: 252 });
      var textC = ink || (dark ? { r: 238, g: 242, b: 246 } : { r: 26, g: 28, b: 34 });
      var towardText = dark ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };

      // surfaces: nudge the page background slightly toward the text colour for
      // raised panels, so the drawer reads as "on top of" the page
      var surface  = rgb(mix(base, towardText, dark ? 0.06 : 0.02));
      var surface2 = rgb(mix(base, towardText, dark ? 0.12 : 0.05));
      var surface3 = rgb(mix(base, towardText, dark ? 0.18 : 0.09));
      var lineA = dark ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.12)';
      var lineB = dark ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.06)';

      var set = {
        '--wc-surface': surface, '--wc-surface-2': surface2, '--wc-surface-3': surface3,
        '--wc-ink': rgb(textC),
        '--wc-dim': rgb(mix(textC, base, 0.35)),
        '--wc-faint': rgb(mix(textC, base, 0.6)),
        '--wc-line': lineA, '--wc-line-2': lineB,
        '--wc-shadow': dark ? '0 24px 64px -16px rgba(0,0,0,.78),0 6px 18px -6px rgba(0,0,0,.6)'
                            : '0 24px 64px -16px rgba(0,0,0,.22),0 6px 18px -6px rgba(0,0,0,.14)'
      };
      var s = document.getElementById('wc-theme-vars') || document.createElement('style');
      s.id = 'wc-theme-vars';
      s.textContent = ':root{' + Object.keys(set).map(function (k) { return k + ':' + set[k] + ';'; }).join('') + '}';
      if (!s.parentNode) document.head.appendChild(s);
    } catch (e) { /* keep dark defaults */ }
  }

  // ============================================================ styles
  // Design language: "precision instrument" — deep graphite glass, a single
  // welding-arc amber accent with a cool cyan signal colour, hairline borders
  // with inner light, layered depth, a characterful mono display face paired
  // with a clean grotesque body. Everything is scoped under .wc-root / wc-*
  // and resets inherited host styles at the boundary so a generator's own CSS
  // can't bleed in (and ours can't leak out).
  GM_addStyle([
    // ---- tokens ----
    ':root{',
    '  --wc-mono:"Berkeley Mono","JetBrains Mono","SF Mono",ui-monospace,"Cascadia Code",Menlo,Consolas,monospace;',
    '  --wc-sans:"Geist","Satoshi",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
    '  --wc-ink:#eef2f6; --wc-dim:#9aa7b6; --wc-faint:#5d6b7b;',
    '  --wc-arc:#ff8a3d;        /* welding-arc amber, the primary accent */',
    '  --wc-arc-soft:rgba(255,138,61,.14);',
    '  --wc-signal:#4ee0c8;     /* cool cyan signal, secondary */',
    '  --wc-gold:#ffcd4d;',
    // Opaque surfaces: legibility must NOT depend on backdrop-filter (it fails
    // over light/complex host pages). Blur is a subtle enhancement layered on a
    // solid base, never the base itself.
    '  --wc-surface:#13171e;    /* solid window background */',
    '  --wc-surface-2:#1a1f28;  /* raised rows / inputs */',
    '  --wc-surface-3:#222936;  /* hover */',
    '  --wc-glass:#13171e; --wc-glass-2:#1a1f28;',
    '  --wc-line:rgba(255,255,255,.09); --wc-line-2:rgba(255,255,255,.05);',
    '  --wc-shadow:0 24px 64px -16px rgba(0,0,0,.78),0 6px 18px -6px rgba(0,0,0,.6);',
    '  --wc-z:2147483500;',
    '}',
    // ---- boundary reset: neutralise inherited host styles on our subtree ----
    '.wc-root,.wc-root *{box-sizing:border-box;}',
    '.wc-root{all:revert;font-family:var(--wc-sans);line-height:1.5;-webkit-font-smoothing:antialiased;color:var(--wc-ink);text-align:left;}',
    // theme overlay: fixed, click-through; filters the whole page behind it.
    // z below our UI (bar/drawer/pins/toast) so those stay un-filtered.
    '.wc-theme-overlay{position:fixed;inset:0;pointer-events:none;z-index:2147483400;}',
    // ---- our single item inside Perchance's own menu bar (#menuBarEl) ----
    // Styled exactly like a native .menu-item; height-locked so it can't grow
    // or distort the bar. One item only — Perchance's UI is never displaced.
    '.wc-weld-item{position:relative;height:100% !important;box-sizing:border-box !important;',
    '  line-height:1 !important;white-space:nowrap !important;flex:0 0 auto !important;}',
    '.wc-weld-item .menu-item-icon{line-height:1 !important;}',
    '.wc-weld-item.wc-on{color:var(--wc-arc) !important;}',
    '.wc-weld-item.wc-on::after{content:"";position:absolute;left:4px;right:4px;bottom:0;height:2px;background:var(--wc-arc);border-radius:2px 2px 0 0;}',
    // ---- drawer (hangs beneath Perchance\'s bar; never covers it) ----
    '.wc-scrim{position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483540;background:transparent;}',
    '.wc-drawer{position:fixed;top:8px;right:12px;width:min(700px,calc(100vw - 24px));z-index:2147483550;',
    '  display:flex;flex-direction:column;background:var(--wc-surface);border:1px solid var(--wc-line);',
    '  border-radius:14px;box-shadow:var(--wc-shadow);overflow:hidden;opacity:0;transform:translateY(-8px);',
    '  animation:wc-drawer-in .2s cubic-bezier(.2,.8,.2,1) forwards;}',
    '@keyframes wc-drawer-in{to{opacity:1;transform:translateY(0);}}',
    // drawer header: brand + result tools + close
    '.wc-titlebar{display:flex;align-items:center;gap:10px;padding:11px 12px 11px 15px;border-bottom:1px solid var(--wc-line-2);flex:none;}',
    '.wc-brand{display:flex;align-items:center;gap:8px;font:700 12px/1 var(--wc-mono);letter-spacing:1px;text-transform:uppercase;color:var(--wc-ink);}',
    '.wc-brand .wc-dot{width:8px;height:8px;border-radius:50%;background:var(--wc-arc);box-shadow:0 0 10px var(--wc-arc);}',
    '.wc-tools{display:inline-flex;align-items:center;gap:3px;margin-left:auto;}',
    '.wc-toolbtn{appearance:none;border:1px solid transparent;background:transparent;color:var(--wc-dim);cursor:pointer;',
    '  width:26px;height:26px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;font-size:13px;line-height:1;transition:color .15s,background .15s,border-color .15s;}',
    '.wc-toolbtn:hover{color:var(--wc-arc);background:var(--wc-surface-2);border-color:var(--wc-line);}',
    '.wc-histgroup{display:inline-flex;align-items:center;gap:1px;margin-left:3px;padding-left:5px;border-left:1px solid var(--wc-line);}',
    '.wc-histlabel{font:600 10px/1 var(--wc-mono);color:var(--wc-faint);padding:0 3px;min-width:24px;text-align:center;}',
    '.wc-close{width:28px;height:28px;border-radius:8px;border:1px solid var(--wc-line);background:var(--wc-surface-2);',
    '  color:var(--wc-dim);font-size:14px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none;transition:color .15s,background .15s,border-color .15s;}',
    '.wc-close:hover{color:#fff;background:#c0392b;border-color:#c0392b;}',
    // drawer tab strip
    '.wc-menu{display:flex;gap:2px;padding:8px 10px;border-bottom:1px solid var(--wc-line-2);flex:none;}',
    '.wc-tab{flex:1;display:flex;align-items:center;justify-content:center;gap:7px;padding:9px 8px;border-radius:9px;cursor:pointer;',
    '  font:600 12px/1 var(--wc-sans);letter-spacing:.2px;color:var(--wc-dim);border:1px solid transparent;transition:color .15s,background .15s,border-color .15s;}',
    '.wc-tab:hover{color:var(--wc-ink);background:var(--wc-surface-2);}',
    '.wc-tab.wc-on{color:var(--wc-ink);background:var(--wc-surface-3);box-shadow:inset 0 -2px 0 var(--wc-arc);}',
    '.wc-tab .wc-ti{font-size:14px;}',
    '.wc-body{overflow:auto;padding:16px;scrollbar-width:thin;scrollbar-color:var(--wc-faint) transparent;}',
    '.wc-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:16px 20px;align-items:start;}',
    '.wc-col{display:flex;flex-direction:column;gap:8px;min-width:0;}',
    '.wc-card{border:1px solid var(--wc-line-2);border-radius:11px;padding:12px 13px;background:var(--wc-surface-2);}',
    '.wc-body::-webkit-scrollbar{width:9px;} .wc-body::-webkit-scrollbar-thumb{background:var(--wc-line);border-radius:9px;}',
    '.wc-body::-webkit-scrollbar-track{background:transparent;}',
    // a sticky footer area inside a tab (for CRUD / actions)
    '.wc-foot{margin-top:14px;padding-top:14px;border-top:1px solid var(--wc-line-2);}',
    '.wc-section-note{font:500 11px/1.5 var(--wc-sans);color:var(--wc-faint);margin-top:12px;}',
    '.wc-thisgen{margin-bottom:14px;}',
    '.wc-adv{margin-top:10px;padding-top:12px;border-top:1px solid var(--wc-line);flex-direction:column;gap:8px;}',
    '.wc-subhead{font:600 10.5px/1.4 var(--wc-sans);color:var(--wc-dim);text-transform:uppercase;letter-spacing:.05em;margin:6px 0 -2px;}',
    // ---- toast ----
    '.wc-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(14px) scale(.98);z-index:2147483600;',
    '  padding:11px 18px 11px 15px;font:500 13px/1.3 var(--wc-sans);letter-spacing:.1px;color:var(--wc-ink);',
    '  background:var(--wc-surface);border:1px solid var(--wc-line);border-radius:12px;box-shadow:var(--wc-shadow);',
    '  display:flex;align-items:center;gap:9px;opacity:0;transition:opacity .3s cubic-bezier(.2,.8,.2,1),transform .3s cubic-bezier(.2,.8,.2,1);}',
    '.wc-toast::after{content:"";position:absolute;left:0;top:14%;height:72%;width:3px;border-radius:3px;background:var(--wc-arc);box-shadow:0 0 12px var(--wc-arc);}',
    '.wc-toast-in{opacity:1;transform:translateX(-50%) translateY(0) scale(1);}',
    // ---- buttons ----
    '.wc-btn{appearance:none;background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.01));color:var(--wc-ink);',
    '  border:1px solid var(--wc-line);border-radius:9px;padding:8px 13px;font:600 12px/1 var(--wc-sans);letter-spacing:.2px;',
    '  cursor:pointer;transition:transform .12s ease,border-color .15s,background .15s,box-shadow .15s;}',
    '.wc-btn:hover{border-color:rgba(255,138,61,.5);box-shadow:0 0 0 1px rgba(255,138,61,.15),0 6px 16px -8px rgba(0,0,0,.6);transform:translateY(-1px);}',
    '.wc-btn:active{transform:translateY(0) scale(.98);}',
    '.wc-btn-accent{background:linear-gradient(180deg,#ff9a52,#f4751f);border-color:#ff8a3d;color:#1a0f05;text-shadow:0 1px 0 rgba(255,255,255,.2);}',
    '.wc-btn-accent:hover{box-shadow:0 0 18px -2px rgba(255,138,61,.55);border-color:#ffab6b;}',
    '.wc-mini{padding:5px 9px;font-size:11px;border-radius:7px;}',
    // ---- panels ----
    '.wc-label{display:block;font:600 10px/1 var(--wc-mono);color:var(--wc-dim);margin:14px 0 6px;text-transform:uppercase;letter-spacing:.9px;}',
    '.wc-field{width:100%;box-sizing:border-box;background:var(--wc-surface-2);color:var(--wc-ink);border:1px solid var(--wc-line);',
    '  border-radius:9px;padding:9px 11px;font:13px/1.4 var(--wc-sans);transition:border-color .15s,box-shadow .15s;outline:none;}',
    '.wc-field:focus{border-color:rgba(255,138,61,.6);box-shadow:0 0 0 3px var(--wc-arc-soft);}',
    'textarea.wc-field{resize:vertical;font-family:var(--wc-mono);font-size:12px;line-height:1.5;}',
    '.wc-row{display:flex;gap:9px;align-items:center;flex-wrap:wrap;}',
    // toggle styled checkbox
    '.wc-check{display:inline-flex;align-items:center;gap:9px;cursor:pointer;font:500 13px/1 var(--wc-sans);color:var(--wc-ink);}',
    '.wc-check input{position:absolute;opacity:0;width:0;height:0;}',
    '.wc-check .wc-sw{width:36px;height:20px;border-radius:20px;background:rgba(255,255,255,.1);border:1px solid var(--wc-line);position:relative;transition:background .2s;flex:none;}',
    '.wc-check .wc-sw::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--wc-dim);transition:transform .2s,background .2s;}',
    '.wc-check input:checked + .wc-sw{background:var(--wc-arc-soft);border-color:rgba(255,138,61,.5);}',
    '.wc-check input:checked + .wc-sw::after{transform:translateX(16px);background:var(--wc-arc);box-shadow:0 0 8px var(--wc-arc);}',
    // ---- lists ----
    '.wc-list{list-style:none;margin:0;padding:0;}',
    '.wc-list.wc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:2px 12px;align-content:start;}',
    '.wc-list.wc-grid > .wc-span{grid-column:1 / -1;}',
    '.wc-list li{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;cursor:pointer;',
    '  transition:background .12s;position:relative;}',
    '.wc-list li:hover{background:var(--wc-surface-3);}',
    '.wc-list li.wc-sel{background:var(--wc-arc-soft);box-shadow:inset 2px 0 0 var(--wc-arc);}',
    '.wc-gname{flex:1;font:500 13px/1.2 var(--wc-sans);color:var(--wc-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.wc-gslug{font:500 11px/1 var(--wc-mono);color:var(--wc-faint);}',
    '.wc-star{cursor:pointer;color:var(--wc-faint);font-size:14px;transition:color .15s,transform .15s;flex:none;}',
    '.wc-star:hover{transform:scale(1.2);} .wc-star.on{color:var(--wc-gold);text-shadow:0 0 10px rgba(255,205,77,.5);}',
    // ---- comfort body classes (host page) ----
    'body.wc-focus :is(.menu-bar,#adCtn,.adCtn,[id*="ad" i][class*="ad" i],aside,nav){display:none !important;}',

    // ---- pins (a tidy tray, bottom-left, below the bar) ----
    '.wc-pin-tray{position:fixed;left:14px;bottom:14px;z-index:var(--wc-z);width:248px;max-height:calc(100vh - 80px);overflow:auto;',
    '  display:flex;flex-direction:column;gap:8px;background:var(--wc-surface);border:1px solid var(--wc-line);border-radius:14px;',
    '  box-shadow:var(--wc-shadow);padding:10px;scrollbar-width:thin;scrollbar-color:var(--wc-faint) transparent;}',
    '.wc-pin-tray::-webkit-scrollbar{width:8px;} .wc-pin-tray::-webkit-scrollbar-thumb{background:var(--wc-line);border-radius:8px;}',
    '.wc-pin-trayhead{display:flex;align-items:center;justify-content:space-between;font:700 9px/1 var(--wc-mono);letter-spacing:1.5px;color:var(--wc-arc);padding:2px 2px 0;}',
    '.wc-pin-clear{cursor:pointer;color:var(--wc-faint);letter-spacing:.5px;text-transform:uppercase;transition:color .15s;}',
    '.wc-pin-clear:hover{color:var(--wc-arc);}',
    '.wc-pin{background:var(--wc-surface-2);border:1px solid var(--wc-line);border-radius:10px;overflow:hidden;}',
    '.wc-pin-head{display:flex;align-items:center;justify-content:space-between;padding:5px 9px;background:rgba(255,255,255,.03);border-bottom:1px solid var(--wc-line-2);}',
    '.wc-pin-num{font:700 9px/1 var(--wc-mono);letter-spacing:1px;color:var(--wc-faint);}',
    '.wc-pin-x{cursor:pointer;color:var(--wc-faint);font-size:15px;line-height:1;width:18px;height:18px;display:flex;align-items:center;justify-content:center;border-radius:5px;transition:color .15s,background .15s;}',
    '.wc-pin-x:hover{color:#fff;background:#c0392b;}',
    // the embedded result is arbitrary host HTML — clamp it hard so it can never break the card
    '.wc-pin-body{max-height:140px;overflow:auto;padding:9px 10px;font:12px/1.5 var(--wc-sans);color:var(--wc-ink);}',
    '.wc-pin-body *{max-width:100% !important;height:auto;margin:0 !important;padding:0 !important;float:none !important;font-size:inherit !important;color:inherit !important;background:transparent !important;}',
    '.wc-pin-body img{border-radius:6px;display:block;margin:4px 0 !important;}',
    // expand-textarea button
    '.wc-expand{appearance:none;border:1px solid var(--wc-line);background:var(--wc-surface-2);color:var(--wc-dim);border-radius:7px;',
    '  width:24px;height:24px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:12px;transition:color .15s,border-color .15s;}',
    '.wc-expand:hover{color:var(--wc-arc);border-color:rgba(255,138,61,.5);}',
    // ---- theme swatches (mini-page preview with the real filter laid over it) ----
    '.wc-swatch-row{display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 2px;}',
    '.wc-swatch{display:flex;flex-direction:column;align-items:center;gap:5px;cursor:pointer;border:2px solid transparent;',
    '  border-radius:11px;padding:4px;transition:border-color .15s,transform .15s;flex:none;}',
    '.wc-swatch:hover{transform:scale(1.05);}',
    '.wc-swatch.on{border-color:var(--wc-arc);box-shadow:0 0 0 1px var(--wc-arc),0 0 14px -5px var(--wc-arc);}',
    '.wc-swatch-sample{position:relative;width:54px;height:40px;border-radius:7px;overflow:hidden;background:#f4f1ea;}',
    '.wc-sample-line{position:absolute;left:7px;height:4px;border-radius:2px;background:#3a3a3a;}',
    '.wc-sample-line-1{top:9px;width:38px;}',
    '.wc-sample-line-2{top:18px;width:28px;background:#6b6b6b;}',
    '.wc-sample-dot{position:absolute;left:7px;top:26px;width:10px;height:10px;border-radius:50%;background:linear-gradient(135deg,#ff8a3d,#4ee0c8);}',
    '.wc-swatch-filter{position:absolute;inset:0;pointer-events:none;}',
    '.wc-swatch-label{font:600 10px/1 var(--wc-mono);letter-spacing:.5px;text-transform:uppercase;color:var(--wc-dim);}',
    '.wc-swatch.on .wc-swatch-label{color:var(--wc-arc);}'
  ].join('\n'));

  // (modules B–H appended below)

  // ============================================================ TOP NAVIGATION BAR + DRAWER
  // We add our tabs to the page's top navigation. Perchance already has its own
  // in-flow menu bar (#menuBarEl) — so when it's present we inject our tabs INTO
  // it as native-styled items: one bar, no overlap, nothing covered. Only when
  // there's no Perchance bar (minimal-mode / bare pages) do we inject our own
  // slim bar and push the page down. Clicking a tab opens a drawer beneath it.
  var WC_TAB = null; // null = drawer closed
  function perchanceBar() {
    var b = document.getElementById('menuBarEl');
    // only use it if it's actually visible (it's hidden in minimal mode)
    if (b && b.offsetParent !== null && getComputedStyle(b).display !== 'none') return b;
    return null;
  }
  function buildBar() {
    if ($('.wc-weld-item')) return;
    var host = perchanceBar();
    if (!host) return; // no Perchance bar here — stay out of the way ('/' still opens the drawer)
    // Add EXACTLY ONE native-style item, like any other Perchance menu item. We
    // never inject a competing bar or displace Perchance's own UI. Everything
    // else (tabs, tools) lives in our own drawer.
    var item = el('div', { class: 'menu-item wc-weld-item', title: 'Weld Companion  ( / )',
      onclick: function () { toggleDrawer(); } }, [
      el('span', { class: 'menu-item-icon', text: '\u26A1' }),
      el('span', { class: 'menu-item-label', text: 'Weld' })
    ]);
    // Insert to the LEFT of Perchance's Edit button so we never land at the far
    // end of the bar (where we could overlap the minimize / minimal-mode button).
    var editBtn = host.querySelector('.edit-generator-button, .menu-item.edit, [class*="edit-generator"]');
    if (editBtn && editBtn.parentNode === host) host.insertBefore(item, editBtn);
    else host.appendChild(item); // fallback: no Edit button found (e.g. not the owner)
    document.addEventListener('keydown', winKeys);
  }
  function tabDefs() {
    return [
      { id: 'generators', glyph: '\u2605', label: 'Generators' },
      { id: 'library', glyph: '\u{1F4D2}', label: 'Library' },
      { id: 'data', glyph: '\u{1F5C3}', label: 'Data' },
      { id: 'github', glyph: '\u21C5', label: 'GitHub' },
      { id: 'comfort', glyph: '\u{1F441}', label: 'Comfort' },
      { id: 'snippets', glyph: '\u2702', label: 'Snippets' },
      { id: 'tools', glyph: '\u{1F6E0}', label: 'Tools' }
    ];
  }
  function weldItem() { return $('.wc-weld-item'); }
  function winKeys(e) { if (e.key === 'Escape' && WC_TAB) { e.preventDefault(); closeDrawer(); } }
  function closeDrawer() {
    WC_TAB = null;
    var d = $('#wc-drawer'); if (d) d.remove();
    var sc = $('#wc-scrim'); if (sc) sc.remove();
    var wi = weldItem(); if (wi) wi.classList.remove('wc-on');
  }
  // openWindow(tab) is the public entry (shortcuts, etc.)
  function openWindow(tab) { openDrawer(tab || 'generators'); }
  function toggleDrawer() { if (WC_TAB) closeDrawer(); else openDrawer('generators'); }
  function openDrawer(tab) {
    WC_TAB = tab || WC_TAB || 'generators';
    var wi = weldItem(); if (wi) wi.classList.add('wc-on');
    if (!$('#wc-drawer')) {
      var scrim = el('div', { class: 'wc-root wc-scrim', id: 'wc-scrim', onclick: closeDrawer });
      // header: brand + (result tools, when output exists) + close
      var tabsStrip = el('div', { class: 'wc-menu', id: 'wc-menu' }, tabDefs().map(function (d) {
        return el('div', { class: 'wc-tab', 'data-tab': d.id, onclick: function () { setTab(d.id); } }, [
          el('span', { class: 'wc-ti', text: d.glyph }), el('span', { text: d.label })
        ]);
      }));
      var drawer = el('div', { class: 'wc-root wc-drawer', id: 'wc-drawer' }, [
        el('div', { class: 'wc-titlebar' }, [
          el('span', { class: 'wc-brand' }, [ el('span', { class: 'wc-dot' }), el('span', { text: 'Weld Companion' }) ]),
          el('span', { class: 'wc-tools', id: 'wc-tools' }),
          el('button', { class: 'wc-close', title: 'Close (Esc)', text: '\u2715', onclick: closeDrawer })
        ]),
        tabsStrip,
        el('div', { class: 'wc-body', id: 'wc-body' })
      ]);
      document.body.appendChild(scrim);
      document.body.appendChild(drawer);
    }
    setTab(WC_TAB);
    positionDrawer();
    renderResultTools();
  }
  function setTab(id) {
    WC_TAB = id;
    var menu = $('#wc-menu');
    if (menu) $$('.wc-tab', menu).forEach(function (t) { t.classList.toggle('wc-on', t.getAttribute('data-tab') === id); });
    renderTab();
  }
  function positionDrawer() {
    var drawer = $('#wc-drawer'), scrim = $('#wc-scrim'); if (!drawer) return;
    var top = 8, host = perchanceBar();
    if (host) { var r = host.getBoundingClientRect(); top = Math.max(0, r.bottom); }
    drawer.style.top = top + 'px';
    drawer.style.maxHeight = 'calc(100vh - ' + (top + 16) + 'px)';
    if (scrim) scrim.style.top = top + 'px';
  }
  function renderTab() {
    var body = $('#wc-body'); if (!body) return;
    body.innerHTML = '';
    if (WC_TAB === 'generators') renderGenerators(body);
    else if (WC_TAB === 'library') renderLibrary(body);
    else if (WC_TAB === 'data') renderData(body);
    else if (WC_TAB === 'github') renderGitHub(body);
    else if (WC_TAB === 'comfort') renderComfort(body);
    else if (WC_TAB === 'snippets') renderSnippets(body);
    else if (WC_TAB === 'tools') renderTools(body);
  }
  function renderData(body) {
    var h = window.weldDataManager;
    if (h && typeof h.renderTab === 'function') { try { h.renderTab(body); return; } catch (e) {} }
    body.appendChild(el('div', { class: 'wc-section-note', text: 'Data Manager module not loaded.' }));
  }
  function renderLibrary(body) {
    var h = window.weldLibrary;
    if (h && typeof h.renderTab === 'function') { try { h.renderTab(body); return; } catch (e) {} }
    body.appendChild(el('div', { class: 'wc-section-note', text: 'Library module not loaded.' }));
  }
  function renderTools(body) {
    var grid = el('div', { class: 'wc-cols' });
    var aiCard = el('div', { class: 'wc-card wc-col' });
    aiCard.appendChild(el('label', { class: 'wc-label', text: '\uD83E\uDD16 AI Helper' }));
    var aiBody = el('div', {}); aiCard.appendChild(aiBody);
    try { renderAI(aiBody); } catch (e) { aiBody.appendChild(el('div', { class: 'wc-section-note', text: 'AI Helper failed to render.' })); }
    var cfCard = el('div', { class: 'wc-card wc-col' });
    cfCard.appendChild(el('label', { class: 'wc-label', text: '\uD83D\uDC64 Character files \u00b7 AI Character Chat' }));
    var cfBody = el('div', {}); cfCard.appendChild(cfBody);
    var t = window.weldAICCTools;
    if (t && typeof t.renderCharacterFilesCard === 'function') { try { t.renderCharacterFilesCard(cfBody); } catch (e2) { cfBody.appendChild(el('div', { class: 'wc-section-note', text: 'Character tools failed to render.' })); } }
    else cfBody.appendChild(el('div', { class: 'wc-section-note', text: 'Character tools module not loaded.' }));
    grid.appendChild(aiCard); grid.appendChild(cfCard);
    body.appendChild(grid);
  }
  try {
    window.weldHooks = Object.assign(window.weldHooks || {}, {
      outputText: function () { var o = outputNode(); return o ? nodeToText(o) : ''; },
      comfortGet: function () { return comfortSettings(); },
      comfortSet: function (v) { gset('comfort:' + genName(), v); gset('comfort:_default', v); },
      applyComfort: function () { applyComfort(); }
    });
  } catch (e) {}

  // ============================================================ B. favorites & recently-used
  function recordVisit() {
    var name = genName();
    if (!name) return;
    if (isEditMode()) return; // only count viewer visits
    var recent = gget('recent', []);
    recent = recent.filter(function (r) { return r.name !== name; });
    recent.unshift({ name: name, t: Date.now(), title: (document.title || name).replace(/ ― Perchance.*$/, '').trim() });
    if (recent.length > 60) recent = recent.slice(0, 60);
    gset('recent', recent);
  }
  function favorites() { return gget('favorites', []); }
  function isFav(name) { return favorites().indexOf(name) !== -1; }
  function toggleFav(name) {
    var f = favorites(); var i = f.indexOf(name);
    if (i === -1) f.push(name); else f.splice(i, 1);
    gset('favorites', f); return i === -1;
  }

  // Per-generator quick actions for the OPEN generator -- real buttons, not a gear.
  // GitHub sync has its own tab; this row is edit / save / backups / rename / delete.
  function renderThisGenerator(body) {
    var name = genName();
    var sec = el('div', { class: 'wc-thisgen' });
    sec.appendChild(el('label', { class: 'wc-label', text: 'This Generator' }));
    if (!name) {
      sec.appendChild(el('div', { class: 'wc-section-note', text: 'Open a generator (its #edit page) for Save, Backups, Rename, Delete, and GitHub sync.' }));
      body.appendChild(sec);
      return;
    }
    sec.appendChild(el('div', { class: 'wc-row', style: { alignItems: 'center' } }, [
      el('span', { class: 'wc-gslug', style: { flex: '1', minWidth: '0' }, text: name }),
      el('button', { class: 'wc-btn wc-mini', text: 'edit', title: 'Open this generator\u2019s editor', onclick: function () { location.href = 'https://perchance.org/' + name + '#edit'; } }),
      el('button', { class: 'wc-btn wc-btn-accent wc-mini', text: '\u21C5 GitHub', title: 'Pull / Push this generator (GitHub tab)', onclick: function () { setTab('github'); } })
    ]));
    var actions = el('div', { class: 'wc-row', style: { marginTop: '8px', flexWrap: 'wrap' } }, [
      el('button', { class: 'wc-btn', text: 'Save', title: 'Save the generator (Ctrl/Cmd+S in the editor)', onclick: doSave }),
      el('button', { class: 'wc-btn', text: 'Lint JS', title: 'Check the HTML pane\u2019s <script> blocks for JavaScript errors', onclick: lintNow }),
      el('button', { class: 'wc-btn', text: 'Find bugs (AI)', title: 'Send the active pane to Perchance\u2019s AI bug reviewer', onclick: aiBugCheck }),
      el('button', { class: 'wc-btn', text: 'Backups\u2026', title: 'Browse local backups \u2014 download or restore', onclick: openBackupBrowser })
    ]);
    var sm0 = pageSettingsModal();
    if (sm0 && typeof sm0.changeGeneratorName === 'function') actions.appendChild(el('button', { class: 'wc-btn', text: 'Rename\u2026', title: 'Rename this generator (Perchance\u2019s own rename)', onclick: renameThisGenerator }));
    if (sm0 && typeof sm0.deleteGenerator === 'function') actions.appendChild(el('button', { class: 'wc-btn', style: { color: '#e70000', borderColor: '#e70000' }, text: 'Delete\u2026', title: 'Delete this generator \u2014 permanent (Perchance\u2019s own delete)', onclick: deleteThisGenerator }));
    sec.appendChild(actions);
    if (isEditMode()) {
      var pf = savePreflight();
      sec.appendChild(el('div', { class: 'wc-section-note', style: { marginTop: '6px', cursor: 'pointer' },
        title: 'What will Save do? (click for detail)', text: '\u24D8 ' + pf.label, onclick: explainSave }));
    }
    body.appendChild(sec);
  }

  // ============================================================ B2. GitHub sync (own tab)
  function renderGitHub(body) {
    function note(t) { return el('div', { class: 'wc-section-note', text: t }); }
    function field(val, aria, ph) { return el('input', { class: 'wc-field', type: 'text', value: val, placeholder: ph || '', 'aria-label': aria, title: aria }); }
    function row(kids, mt) { return el('div', { class: 'wc-row', style: { marginTop: (mt == null ? 8 : mt) + 'px' } }, kids); }
    function head(t) { return el('div', { class: 'wc-subhead', text: t }); }

    var name = genName();
    var map = gget('githubMap', {}) || {}, base = ghCfg();
    body.appendChild(el('label', { class: 'wc-label', text: 'GitHub sync' }));

    var cols = el('div', { class: 'wc-cols' });
    var colA = el('div', { class: 'wc-col' });   // per-generator
    var colB = el('div', { class: 'wc-col' });   // global settings

    if (name) {
      var ov = map[name] || {}, R = ghResolve(name);
      var dslIn = field(R.cfg.dslPath, 'DSL / top-panel file path ({name} = slug)');
      var htmlIn = field(R.cfg.htmlPath, 'HTML-panel file path ({name} = slug)');
      var ownerIn = field(ov.owner || '', 'owner override for this generator', base.owner ? 'owner = ' + base.owner : 'owner');
      var repoIn = field(ov.repo || '', 'repo override for this generator', base.repo ? 'repo = ' + base.repo : 'repo');
      var branchIn = field(ov.branch || '', 'branch override for this generator', base.branch ? 'branch = ' + base.branch : 'branch');
      var applyUrlToField = function (inp) {
        var p = parseGitHubUrl(inp.value); if (!p) return false;
        if (p.owner) ownerIn.value = p.owner; if (p.repo) repoIn.value = p.repo; if (p.branch) branchIn.value = p.branch; if (p.path) inp.value = p.path; return true;
      };
      dslIn.addEventListener('change', function () { if (applyUrlToField(dslIn)) toast('Filled owner / repo / branch + DSL path from the URL'); });
      htmlIn.addEventListener('change', function () { if (applyUrlToField(htmlIn)) toast('Filled owner / repo / branch + HTML path from the URL'); });
      var liveOver = function () {
        applyUrlToField(dslIn); applyUrlToField(htmlIn);
        var o = { dslPath: dslIn.value.trim(), htmlPath: htmlIn.value.trim() };
        if (ownerIn.value.trim()) o.owner = ownerIn.value.trim();
        if (repoIn.value.trim()) o.repo = repoIn.value.trim();
        if (branchIn.value.trim()) o.branch = branchIn.value.trim();
        return o;
      };
      var saveMapping = function () { var m = gget('githubMap', {}) || {}; m[name] = liveOver(); gset('githubMap', m); toast('Saved mapping for ' + name); renderTab(); };
      var resetMapping = function () { var m = gget('githubMap', {}) || {}; delete m[name]; gset('githubMap', m); toast('Reset ' + name + ' to defaults'); renderTab(); };

      // full-width sync row, above the columns
      body.appendChild(el('div', { class: 'wc-row', style: { alignItems: 'center', marginBottom: '4px' } }, [
        el('span', { class: 'wc-gslug', style: { flex: '1', minWidth: '0' }, text: name + (map[name] ? '  \u00b7  custom' : '') }),
        el('button', { class: 'wc-btn wc-btn-accent', text: '\u2B07 Pull', title: 'Fetch this generator\u2019s files into the editor (you then Save)', onclick: function () { pullFromGitHub(liveOver()); } }),
        el('button', { class: 'wc-btn', text: '\u2B06 Push', title: 'Commit the editor contents to GitHub (asks first)', onclick: function () { pushToGitHub(liveOver()); } }),
        el('button', { class: 'wc-btn', text: '\u21C4 Diff', title: 'Compare the editor against the GitHub version (nothing is written)', onclick: function () { diffVsGitHub(liveOver()); } })
      ]));

      var cardA = el('div', { class: 'wc-card' });
      cardA.appendChild(head('Files for this generator'));
      cardA.appendChild(note('Where this generator\u2019s two files live in your repo. Paste a path \u2014 or a full raw.githubusercontent.com / github.com file URL and it auto-fills owner / repo / branch. \u201C{name}\u201D = this slug (' + name + ').'));
      cardA.appendChild(el('div', { class: 'wc-section-note', text: 'DSL / top panel \u2014 path or raw URL:' }));
      cardA.appendChild(dslIn);
      cardA.appendChild(el('div', { class: 'wc-section-note', text: 'HTML panel \u2014 path or raw URL:' }));
      cardA.appendChild(htmlIn);
      cardA.appendChild(note('Owner / repo / branch \u2014 optional. Fill only to point THIS generator at a different repo than your defaults.'));
      cardA.appendChild(row([ownerIn, repoIn, branchIn]));
      cardA.appendChild(row([
        el('button', { class: 'wc-btn', text: 'Save mapping', title: 'Remember these paths for this slug', onclick: saveMapping }),
        el('button', { class: 'wc-btn', text: 'Reset', title: 'Use the global defaults', onclick: resetMapping })
      ]));
      var bchk = el('input', { type: 'checkbox', id: 'wc-gh-backup', style: { margin: '0 8px 0 0' } });
      bchk.checked = gget('ghBackupBeforePull', true);
      bchk.onchange = function () { gset('ghBackupBeforePull', !!bchk.checked); };
      cardA.appendChild(el('div', { class: 'wc-row', style: { alignItems: 'center', marginTop: '8px' } }, [
        bchk,
        el('label', { class: 'wc-section-note', for: 'wc-gh-backup', style: { flex: '1', margin: '0', cursor: 'pointer' }, text: 'Download a local backup before each Pull' })
      ]));
      colA.appendChild(cardA);
    } else {
      colA.appendChild(el('div', { class: 'wc-card' }, [note('Open a generator (its #edit page) to Pull or Push it. You can still set your token and repo defaults \u2192')]));
    }

    var cardTok = el('div', { class: 'wc-card' });
    cardTok.appendChild(head('GitHub push token'));
    cardTok.appendChild(note('Push commits the editor to GitHub, which needs a Personal Access Token. Use a fine-grained token scoped to this one repo with Contents: read & write. Stored locally; sent only to api.github.com; never logged.'));
    var tokIn = el('input', { class: 'wc-field', type: 'password', placeholder: ghToken() ? '\u2022\u2022\u2022\u2022 token saved \u2014 type to replace' : 'github_pat_\u2026 / ghp_\u2026', 'aria-label': 'GitHub personal access token', autocomplete: 'off' });
    cardTok.appendChild(tokIn);
    cardTok.appendChild(row([
      el('button', { class: 'wc-btn', text: 'Save token', title: 'Store the token locally for Push', onclick: function () { var v = tokIn.value.trim(); if (!v) { toast('Paste a token first'); return; } gset('ghToken', v); tokIn.value = ''; tokIn.placeholder = '\u2022\u2022\u2022\u2022 token saved \u2014 type to replace'; toast('GitHub token saved'); } }),
      el('button', { class: 'wc-btn', text: 'Clear token', title: 'Remove the stored token', onclick: function () { gdel('ghToken'); tokIn.value = ''; tokIn.placeholder = 'github_pat_\u2026 / ghp_\u2026'; toast('GitHub token cleared'); } })
    ]));
    colB.appendChild(cardTok);

    var cardLint = el('div', { class: 'wc-card' });
    cardLint.appendChild(head('Code checks'));
    cardLint.appendChild(note('Lints the HTML pane\u2019s <script> blocks for JavaScript syntax errors (Perchance\u2019s own ESLint) plus Perchance parser traps the JS linter can\u2019t see \u2014 unicode-brace escapes, import patterns, and brace/bracket HTML entities. Runs before Save and is flagged in the Push dialog.'));
    var lchk = el('input', { type: 'checkbox', id: 'wc-lint-save', style: { margin: '0 8px 0 0' } });
    lchk.checked = gget('lintOnSave', true);
    lchk.onchange = function () { gset('lintOnSave', !!lchk.checked); toast('Lint before Save: ' + (lchk.checked ? 'ON' : 'OFF')); };
    cardLint.appendChild(el('div', { class: 'wc-row', style: { alignItems: 'center', marginTop: '4px' } }, [
      lchk,
      el('label', { class: 'wc-section-note', for: 'wc-lint-save', style: { flex: '1', margin: '0', cursor: 'pointer' }, text: 'Lint JS before each Save (warn on errors)' })
    ]));
    cardLint.appendChild(row([ el('button', { class: 'wc-btn', text: 'Lint JS now', title: 'Check the HTML pane\u2019s <script> blocks now', onclick: lintNow }), el('button', { class: 'wc-btn', text: 'Find bugs (AI)', title: 'AI review of the active pane via Perchance\u2019s editor copilot', onclick: aiBugCheck }) ]));
    colB.appendChild(cardLint);

    var gOwner = field(base.owner, 'default owner (all generators)', 'github username');
    var gRepo = field(base.repo, 'default repo', 'repository name');
    var gBranch = field(base.branch, 'default branch', 'main');
    var gDsl = field(base.dslPath, 'default DSL path template ({name} = slug)');
    var gHtml = field(base.htmlPath, 'default HTML path template ({name} = slug)');
    var applyUrlToTemplate = function (inp) {
      var p = parseGitHubUrl(inp.value); if (!p) return false;
      if (p.owner) gOwner.value = p.owner; if (p.repo) gRepo.value = p.repo; if (p.branch) gBranch.value = p.branch;
      if (p.path) inp.value = name ? p.path.split(name).join('{name}') : p.path; return true;
    };
    gDsl.addEventListener('change', function () { if (applyUrlToTemplate(gDsl)) toast('Filled defaults + made a {name} template from the URL'); });
    gHtml.addEventListener('change', function () { if (applyUrlToTemplate(gHtml)) toast('Filled defaults + made a {name} template from the URL'); });
    var saveDefaults = function () {
      gset('github', {
        owner: gOwner.value.trim() || GH_DEFAULTS.owner, repo: gRepo.value.trim() || GH_DEFAULTS.repo,
        branch: gBranch.value.trim() || GH_DEFAULTS.branch, dslPath: gDsl.value.trim() || GH_DEFAULTS.dslPath,
        htmlPath: gHtml.value.trim() || GH_DEFAULTS.htmlPath
      });
      toast('Repo defaults saved'); renderTab();
    };
    var cardDef = el('div', { class: 'wc-card' });
    cardDef.appendChild(head('Repo defaults (all generators)'));
    cardDef.appendChild(note('Set once and every generator uses them. Tip: paste a raw file URL into a template box \u2014 it fills owner / repo / branch and rewrites the path as a {name} template.'));
    cardDef.appendChild(row([gOwner, gRepo, gBranch]));
    cardDef.appendChild(el('div', { class: 'wc-section-note', text: 'DSL path template \u2014 path or raw URL:' }));
    cardDef.appendChild(gDsl);
    cardDef.appendChild(el('div', { class: 'wc-section-note', text: 'HTML path template \u2014 path or raw URL:' }));
    cardDef.appendChild(gHtml);
    cardDef.appendChild(row([el('button', { class: 'wc-btn', text: 'Save defaults', title: 'Owner / repo / branch + path templates for every generator', onclick: saveDefaults })]));
    colB.appendChild(cardDef);

    cols.appendChild(colA);
    cols.appendChild(colB);
    body.appendChild(cols);
  }

  function renderGenerators(body) {
    var sort = gget('mgrSort', 'recent');
    var filter = '';
    var dir = gget('directory', null);
    var search = el('input', { class: 'wc-field', type: 'text', placeholder: 'Search your generators\u2026   \u2191\u2193 move \u00b7 \u21b5 open' });
    var sortSel = el('select', { class: 'wc-field', style: { maxWidth: '128px', flex: 'none' } }, [['recent', 'Recent'], ['name', 'A\u2192Z'], ['fav', 'Favorites'], ['folder', 'Folders']].map(function (o) { var op = el('option', { value: o[0], text: o[1] }); if (o[0] === sort) op.selected = true; return op; }));
    var loadBtn = el('button', { class: 'wc-btn wc-mini', title: 'Load all your generators from Perchance, grouped by your folders', text: dir ? '\u21bb ' + (dir.names ? dir.names.length : 'All') : 'Load all', onclick: function () { loadDirectory(function (ok) { if (ok) { dir = gget('directory', null); loadBtn.textContent = '\u21bb ' + (dir.names ? dir.names.length : 'All'); sort = 'folder'; sortSel.value = 'folder'; gset('mgrSort', 'folder'); build(); } }); } });
    var clearBtn = el('button', { class: 'wc-btn wc-mini', text: 'Clear', title: 'Clear your visited-generator history (favorites are kept)', onclick: function () { if (confirm('Clear your visited-generator history? Favorites are kept.')) { gset('recent', []); build(); toast('History cleared'); } } });
    var listEl = el('ul', { class: 'wc-list wc-grid' });
    var rows = [], sel = 0;
    function fkey(f) { return f === 'uncategorized' ? '\uffff' : (f || '\ufffe'); }
    function model() {
      var d = gget('directory', null), fmap = (d && d.folderMap) || {};
      var recent = gget('recent', []), recMap = {};
      recent.forEach(function (r) { recMap[r.name] = r; });
      var seen = {}, items = [];
      function add(name) {
        if (!name || seen[name]) return; seen[name] = 1;
        var r = recMap[name];
        items.push({ name: name, title: r && r.title, fav: isFav(name), t: (r && r.t) || 0, folder: fmap[name] || (d ? 'uncategorized' : null) });
      }
      favorites().forEach(add);
      if (d && d.names) d.names.forEach(add);
      recent.forEach(function (r) { add(r.name); });
      if (filter) items = items.filter(function (i) { return (i.name + (i.title || '') + (i.folder || '')).toLowerCase().indexOf(filter.toLowerCase()) !== -1; });
      if (sort === 'name') items.sort(function (a, b) { return a.name.localeCompare(b.name); });
      else if (sort === 'fav') items.sort(function (a, b) { return (b.fav ? 1 : 0) - (a.fav ? 1 : 0); });
      else if (sort === 'folder') items.sort(function (a, b) { return fkey(a.folder) === fkey(b.folder) ? a.name.localeCompare(b.name) : fkey(a.folder).localeCompare(fkey(b.folder)); });
      else items.sort(function (a, b) { return (b.t || 0) - (a.t || 0); });
      return items;
    }
    function build() {
      listEl.innerHTML = ''; rows = [];
      var items = model();
      if (!items.length) { listEl.appendChild(el('li', { class: 'wc-gslug wc-span', text: filter ? 'No matches.' : 'Hit \u201CLoad all\u201D for your whole directory, or visit generators to populate this list.' })); return; }
      var lastFolder = null;
      items.slice(0, 300).forEach(function (it, idx) {
        if (sort === 'folder' && it.folder && it.folder !== lastFolder) {
          lastFolder = it.folder;
          listEl.appendChild(el('li', { class: 'wc-gslug wc-span', style: { fontWeight: '700', opacity: '0.65', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '8px 4px 2px', cursor: 'default' }, text: it.folder }));
        }
        var star = el('span', { class: 'wc-star' + (isFav(it.name) ? ' on' : ''), text: '\u2605', onclick: function (e) { e.stopPropagation(); var on = toggleFav(it.name); star.classList.toggle('on', on); } });
        var open = el('button', { class: 'wc-btn wc-mini', text: 'open', onclick: function (e) { e.stopPropagation(); location.href = 'https://perchance.org/' + it.name; } });
        var edit = el('button', { class: 'wc-btn wc-mini', text: 'edit', onclick: function (e) { e.stopPropagation(); location.href = 'https://perchance.org/' + it.name + '#edit'; } });
        var forget = el('button', { class: 'wc-btn wc-mini', text: '\u2715', title: 'Remove from your visited list', onclick: function (e) { e.stopPropagation(); var r = gget('recent', []).filter(function (x) { return x.name !== it.name; }); gset('recent', r); build(); } });
        var li = el('li', { onclick: function () { location.href = 'https://perchance.org/' + it.name; } }, [star, el('span', { class: 'wc-gname', text: it.title || it.name }), el('span', { class: 'wc-gslug', text: it.name }), open, edit, forget]);
        var ri = rows.length;
        if (ri === 0) li.classList.add('wc-sel');
        listEl.appendChild(li); rows.push(li);
      });
    }
    function highlight() { rows.forEach(function (r, i) { r.classList.toggle('wc-sel', i === sel); }); }
    search.addEventListener('input', function () { filter = search.value; sel = 0; build(); });
    sortSel.addEventListener('change', function () { sort = sortSel.value; gset('mgrSort', sort); build(); });
    search.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, rows.length - 1); highlight(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); highlight(); e.preventDefault(); }
      else if (e.key === 'Enter' && rows[sel]) rows[sel].click();
    });
    var crud = el('div', { class: 'wc-foot' }, [
      el('div', { class: 'wc-row' }, [
        el('button', { class: 'wc-btn wc-btn-accent', text: '\uFF0B New', title: 'Start a new generator', onclick: function () { window.open('https://perchance.org/minimal#edit', '_blank'); } }),
        el('button', { class: 'wc-btn', text: 'Fork this', title: 'Open this generator\u2019s editor to copy it', onclick: function () { if (genName()) location.href = 'https://perchance.org/' + genName() + '#edit'; else toast('Open a generator first'); } })
      ]),
      el('div', { class: 'wc-section-note', text: 'Favorites, generators you\u2019ve opened, and \u2014 via Load all \u2014 your whole Perchance directory grouped by your folders. Save / rename / delete the open one are up top; GitHub sync is its own tab.' })
    ]);
    renderThisGenerator(body);
    body.appendChild(el('div', { class: 'wc-row', style: { marginBottom: '12px' } }, [ el('div', { style: { flex: '1' } }, [search]), sortSel, loadBtn, clearBtn ]));
    body.appendChild(listEl);
    body.appendChild(crud);
    build();
    setTimeout(function () { try { search.focus(); } catch (e) {} }, 30);
  }

  // ============================================================ C. theme / reading comfort
  function comfortSettings() { return gget('comfort:' + genName(), gget('comfort:_default', {})); }
  // Themes via a fixed, click-through overlay using backdrop-filter. This filters
  // the ENTIRE page behind it reliably (any DOM, any generator) without touching
  // layout or colours we can't see. Our own UI sits above the overlay (higher
  // z-index) so it stays clean. This is why it always works, where forcing
  // body/output colours did not.
  var THEME_FILTERS = {
    off:   '',
    dim:   'brightness(.85)',
    warm:  'sepia(.4) brightness(.98)',
    sepia: 'sepia(.7) contrast(.95) brightness(.95)',
    gray:  'grayscale(1)',
    dark:  'invert(.92) hue-rotate(180deg)'
  };
  function applyComfort() {
    var c = comfortSettings();
    document.body.classList.toggle('wc-focus', !!c.focus);
    document.body.style.fontFamily = c.dyslexic ? '"OpenDyslexic","Comic Sans MS",system-ui,sans-serif' : '';

    // best-effort reading typography on the output (harmless if it misses)
    var prev = document.getElementById('wc-comfort-styles'); if (prev) prev.remove();
    if (c.enabled) {
      var s = document.createElement('style'); s.id = 'wc-comfort-styles';
      var css = '#output,.generatorOutput,[id*="output" i]:not([id*="weld" i]):not([id*="wc" i]){' +
        'max-width:' + (c.width || 720) + 'px !important;margin-left:auto !important;margin-right:auto !important;' +
        'font-size:' + (c.font || 16) + 'px !important;line-height:' + (c.lh || 1.6) + ' !important;}';
      if (c.editor) {
        // Comfortable typography on the CodeMirror panes (#edit page). Size + line
        // height only -- never font-family, so indentation stays monospace and the
        // whitespace-sensitive DSL still reads true. Gutters match so line numbers align.
        css += '.cm-content,.cm-gutters,.cm-lineNumbers{font-size:' + (c.font || 16) + 'px !important;line-height:' + (c.lh || 1.6) + ' !important;}';
      }
      s.textContent = css;
      document.head.appendChild(s);
    }

    // theme overlay
    var filter = THEME_FILTERS[c.theme || 'off'] || '';
    var ov = document.getElementById('wc-theme-overlay');
    if (!filter) { if (ov) ov.remove(); return; }
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'wc-theme-overlay'; ov.className = 'wc-theme-overlay';
      document.body.appendChild(ov);
    }
    ov.style.webkitBackdropFilter = filter;
    ov.style.backdropFilter = filter;
  }
  function renderComfort(body) {
    var c = comfortSettings();
    function field(label, node) { return el('div', {}, [el('label', { class: 'wc-label', text: label }), node]); }
    function toggle(node, labelText) { return el('label', { class: 'wc-check' }, [node, el('span', { class: 'wc-sw' }), el('span', { text: labelText })]); }

    // ---- theme swatches (each previews its ACTUAL backdrop-filter effect) ----
    var THEMES = [
      { id: 'off',   label: 'Off' },
      { id: 'dim',   label: 'Dim' },
      { id: 'warm',  label: 'Warm' },
      { id: 'sepia', label: 'Sepia' },
      { id: 'gray',  label: 'Gray' },
      { id: 'dark',  label: 'Dark' }
    ];
    var curTheme = c.theme || 'off';
    var swatchEls = [];
    var swatchRow = el('div', { class: 'wc-swatch-row' });
    THEMES.forEach(function (th) {
      var filterStr = THEME_FILTERS[th.id] || '';
      // a mini "page" (text lines + a colour dot) with the theme filter laid over it
      var sample = el('div', { class: 'wc-swatch-sample' }, [
        el('span', { class: 'wc-sample-line wc-sample-line-1' }),
        el('span', { class: 'wc-sample-line wc-sample-line-2' }),
        el('span', { class: 'wc-sample-dot' }),
        el('span', { class: 'wc-swatch-filter', style: { backdropFilter: filterStr, webkitBackdropFilter: filterStr } })
      ]);
      var sw = el('div', { class: 'wc-swatch' + (curTheme === th.id ? ' on' : ''), title: th.label,
        onclick: function () {
          curTheme = th.id;
          swatchEls.forEach(function (s) { s.classList.remove('on'); });
          sw.classList.add('on');
          save();
        }
      }, [ sample, el('span', { class: 'wc-swatch-label', text: th.label }) ]);
      swatchEls.push(sw); swatchRow.appendChild(sw);
    });

    var enable = el('input', { type: 'checkbox' }); enable.checked = !!c.enabled;
    var focusCb = el('input', { type: 'checkbox' }); focusCb.checked = !!c.focus;
    var dysCb = el('input', { type: 'checkbox' }); dysCb.checked = !!c.dyslexic;
    var editorCb = el('input', { type: 'checkbox' }); editorCb.checked = !!c.editor;
    var font  = el('input', { class: 'wc-field', type: 'number', value: c.font  || 16,  min: '11',  max: '32',   step: '1' });
    var width = el('input', { class: 'wc-field', type: 'number', value: c.width || 720, min: '360', max: '1400', step: '20' });
    var lh    = el('input', { class: 'wc-field', type: 'number', value: c.lh    || 1.6, min: '1.1', max: '2.4',  step: '0.1' });

    function save() {
      var v = { enabled: enable.checked, focus: focusCb.checked, theme: curTheme,
                font: +font.value, width: +width.value, lh: +lh.value, dyslexic: dysCb.checked, editor: editorCb.checked };
      gset('comfort:' + genName(), v); gset('comfort:_default', v); applyComfort();
    }
    [enable, focusCb, dysCb, editorCb, font, width, lh].forEach(function (n) {
      n.addEventListener('change', save); n.addEventListener('input', save);
    });

    body.appendChild(toggle(enable, 'Apply comfort layout'));

    var cols = el('div', { class: 'wc-cols', style: { marginTop: '12px' } });
    var cardTheme = el('div', { class: 'wc-card wc-col' });
    cardTheme.appendChild(el('label', { class: 'wc-label', text: 'Theme & typography' }));
    cardTheme.appendChild(swatchRow);
    cardTheme.appendChild(el('div', { class: 'wc-row', style: { marginTop: '8px' } }, [
      el('div', { style: { flex: '1' } }, [field('Font size', font)]),
      el('div', { style: { flex: '1' } }, [field('Line height', lh)])
    ]));
    cardTheme.appendChild(field('Max width px', width));

    var cardOpts = el('div', { class: 'wc-card wc-col' });
    cardOpts.appendChild(el('label', { class: 'wc-label', text: 'Options' }));
    cardOpts.appendChild(el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
      toggle(dysCb,   'Dyslexia-friendly font'),
      toggle(editorCb, 'Also size the code editor (#edit panes)'),
      toggle(focusCb, 'Focus mode (hide menus & sidebar)')
    ]));

    cols.appendChild(cardTheme);
    cols.appendChild(cardOpts);
    body.appendChild(cols);

    body.appendChild(el('div', { class: 'wc-foot' }, [
      el('div', { class: 'wc-row' }, [
        el('button', { class: 'wc-btn', text: 'Reset to defaults', onclick: function () { gdel('comfort:' + genName()); applyComfort(); renderTab(); } })
      ]),
      el('div', { class: 'wc-section-note', text: genName() ? 'Settings are remembered per generator.' : 'Open a generator to save per-generator.' })
    ]));
  }

  // ============================================================ C2. snippet inserter tab
  function renderSnippets(body) {
    var onEdit = isCmView(dslView()) || isCmView(htmlView());
    body.appendChild(el('div', { class: 'wc-section-note', text: onEdit
      ? 'Click a snippet to drop it at the cursor in the matching pane.'
      : 'Open a generator\u2019s #edit page to insert \u2014 each snippet drops boilerplate at your cursor.' }));

    function groupCard(title, pane) {
      var card = el('div', { class: 'wc-card wc-col' });
      card.appendChild(el('label', { class: 'wc-label', text: title }));
      var list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '7px', marginTop: '6px' } });
      SNIPPETS.filter(function (s) { return s.pane === pane; }).forEach(function (s) {
        list.appendChild(el('button', { class: 'wc-btn', style: { textAlign: 'left', lineHeight: '1.3' },
          title: 'Insert at cursor', onclick: function () { insertSnippet(s); } }, [
          el('span', { text: s.label }),
          el('span', { class: 'wc-section-note', style: { display: 'block', marginTop: '2px' }, text: s.desc })
        ]));
      });
      card.appendChild(list);
      return card;
    }

    var cols = el('div', { class: 'wc-cols', style: { marginTop: '10px' } });
    cols.appendChild(groupCard('DSL \u2014 top panel', 'dsl'));
    cols.appendChild(groupCard('HTML panel \u2014 JS', 'html'));
    body.appendChild(cols);
  }

  // ============================================================ D. result tools (copy / save / pin / compare)
  function outputNode() {
    return $('#output') || $('.generatorOutput') || $('[id*="output" i]') || null;
  }
  function nodeToText(node) { return (node.innerText || node.textContent || '').trim(); }
  function copyText(t) {
    try { navigator.clipboard.writeText(t); toast('Copied'); }
    catch (e) { var ta = el('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('Copied'); } catch (e2) { toast('Copy failed'); } ta.remove(); }
  }
  function download(name, text) {
    var blob = new Blob([text], { type: 'text/plain' });
    var a = el('a', { href: URL.createObjectURL(blob), download: name }); document.body.appendChild(a); a.click(); a.remove();
  }
  function pinResult(html) {
    var pins = gget('pins:' + genName(), []);
    pins.unshift({ html: html, t: Date.now() }); if (pins.length > 12) pins = pins.slice(0, 12);
    gset('pins:' + genName(), pins); renderPins();
  }
  function renderPins() {
    var tray = $('.wc-pin-tray'); if (tray) tray.remove();
    var pins = gget('pins:' + genName(), []); if (!pins.length) return;
    tray = el('div', { class: 'wc-root wc-pin-tray' });
    tray.appendChild(el('div', { class: 'wc-pin-trayhead' }, [
      el('span', { text: 'PINNED \u00b7 ' + pins.length }),
      el('span', { class: 'wc-pin-clear', text: 'clear all', onclick: function () { gset('pins:' + genName(), []); renderPins(); } })
    ]));
    pins.slice(0, 6).forEach(function (p, i) {
      var head = el('div', { class: 'wc-pin-head' }, [
        el('span', { class: 'wc-pin-num', text: '#' + (i + 1) }),
        el('span', { class: 'wc-pin-x', text: '\u00d7', title: 'Remove pin', onclick: function () { var arr = gget('pins:' + genName(), []); arr.splice(i, 1); gset('pins:' + genName(), arr); renderPins(); } })
      ]);
      // the pinned result is arbitrary generator HTML; sandbox it visually so it
      // can never blow out the card (clip, clamp height, neutralise stray margins)
      var body = el('div', { class: 'wc-pin-body', html: p.html });
      tray.appendChild(el('div', { class: 'wc-pin' }, [head, body]));
    });
    document.body.appendChild(tray);
  }
  // Result tools (copy / save / pin / history) live in the DRAWER header — not in
  // Perchance's bar. They appear only when the drawer is open AND a generator
  // output exists. This keeps Perchance's bar untouched.
  function renderResultTools() {
    var host = $('#wc-tools'); if (!host) return;
    host.innerHTML = '';
    var out = outputNode(); if (!out) return;
    function toolBtn(glyph, title, fn) {
      return el('button', { class: 'wc-toolbtn', title: title, onclick: fn }, [ el('span', { text: glyph }) ]);
    }
    host.appendChild(toolBtn('\u2398', 'Copy output', function () { var o = outputNode(); if (o) copyText(nodeToText(o)); }));
    host.appendChild(toolBtn('\u2913', 'Save output as .txt', function () { var o = outputNode(); if (o) download(genName() + '-output.txt', nodeToText(o)); }));
    host.appendChild(toolBtn('\u{1F4CC}', 'Pin this result', function () { var o = outputNode(); if (o) { pinResult(o.innerHTML); toast('Pinned'); } }));
    if (histStack.length > 1) {
      var grp = el('span', { class: 'wc-histgroup' }, [
        el('button', { class: 'wc-toolbtn', title: 'Previous result', onclick: function () { if (histPos > 0) { restore(histPos - 1); renderResultTools(); } } }, [ el('span', { text: '\u2190' }) ]),
        el('span', { class: 'wc-histlabel', text: (histPos + 1) + '/' + histStack.length }),
        el('button', { class: 'wc-toolbtn', title: 'Next result', onclick: function () { if (histPos < histStack.length - 1) { restore(histPos + 1); renderResultTools(); } } }, [ el('span', { text: '\u2192' }) ])
      ]);
      host.appendChild(grp);
    }
  }
  function renderHistBar() { if ($('#wc-drawer')) renderResultTools(); }

  // ============================================================ E. result history (undo-reroll)
  var histStack = [], histPos = -1, lastSnap = '';
  function snapshotOutput() {
    var out = outputNode(); if (!out) return;
    var html = out.innerHTML;
    if (!html || html === lastSnap) return;
    lastSnap = html;
    // if we navigated back and a new result appears, drop the redo tail
    if (histPos < histStack.length - 1) histStack = histStack.slice(0, histPos + 1);
    histStack.push(html); if (histStack.length > 50) histStack.shift();
    histPos = histStack.length - 1;
    renderHistBar();
  }
  function restore(i) {
    var out = outputNode(); if (!out || !histStack[i]) return;
    histPos = i; lastSnap = histStack[i]; out.innerHTML = histStack[i]; renderHistBar();
  }

  // ============================================================ F. resizable inputs
  function enhanceInputs() {
    $$('textarea').forEach(function (ta) {
      if (ta.dataset.wcResize) return; ta.dataset.wcResize = '1';
      if (ta.id === 'aiHelperInputEl') return;
      if (ta.closest && ta.closest('.wc-root, [role="dialog"], dialog, [class*="modal" i], [class*="popup" i], [class*="dialog" i], [class*="overlay" i], [class*="settings" i]')) return;
      if (!ta.offsetParent || ta.clientHeight < 40) return;
      ta.style.resize = ta.style.resize || 'vertical';
      // Enter submits / Shift+Enter newline normalization is risky to force globally;
      // instead add an unobtrusive expand button.
      var expand = el('button', { class: 'wc-root wc-expand', text: '\u26F6', title: 'Expand / collapse',
        style: { position: 'absolute', zIndex: '20' },
        onclick: function (e) {
          e.preventDefault();
          if (ta.dataset.wcBig) { ta.style.height = ta.dataset.wcPrev || ''; ta.dataset.wcBig = ''; }
          else { ta.dataset.wcPrev = ta.style.height; ta.style.height = '40vh'; ta.dataset.wcBig = '1'; }
        } });
      if (ta.parentNode && getComputedStyle(ta.parentNode).position === 'static') ta.parentNode.style.position = 'relative';
      try {
        var r = ta.getBoundingClientRect(), pr = ta.parentNode.getBoundingClientRect();
        expand.style.right = '4px'; expand.style.top = '4px';
        ta.parentNode.appendChild(expand);
      } catch (e) {}
    });
  }

  // ============================================================ H. AI provider layer (edit Helper, or use your own GPT)
  // The Perchance AI Helper generates code from a prompt via the built-in
  // ai-text broker. We add two things it lacks:
  //  (1) editing the helper's *instruction* (system prompt) right here, and
  //  (2) routing the request to YOUR OWN model (OpenAI / Anthropic / Google)
  //      with your API key, so you can use a stronger model or your own quota.
  // We never send your key anywhere but the provider you choose.
  var PROVIDERS = {
    openai: {
      label: 'OpenAI (GPT)', keyHint: 'sk-\u2026', defaultModel: 'gpt-4o',
      url: function () { return 'https://api.openai.com/v1/chat/completions'; },
      headers: function (key) { return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }; },
      body: function (model, sys, user, json) { var b = { model: model, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], temperature: 0.7 }; if (json) b.response_format = { type: 'json_object' }; return JSON.stringify(b); },
      extract: function (j) { return j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content; }
    },
    anthropic: {
      label: 'Anthropic (Claude)', keyHint: 'sk-ant-\u2026', defaultModel: 'claude-sonnet-4-20250514',
      url: function () { return 'https://api.anthropic.com/v1/messages'; },
      headers: function (key) { return { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }; },
      body: function (model, sys, user, json) { var msgs = [{ role: 'user', content: user }]; if (json) msgs.push({ role: 'assistant', content: '{' }); return JSON.stringify({ model: model, max_tokens: 4096, system: sys, messages: msgs }); },
      extract: function (j, json) { var t = j && j.content && j.content[0] && j.content[0].text; return (json && typeof t === 'string') ? ('{' + t) : t; }
    },
    google: {
      label: 'Google (Gemini)', keyHint: 'AIza\u2026', defaultModel: 'gemini-1.5-pro',
      url: function (model, key) { return 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key); },
      headers: function () { return { 'Content-Type': 'application/json' }; },
      body: function (model, sys, user, json) { var b = { systemInstruction: { parts: [{ text: sys }] }, contents: [{ role: 'user', parts: [{ text: user }] }] }; if (json) b.generationConfig = { responseMimeType: 'application/json' }; return JSON.stringify(b); },
      extract: function (j) { try { return j.candidates[0].content.parts[0].text; } catch (e) { return null; } }
    }
  };
  function aiConfig() { return gget('ai', { provider: 'builtin', keys: {}, models: {}, instruction: '' }); }
  // D4 consumer: apply a per-call output cap. The bridge has always forwarded maxTokens; the
  // companion now honors it (provider-specific field). Merges, so it co-exists with json mode.
  function sbApplyMaxTokens(provider, b, n) {
    n = n | 0; if (n <= 0 || !b) return;
    if (provider === 'openai') b.max_tokens = n;
    else if (provider === 'anthropic') b.max_tokens = n;          // overrides the default 4096
    else if (provider === 'google') { b.generationConfig = b.generationConfig || {}; b.generationConfig.maxOutputTokens = n; }
  }
  function callOwnAI(cfg, sys, user, cb, json, maxTokens) {
    var p = PROVIDERS[cfg.provider]; if (!p) return cb('Unknown provider', null);
    var key = (cfg.keys || {})[cfg.provider]; if (!key) return cb('No API key set for ' + p.label, null);
    var model = (cfg.models || {})[cfg.provider] || p.defaultModel;
    var bodyStr = p.body(model, sys, user, json);
    if (maxTokens) { try { var bo = JSON.parse(bodyStr); sbApplyMaxTokens(cfg.provider, bo, maxTokens); bodyStr = JSON.stringify(bo); } catch (e) {} }
    GM_xmlhttpRequest({
      method: 'POST', url: p.url(model, key), headers: p.headers(key), data: bodyStr,
      onload: function (res) {
        try { var j = JSON.parse(res.responseText); var txt = p.extract(j, json);
          if (txt) cb(null, txt); else cb('No text in response: ' + res.responseText.slice(0, 200), null);
        } catch (e) { cb('Parse error: ' + e.message, null); }
      },
      onerror: function () { cb('Network error contacting ' + p.label, null); }
    });
  }

  // ---- D3: streaming the own-model completion over the bridge ----------------
  // Per-provider streaming: reuse the D2 body() (incl. json prefill) and add the
  // provider's stream switch; Gemini streams via a different ENDPOINT, not a body flag.
  var STREAM = {
    openai: {
      url: function (m, k) { return PROVIDERS.openai.url(); },
      body: function (m, s, u, j) { var b = JSON.parse(PROVIDERS.openai.body(m, s, u, j)); b.stream = true; return JSON.stringify(b); }
    },
    anthropic: {
      url: function (m, k) { return PROVIDERS.anthropic.url(); },
      body: function (m, s, u, j) { var b = JSON.parse(PROVIDERS.anthropic.body(m, s, u, j)); b.stream = true; return JSON.stringify(b); }
    },
    google: {
      url: function (m, k) { return 'https://generativelanguage.googleapis.com/v1beta/models/' + m + ':streamGenerateContent?alt=sse&key=' + encodeURIComponent(k); },
      body: function (m, s, u, j) { return PROVIDERS.google.body(m, s, u, j); }
    }
  };
  // Pure: pull the text delta out of one parsed SSE data object, per provider. Unit-tested.
  function sbStreamDelta(provider, obj) {
    if (!obj) return '';
    if (provider === 'openai') return (obj.choices && obj.choices[0] && obj.choices[0].delta && obj.choices[0].delta.content) || '';
    if (provider === 'anthropic') return (obj.type === 'content_block_delta' && obj.delta && obj.delta.type === 'text_delta') ? (obj.delta.text || '') : '';
    if (provider === 'google') { try { return obj.candidates[0].content.parts[0].text || ''; } catch (e) { return ''; } }
    return '';
  }
  // Pure: split an SSE buffer into complete 'data:' payload strings + the unparsed tail.
  // [DONE] and non-data lines are dropped; an incomplete trailing line is returned as rest.
  function sbSSEData(buffer) {
    var parts = String(buffer || '').split('\n');
    var rest = parts.pop();
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var line = parts[i].replace(/\r$/, '').trim();
      if (line.indexOf('data:') !== 0) continue;
      var d = line.slice(5).trim();
      if (d && d !== '[DONE]') out.push(d);
    }
    return { data: out, rest: rest };
  }
  // Stream a completion: emit(delta) per token chunk, then cb(null, fullText). GM_xmlhttpRequest
  // delivers responseText cumulatively in onprogress; we parse only newly-completed SSE lines.
  function callOwnAIStream(cfg, sys, user, json, maxTokens, emit, cb) {
    var prov = cfg.provider;
    var p = PROVIDERS[prov]; if (!p) return cb('Unknown provider', null);
    var key = (cfg.keys || {})[prov]; if (!key) return cb('No API key set for ' + p.label, null);
    var st = STREAM[prov]; if (!st) return callOwnAI(cfg, sys, user, cb, json, maxTokens);   // no stream cfg -> fall back to single-shot
    var model = (cfg.models || {})[prov] || p.defaultModel;
    var bodyStr = st.body(model, sys, user, json);
    if (maxTokens) { try { var bo = JSON.parse(bodyStr); sbApplyMaxTokens(prov, bo, maxTokens); bodyStr = JSON.stringify(bo); } catch (e) {} }
    var acc = '', buf = '', lastLen = 0, done = false;
    function pump(text) {
      text = text || '';
      if (text.length <= lastLen) return;
      buf += text.slice(lastLen); lastLen = text.length;
      var r = sbSSEData(buf); buf = r.rest;
      for (var i = 0; i < r.data.length; i++) {
        var obj = null; try { obj = JSON.parse(r.data[i]); } catch (e) { continue; }
        var delta = sbStreamDelta(prov, obj);
        if (delta) { acc += delta; try { emit(delta); } catch (e) {} }
      }
    }
    function finish(err) {
      if (done) return; done = true;
      if (err) return cb(err, null);
      var val = (json && prov === 'anthropic') ? ('{' + acc) : acc;   // mirror the D2 prefill: chunks are the continuation
      cb(null, val);
    }
    try {
      GM_xmlhttpRequest({
        method: 'POST', url: st.url(model, key), headers: p.headers(key), data: bodyStr,
        timeout: 120000, anonymous: true,
        onprogress: function (res) { try { pump(res.responseText); } catch (e) {} },
        onload: function (res) { try { pump(res.responseText); } catch (e) {} finish(null); },
        onerror: function () { finish('Network error contacting ' + p.label); },
        ontimeout: function () { finish('timeout'); }
      });
    } catch (e) { finish(String((e && e.message) || e)); }
  }
  function renderAI(body) {
    var cfg = aiConfig();
    var provider = el('select', { class: 'wc-field' }, [['builtin', 'Perchance built-in (default)']].concat(Object.keys(PROVIDERS).map(function (k) { return [k, PROVIDERS[k].label]; })).map(function (o) { var op = el('option', { value: o[0], text: o[1] }); if (o[0] === cfg.provider) op.selected = true; return op; }));
    var keyWrap = el('div', {});
    var modelWrap = el('div', {});
    var instruction = el('textarea', { class: 'wc-field', rows: '4', placeholder: 'Optional: override the AI Helper\u2019s system instruction (what it should do with your prompt). Leave blank to use Perchance\u2019s default.' });
    instruction.value = cfg.instruction || '';
    function renderProviderFields() {
      keyWrap.innerHTML = ''; modelWrap.innerHTML = '';
      var pk = provider.value;
      if (pk === 'builtin') {
        keyWrap.appendChild(el('div', { class: 'wc-section-note', text: 'Uses Perchance\u2019s own ai-text broker \u2014 no key needed. You can still set a custom instruction below.' }));
        return;
      }
      var p = PROVIDERS[pk];
      var key = el('input', { class: 'wc-field', type: 'password', placeholder: p.keyHint, value: (cfg.keys || {})[pk] || '' });
      var model = el('input', { class: 'wc-field', type: 'text', placeholder: p.defaultModel, value: (cfg.models || {})[pk] || '' });
      key.addEventListener('input', function () { cfg.keys = cfg.keys || {}; cfg.keys[pk] = key.value; });
      model.addEventListener('input', function () { cfg.models = cfg.models || {}; cfg.models[pk] = model.value; });
      keyWrap.appendChild(el('label', { class: 'wc-label', text: p.label + ' \u00b7 API key (local only)' })); keyWrap.appendChild(key);
      modelWrap.appendChild(el('label', { class: 'wc-label', text: 'Model' })); modelWrap.appendChild(model);
    }
    provider.addEventListener('change', renderProviderFields);
    function save() {
      cfg.provider = provider.value; cfg.instruction = instruction.value; gset('ai', cfg);
      applyHelperInstruction(); toast('AI settings saved');
    }
    var test = el('button', { class: 'wc-btn', text: 'Test', onclick: function () {
      if (provider.value === 'builtin') return toast('Built-in uses Perchance directly');
      cfg.provider = provider.value;
      callOwnAI(cfg, 'You are a helper. Reply with the single word: ok', 'ping', function (err, txt) { toast(err ? ('\u2717 ' + err).slice(0, 80) : ('\u2713 ' + (txt || '').trim().slice(0, 40))); });
    } });
    var aicols = el('div', { class: 'wc-cols' });
    var cardP = el('div', { class: 'wc-card wc-col' });
    cardP.appendChild(el('label', { class: 'wc-label', text: 'Provider' }));
    cardP.appendChild(provider);
    cardP.appendChild(keyWrap);
    cardP.appendChild(modelWrap);
    var cardI = el('div', { class: 'wc-card wc-col' });
    cardI.appendChild(el('label', { class: 'wc-label', text: 'Custom instruction (system prompt)' }));
    cardI.appendChild(instruction);
    aicols.appendChild(cardP); aicols.appendChild(cardI);
    body.appendChild(aicols);
    body.appendChild(el('div', { class: 'wc-foot' }, [
      el('div', { class: 'wc-row' }, [ el('button', { class: 'wc-btn wc-btn-accent', text: 'Save', onclick: save }), test ]),
      el('div', { class: 'wc-section-note', text: 'Your key is stored only in this browser and sent only to the provider you pick. \u201cPerchance built-in\u201d keeps the default broker with just a custom instruction.' })
    ]));
    renderProviderFields();
  }
  // Pre-fill / override the Helper's visible instruction field if present.
  function applyHelperInstruction() {
    var cfg = aiConfig(); if (!cfg.instruction) return;
    var box = $('#aiHelperInstructions') || $('[id*="aiHelperInstruction" i]') || $('#aiHelperInputEl');
    if (box && 'value' in box && !box.dataset.wcSet) { box.dataset.wcSet = '1'; if (!box.value) box.value = cfg.instruction; }
  }
  // If the user picked their own provider, intercept the Helper submit and route
  // it to their model, writing the result into the model editor. Best-effort:
  // we wrap the submit button rather than the internal generateText.
  function hookHelperSubmit() {
    var btn = $('#aiHelperSubmitBtn'); if (!btn || btn.dataset.wcHook) return; btn.dataset.wcHook = '1';
    btn.addEventListener('click', function (e) {
      var cfg = aiConfig(); if (cfg.provider === 'builtin') return; // let Perchance handle it
      var input = $('#aiHelperInputEl'); var dv = dslView(); if (!input || !dv) return;
      var prompt = (input.value || '').trim(); if (!prompt) return;
      e.stopImmediatePropagation(); e.preventDefault();
      var sys = cfg.instruction || 'You are a Perchance generator coding assistant. Given the current code and an instruction, return the COMPLETE updated code only, no explanation. Respect Perchance DSL conventions and avoid bare [word] list-reference traps.';
      var current = viewText(dv);
      toast('Asking ' + (PROVIDERS[cfg.provider] || {}).label + '\u2026', 4000);
      callOwnAI(cfg, sys, 'CURRENT CODE:\n' + current + '\n\nINSTRUCTION:\n' + prompt, function (err, txt) {
        if (err) return toast(('\u2717 ' + err).slice(0, 90), 5000);
        var code = txt.replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/, '').trim();
        var unmute = muteBugFinderError(); viewSet(dv, code); setTimeout(unmute, 2000);
        toast('\u2713 Applied ' + (PROVIDERS[cfg.provider] || {}).label + ' output');
      });
    }, true);
  }

  // ============================================================ bootstrap
  function shortcuts(e) {
    var mod = e.ctrlKey || e.metaKey;
    if (mod && e.altKey && e.code === 'KeyP') { e.preventDefault(); if (isEditMode()) pullFromGitHub(); else toast('Pull: open an #edit page first'); return; }
    if (mod && e.altKey && e.code === 'KeyS') { e.preventDefault(); if (isEditMode()) doSave(); else toast('Save: open an #edit page first'); return; }
    var typing = /input|textarea|select/i.test((e.target.tagName || '')) || e.target.isContentEditable;
    if (e.key === '/' && !typing) { e.preventDefault(); openWindow('generators'); return; }
    if (typing) return;
    if (e.key === 'f' || e.key === 'F') { var n = genName(); if (n) { var on = toggleFav(n); toast(on ? 'Favorited \u2605' : 'Unfavorited'); } }
    else if (e.key === 'c' || e.key === 'C') { var o = outputNode(); if (o) copyText(nodeToText(o)); }
    else if (e.key === '[') { if (histPos > 0) restore(histPos - 1); }
    else if (e.key === ']') { if (histPos < histStack.length - 1) restore(histPos + 1); }
    else if (e.key === '?') { toast('/ open \u00b7 f favorite \u00b7 c copy \u00b7 [ ] history \u00b7 Ctrl/Cmd+Alt+P pull \u00b7 Ctrl/Cmd+Alt+S save', 4800); }
  }

  // ============================================================ SKYBRIDGE ANCHOR
  // The companion end of weld.skybridge. A generator (sandbox, usually a child
  // frame) posts a 'hello' up; we negotiate a protocol version, advertise our
  // capabilities, then service origin-checked, nonce-matched requests. Every
  // privileged capability is gated behind a PER-CAPABILITY consent prompt,
  // remembered per generator. Secrets never cross: for 'ai' we run the keyed
  // call here and post only the completion back down.
  var SB = 'weld.skybridge';
  var SB_PROTO_MIN = 1, SB_PROTO_MAX = 1;
  var SB_CAPS = ['storage', 'ai', 'fetch', 'search', 'model', 'bus'];  // what this companion offers

  // The userscript manager runs us in a sandbox where `window` is a wrapper:
  // a 'message' listener placed on it may NOT receive the page's real
  // cross-frame postMessages, and `window.frames` may not list the real child
  // iframes. The generator (and its weld.skybridge plugin) live in a child
  // iframe and talk to the *real* top window. So bind the whole bridge to the
  // real page window via unsafeWindow when the manager exposes it.
  var SB_WIN = (function () {
    try { return (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window; } catch (e) { return window; }
  })();
  var SB_BUILD = 'sb-anchor/2026-06-06.7';   // bump on every change; printed at mount so a stale userscript is obvious
  // verbose-logging toggle: ?sbdebug in the URL, or window.WELD_SKYBRIDGE_DEBUG = true
  var SB_DEBUG = false;
  try {
    if (typeof unsafeWindow !== 'undefined' && typeof unsafeWindow.WELD_SKYBRIDGE_DEBUG !== 'undefined') SB_DEBUG = !!unsafeWindow.WELD_SKYBRIDGE_DEBUG;
    else if (typeof location !== 'undefined') SB_DEBUG = ((' ' + location.search + ' ' + location.hash).indexOf('sbdebug') !== -1);
  } catch (e) {}
  function sbDebug() { if (SB_DEBUG) sbLog.apply(null, arguments); }
  function sbLog() { try { if (window.console) console.log.apply(console, ['[WeldCompanion]'].concat([].slice.call(arguments))); } catch (e) {} }
  // diagnostics ring: handshake events seen by the anchor, readable live
  var SB_TRACE = [];
  function sbRec(dir, type, origin, note) {
    try { SB_TRACE.push({ t: Date.now(), dir: dir, type: type || '', origin: origin || '', note: note || '' }); if (SB_TRACE.length > 60) SB_TRACE.shift(); } catch (e) {}
  }
  var sbLastFrameCount = -1;

  // consent: gget('sb:perm') -> { '<gen>': { storage:true, ai:false }, ... }
  function sbPerms() { return gget('sb:perm', {}); }
  function sbPermFor(gen, cap) {
    var all = sbPerms(); var g = all[gen]; if (!g) return undefined; return g[cap];
  }
  function sbSetPerm(gen, cap, allowed) {
    var all = sbPerms(); if (!all[gen]) all[gen] = {}; all[gen][cap] = !!allowed; gset('sb:perm', all);
  }
  // ask the user once per (generator, capability). Returns a Promise<bool>.
  function sbConsent(gen, cap) {
    return new Promise(function (resolve) {
      var prior = sbPermFor(gen, cap);
      if (prior === true) return resolve(true);
      if (prior === false) return resolve(false);   // remembered "no"
      var labels = { storage: 'save data that persists across generators', ai: 'use your own AI model', fetch: 'fetch pages from the web on its behalf', search: 'search the web on its behalf', model: 'read which AI model you have configured (name only -- never your API key)', bus: 'relay messages between your open generators (cross-tab pub/sub)' };
      var what = labels[cap] || ('use the "' + cap + '" capability');
      var msg = 'This generator (' + (gen || 'unknown') + ') wants to ' + what + ' via Weld Companion.\n\nAllow it? (remembered for this generator)';
      var ok = false;
      try { ok = window.confirm(msg); } catch (e) { ok = false; }
      sbSetPerm(gen, cap, ok);
      try { toast(ok ? ('Skybridge: ' + cap + ' allowed') : ('Skybridge: ' + cap + ' blocked')); } catch (e) {}
      resolve(ok);
    });
  }

  // per-generator storage namespace, so one generator can't read another's keys
  function sbStoreKey(gen, key) { return 'sbk:' + gen + ':' + key; }

  function sbReply(source, origin, nonce, result) {
    try { source.postMessage({ channel: SB, type: 'reply', nonce: nonce, result: result }, origin && origin !== 'null' ? origin : '*'); } catch (e) {}
  }

  function sbServiceStorage(gen, payload) {
    return new Promise(function (resolve) {
      var op = payload && payload.op;
      if (op === 'get') {
        resolve({ ok: true, value: gget(sbStoreKey(gen, payload.key), null) });
      } else if (op === 'set') {
        gset(sbStoreKey(gen, payload.key), payload.value); resolve({ ok: true });
      } else if (op === 'list') {
        var prefix = 'sbk:' + gen + ':' + (payload.prefix || '');
        var out = [];
        try {
          var all = (typeof GM_listValues === 'function') ? GM_listValues() : [];
          for (var i = 0; i < all.length; i++) {
            var k = all[i];
            if (typeof k === 'string' && k.indexOf(prefix) === 0) out.push(k.slice(('sbk:' + gen + ':').length));
          }
        } catch (e) {}
        resolve({ ok: true, value: out });
      } else {
        resolve({ ok: false, reason: 'bad-op' });
      }
    });
  }

  function sbServiceAI(payload, emit) {
    return new Promise(function (resolve) {
      var cfg = aiConfig();
      if (!cfg || cfg.provider === 'builtin' || !cfg.provider) {
        return resolve({ ok: false, reason: 'no-own-model' });   // user hasn't set up their own model
      }
      var sys = payload.system || 'You are a helpful assistant inside a Perchance generator.';
      var user = String(payload.prompt || '');
      function done(err, txt) {
        if (err) resolve({ ok: false, reason: String(err).slice(0, 120) });
        else resolve({ ok: true, value: txt });   // terminal reply still carries the full text
      }
      // D3: stream when the caller wired onChunk (payload.stream) AND we can emit partials down.
      // The stored key is used HERE; only completion text (chunks + full) goes back, never the key.
      var maxTokens = (payload.maxTokens != null) ? (payload.maxTokens | 0) : 0;
      if (payload.stream && typeof emit === 'function') callOwnAIStream(cfg, sys, user, !!payload.json, maxTokens, emit, done);
      else callOwnAI(cfg, sys, user, done, !!payload.json, maxTokens);
    });
  }

  // D1: 'fetch' capability -- the companion runs OUTSIDE the sandbox, so GM_xmlhttpRequest can
  // reach URLs the in-sandbox weld.fetch cannot (CORS-blocked, arbitrary hosts). Consent-gated per
  // generator. Defense in depth: http(s) only, private/loopback/link-local hosts blocked, cookies
  // never sent (anonymous), body size + time capped. (It cannot stop DNS-rebinding to a private IP
  // -- the guard only inspects the literal hostname.)
  function sbParseHeaders(raw) {
    var h = {};
    try {
      String(raw || '').split(/\r?\n/).forEach(function (line) {
        var i = line.indexOf(':'); if (i <= 0) return;
        var k = line.slice(0, i).trim().toLowerCase(); var v = line.slice(i + 1).trim();
        if (k) h[k] = v;
      });
    } catch (e) {}
    return h;
  }
  function sbFetchGuard(rawUrl) {
    var u;
    try { u = new URL(String(rawUrl)); } catch (e) { return { ok: false, reason: 'bad-url' }; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'scheme-blocked' };
    var host = (u.hostname || '').toLowerCase();
    if (!host) return { ok: false, reason: 'no-host' };
    if (host === 'localhost' || host === '0.0.0.0' || host === '::1' || host === '[::1]') return { ok: false, reason: 'local-blocked' };
    if (/\.local$|\.internal$|\.localhost$/.test(host)) return { ok: false, reason: 'local-blocked' };
    var m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m) {
      var a = +m[1], b = +m[2];
      if (a === 0 || a === 127 || a === 10 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return { ok: false, reason: 'private-ip-blocked' };
    }
    if (host.indexOf(':') !== -1 && /^\[?(?:::1|fe80|fc|fd)/i.test(host)) return { ok: false, reason: 'private-ip-blocked' };
    return { ok: true, url: u.href };
  }
  function sbServiceFetch(payload) {
    return new Promise(function (resolve) {
      var guard = sbFetchGuard(payload && payload.url);
      if (!guard.ok) { resolve({ ok: false, reason: guard.reason }); return; }   // no numeric status -> caller falls through to its own tiers
      var method = String((payload && payload.method) || 'GET').toUpperCase();
      if (['GET', 'POST', 'HEAD', 'PUT', 'DELETE', 'PATCH'].indexOf(method) === -1) method = 'GET';
      var headers = (payload && payload.headers && typeof payload.headers === 'object') ? payload.headers : undefined;
      var CAP = 200 * 1024;   // cap the body so a huge page can't blow up the agent's context
      try {
        GM_xmlhttpRequest({
          method: method, url: guard.url, headers: headers,
          data: (payload && payload.body != null) ? payload.body : undefined,
          timeout: 15000, anonymous: true,                 // never send the user's cookies to arbitrary sites
          onload: function (res) {
            var body = String(res.responseText || ''); var truncated = false;
            if (body.length > CAP) { body = body.slice(0, CAP); truncated = true; }
            resolve({ ok: res.status >= 200 && res.status < 400, status: res.status || 0, url: res.finalUrl || guard.url, headers: sbParseHeaders(res.responseHeaders), body: body, truncated: truncated });
          },
          onerror: function () { resolve({ ok: false, reason: 'network-error' }); },
          ontimeout: function () { resolve({ ok: false, reason: 'timeout' }); }
        });
      } catch (e) { resolve({ ok: false, reason: String((e && e.message) || e).slice(0, 120) }); }
    });
  }

  // C2: 'search' capability -- a keyless web search for in-page agents. Backed by DuckDuckGo's
  // Instant Answer JSON API (documented + account-free), so results are sparse for arbitrary
  // queries (it favors entities/definitions) but need no key. A richer keyed backend can be added
  // later. Parsing is split into a pure function so it is unit-testable without a browser.
  function sbParseSearch(data, max) {
    var out = []; max = max || 5;
    function push(title, url, snippet) {
      if (!url || typeof url !== 'string') return;
      out.push({ title: String(title || url).slice(0, 200), url: url, snippet: String(snippet || '').slice(0, 400) });
    }
    try {
      if (data.AbstractText && data.AbstractURL) push(data.Heading || data.AbstractText, data.AbstractURL, data.AbstractText);
      var rt = [].concat(data.Results || [], data.RelatedTopics || []);
      for (var i = 0; i < rt.length && out.length < max + 4; i++) {
        var t = rt[i];
        if (t && t.Topics && t.Topics.length) {
          for (var j = 0; j < t.Topics.length && out.length < max + 4; j++) {
            var sub = t.Topics[j]; if (sub && sub.FirstURL) push(String(sub.Text || '').split(' - ')[0], sub.FirstURL, sub.Text);
          }
        } else if (t && t.FirstURL) {
          push(String(t.Text || '').split(' - ')[0], t.FirstURL, t.Text);
        }
      }
    } catch (e) {}
    var seen = {}, res = [];
    for (var k = 0; k < out.length && res.length < max; k++) { if (!seen[out[k].url]) { seen[out[k].url] = 1; res.push(out[k]); } }
    return res;
  }
  function sbServiceSearch(payload) {
    return new Promise(function (resolve) {
      var q = String((payload && payload.query) || '').trim();
      if (!q) { resolve({ ok: false, reason: 'empty-query' }); return; }
      var max = Math.max(1, Math.min(10, (payload && +payload.max) || 5));
      var url = 'https://api.duckduckgo.com/?q=' + encodeURIComponent(q) + '&format=json&no_html=1&skip_disambig=1&t=weldcompanion';
      try {
        GM_xmlhttpRequest({
          method: 'GET', url: url, timeout: 15000, anonymous: true,
          onload: function (res) {
            var data = null; try { data = JSON.parse(res.responseText || '{}'); } catch (e) {}
            if (!data) { resolve({ ok: false, reason: 'bad-response' }); return; }
            resolve({ ok: true, query: q, source: 'duckduckgo-instant-answer', results: sbParseSearch(data, max) });
          },
          onerror: function () { resolve({ ok: false, reason: 'network-error' }); },
          ontimeout: function () { resolve({ ok: false, reason: 'timeout' }); }
        });
      } catch (e) { resolve({ ok: false, reason: String((e && e.message) || e).slice(0, 120) }); }
    });
  }

  // D4: best-effort context/output limits by model-name prefix. Approximate and
  // time-sensitive (providers revise these); a miss returns nulls, never a guess.
  var MODEL_CTX = {
    'gpt-4o':          { context: 128000,  maxOut: 16384 },
    'gpt-4.1':         { context: 1000000, maxOut: 32768 },
    'gpt-4-turbo':     { context: 128000,  maxOut: 4096 },
    'gpt-4':           { context: 8192,    maxOut: 4096 },
    'gpt-3.5':         { context: 16385,   maxOut: 4096 },
    'o1':              { context: 200000,  maxOut: 100000 },
    'o3':              { context: 200000,  maxOut: 100000 },
    'o4':              { context: 200000,  maxOut: 100000 },
    'claude-3-5':      { context: 200000,  maxOut: 8192 },
    'claude-3.5':      { context: 200000,  maxOut: 8192 },
    'claude-3-7':      { context: 200000,  maxOut: 64000 },
    'claude-sonnet-4': { context: 200000,  maxOut: 64000 },
    'claude-opus-4':   { context: 200000,  maxOut: 32000 },
    'claude-haiku-4':  { context: 200000,  maxOut: 32000 },
    'claude-3':        { context: 200000,  maxOut: 4096 },
    'gemini-1.5-pro':  { context: 2000000, maxOut: 8192 },
    'gemini-1.5':      { context: 1000000, maxOut: 8192 },
    'gemini-2':        { context: 1000000, maxOut: 8192 }
  };
  function lookupModelLimits(model) {
    var m = String(model || '').toLowerCase();
    var best = null, bestLen = -1;
    for (var k in MODEL_CTX) {
      if (MODEL_CTX.hasOwnProperty(k) && m.indexOf(k) === 0 && k.length > bestLen) { best = MODEL_CTX[k]; bestLen = k.length; }
    }
    return best || { context: null, maxOut: null };
  }
  // D4 capability: report which own-model is configured + its (approx) limits.
  // Pure metadata -- no network call, and crucially NO API key ever crosses the bridge.
  function sbServiceModel() {
    return new Promise(function (resolve) {
      var cfg = aiConfig();
      var prov = cfg && cfg.provider;
      if (!prov || prov === 'builtin' || !PROVIDERS[prov]) { resolve({ ok: false, reason: 'no own model configured' }); return; }
      var model = (cfg.models || {})[prov] || PROVIDERS[prov].defaultModel;
      var lim = lookupModelLimits(model);
      resolve({ ok: true, provider: prov, model: model, contextWindow: lim.context, maxOutput: lim.maxOut });
    });
  }

  function sbOriginOk(o) {
    if (typeof o !== 'string' || o === 'null') return false;
    if (o === location.origin) return true;
    var h = o; var p = h.indexOf('://'); if (p !== -1) h = h.slice(p + 3);
    var s = h.indexOf('/'); if (s !== -1) h = h.slice(0, s);
    var c = h.indexOf(':'); if (c !== -1) h = h.slice(0, c);
    h = h.toLowerCase();
    return h === 'perchance.org' || (h.length > 13 && h.slice(-14) === '.perchance.org');
  }

  // Broadcast our presence DOWN to child frames. We mount at the top frame's
  // document-idle, which is usually AFTER a generator iframe has already fired
  // its one-shot 'hello' -- so we cannot rely on being greeted. We announce
  // instead, and repeat for frames that load later. The plugin treats our
  // 'here' as a connect whether or not it ever heard us greet back.
  function sbAnnounce(win) {
    var root = win || SB_WIN, list;
    try { list = root.frames; } catch (e) { return; }   // cross-origin parent walk guard
    if (!root || root === SB_WIN) {
      var n = (list && list.length) || 0;
      if (n !== sbLastFrameCount) { sbLastFrameCount = n; sbRec('tx', 'announce', '', n + ' child frame(s)'); sbDebug('skybridge announce: ' + n + ' child frame(s) visible'); }
    }
    if (!list || !list.length) return;
    var msg = { channel: SB, type: 'here', version: '1.0.0', protoMin: SB_PROTO_MIN, protoMax: SB_PROTO_MAX, capabilities: SB_CAPS };
    for (var i = 0; i < list.length; i++) {
      var f = null; try { f = list[i]; } catch (e) {}
      if (!f) continue;
      try { f.postMessage(msg, '*'); } catch (e) {}     // '*' is required: child is a different *.perchance.org origin
      try { sbAnnounce(f); } catch (e) {}                // nested frames (cross-origin ones are skipped via the guard)
    }
  }
  // D5: 'bus' capability -- cross-generator / cross-tab pub-sub. The companion is the broker: a
  // published message fans out to every subscribed frame in THIS tab and, via a same-origin
  // BroadcastChannel, to other perchance tabs. Lights up weld.swarm's cross-generator transport.
  var sbBusSubs = {};   // channel -> [{ source, origin }]
  var sbBusBC = null;   // lazy BroadcastChannel('weld-bus') for cross-tab fan-out
  function sbBusChannel() {
    if (sbBusBC || typeof BroadcastChannel === 'undefined') return sbBusBC;
    try {
      sbBusBC = new BroadcastChannel('weld-bus');
      sbBusBC.onmessage = function (e) { var m = e && e.data; if (m && m.channel) sbBusDeliverLocal(m.channel, m.message); };   // from other tabs -> local only (no re-broadcast)
    } catch (e) { sbBusBC = null; }
    return sbBusBC;
  }
  function sbBusPush(source, origin, channel, message) {
    try { source.postMessage({ channel: SB, type: 'bus', busChannel: channel, message: message }, origin && origin !== 'null' ? origin : '*'); } catch (e) {}
  }
  function sbBusDeliverLocal(channel, message) {
    var subs = sbBusSubs[channel]; if (!subs) return;
    for (var i = 0; i < subs.length; i++) sbBusPush(subs[i].source, subs[i].origin, channel, message);
  }
  function sbServiceBus(payload, source, origin) {
    return new Promise(function (resolve) {
      var op = payload && payload.op, channel = String((payload && payload.channel) || '');
      if (!channel) return resolve({ ok: false, reason: 'no-channel' });
      if (op === 'subscribe') {
        sbBusChannel();
        var arr = sbBusSubs[channel] || (sbBusSubs[channel] = []);
        if (!arr.some(function (x) { return x.source === source; })) arr.push({ source: source, origin: origin });
        return resolve({ ok: true, subscribed: channel });
      }
      if (op === 'unsubscribe') {
        var a = sbBusSubs[channel];
        if (a) { sbBusSubs[channel] = a.filter(function (x) { return x.source !== source; }); if (!sbBusSubs[channel].length) delete sbBusSubs[channel]; }
        return resolve({ ok: true, unsubscribed: channel });
      }
      if (op === 'publish') {
        sbBusDeliverLocal(channel, payload.message);                                      // same-tab subscribers
        var bc = sbBusChannel(); if (bc) { try { bc.postMessage({ channel: channel, message: payload.message }); } catch (e) {} }   // other tabs
        return resolve({ ok: true, published: channel });
      }
      resolve({ ok: false, reason: 'bad-op' });
    });
  }

  function sbHandleMessage(ev) {
      var d = ev && ev.data;
      var isSb = d && typeof d === 'object' && d.channel === SB;
      if (isSb) sbRec('rx', d.type, ev.origin, '');           // trace before any filter
      if (!ev || !sbOriginOk(ev.origin)) {
        if (isSb) { sbRec('drop', d.type, ev.origin, 'origin-rejected'); sbDebug('skybridge: dropped ' + d.type + ' from disallowed origin ' + ev.origin); }
        return;
      }
      if (!isSb) return;
      var source = ev.source || SB_WIN;

      if (d.type === 'hello') {
        sbRec('tx', 'here', ev.origin, 'reply to hello');
        sbDebug('skybridge: hello from', ev.origin, '\u2192 replying here');
        // negotiate: respond with our range + capabilities; the plugin picks the common max
        source.postMessage({
          channel: SB, type: 'here', version: '1.0.0',
          protoMin: SB_PROTO_MIN, protoMax: SB_PROTO_MAX, capabilities: SB_CAPS
        }, ev.origin && ev.origin !== 'null' ? ev.origin : '*');
        return;
      }

      if (d.type === 'request') {
        var cap = String(d.cap || '');
        var nonce = d.nonce;
        if (SB_CAPS.indexOf(cap) === -1) { sbReply(source, ev.origin, nonce, { ok: false, reason: 'unsupported' }); return; }
        var gen = genName() || 'unknown';
        sbConsent(gen, cap).then(function (allowed) {
          if (!allowed) { sbReply(source, ev.origin, nonce, { ok: false, reason: 'denied' }); return; }
          var emitChunk = function (chunk) { sbReply(source, ev.origin, nonce, { partial: true, chunk: String(chunk == null ? '' : chunk) }); };
          var work = (cap === 'storage') ? sbServiceStorage(gen, d.payload || {})
                   : (cap === 'ai')      ? sbServiceAI(d.payload || {}, emitChunk)
                   : (cap === 'fetch')   ? sbServiceFetch(d.payload || {})
                   : (cap === 'search')  ? sbServiceSearch(d.payload || {})
                   : (cap === 'model')   ? sbServiceModel()
                   : (cap === 'bus')     ? sbServiceBus(d.payload || {}, source, ev.origin)
                   : Promise.resolve({ ok: false, reason: 'unsupported' });
          work.then(function (result) { sbReply(source, ev.origin, nonce, result || { ok: false, reason: 'error' }); });
        });
        return;
      }
  }

  function mountSkybridgeAnchor() {
    if (!SB_WIN || !SB_WIN.addEventListener) return;
    // Attach to the real page window AND (if different) the sandbox window, so
    // whichever one actually delivers the page's cross-frame messages catches it.
    try { SB_WIN.addEventListener('message', sbHandleMessage, false); } catch (e) {}
    try { if (window !== SB_WIN && window.addEventListener) window.addEventListener('message', sbHandleMessage, false); } catch (e) {}

    // Don't wait to be greeted: announce now, and keep announcing on a bounded
    // interval so a generator iframe that appears late on a slow shell still gets
    // greeted. The plugin ignores duplicate 'here's once it is linked.
    sbRec('init', 'mount', location.origin, SB_BUILD);
    sbLog('skybridge anchor ' + SB_BUILD + ' mounted; bound to real page window; origin=' + location.origin + ' top===self=' + (function () { try { return SB_WIN.top === SB_WIN.self; } catch (e) { return '?'; } })());
    sbAnnounce();
    var sbTicks = 0;
    var sbTimer = setInterval(function () { sbAnnounce(); if (++sbTicks >= 20) clearInterval(sbTimer); }, 600); // ~12s
  }

  // live snapshot for troubleshooting; reachable as weldCompanion.skybridgeDiagnostics()
  function sbDiagnostics() {
    var n = -1; try { n = (SB_WIN.frames && SB_WIN.frames.length) || 0; } catch (e) {}
    return {
      build: SB_BUILD,
      debug: SB_DEBUG,
      boundToUnsafeWindow: (SB_WIN !== window),
      origin: location.origin,
      topIsSelf: (function () { try { return SB_WIN.top === SB_WIN.self; } catch (e) { return null; } })(),
      childFrames: n,
      capabilities: SB_CAPS.slice(),
      perms: sbPerms(),
      trace: SB_TRACE.slice()
    };
  }
  try {
    if (window.weldCompanion) {
      window.weldCompanion.skybridgeDiagnostics = sbDiagnostics;
      window.weldCompanion.skybridgeDebug = function (on) { SB_DEBUG = (on !== false); sbLog('skybridge debug ' + (SB_DEBUG ? 'ON' : 'OFF') + ' \u2014 build ' + SB_BUILD); return SB_DEBUG; };
    }
  } catch (e) {}

  function init() {
    // top frame only. Compare on the SAME (real) window object -- in a userscript
    // sandbox, `window` (wrapper) !== `window.self` (real) can be falsely true.
    try { if (SB_WIN.top !== SB_WIN.self) return; } catch (e) {}
    try {
      mountSkybridgeAnchor();
      recordVisit();
      adoptTheme();
      applyComfort();
      buildBar();
      renderPins();
      document.addEventListener('keydown', shortcuts);
      // keep the drawer anchored to Perchance's bar; if the page scrolls and the
      // in-flow bar leaves the viewport, close the drawer to avoid a stray panel
      window.addEventListener('resize', function () { if (WC_TAB) positionDrawer(); });
      window.addEventListener('scroll', function () { if (!WC_TAB) return; var b = perchanceBar(); if (b && b.getBoundingClientRect().bottom <= 0) return closeDrawer(); positionDrawer(); }, true);

      // observe output: refresh history snapshots + the drawer's result tools
      var out = outputNode();
      if (out) { snapshotOutput();
        new MutationObserver(debounce(function () { snapshotOutput(); if (WC_TAB) renderResultTools(); }, 250)).observe(out, { childList: true, subtree: true, characterData: true });
      }
      var enhance = debounce(function () { enhanceInputs(); applyHelperInstruction(); hookHelperSubmit(); }, 400);
      enhance();
      // If Perchance's bar appears after we loaded (or wasn't there yet), add our
      // single Weld item to it then. We never inject a competing bar.
      var barWatch = debounce(function () { if (!weldItem() && perchanceBar()) buildBar(); }, 500);
      var sbPing = debounce(function () { sbAnnounce(); }, 400);   // greet a generator iframe injected after load
      new MutationObserver(function () { enhance(); barWatch(); sbPing(); }).observe(document.body, { childList: true, subtree: true });
    } catch (e) { /* never break the host page */ if (window.console) console.warn('[WeldCompanion]', e); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();


/* =============================================================================
 * Weld Companion appended modules
 *  [1] IDB engine v1.3        [2] Data Manager v2.2
 *  [3] AICC core              [4] AICC pack (sentry, lore, recovery)
 *  [5] AICC typed view        [6] AICC tools (character files)
 *  [7] Story export core      [8] Library (scrapbook, stories, guardian)
 * ========================================================================== */

/* ----- [1] IDB ENGINE v1.3 ----- */
/* IDB Manager Engine v1.3 — origin-scoped IndexedDB enumerate / describe / CRUD /
 * search / export / import. Pure logic, no DOM. Runs in a browser frame (global
 * indexedDB) or Node (inject an implementation via createIdbEngine(env)).
 *
 * If this source is ever embedded in a Perchance HTML panel, it stays clean of
 * DSL-shaped string literals; object literals always use explicit key: value pairs. */
(function (globalRoot, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalRoot.IDBManEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Sentinel for tagging non-JSON values on export. Real objects that already
  // carry this key are escaped on encode and restored on decode.
  var TAG = '__idbml__';

  function seqEach(arr, fn) {
    var p = Promise.resolve();
    arr.forEach(function (item, i) { p = p.then(function () { return fn(item, i); }); });
    return p;
  }

  function bytesToB64(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }
  function b64ToBytes(b64) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  return function createIdbEngine(env) {
    env = env || {};
    var idb = env.indexedDB || (typeof indexedDB !== 'undefined' ? indexedDB : null);
    var BlobCtor = env.Blob || (typeof Blob !== 'undefined' ? Blob : null);
    if (!idb) throw new Error('IndexedDB is not available in this environment');

    function pReq(request) {
      return new Promise(function (resolve, reject) {
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error || new Error('request failed')); };
      });
    }
    function txDone(transaction) {
      return new Promise(function (resolve, reject) {
        transaction.oncomplete = function () { resolve(); };
        transaction.onerror = function () { reject(transaction.error || new Error('transaction error')); };
        transaction.onabort = function () { reject(transaction.error || new Error('transaction aborted')); };
      });
    }

    // Open a database WITHOUT creating it: an open() on a missing name would create
    // it empty at version 1, so the upgrade event (oldVersion 0) aborts, cleans up,
    // and resolves null instead.
    function openExisting(name) {
      return new Promise(function (resolve, reject) {
        var created = false;
        var request = idb.open(name);
        request.onupgradeneeded = function (ev) {
          if (ev.oldVersion === 0) {
            created = true;
            try { ev.target.transaction.abort(); } catch (e) {}
          }
        };
        request.onsuccess = function () {
          var db = request.result;
          if (created) {
            try { db.close(); } catch (e) {}
            idb.deleteDatabase(name);
            resolve(null);
            return;
          }
          resolve(db);
        };
        request.onerror = function () {
          if (created) { resolve(null); return; }
          reject(request.error || new Error('open failed: ' + name));
        };
        request.onblocked = function () { /* let success/error settle */ };
      });
    }

    // Single open/close lifecycle. fn receives the db (or null when the database
    // does not exist) and the connection is closed whether fn resolves or rejects —
    // a leaked connection blocks later deleteDatabase / version-bump opens.
    function withDb(name, fn) {
      return openExisting(name).then(function (db) {
        if (!db) return fn(null);
        return Promise.resolve().then(function () { return fn(db); }).then(
          function (res) { try { db.close(); } catch (e) {} return res; },
          function (err) { try { db.close(); } catch (e) {} throw err; }
        );
      });
    }

    // Cursor walk. visit(cursor) may return false (stop), a positive number
    // (advance that many), or anything else (continue). Resolves true when the
    // cursor reached the end, false when visit stopped it early.
    function cursorWalk(store, visit) {
      return new Promise(function (resolve, reject) {
        var req = store.openCursor();
        req.onsuccess = function () {
          var cursor = req.result;
          if (!cursor) { resolve(true); return; }
          var r;
          try { r = visit(cursor); } catch (e) { reject(e); return; }
          if (r === false) { resolve(false); return; }
          if (typeof r === 'number' && r > 0) cursor.advance(r);
          else cursor.continue();
        };
        req.onerror = function () { reject(req.error || new Error('cursor failed')); };
      });
    }

    // ---- enumerate / describe -------------------------------------------------
    function canEnumerate() { return typeof idb.databases === 'function'; }

    function listDatabaseNames() {
      if (!canEnumerate()) return Promise.resolve([]); // caller merges a manual registry
      return idb.databases().then(function (list) {
        var out = [];
        for (var i = 0; i < list.length; i++) {
          if (list[i] && list[i].name) out.push({ name: list[i].name, version: list[i].version || null });
        }
        return out;
      });
    }

    function describeStore(db, storeName) {
      var store = db.transaction(storeName, 'readonly').objectStore(storeName);
      var indexes = [];
      for (var i = 0; i < store.indexNames.length; i++) {
        var idx = store.index(store.indexNames[i]);
        indexes.push({ name: idx.name, keyPath: idx.keyPath, unique: !!idx.unique, multiEntry: !!idx.multiEntry });
      }
      return pReq(store.count()).then(function (count) {
        return { name: store.name, keyPath: store.keyPath, autoIncrement: !!store.autoIncrement, indexes: indexes, count: count };
      });
    }

    function describeDatabase(name) {
      return withDb(name, function (db) {
        if (!db) return null;
        var storeNames = [];
        for (var i = 0; i < db.objectStoreNames.length; i++) storeNames.push(db.objectStoreNames[i]);
        var stores = [];
        return seqEach(storeNames, function (sn) {
          return describeStore(db, sn).then(function (desc) { stores.push(desc); });
        }).then(function () { return { name: name, version: db.version, stores: stores }; });
      });
    }

    // ---- record reads -----------------------------------------------------------
    function getPage(name, storeName, offset, limit) {
      offset = offset || 0;
      limit = limit || 50;
      return withDb(name, function (db) {
        if (!db) return { rows: [], done: true };
        var store = db.transaction(storeName, 'readonly').objectStore(storeName);
        var rows = [];
        var skipped = offset === 0;
        return cursorWalk(store, function (cursor) {
          if (!skipped) { skipped = true; return offset; }
          rows.push({ key: cursor.key, primaryKey: cursor.primaryKey, value: cursor.value });
          if (rows.length >= limit) return false;
        }).then(function (reachedEnd) { return { rows: rows, done: reachedEnd }; });
      });
    }

    function getRecord(name, storeName, key) {
      return withDb(name, function (db) {
        if (!db) return null;
        return pReq(db.transaction(storeName, 'readonly').objectStore(storeName).get(key));
      });
    }

    function searchStore(name, storeName, query, limit) {
      limit = Math.min(limit || 100, 500);
      var needle = String(query || '').toLowerCase();
      return withDb(name, function (db) {
        if (!db) return { rows: [], scanned: 0, done: true };
        var store = db.transaction(storeName, 'readonly').objectStore(storeName);
        var rows = [];
        var scanned = 0;
        return cursorWalk(store, function (cursor) {
          scanned++;
          var hay, keyHay;
          try { hay = JSON.stringify(cursor.value); } catch (e) { hay = String(cursor.value); }
          try { keyHay = typeof cursor.primaryKey === 'string' ? cursor.primaryKey : JSON.stringify(cursor.primaryKey); } catch (e) { keyHay = String(cursor.primaryKey); }
          if (!needle || (hay && hay.toLowerCase().indexOf(needle) !== -1) || (keyHay && keyHay.toLowerCase().indexOf(needle) !== -1)) {
            rows.push({ key: cursor.key, primaryKey: cursor.primaryKey, value: cursor.value });
            if (rows.length >= limit) return false;
          }
        }).then(function (reachedEnd) { return { rows: rows, scanned: scanned, done: reachedEnd }; });
      });
    }

    // ---- record writes ------------------------------------------------------------
    // In-line-key stores carry the key in the value; out-of-line stores need explicitKey.
    function putRecord(name, storeName, value, explicitKey) {
      return withDb(name, function (db) {
        if (!db) throw new Error('database not found: ' + name);
        var transaction = db.transaction(storeName, 'readwrite');
        var store = transaction.objectStore(storeName);
        var request = (store.keyPath !== null && store.keyPath !== undefined)
          ? store.put(value)
          : store.put(value, explicitKey);
        var keyOut = null;
        request.onsuccess = function () { keyOut = request.result; };
        return txDone(transaction).then(function () { return keyOut; });
      });
    }

    function deleteRecord(name, storeName, key) {
      return withDb(name, function (db) {
        if (!db) throw new Error('database not found: ' + name);
        var transaction = db.transaction(storeName, 'readwrite');
        transaction.objectStore(storeName).delete(key);
        return txDone(transaction).then(function () { return true; });
      });
    }

    function clearStore(name, storeName) {
      return withDb(name, function (db) {
        if (!db) throw new Error('database not found: ' + name);
        var transaction = db.transaction(storeName, 'readwrite');
        transaction.objectStore(storeName).clear();
        return txDone(transaction).then(function () { return true; });
      });
    }

    // ---- schema ---------------------------------------------------------------------
    // stores: [{ name, keyPath (string|array|null), autoIncrement, indexes: [{ name, keyPath, unique, multiEntry }] }]
    function applySchema(db, ev, stores) {
      for (var i = 0; i < stores.length; i++) {
        var spec = stores[i];
        var opts = {};
        if (spec.keyPath !== null && spec.keyPath !== undefined) opts.keyPath = spec.keyPath;
        if (spec.autoIncrement) opts.autoIncrement = true;
        var store = db.objectStoreNames.contains(spec.name)
          ? ev.target.transaction.objectStore(spec.name)
          : db.createObjectStore(spec.name, opts);
        var idxs = spec.indexes || [];
        for (var j = 0; j < idxs.length; j++) {
          if (!store.indexNames.contains(idxs[j].name)) {
            store.createIndex(idxs[j].name, idxs[j].keyPath, { unique: !!idxs[j].unique, multiEntry: !!idxs[j].multiEntry });
          }
        }
      }
    }

    function createDatabase(name, stores, version) {
      return new Promise(function (resolve, reject) {
        var request = idb.open(name, version || 1);
        request.onupgradeneeded = function (ev) { applySchema(request.result, ev, stores || []); };
        request.onsuccess = function () {
          var db = request.result;
          var v = db.version;
          try { db.close(); } catch (e) {}
          resolve({ name: name, version: v });
        };
        request.onerror = function () { reject(request.error || new Error('createDatabase failed')); };
      });
    }

    function deleteDatabase(name) {
      return new Promise(function (resolve, reject) {
        var request = idb.deleteDatabase(name);
        request.onsuccess = function () { resolve(true); };
        request.onerror = function () { reject(request.error || new Error('deleteDatabase failed')); };
        request.onblocked = function () { resolve(true); /* settles once connections close */ };
      });
    }

    // ---- typed value codec ------------------------------------------------------------
    // The core is synchronous: the whole tree is encoded in one pass, and Blob byte
    // reads (the only async type) are collected and patched in a single Promise.all.
    // This avoids a microtask per node, which dominates on large dumps.
    function isPlainObject(v) {
      if (v === null || typeof v !== 'object') return false;
      var proto = Object.getPrototypeOf(v);
      return proto === Object.prototype || proto === null;
    }
    function tagged(kind, payload) { var o = {}; o[TAG] = kind; o.v = payload; return o; }

    function encSync(v, blobs) {
      if (v === undefined) return tagged('undef', 0);
      if (v === null) return null;
      var t = typeof v;
      if (t === 'number') {
        if (v !== v) return tagged('num', 'NaN');
        if (v === Infinity) return tagged('num', 'Infinity');
        if (v === -Infinity) return tagged('num', '-Infinity');
        return v;
      }
      if (t === 'bigint') return tagged('bigint', v.toString());
      if (t === 'string' || t === 'boolean') return v;
      if (v instanceof Date) return tagged('Date', v.toISOString());
      if (v instanceof ArrayBuffer) return tagged('ArrayBuffer', bytesToB64(new Uint8Array(v)));
      if (ArrayBuffer.isView(v)) {
        var ctorName = v.constructor && v.constructor.name ? v.constructor.name : 'Uint8Array';
        return tagged('TypedArray', { kind: ctorName, b64: bytesToB64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) });
      }
      if (BlobCtor && v instanceof BlobCtor) {
        var holder = { type: v.type || '', name: v.name || null, b64: null };
        blobs.push({ blob: v, holder: holder });
        return tagged('Blob', holder);
      }
      if (v instanceof Map) {
        var pairs = [];
        v.forEach(function (val, key) { pairs.push([encSync(key, blobs), encSync(val, blobs)]); });
        return tagged('Map', pairs);
      }
      if (v instanceof Set) {
        var items = [];
        v.forEach(function (val) { items.push(encSync(val, blobs)); });
        return tagged('Set', items);
      }
      if (v instanceof RegExp) return tagged('RegExp', { source: v.source, flags: v.flags });
      if (Array.isArray(v)) {
        var arr = [];
        for (var i = 0; i < v.length; i++) arr[i] = encSync(v[i], blobs);
        return arr;
      }
      if (isPlainObject(v)) {
        var out = {};
        var keys = Object.keys(v);
        for (var k = 0; k < keys.length; k++) out[keys[k]] = encSync(v[keys[k]], blobs);
        return Object.prototype.hasOwnProperty.call(v, TAG) ? tagged('escObj', out) : out;
      }
      // exotic objects: stringify so export never throws
      var json;
      try { json = JSON.stringify(v); } catch (e) { json = String(v); }
      return tagged('json', json);
    }
    function patchBlobs(blobs) {
      if (!blobs.length) return Promise.resolve();
      return Promise.all(blobs.map(function (job) {
        return job.blob.arrayBuffer().then(function (buf) { job.holder.b64 = bytesToB64(new Uint8Array(buf)); });
      })).then(function () {});
    }
    function encodeValue(v) {
      var blobs = [];
      var out = encSync(v, blobs);
      if (!blobs.length) return Promise.resolve(out);
      return patchBlobs(blobs).then(function () { return out; });
    }

    function decodeValue(v) {
      if (v === null || typeof v !== 'object') return v;
      if (Array.isArray(v)) {
        var arr = [];
        for (var i = 0; i < v.length; i++) arr[i] = decodeValue(v[i]);
        return arr;
      }
      if (Object.prototype.hasOwnProperty.call(v, TAG)) {
        var kind = v[TAG];
        var payload = v.v;
        if (kind === 'undef') return undefined;
        if (kind === 'num') return payload === 'NaN' ? NaN : (payload === 'Infinity' ? Infinity : -Infinity);
        if (kind === 'bigint') return (typeof BigInt !== 'undefined') ? BigInt(payload) : Number(payload);
        if (kind === 'Date') return new Date(payload);
        if (kind === 'ArrayBuffer') return b64ToBytes(payload).buffer;
        if (kind === 'TypedArray') {
          var bytes = b64ToBytes(payload.b64);
          var ctor = (typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : {}))[payload.kind];
          if (!ctor) return bytes;
          if (payload.kind === 'DataView') return new DataView(bytes.buffer);
          return new ctor(bytes.buffer);
        }
        if (kind === 'Blob') {
          var b = b64ToBytes(payload.b64);
          return BlobCtor ? new BlobCtor([b], { type: payload.type || '' }) : b;
        }
        if (kind === 'Map') {
          var m = new Map();
          for (var mi = 0; mi < payload.length; mi++) m.set(decodeValue(payload[mi][0]), decodeValue(payload[mi][1]));
          return m;
        }
        if (kind === 'Set') {
          var s = new Set();
          for (var si = 0; si < payload.length; si++) s.add(decodeValue(payload[si]));
          return s;
        }
        if (kind === 'RegExp') return new RegExp(payload.source, payload.flags);
        if (kind === 'json') { try { return JSON.parse(payload); } catch (e) { return payload; } }
        if (kind === 'escObj') return decodePlain(payload);
        return payload;
      }
      return decodePlain(v);
    }
    function decodePlain(v) {
      var out = {};
      var keys = Object.keys(v);
      for (var i = 0; i < keys.length; i++) out[keys[i]] = decodeValue(v[keys[i]]);
      return out;
    }

    // ---- export / import ------------------------------------------------------------
    function dumpStore(name, storeDesc) {
      return withDb(name, function (db) {
        var store = db.transaction(storeDesc.name, 'readonly').objectStore(storeDesc.name);
        var hasInlineKey = (store.keyPath !== null && store.keyPath !== undefined);
        var records = [];
        var blobs = [];
        return cursorWalk(store, function (cursor) {
          var rec = { value: encSync(cursor.value, blobs) };
          if (!hasInlineKey) rec.key = encSync(cursor.primaryKey, blobs);
          records.push(rec);
        }).then(function () { return patchBlobs(blobs); }).then(function () {
          return {
            name: storeDesc.name,
            keyPath: storeDesc.keyPath,
            autoIncrement: storeDesc.autoIncrement,
            indexes: storeDesc.indexes,
            records: records
          };
        });
      });
    }

    function exportDatabase(name) {
      return describeDatabase(name).then(function (desc) {
        if (!desc) return null;
        var outStores = [];
        return seqEach(desc.stores, function (sd) {
          return dumpStore(name, sd).then(function (dumped) { outStores.push(dumped); });
        }).then(function () { return { name: desc.name, version: desc.version, stores: outStores }; });
      });
    }

    function exportStore(name, storeName) {
      return describeDatabase(name).then(function (desc) {
        if (!desc) return null;
        var sd = null;
        for (var i = 0; i < desc.stores.length; i++) if (desc.stores[i].name === storeName) sd = desc.stores[i];
        return sd ? dumpStore(name, sd) : null;
      });
    }

    function exportAll(originLabel) {
      return listDatabaseNames().then(function (names) {
        var dbs = [];
        return seqEach(names, function (n) {
          return exportDatabase(n.name).then(function (d) { if (d) dbs.push(d); });
        }).then(function () {
          return { format: 'idbml-export', formatVersion: 1, origin: originLabel || null, exportedAt: new Date().toISOString(), databases: dbs };
        });
      });
    }

    function loadStoreRecords(name, storeDump) {
      return withDb(name, function (db) {
        if (!db) throw new Error('database not found: ' + name);
        var transaction = db.transaction(storeDump.name, 'readwrite');
        var store = transaction.objectStore(storeDump.name);
        var hasInlineKey = (store.keyPath !== null && store.keyPath !== undefined);
        var recs = storeDump.records || [];
        for (var i = 0; i < recs.length; i++) {
          var value = decodeValue(recs[i].value);
          if (hasInlineKey) store.put(value);
          else store.put(value, decodeValue(recs[i].key));
        }
        return txDone(transaction).then(function () { return true; });
      });
    }

    // mode 'replace' deletes any existing DB first; 'merge' writes into matching stores.
    function importDatabase(dbDump, mode) {
      mode = mode || 'replace';
      var name = dbDump.name;
      var schema = dbDump.stores.map(function (s) {
        return { name: s.name, keyPath: (s.keyPath === undefined ? null : s.keyPath), autoIncrement: !!s.autoIncrement, indexes: s.indexes || [] };
      });
      var pre = (mode === 'replace') ? deleteDatabase(name) : Promise.resolve(true);
      return pre
        .then(function () { return createDatabase(name, schema, dbDump.version || 1); })
        .then(function () { return seqEach(dbDump.stores, function (s) { return loadStoreRecords(name, s); }); })
        .then(function () { return { name: name, ok: true }; });
    }

    // mode 'replace' clears the store first; 'merge' puts on top. A missing store is
    // created via a version bump using the dump's schema; a missing DATABASE is
    // bootstrapped at version 1 with that store (openExisting guarantees no
    // shell DB is left behind, so version 0 here really means "doesn't exist").
    function importStore(name, storeDump, mode) {
      mode = mode || 'merge';
      return withDb(name, function (db) {
        if (!db) return { exists: false, version: 0 };
        return { exists: db.objectStoreNames.contains(storeDump.name), version: db.version };
      }).then(function (info) {
        if (info.exists) return;
        return new Promise(function (resolve, reject) {
          var request = idb.open(name, info.version + 1);
          request.onupgradeneeded = function (ev) {
            applySchema(request.result, ev, [{
              name: storeDump.name,
              keyPath: (storeDump.keyPath === undefined ? null : storeDump.keyPath),
              autoIncrement: !!storeDump.autoIncrement,
              indexes: storeDump.indexes || []
            }]);
          };
          request.onsuccess = function () { try { request.result.close(); } catch (e) {} resolve(); };
          request.onerror = function () { reject(request.error || new Error('store creation failed')); };
        });
      }).then(function () {
        return (mode === 'replace') ? clearStore(name, storeDump.name) : true;
      }).then(function () {
        return loadStoreRecords(name, storeDump);
      }).then(function () { return { name: name, store: storeDump.name, ok: true }; });
    }

    function importDump(dump, mode) {
      var dbs = (dump && dump.databases) || [];
      var results = [];
      return seqEach(dbs, function (d) {
        return importDatabase(d, mode).then(function (r) { results.push(r); });
      }).then(function () { return results; });
    }

    // ---- public surface ------------------------------------------------------------
    return {
      TAG: TAG,
      canEnumerate: canEnumerate,
      listDatabaseNames: listDatabaseNames,
      describeDatabase: describeDatabase,
      getPage: getPage,
      getRecord: getRecord,
      putRecord: putRecord,
      deleteRecord: deleteRecord,
      clearStore: clearStore,
      createDatabase: createDatabase,
      deleteDatabase: deleteDatabase,
      exportDatabase: exportDatabase,
      exportAll: exportAll,
      searchStore: searchStore,
      exportStore: exportStore,
      importStore: importStore,
      importDatabase: importDatabase,
      importDump: importDump,
      encodeValue: encodeValue,
      decodeValue: decodeValue
    };
  };
});

/* ----- [2] DATA MANAGER v2.2 ----- */
/* ============================================================================
 * Weld Companion — Data Manager v2.2  (federated IndexedDB / Dexie browser)
 * ----------------------------------------------------------------------------
 * Browse, edit, back up, export and import the IndexedDB databases stored by
 * every Perchance generator you've visited — full CRUD, organized by visited
 * history, styled on the Companion's --wc-* tokens.
 *
 * Two roles in one script: an AGENT inside each generator's hex sandbox frame
 * (the only place that origin's IDB is reachable) answering RPC over nonce-
 * matched postMessage, and a COORDINATOR + UI in the top frame driving hidden
 * iframes on demand. Reach = generators that have run on this device; touching
 * one wakes it briefly. Integration (no @noframes, guarded host IIFE, drawer
 * Data tab) is already applied in this file.
 * ========================================================================== */
(function () {
  'use strict';
  var CH = 'weldDataMgr/2';

  /* ===================================================================== */
  /* ROLE: AGENT — hex-sandbox frames only. Broker and other service       */
  /* iframes also match *.perchance.org, but only the 32-hex sandbox holds */
  /* generator data, so everything else exits before doing any work.       */
  /* ===================================================================== */
  if (window.top !== window) {
    if (!/^[0-9a-f]{32}\.perchance\.org$/i.test(location.hostname)) return;

    var engine = null;
    function getEngine() {
      if (engine) return engine;
      try { engine = window.IDBManEngine ? window.IDBManEngine({}) : null; } catch (e) { engine = null; }
      return engine;
    }
    function slugOf() { return (location.pathname.replace(/^\//, '').split('/')[0] || '').trim(); }

    function announce() {
      try {
        window.top.postMessage({
          channel: CH, type: 'agentReady',
          origin: location.origin, host: location.hostname,
          slug: slugOf(), isData: true, hasEngine: !!window.IDBManEngine
        }, '*');
      } catch (e) {}
    }

    function encodeRows(eng, rows) {
      // encodeValue is sync-core (async only for Blob bytes); Promise.all keeps order
      return Promise.all(rows.map(function (r) {
        return eng.encodeValue(r.value).then(function (enc) { return { primaryKey: r.primaryKey, valueEnc: enc }; });
      }));
    }

    function runOp(eng, op, a) {
      a = a || {};
      switch (op) {
        case 'list': return eng.listDatabaseNames();
        case 'describe': return eng.describeDatabase(a.db);
        case 'page': return eng.getPage(a.db, a.store, a.offset, a.limit).then(function (p) {
          return encodeRows(eng, p.rows).then(function (rows) { return { rows: rows, done: p.done }; });
        });
        case 'search': return eng.searchStore(a.db, a.store, a.query, a.limit).then(function (res) {
          return encodeRows(eng, res.rows).then(function (rows) { return { rows: rows, scanned: res.scanned, done: res.done }; });
        });
        case 'getEnc': return eng.getRecord(a.db, a.store, a.key).then(function (v) { return eng.encodeValue(v); });
        case 'putEnc': return eng.putRecord(a.db, a.store, eng.decodeValue(a.valueEnc), a.key);
        case 'del': return eng.deleteRecord(a.db, a.store, a.key);
        case 'clear': return eng.clearStore(a.db, a.store);
        case 'exportDb': return eng.exportDatabase(a.db);
        case 'exportStore': return eng.exportStore(a.db, a.store);
        case 'importStore': return eng.importStore(a.db, a.storeDump, a.mode);
        case 'exportAll': return eng.exportAll(location.origin);
        case 'deleteDb': return eng.deleteDatabase(a.db);
        case 'import': return eng.importDump(a.dump, a.mode);
        case 'dupDb': return eng.exportDatabase(a.db).then(function (dump) {
          if (!dump) throw new Error('source database not found');
          dump.name = a.as;
          return eng.importDatabase(dump, 'replace');
        });
        case 'estimate': return (navigator.storage && navigator.storage.estimate)
          ? navigator.storage.estimate().then(function (e) { return { usage: e.usage || 0, quota: e.quota || 0 }; })
          : Promise.resolve(null);
        case 'uploadText': return (function () {
          // Upload text content to user.uploads.dev THROUGH the generator's own
          // upload-plugin (root.uploadPlugin). Only works on generators that
          // import upload-plugin (AICC does). The plugin broker may still be
          // booting when the hidden frame is fresh, so wait for it briefly.
          // NOTE: uploadPlugin returns { url, size, error } where url is a
          // boxed String — String() coercion is mandatory before use.
          function pageWin() { try { return (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window; } catch (e) { return window; }; }
          function waitFor(check, ms) {
            return new Promise(function (resolve, reject) {
              var t0 = Date.now();
              (function poll() {
                var v = null;
                try { v = check(); } catch (e) {}
                if (v) return resolve(v);
                if (Date.now() - t0 > ms) return reject(new Error('upload-plugin is not available on this generator (timed out waiting for root.uploadPlugin)'));
                setTimeout(poll, 250);
              })();
            });
          }
          return waitFor(function () {
            var w = pageWin();
            return w.root && typeof w.root.uploadPlugin === 'function' ? w.root.uploadPlugin : null;
          }, 15000).then(function (uploadPlugin) {
            var blob = new Blob([String(a.text || '')], { type: a.mime || 'text/plain' });
            return Promise.resolve(uploadPlugin(blob));
          }).then(function (res) {
            if (!res) throw new Error('uploadPlugin returned nothing');
            if (res.error) {
              var msg = String(res.error);
              if (msg === 'disallowed_content') msg += ' \u2014 Perchance moderation flagged the content';
              throw new Error(msg);
            }
            return { url: String(res.url), size: res.size || 0 };
          });
        })();
        case 'ping': return Promise.resolve({ origin: location.origin, slug: slugOf() });
        default: return Promise.reject(new Error('unknown op: ' + op));
      }
    }

    window.addEventListener('message', function (ev) {
      var d = ev.data;
      if (!d || d.channel !== CH || d.type !== 'rpc') return;
      var reply = function (payload) {
        payload.channel = CH; payload.type = 'rpcReply'; payload.nonce = d.nonce;
        try { (ev.source || window.top).postMessage(payload, '*'); } catch (e) {}
      };
      var eng = getEngine();
      if (!eng) { reply({ ok: false, error: 'IndexedDB engine unavailable on ' + location.origin }); return; }
      runOp(eng, d.op, d.args).then(function (res) { reply({ ok: true, result: res }); })
        .catch(function (err) { reply({ ok: false, error: (err && err.message) ? err.message : String(err) }); });
    }, false);

    announce();
    setTimeout(announce, 400);
    setTimeout(announce, 1500);
    return;
  }

  /* ===================================================================== */
  /* ROLE: COORDINATOR + UI — top frame only.                              */
  /* ===================================================================== */
  var NS = 'weldCompanion';
  function gget(k, d) { try { var v = GM_getValue(NS + ':' + k, undefined); return v === undefined ? d : JSON.parse(v); } catch (e) { return d; } }
  function gset(k, v) { try { GM_setValue(NS + ':' + k, JSON.stringify(v)); } catch (e) {} }

  /* ---- small helpers ----------------------------------------------------- */
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'style' && typeof attrs[k] === 'object') { for (var s in attrs[k]) n.style[s] = attrs[k][s]; }
      else if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function frag(kids) { var f = document.createDocumentFragment(); kids.forEach(function (k) { if (k) f.appendChild(k); }); return f; }
  function btn(label, onClick, opts) {
    opts = opts || {};
    var a = { class: 'wdm-btn' + (opts.kind ? ' ' + opts.kind : ''), text: label, onclick: onClick };
    if (opts.title) a.title = opts.title;
    return el('button', a);
  }
  function ghost(label, onClick, title) { return btn(label, onClick, { kind: 'ghost', title: title }); }
  function sub(text) { return el('span', { class: 'wdm-sub', style: { flex: '1' }, text: text }); }
  function fail(prefix) { return function (err) { toast(prefix + ': ' + ((err && err.message) || err)); }; }
  function tryJson(text) { try { return { ok: true, value: JSON.parse(text) }; } catch (e) { return { ok: false, error: e.message }; } }
  function jsonOrString(text) { var r = tryJson(text); return r.ok ? r.value : text; }
  function seqEach(arr, fn) { var p = Promise.resolve(); arr.forEach(function (x, i) { p = p.then(function () { return fn(x, i); }); }); return p; }
  function debounce(fn, ms) { var t; return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); }; }
  function confirmYes(msg) { try { return window.confirm(msg); } catch (e) { return false; } }

  function toastHost() {
    var h = document.getElementById('wdm-toasts');
    if (!h) { h = el('div', { id: 'wdm-toasts', class: 'wdm-toasthost' }); document.body.appendChild(h); }
    return h;
  }
  function toast(msg, opts) {
    opts = opts || {};
    var kids = [el('span', { class: 'wdm-toastmsg', text: msg })];
    if (opts.action) {
      kids.push(el('button', { class: 'wdm-toastact', text: opts.action.label, onclick: function () {
        try { opts.action.fn(); } catch (e) {}
        dismiss();
      } }));
    }
    var t = el('div', { class: 'wdm-toast' }, kids);
    toastHost().appendChild(t);
    requestAnimationFrame(function () { t.classList.add('wdm-show'); });
    var timer = setTimeout(dismiss, opts.ms || (opts.action ? 7000 : 2800));
    function dismiss() { clearTimeout(timer); t.classList.remove('wdm-show'); setTimeout(function () { t.remove(); }, 250); }
    return { dismiss: dismiss };
  }

  function download(filename, text) {
    var url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    var a = el('a', { href: url, download: filename });
    document.body.appendChild(a); a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 1500);
  }
  function pickFile() {
    return new Promise(function (resolve) {
      var inp = el('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
      inp.addEventListener('change', function () {
        var file = inp.files && inp.files[0];
        if (!file) { resolve(null); return; }
        var reader = new FileReader();
        reader.onload = function () { resolve({ name: file.name, text: String(reader.result) }); };
        reader.onerror = function () { resolve(null); };
        reader.readAsText(file);
      });
      document.body.appendChild(inp); inp.click();
      setTimeout(function () { inp.remove(); }, 120000);
    });
  }
  function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
  function fmtBytes(n) {
    if (n == null) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }
  function timeAgo(t) {
    var s = Math.max(1, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + 's ago';
    var m = Math.round(s / 60); if (m < 60) return m + 'm ago';
    var h = Math.round(m / 60); if (h < 24) return h + 'h ago';
    return Math.round(h / 24) + 'd ago';
  }

  /* ---- agent registry + RPC ----------------------------------------------- */
  var agents = {};        // origin -> { source, slug, hasEngine, t }
  var agentWaiters = [];
  var pending = {};       // nonce -> { resolve, reject, timer }
  var frames = {};        // slug -> iframe
  var seq = 0;

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.channel !== CH) return;
    if (d.type === 'agentReady') {
      agents[d.origin] = { source: ev.source, slug: d.slug, hasEngine: !!d.hasEngine, t: Date.now() };
      for (var i = agentWaiters.length - 1; i >= 0; i--) { try { agentWaiters[i](d); } catch (e) {} }
      return;
    }
    if (d.type === 'rpcReply') {
      var p = pending[d.nonce]; if (!p) return;
      clearTimeout(p.timer); delete pending[d.nonce];
      if (d.ok) p.resolve(d.result); else p.reject(new Error(d.error || 'rpc failed'));
    }
  }, false);

  function dataAgentFor(slug) {
    for (var origin in agents) { var a = agents[origin]; if (a.hasEngine && a.slug === slug) return a; }
    return null;
  }

  function ensureAgent(slug, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var existing = dataAgentFor(slug);
      if (existing) { resolve(existing); return; }
      var settled = false;
      function cleanup() { clearTimeout(timer); var i = agentWaiters.indexOf(waiter); if (i >= 0) agentWaiters.splice(i, 1); }
      var waiter = function (d) {
        if (settled || !d.hasEngine || d.slug !== slug) return;
        settled = true; cleanup(); resolve(dataAgentFor(slug));
      };
      agentWaiters.push(waiter);
      if (!frames[slug]) {
        frames[slug] = el('iframe', { 'aria-hidden': 'true', src: 'https://perchance.org/' + encodeURIComponent(slug),
          style: { position: 'fixed', width: '360px', height: '260px', left: '-12000px', top: '-12000px', opacity: '0', border: '0', pointerEvents: 'none' } });
        document.body.appendChild(frames[slug]);
      }
      var timer = setTimeout(function () {
        if (settled) return; settled = true; cleanup();
        releaseFrame(slug);
        reject(new Error('Timed out reaching \u201c' + slug + '\u201d \u2014 it may block framing, or never finished loading.'));
      }, timeoutMs || 16000);
    });
  }

  function releaseFrame(slug) {
    var f = frames[slug];
    if (f) { try { f.remove(); } catch (e) {} delete frames[slug]; }
    for (var origin in agents) { if (agents[origin].slug === slug) delete agents[origin]; }
  }
  function releaseAllExcept(keepSlug) {
    Object.keys(frames).forEach(function (slug) { if (slug !== keepSlug) releaseFrame(slug); });
  }

  function rpc(slug, op, args, opTimeout) {
    return ensureAgent(slug).then(function (a) {
      return new Promise(function (resolve, reject) {
        var nonce = CH + ':' + (++seq) + ':' + Math.random().toString(36).slice(2);
        var timer = setTimeout(function () {
          delete pending[nonce];
          releaseFrame(slug); // stale handle — respawn next time
          reject(new Error('Timed out: ' + op));
        }, opTimeout || 30000);
        pending[nonce] = { resolve: resolve, reject: reject, timer: timer };
        try { a.source.postMessage({ channel: CH, type: 'rpc', nonce: nonce, op: op, args: args || {} }, '*'); }
        catch (e) { clearTimeout(timer); delete pending[nonce]; reject(e); }
      });
    });
  }

  /* ---- candidate list (visited history first) ------------------------------ */
  function candidateGenerators() {
    var recent = gget('recent', []) || [];
    var favs = gget('favorites', []) || [];
    var dir = gget('directory', null);
    var scan = gget('wdmScan', {}) || {};          // slug -> { dbs, bytes, t }
    var byName = {};
    recent.forEach(function (r) { byName[r.name] = { name: r.name, title: r.title || r.name, t: r.t || 0, fav: favs.indexOf(r.name) !== -1 }; });
    favs.forEach(function (n) { if (!byName[n]) byName[n] = { name: n, title: n, t: 0, fav: true }; });
    if (dir && dir.names) dir.names.forEach(function (n) { if (!byName[n]) byName[n] = { name: n, title: n, t: 0, fav: favs.indexOf(n) !== -1 }; });
    var cur = (window.generatorName || (location.pathname.replace(/^\//, '').split('/')[0]) || '').trim();
    if (cur) {
      if (!byName[cur]) byName[cur] = { name: cur, title: (document.title || cur).replace(/ \u2015 Perchance.*$/, '').trim() || cur, t: Date.now() + 1, fav: favs.indexOf(cur) !== -1 };
      byName[cur].current = true;
    }
    return Object.keys(byName).map(function (k) {
      var g = byName[k];
      var sc = scan[g.name];
      if (sc) { g.dbs = sc.dbs; g.bytes = sc.bytes; }
      return g;
    });
  }
  function sortGenerators(list, mode) {
    var copy = list.slice();
    if (mode === 'name') copy.sort(function (a, b) { return a.name.localeCompare(b.name); });
    else if (mode === 'fav') copy.sort(function (a, b) { return (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || (b.t - a.t); });
    else if (mode === 'data') copy.sort(function (a, b) { return ((b.dbs || 0) - (a.dbs || 0)) || (b.t - a.t); });
    else copy.sort(function (a, b) { return (b.current ? 1 : 0) - (a.current ? 1 : 0) || (b.t - a.t); });
    return copy;
  }
  function rememberScan(slug, dbs, bytes) {
    var scan = gget('wdmScan', {}) || {};
    scan[slug] = { dbs: dbs, bytes: bytes || null, t: Date.now() };
    gset('wdmScan', scan);
  }

  /* ---- decoded-value previews ----------------------------------------------- */
  var _decoder = null;
  function decoder() { try { if (!_decoder && window.IDBManEngine) _decoder = window.IDBManEngine({}); } catch (e) {} return _decoder; }
  function describeVal(v) {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    if (v instanceof Date) return 'Date(' + v.toISOString() + ')';
    if (typeof Blob !== 'undefined' && v instanceof Blob) return 'Blob(' + fmtBytes(v.size) + (v.type ? ', ' + v.type : '') + ')';
    if (v instanceof ArrayBuffer) return 'ArrayBuffer(' + v.byteLength + ')';
    if (ArrayBuffer.isView(v)) return (v.constructor && v.constructor.name || 'TypedArray') + '(' + v.length + ')';
    if (v instanceof Map) return 'Map(' + v.size + ')';
    if (v instanceof Set) return 'Set(' + v.size + ')';
    if (v instanceof RegExp) return String(v);
    if (typeof v === 'bigint') return v.toString() + 'n';
    if (Array.isArray(v)) {
      var parts = [];
      for (var i = 0; i < Math.min(v.length, 6); i++) parts.push(describeVal(v[i]));
      return '[' + parts.join(', ') + (v.length > 6 ? ', \u2026' : '') + ']';
    }
    if (typeof v === 'object') {
      var keys = Object.keys(v);
      var inner = [];
      for (var j = 0; j < Math.min(keys.length, 6); j++) inner.push(keys[j] + ': ' + describeVal(v[keys[j]]));
      return '{' + inner.join(', ') + (keys.length > 6 ? ', \u2026' : '') + '}';
    }
    if (typeof v === 'string') return JSON.stringify(v);
    return String(v);
  }
  function humanPreview(v, max) {
    max = max || 160;
    var s = describeVal(v);
    return s.length > max ? s.slice(0, max) + '\u2026' : s;
  }
  function keyPreview(k) {
    var s = typeof k === 'string' ? k : (function () { try { return JSON.stringify(k); } catch (e) { return String(k); } })();
    return s.length > 42 ? s.slice(0, 42) + '\u2026' : s;
  }
  // Previews are computed once per fetched row, not on every filter keystroke.
  function annotateRows(rows) {
    var d = decoder();
    rows.forEach(function (row) {
      var decoded;
      try { decoded = d ? d.decodeValue(row.valueEnc) : row.valueEnc; } catch (e) { decoded = row.valueEnc; }
      row.hp = humanPreview(decoded, 200);
      row.kp = keyPreview(row.primaryKey);
      row.hay = (row.hp + ' ' + row.kp).toLowerCase();
    });
    return rows;
  }

  /* ---- undo (pre-op snapshots; in-memory ring) -------------------------------- */
  var UNDO_CAP_BYTES = 12 * 1048576;
  var undoStack = [];
  function pushUndo(label, fn) {
    undoStack.push({ label: label, fn: fn });
    if (undoStack.length > 20) undoStack.shift();
  }
  function offerUndo(label, doneMsg) {
    var entry = undoStack[undoStack.length - 1];
    if (!entry || entry.label !== label) { toast(doneMsg); return; }
    toast(doneMsg, { action: { label: 'Undo', fn: function () {
      undoStack.pop();
      entry.fn().then(function () { toast('Restored \u2713'); refreshCurrent(); }).catch(fail('Undo failed'));
    } } });
  }
  function snapshotTooBig(obj) {
    try { return JSON.stringify(obj).length > UNDO_CAP_BYTES; } catch (e) { return true; }
  }

  /* ===================================================================== */
  /* STYLES — on the Companion's --wc-* tokens (with fallbacks)            */
  /* ===================================================================== */
  function styleOnce() {
    if (document.getElementById('wdm-style')) return;
    var css = [
      '.wdm-root{all:revert;font-family:var(--wc-sans,system-ui,sans-serif);color:var(--wc-ink,#eef2f6);line-height:1.5;-webkit-font-smoothing:antialiased;text-align:left;}',
      '.wdm-root *{box-sizing:border-box;}',
      '.wdm-scrim{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2147483600;}',
      '.wdm{position:fixed;inset:20px;max-width:1180px;margin:0 auto;z-index:2147483601;display:flex;flex-direction:column;',
      '  background:var(--wc-surface,#13171e);border:1px solid var(--wc-line,rgba(255,255,255,.09));border-radius:14px;overflow:hidden;',
      '  box-shadow:var(--wc-shadow,0 24px 64px -16px rgba(0,0,0,.78));font-size:14px;}',
      '.wdm-hd{display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid var(--wc-line-2,rgba(255,255,255,.05));flex:none;flex-wrap:wrap;}',
      '.wdm-brand{display:flex;align-items:center;gap:8px;font:700 12px/1 var(--wc-mono,ui-monospace,monospace);letter-spacing:1px;text-transform:uppercase;}',
      '.wdm-brand .wdm-dot{width:8px;height:8px;border-radius:50%;background:var(--wc-arc,#ff8a3d);box-shadow:0 0 10px var(--wc-arc,#ff8a3d);}',
      '.wdm-crumbs{display:flex;align-items:center;gap:6px;font:12px var(--wc-mono,ui-monospace,monospace);color:var(--wc-dim,#9aa7b6);min-width:0;flex:1;flex-wrap:wrap;}',
      '.wdm-crumb{cursor:pointer;padding:2px 6px;border-radius:6px;white-space:nowrap;max-width:240px;overflow:hidden;text-overflow:ellipsis;}',
      '.wdm-crumb:hover{background:var(--wc-surface-2,#1a1f28);color:var(--wc-ink,#eef2f6);}',
      '.wdm-crumb.wdm-here{color:var(--wc-arc,#ff8a3d);cursor:default;}',
      '.wdm-crumb.wdm-here:hover{background:transparent;}',
      '.wdm-sep{color:var(--wc-faint,#5d6b7b);}',
      '.wdm-x{margin-left:auto;width:28px;height:28px;border-radius:8px;border:1px solid var(--wc-line,rgba(255,255,255,.09));background:var(--wc-surface-2,#1a1f28);',
      '  color:var(--wc-dim,#9aa7b6);font-size:14px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none;}',
      '.wdm-x:hover{color:#fff;background:#c0392b;border-color:#c0392b;}',
      '.wdm-body{flex:1;display:flex;min-height:0;}',
      '.wdm-col{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--wc-line-2,rgba(255,255,255,.05));}',
      '.wdm-gens{width:280px;flex:none;}',
      '.wdm-mid{width:300px;flex:none;}',
      '.wdm-main{flex:1;min-width:0;border-right:0;}',
      '.wdm.wdm-narrow .wdm-col{display:none;width:100%;flex:1;border-right:0;}',
      '.wdm.wdm-narrow .wdm-col.wdm-active{display:flex;}',
      '.wdm-coltools{display:flex;gap:6px;padding:8px 10px;border-bottom:1px solid var(--wc-line-2,rgba(255,255,255,.05));align-items:center;flex-wrap:wrap;flex:none;}',
      '.wdm-list{overflow:auto;flex:1;padding:6px;}',
      '.wdm-item{padding:8px 10px;border-radius:9px;cursor:pointer;display:flex;flex-direction:column;gap:2px;border:1px solid transparent;}',
      '.wdm-item:hover{background:var(--wc-surface-2,#1a1f28);}',
      '.wdm-item.wdm-on{background:var(--wc-arc-soft,rgba(255,138,61,.14));border-color:var(--wc-arc,#ff8a3d);}',
      '.wdm-item .wdm-t{font-weight:600;display:flex;align-items:center;gap:6px;min-width:0;}',
      '.wdm-item .wdm-t .wdm-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.wdm-item .wdm-m{font:11px var(--wc-mono,ui-monospace,monospace);color:var(--wc-faint,#5d6b7b);}',
      '.wdm-pill{flex:none;font:600 10px var(--wc-mono,ui-monospace,monospace);padding:1px 7px;border-radius:999px;border:1px solid var(--wc-line,rgba(255,255,255,.09));color:var(--wc-dim,#9aa7b6);}',
      '.wdm-pill.wdm-has{color:var(--wc-signal,#4ee0c8);border-color:var(--wc-signal,#4ee0c8);}',
      '.wdm-star{color:var(--wc-gold,#ffcd4d);flex:none;}',
      '.wdm-btn{appearance:none;background:var(--wc-arc,#ff8a3d);color:#1a1208;border:0;border-radius:8px;padding:6px 12px;cursor:pointer;font:600 12px var(--wc-sans,sans-serif);}',
      '.wdm-btn:hover{filter:brightness(1.07);}',
      '.wdm-btn.ghost{background:var(--wc-surface-2,#1a1f28);color:var(--wc-ink,#eef2f6);border:1px solid var(--wc-line,rgba(255,255,255,.09));}',
      '.wdm-btn.ghost:hover{background:var(--wc-surface-3,#222936);}',
      '.wdm-btn.danger{background:transparent;color:#e5534b;border:1px solid rgba(229,83,75,.45);}',
      '.wdm-btn.danger:hover{background:rgba(229,83,75,.12);}',
      '.wdm-btn:disabled{opacity:.4;cursor:not-allowed;}',
      '.wdm-field{background:var(--wc-surface-2,#1a1f28);color:var(--wc-ink,#eef2f6);border:1px solid var(--wc-line,rgba(255,255,255,.09));border-radius:8px;padding:6px 9px;font:13px var(--wc-sans,sans-serif);}',
      '.wdm-field:focus{outline:none;border-color:var(--wc-arc,#ff8a3d);}',
      '.wdm-search{flex:1;min-width:80px;}',
      '.wdm-sub{color:var(--wc-dim,#9aa7b6);font:12px var(--wc-mono,ui-monospace,monospace);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.wdm-main-tools{display:flex;gap:7px;padding:9px 12px;border-bottom:1px solid var(--wc-line-2,rgba(255,255,255,.05));align-items:center;flex-wrap:wrap;flex:none;}',
      '.wdm-main-body{overflow:auto;flex:1;padding:10px 12px;}',
      '.wdm-note{color:var(--wc-dim,#9aa7b6);font:12px/1.6 var(--wc-sans,sans-serif);padding:14px;}',
      '.wdm-tbl{width:100%;border-collapse:collapse;font:12px var(--wc-mono,ui-monospace,monospace);}',
      '.wdm-tbl th,.wdm-tbl td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--wc-line-2,rgba(255,255,255,.05));vertical-align:top;}',
      '.wdm-tbl th{color:var(--wc-faint,#5d6b7b);font-weight:600;position:sticky;top:0;background:var(--wc-surface,#13171e);z-index:1;}',
      '.wdm-tbl tr.wdm-rec:hover{background:var(--wc-surface-2,#1a1f28);cursor:pointer;}',
      '.wdm-key{color:var(--wc-signal,#4ee0c8);white-space:nowrap;}',
      '.wdm-val{color:var(--wc-ink,#eef2f6);word-break:break-word;opacity:.92;}',
      '.wdm-pager{display:flex;gap:8px;align-items:center;padding:10px 0;color:var(--wc-dim,#9aa7b6);font:12px var(--wc-mono,ui-monospace,monospace);flex-wrap:wrap;}',
      '.wdm-spin{display:flex;align-items:center;gap:9px;color:var(--wc-dim,#9aa7b6);font:12px var(--wc-mono,ui-monospace,monospace);padding:16px;}',
      '.wdm-spin::before{content:"";width:14px;height:14px;border-radius:50%;border:2px solid var(--wc-line,rgba(255,255,255,.09));border-top-color:var(--wc-arc,#ff8a3d);animation:wdm-rot .7s linear infinite;}',
      '@keyframes wdm-rot{to{transform:rotate(360deg);}}',
      '.wdm-modal{position:fixed;inset:0;z-index:2147483650;display:grid;place-items:center;background:rgba(0,0,0,.5);}',
      '.wdm-card{width:min(760px,94vw);max-height:88vh;display:flex;flex-direction:column;background:var(--wc-surface,#13171e);border:1px solid var(--wc-line,rgba(255,255,255,.09));border-radius:12px;overflow:hidden;box-shadow:var(--wc-shadow,0 24px 64px -16px rgba(0,0,0,.78));}',
      '.wdm-card h3{margin:0;padding:12px 16px;border-bottom:1px solid var(--wc-line-2,rgba(255,255,255,.05));font:700 13px var(--wc-mono,ui-monospace,monospace);color:var(--wc-ink,#eef2f6);}',
      '.wdm-ta{flex:1;min-height:260px;margin:12px 16px 4px;background:var(--wc-surface-2,#1a1f28);color:var(--wc-ink,#eef2f6);border:1px solid var(--wc-line,rgba(255,255,255,.09));border-radius:8px;padding:10px;font:12px/1.55 var(--wc-mono,ui-monospace,monospace);resize:vertical;}',
      '.wdm-ta:focus{outline:none;border-color:var(--wc-arc,#ff8a3d);}',
      '.wdm-jsonstate{margin:0 16px;font:11px var(--wc-mono,ui-monospace,monospace);height:16px;}',
      '.wdm-jsonstate.ok{color:var(--wc-signal,#4ee0c8);}','.wdm-jsonstate.bad{color:#e5534b;}',
      '.wdm-foot{display:flex;gap:8px;padding:12px 16px;border-top:1px solid var(--wc-line-2,rgba(255,255,255,.05));align-items:center;flex-wrap:wrap;}',
      '.wdm-hint{color:var(--wc-faint,#5d6b7b);font:11px/1.4 var(--wc-sans,sans-serif);flex:1;min-width:120px;}',
      '.wdm-toasthost{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483660;display:flex;flex-direction:column-reverse;gap:8px;align-items:center;pointer-events:none;}',
      '.wdm-toast{display:flex;align-items:center;gap:12px;background:var(--wc-surface-2,#1a1f28);color:var(--wc-ink,#eef2f6);border:1px solid var(--wc-line,rgba(255,255,255,.09));',
      '  border-radius:10px;padding:9px 14px;font:13px var(--wc-sans,sans-serif);opacity:0;transform:translateY(10px);transition:.22s;max-width:90vw;pointer-events:auto;box-shadow:0 8px 24px rgba(0,0,0,.4);}',
      '.wdm-toast.wdm-show{opacity:1;transform:translateY(0);}',
      '.wdm-toastact{appearance:none;background:transparent;border:1px solid var(--wc-arc,#ff8a3d);color:var(--wc-arc,#ff8a3d);border-radius:7px;padding:3px 10px;font:600 12px var(--wc-sans,sans-serif);cursor:pointer;}',
      '.wdm-toastact:hover{background:var(--wc-arc-soft,rgba(255,138,61,.14));}',
      '.wdm-sweep{font:12px var(--wc-mono,ui-monospace,monospace);}',
      '.wdm-sweep .row{display:flex;gap:8px;padding:4px 0;align-items:baseline;}',
      '.wdm-sweep .ok{color:var(--wc-signal,#4ee0c8);}','.wdm-sweep .bad{color:#e5534b;}','.wdm-sweep .dim{color:var(--wc-faint,#5d6b7b);}',
      '.wdm-launch{display:flex;flex-direction:column;gap:10px;padding:4px 2px;}',
      '.wdm-launch .wdm-lrow{display:flex;gap:8px;flex-wrap:wrap;}',
      '.wdm-launch .wdm-litem{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:9px;cursor:pointer;border:1px solid transparent;}',
      '.wdm-launch .wdm-litem:hover{background:var(--wc-surface-2,#1a1f28);border-color:var(--wc-line,rgba(255,255,255,.09));}'
    ].join('\n');
    document.head.appendChild(el('style', { id: 'wdm-style', html: css }));
  }

  /* ===================================================================== */
  /* PANEL                                                                 */
  /* ===================================================================== */
  var state = {
    slug: null, db: null, store: null, storeDesc: null,
    offset: 0, pageSize: gget('wdmPageSize', 50),
    sort: gget('wdmSort', 'recent'),
    filter: '', searchHits: null, pane: 'gens'
  };
  var refs = {};

  function open() {
    styleOnce();
    if (document.getElementById('wdm-root-panel')) return;
    var scrim = el('div', { class: 'wdm-root wdm-scrim', id: 'wdm-scrim', onclick: closePanel });

    refs.crumbs = el('div', { class: 'wdm-crumbs' });
    refs.gensList = el('div', { class: 'wdm-list' });
    refs.search = el('input', { class: 'wdm-field wdm-search', placeholder: 'Search generators\u2026', oninput: debounce(renderGens, 120) });
    var sortSel = el('select', { class: 'wdm-field', style: { flex: 'none' }, onchange: function () { state.sort = sortSel.value; gset('wdmSort', state.sort); renderGens(); } });
    [['recent', 'Recent'], ['name', 'A\u2192Z'], ['fav', 'Favorites'], ['data', 'Has data']].forEach(function (o) {
      var op = el('option', { value: o[0], text: o[1] }); if (o[0] === state.sort) op.selected = true; sortSel.appendChild(op);
    });
    refs.gensCol = el('div', { class: 'wdm-col wdm-gens' }, [
      el('div', { class: 'wdm-coltools' }, [refs.search, sortSel,
        ghost('\u29C9 Sweep', sweepBackup, 'Back up every listed generator into one file (and refresh the data badges)')]),
      refs.gensList
    ]);

    refs.midTools = el('div', { class: 'wdm-coltools' });
    refs.midList = el('div', { class: 'wdm-list' });
    refs.midCol = el('div', { class: 'wdm-col wdm-mid' }, [refs.midTools, refs.midList]);

    refs.mainTools = el('div', { class: 'wdm-main-tools' });
    refs.mainBody = el('div', { class: 'wdm-main-body' });
    refs.mainCol = el('div', { class: 'wdm-col wdm-main' }, [refs.mainTools, refs.mainBody]);

    refs.panel = el('div', { class: 'wdm-root wdm', id: 'wdm-root-panel' }, [
      el('div', { class: 'wdm-hd' }, [
        el('span', { class: 'wdm-brand' }, [el('span', { class: 'wdm-dot' }), el('span', { text: 'Weld Data' })]),
        refs.crumbs,
        el('button', { class: 'wdm-x', title: 'Close (Esc)', text: '\u2715', onclick: closePanel })
      ]),
      el('div', { class: 'wdm-body' }, [refs.gensCol, refs.midCol, refs.mainCol])
    ]);

    document.body.appendChild(scrim);
    document.body.appendChild(refs.panel);
    window.addEventListener('resize', applyLayout);
    applyLayout();
    renderCrumbs();
    renderGens();
    resetMid('Pick a generator to load its databases.');
    resetMain('Your visited history is the candidate list. Loading a generator briefly runs it in a hidden frame so its on-device data can be read.');
    document.addEventListener('keydown', escClose, true);
  }
  function applyLayout() {
    if (!refs.panel) return;
    var narrow = window.innerWidth < 900;
    refs.panel.classList.toggle('wdm-narrow', narrow);
    if (narrow) setPane(state.pane);
    else [refs.gensCol, refs.midCol, refs.mainCol].forEach(function (c) { c.classList.remove('wdm-active'); });
  }
  function setPane(p) {
    state.pane = p;
    if (!refs.panel || !refs.panel.classList.contains('wdm-narrow')) return;
    refs.gensCol.classList.toggle('wdm-active', p === 'gens');
    refs.midCol.classList.toggle('wdm-active', p === 'dbs');
    refs.mainCol.classList.toggle('wdm-active', p === 'main');
  }
  // Esc closes the topmost layer: editor modal first, then the panel.
  function escClose(e) {
    if (e.key !== 'Escape') return;
    var modal = document.getElementById('wdm-modal');
    if (modal) { e.stopPropagation(); e.preventDefault(); modal.remove(); return; }
    if (document.getElementById('wdm-root-panel')) { e.stopPropagation(); closePanel(); }
  }
  function closePanel() {
    document.removeEventListener('keydown', escClose, true);
    window.removeEventListener('resize', applyLayout);
    releaseAllExcept(null);
    var r = document.getElementById('wdm-root-panel'); if (r) r.remove();
    var s = document.getElementById('wdm-scrim'); if (s) s.remove();
  }
  function resetMid(msg) { clear(refs.midTools); clear(refs.midList); refs.midList.appendChild(el('div', { class: 'wdm-note', text: msg })); }
  function resetMain(msg) { clear(refs.mainTools); clear(refs.mainBody); refs.mainBody.appendChild(el('div', { class: 'wdm-note', text: msg })); }
  function spinner(parent, msg) { clear(parent); parent.appendChild(el('div', { class: 'wdm-spin', text: msg })); }

  function renderCrumbs() {
    clear(refs.crumbs);
    function crumb(label, here, fn) {
      return el('span', { class: 'wdm-crumb' + (here ? ' wdm-here' : ''), text: label, title: label, onclick: here ? null : fn });
    }
    var kids = [crumb('generators', !state.slug, function () {
      state.slug = state.db = state.store = null;
      releaseAllExcept(null);
      renderCrumbs(); renderGens();
      resetMid('Pick a generator.'); resetMain('');
      setPane('gens');
    })];
    if (state.slug) {
      kids.push(el('span', { class: 'wdm-sep', text: '/' }));
      kids.push(crumb(state.slug, !state.db, function () { selectGenerator(state.slug); }));
    }
    if (state.db) {
      kids.push(el('span', { class: 'wdm-sep', text: '/' }));
      kids.push(crumb(state.db, !state.store, function () { selectDb(state.slug, state.db); }));
    }
    if (state.store) {
      kids.push(el('span', { class: 'wdm-sep', text: '/' }));
      kids.push(crumb(state.store, true, null));
    }
    refs.crumbs.appendChild(frag(kids));
  }

  function renderGens() {
    var q = (refs.search.value || '').toLowerCase();
    var list = sortGenerators(candidateGenerators(), state.sort).filter(function (g) {
      return !q || g.name.toLowerCase().indexOf(q) !== -1 || (g.title || '').toLowerCase().indexOf(q) !== -1;
    });
    clear(refs.gensList);
    if (!list.length) {
      refs.gensList.appendChild(el('div', { class: 'wdm-note', text: 'No visited generators yet. Open some generators (or use \u201cLoad all\u201d in the Generators tab) to populate this list.' }));
      return;
    }
    refs.gensList.appendChild(frag(list.map(function (g) {
      var meta = [g.name];
      if (g.current) meta.push('open now'); else if (g.t) meta.push(timeAgo(g.t));
      if (g.bytes != null) meta.push('\u2248 ' + fmtBytes(g.bytes));
      var titleKids = [];
      if (g.fav) titleKids.push(el('span', { class: 'wdm-star', text: '\u2605' }));
      titleKids.push(el('span', { class: 'wdm-name', text: g.title || g.name }));
      if (g.dbs != null) titleKids.push(el('span', { class: 'wdm-pill' + (g.dbs > 0 ? ' wdm-has' : ''), text: g.dbs > 0 ? (g.dbs + ' DB' + (g.dbs > 1 ? 's' : '')) : 'no data' }));
      return el('div', { class: 'wdm-item' + (g.name === state.slug ? ' wdm-on' : ''), onclick: function () { selectGenerator(g.name); } }, [
        el('div', { class: 'wdm-t' }, titleKids),
        el('div', { class: 'wdm-m', text: meta.join(' \u00b7 ') })
      ]);
    })));
  }

  function refreshCurrent() {
    if (state.store && state.storeDesc) renderRecords(state.slug, state.db, state.storeDesc);
    else if (state.db) selectDb(state.slug, state.db);
    else if (state.slug) selectGenerator(state.slug);
  }

  function selectGenerator(slug) {
    state.slug = slug; state.db = null; state.store = null; state.storeDesc = null;
    releaseAllExcept(slug);
    renderCrumbs(); renderGens(); setPane('dbs');
    clear(refs.midTools);
    refs.midTools.appendChild(sub(slug));
    spinner(refs.midList, 'Loading databases\u2026');
    resetMain('');
    Promise.all([rpc(slug, 'list', {}), rpc(slug, 'estimate', {}).catch(function () { return null; })]).then(function (results) {
      var dbs = results[0];
      var est = results[1];
      rememberScan(slug, dbs.length, est && est.usage);
      renderGens();
      clear(refs.midTools);
      refs.midTools.appendChild(frag([
        sub(dbs.length + ' database(s)' + (est ? ' \u00b7 \u2248 ' + fmtBytes(est.usage) + ' used' : '')),
        ghost('\u21bb', function () { selectGenerator(slug); }, 'Reload databases'),
        ghost('Export all', function () { exportAll(slug); }, 'Export every database on this origin'),
        ghost('Import', function () { importInto(slug); }, 'Import an idbml dump into this origin')
      ]));
      clear(refs.midList);
      if (!dbs.length) {
        refs.midList.appendChild(el('div', { class: 'wdm-note', text: 'No IndexedDB databases on this origin.' }));
        resetMain('This generator has not stored IndexedDB data on this device.');
        return;
      }
      refs.midList.appendChild(frag(dbs.map(function (info) {
        return el('div', { class: 'wdm-item' + (info.name === state.db ? ' wdm-on' : ''), onclick: function () { selectDb(slug, info.name); } }, [
          el('div', { class: 'wdm-t' }, [el('span', { class: 'wdm-name', text: info.name })]),
          el('div', { class: 'wdm-m', text: 'v' + (info.version || '?') })
        ]);
      })));
      resetMain('Pick a database to see its stores.');
    }).catch(function (err) {
      clear(refs.midList);
      refs.midList.appendChild(el('div', { class: 'wdm-note', text: 'Could not read this generator: ' + err.message }));
    });
  }

  function selectDb(slug, db) {
    state.db = db; state.store = null; state.storeDesc = null;
    renderCrumbs(); setPane('main');
    markMidSelection();
    clear(refs.mainTools);
    refs.mainTools.appendChild(frag([
      sub(db),
      ghost('\u21bb', function () { selectDb(slug, db); }, 'Reload schema'),
      ghost('Export DB', function () { exportDb(slug, db); }),
      ghost('Duplicate as\u2026', function () { duplicateDb(slug, db); }),
      btn('Delete DB', function () { deleteDb(slug, db); }, { kind: 'danger' })
    ]));
    spinner(refs.mainBody, 'Reading schema\u2026');
    rpc(slug, 'describe', { db: db }).then(function (desc) {
      clear(refs.mainBody);
      if (!desc) { refs.mainBody.appendChild(el('div', { class: 'wdm-note', text: 'Database not found.' })); return; }
      // Extensions (e.g. AICC): typed tools rendered ABOVE the generic stores list.
      var exts = (window.weldDataExtensions || []).filter(function (x) { try { return x && typeof x.match === 'function' && x.match(desc); } catch (e) { return false; } });
      exts.forEach(function (ext) {
        if (typeof ext.render === 'function') {
          try { ext.render({ slug: slug, db: db, desc: desc, parent: refs.mainBody, rpc: rpc, toast: toast, confirmYes: confirmYes, ghost: ghost, btn: btn, sub: sub, el: el, frag: frag, clear: clear, spinner: spinner, refresh: function () { selectDb(slug, db); } }); } catch (e) { console.error('[weld] extension render failed', ext.id, e); }
        }
      });
      refs.mainBody.appendChild(frag(desc.stores.map(function (st) {
        var idxTxt = st.indexes.length ? ('indexes: ' + st.indexes.map(function (x) { return x.name; }).join(', ')) : 'no indexes';
        var keyTxt = (st.keyPath === null || st.keyPath === undefined) ? 'out-of-line key' : ('key: ' + JSON.stringify(st.keyPath) + (st.autoIncrement ? ' ++' : ''));
        return el('div', { class: 'wdm-item', onclick: function () { selectStore(slug, db, st); } }, [
          el('div', { class: 'wdm-t' }, [el('span', { class: 'wdm-name', text: st.name }), el('span', { class: 'wdm-pill', text: String(st.count) })]),
          el('div', { class: 'wdm-m', text: keyTxt + ' \u00b7 ' + idxTxt })
        ]);
      })));
    }).catch(function (err) { clear(refs.mainBody); refs.mainBody.appendChild(el('div', { class: 'wdm-note', text: 'Error: ' + err.message })); });
  }
  function markMidSelection() {
    Array.prototype.forEach.call(refs.midList.querySelectorAll('.wdm-item'), function (n) {
      var nameEl = n.querySelector('.wdm-name');
      n.classList.toggle('wdm-on', !!nameEl && nameEl.textContent === state.db);
    });
  }

  function selectStore(slug, db, st) {
    state.store = st.name; state.storeDesc = st; state.offset = 0; state.filter = ''; state.searchHits = null;
    renderCrumbs(); setPane('main');
    renderRecords(slug, db, st);
  }

  function renderRecords(slug, db, st) {
    state.storeDesc = st;
    clear(refs.mainTools);
    var lastPage = null;
    var repaint = debounce(paintRows, 120);
    var filterBox = el('input', { class: 'wdm-field wdm-search', placeholder: 'Filter this page \u2014 Enter scans the whole store\u2026', value: state.filter,
      oninput: function () { state.filter = filterBox.value; if (state.searchHits) state.searchHits = null; repaint(); },
      onkeydown: function (e) { if (e.key === 'Enter' && filterBox.value.trim()) deepScan(slug, db, st, filterBox.value.trim()); } });
    var sizeSel = el('select', { class: 'wdm-field', style: { flex: 'none' }, title: 'Page size', onchange: function () {
      state.pageSize = parseInt(sizeSel.value, 10); gset('wdmPageSize', state.pageSize); state.offset = 0; renderRecords(slug, db, st);
    } });
    [25, 50, 100, 250].forEach(function (n) {
      var op = el('option', { value: String(n), text: String(n) + '/page' });
      if (n === state.pageSize) op.selected = true;
      sizeSel.appendChild(op);
    });
    refs.mainTools.appendChild(frag([
      filterBox, sizeSel,
      ghost('\u21bb', function () { renderRecords(slug, db, st); }, 'Reload records'),
      ghost('Export store', function () { exportStoreUi(slug, db, st); }),
      ghost('Import\u2026', function () { importStoreUi(slug, db, st); }, 'Import records into this store'),
      btn('+ Record', function () { editRecord(slug, db, st, null); }),
      btn('Clear', function () { clearStoreUi(slug, db, st); }, { kind: 'danger', title: 'Delete every record in this store' })
    ]));

    function paintRows() {
      clear(refs.mainBody);
      var rows = state.searchHits ? state.searchHits.rows : (lastPage ? lastPage.rows : []);
      var hasInline = !(st.keyPath === null || st.keyPath === undefined);
      var needle = state.searchHits ? '' : state.filter.toLowerCase();
      var tbl = el('table', { class: 'wdm-tbl' });
      tbl.appendChild(el('tr', {}, [el('th', { text: 'key' }), el('th', { text: 'value' })]));
      var trs = [];
      rows.forEach(function (row) {
        if (needle && row.hay.indexOf(needle) === -1) return;
        trs.push(el('tr', { class: 'wdm-rec', onclick: function () { editRecord(slug, db, st, { key: row.primaryKey, valueEnc: row.valueEnc, hasInline: hasInline }); } }, [
          el('td', { class: 'wdm-key', text: row.kp }),
          el('td', { class: 'wdm-val', text: row.hp })
        ]));
      });
      if (!trs.length) trs.push(el('tr', {}, [el('td', { class: 'wdm-val', html: '<span style="opacity:.55">\u2014 ' + (rows.length ? 'no matches on this page (Enter = scan whole store)' : 'empty') + ' \u2014</span>' }), el('td', {})]));
      tbl.appendChild(frag(trs));
      refs.mainBody.appendChild(tbl);

      if (state.searchHits) {
        refs.mainBody.appendChild(el('div', { class: 'wdm-pager' }, [
          el('span', { text: 'deep scan: ' + state.searchHits.rows.length + ' match(es) of ' + state.searchHits.scanned + ' scanned' + (state.searchHits.done ? '' : ' (capped)') }),
          ghost('Back to pages', function () { state.searchHits = null; renderRecords(slug, db, st); })
        ]));
      } else if (lastPage) {
        refs.mainBody.appendChild(el('div', { class: 'wdm-pager' }, [
          ghost('\u2039 prev', function () { if (state.offset > 0) { state.offset = Math.max(0, state.offset - state.pageSize); renderRecords(slug, db, st); } }),
          el('span', { text: 'rows ' + (state.offset + 1) + '\u2013' + (state.offset + lastPage.rows.length) + ' of ' + st.count }),
          ghost('next \u203a', function () { if (!lastPage.done) { state.offset += state.pageSize; renderRecords(slug, db, st); } })
        ]));
      }
    }

    if (state.searchHits) { annotateRows(state.searchHits.rows); paintRows(); return; }
    spinner(refs.mainBody, 'Loading records\u2026');
    rpc(slug, 'page', { db: db, store: st.name, offset: state.offset, limit: state.pageSize }).then(function (page) {
      lastPage = page;
      annotateRows(page.rows);
      paintRows();
    }).catch(function (err) { clear(refs.mainBody); refs.mainBody.appendChild(el('div', { class: 'wdm-note', text: 'Error: ' + err.message })); });
  }

  function deepScan(slug, db, st, query) {
    spinner(refs.mainBody, 'Scanning every record in ' + st.name + '\u2026');
    rpc(slug, 'search', { db: db, store: st.name, query: query, limit: 200 }, 90000).then(function (res) {
      state.searchHits = res;
      renderRecords(slug, db, st);
    }).catch(function (err) { toast('Scan failed: ' + err.message); renderRecords(slug, db, st); });
  }

  /* ---- record editor ---------------------------------------------------- */
  function editRecord(slug, db, st, existing) {
    var isNew = !existing;
    var hasInline = isNew ? !(st.keyPath === null || st.keyPath === undefined) : existing.hasInline;
    var ta = el('textarea', { class: 'wdm-ta', spellcheck: 'false' });
    ta.value = isNew ? JSON.stringify({}, null, 2) : JSON.stringify(existing.valueEnc, null, 2);
    var jsonState = el('div', { class: 'wdm-jsonstate ok', text: 'valid JSON' });
    ta.addEventListener('input', debounce(function () {
      var r = tryJson(ta.value);
      jsonState.className = 'wdm-jsonstate ' + (r.ok ? 'ok' : 'bad');
      jsonState.textContent = r.ok ? 'valid JSON' : ('invalid: ' + r.error);
    }, 150));
    var keyField = null;
    if (!hasInline) {
      keyField = el('input', { class: 'wdm-field', placeholder: 'key (required)', style: { flex: 'none', minWidth: '150px' } });
      if (!isNew) keyField.value = typeof existing.key === 'string' ? existing.key : JSON.stringify(existing.key);
    }
    var footKids = [];
    if (keyField) footKids.push(keyField);
    footKids.push(el('span', { class: 'wdm-hint', text: 'Stored form, special types tagged (Date, bytes, Map\u2026); tags round-trip on save.' }));
    footKids.push(ghost('Format', function () {
      var r = tryJson(ta.value);
      if (!r.ok) { toast('Invalid JSON: ' + r.error); return; }
      ta.value = JSON.stringify(r.value, null, 2);
    }, 'Pretty-print'));
    footKids.push(ghost('Copy', function () {
      try { navigator.clipboard.writeText(ta.value).then(function () { toast('Copied'); }, function () { toast('Copy failed'); }); } catch (e) { toast('Copy failed'); }
    }));
    if (!isNew) {
      footKids.push(ghost('Duplicate', doDuplicate, hasInline ? 'Save a copy (clears its key so the store assigns a new one)' : 'Save a copy under a new key'));
      footKids.push(btn('Delete', doDelete, { kind: 'danger' }));
    }
    footKids.push(ghost('Cancel', closeModal));
    footKids.push(btn('Save', doSave));

    document.body.appendChild(el('div', { class: 'wdm-root wdm-modal', id: 'wdm-modal' }, [
      el('div', { class: 'wdm-card' }, [
        el('h3', { text: (isNew ? 'New record' : 'Edit record') + ' \u00b7 ' + db + '/' + st.name }),
        ta, jsonState,
        el('div', { class: 'wdm-foot' }, footKids)
      ])
    ]));
    ta.focus();

    function closeModal() { var m = document.getElementById('wdm-modal'); if (m) m.remove(); }
    function parsedValue() {
      var r = tryJson(ta.value);
      if (!r.ok) toast('Invalid JSON: ' + r.error);
      return r;
    }
    function explicitKey() {
      if (!keyField) return { ok: true };
      if (keyField.value === '') { toast('This store needs an explicit key.'); return { ok: false }; }
      return { ok: true, key: jsonOrString(keyField.value) };
    }
    function doSave() {
      var pv = parsedValue(); if (!pv.ok) return;
      var ek = explicitKey(); if (!ek.ok) return;
      var args = { db: db, store: st.name, valueEnc: pv.value };
      if (keyField) args.key = ek.key;
      rpc(slug, 'putEnc', args).then(function () { closeModal(); toast('Saved'); refreshCount(slug, db, st); })
        .catch(fail('Save failed'));
    }
    function doDuplicate() {
      var pv = parsedValue(); if (!pv.ok) return;
      var value = pv.value;
      if (hasInline && typeof st.keyPath === 'string' && value && typeof value === 'object') {
        delete value[st.keyPath];   // auto-increment assigns a fresh key
      }
      var args = { db: db, store: st.name, valueEnc: value };
      if (keyField) {
        var nk = window.prompt('Key for the duplicate:', '');
        if (nk == null || nk === '') return;
        args.key = jsonOrString(nk);
      }
      rpc(slug, 'putEnc', args).then(function () { closeModal(); toast('Duplicated'); refreshCount(slug, db, st); })
        .catch(fail('Duplicate failed'));
    }
    function doDelete() {
      if (!confirmYes('Delete this record?')) return;
      var snapshotEnc = existing.valueEnc;
      var snapshotKey = existing.key;
      rpc(slug, 'del', { db: db, store: st.name, key: existing.key }).then(function () {
        closeModal();
        pushUndo('record', function () {
          var args = { db: db, store: st.name, valueEnc: snapshotEnc };
          if (!hasInline) args.key = snapshotKey;
          return rpc(slug, 'putEnc', args);
        });
        offerUndo('record', 'Record deleted');
        refreshCount(slug, db, st);
      }).catch(fail('Delete failed'));
    }
  }
  function refreshCount(slug, db, st) {
    rpc(slug, 'describe', { db: db }).then(function (desc) {
      var fresh = desc && desc.stores.filter(function (x) { return x.name === st.name; })[0];
      renderRecords(slug, db, fresh || st);
    }).catch(function () { renderRecords(slug, db, st); });
  }

  /* ---- store / DB tools --------------------------------------------------- */
  function clearStoreUi(slug, db, st) {
    if (!confirmYes('Clear ALL ' + st.count + ' record(s) in \u201c' + st.name + '\u201d?')) return;
    rpc(slug, 'exportStore', { db: db, store: st.name }, 120000).then(function (dump) {
      var canUndo = dump && !snapshotTooBig(dump);
      return rpc(slug, 'clear', { db: db, store: st.name }).then(function () {
        if (canUndo) {
          pushUndo('clear', function () { return rpc(slug, 'importStore', { db: db, storeDump: dump, mode: 'merge' }, 180000); });
          offerUndo('clear', 'Store cleared');
        } else toast('Store cleared (too large to snapshot for undo)');
        refreshCount(slug, db, st);
      });
    }).catch(fail('Clear failed'));
  }
  function deleteDb(slug, db) {
    if (!confirmYes('Delete the ENTIRE database \u201c' + db + '\u201d? All stores and records will be destroyed.')) return;
    rpc(slug, 'exportDb', { db: db }, 180000).then(function (dump) {
      var canUndo = dump && !snapshotTooBig(dump);
      return rpc(slug, 'deleteDb', { db: db }).then(function () {
        if (canUndo) {
          pushUndo('deleteDb', function () { return rpc(slug, 'import', { dump: { databases: [dump] }, mode: 'replace' }, 240000); });
          offerUndo('deleteDb', 'Database deleted');
        } else toast('Database deleted (too large to snapshot for undo)');
        selectGenerator(slug);
      });
    }).catch(fail('Delete failed'));
  }
  function duplicateDb(slug, db) {
    var as = window.prompt('Duplicate \u201c' + db + '\u201d as:', db + '-copy');
    if (!as || as === db) return;
    toast('Duplicating\u2026');
    rpc(slug, 'dupDb', { db: db, as: as }, 240000).then(function () { toast('Duplicated as \u201c' + as + '\u201d'); selectGenerator(slug); })
      .catch(fail('Duplicate failed'));
  }
  function exportDb(slug, db) {
    toast('Exporting ' + db + '\u2026');
    rpc(slug, 'exportDb', { db: db }, 180000).then(function (dump) {
      download(slug + '.' + db + '.' + stamp() + '.idbml.json',
        JSON.stringify({ format: 'idbml-export', formatVersion: 1, slug: slug, exportedAt: new Date().toISOString(), databases: [dump] }, null, 2));
      toast('Exported ' + db);
    }).catch(fail('Export failed'));
  }
  function exportStoreUi(slug, db, st) {
    toast('Exporting ' + st.name + '\u2026');
    rpc(slug, 'exportStore', { db: db, store: st.name }, 120000).then(function (dump) {
      download(slug + '.' + db + '.' + st.name + '.' + stamp() + '.idbml-store.json',
        JSON.stringify({ format: 'idbml-store', formatVersion: 1, slug: slug, db: db, exportedAt: new Date().toISOString(), store: dump }, null, 2));
      toast('Exported ' + dump.records.length + ' record(s)');
    }).catch(fail('Export failed'));
  }
  function importStoreUi(slug, db, st) {
    pickFile().then(function (f) {
      if (!f) return;
      var r = tryJson(f.text);
      if (!r.ok) { toast('Not valid JSON'); return; }
      var parsed = r.value;
      var storeDump = null;
      if (parsed && parsed.format === 'idbml-store' && parsed.store) storeDump = parsed.store;
      else if (parsed && parsed.format === 'idbml-export' && parsed.databases) {
        // pull a same-named store out of a full dump
        parsed.databases.forEach(function (dbd) {
          (dbd.stores || []).forEach(function (s) { if (s.name === st.name) storeDump = s; });
        });
        if (!storeDump) { toast('That dump has no store named \u201c' + st.name + '\u201d.'); return; }
      } else { toast('File is not an idbml store/export'); return; }
      storeDump.name = st.name;   // import INTO this store regardless of source name
      var mode = confirmYes('Import ' + (storeDump.records || []).length + ' record(s) into \u201c' + st.name + '\u201d?\n\nOK = REPLACE store contents\nCancel = MERGE on top') ? 'replace' : 'merge';
      toast('Importing (' + mode + ')\u2026');
      rpc(slug, 'importStore', { db: db, storeDump: storeDump, mode: mode }, 180000).then(function () { toast('Imported'); refreshCount(slug, db, st); })
        .catch(fail('Import failed'));
    });
  }
  function exportAll(slug) {
    toast('Exporting all databases on ' + slug + '\u2026');
    rpc(slug, 'exportAll', {}, 240000).then(function (dump) {
      dump.slug = slug;
      download(slug + '.all.' + stamp() + '.idbml.json', JSON.stringify(dump, null, 2));
      toast('Exported ' + (dump.databases ? dump.databases.length : 0) + ' database(s)');
    }).catch(fail('Export failed'));
  }
  function importInto(slug) {
    pickFile().then(function (f) {
      if (!f) return;
      var r = tryJson(f.text);
      if (!r.ok) { toast('Not valid JSON'); return; }
      var dump = r.value;
      if (!dump || !dump.databases) { toast('File is not an idbml export'); return; }
      var mode = confirmYes('Import ' + dump.databases.length + ' database(s) into \u201c' + slug + '\u201d?\n\nOK = REPLACE matching databases\nCancel = MERGE into existing') ? 'replace' : 'merge';
      toast('Importing (' + mode + ')\u2026');
      rpc(slug, 'import', { dump: dump, mode: mode }, 240000).then(function (res) { toast('Imported ' + res.length + ' database(s)'); selectGenerator(slug); })
        .catch(fail('Import failed'));
    });
  }

  /* ---- sweep: back up every listed generator into one file ------------------ */
  var sweeping = false;
  function sweepBackup() {
    if (sweeping) { toast('A sweep is already running'); return; }
    var list = sortGenerators(candidateGenerators(), 'recent');
    if (!list.length) { toast('Nothing to sweep \u2014 no visited generators'); return; }
    if (!confirmYes('Back up ' + list.length + ' generator(s)?\n\nEach is loaded briefly in a hidden frame, one at a time. Generators with no data are recorded and skipped. This can take a while.')) return;
    sweeping = true;
    state.slug = state.db = state.store = null;
    renderCrumbs(); setPane('main');
    clear(refs.mainTools);
    var stopAsked = false;
    var stopBtn = btn('Stop after current', function () { stopAsked = true; stopBtn.disabled = true; }, { kind: 'danger' });
    refs.mainTools.appendChild(frag([sub('Sweep backup \u2014 ' + list.length + ' generator(s)'), stopBtn]));
    clear(refs.mainBody);
    var log = el('div', { class: 'wdm-sweep' });
    refs.mainBody.appendChild(log);
    function line(cls, slug, msg) {
      log.appendChild(el('div', { class: 'row' }, [el('span', { class: cls, text: slug }), el('span', { class: 'dim', text: msg })]));
      refs.mainBody.scrollTop = refs.mainBody.scrollHeight;
    }

    var bundle = { format: 'idbml-sweep', formatVersion: 1, exportedAt: new Date().toISOString(), generators: [] };
    var ok = 0, empty = 0, failed = 0;
    seqEach(list, function (g) {
      if (stopAsked) return;
      line('dim', g.name, 'loading\u2026');
      return rpc(g.name, 'exportAll', {}, 240000).then(function (dump) {
        var n = (dump.databases || []).length;
        var bytes = 0;
        try { bytes = JSON.stringify(dump.databases || []).length; } catch (e) {}
        rememberScan(g.name, n, bytes);
        if (n > 0) { ok++; bundle.generators.push({ slug: g.name, dump: dump }); line('ok', g.name, n + ' DB(s), \u2248 ' + fmtBytes(bytes)); }
        else { empty++; line('dim', g.name, 'no data'); }
      }).catch(function (err) {
        failed++;
        rememberScan(g.name, 0, null);
        line('bad', g.name, err.message);
      }).then(function () { releaseFrame(g.name); });
    }).then(function () {
      sweeping = false;
      renderGens();
      line('dim', '\u2014', 'done: ' + ok + ' with data, ' + empty + ' empty, ' + failed + ' failed' + (stopAsked ? ' (stopped early)' : ''));
      if (bundle.generators.length) {
        download('perchance-sweep.' + stamp() + '.idbml-sweep.json', JSON.stringify(bundle));
        toast('Sweep complete \u2014 ' + bundle.generators.length + ' generator(s) backed up');
      } else toast('Sweep complete \u2014 nothing to back up');
    });
  }

  /* ---- drawer tab launcher --------------------------------------------------- */
  function renderLaunch(body) {
    styleOnce();
    var wrap = el('div', { class: 'wdm-root wdm-launch' });
    wrap.appendChild(el('div', { class: 'wdm-lrow' }, [
      btn('Open Data Manager', open),
      ghost('\u29C9 Sweep backup', function () { open(); setTimeout(sweepBackup, 60); }, 'Back up every visited generator into one file')
    ]));
    wrap.appendChild(frag(sortGenerators(candidateGenerators(), 'recent').slice(0, 8).map(function (g) {
      var pill = (g.dbs != null)
        ? el('span', { class: 'wdm-pill' + (g.dbs > 0 ? ' wdm-has' : ''), text: g.dbs > 0 ? (g.dbs + ' DB' + (g.dbs > 1 ? 's' : '')) : 'no data' })
        : el('span', { class: 'wdm-pill', text: '?' });
      return el('div', { class: 'wdm-litem', onclick: function () { open(); setTimeout(function () { selectGenerator(g.name); }, 60); } }, [
        el('span', { style: { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: (g.fav ? '\u2605 ' : '') + (g.title || g.name) }),
        pill
      ]);
    })));
    wrap.appendChild(el('div', { class: 'wdm-note', style: { padding: '4px 2px 0' }, text: 'Browse, edit, back up, export & import every generator\u2019s IndexedDB \u2014 reach is your visited history. Shift+D opens the manager anywhere.' }));
    body.appendChild(wrap);
  }

  /* ---- entry points ------------------------------------------------------------ */
  function boot() {
    try { GM_registerMenuCommand('Weld: Data manager (browse all databases)', open); } catch (e) {}
    try { GM_registerMenuCommand('Weld: Sweep backup (all visited generators)', function () { open(); setTimeout(sweepBackup, 60); }); } catch (e) {}
    document.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName) || '';
      if (e.shiftKey && (e.key === 'D' || e.key === 'd') && !/INPUT|TEXTAREA|SELECT/.test(tag) && !e.target.isContentEditable) {
        if (!document.getElementById('wdm-root-panel')) { e.preventDefault(); open(); }
      }
    }, false);
    var api = { open: open, renderTab: renderLaunch, sweep: sweepBackup, rpc: rpc, releaseFrame: releaseFrame };
    window.weldDataManager = api;
    try { if (typeof unsafeWindow !== 'undefined') unsafeWindow.weldDataManager = api; } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

/* ----- [3] AICC CORE ----- */
/* AICC schema + Companion-side helpers (top-frame only).
 *
 * Source of truth: ai-character-chat aicc_2.txt v90. The exportable-character
 * stripping rules below are copied verbatim from AICC's own share-link prep
 * (delete id / creationTime / lastMessageTime; folderName=''; customData reduced
 * to PUBLIC only) so a round-tripped character re-imports as a native share.
 *
 * Exposes window.weldAICC = {
 *   DB_NAME, DB_VERSION, schema, isAICC(describeResult),
 *   stripCharacterForShare(character),       // returns a fresh stripped clone
 *   buildShareHashUrl(slug, character),      // ?data=… isn't possible without an upload; we use the # path
 *   makeBroadcastChannel(name),              // SSR-safe wrapper that returns null where BC is absent
 *   uuidV4(), isUuid(s)
 * }
 */
(function () {
  'use strict';
  if (window.top !== window) return;

  var DB_NAME = 'chatbot-ui-v1';
  var DB_VERSION = 90;
  // Mirrors AICC's db.version(90).stores() declaration. Used by the AICC pack
  // to verify a database it's about to touch really is an AICC database before
  // any write — refuses to operate on a coincidentally-named DB with a different
  // shape.
  var schema = {
    name: DB_NAME,
    version: DB_VERSION,
    stores: {
      characters: { keyPath: 'id', autoIncrement: true, indexes: ['modelName', 'fitMessagesInContextMethod', 'uuid', 'creationTime', 'lastMessageTime', 'folderPath'] },
      threads:    { keyPath: 'id', autoIncrement: true, indexes: ['name', 'characterId', 'creationTime', 'lastMessageTime', 'lastViewTime', 'folderPath'] },
      messages:   { keyPath: 'id', autoIncrement: true, indexes: ['threadId', 'characterId', 'creationTime', 'order'] },
      misc:       { keyPath: 'key', autoIncrement: false, indexes: [] },
      summaries:  { keyPath: 'hash', autoIncrement: false, indexes: ['threadId'] },
      memories:   { keyPath: 'id', autoIncrement: true, indexes: ['[summaryHash+threadId]', '[characterId+status]', '[threadId+status]', '[threadId+index]', 'threadId'] },
      lore:       { keyPath: 'id', autoIncrement: true, indexes: ['bookId', 'bookUrl'] },
      textEmbeddingCache:   { keyPath: 'id', autoIncrement: true, indexes: ['textHash', '&[textHash+modelName]'] },
      textCompressionCache: { keyPath: 'id', autoIncrement: true, indexes: ['uncompressedTextHash', '&[uncompressedTextHash+modelName+tokenLimit]'] }
    }
  };

  // Test a describeDatabase() result against the schema. Returns
  // { ok, matchedStores, missingStores, extraStores }. A DB is "AICC-shaped" if
  // it has the right name and contains every characters/threads/messages store
  // (extras are tolerated — AICC may forward-evolve the schema between bumps).
  function isAICC(desc) {
    if (!desc || desc.name !== DB_NAME) return { ok: false, reason: 'not chatbot-ui-v1' };
    var have = {};
    (desc.stores || []).forEach(function (s) { have[s.name] = true; });
    var required = ['characters', 'threads', 'messages'];
    var missing = required.filter(function (n) { return !have[n]; });
    if (missing.length) return { ok: false, reason: 'missing stores: ' + missing.join(', ') };
    var expected = Object.keys(schema.stores);
    var matched = expected.filter(function (n) { return have[n]; });
    var extras = Object.keys(have).filter(function (n) { return expected.indexOf(n) === -1; });
    return { ok: true, version: desc.version, matchedStores: matched, missingStores: expected.filter(function (n) { return !have[n]; }), extraStores: extras };
  }

  function stripCharacterForShare(input) {
    if (!input || typeof input !== 'object') return null;
    var c;
    try { c = JSON.parse(JSON.stringify(input)); } catch (e) { return null; }
    delete c.id;
    delete c.creationTime;
    delete c.lastMessageTime;
    delete c.folderPath;
    c.folderName = '';
    if (c.customData && typeof c.customData === 'object') {
      var keep = {};
      if (Object.prototype.hasOwnProperty.call(c.customData, 'PUBLIC')) keep.PUBLIC = c.customData.PUBLIC;
      c.customData = keep;
    }
    return c;
  }

  function buildShareHashUrl(slug, character) {
    var payload = { addCharacter: character, quickAdd: true };
    var hash = encodeURIComponent(JSON.stringify(payload)).replace(/[!'()*]/g, function (ch) {
      return '%' + ch.charCodeAt(0).toString(16);
    });
    return 'https://perchance.org/' + encodeURIComponent(slug || 'ai-character-chat') + '#' + hash;
  }

  function makeBroadcastChannel(name) {
    try { return new BroadcastChannel(name); } catch (e) { return null; }
  }

  function uuidV4() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = []; for (var j = 0; j < 16; j++) h.push((b[j] + 0x100).toString(16).slice(1));
    return h[0] + h[1] + h[2] + h[3] + '-' + h[4] + h[5] + '-' + h[6] + h[7] + '-' + h[8] + h[9] + '-' + h[10] + h[11] + h[12] + h[13] + h[14] + h[15];
  }
  function isUuid(s) { return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s); }

  window.weldAICC = {
    DB_NAME: DB_NAME,
    DB_VERSION: DB_VERSION,
    schema: schema,
    isAICC: isAICC,
    stripCharacterForShare: stripCharacterForShare,
    buildShareHashUrl: buildShareHashUrl,
    makeBroadcastChannel: makeBroadcastChannel,
    uuidV4: uuidV4,
    isUuid: isUuid
  };
})();

/* ----- [4] AICC PACK ----- */
/* AICC Pack — Companion-side enhancements for ai-character-chat and any other
 * generator that uses the chatbot-ui-v1 Dexie database.
 *
 * What's in here:
 *   • Sentry        — BroadcastChannel-based presence probe + write-gate
 *                     (`canWriteToAICC(slug)`); destructive writes refuse while
 *                     a live AICC tab claims the origin.
 *   • Lore Library  — GM-stored catalog of {name, url, tags, notes}; supports
 *                     user.uploads.dev (uploaded through a hidden AICC frame,
 *                     since upload-plugin needs a Perchance origin) and direct
 *                     paste of raw.githubusercontent.com URLs. Each entry has a
 *                     per-entry "where to host" preference (defaults can be
 *                     toggled on/off in the panel).
 *   • Character round-trip — pull a row from `db.characters`, run it through
 *                     weldAICC.stripCharacterForShare (AICC's own rules), push
 *                     to GitHub as <slug>/characters/<name>.<uuid>.json; reverse
 *                     direction reads a JSON file and either opens the share
 *                     URL (AICC alive → AICC owns the merge) or writes through
 *                     the engine (AICC closed → uuid de-dupe like AICC does).
 *                     One character at a time, per your preference.
 *   • Repair tools  — boot-failure detector reading the same fields AICC's own
 *                     upgrade code repairs, plus a quarantine for rows that
 *                     can't be saved.
 *   • Typed view    — friendlier columns for characters/threads/messages/lore
 *                     that drop into the Data Manager's main pane on AICC DBs.
 *
 * Hard rule: NO destructive write to a chatbot-ui-v1 database while an AICC
 * tab on that origin is alive. Two writers on a Dexie ++id store will interleave
 * and corrupt sequences. The sentry returns { ok: false, reason: 'AICC is open' }
 * when in doubt, and the UI offers "open the share link" as the safe path.
 */
(function () {
  'use strict';
  if (window.top !== window) return;

  var NS = 'weldCompanion';
  function gget(k, d) { try { var v = GM_getValue(NS + ':' + k, undefined); return v === undefined ? d : JSON.parse(v); } catch (e) { return d; } }
  function gset(k, v) { try { GM_setValue(NS + ':' + k, JSON.stringify(v)); } catch (e) {} }

  // ---- Sentry: cooperative presence over BroadcastChannel -----------------
  // Cooperative because unmodified AICC doesn't broadcast its own presence. So
  // the sentry pings a per-slug channel; if any listener replies within the
  // timeout, AICC is treated as open. A future 3-line AICC patch (announce on
  // load + on visibilitychange) would make this firm, but until then the
  // conservative default is "assume open" only when we have positive evidence.
  // The companion also tracks frames it spawned itself so it knows the
  // difference between "user has AICC open in a tab" and "we just spun up the
  // hidden frame to do this work".
  var SENTRY_CHANNEL = 'weld-aicc-presence';
  var PROBE_TIMEOUT = 800; // ms

  function probeAICC(slug, ourOwnFrameIds) {
    return new Promise(function (resolve) {
      var bc = window.weldAICC.makeBroadcastChannel(SENTRY_CHANNEL + '/' + slug);
      if (!bc) { resolve({ open: false, peers: 0, reason: 'no BroadcastChannel' }); return; }
      var peers = 0;
      var hostile = 0;
      var nonce = 'wp-' + Math.random().toString(36).slice(2);
      bc.onmessage = function (ev) {
        var d = ev.data || {};
        if (d.kind !== 'pong' || d.replyTo !== nonce) return;
        peers++;
        // a peer whose `frameId` we didn't issue is a real AICC tab (or another
        // top-frame Companion driving its own work). Either way: not us.
        if (!ourOwnFrameIds || !d.frameId || ourOwnFrameIds.indexOf(d.frameId) === -1) hostile++;
      };
      try { bc.postMessage({ kind: 'ping', nonce: nonce }); } catch (e) {}
      setTimeout(function () {
        try { bc.close(); } catch (e) {}
        resolve({ open: hostile > 0, peers: peers, hostile: hostile });
      }, PROBE_TIMEOUT);
    });
  }

  // Single write-gate: every destructive AICC op goes through this. Returns
  // { ok: true } when safe; { ok: false, reason } when not. ourFrames is the
  // set of hidden-frame slugs the Data Manager has currently spawned, so the
  // gate won't false-positive on the Companion's own helper frame.
  function canWriteToAICC(slug, ourFrames) {
    return probeAICC(slug, ourFrames || []).then(function (r) {
      if (r.open) return { ok: false, reason: 'An AICC tab is open on this origin — close it before writing, or use the share link path.' };
      return { ok: true };
    });
  }

  // ---- Lore Library --------------------------------------------------------
  // GM-stored array of { id, name, url, tags, notes, host, t }.
  // host ∈ {"uploads", "github", "external"}. Defaults: both upload paths are
  // enabled (you asked for both, toggleable); the user picks per-lorebook,
  // with a config row in the panel for the two defaults.
  function loreAll() { return gget('aiccLore', []) || []; }
  function loreSave(list) { gset('aiccLore', list); }
  function loreCfg() {
    var d = gget('aiccLoreCfg', null);
    if (!d) d = { enableUploads: true, enableGitHub: true };
    return d;
  }
  function loreCfgSave(c) { gset('aiccLoreCfg', c); }

  function loreAdd(entry) {
    var list = loreAll();
    entry.id = entry.id || ('lore-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
    entry.t = entry.t || Date.now();
    list.unshift(entry);
    loreSave(list);
    return entry;
  }
  function loreRemove(id) {
    var list = loreAll().filter(function (e) { return e.id !== id; });
    loreSave(list);
  }
  function loreUpdate(id, patch) {
    var list = loreAll();
    var i = -1;
    for (var k = 0; k < list.length; k++) if (list[k].id === id) { i = k; break; }
    if (i < 0) return null;
    for (var key in patch) list[i][key] = patch[key];
    loreSave(list);
    return list[i];
  }

  // ---- Character round-trip ------------------------------------------------
  // The host already has GitHub Push/Pull for the EDITOR (DSL + HTML panes).
  // For characters we use the same Contents-API plumbing, but write to a
  // per-generator characters/ folder. The path template is overridable in the
  // AICC pack settings:   <repo>/<slug>/characters/<name>.<uuid>.json
  //
  // Each character JSON looks like:
  //   { format: 'aicc-character', formatVersion: 1, exportedAt: '...',
  //     character: <stripped-by-AICC-rules> }
  // Re-importing a character with the same uuid replaces the existing row,
  // because that's what AICC's own import code does (line 13466 in aicc_2.txt).
  function characterPathTemplate() { return gget('aiccCharPath', '{slug}/characters/{name}.{uuid}.json'); }

  function characterPath(slug, character) {
    var safeName = String(character.name || 'unnamed').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'unnamed';
    return characterPathTemplate()
      .replace(/\{slug\}/g, slug || 'ai-character-chat')
      .replace(/\{name\}/g, safeName)
      .replace(/\{uuid\}/g, character.uuid || 'no-uuid');
  }

  function characterBundle(character) {
    var stripped = window.weldAICC.stripCharacterForShare(character);
    if (!stripped) throw new Error('character is empty or invalid');
    if (!stripped.uuid || !window.weldAICC.isUuid(stripped.uuid)) {
      stripped.uuid = window.weldAICC.uuidV4();   // give it a fresh uuid so a round-trip is stable
    }
    return {
      format: 'aicc-character',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      character: stripped
    };
  }

  function parseCharacterBundle(text) {
    var json;
    try { json = JSON.parse(text); } catch (e) { return { ok: false, reason: 'not JSON: ' + e.message }; }
    if (!json || typeof json !== 'object') return { ok: false, reason: 'not an object' };
    if (json.format && json.format !== 'aicc-character') return { ok: false, reason: 'not an aicc-character bundle' };
    var c = json.character || json.addCharacter || json;   // also accept a raw character or a share envelope
    if (!c || !c.name) return { ok: false, reason: 'no character.name' };
    return { ok: true, character: c };
  }

  // ---- Repair tools --------------------------------------------------------
  // Diagnose an AICC DB without opening it for write. Reports:
  //   - characters with missing/invalid uuids
  //   - threads pointing at nonexistent characterId
  //   - messages pointing at nonexistent threadId
  //   - summaries with no messageIds (AICC's own upgrade discards these)
  // Returns a structured report the UI can render with one-click fixes.
  function diagnose(rpc, slug, db) {
    var report = { characters: [], threads: [], messages: [], summaries: [], counts: {} };
    function pageAll(store) {
      var rows = []; var offset = 0;
      function next() {
        return rpc(slug, 'page', { db: db, store: store, offset: offset, limit: 500 }).then(function (page) {
          rows = rows.concat(page.rows || []);
          offset += (page.rows || []).length;
          if (page.done) return rows;
          return next();
        });
      }
      return next();
    }
    var decoder = window.IDBManEngine({});
    function decodeRow(r) { try { return decoder.decodeValue(r.valueEnc); } catch (e) { return r.valueEnc; } }
    var chars = [], threads = [], messages = [], summaries = [];
    return pageAll('characters').then(function (rows) { chars = rows.map(decodeRow); report.counts.characters = chars.length; return pageAll('threads'); })
      .then(function (rows) { threads = rows.map(decodeRow); report.counts.threads = threads.length; return pageAll('messages'); })
      .then(function (rows) { messages = rows.map(decodeRow); report.counts.messages = messages.length; return pageAll('summaries').catch(function () { return []; }); })
      .then(function (rows) { summaries = rows.map(decodeRow); report.counts.summaries = summaries.length;
        var charById = {}; chars.forEach(function (c) { charById[c.id] = c; if (!c.uuid || !window.weldAICC.isUuid(c.uuid)) report.characters.push({ id: c.id, name: c.name, issue: 'missing/invalid uuid' }); });
        var threadById = {}; threads.forEach(function (t) { threadById[t.id] = t; if (t.characterId != null && t.characterId !== -1 && t.characterId !== -2 && !charById[t.characterId]) report.threads.push({ id: t.id, name: t.name, issue: 'characterId ' + t.characterId + ' not found' }); });
        messages.forEach(function (m) { if (m.threadId != null && !threadById[m.threadId]) report.messages.push({ id: m.id, threadId: m.threadId, issue: 'threadId not found' }); });
        summaries.forEach(function (s) { if (!s.messageIds) report.summaries.push({ hash: s.hash, issue: 'no messageIds — AICC will discard on upgrade' }); });
        return report;
      });
  }

  // ---- user.uploads.dev uploader ---------------------------------------------
  // upload-plugin only resolves from a Perchance origin, so the upload runs
  // INSIDE the generator's sandbox frame via the Data Manager agent's
  // 'uploadText' op (the agent calls the generator's own root.uploadPlugin).
  // Works on any generator that imports upload-plugin — AICC does. Content
  // passes through Perchance moderation; a 'disallowed_content' rejection is
  // surfaced verbatim so the user knows why.
  function uploadToPerchance(slug, text, mime) {
    if (!window.weldDataManager || typeof window.weldDataManager.rpc !== 'function') {
      return Promise.reject(new Error('Data Manager not loaded — open the Data tab once first.'));
    }
    return window.weldDataManager.rpc(slug, 'uploadText', { text: String(text == null ? '' : text), mime: mime || 'text/plain' }, 90000)
      .then(function (r) {
        if (!r || !r.url) throw new Error('upload returned no URL');
        return String(r.url);
      });
  }

  // ---- Recovery engine -----------------------------------------------------
  // Restores an AICC database to a BOOTABLE state, not merely a parseable one.
  // Three escalating strategies, all pure functions over decoded rows so they
  // can be unit-tested and previewed before any write:
  //
  //   normalizeCharacter(c)  — applies AICC's upgradeCharacterFromOldVersion
  //                            field defaults (aicc_2.txt:3058) + mints a uuid.
  //   normalizeMessage(m)    — ensures variants:[null] (AICC's message upgrade).
  //   reconcile(tables)      — AICC's corruptItemReplacer logic: placeholder
  //                            broken characters, recover thread.characterId
  //                            from messages, drop orphan messages/lore.
  //
  // planRepair(tables) returns a structured plan { actions, fixed, dropped,
  // quarantined, tables } WITHOUT mutating its input, so the UI can show
  // "12 characters normalized, 3 threads recovered, 5 orphan messages dropped"
  // and let the user confirm before anything is written.
  var DEFAULT_EMBEDDING_MODEL = 'Xenova/bge-base-en-v1.5';

  function normalizeCharacter(input) {
    var c = input;            // caller passes a clone
    var changed = [];
    function set(k, v) { c[k] = v; changed.push(k); }
    upgradeInitialMessages(c, changed);
    if (c.customCode === undefined) set('customCode', '');
    if (c.modelVersion) { c.modelName = c.modelVersion; delete c.modelVersion; changed.push('modelName'); }
    if (c.textEmbeddingModelName === undefined) { c.textEmbeddingModelName = c.associativeMemoryEmbeddingModelName != null ? c.associativeMemoryEmbeddingModelName : DEFAULT_EMBEDDING_MODEL; delete c.associativeMemoryEmbeddingModelName; changed.push('textEmbeddingModelName'); }
    if (c.userCharacter === undefined) set('userCharacter', {});
    if (c.avatar === undefined) { c.avatar = { url: c.avatarUrl, size: 1, shape: 'square' }; changed.push('avatar'); }
    if (Object.prototype.hasOwnProperty.call(c, 'avatarUrl')) delete c.avatarUrl;
    if (c.scene === undefined) set('scene', { background: {}, music: {} });
    if (c.streamingResponse === undefined) set('streamingResponse', true);
    if (c.roleInstruction === undefined) { c.roleInstruction = c.systemMessage != null ? c.systemMessage : ''; delete c.systemMessage; changed.push('roleInstruction'); }
    if (c.folderPath === undefined) set('folderPath', '');
    if (c.customData === undefined) set('customData', {});
    if (c.systemCharacter === undefined) set('systemCharacter', { avatar: {} });
    if (c.loreBookUrls === undefined) set('loreBookUrls', []);
    if (c.associativeMemoryMethod !== undefined) { c.autoGenerateMemories = c.associativeMemoryMethod; delete c.associativeMemoryMethod; changed.push('autoGenerateMemories'); }
    if (c.autoGenerateMemories === undefined) set('autoGenerateMemories', 'none');
    if (c.maxTokensPerMessage === undefined) set('maxTokensPerMessage', null);
    // uuid: AICC leaves null on upgrade, but a valid uuid is what makes a
    // character round-trippable and de-dupable, so repair mints one when absent.
    if (!c.uuid || !window.weldAICC.isUuid(c.uuid)) { c.uuid = window.weldAICC.uuidV4(); changed.push('uuid'); }
    if (!c.name) { c.name = 'Unnamed'; changed.push('name'); }
    return { character: c, changed: changed };
  }
  function upgradeInitialMessages(c, changed) {
    if (c.initialMessages === undefined && c.firstMessage !== undefined) {
      c.initialMessages = [{ author: 'ai', content: c.firstMessage }];
      delete c.firstMessage;
      changed.push('initialMessages');
    }
    if (!Array.isArray(c.initialMessages)) { c.initialMessages = c.initialMessages ? [c.initialMessages] : []; changed.push('initialMessages'); }
  }
  function normalizeMessage(m) {
    var changed = [];
    if (!m.variants) { m.variants = [null]; changed.push('variants'); }
    return { message: m, changed: changed };
  }

  // Pure planner. tables = { characters:[], threads:[], messages:[], lore:[] }
  // (decoded rows). Returns a plan; does not mutate the input arrays.
  function planRepair(tables) {
    var chars = (tables.characters || []).map(clone);
    var threads = (tables.threads || []).map(clone);
    var messages = (tables.messages || []).map(clone);
    var lore = (tables.lore || []).map(clone);
    var actions = [];
    var stats = { charactersNormalized: 0, charactersPlaceholdered: 0, threadsRecovered: 0, messagesDropped: 0, loreDropped: 0, messagesNormalized: 0 };
    // Dropped rows are never discarded — they're collected here so the apply
    // step can write them into the separate `weld-quarantine` database on the
    // same origin. (Null/unparseable rows can't be quarantined and are only
    // counted.) AICC's own schema can't host a quarantine store: adding one
    // would bump chatbot-ui-v1 past the version AICC declares and brick its
    // boot, so quarantine lives in its own database.
    var quarantine = { characters: [], threads: [], messages: [], lore: [] };

    // 1. characters: normalize fields; placeholder ones with no id
    var keptChars = [];
    chars.forEach(function (c) {
      if (c == null || typeof c !== 'object') { stats.charactersPlaceholdered++; actions.push('drop non-object character row'); return; }
      if (c.id == null) {
        // AICC's replacer keeps it with a CORRUPT name rather than dropping —
        // but a character with no id can't be a Dexie ++id row on re-put, so we
        // drop it and record it. (Threads referencing it are recovered below.)
        stats.charactersPlaceholdered++; quarantine.characters.push(c); actions.push('quarantine character with no id (was: ' + (c.name || 'unknown') + ')'); return;
      }
      var r = normalizeCharacter(c);
      if (r.changed.length) { stats.charactersNormalized++; }
      keptChars.push(r.character);
    });
    var charById = {}; keptChars.forEach(function (c) { charById[c.id] = c; });
    var anyCharId = keptChars.length ? keptChars[0].id : null;

    // 2. threads: recover dead characterId from messages (AICC's logic)
    var keptThreads = [];
    threads.forEach(function (t) {
      if (t == null || typeof t !== 'object' || t.id == null) { if (t && typeof t === 'object') quarantine.threads.push(t); actions.push('quarantine malformed thread'); return; }
      var cid = t.characterId;
      var valid = cid === -1 || cid === -2 || charById[cid];   // -1 user, -2 system
      if (!valid) {
        var firstReal = messages.find(function (m) { return m && m.threadId === t.id && m.characterId >= 0; });
        var recovered = firstReal ? firstReal.characterId : anyCharId;
        if (recovered != null) { t.characterId = recovered; if (!t.name) t.name = 'Recovered'; stats.threadsRecovered++; actions.push('recover thread ' + t.id + ' characterId -> ' + recovered); }
        else { quarantine.threads.push(t); actions.push('quarantine thread ' + t.id + ' (no characters to attach to)'); return; }
      }
      keptThreads.push(t);
    });
    var threadById = {}; keptThreads.forEach(function (t) { threadById[t.id] = t; });

    // 3. messages: drop orphans, normalize variants
    var keptMessages = [];
    messages.forEach(function (m) {
      if (m == null || typeof m !== 'object' || m.id == null) { if (m && typeof m === 'object') quarantine.messages.push(m); stats.messagesDropped++; return; }
      if (m.threadId != null && !threadById[m.threadId]) { quarantine.messages.push(m); stats.messagesDropped++; actions.push('quarantine orphan message ' + m.id); return; }
      var r = normalizeMessage(m);
      if (r.changed.length) stats.messagesNormalized++;
      keptMessages.push(m);
    });

    // 4. lore: drop entries whose book/thread is gone is too aggressive (lore
    // can be shared by URL), so only drop structurally broken rows.
    var keptLore = [];
    lore.forEach(function (l) {
      if (l == null || typeof l !== 'object' || l.id == null) { if (l && typeof l === 'object') quarantine.lore.push(l); stats.loreDropped++; return; }
      keptLore.push(l);
    });

    return {
      stats: stats,
      actions: actions,
      quarantine: quarantine,
      tables: { characters: keptChars, threads: keptThreads, messages: keptMessages, lore: keptLore }
    };
  }
  function clone(x) { try { return JSON.parse(JSON.stringify(x)); } catch (e) { return null; } }

  // Validate-and-normalize a character bundle on IMPORT, so corruption never
  // gets written back in. Returns { ok, character, changed } or { ok:false }.
  function sanitizeImportedCharacter(character) {
    if (!character || typeof character !== 'object' || !character.name) return { ok: false, reason: 'no name' };
    var r = normalizeCharacter(clone(character));
    return { ok: true, character: r.character, changed: r.changed };
  }


  // The Data Manager looks for window.weldDataExtensions and, for each AICC
  // database it opens, calls extension.render(ctx). This is the integration
  // surface — kept narrow so the AICC pack is decoupled from the manager's
  // internals.
  var api = {
    schema: window.weldAICC.schema,
    isAICC: window.weldAICC.isAICC,
    sentry: { probeAICC: probeAICC, canWriteToAICC: canWriteToAICC },
    lore: {
      all: loreAll, add: loreAdd, remove: loreRemove, update: loreUpdate,
      cfg: loreCfg, cfgSave: loreCfgSave
    },
    character: {
      pathTemplate: characterPathTemplate,
      pathFor: characterPath,
      bundle: characterBundle,
      parseBundle: parseCharacterBundle
    },
    diagnose: diagnose,
    recovery: {
      normalizeCharacter: normalizeCharacter,
      normalizeMessage: normalizeMessage,
      planRepair: planRepair,
      sanitizeImportedCharacter: sanitizeImportedCharacter
    },
    upload: { perchance: uploadToPerchance }
  };

  // Register with the Data Manager as a typed extension. The manager checks
  // every described database against this matcher and, when it matches, asks
  // render() to draw the typed view in place of the generic stores view.
  window.weldDataExtensions = window.weldDataExtensions || [];
  window.weldDataExtensions.push({
    id: 'aicc',
    label: 'AI Character Chat',
    match: function (desc) { return window.weldAICC.isAICC(desc).ok; },
    api: api
  });

  // Convenience handle for the console / other modules
  window.weldAICCPack = api;
})();

/* ----- [5] AICC TYPED VIEW ----- */
/* AICC typed view — registers a render() on the extension entry created by
 * aicc-pack.js. The Data Manager calls this when an AICC-shaped database is
 * opened; it draws three collapsible sections above the generic stores list:
 *
 *   • Characters — list pulled from db.characters with one-click "Push to
 *     GitHub" and "Open share link" per row. Push is one-character-per-commit
 *     (your default). Imports come in via the GitHub Pull pane.
 *   • Lore Library — GM-stored catalog, "Attach to character" picker. Add
 *     entries from a pasted URL or via the GitHub Pull pane (full upload
 *     support requires a small agent extension — see README).
 *   • Repair — runs aiccPack.diagnose(), reports orphan rows, offers a
 *     one-click "Quarantine corrupt rows" gated by the sentry.
 *
 * Privacy: every destructive operation goes through aiccPack.sentry's write-
 * gate, which refuses while an AICC tab is open on the same origin. Character
 * data is treated as private — sharing flows always require explicit user
 * confirmation before any URL is shown or committed.
 */
(function () {
  'use strict';
  if (window.top !== window) return;
  if (!window.weldAICCPack || !window.weldDataExtensions) return;

  var pack = window.weldAICCPack;
  var ext = null;
  for (var i = 0; i < window.weldDataExtensions.length; i++) {
    if (window.weldDataExtensions[i].id === 'aicc') { ext = window.weldDataExtensions[i]; break; }
  }
  if (!ext) return;

  // ---- styles (additive; uses the wdm- token palette) ----------------------
  function styleOnce() {
    if (document.getElementById('wdm-aicc-style')) return;
    var css = [
      '.wdm-ext{margin-bottom:14px;border:1px solid var(--wc-line,rgba(255,255,255,.09));border-radius:10px;background:var(--wc-surface-2,#1a1f28);overflow:hidden;}',
      '.wdm-ext-hd{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--wc-line-2,rgba(255,255,255,.05));cursor:pointer;user-select:none;}',
      '.wdm-ext-hd .wdm-ext-title{font:700 12px var(--wc-mono,ui-monospace,monospace);letter-spacing:.04em;text-transform:uppercase;color:var(--wc-arc,#ff8a3d);flex:1;}',
      '.wdm-ext-hd .wdm-ext-count{font:11px var(--wc-mono,ui-monospace,monospace);color:var(--wc-faint,#5d6b7b);}',
      '.wdm-ext-hd .wdm-ext-chev{color:var(--wc-faint,#5d6b7b);font-size:11px;transition:transform .15s;}',
      '.wdm-ext.collapsed .wdm-ext-chev{transform:rotate(-90deg);}',
      '.wdm-ext.collapsed .wdm-ext-body{display:none;}',
      '.wdm-ext-body{padding:10px 12px;}',
      '.wdm-cc{display:flex;align-items:center;gap:10px;padding:8px;border-radius:8px;border:1px solid transparent;}',
      '.wdm-cc:hover{background:var(--wc-surface,#13171e);border-color:var(--wc-line,rgba(255,255,255,.09));}',
      '.wdm-cc-av{width:32px;height:32px;border-radius:8px;background:var(--wc-surface,#13171e);flex:none;object-fit:cover;}',
      '.wdm-cc-body{flex:1;min-width:0;}',
      '.wdm-cc-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.wdm-cc-meta{font:11px var(--wc-mono,ui-monospace,monospace);color:var(--wc-faint,#5d6b7b);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.wdm-cc-actions{display:flex;gap:6px;flex:none;}',
      '.wdm-lore-row{display:flex;align-items:center;gap:10px;padding:8px;border-radius:8px;}',
      '.wdm-lore-row:hover{background:var(--wc-surface,#13171e);}',
      '.wdm-lore-host{font:600 10px var(--wc-mono,ui-monospace,monospace);padding:2px 7px;border-radius:999px;border:1px solid var(--wc-line,rgba(255,255,255,.09));color:var(--wc-dim,#9aa7b6);flex:none;}',
      '.wdm-lore-host.uploads{color:var(--wc-signal,#4ee0c8);border-color:var(--wc-signal,#4ee0c8);}',
      '.wdm-lore-host.github{color:var(--wc-arc,#ff8a3d);border-color:var(--wc-arc,#ff8a3d);}',
      '.wdm-lore-url{flex:1;min-width:0;font:11px var(--wc-mono,ui-monospace,monospace);color:var(--wc-dim,#9aa7b6);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.wdm-repair{font:12px/1.6 var(--wc-mono,ui-monospace,monospace);}',
      '.wdm-repair .ok{color:var(--wc-signal,#4ee0c8);}',
      '.wdm-repair .warn{color:var(--wc-arc,#ff8a3d);}',
      '.wdm-repair .bad{color:#e5534b;}',
      '.wdm-aicc-warn{padding:8px 10px;border-radius:8px;background:rgba(229,83,75,.10);border:1px solid rgba(229,83,75,.30);color:#e5534b;font:12px var(--wc-sans,sans-serif);margin-bottom:8px;}'
    ].join('\n');
    document.head.appendChild(Object.assign(document.createElement('style'), { id: 'wdm-aicc-style', innerHTML: css }));
  }

  // ---- a tiny collapsible section helper -----------------------------------
  function section(ctx, title, countText, openByDefault, build) {
    var bodyEl = ctx.el('div', { class: 'wdm-ext-body' });
    var hd = ctx.el('div', { class: 'wdm-ext-hd' }, [
      ctx.el('span', { class: 'wdm-ext-title', text: title }),
      countText ? ctx.el('span', { class: 'wdm-ext-count', text: countText }) : null,
      ctx.el('span', { class: 'wdm-ext-chev', text: '\u25BC' })
    ]);
    var wrap = ctx.el('div', { class: 'wdm-ext' + (openByDefault ? '' : ' collapsed') }, [hd, bodyEl]);
    hd.addEventListener('click', function () { wrap.classList.toggle('collapsed'); });
    build(bodyEl, function (newCount) { var c = hd.querySelector('.wdm-ext-count'); if (c) c.textContent = newCount; });
    return wrap;
  }

  // ---- decode helpers ------------------------------------------------------
  var _decoder = null;
  function decoder() { try { if (!_decoder && window.IDBManEngine) _decoder = window.IDBManEngine({}); } catch (e) {} return _decoder; }
  function decodeRow(row) { try { return decoder().decodeValue(row.valueEnc); } catch (e) { return row.valueEnc; } }
  function loadAllRows(ctx, store) {
    var rows = []; var offset = 0;
    function next() {
      return ctx.rpc(ctx.slug, 'page', { db: ctx.db, store: store, offset: offset, limit: 500 }).then(function (page) {
        rows = rows.concat((page.rows || []).map(decodeRow));
        offset += (page.rows || []).length;
        if (page.done) return rows;
        return next();
      });
    }
    return next();
  }

  // ============================================================================
  // 1. CHARACTERS
  // ============================================================================
  function renderCharacters(body, setCount, ctx) {
    var summary = ctx.el('div', { class: 'wdm-note', text: 'Loading characters\u2026' });
    body.appendChild(summary);
    loadAllRows(ctx, 'characters').then(function (chars) {
      ctx.clear(body);
      setCount(chars.length + ' character' + (chars.length === 1 ? '' : 's'));
      if (!chars.length) { body.appendChild(ctx.el('div', { class: 'wdm-note', text: 'No characters in this DB yet.' })); return; }
      body.appendChild(ctx.frag(chars.map(function (c) {
        var avatar = c.avatar && c.avatar.url ? c.avatar.url : '';
        var meta = ['uuid: ' + (c.uuid || '\u2014'), c.modelName || 'no model'];
        if (c.loreBookUrls && c.loreBookUrls.length) meta.push(c.loreBookUrls.length + ' lorebook' + (c.loreBookUrls.length === 1 ? '' : 's'));
        return ctx.el('div', { class: 'wdm-cc' }, [
          avatar ? ctx.el('img', { class: 'wdm-cc-av', src: avatar, loading: 'lazy', referrerpolicy: 'no-referrer', onerror: function (e) { e.target.style.visibility = 'hidden'; } })
                 : ctx.el('div', { class: 'wdm-cc-av' }),
          ctx.el('div', { class: 'wdm-cc-body' }, [
            ctx.el('div', { class: 'wdm-cc-name', text: c.name || '\u2014' }),
            ctx.el('div', { class: 'wdm-cc-meta', text: meta.join(' \u00b7 ') })
          ]),
          ctx.el('div', { class: 'wdm-cc-actions' }, [
            ctx.ghost('Share link', function () { showShareLink(ctx, c); }, 'Build a Perchance share URL (private \u2014 nothing is uploaded)'),
            ctx.ghost('Save .json', function () { downloadCharacter(ctx, c); }, 'Download a private JSON file'),
            ctx.ghost('Push to GitHub\u2026', function () { pushCharacter(ctx, c); }, 'Commit one character to your configured GitHub repo'),
            ctx.ghost('Attach lore\u2026', function () { attachLore(ctx, c); }, 'Append a Lore Library URL to this character')
          ])
        ]);
      })));
    }).catch(function (err) {
      ctx.clear(body);
      body.appendChild(ctx.el('div', { class: 'wdm-aicc-warn', text: 'Could not read characters: ' + err.message }));
    });
  }

  function showShareLink(ctx, character) {
    if (!ctx.confirmYes('Share links contain the full character (system prompt, custom code, lore URLs). Build a share URL for "' + (character.name || 'unnamed') + '"?')) return;
    var url = window.weldAICC.buildShareHashUrl(ctx.slug, window.weldAICC.stripCharacterForShare(character));
    // Don't auto-copy to clipboard; show in a modal so the user opts in.
    var ta = ctx.el('textarea', { class: 'wdm-ta', spellcheck: 'false', style: { minHeight: '90px' } });
    ta.value = url;
    var modal = ctx.el('div', { class: 'wdm-modal', id: 'wdm-modal' }, [
      ctx.el('div', { class: 'wdm-card' }, [
        ctx.el('h3', { text: 'Share link \u00b7 ' + (character.name || 'unnamed') }),
        ta,
        ctx.el('div', { class: 'wdm-foot' }, [
          ctx.el('span', { class: 'wdm-hint', text: 'Anyone with this URL can add the character to their AICC. Treat it like a password if the character carries sensitive instructions.' }),
          ctx.ghost('Copy', function () { try { navigator.clipboard.writeText(url).then(function () { ctx.toast('Copied'); }); } catch (e) { ctx.toast('Copy failed'); } }),
          ctx.btn('Done', function () { var m = document.getElementById('wdm-modal'); if (m) m.remove(); })
        ])
      ])
    ]);
    document.body.appendChild(modal);
    ta.focus(); ta.select();
  }

  function downloadCharacter(ctx, character) {
    if (!ctx.confirmYes('Save "' + (character.name || 'unnamed') + '" as a .json file? It includes the full character data (avatar URL, system prompt, custom code).')) return;
    var bundle = pack.character.bundle(character);
    var safeName = String(character.name || 'unnamed').replace(/[^A-Za-z0-9._-]+/g, '_');
    var blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    var a = ctx.el('a', { href: URL.createObjectURL(blob), download: safeName + '.aicc-character.json' });
    document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); URL.revokeObjectURL(a.href); }, 1500);
    ctx.toast('Downloaded ' + safeName);
  }

  function pushCharacter(ctx, character) {
    var path = pack.character.pathFor(ctx.slug, character);
    if (!ctx.confirmYes('Push "' + (character.name || 'unnamed') + '" to your configured GitHub repo as:\n\n  ' + path + '\n\nThis commits the full character (system prompt, custom code, lore URLs). Continue?')) return;
    var bundle = pack.character.bundle(character);
    // Reuse the host Companion's existing GitHub Push plumbing if exposed.
    if (typeof window.weldPushFileToGitHub === 'function') {
      window.weldPushFileToGitHub({ path: path, content: JSON.stringify(bundle, null, 2), message: 'Push character: ' + (character.name || 'unnamed') })
        .then(function () { ctx.toast('Pushed ' + (character.name || 'unnamed')); })
        .catch(function (err) { ctx.toast('Push failed: ' + err.message); });
    } else {
      ctx.toast('Character Push hook not present in this Companion build \u2014 download as .json instead.');
    }
  }

  function attachLore(ctx, character) {
    var entries = pack.lore.all();
    if (!entries.length) { ctx.toast('Lore Library is empty \u2014 add an entry first.'); return; }
    var sel = ctx.el('select', { class: 'wdm-field', style: { flex: '1' } });
    entries.forEach(function (e) { sel.appendChild(ctx.el('option', { value: e.id, text: e.name + '  (' + e.host + ')' })); });
    var modal = ctx.el('div', { class: 'wdm-modal', id: 'wdm-modal' }, [
      ctx.el('div', { class: 'wdm-card' }, [
        ctx.el('h3', { text: 'Attach lorebook to ' + (character.name || 'unnamed') }),
        ctx.el('div', { class: 'wdm-foot', style: { borderTop: '0', paddingTop: '0' } }, [sel]),
        ctx.el('div', { class: 'wdm-foot' }, [
          ctx.el('span', { class: 'wdm-hint', text: 'Adds the lorebook URL to character.loreBookUrls. Safe path: it\u2019s just a URL the character will fetch.' }),
          ctx.ghost('Cancel', function () { var m = document.getElementById('wdm-modal'); if (m) m.remove(); }),
          ctx.btn('Attach', function () {
            var entry = entries.filter(function (e) { return e.id === sel.value; })[0];
            if (!entry) return;
            doAttachLore(ctx, character, entry);
            var m = document.getElementById('wdm-modal'); if (m) m.remove();
          })
        ])
      ])
    ]);
    document.body.appendChild(modal);
  }

  function doAttachLore(ctx, character, loreEntry) {
    pack.sentry.canWriteToAICC(ctx.slug, [ctx.slug]).then(function (gate) {
      if (!gate.ok) {
        // AICC alive: show the share-link path instead. Build a copy of the
        // character with the lore URL appended and surface the share URL.
        var augmented = JSON.parse(JSON.stringify(character));
        augmented.loreBookUrls = augmented.loreBookUrls || [];
        if (augmented.loreBookUrls.indexOf(loreEntry.url) === -1) augmented.loreBookUrls.push(loreEntry.url);
        showShareLink(ctx, augmented);
        ctx.toast(gate.reason);
        return;
      }
      // AICC closed: write through.
      var updated = JSON.parse(JSON.stringify(character));
      updated.loreBookUrls = updated.loreBookUrls || [];
      if (updated.loreBookUrls.indexOf(loreEntry.url) === -1) updated.loreBookUrls.push(loreEntry.url);
      ctx.rpc(ctx.slug, 'putEnc', { db: ctx.db, store: 'characters', valueEnc: updated }).then(function () {
        ctx.toast('Attached \u201c' + loreEntry.name + '\u201d');
        ctx.refresh();
      }).catch(function (err) { ctx.toast('Attach failed: ' + err.message); });
    });
  }

  // ============================================================================
  // 2. LORE LIBRARY
  // ============================================================================
  function renderLore(body, setCount, ctx) {
    var entries = pack.lore.all();
    var cfg = pack.lore.cfg();
    setCount(entries.length + ' entr' + (entries.length === 1 ? 'y' : 'ies'));

    // Config row: defaults for new lorebooks (user.uploads.dev / GitHub),
    // toggleable per your "both, on/off" preference.
    var upToggle = ctx.el('label', { class: 'wdm-hint', style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
      ctx.el('input', { type: 'checkbox', onchange: function (e) { cfg.enableUploads = e.target.checked; pack.lore.cfgSave(cfg); } }),
      ctx.el('span', { text: 'user.uploads.dev (anyone with URL can read)' })
    ]);
    upToggle.querySelector('input').checked = !!cfg.enableUploads;
    var ghToggle = ctx.el('label', { class: 'wdm-hint', style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
      ctx.el('input', { type: 'checkbox', onchange: function (e) { cfg.enableGitHub = e.target.checked; pack.lore.cfgSave(cfg); } }),
      ctx.el('span', { text: 'GitHub (committed to your repo, served from raw.githubusercontent.com)' })
    ]);
    ghToggle.querySelector('input').checked = !!cfg.enableGitHub;

    body.appendChild(ctx.el('div', { class: 'wdm-foot', style: { borderTop: '0', paddingTop: '4px', flexDirection: 'column', alignItems: 'flex-start' } }, [
      ctx.el('div', { class: 'wdm-hint', style: { fontWeight: 600 }, text: 'Default hosting for new lorebooks:' }),
      upToggle, ghToggle
    ]));

    var addInput = ctx.el('input', { class: 'wdm-field', placeholder: 'paste a lorebook URL (.txt) and press Enter\u2026', style: { flex: '1' } });
    addInput.addEventListener('keydown', function (e) { if (e.key === 'Enter' && addInput.value.trim()) addFromUrl(ctx, addInput.value.trim(), function () { addInput.value = ''; rerender(); }); });
    body.appendChild(ctx.el('div', { class: 'wdm-coltools', style: { padding: '8px 0', border: '0' } }, [
      addInput,
      ctx.ghost('+ Add from URL', function () { if (addInput.value.trim()) addFromUrl(ctx, addInput.value.trim(), function () { addInput.value = ''; rerender(); }); }),
      ctx.ghost('Upload\u2026', function () { uploadNew(ctx, rerender); }, 'Upload a local .txt file (host depends on your toggles above)')
    ]));

    var listWrap = ctx.el('div');
    body.appendChild(listWrap);
    paint();

    function rerender() {
      entries = pack.lore.all();
      setCount(entries.length + ' entr' + (entries.length === 1 ? 'y' : 'ies'));
      paint();
    }
    function paint() {
      ctx.clear(listWrap);
      if (!entries.length) {
        listWrap.appendChild(ctx.el('div', { class: 'wdm-note', text: 'No lorebooks saved yet. Paste a raw .txt URL above, or upload one.' }));
        return;
      }
      listWrap.appendChild(ctx.frag(entries.map(function (entry) {
        var hostClass = entry.host === 'uploads' ? 'uploads' : (entry.host === 'github' ? 'github' : '');
        return ctx.el('div', { class: 'wdm-lore-row' }, [
          ctx.el('span', { class: 'wdm-lore-host ' + hostClass, text: entry.host || 'external' }),
          ctx.el('div', { style: { flex: '1', minWidth: '0' } }, [
            ctx.el('div', { style: { fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: entry.name }),
            ctx.el('div', { class: 'wdm-lore-url', text: entry.url })
          ]),
          ctx.ghost('Copy URL', function () { try { navigator.clipboard.writeText(entry.url).then(function () { ctx.toast('Copied'); }); } catch (e) {} }),
          ctx.ghost('Remove', function () { if (ctx.confirmYes('Remove \u201c' + entry.name + '\u201d from your Lore Library?')) { pack.lore.remove(entry.id); rerender(); ctx.toast('Removed'); } })
        ]);
      })));
    }
  }

  function addFromUrl(ctx, url, done) {
    if (!/^https?:\/\//i.test(url)) { ctx.toast('Use a full https:// URL'); return; }
    var name = window.prompt('Name this lorebook:', deriveName(url));
    if (name == null) return;
    var host = url.indexOf('user.uploads.dev') !== -1 ? 'uploads' : (url.indexOf('raw.githubusercontent.com') !== -1 ? 'github' : 'external');
    pack.lore.add({ name: name || deriveName(url), url: url, host: host, tags: [], notes: '' });
    ctx.toast('Added');
    done && done();
  }
  function deriveName(url) {
    try { var u = new URL(url); var f = u.pathname.split('/').pop().replace(/\.[^.]+$/, ''); return f || u.hostname; } catch (e) { return 'Untitled'; }
  }
  function uploadNew(ctx, done) {
    var cfg = pack.lore.cfg();
    var inp = ctx.el('input', { type: 'file', accept: '.txt,.md,text/plain', style: { display: 'none' } });
    inp.addEventListener('change', function () {
      var file = inp.files && inp.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result);
        // Route by host preference. Both enabled: ask. Only one: use it. Neither: nudge.
        var hosts = [];
        if (cfg.enableUploads) hosts.push('uploads');
        if (cfg.enableGitHub) hosts.push('github');
        if (!hosts.length) { ctx.toast('Enable at least one hosting option above first.'); return; }
        var host = hosts.length === 1 ? hosts[0]
          : (ctx.confirmYes('Host on user.uploads.dev (anyone with the URL can read)?\n\nOK = user.uploads.dev\nCancel = GitHub (your repo)') ? 'uploads' : 'github');
        if (host === 'uploads') {
          pack.upload.perchance(ctx.slug, text, 'text/plain').then(function (url) {
            pack.lore.add({ name: file.name.replace(/\.[^.]+$/, ''), url: url, host: 'uploads', tags: [], notes: '' });
            ctx.toast('Uploaded to user.uploads.dev'); done && done();
          }).catch(function (err) {
            // Honest fallback — surface the limitation, don't pretend it worked.
            ctx.toast('Direct upload not available: ' + err.message);
          });
        } else {
          if (typeof window.weldPushFileToGitHub !== 'function') { ctx.toast('GitHub Push hook not present in this Companion build.'); return; }
          var path = 'lore/' + file.name.replace(/[^A-Za-z0-9._-]+/g, '_');
          window.weldPushFileToGitHub({ path: path, content: text, message: 'Add lore: ' + file.name })
            .then(function (info) {
              // Best-effort raw URL; let the user paste it back if our heuristic misses
              var url = (info && info.rawUrl) || '';
              if (!url) url = window.prompt('Committed. Paste the raw URL for this file:', 'https://raw.githubusercontent.com/owner/repo/main/' + path) || '';
              if (!url) return;
              pack.lore.add({ name: file.name.replace(/\.[^.]+$/, ''), url: url, host: 'github', tags: [], notes: '' });
              ctx.toast('Saved to GitHub'); done && done();
            }).catch(function (err) { ctx.toast('Push failed: ' + err.message); });
        }
      };
      reader.readAsText(file);
    });
    document.body.appendChild(inp); inp.click(); setTimeout(function () { inp.remove(); }, 120000);
  }

  // ============================================================================
  // 3. REPAIR
  // ============================================================================
  function renderRepair(body, setCount, ctx) {
    var actions = ctx.el('div', { class: 'wdm-coltools', style: { padding: '0 0 8px 0', border: '0' } }, [
      ctx.btn('Run diagnosis', function () { runDiagnose(); }),
      ctx.ghost('Repair this database\u2026', function () { runRepair(); }, 'Normalize characters, recover broken threads, drop orphan rows \u2014 makes a non-booting DB bootable')
    ]);
    var report = ctx.el('div', { class: 'wdm-repair', text: 'Run diagnosis to scan, or Repair to plan a fix. Repair never writes without showing you the plan first.' });
    body.appendChild(actions); body.appendChild(report);

    function loadTables() {
      return Promise.all(['characters', 'threads', 'messages', 'lore'].map(function (s) {
        return loadAllRows(ctx, s).catch(function () { return []; });
      })).then(function (res) {
        return { characters: res[0], threads: res[1], messages: res[2], lore: res[3] };
      });
    }

    function runRepair() {
      ctx.clear(report);
      ctx.spinner(report, 'Reading all rows and planning a repair\u2026');
      loadTables().then(function (tables) {
        var plan = pack.recovery.planRepair(tables);
        ctx.clear(report);
        var s = plan.stats;
        var total = s.charactersNormalized + s.charactersPlaceholdered + s.threadsRecovered + s.messagesDropped + s.messagesNormalized + s.loreDropped;
        if (!total) { report.appendChild(ctx.el('div', { class: 'ok', text: '\u2713 Nothing to repair \u2014 the database is already consistent.' })); return; }
        report.appendChild(ctx.el('div', { class: 'warn', style: { fontWeight: 600 }, text: 'Repair plan:' }));
        [
          ['characters normalized', s.charactersNormalized, 'ok'],
          ['characters dropped (no id)', s.charactersPlaceholdered, 'bad'],
          ['threads recovered', s.threadsRecovered, 'ok'],
          ['messages normalized', s.messagesNormalized, 'ok'],
          ['orphan messages dropped', s.messagesDropped, 'bad'],
          ['broken lore dropped', s.loreDropped, 'bad']
        ].forEach(function (row) {
          if (row[1]) report.appendChild(ctx.el('div', { class: row[2], style: { paddingLeft: '12px' }, text: '\u2022 ' + row[1] + ' ' + row[0] }));
        });
        var qTotal = ['characters', 'threads', 'messages', 'lore'].reduce(function (n, k) { return n + ((plan.quarantine && plan.quarantine[k]) || []).length; }, 0);
        if (qTotal) report.appendChild(ctx.el('div', { class: 'ok', style: { paddingLeft: '12px' }, text: '\u2022 ' + qTotal + ' removed row' + (qTotal === 1 ? '' : 's') + ' will be kept in the weld-quarantine database \u2014 nothing is destroyed' }));
        report.appendChild(ctx.el('div', { class: 'wdm-foot', style: { padding: '10px 0 0', border: '0' } }, [
          ctx.el('span', { class: 'wdm-hint', text: 'A full backup downloads before anything is written, and removed rows are moved into the separate weld-quarantine database on this origin \u2014 inspect or restore them any time from the Data Manager.' }),
          ctx.ghost('Export repaired copy', function () { exportRepaired(plan); }, 'Download the repaired result as an idbml file without touching the live database'),
          ctx.btn('Back up & apply', function () { applyRepair(plan, tables); }, { kind: 'danger' })
        ]));
      }).catch(function (err) { ctx.clear(report); report.appendChild(ctx.el('div', { class: 'bad', text: 'Repair planning failed: ' + err.message })); });
    }

    function exportRepaired(plan) {
      // Build an idbml-export dump from the repaired tables (no live write).
      var dump = {
        format: 'idbml-export', formatVersion: 1, slug: ctx.slug, exportedAt: new Date().toISOString(), repaired: true,
        databases: [{
          name: ctx.db,
          version: pack.schema.version,
          stores: ['characters', 'threads', 'messages', 'lore'].map(function (name) {
            var sch = pack.schema.stores[name];
            return {
              name: name, keyPath: sch.keyPath, autoIncrement: sch.autoIncrement, indexes: [],
              records: plan.tables[name].map(function (row) { return { value: encodeForDump(row) }; })
            };
          })
        }]
      };
      var blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      var a = ctx.el('a', { href: URL.createObjectURL(blob), download: ctx.slug + '.' + ctx.db + '.repaired.' + Date.now() + '.idbml.json' });
      document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); URL.revokeObjectURL(a.href); }, 1500);
      ctx.toast('Exported repaired copy \u2014 import it to verify before applying in place.');
    }
    function encodeForDump(row) {
      // values are plain decoded objects here (no Blobs/Dates in AICC core tables
      // beyond timestamps which are numbers), so a shallow tag-free copy is safe.
      try { return JSON.parse(JSON.stringify(row)); } catch (e) { return row; }
    }

    function applyRepair(plan, original) {
      pack.sentry.canWriteToAICC(ctx.slug, [ctx.slug]).then(function (gate) {
        if (!gate.ok) { ctx.toast(gate.reason + ' Use "Export repaired copy" and import it after closing AICC.'); return; }
        if (!ctx.confirmYes('Apply repair in place?\n\nA full backup is downloaded first. Then characters/threads/messages/lore are rewritten from the repaired plan. Continue?')) return;
        ctx.spinner(report, 'Backing up, then applying repair\u2026');
        // 1. full backup via exportDb
        ctx.rpc(ctx.slug, 'exportDb', { db: ctx.db }, 180000).then(function (backup) {
          var blob = new Blob([JSON.stringify({ format: 'idbml-export', formatVersion: 1, slug: ctx.slug, exportedAt: new Date().toISOString(), databases: [backup] }, null, 2)], { type: 'application/json' });
          var a = ctx.el('a', { href: URL.createObjectURL(blob), download: ctx.slug + '.' + ctx.db + '.pre-repair-backup.' + Date.now() + '.idbml.json' });
          document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); URL.revokeObjectURL(a.href); }, 1500);
          // 2. quarantine removed rows into a SEPARATE database. chatbot-ui-v1
          // itself can't host the store: adding one bumps the IDB version past
          // what AICC declares and bricks its boot. weld-quarantine is invisible
          // to AICC and browsable/restorable from the Data Manager.
          var qRows = [];
          var qSrc = plan.quarantine || {};
          ['characters', 'threads', 'messages', 'lore'].forEach(function (n) {
            (qSrc[n] || []).forEach(function (row) {
              qRows.push({ value: { srcDb: ctx.db, srcStore: n, quarantinedAt: Date.now(), row: encodeForDump(row) } });
            });
          });
          var qStep = qRows.length
            ? ctx.rpc(ctx.slug, 'importStore', { db: 'weld-quarantine', storeDump: { name: 'rows', keyPath: 'id', autoIncrement: true, indexes: [], records: qRows }, mode: 'merge' }, 180000)
            : Promise.resolve(true);
          // 3. clear + reload each repaired store
          return qStep.then(function () { return ['characters', 'threads', 'messages', 'lore'].reduce(function (chain, name) {
            return chain.then(function () {
              var sch = pack.schema.stores[name];
              var storeDump = { name: name, keyPath: sch.keyPath, autoIncrement: sch.autoIncrement, indexes: [], records: plan.tables[name].map(function (row) { return { value: encodeForDump(row) }; }) };
              return ctx.rpc(ctx.slug, 'importStore', { db: ctx.db, storeDump: storeDump, mode: 'replace' }, 180000);
            });
          }, Promise.resolve()); });
        }).then(function () {
          ctx.clear(report);
          report.appendChild(ctx.el('div', { class: 'ok', text: '\u2713 Repair applied. A pre-repair backup was downloaded, and removed rows (if any) are preserved in the weld-quarantine database. Reload AICC to verify it boots.' }));
          ctx.toast('Repair applied \u2014 reload AICC to verify');
        }).catch(function (err) { ctx.clear(report); report.appendChild(ctx.el('div', { class: 'bad', text: 'Repair failed (your backup downloaded first): ' + err.message })); });
      });
    }

    function runDiagnose() {
      ctx.clear(report);
      ctx.spinner(report, 'Scanning characters, threads, messages, summaries\u2026');
      pack.diagnose(ctx.rpc, ctx.slug, ctx.db).then(function (r) {
        ctx.clear(report);
        var problems = r.characters.length + r.threads.length + r.messages.length + r.summaries.length;
        setCount(problems + ' issue' + (problems === 1 ? '' : 's'));
        report.appendChild(ctx.el('div', {}, [
          ctx.el('span', { class: 'ok', text: 'Counts: ' }),
          ctx.el('span', { text: r.counts.characters + ' chars, ' + r.counts.threads + ' threads, ' + r.counts.messages + ' messages, ' + r.counts.summaries + ' summaries' })
        ]));
        if (!problems) { report.appendChild(ctx.el('div', { class: 'ok', text: '\u2713 No structural issues found.' })); return; }
        function listProblems(label, arr, cls) {
          if (!arr.length) return;
          report.appendChild(ctx.el('div', { class: cls, style: { marginTop: '8px' }, text: label + ' (' + arr.length + ')' }));
          arr.slice(0, 10).forEach(function (p) {
            var bits = []; for (var k in p) bits.push(k + '=' + p[k]);
            report.appendChild(ctx.el('div', { style: { paddingLeft: '12px', opacity: '.85' }, text: '\u2022 ' + bits.join('  ') }));
          });
          if (arr.length > 10) report.appendChild(ctx.el('div', { style: { paddingLeft: '12px', opacity: '.6' }, text: '\u2026 ' + (arr.length - 10) + ' more' }));
        }
        listProblems('Characters with missing/invalid uuid', r.characters, 'warn');
        listProblems('Threads pointing at nonexistent characters', r.threads, 'warn');
        listProblems('Messages pointing at nonexistent threads', r.messages, 'bad');
        listProblems('Summaries AICC will discard on upgrade', r.summaries, 'warn');
        report.appendChild(ctx.el('div', { style: { marginTop: '10px', opacity: '.7' }, text: 'Repair writes are gated by the AICC sentry. If AICC is open on this origin, fixes are staged instead of applied directly.' }));
      }).catch(function (err) {
        ctx.clear(report);
        report.appendChild(ctx.el('div', { class: 'bad', text: 'Diagnosis failed: ' + err.message }));
      });
    }
  }

  // ============================================================================
  // RENDER
  // ============================================================================
  ext.render = function (ctx) {
    styleOnce();
    // Sentry warning banner — visible whenever an AICC tab is open
    var banner = null;
    pack.sentry.probeAICC(ctx.slug, [ctx.slug]).then(function (r) {
      if (r.open) {
        var w = ctx.el('div', { class: 'wdm-aicc-warn', text: 'An AICC tab is open on this origin. Destructive edits will be staged — close the AICC tab to write directly.' });
        ctx.parent.insertBefore(w, ctx.parent.firstChild);
      }
    });

    ctx.parent.appendChild(section(ctx, '\ud83d\udc64 Characters', '\u2026', true, function (body, setCount) { renderCharacters(body, setCount, ctx); }));
    ctx.parent.appendChild(section(ctx, '\ud83d\udcd6 Lore Library', '', true, function (body, setCount) { renderLore(body, setCount, ctx); }));
    ctx.parent.appendChild(section(ctx, '\ud83d\udd27 Repair', '', false, function (body, setCount) { renderRepair(body, setCount, ctx); }));
  };
})();

/* ----- [6] AICC TOOLS ----- */
/* AICC Tools — character file import/export card.
 *
 * Rendered by renderTools() in the host Companion's Tools tab. Does NOT depend
 * on the Data Manager being open; it talks to a generator's AICC database
 * directly through the same RPC channel the Data Manager uses.
 *
 * Cards in the Tools tab:
 *   • AI Helper     — existing renderAI() content, wrapped in a wc-card
 *   • Character Files — this module; import a .json/.aicc-character.json file
 *       back into AICC (sentry-gated: write directly if AICC is closed, show
 *       the share URL if AICC is open); export all characters from the current
 *       generator as a single .json file; pull characters from GitHub.
 *
 * Privacy default: confirmation is always required before any data leaves the
 * device, and importing a file requires explicit "Add to AICC" action.
 *
 * Exposes: window.weldAICCTools = { renderCharacterFilesCard }
 */
(function () {
  'use strict';
  if (window.top !== window) return;

  var NS = 'weldCompanion';
  function gget(k, d) { try { var v = GM_getValue(NS + ':' + k, undefined); return v === undefined ? d : JSON.parse(v); } catch (e) { return d; } }

  // Minimal el() that mirrors the Companion's own helper — used only for the
  // card body since the outer renderTools() already has the full el() in scope.
  // When called from renderTools (which passes its el/btn/etc. in ctx), we use
  // ctx.el instead. This standalone version is only for self-contained rendering.
  function _el(tag, attrs, kids) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    for (var k in attrs) {
      if (k === 'text') { node.textContent = attrs[k]; }
      else if (k === 'html') { node.innerHTML = attrs[k]; }
      else if (k === 'class') { node.className = attrs[k]; }
      else if (k === 'style' && typeof attrs[k] === 'object') { Object.assign(node.style, attrs[k]); }
      else if (/^on/.test(k)) { node.addEventListener(k.slice(2), attrs[k]); }
      else { node.setAttribute(k, attrs[k]); }
    }
    (kids || []).forEach(function (c) { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  }
  function _toast(msg, ms) {
    try {
      var prev = document.querySelector('.weld-tools-toast'); if (prev) prev.remove();
      var t = _el('div', { class: 'weld-tools-toast', text: msg, style: {
        position: 'fixed', bottom: '22px', left: '50%', transform: 'translateX(-50%)', zIndex: '99999999',
        background: 'var(--wc-surface-2,#1a1f28)', color: 'var(--wc-ink,#e8e4dc)',
        border: '1px solid var(--wc-line,rgba(255,255,255,.12))', borderRadius: '9px',
        padding: '8px 14px', font: '12.5px system-ui', boxShadow: '0 10px 30px -10px rgba(0,0,0,.6)'
      } });
      document.body.appendChild(t);
      setTimeout(function () { t.remove(); }, ms || 2600);
    } catch (e) { try { console.log('[weld tools]', msg); } catch (e2) {} }
  }

  // ---- current generator slug --------------------------------------------------
  // Re-use the Companion's genName() via unsafeWindow if available; fallback to
  // parsing the URL.
  function currentSlug() {
    try { var n = (unsafeWindow || window).genName && (unsafeWindow || window).genName(); if (n) return n; } catch (e) {}
    var m = location.pathname.match(/^\/([^/#?]+)/);
    return m ? m[1] : null;
  }

  // ---- rpc shim ----------------------------------------------------------------
  // Routes through weldDataManager.rpc if present (preferred — Data Manager
  // manages the hidden frame lifecycle). If it's absent we fall back to a one-shot
  // iframe spawn (same protocol, but we manage teardown ourselves).
  function rpc(slug, op, args, timeout) {
    if (window.weldDataManager && typeof window.weldDataManager.rpc === 'function') {
      return window.weldDataManager.rpc(slug, op, args, timeout || 30000);
    }
    return Promise.reject(new Error('Data Manager not loaded — open the Data tab first.'));
  }

  // ---- decode rows -------------------------------------------------------------
  var _dec = null;
  function decodeRow(row) {
    try {
      if (!_dec) _dec = window.IDBManEngine ? window.IDBManEngine({}) : null;
      return _dec ? _dec.decodeValue(row.valueEnc) : row.valueEnc;
    } catch (e) { return row.valueEnc; }
  }

  function loadAllCharacters(slug) {
    var rows = []; var offset = 0;
    function next() {
      return rpc(slug, 'page', { db: 'chatbot-ui-v1', store: 'characters', offset: offset, limit: 500 }).then(function (p) {
        rows = rows.concat((p.rows || []).map(decodeRow));
        offset += (p.rows || []).length;
        if (p.done) return rows;
        return next();
      });
    }
    return next();
  }

  // ---- helpers -----------------------------------------------------------------
  function safeName(character) {
    return String(character.name || 'unnamed').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'unnamed';
  }
  function download(filename, text) {
    var blob = new Blob([text], { type: 'application/json' });
    var a = _el('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.appendChild(a); a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(a.href); }, 1500);
  }

  // ---- IMPORT ------------------------------------------------------------------
  // Accepts:
  //   • { format: "aicc-character", character: {...} }   — our bundle format
  //   • { addCharacter: {...}, quickAdd: true/false }    — AICC share envelope
  //   • A raw character object with at least a `name`
  //   • { characters: [...] }                           — multi-character export file
  //
  // Returns an array of parsed { ok, character, changed } results.
  function parseFile(text) {
    var json;
    try { json = JSON.parse(text); } catch (e) { return { ok: false, reason: 'Not valid JSON: ' + e.message }; }
    if (!json || typeof json !== 'object') return { ok: false, reason: 'JSON root is not an object.' };

    // Multi-character export?
    if (Array.isArray(json.characters)) {
      var results = json.characters.map(function (c) {
        return window.weldAICCPack.recovery.sanitizeImportedCharacter(c);
      });
      return { ok: true, multi: true, results: results };
    }

    // Single character — delegate to pack
    var result = window.weldAICCPack.character.parseBundle(text);
    if (!result.ok) return result;
    var sanitized = window.weldAICCPack.recovery.sanitizeImportedCharacter(result.character);
    return { ok: true, multi: false, results: [sanitized] };
  }

  function importParsedCharacters(slug, sanitizedResults, onDone) {
    // Separate clean from flagged
    var clean = sanitizedResults.filter(function (r) { return r.ok; });
    var bad = sanitizedResults.filter(function (r) { return !r.ok; });
    if (!clean.length) { _toast('No importable characters found.'); return; }

    var msg = 'Import ' + clean.length + ' character' + (clean.length === 1 ? '' : 's') + ' into AICC?';
    if (bad.length) msg += '\n\n' + bad.length + ' row' + (bad.length === 1 ? '' : 's') + ' could not be parsed and will be skipped.';
    if (!window.confirm(msg)) return;

    window.weldAICCPack.sentry.canWriteToAICC(slug, [slug]).then(function (gate) {
      if (!gate.ok) {
        // AICC is running — build share URLs and show them one at a time.
        // User can paste each into the AICC address bar; AICC handles the merge.
        showShareUrls(slug, clean.map(function (r) { return r.character; }));
        return;
      }
      // AICC closed — write directly.
      writeCharactersDirect(slug, clean, onDone);
    });
  }

  function writeCharactersDirect(slug, sanitizedList, onDone) {
    var eng = window.IDBManEngine ? window.IDBManEngine({}) : null;
    if (!eng) { _toast('IDB engine not loaded.'); return; }

    var chain = Promise.resolve();
    var written = 0;
    sanitizedList.forEach(function (r) {
      chain = chain.then(function () {
        var c = r.character;
        // De-dupe by uuid: if a character with this uuid already exists, replace it.
        if (c.uuid && window.weldAICC.isUuid(c.uuid)) {
          return rpc(slug, 'page', { db: 'chatbot-ui-v1', store: 'characters', offset: 0, limit: 500 })
            .then(function (page) {
              var rows = (page.rows || []).map(decodeRow);
              var existing = rows.find(function (row) { return row.uuid === c.uuid; });
              if (existing) {
                // Update: merge into existing record, keep its id
                var merged = Object.assign({}, existing, c, { id: existing.id });
                return rpc(slug, 'putEnc', { db: 'chatbot-ui-v1', store: 'characters', valueEnc: merged }).then(function () { written++; });
              } else {
                // Insert: strip id so Dexie assigns one
                var fresh = Object.assign({}, c);
                delete fresh.id;
                fresh.creationTime = fresh.creationTime || Date.now();
                fresh.lastMessageTime = fresh.lastMessageTime || Date.now();
                return rpc(slug, 'putEnc', { db: 'chatbot-ui-v1', store: 'characters', valueEnc: fresh }).then(function () { written++; });
              }
            });
        } else {
          var fresh = Object.assign({}, c);
          delete fresh.id;
          fresh.creationTime = fresh.creationTime || Date.now();
          fresh.lastMessageTime = fresh.lastMessageTime || Date.now();
          return rpc(slug, 'putEnc', { db: 'chatbot-ui-v1', store: 'characters', valueEnc: fresh }).then(function () { written++; });
        }
      });
    });

    chain.then(function () {
      _toast(written + ' character' + (written === 1 ? '' : 's') + ' imported.');
      if (onDone) onDone();
    }).catch(function (err) {
      _toast('Import failed: ' + err.message);
    });
  }

  function showShareUrls(slug, characters) {
    var urls = characters.map(function (c) {
      return window.weldAICC.buildShareHashUrl(slug, window.weldAICC.stripCharacterForShare(c));
    });
    var content = _el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
    content.appendChild(_el('div', { class: 'wc-section-note', text: 'An AICC tab is open, so direct write is blocked. Open each link in your AICC to import the character via its own import flow.' }));
    urls.forEach(function (url, i) {
      var name = characters[i].name || 'Character ' + (i + 1);
      var row = _el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } });
      var inp = _el('input', { class: 'wc-field', style: { flex: '1', fontSize: '11px' } });
      inp.value = url;
      inp.readOnly = true;
      var copyBtn = _el('button', { class: 'wc-btn wc-mini', text: 'Copy' });
      copyBtn.addEventListener('click', function () {
        try { navigator.clipboard.writeText(url).then(function () { copyBtn.textContent = '\u2713'; setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1500); }); } catch (e) {}
      });
      var openBtn = _el('button', { class: 'wc-btn wc-mini', text: 'Open' });
      openBtn.addEventListener('click', function () { window.open(url, '_blank'); });
      row.appendChild(_el('span', { style: { fontWeight: 600, minWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: name }));
      row.appendChild(inp);
      row.appendChild(copyBtn);
      row.appendChild(openBtn);
      content.appendChild(row);
    });
    var overlay = _el('div', { class: 'wdm-modal', id: 'weld-tools-modal', style: { zIndex: '9999999' } }, [
      _el('div', { class: 'wdm-card', style: { maxWidth: '620px', width: '100%' } }, [
        _el('h3', { text: 'Share links for import' }),
        content,
        _el('div', { class: 'wc-foot' }, [
          _el('button', { class: 'wc-btn wc-btn-accent', text: 'Done', onclick: function () { var m = document.getElementById('weld-tools-modal'); if (m) m.remove(); } })
        ])
      ])
    ]);
    document.body.appendChild(overlay);
  }

  // ---- EXPORT ------------------------------------------------------------------
  function exportAllCharacters(slug, statusEl) {
    statusEl.textContent = 'Loading characters\u2026';
    loadAllCharacters(slug).then(function (chars) {
      if (!chars.length) { statusEl.textContent = 'No characters found in this generator.'; return; }
      var bundle = {
        format: 'aicc-characters',
        formatVersion: 1,
        slug: slug,
        exportedAt: new Date().toISOString(),
        count: chars.length,
        characters: chars.map(function (c) {
          return window.weldAICC.stripCharacterForShare(c) || c;
        })
      };
      var fname = slug + '.characters.' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json';
      download(fname, JSON.stringify(bundle, null, 2));
      statusEl.textContent = '\u2713 Exported ' + chars.length + ' character' + (chars.length === 1 ? '' : 's') + ' to ' + fname;
    }).catch(function (err) {
      statusEl.textContent = 'Export failed: ' + err.message;
    });
  }

  // ---- CARD RENDERER -----------------------------------------------------------
  function renderCharacterFilesCard(body) {
    if (!window.weldAICCPack || !window.weldAICC) {
      body.appendChild(_el('div', { class: 'wc-section-note', text: 'AICC pack not loaded.' }));
      return;
    }

    var slug = currentSlug();
    var statusLine = _el('div', { class: 'wc-section-note', style: { marginTop: '8px' }, text: slug ? ('Current generator: ' + slug) : 'No generator detected \u2014 open a Perchance generator first.' });

    // -- IMPORT section --
    var importLabel = _el('div', { class: 'wc-label', text: 'Import characters' });
    var importNote = _el('div', { class: 'wc-section-note', text: 'Load a .json file saved by this manager, an AICC share-link envelope, or a multi-character export. AICC open \u2192 share URL shown; AICC closed \u2192 written directly.' });

    var fileInput = _el('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
    var importedData = null;
    var previewEl = _el('div', { class: 'wc-section-note', style: { marginTop: '6px' } });
    var importBtn = _el('button', { class: 'wc-btn wc-btn-accent', text: 'Add to AICC' });
    importBtn.disabled = true;
    importBtn.style.opacity = '0.4';

    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var parsed = parseFile(String(reader.result));
        if (!parsed.ok) {
          previewEl.textContent = '\u26A0 ' + parsed.reason;
          importedData = null;
          importBtn.disabled = true; importBtn.style.opacity = '0.4';
          return;
        }
        importedData = parsed.results;
        var good = parsed.results.filter(function (r) { return r.ok; });
        var bad = parsed.results.filter(function (r) { return !r.ok; });
        var summary = '\u2713 ' + good.length + ' character' + (good.length === 1 ? '' : 's') + ' ready to import';
        if (bad.length) summary += ' (' + bad.length + ' unparseable, will be skipped)';
        previewEl.textContent = summary;
        importBtn.disabled = !good.length;
        importBtn.style.opacity = good.length ? '1' : '0.4';
      };
      reader.readAsText(file);
    });

    var chooseBtn = _el('button', { class: 'wc-btn', text: '\ud83d\udcc2 Choose file\u2026' });
    chooseBtn.addEventListener('click', function () { fileInput.click(); });

    importBtn.addEventListener('click', function () {
      if (!importedData || !slug) return;
      var good = importedData.filter(function (r) { return r.ok; });
      if (!good.length) return;
      importParsedCharacters(slug, good, function () {
        previewEl.textContent = '';
        importedData = null;
        importBtn.disabled = true; importBtn.style.opacity = '0.4';
        fileInput.value = '';
      });
    });

    var importRow = _el('div', { class: 'wc-row', style: { marginTop: '6px', gap: '8px' } }, [chooseBtn, importBtn, fileInput]);

    // -- EXPORT section --
    var exportLabel = _el('div', { class: 'wc-label', text: 'Export characters' });
    var exportNote = _el('div', { class: 'wc-section-note', text: 'Downloads all characters from the current generator as a single JSON file. Private \u2014 nothing is uploaded.' });
    var exportStatus = _el('div', { class: 'wc-section-note', style: { marginTop: '6px' } });
    var exportBtn = _el('button', { class: 'wc-btn', text: '\u2913 Export all characters' });
    exportBtn.disabled = !slug;
    exportBtn.style.opacity = slug ? '1' : '0.4';
    exportBtn.addEventListener('click', function () {
      if (!slug) { exportStatus.textContent = 'Open a generator first.'; return; }
      exportBtn.disabled = true;
      exportAllCharacters(slug, exportStatus);
      setTimeout(function () { exportBtn.disabled = false; }, 4000);
    });

    // -- GitHub Pull section --
    var ghLabel = _el('div', { class: 'wc-label', text: 'Pull character from GitHub' });
    var ghNote = _el('div', { class: 'wc-section-note', text: 'Fetch a character .json from a raw GitHub URL and import it. Uses the same flow as file import.' });
    var ghInput = _el('input', { class: 'wc-field', type: 'url', placeholder: 'https://raw.githubusercontent.com/\u2026/character.json' });
    var ghStatus = _el('div', { class: 'wc-section-note', style: { marginTop: '4px' } });
    var ghBtn = _el('button', { class: 'wc-btn', text: '\u2193 Fetch & import' });
    ghBtn.addEventListener('click', function () {
      var url = ghInput.value.trim();
      if (!url || !/^https?:\/\//i.test(url)) { ghStatus.textContent = 'Enter a full https:// URL.'; return; }
      if (!slug) { ghStatus.textContent = 'Open a generator first.'; return; }
      ghStatus.textContent = 'Fetching\u2026';
      // Use GM_xmlhttpRequest so CSP doesn't block a cross-origin fetch.
      GM_xmlhttpRequest({
        method: 'GET', url: url,
        onload: function (res) {
          if (res.status !== 200) { ghStatus.textContent = 'Fetch failed: HTTP ' + res.status; return; }
          var parsed = parseFile(res.responseText);
          if (!parsed.ok) { ghStatus.textContent = '\u26A0 ' + parsed.reason; return; }
          var good = parsed.results.filter(function (r) { return r.ok; });
          if (!good.length) { ghStatus.textContent = 'No importable characters in that file.'; return; }
          ghStatus.textContent = '\u2713 ' + good.length + ' character' + (good.length === 1 ? '' : 's') + ' ready.';
          importParsedCharacters(slug, good, function () { ghStatus.textContent = '\u2713 Imported.'; ghInput.value = ''; });
        },
        onerror: function (err) { ghStatus.textContent = 'Fetch error \u2014 check the URL and your network.'; }
      });
    });

    var ghRow = _el('div', { class: 'wc-row', style: { marginTop: '6px', gap: '8px' } }, [ghInput, ghBtn]);

    // Assemble card
    body.appendChild(statusLine);
    body.appendChild(importLabel);
    body.appendChild(importNote);
    body.appendChild(importRow);
    body.appendChild(previewEl);
    body.appendChild(exportLabel);
    body.appendChild(exportNote);
    body.appendChild(_el('div', { style: { marginTop: '6px' } }, [exportBtn]));
    body.appendChild(exportStatus);
    body.appendChild(ghLabel);
    body.appendChild(ghNote);
    body.appendChild(ghRow);
    body.appendChild(ghStatus);
  }

  window.weldAICCTools = { renderCharacterFilesCard: renderCharacterFilesCard };
})();

/* ----- [7] STORY EXPORT CORE ----- */
/* Weld Story Export — turn an AICC chat thread into a readable document.
 *
 * The core is PURE: buildTranscript() and the three renderers take decoded
 * rows and return strings, no DOM, no IDB — so the whole pipeline is unit-
 * tested in Node. The Library tab provides the UI around it.
 *
 * Message semantics (from AICC source):
 *   - display order: `order` property when present, else primary-key id
 *   - hiddenFrom: ['user'] means the user never saw it → excluded by default
 *     (['ai'] is visible to the user → included)
 *   - current text lives in `content` (defensively: content ?? message ?? '')
 *   - characterId: -1 = user, -2 = system, >=0 = the AI character
 *   - <!--hidden-from-ai-start/end--> markers are visible to the user; the
 *     markers themselves are stripped, the text between them kept
 *
 * HTML export escapes ALL message content and renders only a small, safe
 * markdown subset (**bold**, *italic*, `code`, line breaks). Raw generator
 * HTML is never re-emitted into the exported file.
 */
(function (globalRoot, moduleRef) {
  'use strict';

  function createStoryExport() {

    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function cleanContent(raw) {
      var s = String(raw == null ? '' : raw);
      // strip the hidden-from-ai markers but keep the text between them
      s = s.replace(/<!--hidden-from-ai-(start|end)-->/g, '');
      return s.trim();
    }

    function authorLabel(m, ctx) {
      if (m.name) return String(m.name);
      if (m.author === 'ai' || (m.characterId != null && m.characterId >= 0)) return ctx.characterName || 'AI';
      if (m.author === 'user' || m.characterId === -1) return ctx.userName || 'You';
      return 'System';
    }

    // tables = { thread, character, messages } (decoded rows)
    // opts = { includeSystem: false, includeHiddenFromUser: false }
    function buildTranscript(tables, opts) {
      opts = opts || {};
      var thread = tables.thread || {};
      var character = tables.character || {};
      var ctx = {
        characterName: character.name || 'AI',
        userName: (character.userCharacter && character.userCharacter.name) || 'You'
      };
      var msgs = (tables.messages || []).slice();
      // keep only this thread's messages if a mixed array was passed
      if (thread.id != null) msgs = msgs.filter(function (m) { return m && m.threadId === thread.id; });
      msgs.sort(function (a, b) {
        var ao = (a.order != null ? a.order : a.id) || 0;
        var bo = (b.order != null ? b.order : b.id) || 0;
        return ao - bo || (a.id || 0) - (b.id || 0);
      });

      var items = [];
      msgs.forEach(function (m) {
        if (!m || typeof m !== 'object') return;
        var hidden = Array.isArray(m.hiddenFrom) ? m.hiddenFrom : [];
        if (hidden.indexOf('user') !== -1 && !opts.includeHiddenFromUser) return;
        var isSystem = m.author === 'system' || m.characterId === -2;
        if (isSystem && !opts.includeSystem) return;
        var content = cleanContent(m.content != null ? m.content : m.message);
        if (!content) return;
        items.push({
          author: m.author || (m.characterId === -1 ? 'user' : (m.characterId === -2 ? 'system' : 'ai')),
          name: authorLabel(m, ctx),
          content: content,
          time: m.creationTime || null,
          avatarUrl: (m.avatar && m.avatar.url) || null
        });
      });

      return {
        title: thread.name || ('Chat with ' + ctx.characterName),
        characterName: ctx.characterName,
        userName: ctx.userName,
        characterAvatarUrl: (character.avatar && character.avatar.url) || null,
        threadId: thread.id != null ? thread.id : null,
        messageCount: items.length,
        items: items
      };
    }

    // Escape first, then render a tiny safe markdown subset on the ESCAPED text.
    function miniMarkdownToHtml(escaped) {
      return escaped
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
    }

    function fmtTime(t) {
      if (!t) return '';
      try { return new Date(t).toLocaleString(); } catch (e) { return ''; }
    }

    function renderHTML(tr) {
      var rows = tr.items.map(function (m) {
        var side = m.author === 'user' ? 'right' : 'left';
        var av = m.avatarUrl || (m.author !== 'user' ? tr.characterAvatarUrl : null);
        return '<div class="msg ' + side + '">'
          + (av ? '<img class="av" src="' + esc(av) + '" alt="">' : '<span class="av ph"></span>')
          + '<div class="bubble"><div class="meta"><span class="name">' + esc(m.name) + '</span>'
          + (m.time ? '<span class="time">' + esc(fmtTime(m.time)) + '</span>' : '') + '</div>'
          + '<div class="body">' + miniMarkdownToHtml(esc(m.content)) + '</div></div></div>';
      }).join('\n');
      return '<!doctype html>\n<html><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<title>' + esc(tr.title) + '</title>\n<style>'
        + ':root{color-scheme:light dark;}'
        + 'body{margin:0;padding:28px 14px;font:15px/1.55 system-ui,sans-serif;background:#f4f1ea;color:#211d17;}'
        + '@media(prefers-color-scheme:dark){body{background:#15181d;color:#e8e4dc;}}'
        + '.wrap{max-width:760px;margin:0 auto;}'
        + 'h1{font-size:21px;margin:0 0 4px;}'
        + '.sub{opacity:.6;font-size:12px;margin-bottom:26px;}'
        + '.msg{display:flex;gap:10px;margin:14px 0;align-items:flex-start;}'
        + '.msg.right{flex-direction:row-reverse;}'
        + '.av{width:38px;height:38px;border-radius:10px;object-fit:cover;flex:none;}'
        + '.av.ph{background:rgba(127,127,127,.18);display:inline-block;}'
        + '.bubble{max-width:78%;background:rgba(127,127,127,.10);border:1px solid rgba(127,127,127,.18);border-radius:12px;padding:9px 12px;}'
        + '.msg.right .bubble{background:rgba(90,140,255,.12);}'
        + '.meta{display:flex;gap:10px;align-items:baseline;margin-bottom:3px;}'
        + '.name{font-weight:700;font-size:12.5px;}'
        + '.time{opacity:.45;font-size:10.5px;}'
        + '.body{white-space:normal;word-wrap:break-word;}'
        + 'code{background:rgba(127,127,127,.16);padding:1px 5px;border-radius:4px;font-size:.92em;}'
        + '.foot{margin-top:34px;opacity:.45;font-size:11px;text-align:center;}'
        + '</style></head><body><div class="wrap">'
        + '<h1>' + esc(tr.title) + '</h1>'
        + '<div class="sub">' + esc(tr.characterName) + ' &amp; ' + esc(tr.userName) + ' \u00b7 ' + tr.messageCount + ' messages</div>\n'
        + rows
        + '\n<div class="foot">Exported with Weld Companion</div>'
        + '</div></body></html>';
    }

    function renderMarkdown(tr) {
      var out = ['# ' + tr.title, '', '_' + tr.characterName + ' & ' + tr.userName + ' \u00b7 ' + tr.messageCount + ' messages_', ''];
      tr.items.forEach(function (m) {
        out.push('**' + m.name + '**' + (m.time ? '  \u2014 ' + fmtTime(m.time) : ''));
        out.push('');
        out.push(m.content);
        out.push('');
      });
      return out.join('\n');
    }

    function renderTxt(tr) {
      var out = [tr.title, '='.repeat(Math.min(60, tr.title.length)), ''];
      tr.items.forEach(function (m) {
        out.push('[' + m.name + ']' + (m.time ? ' (' + fmtTime(m.time) + ')' : ''));
        out.push(m.content.replace(/<[^>]+>/g, ''));
        out.push('');
      });
      return out.join('\n');
    }

    return {
      buildTranscript: buildTranscript,
      renderHTML: renderHTML,
      renderMarkdown: renderMarkdown,
      renderTxt: renderTxt,
      _esc: esc,
      _cleanContent: cleanContent
    };
  }

  if (moduleRef && moduleRef.exports) moduleRef.exports = createStoryExport;
  else globalRoot.WeldStoryExport = createStoryExport;
})(typeof window !== 'undefined' ? window : globalThis, typeof module !== 'undefined' ? module : null);

/* ----- [8] LIBRARY ----- */
/* Weld Library — the reader's home tab. Everything here is for people who USE
 * generators rather than write them.
 *
 *   📌 Scrapbook    — a permanent, cross-generator collection of saved results
 *                     (the existing Save downloads a one-shot file and Pins are
 *                     per-generator + capped at 12; this is the persistent,
 *                     searchable, taggable home they lacked). Save the current
 *                     output in one click; add notes; export/import the whole
 *                     collection as JSON; read any entry aloud.
 *   📖 Chat stories — pick a visited AICC-compatible generator, list its chat
 *                     threads, and export any thread as styled HTML, Markdown,
 *                     or plain text — or read it in a clean transcript modal
 *                     without opening AICC. Read-only: never writes to the DB.
 *   🛡 Backups      — days-since-last-sweep meter, origin storage usage and
 *                     persistence status, one-click sweep. A gentle once-a-day
 *                     toast appears when backups are overdue (default 14 days).
 *   🌙 Night light  — auto-apply a comfort theme on a schedule (e.g. Warm from
 *                     20:00 to 07:00). Uses the host's own applyComfort via the
 *                     weldHooks bridge; fails soft if the hook is absent.
 *   🗒 Notes        — a free-text note per generator, searchable from the
 *                     Scrapbook search box.
 *   🎲 Random favorite — jump to a random starred generator.
 *
 * Storage (all GM, all local): 'scrapbook' entries, 'genNotes' map,
 * 'libCfg' { nightlight }, 'guardLastSweep' timestamp, 'guardLastNag' day-stamp.
 * Exposes window.weldLibrary = { renderTab, saveCurrentOutput, speak, stopSpeak }.
 */
(function () {
  'use strict';
  if (window.top !== window) return;

  var NS = 'weldCompanion';
  function gget(k, d) { try { var v = GM_getValue(NS + ':' + k, undefined); return v === undefined ? d : JSON.parse(v); } catch (e) { return d; } }
  function gset(k, v) { try { GM_setValue(NS + ':' + k, JSON.stringify(v)); } catch (e) {} }

  function el(tag, attrs, kids) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    for (var k in attrs) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k === 'class') node.className = attrs[k];
      else if (k === 'style' && typeof attrs[k] === 'object') Object.assign(node.style, attrs[k]);
      else if (/^on/.test(k)) node.addEventListener(k.slice(2), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  }
  function toast(msg, ms) {
    var t = document.querySelector('.weld-lib-toast'); if (t) t.remove();
    t = el('div', { class: 'weld-lib-toast', text: msg });
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || 2600);
  }
  function download(name, text, mime) {
    var a = el('a', { href: URL.createObjectURL(new Blob([text], { type: mime || 'text/plain' })), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(a.href); }, 1500);
  }
  function hooks() { return window.weldHooks || {}; }
  function currentSlug() {
    var m = location.hostname === 'perchance.org' ? location.pathname.match(/^\/([^/#?]+)/) : null;
    return m ? m[1] : null;
  }

  function styleOnce() {
    if (document.getElementById('weld-lib-style')) return;
    var css = [
      '.weld-lib-toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:99999999;background:var(--wc-surface-2,#1a1f28);color:var(--wc-ink,#e8e4dc);border:1px solid var(--wc-line,rgba(255,255,255,.12));border-radius:9px;padding:8px 14px;font:12.5px system-ui;box-shadow:0 10px 30px -10px rgba(0,0,0,.6);}',
      '.wlib-sec{border:1px solid var(--wc-line-2,rgba(255,255,255,.06));border-radius:11px;background:var(--wc-surface-2,#1a1f28);margin-bottom:14px;overflow:hidden;}',
      '.wlib-hd{display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;user-select:none;border-bottom:1px solid var(--wc-line-2,rgba(255,255,255,.05));}',
      '.wlib-hd .t{font:700 12px ui-monospace,monospace;letter-spacing:.04em;text-transform:uppercase;color:var(--wc-arc,#ff8a3d);flex:1;}',
      '.wlib-hd .c{font:11px ui-monospace,monospace;color:var(--wc-faint,#5d6b7b);}',
      '.wlib-hd .ch{color:var(--wc-faint,#5d6b7b);font-size:11px;transition:transform .15s;}',
      '.wlib-sec.closed .ch{transform:rotate(-90deg);} .wlib-sec.closed .wlib-bd{display:none;}',
      '.wlib-bd{padding:10px 12px;}',
      '.wlib-row{display:flex;align-items:flex-start;gap:10px;padding:8px;border-radius:8px;}',
      '.wlib-row:hover{background:var(--wc-surface,#13171e);}',
      '.wlib-row .main{flex:1;min-width:0;}',
      '.wlib-row .title{font-weight:600;font-size:13px;}',
      '.wlib-row .meta{font:11px ui-monospace,monospace;color:var(--wc-faint,#5d6b7b);margin-top:1px;}',
      '.wlib-row .body{font-size:12.5px;opacity:.85;margin-top:4px;max-height:72px;overflow:hidden;white-space:pre-wrap;word-break:break-word;}',
      '.wlib-row.open .body{max-height:none;}',
      '.wlib-acts{display:flex;gap:5px;flex:none;flex-wrap:wrap;justify-content:flex-end;max-width:40%;}',
      '.wlib-mini{appearance:none;background:transparent;border:1px solid var(--wc-line,rgba(255,255,255,.12));color:var(--wc-dim,#9aa7b6);border-radius:7px;padding:3px 8px;font:11px system-ui;cursor:pointer;}',
      '.wlib-mini:hover{border-color:var(--wc-arc,#ff8a3d);color:var(--wc-ink,#e8e4dc);}',
      '.wlib-field{flex:1;min-width:0;background:var(--wc-surface,#13171e);border:1px solid var(--wc-line,rgba(255,255,255,.12));color:inherit;border-radius:8px;padding:6px 9px;font:12.5px system-ui;}',
      '.wlib-bar{display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;}',
      '.wlib-note{font:11.5px system-ui;color:var(--wc-faint,#5d6b7b);}',
      '.wlib-gauge{height:7px;border-radius:99px;background:var(--wc-surface,#13171e);border:1px solid var(--wc-line-2,rgba(255,255,255,.06));overflow:hidden;flex:1;}',
      '.wlib-gauge>div{height:100%;background:linear-gradient(90deg,#4ee0c8,#ff8a3d);}',
      '.wlib-reader{position:fixed;inset:0;z-index:9999999;background:rgba(0,0,0,.55);display:grid;place-items:center;padding:18px;}',
      '.wlib-reader .pane{background:var(--wc-surface-2,#1a1f28);color:var(--wc-ink,#e8e4dc);border:1px solid var(--wc-line,rgba(255,255,255,.12));border-radius:13px;max-width:740px;width:100%;max-height:88vh;display:flex;flex-direction:column;}',
      '.wlib-reader .ph{display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid var(--wc-line-2,rgba(255,255,255,.06));}',
      '.wlib-reader .ph .t{font-weight:700;flex:1;}',
      '.wlib-reader .pb{overflow:auto;padding:14px;}',
      '.wlib-msg{margin:10px 0;}',
      '.wlib-msg .nm{font-weight:700;font-size:12px;color:var(--wc-arc,#ff8a3d);}',
      '.wlib-msg.user .nm{color:#7fb2ff;}',
      '.wlib-msg .tx{font-size:13.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word;margin-top:2px;}'
    ].join('\n');
    document.head.appendChild(Object.assign(document.createElement('style'), { id: 'weld-lib-style', innerHTML: css }));
  }

  function section(title, count, open, build) {
    var bd = el('div', { class: 'wlib-bd' });
    var cEl = el('span', { class: 'c', text: count || '' });
    var hd = el('div', { class: 'wlib-hd' }, [el('span', { class: 't', text: title }), cEl, el('span', { class: 'ch', text: '\u25BC' })]);
    var sec = el('div', { class: 'wlib-sec' + (open ? '' : ' closed') }, [hd, bd]);
    hd.addEventListener('click', function () { sec.classList.toggle('closed'); });
    build(bd, function (txt) { cEl.textContent = txt; });
    return sec;
  }

  /* ====================== text-to-speech (local, no network) =============== */
  var speaking = null;
  function speak(text) {
    stopSpeak();
    if (!('speechSynthesis' in window)) { toast('Speech is not supported in this browser'); return; }
    var u = new SpeechSynthesisUtterance(String(text).slice(0, 30000));
    u.onend = function () { speaking = null; };
    speaking = u;
    window.speechSynthesis.speak(u);
  }
  function stopSpeak() {
    try { window.speechSynthesis.cancel(); } catch (e) {}
    speaking = null;
  }

  /* ====================== scrapbook store ================================== */
  var SCRAP_CAP = 500;
  function scrapAll() { return gget('scrapbook', []) || []; }
  function scrapSave(list) { gset('scrapbook', list); }
  function scrapAdd(entry) {
    var list = scrapAll();
    entry.id = 'sb-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    entry.t = Date.now();
    list.unshift(entry);
    var overflow = list.length > SCRAP_CAP;
    if (overflow) list = list.slice(0, SCRAP_CAP);
    scrapSave(list);
    return { entry: entry, overflow: overflow };
  }
  function scrapRemove(id) { scrapSave(scrapAll().filter(function (e) { return e.id !== id; })); }
  function scrapUpdate(id, patch) {
    var list = scrapAll();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) { Object.assign(list[i], patch); break; }
    scrapSave(list);
  }
  function notesAll() { return gget('genNotes', {}) || {}; }
  function noteSet(slug, text) { var n = notesAll(); if (text) n[slug] = text; else delete n[slug]; gset('genNotes', n); }

  function saveCurrentOutput() {
    var h = hooks();
    var text = (typeof h.outputText === 'function') ? h.outputText() : '';
    if (!text) { toast('No generator output found on this page'); return; }
    var slug = currentSlug() || 'unknown';
    var r = scrapAdd({ gen: slug, title: text.slice(0, 64).replace(/\s+/g, ' '), text: text, tags: [], note: '' });
    toast('\u2713 Saved to Scrapbook' + (r.overflow ? ' (oldest entry rotated out \u2014 cap is ' + SCRAP_CAP + ')' : ''));
  }

  function renderScrapbook(bd, setCount) {
    var query = '';
    var listWrap = el('div');
    var search = el('input', { class: 'wlib-field', placeholder: 'Search results, generators, tags, notes\u2026' });
    search.addEventListener('input', function () { query = search.value.toLowerCase(); paint(); });
    bd.appendChild(el('div', { class: 'wlib-bar' }, [
      search,
      el('button', { class: 'wlib-mini', text: '\u2913 Save current output', title: 'Save the open generator\u2019s current result to the Scrapbook', onclick: function () { saveCurrentOutput(); paint(); } }),
      el('button', { class: 'wlib-mini', text: 'Export', title: 'Download the whole Scrapbook (incl. generator notes) as JSON', onclick: function () {
        download('weld-scrapbook.' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify({ format: 'weld-scrapbook', formatVersion: 1, entries: scrapAll(), notes: notesAll() }, null, 2), 'application/json');
      } }),
      el('button', { class: 'wlib-mini', text: 'Import\u2026', onclick: function () { importScrapbook(paint); } })
    ]));
    bd.appendChild(listWrap);
    paint();

    function paint() {
      var entries = scrapAll();
      var notes = notesAll();
      setCount(entries.length + ' saved');
      listWrap.innerHTML = '';
      var shown = entries.filter(function (e) {
        if (!query) return true;
        var hay = (e.title + ' ' + e.text + ' ' + e.gen + ' ' + (e.tags || []).join(' ') + ' ' + (e.note || '') + ' ' + (notes[e.gen] || '')).toLowerCase();
        return hay.indexOf(query) !== -1;
      });
      if (!shown.length) {
        listWrap.appendChild(el('div', { class: 'wlib-note', text: entries.length ? 'No matches.' : 'Nothing saved yet. Open any generator and hit \u201cSave current output\u201d \u2014 entries are permanent, searchable, and stay across every generator.' }));
        return;
      }
      shown.slice(0, 60).forEach(function (e) {
        var row = el('div', { class: 'wlib-row' });
        var main = el('div', { class: 'main' }, [
          el('div', { class: 'title', text: e.title || '(untitled)' }),
          el('div', { class: 'meta', text: e.gen + ' \u00b7 ' + new Date(e.t).toLocaleString() + ((e.tags || []).length ? ' \u00b7 #' + e.tags.join(' #') : '') + (e.note ? ' \u00b7 \ud83d\udcdd' : '') }),
          el('div', { class: 'body', text: e.text })
        ]);
        main.addEventListener('click', function () { row.classList.toggle('open'); });
        row.appendChild(main);
        row.appendChild(el('div', { class: 'wlib-acts' }, [
          el('button', { class: 'wlib-mini', text: '\ud83d\udd0a', title: 'Read aloud', onclick: function () { speak(e.text); } }),
          el('button', { class: 'wlib-mini', text: 'Copy', onclick: function () { try { navigator.clipboard.writeText(e.text).then(function () { toast('Copied'); }); } catch (er) {} } }),
          el('button', { class: 'wlib-mini', text: 'Tags', onclick: function () {
            var t = window.prompt('Tags (space-separated):', (e.tags || []).join(' '));
            if (t == null) return;
            scrapUpdate(e.id, { tags: t.split(/\s+/).filter(Boolean).map(function (s) { return s.replace(/^#/, ''); }) }); paint();
          } }),
          el('button', { class: 'wlib-mini', text: 'Note', onclick: function () {
            var n = window.prompt('Note for this entry:', e.note || '');
            if (n == null) return;
            scrapUpdate(e.id, { note: n }); paint();
          } }),
          el('button', { class: 'wlib-mini', text: 'Open', title: 'Open the generator this came from', onclick: function () { window.open('https://perchance.org/' + e.gen, '_blank'); } }),
          el('button', { class: 'wlib-mini', text: '\u00d7', title: 'Delete', onclick: function () { if (window.confirm('Delete this Scrapbook entry?')) { scrapRemove(e.id); paint(); } } })
        ]));
        listWrap.appendChild(row);
      });
      if (shown.length > 60) listWrap.appendChild(el('div', { class: 'wlib-note', text: '\u2026 ' + (shown.length - 60) + ' more \u2014 narrow the search to see them.' }));

      // per-generator note for the page you're on
      var slug = currentSlug();
      if (slug) {
        var noteRow = el('div', { class: 'wlib-bar', style: { marginTop: '10px' } }, [
          el('span', { class: 'wlib-note', text: '\ud83d\uddd2 Note on \u201c' + slug + '\u201d:' }),
          el('span', { class: 'wlib-note', style: { flex: '1', fontStyle: notes[slug] ? 'normal' : 'italic' }, text: notes[slug] || 'none' }),
          el('button', { class: 'wlib-mini', text: 'Edit', onclick: function () {
            var n = window.prompt('Your note for ' + slug + ' (searchable from the box above):', notes[slug] || '');
            if (n == null) return;
            noteSet(slug, n); paint();
          } })
        ]);
        listWrap.appendChild(noteRow);
      }
    }
  }

  function importScrapbook(done) {
    var inp = el('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
    inp.addEventListener('change', function () {
      var file = inp.files && inp.files[0]; if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var json; try { json = JSON.parse(String(reader.result)); } catch (e) { toast('Not valid JSON'); return; }
        var incoming = Array.isArray(json) ? json : (json.entries || []);
        if (!Array.isArray(incoming) || !incoming.length) { toast('No entries found in that file'); return; }
        var list = scrapAll();
        var have = {}; list.forEach(function (e) { have[e.id] = true; });
        var added = 0;
        incoming.forEach(function (e) {
          if (!e || !e.text) return;
          if (e.id && have[e.id]) return;        // merge: skip duplicates by id
          list.push({ id: e.id || ('sb-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)), gen: e.gen || 'unknown', title: e.title || String(e.text).slice(0, 64), text: e.text, tags: e.tags || [], note: e.note || '', t: e.t || Date.now() });
          added++;
        });
        list.sort(function (a, b) { return b.t - a.t; });
        if (list.length > SCRAP_CAP) list = list.slice(0, SCRAP_CAP);
        scrapSave(list);
        if (json.notes && typeof json.notes === 'object') {
          var n = notesAll();
          for (var k in json.notes) if (!n[k]) n[k] = json.notes[k];
          gset('genNotes', n);
        }
        toast('\u2713 Imported ' + added + ' entr' + (added === 1 ? 'y' : 'ies'));
        done && done();
      };
      reader.readAsText(file);
    });
    document.body.appendChild(inp); inp.click(); setTimeout(function () { inp.remove(); }, 120000);
  }

  /* ====================== chat stories (AICC threads) ======================= */
  function rpc(slug, op, args, timeout) {
    if (window.weldDataManager && typeof window.weldDataManager.rpc === 'function') return window.weldDataManager.rpc(slug, op, args, timeout || 45000);
    return Promise.reject(new Error('Data Manager not loaded'));
  }
  var _dec = null;
  function decodeRow(row) {
    try { if (!_dec) _dec = window.IDBManEngine ? window.IDBManEngine({}) : null; return _dec ? _dec.decodeValue(row.valueEnc) : row.valueEnc; } catch (e) { return row.valueEnc; }
  }
  function pageAll(slug, store) {
    var rows = []; var offset = 0;
    function next() {
      return rpc(slug, 'page', { db: 'chatbot-ui-v1', store: store, offset: offset, limit: 500 }).then(function (p) {
        rows = rows.concat((p.rows || []).map(decodeRow));
        offset += (p.rows || []).length;
        return p.done ? rows : next();
      });
    }
    return next();
  }

  function renderStories(bd, setCount) {
    var slugInput = el('input', { class: 'wlib-field', placeholder: 'generator slug (e.g. ai-character-chat)' });
    var cur = currentSlug();
    var recent = (gget('recent', []) || []).map(function (r) { return r.name; });
    slugInput.value = cur && recent.indexOf(cur) !== -1 ? cur : (cur || 'ai-character-chat');
    var listWrap = el('div');
    var loadBtn = el('button', { class: 'wlib-mini', text: 'Load threads', onclick: load });
    bd.appendChild(el('div', { class: 'wlib-bar' }, [slugInput, loadBtn]));
    bd.appendChild(el('div', { class: 'wlib-note', text: 'Read-only: threads are listed and exported without ever writing to the chat database. Loading briefly wakes the generator in a hidden frame.' }));
    bd.appendChild(listWrap);

    function load() {
      var slug = slugInput.value.trim();
      if (!slug) return;
      listWrap.innerHTML = '';
      listWrap.appendChild(el('div', { class: 'wlib-note', text: 'Loading threads\u2026' }));
      Promise.all([pageAll(slug, 'threads'), pageAll(slug, 'characters')]).then(function (res) {
        var threads = res[0], chars = res[1];
        var charById = {}; chars.forEach(function (c) { if (c && c.id != null) charById[c.id] = c; });
        threads.sort(function (a, b) { return (b.lastMessageTime || 0) - (a.lastMessageTime || 0); });
        setCount(threads.length + ' thread' + (threads.length === 1 ? '' : 's'));
        listWrap.innerHTML = '';
        if (!threads.length) { listWrap.appendChild(el('div', { class: 'wlib-note', text: 'No chat threads found in ' + slug + '.' })); return; }
        threads.slice(0, 80).forEach(function (t) {
          var ch = charById[t.characterId] || {};
          var row = el('div', { class: 'wlib-row' });
          row.appendChild(el('div', { class: 'main' }, [
            el('div', { class: 'title', text: (t.name || 'Untitled') + (ch.name ? ' \u00b7 ' + ch.name : '') }),
            el('div', { class: 'meta', text: (t.lastMessageTime ? 'last message ' + new Date(t.lastMessageTime).toLocaleString() : 'no messages yet') })
          ]));
          row.appendChild(el('div', { class: 'wlib-acts' }, [
            el('button', { class: 'wlib-mini', text: 'Read', onclick: function () { withTranscript(slug, t, ch, function (tr) { openReader(tr); }); } }),
            el('button', { class: 'wlib-mini', text: 'HTML', title: 'Styled, readable web page', onclick: function () { withTranscript(slug, t, ch, function (tr, SE) { download(fname(tr, 'html'), SE.renderHTML(tr), 'text/html'); }); } }),
            el('button', { class: 'wlib-mini', text: 'MD', onclick: function () { withTranscript(slug, t, ch, function (tr, SE) { download(fname(tr, 'md'), SE.renderMarkdown(tr), 'text/markdown'); }); } }),
            el('button', { class: 'wlib-mini', text: 'TXT', onclick: function () { withTranscript(slug, t, ch, function (tr, SE) { download(fname(tr, 'txt'), SE.renderTxt(tr)); }); } })
          ]));
          listWrap.appendChild(row);
        });
        if (threads.length > 80) listWrap.appendChild(el('div', { class: 'wlib-note', text: '\u2026 ' + (threads.length - 80) + ' older threads not shown.' }));
      }).catch(function (err) {
        listWrap.innerHTML = '';
        listWrap.appendChild(el('div', { class: 'wlib-note', text: 'Could not load: ' + err.message + ' (is this generator AICC-compatible?)' }));
      });
    }

    function fname(tr, ext) {
      return (tr.title || 'chat').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) + '.' + ext;
    }
    function withTranscript(slug, thread, character, fn) {
      if (!window.WeldStoryExport) { toast('Story export module not loaded'); return; }
      var SE = window.WeldStoryExport();
      toast('Building transcript\u2026');
      pageAll(slug, 'messages').then(function (messages) {
        var tr = SE.buildTranscript({ thread: thread, character: character, messages: messages });
        if (!tr.items.length) { toast('That thread has no visible messages.'); return; }
        fn(tr, SE);
      }).catch(function (err) { toast('Failed: ' + err.message); });
    }
  }

  function openReader(tr) {
    var pb = el('div', { class: 'pb' });
    tr.items.forEach(function (m) {
      pb.appendChild(el('div', { class: 'wlib-msg' + (m.author === 'user' ? ' user' : '') }, [
        el('div', { class: 'nm', text: m.name }),
        el('div', { class: 'tx', text: m.content })
      ]));
    });
    var overlay = el('div', { class: 'wlib-reader' }, [
      el('div', { class: 'pane' }, [
        el('div', { class: 'ph' }, [
          el('span', { class: 't', text: tr.title }),
          el('button', { class: 'wlib-mini', text: '\ud83d\udd0a', title: 'Read aloud', onclick: function () { speak(tr.items.map(function (m) { return m.name + '. ' + m.content; }).join('\n')); } }),
          el('button', { class: 'wlib-mini', text: '\u25a0', title: 'Stop reading', onclick: stopSpeak }),
          el('button', { class: 'wlib-mini', text: '\u00d7', onclick: close })
        ]),
        pb
      ])
    ]);
    function close() { stopSpeak(); overlay.remove(); document.removeEventListener('keydown', esc); }
    function esc(e) { if (e.key === 'Escape') close(); }
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', esc);
    document.body.appendChild(overlay);
  }

  /* ====================== backup guardian =================================== */
  var NAG_DAYS = 14;
  function lastSweep() { return gget('guardLastSweep', 0) || 0; }
  function hookSweepTimestamp() {
    // record when a sweep runs, regardless of where it was started from
    var tries = 0;
    (function attach() {
      var dm = window.weldDataManager;
      if (dm && typeof dm.sweep === 'function' && !dm.__weldGuardWrapped) {
        var orig = dm.sweep;
        dm.sweep = function () { gset('guardLastSweep', Date.now()); return orig.apply(this, arguments); };
        dm.__weldGuardWrapped = true;
        return;
      }
      if (++tries < 40) setTimeout(attach, 500);
    })();
  }
  function maybeNag() {
    var visits = (gget('recent', []) || []).length;
    if (!visits) return;
    var last = lastSweep();
    var days = last ? Math.floor((Date.now() - last) / 86400000) : Infinity;
    if (days < NAG_DAYS) return;
    var today = new Date().toISOString().slice(0, 10);
    if (gget('guardLastNag', '') === today) return;
    gset('guardLastNag', today);
    toast(last ? ('\ud83d\udee1 It\u2019s been ' + days + ' days since your last backup \u2014 Library \u2192 Backups') : '\ud83d\udee1 You\u2019ve never backed up your generator data \u2014 Library \u2192 Backups', 5200);
  }

  function renderGuardian(bd, setCount) {
    var last = lastSweep();
    var days = last ? Math.floor((Date.now() - last) / 86400000) : null;
    setCount(last ? (days + 'd ago') : 'never');
    bd.appendChild(el('div', { class: 'wlib-note', style: { marginBottom: '8px' }, text: last
      ? ('Last full backup (sweep): ' + new Date(last).toLocaleString() + ' \u2014 ' + days + ' day' + (days === 1 ? '' : 's') + ' ago.')
      : 'No sweep backup recorded yet. A sweep saves every visited generator\u2019s data into one file.' }));
    var gauge = el('div', { class: 'wlib-gauge' }, [el('div', { style: { width: '0%' } })]);
    var gaugeNote = el('span', { class: 'wlib-note', text: 'measuring storage\u2026' });
    bd.appendChild(el('div', { class: 'wlib-bar' }, [gauge, gaugeNote]));
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(function (e) {
        var pct = e.quota ? Math.min(100, Math.round((e.usage / e.quota) * 100)) : 0;
        gauge.firstChild.style.width = Math.max(2, pct) + '%';
        gaugeNote.textContent = (e.usage / 1048576).toFixed(1) + ' MB of ' + (e.quota / 1073741824).toFixed(1) + ' GB used on this origin';
      }).catch(function () { gaugeNote.textContent = 'storage estimate unavailable'; });
    } else gaugeNote.textContent = 'storage estimate unavailable';
    if (navigator.storage && navigator.storage.persisted) {
      var persistNote = el('div', { class: 'wlib-note', text: '' });
      navigator.storage.persisted().then(function (yes) {
        persistNote.textContent = yes ? '\u2713 This origin\u2019s storage is marked persistent (the browser won\u2019t auto-evict it).' : '\u26a0 Storage is NOT marked persistent \u2014 the browser may evict it under disk pressure. Backups matter.';
      });
      bd.appendChild(persistNote);
    }
    bd.appendChild(el('div', { class: 'wlib-bar', style: { marginTop: '8px' } }, [
      el('button', { class: 'wlib-mini', text: '\u29c9 Run sweep backup now', onclick: function () {
        var dm = window.weldDataManager;
        if (dm && typeof dm.sweep === 'function') { gset('guardLastSweep', Date.now()); dm.open(); setTimeout(dm.sweep, 80); }
        else toast('Data Manager not loaded');
      } }),
      el('span', { class: 'wlib-note', text: 'Reminder appears after ' + NAG_DAYS + ' days, at most once a day.' })
    ]));
  }

  /* ====================== night light ======================================= */
  function libCfg() { return gget('libCfg', { nightlight: { on: false, theme: 'warm', from: 20, to: 7 } }) || {}; }
  function libCfgSave(c) { gset('libCfg', c); }
  function nightActive(nl, hour) {
    if (nl.from === nl.to) return false;
    return nl.from < nl.to ? (hour >= nl.from && hour < nl.to) : (hour >= nl.from || hour < nl.to);
  }
  var nlPrevTheme = null;
  function nightTick() {
    var cfg = libCfg(); var nl = cfg.nightlight || {};
    var h = hooks();
    if (!nl.on || typeof h.comfortGet !== 'function' || typeof h.comfortSet !== 'function' || typeof h.applyComfort !== 'function') return;
    var active = nightActive(nl, new Date().getHours());
    var cur = h.comfortGet();
    if (active && cur.theme !== nl.theme) {
      if (nlPrevTheme === null) nlPrevTheme = cur.theme || 'off';
      h.comfortSet(Object.assign({}, cur, { theme: nl.theme })); h.applyComfort();
    } else if (!active && nlPrevTheme !== null) {
      h.comfortSet(Object.assign({}, h.comfortGet(), { theme: nlPrevTheme })); h.applyComfort();
      nlPrevTheme = null;
    }
  }
  function renderNightlight(bd, setCount) {
    var cfg = libCfg(); var nl = cfg.nightlight || { on: false, theme: 'warm', from: 20, to: 7 };
    setCount(nl.on ? 'on' : 'off');
    var h = hooks();
    if (typeof h.applyComfort !== 'function') {
      bd.appendChild(el('div', { class: 'wlib-note', text: 'Comfort hooks not available in this build.' }));
      return;
    }
    function save() { cfg.nightlight = nl; libCfgSave(cfg); setCount(nl.on ? 'on' : 'off'); nightTick(); }
    var onToggle = el('input', { type: 'checkbox', onchange: function (e) { nl.on = e.target.checked; save(); } }); onToggle.checked = !!nl.on;
    var theme = el('select', { class: 'wlib-field', style: { flex: '0 0 110px' }, onchange: function (e) { nl.theme = e.target.value; save(); } });
    ['dim', 'warm', 'sepia', 'gray', 'dark'].forEach(function (t) { var o = el('option', { value: t, text: t }); if (t === nl.theme) o.selected = true; theme.appendChild(o); });
    function hourSel(val, onpick) {
      var s = el('select', { class: 'wlib-field', style: { flex: '0 0 84px' }, onchange: function (e) { onpick(parseInt(e.target.value, 10)); save(); } });
      for (var i = 0; i < 24; i++) { var o = el('option', { value: String(i), text: (i < 10 ? '0' : '') + i + ':00' }); if (i === val) o.selected = true; s.appendChild(o); }
      return s;
    }
    bd.appendChild(el('div', { class: 'wlib-bar' }, [
      el('label', { class: 'wlib-note', style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [onToggle, el('span', { text: 'Auto-apply' })]),
      theme,
      el('span', { class: 'wlib-note', text: 'from' }), hourSel(nl.from, function (v) { nl.from = v; }),
      el('span', { class: 'wlib-note', text: 'to' }), hourSel(nl.to, function (v) { nl.to = v; })
    ]));
    bd.appendChild(el('div', { class: 'wlib-note', text: 'Applies the comfort theme during these hours and restores your previous theme outside them. Your manual comfort settings always win when night light is off.' }));
  }

  /* ====================== random favorite =================================== */
  function randomFavorite() {
    var favs = gget('favorites', []) || [];
    if (!favs.length) { toast('No favorites yet \u2014 star some generators first (press f)'); return; }
    var pick = favs[Math.floor(Math.random() * favs.length)];
    location.href = 'https://perchance.org/' + pick;
  }

  /* ====================== tab renderer ====================================== */
  function renderTab(body) {
    styleOnce();
    body.appendChild(el('div', { class: 'wlib-bar', style: { marginBottom: '10px' } }, [
      el('button', { class: 'wlib-mini', text: '\ud83c\udfb2 Random favorite', onclick: randomFavorite }),
      el('button', { class: 'wlib-mini', text: '\ud83d\udd0a Read this page\u2019s output', onclick: function () {
        var h = hooks(); var t = (typeof h.outputText === 'function') ? h.outputText() : '';
        if (t) speak(t); else toast('No generator output found on this page');
      } }),
      el('button', { class: 'wlib-mini', text: '\u25a0 Stop reading', onclick: stopSpeak })
    ]));
    body.appendChild(section('\ud83d\udccc Scrapbook', '', true, renderScrapbook));
    body.appendChild(section('\ud83d\udcd6 Chat stories', '', true, renderStories));
    body.appendChild(section('\ud83d\udee1 Backups', '', false, renderGuardian));
    body.appendChild(section('\ud83c\udf19 Night light', '', false, renderNightlight));
  }

  /* ====================== boot =============================================== */
  hookSweepTimestamp();
  setTimeout(maybeNag, 4000);
  setInterval(nightTick, 60000);
  setTimeout(nightTick, 2500);

  window.weldLibrary = { renderTab: renderTab, saveCurrentOutput: saveCurrentOutput, speak: speak, stopSpeak: stopSpeak };
})();

