#!/usr/bin/env node
/* Weld agent bridge.
 *
 * Lets AI coding agents (Claude Code, Codex, Gemini CLI, Antigravity, Copilot agent mode, ...) read
 * the Perchance generator open in your browser through the Weld Companion userscript, and PROPOSE
 * edits that you accept or reject in Weld. Nothing is ever applied without your review.
 *
 *   agent  --MCP (Streamable HTTP, JSON)-->  /mcp/<token>      this process
 *   Weld   --long-poll HTTP---------------->  /weld/<token>/*   (the userscript, in your browser)
 *
 * Local only: binds to 127.0.0.1, requires the secret token in the URL path, and rejects requests
 * whose Host or Origin is not loopback (DNS-rebinding defense). No dependencies.
 */
'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Dev = require('../src/dev-core.js');

const VERSION = '1.0.0';
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY = 6 * 1048576;
const CLIENT_TTL = 120000;     // allow a background browser's minute-long timer throttling
// Browsers share a small HTTP/1 connection pool across generator tabs. Long polls
// must release slots promptly so MCP command replies cannot sit behind other tabs.
const POLL_MAX = 2000;
const TOOL_MS = { default: 90000, weld_sample: 90000 };
const MAX_RESULT = 200000;

function randomToken() { return crypto.randomBytes(24).toString('hex'); }
function isLoopbackHost(hostHeader) {
  const h = String(hostHeader || '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}
function isLoopbackOrigin(origin) {
  try { return isLoopbackHost(new URL(origin).host); } catch (e) { return false; }
}

function createBridge(options) {
  options = options || {};
  const token = options.token || randomToken();
  const toolMs = Object.assign({}, TOOL_MS, options.toolMs || {});
  const clientTtl = options.clientTtl || CLIENT_TTL;
  const clients = new Map();       // cid -> { cid, slug, mode, version, lastSeen, queue: [], waiter }
  const pending = new Map();       // command id -> { resolve, timer, cid }
  const sessions = new Map();      // MCP session id -> { clientInfo, protocolVersion }
  let counter = 0;
  const log = options.log || (() => {});

  // ---------------------------------------------------------------- weld clients
  function liveClients() { const now = Date.now(); return Array.from(clients.values()).filter(c => now - c.lastSeen < clientTtl).sort((a, b) => b.lastSeen - a.lastSeen); }
  function pickClient(tab) {
    const live = liveClients();
    if (tab) return live.find(c => c.slug === tab) || null;
    // Poll order is not focus order. Never silently send a command to another generator.
    return new Set(live.map(c => c.slug)).size === 1 ? live[0] : null;
  }
  function touch(info) {
    let c = clients.get(info.cid);
    if (!c) { c = { cid: info.cid, queue: [], waiter: null }; clients.set(info.cid, c); }
    c.slug = info.slug || ''; c.mode = info.mode === 'edit' ? 'edit' : 'view'; c.version = info.version || ''; c.lastSeen = Date.now();
    return c;
  }
  function dispatch(client, tool, args, ms) {
    return new Promise(resolve => {
      const id = 'c' + (++counter) + '-' + crypto.randomBytes(4).toString('hex');
      const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: 'Weld did not answer in time. Is the generator tab still open and visible?' }); }, ms);
      pending.set(id, { resolve, timer, cid: client.cid });
      if (client.queue.length >= 50) { clearTimeout(timer); pending.delete(id); return resolve({ ok: false, error: 'Too many requests are waiting for Weld.' }); }
      const cmd = { id, tool, args };
      if (client.waiter) { const w = client.waiter; client.waiter = null; w(cmd); } else client.queue.push(cmd);
    });
  }

  // ------------------------------------------------------------------ MCP tools
  const toolByName = new Map(Dev.BRIDGE_TOOLS.map(t => [t.name, t]));
  function mcpTool(t) {
    const routed = t.name !== 'weld_status' && t.name !== 'weld_get_primer';
    const schema = routed ? Object.assign({}, t.inputSchema, { properties: Object.assign({}, t.inputSchema.properties, {
      tab: { type: 'string', description: 'Generator name from weld_status. Required when multiple generators are connected.' }
    }) }) : t.inputSchema;
    return { name: t.name, description: t.description, inputSchema: schema,
      annotations: { title: t.name.replace(/^weld_/, '').replace(/_/g, ' '), readOnlyHint: !!t.readOnly, destructiveHint: false, idempotentHint: !!t.readOnly, openWorldHint: false } };
  }
  function textResult(value, isError) {
    let text = typeof value === 'string' ? value : JSON.stringify(value, null, 1);
    if (text.length > MAX_RESULT) text = text.slice(0, MAX_RESULT) + '\n… [truncated]';
    return { content: [{ type: 'text', text }], isError: !!isError };
  }
  function statusReport() {
    const live = liveClients();
    return { bridge: VERSION, connected: live.length > 0, tabs: live.map(c => ({ generator: c.slug, editor: c.mode === 'edit' ? 'open (proposals can be made)' : 'closed (read-only)', weld: c.version, last_seen_seconds_ago: Math.round((Date.now() - c.lastSeen) / 1000) })),
      hint: live.length ? undefined : 'Open the generator in your browser, open the Weld drawer, go to the Dev tab and press Connect.' };
  }
  async function callTool(name, args, session) {
    const def = toolByName.get(name);
    if (!def) { const e = new Error('Unknown tool: ' + name); e.code = -32602; throw e; }
    args = (args && typeof args === 'object' && !Array.isArray(args)) ? args : {};
    if (name === 'weld_get_primer') return textResult(Dev.PRIMER);
    if (name === 'weld_status') return textResult(statusReport());
    const tab = typeof args.tab === 'string' ? args.tab : '';
    const client = pickClient(tab);
    if (!tab && !client && liveClients().length) return textResult('Several Weld generators are connected. Call weld_status and pass the intended generator name in the tab argument. ' + JSON.stringify(statusReport()), true);
    if (!client) return textResult(tab ? 'No connected Weld tab has "' + tab + '" open. ' + JSON.stringify(statusReport()) : 'Weld is not connected. ' + JSON.stringify(statusReport()), true);
    const send = Object.assign({}, args); delete send.tab; delete send._agent;   // the agent name comes from the MCP session, never from the caller
    if (name === 'weld_propose_edit') send._agent = (session && session.clientInfo && String(session.clientInfo.name || '').slice(0, 60)) || 'agent';
    const reply = await dispatch(client, name, send, toolMs[name] || toolMs.default);
    return reply.ok ? textResult(reply.result === undefined ? 'ok' : reply.result) : textResult(reply.error || 'Failed', true);
  }

  // ------------------------------------------------------------------ JSON-RPC
  const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id == null ? null : id, error: { code, message } });
  async function handleRpc(msg, session, sessionHeader, res) {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return rpcError(msg && msg.id, -32600, 'Invalid Request');
    const isRequest = msg.id !== undefined && typeof msg.method === 'string';
    if (!isRequest) return null;       // notification or response: accepted, no reply
    try {
      switch (msg.method) {
        case 'initialize': {
          const asked = msg.params && msg.params.protocolVersion;
          const version = SUPPORTED.includes(asked) ? asked : SUPPORTED[0];
          const sid = crypto.randomUUID();
          sessions.set(sid, { clientInfo: (msg.params && msg.params.clientInfo) || {}, protocolVersion: version });
          if (sessions.size > 200) sessions.delete(sessions.keys().next().value);
          res.sessionId = sid;
          return { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: version, capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'weld-bridge', title: 'Weld Companion bridge', version: VERSION },
            instructions: 'Read and propose changes to the Perchance generator the user has open in Weld Companion. Call weld_get_primer first to learn Perchance syntax. weld_propose_edit never applies anything: the user reviews a diff and accepts or rejects it, then weld_proposal_status tells you the outcome.' } };
        }
        case 'ping': return { jsonrpc: '2.0', id: msg.id, result: {} };
        case 'tools/list': return { jsonrpc: '2.0', id: msg.id, result: { tools: Dev.BRIDGE_TOOLS.map(mcpTool) } };
        case 'tools/call': {
          const p = msg.params || {};
          if (typeof p.name !== 'string') return rpcError(msg.id, -32602, 'params.name is required');
          const result = await callTool(p.name, p.arguments, session);
          return { jsonrpc: '2.0', id: msg.id, result };
        }
        case 'resources/list': return { jsonrpc: '2.0', id: msg.id, result: { resources: [] } };
        case 'resources/templates/list': return { jsonrpc: '2.0', id: msg.id, result: { resourceTemplates: [] } };
        case 'prompts/list': return { jsonrpc: '2.0', id: msg.id, result: { prompts: [] } };
        default: return rpcError(msg.id, -32601, 'Method not found: ' + msg.method);
      }
    } catch (e) { return rpcError(msg.id, e.code || -32603, e.message || 'Internal error'); }
  }

  // ---------------------------------------------------------------------- HTTP
  function send(res, status, body, headers) {
    const data = body == null ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
    res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, headers || {}));
    res.end(data);
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []; let size = 0;
      req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('Request body too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }
  const tokenOk = given => { const a = Buffer.from(String(given)), b = Buffer.from(token); return a.length === b.length && crypto.timingSafeEqual(a, b); };

  async function onRequest(req, res) {
    try {
      if (!isLoopbackHost(req.headers.host)) return send(res, 403, { error: 'Forbidden host' });
      const url = new URL(req.url, 'http://127.0.0.1');
      const parts = url.pathname.split('/').filter(Boolean);
      // ---- pairing: /pair hands the token to the userscript. It needs a custom header, which a web page
      // cannot send cross-origin (the preflight gets no CORS approval), and a loopback Host (checked above).
      if (parts[0] === 'pair' && parts.length === 1) {
        if (req.method !== 'GET' || req.headers['x-weld-pair'] !== '1' || req.headers.origin) return send(res, 404, { error: 'Not found' });
        return send(res, 200, { ok: true, bridge: VERSION, token });
      }
      // ---- MCP endpoint: /mcp/<token>
      if (parts[0] === 'mcp') {
        if (!parts[1] || !tokenOk(parts[1]) || parts.length !== 2) return send(res, 404, { error: 'Not found' });
        const origin = req.headers.origin;
        if (origin && !isLoopbackOrigin(origin)) return send(res, 403, { error: 'Forbidden origin' });
        if (req.method === 'GET' || req.method === 'DELETE') return send(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
        if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
        const ver = req.headers['mcp-protocol-version'];
        if (ver && !SUPPORTED.includes(ver)) return send(res, 400, rpcError(null, -32600, 'Unsupported MCP-Protocol-Version: ' + ver));
        const sid = req.headers['mcp-session-id'];
        let session = null;
        if (sid) { session = sessions.get(sid); if (!session) return send(res, 404, rpcError(null, -32600, 'Unknown session. Send a new initialize request.')); }
        let msg;
        try { msg = JSON.parse(await readBody(req)); } catch (e) { return send(res, e.status || 400, rpcError(null, -32700, e.status ? e.message : 'Parse error')); }
        const out = { sessionId: null };
        if (Array.isArray(msg)) {
          const replies = (await Promise.all(msg.map(m => handleRpc(m, session, sid, out)))).filter(Boolean);
          return replies.length ? send(res, 200, replies) : send(res, 202, null);
        }
        const reply = await handleRpc(msg, session, sid, out);
        if (!reply) return send(res, 202, null);
        return send(res, 200, reply, out.sessionId ? { 'Mcp-Session-Id': out.sessionId } : null);
      }
      // ---- Weld userscript channel: /weld/<token>/{poll,reply,bye}
      if (parts[0] === 'weld') {
        if (!parts[1] || !tokenOk(parts[1])) return send(res, 404, { error: 'Not found' });
        const action = parts[2];
        if (action === 'poll' && req.method === 'GET') {
          const q = url.searchParams, cid = (q.get('cid') || '').slice(0, 64);
          if (!/^[\w-]{4,64}$/.test(cid)) return send(res, 400, { error: 'cid required' });
          const isNew = !clients.has(cid);
          const c = touch({ cid, slug: (q.get('slug') || '').slice(0, 100), mode: q.get('mode'), version: (q.get('v') || '').slice(0, 20) });
          if (c.queue.length) return send(res, 200, { commands: c.queue.splice(0, 10) });
          if (isNew) return send(res, 200, { commands: [], hello: true });   // let a freshly connected tab show "connected" at once
          const wait = Math.min(POLL_MAX, Math.max(0, Number(q.get('wait')) * 1000 || POLL_MAX));
          if (c.waiter) { const old = c.waiter; c.waiter = null; old(null); }   // a newer poll replaces a stale one
          await new Promise(resolve => {
            const timer = setTimeout(() => { if (c.waiter === done) c.waiter = null; resolve(); }, wait);
            function done(cmd) { clearTimeout(timer); if (cmd) { send(res, 200, { commands: [cmd] }); } else send(res, 200, { commands: [] }); resolve(); }
            c.waiter = done;
            req.on('close', () => { if (c.waiter === done) { c.waiter = null; clearTimeout(timer); resolve(); } });
          });
          if (!res.writableEnded && !res.destroyed) send(res, 200, { commands: [] });
          return;
        }
        if (action === 'reply' && req.method === 'POST') {
          let body; try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, e.status || 400, { error: 'Bad JSON' }); }
          const p = body && pending.get(body.id);
          if (!p) return send(res, 200, { ok: false, note: 'unknown or expired command' });
          clearTimeout(p.timer); pending.delete(body.id);
          p.resolve(body.ok ? { ok: true, result: body.result } : { ok: false, error: String(body.error || 'Failed').slice(0, 2000) });
          return send(res, 200, { ok: true });
        }
        if (action === 'bye' && req.method === 'POST') {
          let body = {}; try { body = JSON.parse(await readBody(req)); } catch (e) {}
          if (body && clients.has(body.cid)) clients.delete(body.cid);
          return send(res, 200, { ok: true });
        }
        return send(res, 404, { error: 'Not found' });
      }
      return send(res, 404, { error: 'Not found' });
    } catch (e) {
      log('request error: ' + (e && e.message));
      if (!res.headersSent) send(res, (e && e.status) || 500, { error: 'Server error' }); else res.end();
    }
  }

  const server = http.createServer((req, res) => { onRequest(req, res); });
  return {
    server, token, clients, sessions, pending,
    listen(port, host) { return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host || '127.0.0.1', () => resolve(server.address())); }); },
    close() { return new Promise(resolve => { pending.forEach(p => { clearTimeout(p.timer); p.resolve({ ok: false, error: 'Bridge stopped' }); }); pending.clear(); clients.forEach(c => { if (c.waiter) c.waiter(null); }); if (server.closeAllConnections) server.closeAllConnections(); server.close(() => resolve()); }); }
  };
}

