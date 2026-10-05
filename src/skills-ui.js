/* Skills tab: reviewable generator presets routed to Perchance's native AI input. */
(function () {
  'use strict';
  if (window.top !== window) return;
  const C = window.WeldSkillsCore, H = window.weldProjectHost;
  if (!C || !H) return;
  const E = H.el, FAVORITES_KEY = 'skillsFavorites';
  const stored = H.get(FAVORITES_KEY, []);
  const S = { slug: null, selected: 'dashboard-architecture', query: '', category: '', type: '', mode: '', favoritesOnly: false,
    expanded: new Set(), concise: false,
    favorites: Array.isArray(stored) ? stored.filter(id => C.get(id)) : [], details: '', findings: false, draft: '', dirty: false };
  const note = text => E('div', { class: 'wc-section-note', text });
  const fieldStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid var(--wc-line,#555)', borderRadius: '8px',
    padding: '10px', background: 'var(--wc-input,rgba(0,0,0,.18))', color: 'inherit', font: 'inherit' };
  function render(parent) {
    const slug = H.slug() || '';
    if (S.slug !== slug) {
      S.slug = slug; S.details = ''; S.findings = false; S.draft = ''; S.dirty = false;
    }
    while (parent.firstChild) parent.removeChild(parent.firstChild);
    const wrap = E('div', { id: 'wc-skills-body' });
    let prompt, send, copy, status, list, count, detail;
    function message(text, error) { status.textContent = text; status.style.color = error ? '#ff9e92' : ''; }
    function ready() {
      send.disabled = !slug || !H.isEdit() || !S.draft.trim() || S.dirty;
      copy.disabled = !S.draft.trim() || S.dirty;
    }
    function dirty() { S.dirty = true; ready(); message('Details changed. Select Build prompt to include them.'); }
    function build() {
      try {
        const options = { slug, details: S.details, type: S.type, concise: S.concise };
        if (S.findings) {
          const P = window.WeldProjectCore, live = H.live();
          if (!P || !live || live.dsl == null) throw new Error('Live analysis is unavailable. Open the editor or turn off Include live findings.');
          options.findings = P.analyze({ name: slug, dsl: live.dsl, html: live.html }).findings;
        }
        S.draft = C.buildPrompt(S.selected, options); S.dirty = false; prompt.value = S.draft;
        message(S.findings ? 'Prompt built with current editor findings. Review it below.' : 'Prompt ready. Review or edit it below.');
      } catch (e) { S.dirty = true; message(e.message || String(e), true); }
      ready();
    }
    function drawList() {
      while (list.firstChild) list.removeChild(list.firstChild);
      const matches = C.search(S.query, S.category, S.favoritesOnly ? S.favorites : null, { type: S.type, mode: S.mode });
      const groups = C.group(matches);
      count.textContent = matches.length + ' of ' + C.presets.length + ' skills in ' + groups.length + ' sections';
      if (!matches.length) { list.appendChild(note('No matching skills. Try another search or turn off Favorites only.')); return; }
      groups.forEach(g => {
        const autoExpand = Boolean(S.query || S.category || S.type || S.mode || S.favoritesOnly);
        const attrs = { 'data-section': g.id, style: { border: '1px solid var(--wc-line,#555)', borderRadius: '9px', padding: '10px' } };
        if (autoExpand || S.expanded.has(g.id)) attrs.open = '';
        const section = E('details', attrs);
        section.addEventListener('toggle', () => {
          if (autoExpand) return; // Filter expansion must not overwrite the user's section choices.
          if (section.open) S.expanded.add(g.id); else S.expanded.delete(g.id);
        });
        section.appendChild(E('summary', { text: g.title + ' (' + g.presets.length + ')',
          style: { cursor: 'pointer', fontWeight: '600', padding: '4px 0', minHeight: '24px' } }));
        section.appendChild(note(g.description));
        const grid = E('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,210px),1fr))', gap: '8px', marginTop: '10px' } });
        g.presets.forEach(p => {
        const active = p.id === S.selected;
        grid.appendChild(E('button', { type: 'button', 'data-skill': p.id, 'aria-pressed': String(active),
          style: { textAlign: 'left', padding: '12px', borderRadius: '9px', cursor: 'pointer', color: 'inherit', font: 'inherit',
            border: active ? '1px solid var(--wc-accent,#f39245)' : '1px solid var(--wc-line,#555)',
            background: active ? 'rgba(243,146,69,.12)' : 'rgba(255,255,255,.035)' },
          onclick: () => { S.selected = p.id; drawList(); drawDetail(); build(); if (detail.scrollIntoView) detail.scrollIntoView({ block: 'nearest' }); }
        }, [E('strong', { text: (S.favorites.includes(p.id) ? '\u2605 ' : '') + p.title }),
          E('div', { text: p.description, style: { fontSize: '12px', opacity: '.8', marginTop: '5px', lineHeight: '1.5' } }),
          E('div', { text: p.mode === 'review' ? 'Review only' : 'Makes changes', style: { fontSize: '11px', opacity: '.65', marginTop: '7px' } })]));
        });
        section.appendChild(grid); list.appendChild(section);
      });
    }
    function drawDetail() {
      while (detail.firstChild) detail.removeChild(detail.firstChild);
      const p = C.get(S.selected), favored = S.favorites.includes(p.id);
      detail.appendChild(E('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' } }, [
        E('h3', { text: p.title, style: { margin: '0', fontSize: '17px' } }),
        E('button', { type: 'button', class: 'wc-btn wc-mini', text: favored ? 'Remove favorite' : 'Save favorite',
          'aria-pressed': String(favored), onclick: () => {
            const next = favored ? S.favorites.filter(id => id !== p.id) : S.favorites.concat(p.id);
            try {
              if (H.set(FAVORITES_KEY, next) === false) throw new Error('Could not save favorite.');
              S.favorites = next; drawDetail(); drawList();
            } catch (e) { message(e.message || String(e), true); }
          } })]));
      detail.appendChild(note((p.mode === 'review' ? 'Review only: ' : 'Makes changes: ') + p.description));
      detail.appendChild(note('Fits: ' + (p.types.length ? p.types.map(id => C.types.find(t => t.id === id).title).join(', ') : 'All generator and application types')));
      const workflow = E('details', { 'aria-label': 'Skill workflow' }, [E('summary', { text: 'Workflow & acceptance checks', style: { cursor: 'pointer', padding: '8px 0' } }),
        note(p.task),
        E('ol', {}, p.steps.map(step => E('li', { text: step, style: { marginBottom: '6px' } }))), note('Acceptance: ' + p.check)]);
      detail.appendChild(workflow);
      if (p.sources.length) {
        const origin = E('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '12px', margin: '8px 0' } }, [E('span', { text: 'Research & references:' })]);
        p.sources.forEach(id => {
          const source = C.sources.find(s => s.id === id);
          origin.appendChild(E('a', { text: source.title, href: source.url, target: '_blank', rel: 'noopener noreferrer',
            title: source.path || source.title, style: { color: 'var(--wc-accent,#f39245)' } }));
        });
        detail.appendChild(origin);
      }
    }
    wrap.appendChild(E('h2', { text: 'Skills library', style: { margin: '0 0 8px', fontSize: '20px' } }));
    wrap.appendChild(note('Build and improve full Perchance applications: dashboards, tools, AI experiences, stories and games. Choose a task, review the prompt, then hand it to the native AI helper.'));
    wrap.appendChild(note(slug ? 'Current generator: ' + slug : 'Open a generator to use native AI. You can still browse and copy prompts here.'));
    if (!H.isEdit()) wrap.appendChild(note('Open this generator in the editor (#edit) to send skills to its AI helper.'));
    const search = E('input', { type: 'search', placeholder: 'Search tasks: Binance, data feeds, charts, mobile, bugs...', 'aria-label': 'Search skills', style: fieldStyle });
    search.value = S.query; search.addEventListener('input', () => { S.query = search.value; drawList(); });
    const category = E('select', { 'aria-label': 'Skill category', style: Object.assign({}, fieldStyle, { width: 'auto', flex: '1', minWidth: '170px' }) },
      [E('option', { value: '', text: 'All categories' })].concat(C.categories.map(c => E('option', { value: c.id, text: c.title }))));
    category.value = S.category; category.addEventListener('change', () => { S.category = category.value; drawList(); });
    const fav = E('input', { type: 'checkbox', 'aria-label': 'Favorites only' }); fav.checked = S.favoritesOnly;
    fav.addEventListener('change', () => { S.favoritesOnly = fav.checked; drawList(); });
    const type = E('select', { 'aria-label': 'Generator type', style: fieldStyle },
      [E('option', { value: '', text: 'All generator & app types' })].concat(C.types.map(t => E('option', { value: t.id, text: t.title }))));
    type.value = S.type; type.addEventListener('change', () => { S.type = type.value; drawList(); dirty(); });
    const mode = E('select', { 'aria-label': 'Task mode', style: fieldStyle }, [E('option', { value: '', text: 'Review & implementation' }),
      E('option', { value: 'review', text: 'Review only' }), E('option', { value: 'change', text: 'Make changes' })]);
    mode.value = S.mode; mode.addEventListener('change', () => { S.mode = mode.value; drawList(); });
    wrap.appendChild(E('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '12px 0' } },
      [['dashboard-architecture', 'Plan dashboard'], ['create-dashboard', 'Build an app'], ['fix-bugs', 'Fix problems'], ['custom-feature', 'Add a feature'], ['lorebook-builder', 'Build lorebook'], ['skybridge-integrate', 'Connect Skybridge'], ['ai-input-assist', 'Rewrite & Fill buttons'], ['card-spec-export', 'Tavern card export']].map(([id, title]) =>
        E('button', { type: 'button', class: 'wc-btn wc-mini', text: title, onclick: () => {
          S.selected = id; S.query = ''; S.category = ''; S.type = ''; S.mode = ''; S.favoritesOnly = false;
          search.value = ''; category.value = ''; type.value = ''; mode.value = ''; fav.checked = false;
          S.expanded.add(C.get(id).category); drawList(); drawDetail(); build();
        } }))));
    wrap.appendChild(search);
    wrap.appendChild(E('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,190px),1fr))', gap: '8px', marginTop: '8px' } }, [type, mode]));
    wrap.appendChild(E('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px', margin: '10px 0' } }, [category,
      E('label', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [fav, E('span', { text: 'Favorites only' })])]));
    count = E('div', { style: { fontSize: '12px', opacity: '.7', marginBottom: '8px' }, 'aria-live': 'polite' }); wrap.appendChild(count);
    list = E('div', { 'aria-label': 'Skill presets', style: { display: 'grid', gap: '8px', maxHeight: '380px', overflowY: 'auto', padding: '2px' } }); wrap.appendChild(list);
    detail = E('div', { style: { borderTop: '1px solid var(--wc-line,#555)', marginTop: '18px', paddingTop: '16px' } }); wrap.appendChild(detail);
    wrap.appendChild(E('label', { for: 'wc-skill-details', text: 'Your goal or extra instructions (optional)' }));
    const details = E('textarea', { id: 'wc-skill-details', rows: '3', placeholder: 'What should change? Any style, feature or behavior to preserve?',
      style: Object.assign({}, fieldStyle, { marginTop: '6px', resize: 'vertical' }) });
    details.value = S.details; details.addEventListener('input', () => { S.details = details.value; dirty(); }); wrap.appendChild(details);
    const findings = E('input', { type: 'checkbox', 'aria-label': 'Include live findings' }); findings.checked = S.findings;
    findings.addEventListener('change', () => { S.findings = findings.checked; dirty(); });
    wrap.appendChild(E('label', { style: { display: 'flex', alignItems: 'center', gap: '7px', margin: '10px 0' } },
      [findings, E('span', { text: 'Include live findings (analyzed when you build the prompt)' })]));
    const concise = E('input', { type: 'checkbox', 'aria-label': 'Concise helper replies' }); concise.checked = S.concise;
    concise.addEventListener('change', () => { S.concise = concise.checked; dirty(); });
    wrap.appendChild(E('label', { style: { display: 'flex', alignItems: 'center', gap: '7px', margin: '10px 0' } },
      [concise, E('span', { text: 'Concise helper replies (keep complete code & evidence)' })]));
    wrap.appendChild(E('button', { type: 'button', class: 'wc-btn', text: 'Build prompt', onclick: build }));
    wrap.appendChild(E('label', { for: 'wc-skill-prompt', text: 'Instructions to send (editable)', style: { display: 'block', marginTop: '14px' } }));
    prompt = E('textarea', { id: 'wc-skill-prompt', rows: '9', style: Object.assign({}, fieldStyle, { margin: '6px 0 10px', resize: 'vertical', fontSize: '12px', lineHeight: '1.5' }) });
    prompt.value = S.draft; prompt.addEventListener('input', () => { S.draft = prompt.value; ready(); }); wrap.appendChild(prompt);
    send = E('button', { type: 'button', class: 'wc-btn wc-primary', text: 'Send to Perchance AI', onclick: () => {
      try {
        if (S.dirty) throw new Error('Build the prompt first to include your changed details.');
        if (H.slug() !== slug || !H.isEdit()) throw new Error('The generator changed. Reopen Skills in its editor.');
        if (typeof H.openPerchanceAI !== 'function') throw new Error('Native AI connection is unavailable. Update the complete Weld userscript.');
        if (H.openPerchanceAI(S.draft) !== true) throw new Error('Perchance did not confirm the AI handoff. Open its helper and try again.');
      } catch (e) { message(e.message || String(e), true); }
    } });
    copy = E('button', { type: 'button', class: 'wc-btn', text: 'Copy prompt', onclick: async () => {
      try {
        const copied = await H.copy(S.draft);
        message(copied === true ? 'Prompt copied.' : 'Clipboard unavailable. Select the instructions and copy them manually.', copied !== true);
      } catch (e) { message(e.message || String(e), true); }
    } });
    wrap.appendChild(E('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } }, [send, copy]));
    status = E('div', { role: 'status', 'aria-live': 'polite', style: { marginTop: '10px', fontSize: '12px' } }); wrap.appendChild(status);
    parent.appendChild(wrap); drawList(); drawDetail();
    if (!S.draft) build(); else { ready(); message(S.dirty ? 'Details changed. Select Build prompt to include them.' : 'Your edited prompt is preserved for this page session.'); }
  }
  window.weldSkills = { render };
})();
