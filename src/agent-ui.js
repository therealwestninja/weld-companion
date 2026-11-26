/* Agents tab: pick a named agent and run it against the CURRENT generator. The agent uses
   your own AI model to plan, run read-only lookups (dev-core's investigate loop), and report.
   Agents never change a generator. Custom agents are stored locally. */
(function () {
  'use strict';
  if (window.top !== window) return;
  const A = window.WeldAgentCore, D = window.WeldDevCore, H = window.weldProjectHost;
  if (!A || !D || !H) return;
  const E = H.el, AGENTS_KEY = 'agents';
  const note = text => E('div', { class: 'wc-section-note', text });
  const LINE = '1px solid var(--wc-line,#555)';
  const fieldStyle = { width: '100%', boxSizing: 'border-box', border: LINE, borderRadius: '8px', padding: '9px', background: 'var(--wc-input,rgba(0,0,0,.18))', color: 'inherit', font: 'inherit' };

  // Module-level so the tab survives re-render (selection, transcript, a running job).
  const S = { selectedId: null, input: '', run: null, editing: null };

  function storedAgents() { const v = H.get(AGENTS_KEY, []); return Array.isArray(v) ? v : []; }
  function allAgents() { return A.mergeAgents(storedAgents()); }
  function saveCustom(list) { return H.set(AGENTS_KEY, list); }
  function currentProject() { try { return (window.weldProject && window.weldProject.current && window.weldProject.current()) || null; } catch (e) { return null; } }

  function render(parent) {
    while (parent.firstChild) parent.removeChild(parent.firstChild);
    const agents = allAgents();
    if (!S.selectedId || !agents.some(a => a.id === S.selectedId)) S.selectedId = agents[0] ? agents[0].id : null;
    const wrap = E('div', { id: 'wc-agents-body' });

    wrap.appendChild(E('h2', { text: 'Agents', style: { margin: '0 0 8px', fontSize: '20px' } }));
    wrap.appendChild(note('Give an agent a job on the current generator. It uses your AI model to look things up (read-only) and report back. Agents never change a generator — they investigate and advise.'));

    const slug = H.slug() || '';
    wrap.appendChild(note(slug ? 'Current generator: ' + slug : 'Open a generator — agents read the one you are viewing.'));
    if (!H.aiReady || !H.aiReady()) wrap.appendChild(note('⚠ Agents need your own AI model. Pick OpenAI / Anthropic / Google or a local model in the Tools tab first.'));
    if (!currentProject()) wrap.appendChild(note('⚠ No generator analysis is loaded yet. Open a generator (and its editor for the fullest view) so agents have something to read.'));

    // ---- agent picker ----
    const listWrap = E('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: '8px', margin: '12px 0' } });
    agents.forEach(a => {
      const active = a.id === S.selectedId;
      listWrap.appendChild(E('button', { type: 'button', 'data-agent': a.id, 'aria-pressed': String(active),
        style: { textAlign: 'left', padding: '11px', borderRadius: '9px', cursor: 'pointer', color: 'inherit', font: 'inherit',
          border: active ? '1px solid var(--wc-accent,#f39245)' : LINE, background: active ? 'rgba(243,146,69,.12)' : 'rgba(255,255,255,.035)' },
        onclick: () => { S.selectedId = a.id; S.editing = null; render(parent); } }, [
        E('strong', { text: a.glyph + ' ' + a.name }),
        E('div', { text: a.goal || '(no default goal)', style: { fontSize: '12px', opacity: '.8', marginTop: '5px', lineHeight: '1.5' } }),
        E('div', { text: (a.builtin ? 'Built-in' : 'Custom') + ' · ' + a.tools.length + ' tool' + (a.tools.length === 1 ? '' : 's'), style: { fontSize: '11px', opacity: '.6', marginTop: '6px' } })
      ]));
    });
    wrap.appendChild(listWrap);
    wrap.appendChild(E('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
      E('button', { type: 'button', class: 'wc-btn wc-mini', text: '+ New agent', onclick: () => { S.editing = A.normalizeAgent({ name: '', role: '', tools: [] }); S.editing.id = ''; render(parent); } })
    ]));

    const selected = agents.find(a => a.id === S.selectedId) || null;
    if (S.editing) { wrap.appendChild(buildEditor(parent)); parent.appendChild(wrap); return; }
    if (selected) wrap.appendChild(buildRunner(parent, selected));
    parent.appendChild(wrap);
  }

  function buildRunner(parent, agent) {
    const box = E('div', { style: { borderTop: LINE, marginTop: '16px', paddingTop: '14px' } });
    box.appendChild(E('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' } }, [
      E('h3', { text: agent.glyph + ' ' + agent.name, style: { margin: '0', fontSize: '16px' } }),
      E('div', { style: { display: 'flex', gap: '6px' } }, [
        E('button', { type: 'button', class: 'wc-btn wc-mini', text: agent.builtin ? 'Duplicate' : 'Edit', onclick: () => {
          S.editing = A.normalizeAgent(agent);
          if (agent.builtin) { S.editing.id = ''; S.editing.name = agent.name + ' (copy)'; S.editing.builtin = false; }
          render(parent);
        } }),
        agent.builtin ? null : E('button', { type: 'button', class: 'wc-btn wc-mini', text: 'Delete', onclick: () => {
          const next = storedAgents().filter(a => A.normalizeAgent(a).id !== agent.id);
          if (saveCustom(next) === false) { H.toast && H.toast('Could not delete the agent'); return; }
          S.selectedId = null; S.editing = null; render(parent);
        } })
      ])
    ]));
    const role = E('details', {}, [E('summary', { text: 'Role & tools', style: { cursor: 'pointer', padding: '6px 0', fontSize: '12px' } }),
      E('div', { class: 'wc-section-note', style: { whiteSpace: 'pre-wrap' }, text: agent.role }),
      E('div', { class: 'wc-section-note', style: { marginTop: '6px' }, text: 'Tools: ' + agent.tools.join(', ') + ' · up to ' + agent.maxRounds + ' lookup rounds' })]);
    box.appendChild(role);

    box.appendChild(E('label', { for: 'wc-agent-input', text: 'What should it do? (optional — refines the agent’s goal)', style: { display: 'block', marginTop: '12px', fontSize: '13px' } }));
    const input = E('textarea', { id: 'wc-agent-input', rows: '3', placeholder: agent.goal || 'Describe the task for this agent...', style: Object.assign({}, fieldStyle, { marginTop: '6px', resize: 'vertical' }) });
    input.value = S.input; input.addEventListener('input', () => { S.input = input.value; });
    box.appendChild(input);

    const running = !!(S.run && S.run.agentId === agent.id && S.run.busy);
    const runBtn = E('button', { type: 'button', class: 'wc-btn wc-primary', text: running ? 'Running…' : 'Run agent', disabled: running ? '' : undefined,
      onclick: () => startRun(parent, agent) });
    const stopBtn = E('button', { type: 'button', class: 'wc-btn', text: 'Stop', disabled: running ? undefined : '', onclick: () => stopRun(parent) });
    box.appendChild(E('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } }, [runBtn, stopBtn]));

    box.appendChild(buildTranscript(agent));
    return box;
  }

  function buildTranscript(agent) {
    const t = E('div', { id: 'wc-agent-transcript', style: { marginTop: '12px' } });
    const run = (S.run && S.run.agentId === agent.id) ? S.run : null;
    if (!run) { t.appendChild(note('No run yet. Press Run agent.')); return t; }
    if (run.steps.length) {
      t.appendChild(E('div', { class: 'wc-section-note', style: { marginBottom: '4px' }, text: 'Lookups:' }));
      run.steps.forEach((s, i) => t.appendChild(E('div', { style: { fontSize: '12px', opacity: '.8', fontFamily: 'var(--wc-mono,monospace)' }, text: (i + 1) + '. ' + s })));
    }
    if (run.busy) t.appendChild(E('div', { class: 'wc-section-note', style: { marginTop: '6px', color: 'var(--wc-accent,#f39245)' }, text: run.status || 'Thinking…' }));
    if (run.error) t.appendChild(E('div', { style: { marginTop: '8px', color: '#ff9e92', fontSize: '13px', whiteSpace: 'pre-wrap' }, text: '✗ ' + run.error }));
    if (run.reply) {
      t.appendChild(E('div', { style: { borderTop: LINE, marginTop: '10px', paddingTop: '10px' } }, [
        E('div', { class: 'wc-section-note', style: { marginBottom: '6px' }, text: run.exhausted ? 'Answer (the agent hit its lookup limit):' : 'Answer:' }),
        // text node, never innerHTML: the reply is model output and is rendered as plain, escaped text.
        E('div', { style: { whiteSpace: 'pre-wrap', fontSize: '13px', lineHeight: '1.55' }, text: run.reply })
      ]));
      t.appendChild(E('button', { type: 'button', class: 'wc-btn wc-mini', text: 'Copy answer', style: { marginTop: '8px' }, onclick: async () => { try { await H.copy(run.reply); H.toast && H.toast('Copied'); } catch (e) {} } }));
    }
    return t;
  }

  function refreshTranscript(parent) {
    const old = parent.querySelector && parent.querySelector('#wc-agent-transcript');
    const agent = allAgents().find(a => a.id === S.selectedId);
    if (!old || !agent) { render(parent); return; }
    const next = buildTranscript(agent);
    old.parentNode.replaceChild(next, old);
  }

  function startRun(parent, agent) {
    if (S.run && S.run.busy) return;
    const project = currentProject();
    if (!project) { S.run = { agentId: agent.id, busy: false, steps: [], reply: '', error: 'Open a generator first — there is nothing for the agent to read.', status: '' }; render(parent); return; }
    const toolbox = D.makeToolbox(() => currentProject());
    const run = { agentId: agent.id, busy: true, cancelled: false, abort: null, steps: [], reply: '', error: '', exhausted: false, status: 'Thinking…' };
    S.run = run;
    const ask = (system, user) => {
      const h = H.aiAsk(system, user, { temperature: 0.3 });
      run.abort = h.abort;
      return h.promise;
    };
    render(parent);
    A.runAgent(agent, {
      ask: ask, toolbox: toolbox, input: S.input,
      isCancelled: () => run.cancelled,
      onStep: (step) => { if (run.cancelled) return; run.steps.push(step); run.status = 'Thinking…'; refreshTranscript(parent); }
    }).then(r => {
      run.busy = false; run.reply = (r && r.reply) || '(no answer)'; run.exhausted = !!(r && r.exhausted); run.status = '';
      render(parent);
    }, e => {
      run.busy = false; run.error = (e && e.message) || String(e); run.status = '';
      render(parent);
    });
  }

  function stopRun(parent) {
    if (!S.run || !S.run.busy) return;
    S.run.cancelled = true;
    try { if (S.run.abort) S.run.abort(); } catch (e) {}
    S.run.busy = false; S.run.status = ''; if (!S.run.error && !S.run.reply) S.run.error = 'Stopped.';
    render(parent);
  }

  function buildEditor(parent) {
    const draft = S.editing;
    const box = E('div', { style: { borderTop: LINE, marginTop: '16px', paddingTop: '14px' } });
    box.appendChild(E('h3', { text: draft.id ? 'Edit agent' : 'New agent', style: { margin: '0 0 8px', fontSize: '16px' } }));
    const msg = E('div', { role: 'status', style: { fontSize: '12px', color: '#ff9e92', minHeight: '16px' } });

    const nameIn = E('input', { type: 'text', placeholder: 'Agent name', style: fieldStyle }); nameIn.value = draft.name;
    nameIn.addEventListener('input', () => { draft.name = nameIn.value; });
    const glyphIn = E('input', { type: 'text', placeholder: '\u{1F916}', maxlength: '4', style: Object.assign({}, fieldStyle, { width: '70px', flex: '0 0 auto', textAlign: 'center' }) }); glyphIn.value = draft.glyph;
    glyphIn.addEventListener('input', () => { draft.glyph = glyphIn.value; });
    box.appendChild(E('label', { text: 'Name & icon', style: { display: 'block', marginTop: '8px', fontSize: '13px' } }));
    box.appendChild(E('div', { style: { display: 'flex', gap: '8px', marginTop: '6px' } }, [nameIn, glyphIn]));

    box.appendChild(E('label', { text: 'Role — what it is and how it should work', style: { display: 'block', marginTop: '12px', fontSize: '13px' } }));
    const roleIn = E('textarea', { rows: '4', placeholder: 'You are a Perchance generator analyst. Using only read-only lookups, ...', style: Object.assign({}, fieldStyle, { marginTop: '6px', resize: 'vertical' }) });
    roleIn.value = draft.role; roleIn.addEventListener('input', () => { draft.role = roleIn.value; });
    box.appendChild(roleIn);

    box.appendChild(E('label', { text: 'Default goal (optional)', style: { display: 'block', marginTop: '12px', fontSize: '13px' } }));
    const goalIn = E('textarea', { rows: '2', placeholder: 'Explain what this generator does and how to use it.', style: Object.assign({}, fieldStyle, { marginTop: '6px', resize: 'vertical' }) });
    goalIn.value = draft.goal; goalIn.addEventListener('input', () => { draft.goal = goalIn.value; });
    box.appendChild(goalIn);

    box.appendChild(E('label', { text: 'Tools it may use (all read-only)', style: { display: 'block', marginTop: '12px', fontSize: '13px' } }));
    const toolsWrap = E('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,180px),1fr))', gap: '4px', marginTop: '6px' } });
    A.TOOLS.forEach(([name, desc]) => {
      const cb = E('input', { type: 'checkbox', 'aria-label': name }); cb.checked = draft.tools.indexOf(name) !== -1;
      cb.addEventListener('change', () => { draft.tools = cb.checked ? draft.tools.concat(name) : draft.tools.filter(t => t !== name); });
      toolsWrap.appendChild(E('label', { title: desc, style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' } }, [cb, E('span', { text: name })]));
    });
    box.appendChild(toolsWrap);

    box.appendChild(E('label', { text: 'Lookup rounds (1–8)', style: { display: 'block', marginTop: '12px', fontSize: '13px' } }));
    const roundsIn = E('input', { type: 'number', min: '1', max: '8', style: Object.assign({}, fieldStyle, { width: '90px' }) }); roundsIn.value = String(draft.maxRounds);
    roundsIn.addEventListener('input', () => { draft.maxRounds = A.clampRounds(roundsIn.value); });
    box.appendChild(roundsIn);

    box.appendChild(E('div', { style: { display: 'flex', gap: '8px', marginTop: '14px' } }, [
      E('button', { type: 'button', class: 'wc-btn wc-primary', text: 'Save agent', onclick: () => {
        const v = A.validateAgent(draft);
        if (!v.ok) { msg.textContent = v.error; return; }
        const normalized = A.normalizeAgent(draft);
        const customs = storedAgents().filter(a => A.normalizeAgent(a).id !== normalized.id);
        customs.push(normalized);
        if (saveCustom(customs) === false) { msg.textContent = 'Could not save — browser storage may be full.'; return; }
        S.selectedId = normalized.id; S.editing = null; render(parent);
      } }),
      E('button', { type: 'button', class: 'wc-btn', text: 'Cancel', onclick: () => { S.editing = null; render(parent); } })
    ]));
    box.appendChild(msg);
    return box;
  }

  window.weldAgents = { render };
})();
