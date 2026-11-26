/* Project tab UI: reads the generator you are viewing (editor or published), analyses and exports it. */
(function () {
  'use strict';
  if (window.top !== window) return;
  const P = window.WeldProjectCore, H = window.weldProjectHost;
  if (!P || !H) return;
  const E = H.el;
  const DB_NAME = 'weldCompanionProjects', KEEP = 20, MAX_BYTES = 8 * 1048576;
  const go = slug => { window.location.href = 'https://perchance.org/' + encodeURIComponent(slug); };
  const SEEN_KEY = 'projSeen', SIG_KEY = 'projDeps:';
  const GLYPH = { error: '✖', warn: '⚠', info: 'ⓘ' };
  const S = fresh('');
  function fresh(slug) {
    return { slug, loading: false, status: '', error: '', project: null, analysis: null, tree: null, drift: null, open: { findings: true },
      filter: 'warn', findingsMax: 60, listFilter: '', samples: null, sampling: false, sampleN: 30, sampleVia: 'published',
      checks: null, checking: false, history: null, diff: null, search: '', results: null, starred: null, budget: 60000, pack: '', booted: false };
  }
  function notice(message) { S.status = message; H.toast(message, 6000); }
  function draw() { const host = document.getElementById('wc-project-body'); if (host && host.isConnected && host.parentNode) render(host.parentNode); }

  // ----------------------------------------------------------- session store
  // Weld keeps no data of its own: generator copies and snapshots live in memory for this tab only (every store call
  // below falls back to `memory` when there is no database). PERSIST stays false; Backups > Purge deletes the old
  // weldCompanionProjects database that earlier versions filled.
  const PERSIST = false;
  let dbPromise = null; const memory = { projects: new Map(), history: [] };
  function db() {
    if (dbPromise) return dbPromise;
    if (!PERSIST) return (dbPromise = Promise.resolve(null));
    dbPromise = new Promise(resolve => {
      try {
        const open = indexedDB.open(DB_NAME, 1);
        open.onupgradeneeded = () => {
          const d = open.result;
          d.createObjectStore('projects', { keyPath: 'slug' });
          d.createObjectStore('history', { keyPath: 'id', autoIncrement: true }).createIndex('slug', 'slug');
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => resolve(null);
        open.onblocked = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return dbPromise;
  }
  function tx(store, mode, fn) {
    return db().then(d => new Promise((resolve, reject) => {
      if (!d) return reject(new Error('no-db'));
      try {
        const t = d.transaction(store, mode), s = t.objectStore(store); let out;
        out = fn(s);
        t.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
        t.onerror = () => reject(t.error || new Error('db error'));
        t.onabort = () => reject(t.error || new Error('db aborted'));
      } catch (e) { reject(e); }
    }));
  }
  function req(r) { return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
  const store = {
    putProject(rec) { return tx('projects', 'readwrite', s => s.put(rec)).catch(() => { memory.projects.set(rec.slug, rec); }); },
    getProject(slug) { return tx('projects', 'readonly', s => req(s.get(slug))).then(x => x || memory.projects.get(slug) || null, () => memory.projects.get(slug) || null); },
    allProjects() { return tx('projects', 'readonly', s => req(s.getAll())).catch(() => Array.from(memory.projects.values())); },
    snapshots(slug) {
      return tx('history', 'readonly', s => req(s.index('slug').getAll(slug))).catch(() => memory.history.filter(h => h.slug === slug))
        .then(list => list.sort((a, b) => b.t - a.t));
    },
    addSnapshot(rec) {
      return tx('history', 'readwrite', s => s.add(rec)).catch(() => { memory.history.push(Object.assign({ id: Date.now() + Math.random() }, rec)); })
        .then(() => store.snapshots(rec.slug)).then(list => {
          // Newest KEEP snapshots, and no more than MAX_BYTES of source per generator (always keep two).
          let total = 0;
          const extra = list.filter((h, i) => { total += P.bytes(h.dsl) + P.bytes(h.html); return i >= KEEP || (i >= 2 && total > MAX_BYTES); });
          if (!extra.length) return list;
          return tx('history', 'readwrite', s => { extra.forEach(x => s.delete(x.id)); }).catch(() => {
            memory.history = memory.history.filter(h => !extra.some(x => x.id === h.id));
          }).then(() => list.filter(h => !extra.includes(h)));
        });
    },
    deleteSnapshot(id) {
      return tx('history', 'readwrite', s => { s.delete(id); }).catch(() => { memory.history = memory.history.filter(h => h.id !== id); });
    },
    clearProjects() {
      return tx('projects', 'readwrite', s => { s.clear(); }).catch(() => {}).then(() => { memory.projects.clear(); });
    },
    clearSnapshots(slug) {
      return store.snapshots(slug).then(list => tx('history', 'readwrite', s => { list.forEach(x => s.delete(x.id)); }))
        .catch(() => { memory.history = memory.history.filter(h => h.slug !== slug); });
    }
  };

  // ----------------------------------------------------------------- loading
  function request(url, opts) {
    return new Promise((resolve, reject) => {
      H.request(Object.assign({ method: 'GET', url, timeout: 30000 }, opts || {}), (err, res) => {
        if (err) return reject(new Error(err === 'timeout' ? 'Perchance did not answer in time.' : 'Could not reach Perchance (' + err + ').'));
        if (res.status >= 400) {
          if (/Just a moment/i.test(res.text || '')) return reject(new Error('Perchance asked for a browser check. Open perchance.org once, then try again.'));
          return reject(new Error('Perchance answered HTTP ' + res.status + '.'));
        }
        resolve(res);
      });
    });
  }
  const API = 'https://perchance.org/api/';
  function fetchPublished(slug) {
    const name = encodeURIComponent(slug), bust = '&_=' + Date.now();
    return Promise.all([
      request(API + 'getGeneratorsAndDependencies?generatorNames=' + name + bust),
      request(API + 'getGeneratorHtml?generatorName=' + name + bust).then(r => r, e => ({ error: e }))
    ]).then(([depsRes, htmlRes]) => {
      let json; try { json = JSON.parse(depsRes.text); } catch (e) { P.parseListsResponse(depsRes.text); throw new Error('Perchance returned something unexpected for this generator.'); }
      const deps = P.normalizeDeps(json, slug), node = deps.nodes[slug];
      if (!node) throw new Error('"' + slug + '" was not found. It may be unpublished or private.');
      let html = null, note = '';
      if (htmlRes && htmlRes.text != null) html = P.parseHtmlResponse(htmlRes.text); else note = 'HTML panel could not be fetched.';
      return { name: slug, dsl: node.code, html, deps, source: 'published', fetchedAt: Date.now(), lastEditTime: node.lastEditTime, note };
    });
  }
  function fromLive(slug) {
    const live = H.live();
    if (!live || live.dsl == null) throw new Error('Open the generator’s editor (#edit) to analyze it live.');
    const keep = S.project && S.project.name === slug ? S.project : null;
    return { name: slug, dsl: live.dsl, html: live.html, deps: keep ? keep.deps : null, source: 'editor', fetchedAt: Date.now(), lastEditTime: keep ? keep.lastEditTime : 0, note: '' };
  }
  function adopt(project, quiet) {
    const analysis = P.analyze({ name: project.name, dsl: project.dsl, html: project.html, deps: project.deps });
    S.project = project; S.analysis = analysis; S.pack = ''; S.diff = null;
    S.tree = project.deps && project.deps.nodes[project.name] ? P.dependencyTree(project.deps, project.name) : null;
    S.drift = null;
    if (project.deps) {
      const sig = P.depSignature(project.deps), prev = H.get(SIG_KEY + project.name, null);
      if (prev) S.drift = P.depDrift(prev, sig);
      if (!prev) H.set(SIG_KEY + project.name, sig);
    }
    store.putProject({ slug: project.name, fetchedAt: project.fetchedAt, source: project.source, dsl: project.dsl, html: project.html, lastEditTime: project.lastEditTime,
      deps: project.deps ? { root: project.deps.root, nodes: project.deps.nodes, unfound: project.deps.unfound } : null });
    const key = P.hash(project.dsl) + '|' + P.hash(project.html);
    return store.snapshots(project.name).then(list => {
      if (list.length && list[0].key === key) return list;
      // Repeated live analyses while you type replace each other instead of filling the history.
      const replace = project.source === 'editor' && list.length && list[0].source === 'editor' && Date.now() - list[0].t < 300000;
      return (replace ? store.deleteSnapshot(list[0].id) : Promise.resolve())
        .then(() => store.addSnapshot({ slug: project.name, t: Date.now(), source: project.source, key, dsl: project.dsl, html: project.html, lastEditTime: project.lastEditTime }));
    }).then(list => { S.history = list; }).catch(() => {});
  }
  function load(mode) {
    if (S.loading) return;
    const slug = H.slug();
    if (!slug) return notice('Open a generator first.');
    S.loading = true; S.error = ''; S.status = mode === 'live' ? 'Reading the editor…' : 'Fetching ' + slug + ' from Perchance…'; draw();
    let job;
    try { job = mode === 'live' ? Promise.resolve(fromLive(slug)) : fetchPublished(slug); } catch (e) { job = Promise.reject(e); }
    job.then(project => adopt(project).then(() => {
      S.status = (project.source === 'editor' ? 'Analyzed the live editor' : 'Fetched the published version') + ' — ' + S.analysis.counts.warn + ' warning(s), ' + S.analysis.counts.error + ' error(s).' + (project.note ? ' ' + project.note : '');
    })).catch(err => { S.error = err && err.message ? err.message : String(err); S.status = ''; })
      .then(() => { S.loading = false; draw(); });
  }
  function loadDepsOnly() {
    if (S.loading || !S.project) return;
    const slug = S.project.name; S.loading = true; S.status = 'Fetching the import tree…'; draw();
    request(API + 'getGeneratorsAndDependencies?generatorNames=' + encodeURIComponent(slug) + '&_=' + Date.now()).then(res => {
      const deps = P.normalizeDeps(JSON.parse(res.text), slug);
      S.project.deps = deps; S.project.lastEditTime = deps.nodes[slug] ? deps.nodes[slug].lastEditTime : S.project.lastEditTime;
      return adopt(S.project);
    }).then(() => { S.status = 'Import tree loaded.'; }).catch(err => { S.error = err.message || String(err); })
      .then(() => { S.loading = false; draw(); });
  }
  function boot() {
    const slug = H.slug();
    if (S.slug !== slug) Object.assign(S, fresh(slug));
    if (S.booted) return;
    S.booted = true;
    if (!slug) return;
    store.getProject(slug).then(cached => {
      if (S.project || !cached) return;
      S.project = { name: slug, dsl: cached.dsl, html: cached.html, deps: cached.deps, source: 'cached', fetchedAt: cached.fetchedAt, lastEditTime: cached.lastEditTime, note: '' };
      S.analysis = P.analyze({ name: slug, dsl: cached.dsl, html: cached.html, deps: cached.deps });
      S.tree = cached.deps && cached.deps.nodes[slug] ? P.dependencyTree(cached.deps, slug) : null;
      S.status = 'Showing the copy saved ' + ago(cached.fetchedAt) + '. Press Load to refresh.';
      draw();
    });
    store.snapshots(slug).then(list => { S.history = list; draw(); });
    const live = H.isEdit() ? H.live() : null;
    if (live && live.dsl != null) load('live');
  }

  // ------------------------------------------------------------------ helpers
  function ago(t) { const s = Math.round((Date.now() - (+t || 0)) / 1000); if (s < 90) return 'just now'; const m = Math.round(s / 60); if (m < 90) return m + ' min ago'; const h = Math.round(m / 60); if (h < 36) return h + ' h ago'; return Math.round(h / 24) + ' days ago'; }
  function kb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'; }
  function btn(label, action, opts) {
    opts = opts || {};
    const b = E('button', { class: 'wc-btn' + (opts.accent ? ' wc-btn-accent' : '') + (opts.mini ? ' wc-mini' : ''), text: label, title: opts.title || '', onclick: () => {
      try { action(); } catch (err) { notice(err.message || String(err)); draw(); }
    } });
    b.disabled = !!opts.disabled; return b;
  }
  function note(parent, text, style) { parent.appendChild(E('div', { class: 'wc-section-note', text, style: style || {} })); }
  function row(parent, kids, style) { parent.appendChild(E('div', { class: 'wc-row', style: Object.assign({ flexWrap: 'wrap', gap: '8px', margin: '8px 0', alignItems: 'center' }, style || {}) }, kids)); }
  function section(parent, id, title, count, build, openByDefault) {
    const open = id in S.open ? S.open[id] : !!openByDefault;
    const d = E('details', { class: 'wc-card', style: { marginTop: '10px' }, ontoggle: ev => { S.open[id] = !!(ev && ev.target ? ev.target.open : d.open); } });
    if (open) d.setAttribute('open', '');
    d.appendChild(E('summary', { style: { cursor: 'pointer', fontWeight: '600' }, text: title + (count != null && count !== '' ? '  ·  ' + count : '') }));
    const body = E('div', { style: { marginTop: '8px' } }); d.appendChild(body);
    if (open) build(body);
    else d.addEventListener('toggle', () => { if (d.open && !body.firstChild) { try { build(body); } catch (e) { note(body, 'Could not render: ' + e.message); } } });
    parent.appendChild(d);
  }
  function canJump() { return !!(S.project && S.project.source === 'editor' && H.isEdit()); }
  function download(name, data, type) {
    const blob = new Blob([data], { type: type || 'text/plain' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { try { URL.revokeObjectURL(a.href); a.remove(); } catch (e) {} }, 1500);
  }
  function isPrivate() { try { return !!(H.meta && H.meta().isPrivate); } catch (e) { return false; } }
  function confirmSend(what) {
    if (S.project && S.project.source === 'published' && !H.isEdit()) {
      return window.confirm('This is the published source of "' + S.project.name + '", which another author may own' + (isPrivate() ? ' and has marked private' : '') + '.\n\n' + what + '\n\nContinue?');
    }
    return true;
  }
  function project() { if (!S.project) throw new Error('Press Load first.'); return S.project; }

  // ------------------------------------------------------------------ sections
  function summary(parent) {
    const a = S.analysis, p = S.project;
    if (!a) { note(parent, 'Nothing is loaded for this generator yet. Use Load: it reads your open editor, or fetches the published DSL, HTML and imports from Perchance.'); return; }
    const st = a.stats;
    const lines = [
      st.lists + ' lists · ' + st.items + ' items · ' + st.functions + ' functions · ' + st.imports + ' import(s)',
      'Lists panel ' + st.dslLines + ' lines (' + kb(st.dslBytes) + ')' + (p.html != null ? ' · HTML panel ' + st.htmlLines + ' lines (' + kb(st.htmlBytes) + ', ' + st.scripts + ' script blocks)' : ' · HTML panel not loaded')
    ];
    if (a.outputSpace) lines.push('About ' + a.outputSpace.text + ' distinct outputs' + (a.outputSpace.approx ? ' (rough: imports and dynamic parts are not counted)' : '') + (a.outputSpace.cycle ? ' · contains a reference cycle' : ''));
    if (a.capabilities.length) lines.push('Uses: ' + a.capabilities.join(', ') + (a.network ? ' — these make network requests' : ''));
    if (a.todos.length) lines.push(a.todos.length + ' TODO/FIXME comment(s)');
    lines.forEach(t => parent.appendChild(E('div', { style: { margin: '2px 0' }, text: t })));
    const badge = (n, label, color) => E('span', { style: { display: 'inline-block', padding: '1px 8px', borderRadius: '10px', border: '1px solid ' + color, color, fontSize: '12px', marginRight: '6px' }, text: n + ' ' + label });
    row(parent, [badge(a.counts.error, 'errors', '#e5534b'), badge(a.counts.warn, 'warnings', '#d29922'), badge(a.counts.info, 'notes', '#768390')]);
  }
  function findingsSection(parent) {
    const a = S.analysis, rank = { error: 0, warn: 1, info: 2 }, max = S.filter === 'error' ? 0 : S.filter === 'warn' ? 1 : 2;
    if (a.suppressedFindings && a.suppressedFindings.length) note(parent, a.suppressedFindings.length + ' finding(s) suppressed by explicit weld-ignore comments. They remain recorded in the analysis JSON.');
    const list = a.findings.filter(f => rank[f.severity] <= max);
    const sel = E('select', { class: 'wc-field', 'aria-label': 'Finding filter', style: { maxWidth: '200px' } }, [['error', 'Errors only'], ['warn', 'Warnings and errors'], ['info', 'Everything']].map(o => {
      const op = E('option', { value: o[0], text: o[1] }); if (o[0] === S.filter) op.selected = true; return op;
    }));
    sel.addEventListener('change', () => { S.filter = sel.value; S.findingsMax = 60; draw(); });
    row(parent, [sel, btn('Ask AI about these', () => {
      confirmSendOrThrow();
      H.openAI('Review the automatic findings below, tell me which are real problems and which are false alarms, and propose minimal fixes.', 'pack');
    }, { mini: true, title: 'Opens the AI helper with this generator and its findings as context. Nothing is sent until you press Ask.' }),
    btn('Send findings to Perchance AI', () => {
      // Include every warning/error, even those hidden by the filter or Show more.
      const issues = a.findings.filter(f => f.severity === 'error' || f.severity === 'warn');
      const report = issues.map(f => '[' + f.severity.toUpperCase() + '] ' + f.pane + (f.line ? ' line ' + f.line : '') + ': ' + f.message + (f.hint ? '\n  Hint: ' + f.hint : '')).join('\n');
      H.openPerchanceAI('Check and fix the confirmed issues in generator "' + S.project.name + '". Read the current generator source first: these automatic findings may be stale or false alarms. Explain false alarms and preserve working code, existing features, shared names, imports, and behavior. Make the smallest complete fixes and verify them in the live preview. Do not publish the generator.\n\nAUTOMATIC FINDINGS (' + issues.length + ' warnings/errors; analyzed ' + S.project.source + ' source):\n' + report);
    }, { mini: true, accent: true, disabled: !H.isEdit() || !a.findings.some(f => f.severity === 'error' || f.severity === 'warn'), title: 'Put all warnings and errors into the native Perchance AI helper input. Existing draft text is kept. Press its Send button when ready. Requires the editor (#edit).' })]);
    if (!list.length) { note(parent, S.filter === 'info' ? 'No findings.' : 'No warnings. Switch the filter to see notes.'); return; }
    if (!canJump()) note(parent, 'Click-to-jump needs the editor open with the live version analyzed.');
    list.slice(0, S.findingsMax).forEach(f => {
      const color = f.severity === 'error' ? '#e5534b' : f.severity === 'warn' ? '#d29922' : '#768390';
      const place = f.line ? f.pane + ' line ' + f.line : f.pane;
      const r = E('div', { style: { padding: '5px 4px', borderBottom: '1px solid var(--wc-line,#333)', cursor: f.line && canJump() ? 'pointer' : 'default' }, title: f.line && canJump() ? 'Jump to this line in the editor' : '',
        onclick: () => { if (f.line && canJump()) H.jump(f.pane, f.line); } }, [
        E('div', {}, [E('span', { style: { color, marginRight: '6px' }, text: GLYPH[f.severity] }), E('span', { style: { opacity: '0.65', marginRight: '6px', fontSize: '12px' }, text: place }), E('span', { text: f.message })]),
        f.hint ? E('div', { style: { opacity: '0.7', fontSize: '12px', marginLeft: '20px' }, text: f.hint }) : null
      ]);
      parent.appendChild(r);
    });
    if (list.length > S.findingsMax) row(parent, [btn('Show more (' + (list.length - S.findingsMax) + ' left)', () => { S.findingsMax += 100; draw(); }, { mini: true })]);
  }
  function confirmSendOrThrow() {
    if (!S.project) throw new Error('Press Load first.');
    if (!confirmSend('Its source will be added to the AI request you review in the Tools tab.')) throw new Error('Cancelled.');
  }
  function outlineSection(parent) {
    const a = S.analysis;
    const input = E('input', { class: 'wc-field', type: 'text', placeholder: 'Filter lists…', 'aria-label': 'Filter lists', value: S.listFilter, style: { maxWidth: '220px' } });
    input.addEventListener('input', () => { S.listFilter = input.value; drawKeepFocus(); });
    parent.appendChild(input);
    const term = S.listFilter.trim().toLowerCase();
    const rows = a.lists.filter(l => !term || l.name.toLowerCase().includes(term));
    if (!rows.length) return note(parent, 'No lists match.');
    rows.slice(0, 300).forEach(l => {
      const what = l.imported ? 'import ' + (l.alias || '') : l.kind === 'assign' ? 'value' : l.items + ' item' + (l.items === 1 ? '' : 's') + (l.props ? ' + ' + l.props + ' prop' + (l.props === 1 ? '' : 's') : '');
      parent.appendChild(E('div', { style: { display: 'flex', gap: '8px', padding: '3px 2px', cursor: canJump() ? 'pointer' : 'default', borderBottom: '1px solid var(--wc-line,#2a2a2a)' }, onclick: () => { if (canJump()) H.jump('dsl', l.line); } }, [
        E('span', { style: { flex: '1', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis' }, text: l.name }),
        E('span', { style: { opacity: '0.65', fontSize: '12px' }, text: what }),
        E('span', { style: { opacity: '0.4', fontSize: '12px', width: '44px', textAlign: 'right' }, text: ':' + l.line })
      ]));
    });
    if (rows.length > 300) note(parent, rows.length - 300 + ' more not shown. Narrow the filter.');
    if (a.functions.length) {
      parent.appendChild(E('div', { class: 'wc-subhead', style: { marginTop: '10px' }, text: 'Functions' }));
      a.functions.forEach(f => parent.appendChild(E('div', { style: { padding: '2px 2px', cursor: canJump() ? 'pointer' : 'default' }, onclick: () => { if (canJump()) H.jump('dsl', f.line); }, text: (f.async ? 'async ' : '') + f.name + '()  ·  ' + f.lines + ' line(s)  ·  line ' + f.line })));
    }
  }
  function drawKeepFocus() {
    const active = document.activeElement, id = active && active.getAttribute && active.getAttribute('aria-label');
    draw();
    if (id) { const again = document.querySelector('[aria-label="' + id + '"]'); if (again && again.focus) { again.focus(); try { again.setSelectionRange(again.value.length, again.value.length); } catch (e) {} } }
  }
  function depsSection(parent) {
    const p = S.project;
    if (!p.deps) {
      note(parent, 'The import tree is not loaded. It comes from Perchance’s public dependency API (one request, can be several hundred KB).');
      row(parent, [btn('Load import tree', loadDepsOnly, { accent: true, disabled: S.loading })]);
      if (S.analysis.imports.length) note(parent, 'Imports named in the source: ' + S.analysis.imports.join(', '));
      return;
    }
    const st = P.dependencyStats(p.deps, p.name);
    note(parent, st.count + ' generator(s) are pulled in, ' + kb(st.bytes) + ' of source, nested ' + st.depth + ' deep.' + (st.heavy.length ? ' Heavy: ' + st.heavy.map(h => h.name + ' ' + kb(h.bytes)).join(', ') + '.' : ''));
    if (p.deps.unfound.length) note(parent, 'Not found on Perchance: ' + p.deps.unfound.join(', '), { color: '#e5534b' });
    if (S.drift && S.drift.any) {
      const parts = [];
      if (S.drift.changed.length) parts.push('changed: ' + S.drift.changed.join(', '));
      if (S.drift.added.length) parts.push('new: ' + S.drift.added.join(', '));
      if (S.drift.removed.length) parts.push('removed: ' + S.drift.removed.join(', '));
      parent.appendChild(E('div', { style: { margin: '6px 0', padding: '6px 8px', border: '1px solid #d29922', borderRadius: '8px', color: '#d29922' }, text: 'Since you last reviewed these imports — ' + parts.join(' · ') }));
      row(parent, [btn('Mark imports as reviewed', () => { H.set(SIG_KEY + p.name, P.depSignature(p.deps)); S.drift = null; notice('Imports marked as reviewed.'); draw(); }, { mini: true })]);
    } else if (S.drift) note(parent, 'No import changed since you last reviewed them.');
    const out = [];
    (function walk(n, depth) {
      out.push({ n, depth });
      n.children.forEach(c => walk(c, depth + 1));
    })(S.tree, 0);
    out.slice(0, 200).forEach(({ n, depth }) => {
      const flag = n.cycle ? '  ↺ cycle' : n.repeated ? '  (shown above)' : n.missing ? '  ✖ missing' : '';
      parent.appendChild(E('div', { style: { paddingLeft: depth * 16 + 'px', fontSize: '13px', padding: '1px 0 1px ' + depth * 16 + 'px' } }, [
        E('span', { text: (depth ? '└ ' : '') + n.name }),
        E('span', { style: { opacity: '0.6', fontSize: '12px' }, text: '  ' + (n.bytes ? kb(n.bytes) : '') + (n.lastEditTime ? '  ·  edited ' + ago(n.lastEditTime) : '') + flag })
      ]));
    });
    if (out.length > 200) note(parent, out.length - 200 + ' more rows not shown.');
  }
  function assetsSection(parent) {
    const h = S.analysis.html;
    if (!h) return note(parent, 'The HTML panel is not loaded.');
    const urls = h.urls;
    if (!urls.length && !h.externalScripts.length) note(parent, 'No external addresses found in the HTML panel.');
    const byHost = {};
    urls.forEach(u => { (byHost[u.host.toLowerCase()] = byHost[u.host.toLowerCase()] || []).push(u); });
    Object.keys(byHost).sort().forEach(host => {
      parent.appendChild(E('div', { class: 'wc-subhead', style: { marginTop: '8px' }, text: host + '  (' + byHost[host].length + ')' }));
      byHost[host].slice(0, 40).forEach(u => {
        const c = S.checks && S.checks[u.url];
        const color = !c ? '' : c.state === 'ok' ? '#3fb950' : c.state === 'dead' ? '#e5534b' : '#d29922';
        parent.appendChild(E('div', { style: { fontSize: '12px', wordBreak: 'break-all', padding: '1px 0' } }, [
          c ? E('span', { style: { color, marginRight: '6px', fontWeight: '600' }, text: c.state === 'ok' ? 'OK' : c.state === 'dead' ? 'DEAD ' + c.status : c.state === 'blocked' ? 'BLOCKED ' + c.status : 'UNREACHABLE' }) : null,
          E('span', { text: u.url }), E('span', { style: { opacity: '0.5' }, text: '  line ' + u.line + (u.count > 1 ? ' ×' + u.count : '') })
        ]));
      });
    });
    const st = h.storage, keys = [];
    if (st.localStorage.length) keys.push('localStorage: ' + st.localStorage.join(', '));
    if (st.sessionStorage.length) keys.push('sessionStorage: ' + st.sessionStorage.join(', '));
    if (st.kv.length) keys.push('kv stores: ' + st.kv.join(', '));
    if (st.indexedDB.length) keys.push('IndexedDB: ' + st.indexedDB.join(', '));
    if (st.cookies) keys.push('uses document.cookie');
    if (keys.length) { parent.appendChild(E('div', { class: 'wc-subhead', style: { marginTop: '10px' }, text: 'Where it keeps data' })); keys.forEach(k => note(parent, k)); }
    const checkable = checkableUrls();
    row(parent, [btn(S.checking ? 'Checking…' : 'Check links (' + checkable.length + ')', checkLinks, { disabled: S.checking || !checkable.length, title: 'Sends one anonymous request per address to the sites listed above.' }),
      S.checks ? btn('Copy dead links', () => copy(Object.keys(S.checks).filter(u => S.checks[u].state === 'dead').join('\n') || '(none)'), { mini: true }) : null]);
  }
  function checkableUrls() {
    const h = S.analysis && S.analysis.html; if (!h) return [];
    return h.urls.filter(u => !/[{}\[\]$]/.test(u.url) && !/^(localhost|127\.|0\.0\.0\.0)/i.test(u.host)).map(u => u.url).slice(0, 60);
  }
  function copy(text) { H.copy ? H.copy(text) : H.toast('Copy is unavailable here'); }
  function checkLinks() {
    const list = checkableUrls(); if (!list.length || S.checking) return;
    const hosts = Array.from(new Set(list.map(u => (/^https?:\/\/([^/]+)/i.exec(u) || [])[1]))).filter(Boolean);
    if (!window.confirm('Send ' + list.length + ' anonymous request(s) to ' + hosts.length + ' site(s)?\n\n' + hosts.slice(0, 12).join('\n') + (hosts.length > 12 ? '\n…' : '') + '\n\nYour userscript manager may ask you to allow each site.')) return;
    S.checking = true; S.checks = {}; draw();
    let next = 0;
    const one = url => new Promise(resolve => {
      const done = (state, status) => { S.checks[url] = { state, status: status || 0 }; resolve(); };
      const attempt = (method, headers) => H.request({ method, url, headers, timeout: 12000, anonymous: true }, (err, res) => {
        if (err) return method === 'HEAD' ? attempt('GET', { Range: 'bytes=0-0' }) : done('error');
        const s = res.status;
        if (s >= 200 && s < 400) return done('ok', s);
        if (method === 'HEAD' && (s === 405 || s === 403 || s === 501 || s === 400)) return attempt('GET', { Range: 'bytes=0-0' });
        done(s === 404 || s === 410 ? 'dead' : s === 401 || s === 403 ? 'blocked' : 'error', s);
      });
      attempt('HEAD');
    });
    const worker = () => { if (next >= list.length) return Promise.resolve(); const url = list[next++]; return one(url).then(worker); };
    Promise.all([worker(), worker(), worker(), worker()]).then(() => {
      const bad = Object.keys(S.checks).filter(u => S.checks[u].state === 'dead').length;
      S.checking = false; notice('Checked ' + list.length + ' address(es): ' + bad + ' dead.'); draw();
    });
  }
  function samplingSection(parent) {
    const a = S.analysis;
    note(parent, 'Re-rolls the generator by calling its own update() and reads each result, to show how varied the output really is. Do not use this on generators whose update() calls AI, the web, or changes saved data.');
    if (a.network) note(parent, 'This generator uses ' + a.capabilities.join(', ') + '. Re-rolling may trigger those requests.', { color: '#d29922' });
    const n = E('input', { class: 'wc-field', type: 'number', min: '5', max: '200', value: S.sampleN, 'aria-label': 'Number of samples', style: { width: '90px' } });
    n.addEventListener('change', () => { S.sampleN = Math.max(5, Math.min(200, Math.floor(+n.value) || 30)); });
    const via = E('select', { class: 'wc-field', 'aria-label': 'Sample source', style: { maxWidth: '260px' } }, [['published', 'Published copy (hidden frame)'], ['visible', 'The preview on this page']].map(o => {
      const op = E('option', { value: o[0], text: o[1] }); if (o[0] === S.sampleVia) op.selected = true; return op;
    }));
    via.addEventListener('change', () => { S.sampleVia = via.value; });
    row(parent, [n, via, btn(S.sampling ? 'Sampling…' : 'Run sample', runSample, { accent: true, disabled: S.sampling })]);
    const r = S.samples; if (!r) return;
    const s = r.stats;
    if (!s.n) return note(parent, 'The generator produced no readable output. It may be an app or chat generator.');
    [s.n + ' result(s), ' + s.unique + ' different (' + Math.round(s.duplicateRate * 100) + '% repeats) · length ' + s.minLen + '–' + s.maxLen + ', typically ' + s.medianLen,
      s.expectedDuplicates != null ? 'With about ' + a.outputSpace.text + ' possible outputs, ' + (s.expectedDuplicates < 0.5 ? 'almost no' : 'about ' + Math.round(s.expectedDuplicates)) + ' repeat(s) would be expected.' : ''].filter(Boolean)
      .forEach(t => parent.appendChild(E('div', { style: { margin: '2px 0' }, text: t })));
    if (s.lowVariety) parent.appendChild(E('div', { style: { color: '#d29922', margin: '4px 0' }, text: '⚠ Variety looks low. Repeats are well above what the list sizes predict, so odds may be skewed or some lists may be too short.' }));
    if (s.topRepeated.length) parent.appendChild(E('div', { style: { fontSize: '12px', opacity: '0.8', margin: '4px 0' }, text: 'Most repeated: ' + s.topRepeated.slice(0, 4).map(x => '"' + x.text + '" ×' + x.count).join(' · ') }));
    if (s.topWords.length) parent.appendChild(E('div', { style: { fontSize: '12px', opacity: '0.8', margin: '4px 0' }, text: 'Common words: ' + s.topWords.slice(0, 8).map(x => x.word + ' ' + x.count).join(', ') }));
    const box = E('textarea', { class: 'wc-field', rows: '8', readonly: 'readonly', 'aria-label': 'Samples' }); box.value = r.res.samples.join('\n——\n');
    parent.appendChild(box);
    row(parent, [btn('Copy samples', () => copy(r.res.samples.join('\n\n')), { mini: true }), btn('Download .txt', () => download((S.project.name || 'generator') + '-samples.txt', r.res.samples.join('\n\n'), 'text/plain'), { mini: true })]);
  }
  function runSample() {
    const a = S.analysis, slug = S.project.name;
    if (a.network && !window.confirm('This generator uses ' + a.capabilities.join(', ') + '.\n\nRe-rolling it ' + S.sampleN + ' times may trigger those requests. Continue?')) return;
    const via = S.sampleVia; S.sampling = true; S.error = ''; draw();
    H.sample(slug, via, { n: S.sampleN, ms: 20000 }).then(res => {
      S.samples = { res, stats: P.sampleStats(res.samples, a.outputSpace), via };
      S.status = 'Collected ' + res.samples.length + ' result(s) in ' + Math.round(res.ms / 100) / 10 + 's.';
    }).catch(err => { S.error = err && err.message ? err.message : String(err); })
      .then(() => { S.sampling = false; draw(); });
  }
  function exportSection(parent) {
    const p = S.project, a = S.analysis;
    const budget = E('input', { class: 'wc-field', type: 'number', min: '2000', max: '400000', step: '1000', value: S.budget, 'aria-label': 'Context size in characters', style: { width: '120px' } });
    budget.addEventListener('change', () => { S.budget = Math.max(2000, Math.min(400000, Math.floor(+budget.value) || 60000)); S.pack = ''; draw(); });
    row(parent, [
      btn('Download ZIP bundle', () => {
        const files = P.bundleFiles(p, a); download(P.fileSafe(p.name) + '-' + P.stamp().slice(0, 10) + '.zip', P.zip(files), 'application/zip');
        notice('Saved a ZIP with ' + files.length + ' file(s).');
      }, { accent: true, title: 'Lists panel, HTML panel, every import’s source, a README with findings, and a manifest.' }),
      btn('Download Markdown', () => download(P.fileSafe(p.name) + '.md', P.toMarkdown(p, a), 'text/markdown')),
      btn('Download DSL', () => download(P.fileSafe(p.name) + '-lists.txt', p.dsl), { mini: true }),
      p.html != null ? btn('Download HTML', () => download(P.fileSafe(p.name) + '.html', p.html, 'text/html'), { mini: true }) : null
    ]);
    parent.appendChild(E('div', { class: 'wc-subhead', style: { marginTop: '10px' }, text: 'AI context pack' }));
    note(parent, 'A prompt-ready summary of this generator that fits your model. Big HTML panels are reduced to a structural map.');
    row(parent, [E('span', { text: 'Size (characters)' }), budget, btn('Build pack', () => { S.pack = P.aiPack(p, a, { budget: S.budget }); draw(); }, { mini: true })]);
    if (S.pack) {
      const k = S.pack;
      note(parent, k.length + ' characters, about ' + k.approxTokens + ' tokens.' + (k.dropped.length ? ' Reduced: ' + k.dropped.join('; ') + '.' : ''));
      const box = E('textarea', { class: 'wc-field', rows: '6', readonly: 'readonly', 'aria-label': 'Context pack' }); box.value = k.text; parent.appendChild(box);
      row(parent, [btn('Copy pack', () => copy(k.text)), btn('Use in AI helper', () => { confirmSendOrThrow(); H.openAI('', 'pack'); }, { title: 'Opens the AI helper with this pack as context. Nothing is sent until you press Ask.' })]);
    }
  }
  function historySection(parent) {
    const list = S.history;
    if (!list) return note(parent, 'Loading…');
    note(parent, 'Every time you analyze a generator and its source differs from the last copy, Weld keeps a snapshot here (newest ' + 20 + ') until you reload or close this tab. Nothing is stored; use Download to keep one.');
    if (S.diff) return diffView(parent);
    if (!list.length) return note(parent, 'No snapshots yet.');
    list.forEach((h, i) => {
      const same = S.project && h.key === P.hash(S.project.dsl) + '|' + P.hash(S.project.html);
      parent.appendChild(E('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--wc-line,#2a2a2a)' } }, [
        E('span', { style: { flex: '1', minWidth: '160px' }, text: new Date(h.t).toLocaleString() + '  ·  ' + h.source + '  ·  ' + kb(P.bytes(h.dsl) + P.bytes(h.html)) + (same ? '  ·  current' : '') }),
        btn('Compare', () => { S.diff = { id: h.id, t: h.t }; draw(); }, { mini: true, disabled: !S.project || same, title: 'Show what changed between this snapshot and what is loaded now.' }),
        btn('Restore', () => {
          if (!H.isEdit()) throw new Error('Open the editor to restore a snapshot.');
          if (!window.confirm('Replace the editor contents with the snapshot from ' + new Date(h.t).toLocaleString() + '?\n\nYou can undo with Ctrl+Z, and still need to Save.')) return;
          notice(H.apply(h.dsl, h.html) ? 'Restored into the editor. Review it, then Save.' : 'Could not write to the editor.');
        }, { mini: true, disabled: !H.isEdit() }),
        btn('Download', () => download(P.fileSafe(S.slug) + '-' + P.stamp(h.t).slice(0, 19) + '.md', P.toMarkdown({ name: S.slug, dsl: h.dsl, html: h.html, source: h.source }, null), 'text/markdown'), { mini: true })
      ]));
    });
    row(parent, [btn('Delete all snapshots', () => {
      store.clearSnapshots(S.slug).then(() => { S.history = []; draw(); });
    }, { mini: true })]);
  }
  function diffView(parent) {
    const h = (S.history || []).find(x => x.id === S.diff.id);
    if (!h || !S.project) { S.diff = null; return; }
    row(parent, [btn('← Back to list', () => { S.diff = null; draw(); }, { mini: true }), E('span', { text: 'Snapshot from ' + new Date(h.t).toLocaleString() + '  →  loaded now. − only in the snapshot, + only now.' })]);
    [['Lists panel', h.dsl, S.project.dsl], ['HTML panel', h.html || '', S.project.html || '']].forEach(([title, before, after]) => {
      const d = H.diff(before, after);
      parent.appendChild(E('div', { class: 'wc-subhead', style: { marginTop: '8px' }, text: title + (d.stats.add + d.stats.del ? '  (+' + d.stats.add + ' −' + d.stats.del + ')' : '  (identical)') }));
      if (!d.stats.add && !d.stats.del) return;
      const box = E('div', { style: { font: '12px/1.45 ui-monospace,Menlo,Consolas,monospace', border: '1px solid var(--wc-line,#333)', borderRadius: '8px', overflow: 'auto', maxHeight: '40vh', marginTop: '4px' } });
      d.rows.forEach(rw => {
        const bg = rw.cls === 'add' ? 'rgba(63,185,80,0.16)' : rw.cls === 'del' ? 'rgba(248,81,73,0.16)' : 'transparent';
        box.appendChild(E('div', { style: { display: 'flex', gap: '8px', padding: '0 8px', background: bg, whiteSpace: 'pre-wrap', wordBreak: 'break-word', opacity: rw.cls === 'gap' ? '0.6' : '1' } }, [
          E('span', { style: { width: '40px', textAlign: 'right', opacity: '0.5', flex: '0 0 auto' }, text: rw.num != null ? String(rw.num) : '' }),
          E('span', { style: { width: '10px', flex: '0 0 auto' }, text: rw.cls === 'add' ? '+' : rw.cls === 'del' ? '−' : '' }), E('span', { text: rw.text == null ? '' : rw.text })]));
      });
      parent.appendChild(box);
    });
  }
  function starredSection(parent) {
    const names = H.favorites();
    if (!names.length) return note(parent, 'Star generators in the Generators tab to watch them for changes here.');
    note(parent, 'Checks the last-edited time of your ' + names.length + ' starred generator(s) through Perchance’s public stats. The first check records a baseline.');
    row(parent, [btn('Check for changes', checkStarred, { accent: true, disabled: S.loading }), S.starred && S.starred.some(x => x.changed) ? btn('Mark all as seen', () => {
      const seen = H.get(SEEN_KEY, {}) || {}; S.starred.forEach(x => { if (x.t) seen[x.name] = x.t; }); H.set(SEEN_KEY, seen);
      S.starred.forEach(x => { x.changed = false; }); draw();
    }, { mini: true }) : null]);
    (S.starred || []).forEach(x => parent.appendChild(E('div', { style: { display: 'flex', gap: '8px', padding: '3px 0', alignItems: 'center' } }, [
      E('span', { style: { flex: '1', minWidth: '0' }, text: x.name }),
      E('span', { style: { fontSize: '12px', opacity: '0.7', color: x.changed ? '#d29922' : '' }, text: x.changed ? 'changed ' + ago(x.t) : x.t ? 'edited ' + ago(x.t) : 'unknown' }),
      btn('Open', () => go(x.name), { mini: true })
    ])));
  }
  function checkStarred() {
    const names = H.favorites(); S.loading = true; S.status = 'Checking ' + names.length + ' generator(s)…'; draw();
    H.statsMany(names, stats => {
      const seen = H.get(SEEN_KEY, {}) || {}, first = !Object.keys(seen).length;
      S.starred = names.map(n => {
        const t = stats && stats[n] ? +stats[n].lastEditTime || 0 : 0;
        const changed = !first && seen[n] != null && t > +seen[n];
        if (t && (first || seen[n] == null)) seen[n] = t;
        return { name: n, t, changed };
      });
      H.set(SEEN_KEY, seen); S.loading = false;
      S.status = first ? 'Baseline recorded. Check again later to see changes.' : (S.starred.filter(x => x.changed).length + ' of ' + names.length + ' changed since you last marked them seen.');
      draw();
    });
  }
  function searchSection(parent) {
    const input = E('input', { class: 'wc-field', type: 'text', placeholder: 'Search every generator you have analyzed…', 'aria-label': 'Search saved generators', value: S.search });
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { S.search = input.value; runSearch(); } });
    row(parent, [input, btn('Search', () => { S.search = input.value; runSearch(); }, { mini: true })]);
    if (!S.results) {
      note(parent, 'Searches the lists and HTML panels of the generators you analyzed in this tab.');
      row(parent, [btn('Forget all saved generators', () => {
        store.clearProjects().then(() => { notice('Saved copies deleted.'); draw(); });
      }, { mini: true })]);
      return;
    }
    if (!S.results.length) return note(parent, 'Nothing found.');
    S.results.forEach(r => parent.appendChild(E('div', { style: { padding: '3px 0', borderBottom: '1px solid var(--wc-line,#2a2a2a)', cursor: 'pointer' }, onclick: () => go(r.slug) }, [
      E('div', { style: { fontWeight: '600' }, text: r.slug + '  ·  ' + r.pane + ' line ' + r.line }), E('div', { style: { fontSize: '12px', opacity: '0.75', wordBreak: 'break-word' }, text: r.text })])));
  }
  function runSearch() {
    const term = S.search.trim().toLowerCase(); if (!term) { S.results = null; return draw(); }
    store.allProjects().then(all => {
      const out = [];
      all.forEach(rec => [['dsl', rec.dsl], ['html', rec.html]].forEach(([pane, text]) => {
        if (!text || out.length >= 60) return;
        const ls = P.lines(text);
        for (let i = 0; i < ls.length && out.length < 60; i++) if (ls[i].toLowerCase().includes(term)) out.push({ slug: rec.slug, pane, line: i + 1, text: ls[i].trim().slice(0, 160) });
      }));
      S.results = out; draw();
    });
  }

  // -------------------------------------------------------------------- render
  function render(parent) {
    boot();
    while (parent.firstChild) parent.removeChild(parent.firstChild);
    const wrap = E('div', { id: 'wc-project-body' });
    wrap.appendChild(E('label', { class: 'wc-label', text: 'Project' + (S.slug ? ' — ' + S.slug : '') }));
    if (!S.slug) { note(wrap, 'Open a generator to inspect it. The Project tab reads the generator you are on, in the editor or as published.'); parent.appendChild(wrap); return; }
    const editOk = H.isEdit() && !!H.live();
    row(wrap, [
      btn(S.loading ? 'Working…' : 'Analyze editor (live)', () => load('live'), { accent: editOk, disabled: S.loading || !editOk, title: editOk ? 'Reads your open editor, including unsaved edits. No network.' : 'Open the generator’s #edit page to use this.' }),
      btn('Fetch published + imports', () => load('published'), { accent: !editOk, disabled: S.loading, title: 'Downloads the saved lists, HTML panel and imports from Perchance’s public API.' })
    ]);
    if (S.project) wrap.appendChild(E('div', { class: 'wc-section-note', text: 'Source: ' + (S.project.source === 'editor' ? 'your editor (live)' : S.project.source === 'published' ? 'published on Perchance' : 'saved copy') + ' · ' + ago(S.project.fetchedAt) + (S.project.lastEditTime ? ' · last edited ' + ago(S.project.lastEditTime) : '') + (isPrivate() ? ' · marked private by its author' : '') }));
    if (S.status && !S.error) note(wrap, S.status);
    if (S.error) wrap.appendChild(E('div', { style: { color: '#e5534b', margin: '6px 0' }, text: '✖ ' + S.error }));
    const top = E('div', { class: 'wc-card', style: { marginTop: '8px' } }); summary(top); wrap.appendChild(top);
    if (S.analysis) {
      const a = S.analysis, p = S.project;
      section(wrap, 'findings', 'Findings', a.counts.error + a.counts.warn + ' to review, ' + a.counts.info + ' notes', body => findingsSection(body), true);
      section(wrap, 'outline', 'Outline', a.lists.length + ' lists, ' + a.functions.length + ' functions', body => outlineSection(body));
      section(wrap, 'deps', 'Imports and dependencies', p.deps ? P.dependencyStats(p.deps, p.name).count + ' pulled in' + (S.drift && S.drift.any ? ' · CHANGED' : '') : a.imports.length + ' named', body => depsSection(body));
      section(wrap, 'assets', 'Assets, hosts and storage', a.html ? a.html.hosts.length + ' host(s)' : 'HTML not loaded', body => assetsSection(body));
      section(wrap, 'sample', 'Sample the output', S.samples ? S.samples.stats.n + ' results' : '', body => samplingSection(body));
      section(wrap, 'export', 'Export and AI context', '', body => exportSection(body));
    }
    section(wrap, 'history', 'Snapshots', S.history ? S.history.length : '', body => historySection(body));
    section(wrap, 'starred', 'Starred generators: changes', S.starred ? S.starred.filter(x => x.changed).length + ' changed' : '', body => starredSection(body));
    section(wrap, 'search', 'Search saved generators', '', body => searchSection(body));
    parent.appendChild(wrap);
  }
  window.weldProject = {
    render,
    // Download a generator's published lists, HTML and imports without changing what the tab shows.
    fetchPublished,
    // Source currently loaded for this generator (editor first), for the AI helper.
    current() {
      const slug = H.slug(); if (!slug) return null;
      const live = H.isEdit() ? H.live() : null;
      if (live && live.dsl != null) return { name: slug, dsl: live.dsl, html: live.html, source: 'editor', deps: S.project && S.project.name === slug ? S.project.deps : null };
      if (S.project && S.project.name === slug) return S.project;
      return null;
    },
    pack(budget) {
      const p = window.weldProject.current(); if (!p) return null;
      return P.aiPack(p, S.project && S.project.name === p.name && p.source !== 'editor' ? S.analysis : null, { budget: budget || S.budget });
    },
    state: S
  };
})();
