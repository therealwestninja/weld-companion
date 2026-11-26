// The agent bridge over real HTTP: an MCP client on one side, a fake Weld browser tab on the other.
const assert = require('node:assert/strict');
const http = require('node:http');
const { createBridge, isLoopbackHost, isLoopbackOrigin, SUPPORTED } = require('../bridge/weld-bridge.js');
const Dev = require('../src/dev-core.js');

assert.equal(isLoopbackHost('127.0.0.1:8765'), true);
assert.equal(isLoopbackHost('localhost'), true);
assert.equal(isLoopbackHost('[::1]:80'), true);
assert.equal(isLoopbackHost('evil.example.com'), false);
assert.equal(isLoopbackHost('127.0.0.1.evil.com'), false);
assert.equal(isLoopbackOrigin('http://localhost:3000'), true);
assert.equal(isLoopbackOrigin('https://evil.example.com'), false);
assert.equal(isLoopbackOrigin('not a url'), false);

function raw(port, { method = 'GET', path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject); if (body != null) req.write(body); req.end();
  });
}

(async () => {
  const bridge = createBridge({ token: 'TESTTOKEN', toolMs: { default: 1500, weld_sample: 1500 }, clientTtl: 800 });
  const { port } = await bridge.listen(0);
  const MCP = '/mcp/TESTTOKEN';
  const json = (obj, extra = {}) => ({ method: 'POST', path: MCP, headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...extra }, body: JSON.stringify(obj) });
  const rpc = async (obj, extra) => { const r = await raw(port, json(obj, extra)); return { ...r, json: r.text ? JSON.parse(r.text) : null }; };

  // ---- transport rules -------------------------------------------------------
  assert.equal((await raw(port, { path: '/mcp/WRONG', method: 'POST', body: '{}' })).status, 404, 'wrong token');
  assert.equal((await raw(port, { path: '/nothing' })).status, 404);
  // pairing: only a request carrying the custom header (which a web page cannot send cross-origin) gets the token
  assert.equal((await raw(port, { path: '/pair' })).status, 404, 'pair needs the header');
  assert.equal((await raw(port, { path: '/pair', headers: { 'X-Weld-Pair': '1', Origin: 'https://evil.example.com' } })).status, 404, 'pair refuses a request with an Origin');
  assert.equal((await raw(port, { path: '/pair', method: 'OPTIONS', headers: { 'Access-Control-Request-Headers': 'x-weld-pair' } })).status, 404, 'no CORS preflight approval');
  assert.equal((await raw(port, { path: '/pair', headers: { 'X-Weld-Pair': '1', Host: 'evil.example.com' } })).status, 403, 'pair refuses a foreign Host');
  const paired = await raw(port, { path: '/pair', headers: { 'X-Weld-Pair': '1' } });
  assert.equal(paired.status, 200); assert.equal(JSON.parse(paired.text).token, 'TESTTOKEN');
  assert.equal((await raw(port, { path: MCP, method: 'GET' })).status, 405, 'no SSE stream offered');
  assert.equal((await raw(port, { path: MCP, method: 'DELETE' })).status, 405);
  assert.equal((await raw(port, { ...json({ jsonrpc: '2.0', id: 1, method: 'ping' }), headers: { Host: 'evil.example.com', 'Content-Type': 'application/json' } })).status, 403, 'DNS-rebinding Host is refused');
  assert.equal((await raw(port, json({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: 'https://evil.example.com' }))).status, 403, 'foreign browser Origin is refused');
  assert.equal((await raw(port, json({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: 'http://localhost:5173' }))).status, 200);
  assert.equal((await raw(port, json({ jsonrpc: '2.0', id: 1, method: 'ping' }, { 'MCP-Protocol-Version': '1999-01-01' }))).status, 400);
  assert.equal((await raw(port, { ...json({}), body: '{oops' })).status, 400, 'parse error');
  assert.equal((await raw(port, json({ jsonrpc: '2.0', id: 1, method: 'ping' }, { 'Mcp-Session-Id': 'nope' }))).status, 404, 'unknown session asks the client to re-initialize');
  assert.equal((await raw(port, { ...json({}), body: 'x'.repeat(7 * 1048576) }).catch(() => ({ status: 413 }))).status, 413, 'oversized body');

  // ---- MCP lifecycle ----------------------------------------------------------
  const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-test', version: '1' } } });
  assert.equal(init.status, 200);
  assert.equal(init.json.result.protocolVersion, '2025-06-18');
  assert.equal(init.json.result.serverInfo.name, 'weld-bridge');
  assert.ok(init.json.result.capabilities.tools);
  assert.match(init.json.result.instructions, /weld_get_primer/);
  const sid = init.headers['mcp-session-id'];
  assert.match(sid, /^[0-9a-f-]{36}$/);
  assert.equal((await rpc({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).json.result.protocolVersion, SUPPORTED[0], 'unknown versions get the newest one we speak');
  assert.equal((await raw(port, json({ jsonrpc: '2.0', method: 'notifications/initialized' }, { 'Mcp-Session-Id': sid }))).status, 202, 'notifications get 202 and no body');
  assert.equal((await rpc({ jsonrpc: '2.0', id: 3, method: 'ping' }, { 'Mcp-Session-Id': sid })).json.result && true, true);
  const list = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, { 'Mcp-Session-Id': sid, 'MCP-Protocol-Version': '2025-06-18' });
  assert.deepEqual(list.json.result.tools.map(t => t.name), Dev.BRIDGE_TOOLS.map(t => t.name));
  const propose = list.json.result.tools.find(t => t.name === 'weld_propose_edit');
  assert.equal(propose.annotations.readOnlyHint, false); assert.equal(propose.annotations.destructiveHint, false);
  assert.equal(list.json.result.tools.find(t => t.name === 'weld_get_source').annotations.readOnlyHint, true);
  assert.equal((await rpc({ jsonrpc: '2.0', id: 5, method: 'nope/what' })).json.error.code, -32601);
  assert.equal((await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'rm_rf' } })).json.error.code, -32602, 'unknown tool is a protocol error');
  assert.equal((await rpc({ jsonrpc: '2.0', id: 7, method: 'resources/list' })).json.result.resources.length, 0);
  assert.equal((await rpc({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: {} })).json.error.code, -32602);
  const batch = await rpc([{ jsonrpc: '2.0', id: 9, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/x' }, { jsonrpc: '2.0', id: 10, method: 'ping' }]);
  assert.equal(batch.json.length, 2);
  assert.equal((await raw(port, json([{ jsonrpc: '2.0', method: 'notifications/x' }]))).status, 202);
  assert.equal((await rpc({ jsonrpc: '1.0', id: 11, method: 'ping' })).json.error.code, -32600);

  const call = (name, args, extra) => rpc({ jsonrpc: '2.0', id: Math.floor(Math.random() * 1e9), method: 'tools/call', params: { name, arguments: args } }, { 'Mcp-Session-Id': sid, ...extra }).then(r => r.json.result);

  // ---- tools that need no browser ----------------------------------------------------
  const primer = await call('weld_get_primer', {});
  assert.equal(primer.isError, false); assert.match(primer.content[0].text, /evaluateItem/);
  const offline = JSON.parse((await call('weld_status', {})).content[0].text);
  assert.equal(offline.connected, false); assert.match(offline.hint, /Dev tab/);
  const noWeld = await call('weld_get_source', {});
  assert.equal(noWeld.isError, true); assert.match(noWeld.content[0].text, /not connected/);

  // ---- a fake Weld tab ----------------------------------------------------------------
  const weld = (cid, slug, mode, handler) => {
    let running = true, polls = 0; const seen = [];
    const loop = (async () => {
      while (running) {
        const r = await raw(port, { path: '/weld/TESTTOKEN/poll?cid=' + cid + '&slug=' + slug + '&mode=' + mode + '&v=1.58.0&wait=1' });
        polls++;
        for (const cmd of JSON.parse(r.text).commands) {
          seen.push(cmd);
          const out = await handler(cmd);
          await raw(port, { method: 'POST', path: '/weld/TESTTOKEN/reply', body: JSON.stringify({ id: cmd.id, ...out }) });
        }
      }
    })();
    return { seen, stop: async () => { running = false; await loop; }, polls: () => polls };
  };
  const tabA = weld('tab-aaaa', 'zoo', 'edit', async cmd => {
    if (cmd.tool === 'weld_get_source') return { ok: true, result: { pane: cmd.args.pane || 'both', text: '1: output' } };
    if (cmd.tool === 'weld_propose_edit') return { ok: true, result: { id: 'p1', status: 'pending', agent: cmd._agent, args: cmd.args } };
    if (cmd.tool === 'weld_find_usages') return { ok: false, error: 'No generator is loaded.' };
    return { ok: true, result: 'ok' };
  });
  await new Promise(r => setTimeout(r, 150));
  const status = JSON.parse((await call('weld_status', {})).content[0].text);
  assert.equal(status.connected, true); assert.equal(status.tabs[0].generator, 'zoo'); assert.match(status.tabs[0].editor, /open/);

  const src = await call('weld_get_source', { pane: 'dsl' });
  assert.equal(src.isError, false); assert.deepEqual(JSON.parse(src.content[0].text), { pane: 'dsl', text: '1: output' });
  assert.equal(tabA.seen.at(-1).tool, 'weld_get_source');
  const err = await call('weld_find_usages', { name: 'x' });
  assert.equal(err.isError, true); assert.match(err.content[0].text, /No generator is loaded/);

  // The agent's name comes from the MCP session and cannot be spoofed through arguments.
  const prop = await call('weld_propose_edit', { pane: 'dsl', new_text: 'x', _agent: 'spoofed', tab: 'zoo' });
  const got = tabA.seen.at(-1);
  assert.equal(got.args._agent, 'claude-test');
  assert.equal(got.args.tab, undefined, 'routing key is not forwarded');
  assert.equal(JSON.parse(prop.content[0].text).status, 'pending');

  // Routing between two tabs by generator name.
  const tabB = weld('tab-bbbb', 'castle', 'view', async cmd => ({ ok: true, result: { from: 'castle' } }));
  await new Promise(r => setTimeout(r, 150));
  const ambiguous = await call('weld_get_source', {});
  assert.equal(ambiguous.isError, true);
  assert.match(ambiguous.content[0].text, /Several Weld generators.*tab argument/);
  assert.deepEqual(JSON.parse((await call('weld_get_source', { tab: 'castle' })).content[0].text), { from: 'castle' });
  assert.equal(JSON.parse((await call('weld_get_source', { tab: 'zoo' })).content[0].text).pane, 'both');
  const missing = await call('weld_get_source', { tab: 'nowhere' });
  assert.equal(missing.isError, true); assert.match(missing.content[0].text, /No connected Weld tab has "nowhere"/);
  assert.equal(JSON.parse((await call('weld_status', {})).content[0].text).tabs.length, 2);

  // A tab that stops polling is dropped from the connected list, and calls time out cleanly.
  await tabA.stop(); await tabB.stop();
  await new Promise(r => setTimeout(r, 1000));
  assert.equal(JSON.parse((await call('weld_status', {})).content[0].text).connected, false, 'stale tabs expire');

  const silent = weld('tab-cccc', 'slow', 'edit', async () => { await new Promise(r => setTimeout(r, 2500)); return { ok: true, result: 'late' }; });
  await new Promise(r => setTimeout(r, 150));
  const slow = await call('weld_get_outline', {});
  assert.equal(slow.isError, true); assert.match(slow.content[0].text, /did not answer in time/);
  await silent.stop();

  // Weld-channel hygiene
  assert.equal((await raw(port, { path: '/weld/WRONG/poll?cid=abcd' })).status, 404);
  assert.equal((await raw(port, { path: '/weld/TESTTOKEN/poll' })).status, 400, 'cid is required');
  const stale = await raw(port, { method: 'POST', path: '/weld/TESTTOKEN/reply', body: JSON.stringify({ id: 'unknown', ok: true }) });
  assert.equal(JSON.parse(stale.text).ok, false, 'a reply to an expired command is ignored');
  assert.equal((await raw(port, { method: 'POST', path: '/weld/TESTTOKEN/bye', body: JSON.stringify({ cid: 'tab-aaaa' }) })).status, 200);

  await bridge.close();
  console.log('Bridge: MCP transport, auth, routing, timeouts and Weld channel tests passed');
})().catch(e => { console.error(e); process.exit(1); });
