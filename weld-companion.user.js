// ==UserScript==
// @name         Weld Companion for Perchance
// @namespace    https://github.com/therealwestninja/weld
// @version      1.0.0
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
// @connect      api.openai.com
// @connect      api.anthropic.com
// @connect      generativelanguage.googleapis.com
// @connect      perchance.org
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
  function isEditMode() { return /[?&]edit/.test(location.search) || !!window.modelTextEditor; }
  function toast(msg, ms) {
    var t = el('div', { class: 'wc-toast', text: msg });
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('wc-toast-in'); });
    setTimeout(function () { t.classList.remove('wc-toast-in'); setTimeout(function () { t.remove(); }, 300); }, ms || 2200);
  }

  // expose a tiny namespace for debugging / other scripts
  window.weldCompanion = { gget: gget, gset: gset, version: '1.0.0' };

  // ============================================================ styles
  GM_addStyle([
    ':root{--wc-accent:#4493f8;--wc-bg:#11151c;--wc-panel:#1a212b;--wc-border:#2a3340;--wc-ink:#e6edf3;--wc-muted:#8b98a8;}',
    '.wc-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(12px);z-index:2147483600;',
    '  background:var(--wc-panel);color:var(--wc-ink);border:1px solid var(--wc-border);border-radius:8px;',
    '  padding:10px 16px;font:500 13px system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.4);opacity:0;transition:opacity .25s,transform .25s;}',
    '.wc-toast-in{opacity:1;transform:translateX(-50%) translateY(0);}',
    '.wc-btn{background:var(--wc-panel);color:var(--wc-ink);border:1px solid var(--wc-border);border-radius:6px;',
    '  padding:6px 10px;font:600 12px system-ui,sans-serif;cursor:pointer;transition:border-color .15s,background .15s;}',
    '.wc-btn:hover{border-color:var(--wc-accent);}',
    '.wc-btn-accent{background:var(--wc-accent);border-color:var(--wc-accent);color:#fff;}',
    '.wc-dock{position:fixed;right:14px;bottom:14px;z-index:2147483500;display:flex;flex-direction:column;gap:8px;align-items:flex-end;}',
    '.wc-fab{width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;',
    '  background:var(--wc-panel);color:var(--wc-ink);border:1px solid var(--wc-border);cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.35);transition:transform .15s,border-color .15s;}',
    '.wc-fab:hover{transform:translateY(-2px);border-color:var(--wc-accent);}',
    '.wc-panel{position:fixed;z-index:2147483550;background:var(--wc-panel);color:var(--wc-ink);border:1px solid var(--wc-border);',
    '  border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.5);font:14px system-ui,sans-serif;max-height:80vh;overflow:auto;}',
    '.wc-panel h3{margin:0 0 10px;font:700 14px system-ui,sans-serif;color:var(--wc-ink);}',
    '.wc-panel label{display:block;font:600 11px system-ui,sans-serif;color:var(--wc-muted);margin:10px 0 4px;text-transform:uppercase;letter-spacing:.5px;}',
    '.wc-panel input[type=text],.wc-panel input[type=password],.wc-panel input[type=number],.wc-panel select,.wc-panel textarea{',
    '  width:100%;box-sizing:border-box;background:var(--wc-bg);color:var(--wc-ink);border:1px solid var(--wc-border);border-radius:6px;padding:7px 9px;font:13px system-ui,sans-serif;}',
    '.wc-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}',
    '.wc-list{list-style:none;margin:0;padding:0;}',
    '.wc-list li{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:6px;cursor:pointer;}',
    '.wc-list li:hover{background:rgba(68,147,248,.12);}',
    '.wc-star{cursor:pointer;color:var(--wc-muted);}.wc-star.on{color:#f0c419;}',
    '.wc-overlay{position:fixed;inset:0;z-index:2147483540;background:rgba(0,0,0,.45);}',
    '.wc-palette{position:fixed;left:50%;top:14%;transform:translateX(-50%);width:min(560px,92vw);}',
    '.wc-result-tools{display:inline-flex;gap:6px;margin:6px 0;vertical-align:middle;}',
    '.wc-mini{font-size:11px;padding:3px 7px;}',
    '.wc-hist-bar{display:inline-flex;gap:6px;align-items:center;font:600 12px system-ui,sans-serif;color:var(--wc-muted);}',
    'body.wc-focus :is(.menu-bar,#adCtn,.adCtn,[id*="ad" i][class*="ad" i],aside,nav){display:none !important;}',
    'body.wc-comfort #output,body.wc-comfort .generatorOutput{max-width:var(--wc-width,720px);margin-left:auto;margin-right:auto;',
    '  font-size:var(--wc-font,16px) !important;line-height:var(--wc-lh,1.6) !important;}',
    'body.wc-sepia{filter:sepia(.35) brightness(.98);}',
    '.wc-resize-handle{height:8px;cursor:ns-resize;background:linear-gradient(var(--wc-border),transparent);border-radius:0 0 6px 6px;}',
    '.wc-pin-tray{position:fixed;left:14px;bottom:14px;z-index:2147483500;max-width:280px;display:flex;flex-direction:column;gap:6px;}',
    '.wc-pin{background:var(--wc-panel);border:1px solid var(--wc-border);border-radius:8px;padding:8px;font-size:12px;color:var(--wc-ink);position:relative;}',
    '.wc-pin .wc-x{position:absolute;top:4px;right:6px;cursor:pointer;color:var(--wc-muted);}'
  ].join('\n'));

  // (modules B–H appended below)

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

  function openPalette() {
    if ($('.wc-palette')) return;
    var overlay = el('div', { class: 'wc-overlay', onclick: close });
    var favs = favorites();
    var recent = gget('recent', []);
    var input = el('input', { type: 'text', placeholder: 'Search your generators…  (\u2191\u2193 to move, Enter to open)' });
    var listEl = el('ul', { class: 'wc-list' });
    var panel = el('div', { class: 'wc-panel wc-palette', style: { padding: '14px' } }, [
      el('h3', { text: 'Your generators' }), input, listEl
    ]);
    function close() { overlay.remove(); panel.remove(); document.removeEventListener('keydown', onKey); }
    var rows = [];
    function build(filter) {
      listEl.innerHTML = ''; rows = [];
      var seen = {};
      var pool = [];
      favs.forEach(function (n) { if (!seen[n]) { seen[n] = 1; pool.push({ name: n, fav: true }); } });
      recent.forEach(function (r) { if (!seen[r.name]) { seen[r.name] = 1; pool.push({ name: r.name, title: r.title, fav: false }); } });
      pool.filter(function (p) { return !filter || p.name.toLowerCase().indexOf(filter.toLowerCase()) !== -1; })
        .slice(0, 40).forEach(function (p, idx) {
          var star = el('span', { class: 'wc-star' + (isFav(p.name) ? ' on' : ''), text: '\u2605',
            onclick: function (e) { e.stopPropagation(); var on = toggleFav(p.name); star.classList.toggle('on', on); } });
          var li = el('li', { onclick: function () { location.href = 'https://perchance.org/' + p.name; } }, [
            star, el('span', { text: p.title || p.name, style: { flex: '1' } }),
            el('span', { text: p.name, style: { color: 'var(--wc-muted)', fontSize: '11px' } })
          ]);
          if (idx === 0) li.style.background = 'rgba(68,147,248,.12)';
          listEl.appendChild(li); rows.push(li);
        });
      if (!rows.length) listEl.appendChild(el('li', { text: filter ? 'No matches.' : 'Visit some generators to populate this list.', style: { color: 'var(--wc-muted)' } }));
    }
    var sel = 0;
    function highlight() { rows.forEach(function (r, i) { r.style.background = i === sel ? 'rgba(68,147,248,.12)' : ''; }); }
    function onKey(e) {
      if (e.key === 'Escape') return close();
      if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, rows.length - 1); highlight(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); highlight(); e.preventDefault(); }
      else if (e.key === 'Enter' && rows[sel]) rows[sel].click();
    }
    input.addEventListener('input', function () { sel = 0; build(input.value); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay); document.body.appendChild(panel);
    build(''); input.focus();
  }

  // ============================================================ C. theme / reading comfort
  function comfortSettings() { return gget('comfort:' + genName(), gget('comfort:_default', {})); }
  function applyComfort() {
    var c = comfortSettings();
    document.body.classList.toggle('wc-comfort', !!c.enabled);
    document.body.classList.toggle('wc-sepia', c.theme === 'sepia');
    if (c.theme === 'dark') document.documentElement.style.colorScheme = 'dark';
    else if (c.theme === 'light') document.documentElement.style.colorScheme = 'light';
    if (c.font) document.documentElement.style.setProperty('--wc-font', c.font + 'px');
    if (c.width) document.documentElement.style.setProperty('--wc-width', c.width + 'px');
    if (c.lh) document.documentElement.style.setProperty('--wc-lh', c.lh);
    if (c.dyslexic) document.body.style.fontFamily = '"OpenDyslexic","Comic Sans MS",system-ui,sans-serif';
    else document.body.style.fontFamily = '';
  }
  function openComfort() {
    if ($('#wc-comfort-panel')) { $('#wc-comfort-panel').remove(); return; }
    var c = comfortSettings();
    function field(label, node) { return el('div', {}, [el('label', { text: label }), node]); }
    var enable = el('input', { type: 'checkbox' }); enable.checked = !!c.enabled;
    var theme = el('select', {}, ['system', 'dark', 'light', 'sepia'].map(function (t) { var o = el('option', { value: t, text: t }); if ((c.theme || 'system') === t) o.selected = true; return o; }));
    var font = el('input', { type: 'number', value: c.font || 16, min: '11', max: '32' });
    var width = el('input', { type: 'number', value: c.width || 720, min: '360', max: '1400', step: '20' });
    var lh = el('input', { type: 'number', value: c.lh || 1.6, min: '1.1', max: '2.4', step: '0.1' });
    var dys = el('input', { type: 'checkbox' }); dys.checked = !!c.dyslexic;
    function save() {
      var v = { enabled: enable.checked, theme: theme.value, font: +font.value, width: +width.value, lh: +lh.value, dyslexic: dys.checked };
      gset('comfort:' + genName(), v); gset('comfort:_default', v); applyComfort();
    }
    [enable, theme, font, width, lh, dys].forEach(function (n) { n.addEventListener('change', save); n.addEventListener('input', save); });
    var panel = el('div', { id: 'wc-comfort-panel', class: 'wc-panel', style: { right: '64px', bottom: '14px', width: '260px', padding: '14px' } }, [
      el('h3', { text: 'Reading comfort' }),
      el('label', { text: 'Apply comfort layout' }), enable,
      field('Theme', theme), field('Font size (px)', font), field('Max width (px)', width), field('Line height', lh),
      el('label', { text: 'Dyslexia-friendly font' }), dys,
      el('div', { class: 'wc-row', style: { marginTop: '12px' } }, [
        el('button', { class: 'wc-btn wc-mini', text: 'Focus mode', onclick: function () { document.body.classList.toggle('wc-focus'); } }),
        el('button', { class: 'wc-btn wc-mini', text: 'Reset', onclick: function () { gdel('comfort:' + genName()); applyComfort(); $('#wc-comfort-panel').remove(); } })
      ])
    ]);
    document.body.appendChild(panel);
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
    tray = el('div', { class: 'wc-pin-tray' });
    pins.slice(0, 6).forEach(function (p, i) {
      var x = el('span', { class: 'wc-x', text: '\u00d7', onclick: function () { var arr = gget('pins:' + genName(), []); arr.splice(i, 1); gset('pins:' + genName(), arr); renderPins(); } });
      var body = el('div', { html: p.html });
      var pin = el('div', { class: 'wc-pin' }, [x, body]);
      tray.appendChild(pin);
    });
    document.body.appendChild(tray);
  }
  function attachResultTools() {
    var out = outputNode(); if (!out || out.dataset.wcTools) return;
    out.dataset.wcTools = '1';
    var tools = el('div', { class: 'wc-result-tools' }, [
      el('button', { class: 'wc-btn wc-mini', text: '\u2398 Copy', title: 'Copy output text', onclick: function () { copyText(nodeToText(out)); } }),
      el('button', { class: 'wc-btn wc-mini', text: '\u2913 Save', title: 'Download as .txt', onclick: function () { download(genName() + '-output.txt', nodeToText(out)); } }),
      el('button', { class: 'wc-btn wc-mini', text: '\u{1F4CC} Pin', title: 'Pin this result for comparison', onclick: function () { pinResult(out.innerHTML); toast('Pinned'); } })
    ]);
    out.parentNode.insertBefore(tools, out);
  }

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
  function renderHistBar() {
    var out = outputNode(); if (!out) return;
    var bar = $('#wc-hist-bar');
    if (!bar) {
      bar = el('span', { id: 'wc-hist-bar', class: 'wc-hist-bar' }, [
        el('button', { class: 'wc-btn wc-mini', text: '\u2190', title: 'Previous result', onclick: function () { if (histPos > 0) restore(histPos - 1); } }),
        el('span', { id: 'wc-hist-label' }),
        el('button', { class: 'wc-btn wc-mini', text: '\u2192', title: 'Next result', onclick: function () { if (histPos < histStack.length - 1) restore(histPos + 1); } })
      ]);
      var tools = $('.wc-result-tools'); if (tools) tools.appendChild(bar); else { out.parentNode.insertBefore(bar, out); }
    }
    var lbl = $('#wc-hist-label'); if (lbl) lbl.textContent = (histPos + 1) + ' / ' + histStack.length;
  }

  // ============================================================ F. resizable inputs
  function enhanceInputs() {
    $$('textarea').forEach(function (ta) {
      if (ta.dataset.wcResize) return; ta.dataset.wcResize = '1';
      ta.style.resize = ta.style.resize || 'vertical';
      // Enter submits / Shift+Enter newline normalization is risky to force globally;
      // instead add an unobtrusive expand button.
      var expand = el('button', { class: 'wc-btn wc-mini', text: '\u26F6', title: 'Expand / collapse',
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

  // ============================================================ G. generator management (folders + CRUD)
  // Perchance has a "my generators" list with server-side folder maps
  // (/api/saveUserGeneratorFolderMap, /api/getGeneratorList). It does NOT offer
  // good client-side sorting/filtering of that list, so we add a local overlay:
  // sort by name/recent, filter by text, and quick CRUD shortcuts that drive the
  // platform's own functions (saveGenerator / settingsModal.deleteGenerator) when
  // present. Everything degrades if the hooks are absent.
  function findGeneratorListContainer() {
    // best-effort: the account page lists generators; look for known ids/classes
    return $('#generatorList') || $('[id*="generatorList" i]') || $('.generator-list') || null;
  }
  function openManager() {
    if ($('#wc-mgr')) { $('#wc-mgr').remove(); return; }
    var recent = gget('recent', []);
    var favs = favorites();
    var localFolders = gget('localFolders', {}); // { folderName: [genName,...] }  (our own grouping)
    var sort = gget('mgrSort', 'recent');
    var filter = '';

    var search = el('input', { type: 'text', placeholder: 'Filter your generators…' });
    var sortSel = el('select', {}, [['recent', 'Recently used'], ['name', 'Name A\u2192Z'], ['fav', 'Favorites first']].map(function (o) { var op = el('option', { value: o[0], text: o[1] }); if (o[0] === sort) op.selected = true; return op; }));
    var listEl = el('ul', { class: 'wc-list' });

    function model() {
      var seen = {}, items = [];
      favs.forEach(function (n) { if (!seen[n]) { seen[n] = 1; items.push({ name: n, fav: true, t: 0 }); } });
      recent.forEach(function (r) { if (!seen[r.name]) { seen[r.name] = 1; items.push({ name: r.name, title: r.title, fav: false, t: r.t }); } });
      if (filter) items = items.filter(function (i) { return (i.name + (i.title || '')).toLowerCase().indexOf(filter.toLowerCase()) !== -1; });
      if (sort === 'name') items.sort(function (a, b) { return a.name.localeCompare(b.name); });
      else if (sort === 'fav') items.sort(function (a, b) { return (b.fav ? 1 : 0) - (a.fav ? 1 : 0); });
      else items.sort(function (a, b) { return (b.t || 0) - (a.t || 0); });
      return items;
    }
    function build() {
      listEl.innerHTML = '';
      var items = model();
      if (!items.length) { listEl.appendChild(el('li', { text: 'No generators tracked yet.', style: { color: 'var(--wc-muted)' } })); return; }
      items.forEach(function (it) {
        var star = el('span', { class: 'wc-star' + (isFav(it.name) ? ' on' : ''), text: '\u2605', onclick: function (e) { e.stopPropagation(); var on = toggleFav(it.name); star.classList.toggle('on', on); favs = favorites(); } });
        var open = el('button', { class: 'wc-btn wc-mini', text: 'open', onclick: function (e) { e.stopPropagation(); location.href = 'https://perchance.org/' + it.name; } });
        var edit = el('button', { class: 'wc-btn wc-mini', text: 'edit', onclick: function (e) { e.stopPropagation(); location.href = 'https://perchance.org/' + it.name + '?edit'; } });
        var forget = el('button', { class: 'wc-btn wc-mini', text: 'forget', title: 'Remove from this local list', onclick: function (e) { e.stopPropagation(); var r = gget('recent', []).filter(function (x) { return x.name !== it.name; }); gset('recent', r); recent = r; build(); } });
        listEl.appendChild(el('li', {}, [star, el('span', { text: it.title || it.name, style: { flex: '1' } }), el('span', { text: it.name, style: { color: 'var(--wc-muted)', fontSize: '11px' } }), open, edit, forget]));
      });
    }
    search.addEventListener('input', function () { filter = search.value; build(); });
    sortSel.addEventListener('change', function () { sort = sortSel.value; gset('mgrSort', sort); build(); });

    // CRUD shortcuts (drive Perchance's own functions where present)
    var crud = el('div', { class: 'wc-row', style: { marginTop: '12px' } }, [
      el('button', { class: 'wc-btn wc-mini wc-btn-accent', text: '\uFF0B New generator', onclick: function () { window.open('https://perchance.org/create', '_blank'); } }),
      el('button', { class: 'wc-btn wc-mini', text: 'Fork this', title: 'Open this generator\u2019s editor to copy it', onclick: function () { if (genName()) location.href = 'https://perchance.org/' + genName() + '?edit'; else toast('Open a generator first'); } }),
      el('button', { class: 'wc-btn wc-mini', text: 'Save now', title: 'Trigger Perchance save (edit mode)', onclick: function () { if (typeof window.saveGenerator === 'function') { try { window.saveGenerator(); toast('Save triggered'); } catch (e) { toast('Save failed'); } } else toast('Open the editor to save'); } }),
      el('button', { class: 'wc-btn wc-mini', text: 'Delete\u2026', title: 'Delete current generator (edit mode)', onclick: function () { if (window.settingsModal && typeof window.settingsModal.deleteGenerator === 'function') { if (confirm('Delete ' + genName() + '? This uses Perchance\u2019s own delete and cannot be undone.')) window.settingsModal.deleteGenerator(); } else toast('Open the editor settings to delete'); } })
    ]);

    var panel = el('div', { id: 'wc-mgr', class: 'wc-panel', style: { right: '14px', top: '14px', width: 'min(440px,94vw)', padding: '16px' } }, [
      el('h3', { text: 'Generator manager' }),
      el('div', { class: 'wc-row' }, [search, sortSel]),
      listEl, crud,
      el('div', { style: { marginTop: '10px', fontSize: '11px', color: 'var(--wc-muted)' }, text: 'Local list built from generators you\u2019ve opened and starred. CRUD buttons drive Perchance\u2019s own save/delete when available.' })
    ]);
    document.body.appendChild(panel); build(); search.focus();
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
      body: function (model, sys, user) { return JSON.stringify({ model: model, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], temperature: 0.7 }); },
      extract: function (j) { return j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content; }
    },
    anthropic: {
      label: 'Anthropic (Claude)', keyHint: 'sk-ant-\u2026', defaultModel: 'claude-sonnet-4-20250514',
      url: function () { return 'https://api.anthropic.com/v1/messages'; },
      headers: function (key) { return { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }; },
      body: function (model, sys, user) { return JSON.stringify({ model: model, max_tokens: 4096, system: sys, messages: [{ role: 'user', content: user }] }); },
      extract: function (j) { return j && j.content && j.content[0] && j.content[0].text; }
    },
    google: {
      label: 'Google (Gemini)', keyHint: 'AIza\u2026', defaultModel: 'gemini-1.5-pro',
      url: function (model, key) { return 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key); },
      headers: function () { return { 'Content-Type': 'application/json' }; },
      body: function (model, sys, user) { return JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents: [{ role: 'user', parts: [{ text: user }] }] }); },
      extract: function (j) { try { return j.candidates[0].content.parts[0].text; } catch (e) { return null; } }
    }
  };
  function aiConfig() { return gget('ai', { provider: 'builtin', keys: {}, models: {}, instruction: '' }); }
  function callOwnAI(cfg, sys, user, cb) {
    var p = PROVIDERS[cfg.provider]; if (!p) return cb('Unknown provider', null);
    var key = (cfg.keys || {})[cfg.provider]; if (!key) return cb('No API key set for ' + p.label, null);
    var model = (cfg.models || {})[cfg.provider] || p.defaultModel;
    GM_xmlhttpRequest({
      method: 'POST', url: p.url(model, key), headers: p.headers(key), data: p.body(model, sys, user),
      onload: function (res) {
        try { var j = JSON.parse(res.responseText); var txt = p.extract(j);
          if (txt) cb(null, txt); else cb('No text in response: ' + res.responseText.slice(0, 200), null);
        } catch (e) { cb('Parse error: ' + e.message, null); }
      },
      onerror: function () { cb('Network error contacting ' + p.label, null); }
    });
  }
  function openAISettings() {
    if ($('#wc-ai')) { $('#wc-ai').remove(); return; }
    var cfg = aiConfig();
    var provider = el('select', {}, [['builtin', 'Perchance built-in (default)']].concat(Object.keys(PROVIDERS).map(function (k) { return [k, PROVIDERS[k].label]; })).map(function (o) { var op = el('option', { value: o[0], text: o[1] }); if (o[0] === cfg.provider) op.selected = true; return op; }));
    var keyWrap = el('div', {});
    var modelWrap = el('div', {});
    var instruction = el('textarea', { rows: '4', placeholder: 'Optional: override the AI Helper\u2019s system instruction (what it should do with your prompt). Leave blank to use Perchance\u2019s default.' });
    instruction.value = cfg.instruction || '';
    function renderProviderFields() {
      keyWrap.innerHTML = ''; modelWrap.innerHTML = '';
      var pk = provider.value;
      if (pk === 'builtin') {
        keyWrap.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--wc-muted)' }, text: 'Uses Perchance\u2019s own ai-text broker. No key needed. You can still set a custom instruction below.' }));
        return;
      }
      var p = PROVIDERS[pk];
      var key = el('input', { type: 'password', placeholder: p.keyHint, value: (cfg.keys || {})[pk] || '' });
      var model = el('input', { type: 'text', placeholder: p.defaultModel, value: (cfg.models || {})[pk] || '' });
      key.addEventListener('input', function () { cfg.keys = cfg.keys || {}; cfg.keys[pk] = key.value; });
      model.addEventListener('input', function () { cfg.models = cfg.models || {}; cfg.models[pk] = model.value; });
      keyWrap.appendChild(el('label', { text: p.label + ' API key (stored locally only)' })); keyWrap.appendChild(key);
      modelWrap.appendChild(el('label', { text: 'Model' })); modelWrap.appendChild(model);
    }
    provider.addEventListener('change', renderProviderFields);
    function save() {
      cfg.provider = provider.value; cfg.instruction = instruction.value; gset('ai', cfg);
      applyHelperInstruction(); toast('AI settings saved'); $('#wc-ai').remove();
    }
    var test = el('button', { class: 'wc-btn wc-mini', text: 'Test', onclick: function () {
      if (provider.value === 'builtin') return toast('Built-in uses Perchance directly');
      cfg.provider = provider.value;
      callOwnAI(cfg, 'You are a helper. Reply with the single word: ok', 'ping', function (err, txt) { toast(err ? ('\u2717 ' + err).slice(0, 80) : ('\u2713 ' + (txt || '').trim().slice(0, 40))); });
    } });
    var panel = el('div', { id: 'wc-ai', class: 'wc-panel', style: { right: '14px', bottom: '64px', width: 'min(420px,94vw)', padding: '16px' } }, [
      el('h3', { text: 'AI Helper settings' }),
      el('label', { text: 'Provider' }), provider, keyWrap, modelWrap,
      el('label', { text: 'Custom Helper instruction (system prompt)' }), instruction,
      el('div', { class: 'wc-row', style: { marginTop: '12px' } }, [
        el('button', { class: 'wc-btn wc-btn-accent wc-mini', text: 'Save', onclick: save }), test,
        el('button', { class: 'wc-btn wc-mini', text: 'Close', onclick: function () { $('#wc-ai').remove(); } })
      ]),
      el('div', { style: { marginTop: '10px', fontSize: '11px', color: 'var(--wc-muted)' }, text: 'Your key is stored only in this browser and sent only to the provider you pick. Choose "Perchance built-in" to keep using the default broker with just a custom instruction.' })
    ]);
    document.body.appendChild(panel); renderProviderFields();
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
      var input = $('#aiHelperInputEl'); if (!input || !window.modelTextEditor) return;
      var prompt = (input.value || '').trim(); if (!prompt) return;
      e.stopImmediatePropagation(); e.preventDefault();
      var sys = cfg.instruction || 'You are a Perchance generator coding assistant. Given the current code and an instruction, return the COMPLETE updated code only, no explanation. Respect Perchance DSL conventions and avoid bare [word] list-reference traps.';
      var current = window.modelTextEditor.getValue();
      toast('Asking ' + (PROVIDERS[cfg.provider] || {}).label + '\u2026', 4000);
      callOwnAI(cfg, sys, 'CURRENT CODE:\n' + current + '\n\nINSTRUCTION:\n' + prompt, function (err, txt) {
        if (err) return toast(('\u2717 ' + err).slice(0, 90), 5000);
        var code = txt.replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/, '').trim();
        window.modelTextEditor.setValue(code); toast('\u2713 Applied ' + (PROVIDERS[cfg.provider] || {}).label + ' output');
      });
    }, true);
  }

  // ============================================================ bootstrap
  function buildDock() {
    if ($('.wc-dock')) return;
    var dock = el('div', { class: 'wc-dock' }, [
      el('div', { class: 'wc-fab', title: 'Generator manager', text: '\u{1F5C2}', onclick: openManager }),
      el('div', { class: 'wc-fab', title: 'AI Helper settings', text: '\u{1F916}', onclick: openAISettings }),
      el('div', { class: 'wc-fab', title: 'Reading comfort', text: '\u{1F441}', onclick: openComfort }),
      el('div', { class: 'wc-fab', title: 'Your generators ( / )', text: '\u2605', onclick: openPalette })
    ]);
    document.body.appendChild(dock);
  }
  function shortcuts(e) {
    var typing = /input|textarea|select/i.test((e.target.tagName || '')) || e.target.isContentEditable;
    if (e.key === '/' && !typing) { e.preventDefault(); openPalette(); return; }
    if (typing) return;
    if (e.key === 'f' || e.key === 'F') { var n = genName(); if (n) { var on = toggleFav(n); toast(on ? 'Favorited \u2605' : 'Unfavorited'); } }
    else if (e.key === 'c' || e.key === 'C') { var o = outputNode(); if (o) copyText(nodeToText(o)); }
    else if (e.key === '[') { if (histPos > 0) restore(histPos - 1); }
    else if (e.key === ']') { if (histPos < histStack.length - 1) restore(histPos + 1); }
    else if (e.key === '?') { toast('/ launcher \u00b7 f favorite \u00b7 c copy \u00b7 [ ] history \u00b7 dock buttons bottom-right', 4000); }
  }

  function init() {
    if (window.top !== window.self) return; // top frame only
    try {
      recordVisit();
      applyComfort();
      buildDock();
      renderPins();
      document.addEventListener('keydown', shortcuts);

      // observe output for history + tools; observe DOM for inputs + helper hooks
      var out = outputNode();
      if (out) { snapshotOutput(); attachResultTools();
        new MutationObserver(debounce(function () { attachResultTools(); snapshotOutput(); }, 250)).observe(out, { childList: true, subtree: true, characterData: true });
      }
      var enhance = debounce(function () { enhanceInputs(); applyHelperInstruction(); hookHelperSubmit(); if (!outputNode()) return; if (!$('.wc-result-tools')) attachResultTools(); }, 400);
      enhance();
      new MutationObserver(enhance).observe(document.body, { childList: true, subtree: true });
    } catch (e) { /* never break the host page */ if (window.console) console.warn('[WeldCompanion]', e); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
