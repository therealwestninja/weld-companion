#!/usr/bin/env node
// Local MCP clients use this adapter without putting the bridge token in their command/config.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

function createForwarder(configFile) {
  let session, initialization;
  return async function forward(message, retry = true) {
    try {
      if (message.method === 'initialize') { initialization = message.params; session = undefined; }
      const cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      if (!/^[a-f0-9]{16,128}$/i.test(cfg.token) || !Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) throw new Error();
      const response = await fetch('http://127.0.0.1:' + cfg.port + '/mcp/' + cfg.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(session ? { 'Mcp-Session-Id': session } : {}) },
        body: JSON.stringify(message), signal: AbortSignal.timeout(100000)
      });
      if (response.headers.get('mcp-session-id')) session = response.headers.get('mcp-session-id');
      if (response.status === 404 && session && initialization && retry && message.method !== 'initialize') {
        const initialized = await forward({ jsonrpc: '2.0', id: 'weld-reconnect', method: 'initialize', params: initialization }, false);
        if (initialized && initialized.result) return forward(message, false);
        throw new Error();
      }
      if (response.status === 202) return null;
      if (!response.ok) throw new Error();
      return await response.json();
    } catch (_) {
      // Fetch exceptions can contain credential-bearing URLs. Never forward or log them.
      return message.id === undefined ? null : { jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'Cannot reach the local Weld bridge. Check that it is running and reconnect the MCP client.' } };
    }
  };
}

function main() {
  const forward = createForwarder(path.join(__dirname, '.weld-bridge.json'));
  const input = readline.createInterface({ input: process.stdin });
  input.on('line', async line => {
    if (!line.trim()) return;
    let message;
    try { message = JSON.parse(line); }
    catch (_) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); return; }
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }) + '\n'); return;
    }
    const result = await forward(message);
    if (result && message.id !== undefined) process.stdout.write(JSON.stringify(result) + '\n');
  });
}
if (require.main === module) main();
module.exports = { createForwarder };
