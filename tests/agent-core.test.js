// Agents core: definitions, normalization, tool-allowlist gating, and the read-only
// runAgent loop driving dev-core's investigate with a fake model + fake toolbox.
const assert = require('node:assert/strict');
const Dev = require('../src/dev-core.js');
const A = require('../src/agent-core.js');

// ---- catalog + defaults ----
assert.ok(A.TOOL_NAMES.length >= 5 && A.TOOL_NAMES.every(A.isToolName), 'tool catalog from INVESTIGATE_TOOLS');
assert.ok(A.DEFAULT_AGENTS.length >= 3, 'has built-in agents');
A.DEFAULT_AGENTS.forEach(d => {
  assert.equal(A.validateAgent(d).ok, true, 'built-in valid: ' + d.id);
  assert.ok(d.tools.every(A.isToolName), 'built-in uses only real tools: ' + d.id);
});

// ---- normalize + validate ----
const n = A.normalizeAgent({ name: 'My Agent!!', role: 'do things', tools: ['get_outline', 'NOPE'], maxRounds: 99 });
assert.equal(n.id, 'my-agent', 'id slugged');
assert.deepEqual(n.tools, ['get_outline'], 'unknown tool dropped');
assert.equal(n.maxRounds, 8, 'rounds clamped to cap');
assert.equal(A.normalizeAgent({ name: 'x', role: 'y', tools: [] }).tools.length, A.TOOL_NAMES.length, 'empty tools -> all read-only tools');
assert.equal(A.validateAgent({ name: '', role: 'x' }).ok, false, 'name required');
assert.equal(A.validateAgent({ name: 'x', role: '' }).ok, false, 'role required');
assert.equal(A.validateAgent({ name: 'x', role: 'y', tools: ['NOPE'] }).ok, false, 'needs at least one real tool');

// ---- agentToolList ----
assert.deepEqual(A.agentToolList({ tools: ['get_outline'] }).map(t => t[0]), ['get_outline']);
assert.deepEqual(A.agentToolList({ tools: ['NOPE'] }).map(t => t[0]), A.TOOL_NAMES, 'all-unknown falls back to full catalog');

// ---- mergeAgents: built-ins first, a stored override keeps builtin flag, customs appended ----
const merged = A.mergeAgents([{ id: 'explain', name: 'Explain (mine)', role: 'custom role', tools: ['get_outline'] }, { id: 'my-helper', name: 'My Helper', role: 'help' }]);
const explain = merged.find(a => a.id === 'explain');
assert.equal(explain.name, 'Explain (mine)', 'stored overrides built-in');
assert.equal(explain.builtin, true, 'override stays builtin');
const custom = merged.find(a => a.id === 'my-helper');
assert.ok(custom && custom.builtin === false, 'custom appended, not builtin');

// ---- runAgent drives investigate, respects the tool allowlist (read-only, gated) ----
(async () => {
  // Fake toolbox records calls and returns canned data.
  const calls = [];
  const toolbox = { call: (name, args) => { calls.push(name); return { tool: name, args, ok: true }; } };

  // An agent restricted to get_outline that tries get_lines must be refused by the loop.
  const asks = [];
  const scripted = [
    '```weld-tool\n{"tool":"get_outline","args":{}}\n```',          // allowed
    '```weld-tool\n{"tool":"get_lines","args":{"pane":"dsl"}}\n```', // NOT in this agent's tools
    'Final answer: the generator has two lists.'
  ];
  let i = 0;
  const ask = (system, user) => { asks.push({ system, user }); return Promise.resolve(scripted[i++]); };

  const agent = { id: 'outline-only', name: 'Outline only', role: 'Report the outline.', tools: ['get_outline'], maxRounds: 5 };
  const res = await A.runAgent(agent, { ask, toolbox, input: 'be brief' });
  assert.match(res.reply, /Final answer/, 'returns the final reply');
  assert.ok(calls.includes('get_outline'), 'allowed tool was actually called');
  assert.ok(!calls.includes('get_lines'), 'disallowed tool was NEVER dispatched to the toolbox');
  // the agent's role and its goal+input reached the model
  assert.match(asks[0].system, /Report the outline/, 'role in system prompt');
  assert.match(asks[0].system, /get_outline/, 'only the allowed tool is advertised');
  assert.ok(!/get_lines/.test(asks[0].system), 'disallowed tool is not advertised to the model');
  assert.match(asks[0].user, /be brief/, 'user input threaded in');

  // round cap: a model that never stops asking is bounded and returns a clean reply.
  let r2 = 0;
  const loopAsk = () => Promise.resolve('```weld-tool\n{"tool":"get_outline","args":{}}\n```');
  const capped = await A.runAgent({ name: 'Looper', role: 'loop', tools: ['get_outline'], maxRounds: 2 }, { ask: loopAsk, toolbox });
  assert.equal(capped.exhausted, true, 'round cap hit -> exhausted');

  // stop: isCancelled aborts the run.
  await assert.rejects(
    A.runAgent({ name: 'Stoppable', role: 'x', tools: ['get_outline'] }, { ask: loopAsk, toolbox, isCancelled: () => true }),
    /Stopped/, 'isCancelled stops the agent');

  // guardrails: no model / no toolbox reject clearly.
  await assert.rejects(A.runAgent(agent, { toolbox }), /No AI model/);
  await assert.rejects(A.runAgent(agent, { ask }), /No generator is loaded/);

  console.log('Agents core tests passed');
})().catch(e => { console.error(e); process.exit(1); });
