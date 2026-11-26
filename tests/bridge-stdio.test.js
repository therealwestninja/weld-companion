const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBridge } = require('../bridge/weld-bridge');
const { createForwarder } = require('../bridge/weld-mcp-stdio');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weld-stdio-test-'));
  const file = path.join(dir, 'config.json');
  const bridge = createBridge({ token: 'a'.repeat(48) });
  try {
    const address = await bridge.listen(0);
    const browserUrl = 'http://127.0.0.1:' + address.port + '/weld/' + bridge.token;
    await (await fetch(browserUrl + '/poll?cid=poll-limit&slug=test&wait=25')).json();
    // Existing browser installs request 25 seconds. Cap that server-side so
    // background tabs promptly release the shared browser connection slots.
    const poll = await fetch(browserUrl + '/poll?cid=poll-limit&slug=test&wait=25', { signal: AbortSignal.timeout(6000) });
    assert.deepEqual((await poll.json()).commands, []);
    await fetch(browserUrl + '/bye', { method: 'POST', body: JSON.stringify({ cid: 'poll-limit' }) });
    fs.writeFileSync(file, JSON.stringify({ token: bridge.token, port: address.port }), { mode: 0o600 });
    const forward = createForwarder(file);
    const init = await forward({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'stdio-test', version: '1' } } });
    assert.equal(init.result.serverInfo.name, 'weld-bridge');
    assert.equal(await forward({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
    const tools = await forward({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.ok(tools.result.tools.some(t => t.name === 'weld_propose_edit'));
    assert.equal(tools.result.tools.find(t => t.name === 'weld_get_source').inputSchema.properties.tab.type, 'string');
    const result = await forward({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'weld_status', arguments: {} } });
    assert.equal(JSON.parse(result.result.content[0].text).connected, false);
    bridge.sessions.clear(); // A restarted bridge forgets the old MCP session.
    const reconnected = await forward({ jsonrpc: '2.0', id: 31, method: 'tools/list' });
    assert.equal(reconnected.result.tools.length, tools.result.tools.length);
    fs.writeFileSync(file, JSON.stringify({ token: 'b'.repeat(48), port: address.port }));
    const failure = await forward({ jsonrpc: '2.0', id: 4, method: 'tools/list' });
    assert.equal(failure.error.code, -32603);
    assert.doesNotMatch(JSON.stringify(failure), /bbbbbbbb|\/mcp\//, 'failures never disclose credential URLs');
    assert.equal(await forward({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  } finally {
    await bridge.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('Bridge stdio: initialize, notifications, discovery, calls and credential-safe failures passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