// ------------------------------------------------------------------------- CLI
function loadConfig(file, rotate) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
  let changed = false;
  if (!cfg.token || rotate) { cfg.token = randomToken(); changed = true; }
  if (!cfg.port) { cfg.port = 8765; changed = true; }
  if (changed) fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  return cfg;
}
function configHelp(port, token) {
  const url = 'http://127.0.0.1:' + port + '/mcp/' + token;
  return [
    'Weld bridge is running. Keep this URL private: it is the key.',
    '',
    '  MCP URL (agents):  ' + url,
    '  Weld (browser):    Dev tab -> Bridge URL http://127.0.0.1:' + port + ' and token ' + token,
    '',
    'Add it to your agents:',
    '  Claude Code:   claude mcp add --transport http weld ' + url,
    '  Codex CLI:     add to ~/.codex/config.toml ->  [mcp_servers.weld]  url = "' + url + '"',
    '  Gemini CLI:    add to ~/.gemini/settings.json -> "mcpServers": { "weld": { "httpUrl": "' + url + '" } }',
    '  Copilot (VS Code) .vscode/mcp.json -> { "servers": { "weld": { "type": "http", "url": "' + url + '" } } }',
    '  Antigravity / others: add an HTTP (streamable) MCP server with the URL above.',
    '  If a client only supports stdio, bridge it with:  npx mcp-remote ' + url
  ].join('\n');
}
if (require.main === module) {
  const args = process.argv.slice(2);
  const file = path.join(__dirname, '.weld-bridge.json');
  const cfg = loadConfig(file, args.includes('--rotate-token'));
  const pi = args.indexOf('--port'); if (pi !== -1 && args[pi + 1]) cfg.port = parseInt(args[pi + 1], 10) || cfg.port;
  const bridge = createBridge({ token: cfg.token, log: m => process.stderr.write('[weld-bridge] ' + m + '\n') });
  bridge.listen(cfg.port, '127.0.0.1').then(addr => {
    console.log(configHelp(addr.port, cfg.token));
    if (args.includes('--copy')) {   // put the token on the clipboard so it can be pasted into Weld
      const tool = process.platform === 'win32' ? ['clip'] : process.platform === 'darwin' ? ['pbcopy'] : ['xclip', '-selection', 'clipboard'];
      try { const r = require('node:child_process').spawnSync(tool[0], tool.slice(1), { input: cfg.token }); console.log(r.status === 0 ? '\nThe token is copied to your clipboard: paste it into Weld (Dev tab, Agent bridge).' : '\n(Could not copy the token automatically; copy it from above.)'); } catch (e) { console.log('\n(Could not copy the token automatically; copy it from above.)'); }
    }
    console.log('\nWaiting for Weld and agents. Press Ctrl+C to stop.');
  }).catch(e => {
    if (e.code !== 'EADDRINUSE') { console.error(e.message); process.exit(1); }
    // Already running (for example started at login)? Say so and leave it alone rather than failing.
    const q = http.get({ host: '127.0.0.1', port: cfg.port, path: '/pair', headers: { 'X-Weld-Pair': '1' }, timeout: 2000 }, r => {
      let t = ''; r.on('data', c => { t += c; }); r.on('end', () => {
        let same = false; try { same = JSON.parse(t).token === cfg.token; } catch (x) {}
        console.log(same ? 'The Weld bridge is already running on port ' + cfg.port + '. Nothing to do.' : 'Port ' + cfg.port + ' is in use by something else. Use --port <n>.');
        process.exit(same ? 0 : 1);
      });
    });
    q.on('error', () => { console.error('Port ' + cfg.port + ' is already in use. Use --port <n>.'); process.exit(1); });
    q.on('timeout', () => q.destroy());
  });
  process.on('SIGINT', () => bridge.close().then(() => process.exit(0)));
}
module.exports = { createBridge, isLoopbackHost, isLoopbackOrigin, configHelp, SUPPORTED, VERSION };
