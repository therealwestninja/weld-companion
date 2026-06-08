// ==UserScript==
// @name         Weld Companion for Perchance
// @namespace    https://github.com/therealwestninja/weld
// @version      1.26.0
// @description  Quality-of-life upgrades for Perchance: favorites & recently-used, theme/reading comfort, save/copy/pin results, result history (undo-reroll), resizable inputs, generator folder management & CRUD, and an AI Helper you can edit or point at your own GPT (OpenAI / Anthropic / Google). All local, account-free. Companion to the Weld plugin suite.
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
// @noframes
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
      text: ['// The model emits images reliably only when told about the tag (see skill section 17).', 'const IMAGE_TAG_HINT =', '  "You can embed an AI-generated image using this exact syntax: " +', '  "<image>a detailed description of the scene</image> -- the text inside the tag is " +', '  "used to generate a real image. Use it when the user asks for one or it would help.";', '// Append IMAGE_TAG_HINT to your aiTextPlugin instruction when images should be available.', ''].join('\n') }
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
      { id: 'github', glyph: '\u21C5', label: 'GitHub' },
      { id: 'comfort', glyph: '\u{1F441}', label: 'Comfort' },
      { id: 'snippets', glyph: '\u2702', label: 'Snippets' },
      { id: 'ai', glyph: '\u{1F916}', label: 'AI Helper' }
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
    else if (WC_TAB === 'github') renderGitHub(body);
    else if (WC_TAB === 'comfort') renderComfort(body);
    else if (WC_TAB === 'snippets') renderSnippets(body);
    else if (WC_TAB === 'ai') renderAI(body);
  }

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
