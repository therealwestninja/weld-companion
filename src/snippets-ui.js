/* Snippets tab: a file-tree of code snippets (drop into the editor) and AI-Helper skills
   (load a ready-to-send prompt into the AI Helper's input). Click a leaf to use it. */
(function () {
  'use strict';
  if (window.top !== window) return;
  const C = window.WeldSnippetsCore, H = window.weldProjectHost;
  if (!C || !H) return;
  const E = H.el;
  const note = text => E('div', { class: 'wc-section-note', text });
  const S = { query: '', expanded: null };   // expanded: Set of folder ids; null = default (top folders open)

  function defaultExpanded() { return new Set(C.tree().children.map(f => f.id)); }
  function badge(text, color) { return E('span', { text: text, style: { fontSize: '10px', fontFamily: 'var(--wc-mono,monospace)', opacity: '.85', padding: '1px 6px', borderRadius: '6px', border: '1px solid var(--wc-line,#555)', color: color || 'inherit', whiteSpace: 'nowrap' } }); }

  function useCode(node) {
    return H.insertSnippet(node.pane, node.text, node.name);   // host toasts on its own
  }

  function leafRow(node, depth) {
    const row = E('div', { 'data-leaf': node.id, role: 'button', tabindex: '0',
      style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', paddingLeft: (depth * 16 + 8) + 'px', borderRadius: '7px', cursor: 'pointer' },
      onclick: () => useCode(node),
      title: 'Insert at the cursor in the ' + (node.pane === 'html' ? 'HTML' : 'DSL') + ' panel' });
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); useCode(node); } });
    row.addEventListener('mouseenter', () => { row.style.background = 'var(--wc-surface-3,rgba(255,255,255,.06))'; });
    row.addEventListener('mouseleave', () => { row.style.background = ''; });
    row.appendChild(E('span', { text: '\u{1F4C4}', style: { flex: '0 0 auto' } }));
    row.appendChild(E('div', { style: { flex: '1', minWidth: '0' } }, [
      E('div', { text: node.name, style: { fontWeight: '600', fontSize: '13px' } }),
      node.desc ? E('div', { text: node.desc, class: 'wc-section-note', style: { margin: '1px 0 0' } }) : null
    ]));
    row.appendChild(badge(node.pane === 'html' ? 'HTML' : 'DSL', 'var(--wc-signal,#4ee0c8)'));
    return row;
  }

  function folderRow(node, depth, onToggle, open) {
    const head = E('div', { 'data-folder': node.id, role: 'button', tabindex: '0',
      style: { display: 'flex', alignItems: 'center', gap: '7px', padding: '7px 8px', paddingLeft: (depth * 16 + 4) + 'px', borderRadius: '7px', cursor: 'pointer', fontWeight: '600' },
      onclick: onToggle });
    head.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } });
    head.appendChild(E('span', { text: open ? '▾' : '▸', style: { flex: '0 0 auto', opacity: '.7', width: '12px' } }));
    if (node.glyph) head.appendChild(E('span', { text: node.glyph, style: { flex: '0 0 auto' } }));
    head.appendChild(E('span', { text: node.name, style: { flex: '1' } }));
    const kids = (node.children || []).filter(c => !C.isFolder(c)).length + '/' + (node.children || []).length;
    head.appendChild(E('span', { text: (node.children || []).length ? String((node.children || []).length) : '', class: 'wc-section-note', style: { margin: '0' } }));
    return head;
  }

  function renderNode(node, depth, into) {
    if (!C.isFolder(node)) { into.appendChild(leafRow(node, depth)); return; }
    const open = expandedSet().has(node.id);
    into.appendChild(folderRow(node, depth, () => { toggle(node.id); }, open));
    if (node.note && open && depth === 0) into.appendChild(E('div', { class: 'wc-section-note', style: { paddingLeft: ((depth + 1) * 16 + 8) + 'px', margin: '0 0 4px' }, text: node.note }));
    if (open) node.children.forEach(c => renderNode(c, depth + 1, into));
  }

  function expandedSet() { if (!S.expanded) S.expanded = defaultExpanded(); return S.expanded; }
  let mountParent = null;
  function toggle(id) { const s = expandedSet(); if (s.has(id)) s.delete(id); else s.add(id); if (mountParent) render(mountParent); }

  function render(parent) {
    mountParent = parent;
    while (parent.firstChild) parent.removeChild(parent.firstChild);
    const wrap = E('div', { id: 'wc-snippets-body' });
    wrap.appendChild(E('h2', { text: 'Code snippets', style: { margin: '0 0 6px', fontSize: '20px' } }));
    const c = C.counts();
    wrap.appendChild(note('A tree of ' + c.code + ' ready-to-paste Perchance code snippets. Click one to drop it at your cursor in the matching editor pane. (AI prompt-skills now live in the Skills tab.)'));

    const search = E('input', { type: 'search', placeholder: 'Filter snippets…', 'aria-label': 'Filter', style: { width: '100%', boxSizing: 'border-box', border: '1px solid var(--wc-line,#555)', borderRadius: '8px', padding: '9px', background: 'var(--wc-input,rgba(0,0,0,.18))', color: 'inherit', font: 'inherit', margin: '10px 0 8px' } });
    search.value = S.query;
    search.addEventListener('input', () => { S.query = search.value; render(parent); });
    wrap.appendChild(search);

    const treeEl = E('div', { 'aria-label': 'Snippets and skills tree', style: { border: '1px solid var(--wc-line,#555)', borderRadius: '10px', padding: '6px', maxHeight: '460px', overflow: 'auto' } });
    const root = S.query.trim() ? C.search(S.query) : C.tree();
    // When filtering, force every surviving folder open so matches are visible.
    if (S.query.trim()) { const all = C.walk(root).filter(C.isFolder).map(f => f.id); S.expanded = new Set(all); }
    if (!root.children.length) treeEl.appendChild(note('No snippets or skills match “' + S.query + '”.'));
    else root.children.forEach(f => renderNode(f, 0, treeEl));
    wrap.appendChild(treeEl);

    if (!H.slug || !H.isEdit || !H.isEdit()) wrap.appendChild(note('Open a generator’s #edit page to insert snippets at the cursor.'));
    parent.appendChild(wrap);
    // Restore default expansion after a filter is cleared.
    if (!S.query.trim() && S.expanded && S.expanded.size === 0) S.expanded = defaultExpanded();
  }

  window.weldSnippets = { render };
})();
