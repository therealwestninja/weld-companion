// ==UserScript==
// @name         Weld Companion for Perchance
// @namespace    https://github.com/therealwestninja/weld
// @version      1.7.0
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
// @connect      api.openai.com
// @connect      api.anthropic.com
// @connect      generativelanguage.googleapis.com
// @connect      api.duckduckgo.com
// @connect      perchance.org
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
  function isEditMode() { return /[?&]edit/.test(location.search) || !!window.modelTextEditor; }
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
    '.wc-drawer{position:fixed;top:8px;right:12px;width:min(440px,calc(100vw - 24px));z-index:2147483550;',
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
    '.wc-body::-webkit-scrollbar{width:9px;} .wc-body::-webkit-scrollbar-thumb{background:var(--wc-line);border-radius:9px;}',
    '.wc-body::-webkit-scrollbar-track{background:transparent;}',
    // a sticky footer area inside a tab (for CRUD / actions)
    '.wc-foot{margin-top:14px;padding-top:14px;border-top:1px solid var(--wc-line-2);}',
    '.wc-section-note{font:500 11px/1.5 var(--wc-sans);color:var(--wc-faint);margin-top:12px;}',
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
      { id: 'comfort', glyph: '\u{1F441}', label: 'Comfort' },
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
    else if (WC_TAB === 'comfort') renderComfort(body);
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

  // Generators tab = the old launcher + manager, merged (they list the same data).
  // Search + sort + filter, keyboard nav, per-row star/open/edit/forget, and the
  // CRUD actions in a footer.
  function renderGenerators(body) {
    var sort = gget('mgrSort', 'recent');
    var filter = '';
    var search = el('input', { class: 'wc-field', type: 'text', placeholder: 'Search your generators\u2026   \u2191\u2193 move \u00b7 \u21b5 open' });
    var sortSel = el('select', { class: 'wc-field', style: { maxWidth: '128px', flex: 'none' } }, [['recent', 'Recent'], ['name', 'A\u2192Z'], ['fav', 'Favorites']].map(function (o) { var op = el('option', { value: o[0], text: o[1] }); if (o[0] === sort) op.selected = true; return op; }));
    var listEl = el('ul', { class: 'wc-list' });
    var rows = [], sel = 0;
    function model() {
      var seen = {}, items = [], favs = favorites(), recent = gget('recent', []);
      favs.forEach(function (n) { if (!seen[n]) { seen[n] = 1; items.push({ name: n, fav: true, t: 0 }); } });
      recent.forEach(function (r) { if (!seen[r.name]) { seen[r.name] = 1; items.push({ name: r.name, title: r.title, fav: false, t: r.t }); } });
      if (filter) items = items.filter(function (i) { return (i.name + (i.title || '')).toLowerCase().indexOf(filter.toLowerCase()) !== -1; });
      if (sort === 'name') items.sort(function (a, b) { return a.name.localeCompare(b.name); });
      else if (sort === 'fav') items.sort(function (a, b) { return (b.fav ? 1 : 0) - (a.fav ? 1 : 0); });
      else items.sort(function (a, b) { return (b.t || 0) - (a.t || 0); });
      return items;
    }
    function build() {
      listEl.innerHTML = ''; rows = [];
      var items = model();
      if (!items.length) { listEl.appendChild(el('li', { class: 'wc-gslug', text: filter ? 'No matches.' : 'Visit some generators to populate this list.' })); return; }
      items.slice(0, 60).forEach(function (it, idx) {
        var star = el('span', { class: 'wc-star' + (isFav(it.name) ? ' on' : ''), text: '\u2605', onclick: function (e) { e.stopPropagation(); var on = toggleFav(it.name); star.classList.toggle('on', on); } });
        var open = el('button', { class: 'wc-btn wc-mini', text: 'open', onclick: function (e) { e.stopPropagation(); location.href = 'https://perchance.org/' + it.name; } });
        var edit = el('button', { class: 'wc-btn wc-mini', text: 'edit', onclick: function (e) { e.stopPropagation(); location.href = 'https://perchance.org/' + it.name + '?edit'; } });
        var forget = el('button', { class: 'wc-btn wc-mini', text: '\u2715', title: 'Remove from this list', onclick: function (e) { e.stopPropagation(); var r = gget('recent', []).filter(function (x) { return x.name !== it.name; }); gset('recent', r); build(); } });
        var li = el('li', { onclick: function () { location.href = 'https://perchance.org/' + it.name; } }, [star, el('span', { class: 'wc-gname', text: it.title || it.name }), el('span', { class: 'wc-gslug', text: it.name }), open, edit, forget]);
        if (idx === 0) li.classList.add('wc-sel');
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
        el('button', { class: 'wc-btn wc-btn-accent', text: '\uFF0B New', onclick: function () { window.open('https://perchance.org/create', '_blank'); } }),
        el('button', { class: 'wc-btn', text: 'Fork this', title: 'Open this generator\u2019s editor to copy it', onclick: function () { if (genName()) location.href = 'https://perchance.org/' + genName() + '?edit'; else toast('Open a generator first'); } }),
        el('button', { class: 'wc-btn', text: 'Save', title: 'Trigger Perchance save (edit mode)', onclick: function () { if (typeof window.saveGenerator === 'function') { try { window.saveGenerator(); toast('Save triggered'); } catch (e) { toast('Save failed'); } } else toast('Open the editor to save'); } }),
        el('button', { class: 'wc-btn', text: 'Delete\u2026', title: 'Delete current generator (edit mode)', onclick: function () { if (window.settingsModal && typeof window.settingsModal.deleteGenerator === 'function') { if (confirm('Delete ' + genName() + '? This uses Perchance\u2019s own delete and cannot be undone.')) window.settingsModal.deleteGenerator(); } else toast('Open the editor settings to delete'); } })
      ]),
      el('div', { class: 'wc-section-note', text: 'List from generators you\u2019ve opened and starred. New/Fork/Save/Delete drive Perchance\u2019s own functions when available.' })
    ]);
    body.appendChild(el('div', { class: 'wc-row', style: { marginBottom: '12px' } }, [ el('div', { style: { flex: '1' } }, [search]), sortSel ]));
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
      s.textContent = '#output,.generatorOutput,[id*="output" i]:not([id*="weld" i]):not([id*="wc" i]){' +
        'max-width:' + (c.width || 720) + 'px !important;margin-left:auto !important;margin-right:auto !important;' +
        'font-size:' + (c.font || 16) + 'px !important;line-height:' + (c.lh || 1.6) + ' !important;}';
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
    var font  = el('input', { class: 'wc-field', type: 'number', value: c.font  || 16,  min: '11',  max: '32',   step: '1' });
    var width = el('input', { class: 'wc-field', type: 'number', value: c.width || 720, min: '360', max: '1400', step: '20' });
    var lh    = el('input', { class: 'wc-field', type: 'number', value: c.lh    || 1.6, min: '1.1', max: '2.4',  step: '0.1' });

    function save() {
      var v = { enabled: enable.checked, focus: focusCb.checked, theme: curTheme,
                font: +font.value, width: +width.value, lh: +lh.value, dyslexic: dysCb.checked };
      gset('comfort:' + genName(), v); gset('comfort:_default', v); applyComfort();
    }
    [enable, focusCb, dysCb, font, width, lh].forEach(function (n) {
      n.addEventListener('change', save); n.addEventListener('input', save);
    });

    body.appendChild(toggle(enable, 'Apply comfort layout'));
    body.appendChild(el('label', { class: 'wc-label', text: 'Theme' }));
    body.appendChild(swatchRow);
    body.appendChild(el('div', { class: 'wc-row', style: { marginTop: '4px' } }, [
      el('div', { style: { flex: '1' } }, [field('Font size', font)]),
      el('div', { style: { flex: '1' } }, [field('Line height', lh)])
    ]));
    body.appendChild(field('Max width px', width));
    body.appendChild(el('div', { style: { marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' } }, [
      toggle(dysCb,   'Dyslexia-friendly font'),
      toggle(focusCb, 'Focus mode (hide menus & sidebar)')
    ]));
    body.appendChild(el('div', { class: 'wc-foot' }, [
      el('div', { class: 'wc-row' }, [
        el('button', { class: 'wc-btn', text: 'Reset to defaults', onclick: function () { gdel('comfort:' + genName()); applyComfort(); renderTab(); } })
      ]),
      el('div', { class: 'wc-section-note', text: genName() ? 'Settings are remembered per generator.' : 'Open a generator to save per-generator.' })
    ]));
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
    body.appendChild(el('label', { class: 'wc-label', text: 'Provider' }));
    body.appendChild(provider);
    body.appendChild(keyWrap);
    body.appendChild(modelWrap);
    body.appendChild(el('label', { class: 'wc-label', text: 'Custom instruction (system prompt)' }));
    body.appendChild(instruction);
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
  function shortcuts(e) {
    var typing = /input|textarea|select/i.test((e.target.tagName || '')) || e.target.isContentEditable;
    if (e.key === '/' && !typing) { e.preventDefault(); openWindow('generators'); return; }
    if (typing) return;
    if (e.key === 'f' || e.key === 'F') { var n = genName(); if (n) { var on = toggleFav(n); toast(on ? 'Favorited \u2605' : 'Unfavorited'); } }
    else if (e.key === 'c' || e.key === 'C') { var o = outputNode(); if (o) copyText(nodeToText(o)); }
    else if (e.key === '[') { if (histPos > 0) restore(histPos - 1); }
    else if (e.key === ']') { if (histPos < histStack.length - 1) restore(histPos + 1); }
    else if (e.key === '?') { toast('/ open \u00b7 f favorite \u00b7 c copy \u00b7 [ ] history', 4000); }
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
