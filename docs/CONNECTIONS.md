# Weld connections

Weld has two independent connections. Configuring the AI provider does not install
an MCP server in an AI client, and installing an MCP server does not select the
model that Weld calls.

## Browser → LM Studio

In **Weld → Tools → Model connection and AI settings**:

- Provider: **Local — OpenAI-compatible**.
- Endpoint: `http://127.0.0.1:1234` (without `/v1`).
- Model: the exact model identifier shown in LM Studio's Model Server page.
- API key: empty for a local server with authentication disabled.
- Press **Save settings**, then **Test provider**. The reply should be `ok`.

For plain chat, use **No editor context** and leave **Let the model look things up
first** off. For code questions, select the relevant code or use **Summary +
findings + source**. Full DSL + HTML can exceed a local model's loaded context
window, even when the model supports a larger maximum context on paper.

**Route Perchance AI Agent sends into this review workspace** makes the native
Send button use this provider. Replies remain in Weld for review; editor changes
still require an explicit diff review.

## AI clients → Weld MCP bridge

The Node bridge listens only on `127.0.0.1:8765`. In the browser, open
**Weld → Dev → Agent bridge**, connect, and enable automatic reconnect. Keep the
generator tab open. Background browser throttling can delay a tool reply; the
bridge allows 90 seconds for commands and retains tabs for 120 seconds. Polls
release their HTTP connection after at most two seconds so multiple generator
tabs cannot starve command replies in the browser's shared connection pool.

For local clients, use the dependency-free stdio adapter:

```json
{
  "mcpServers": {
    "weld": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/weld-companion/bridge/weld-mcp-stdio.js"]
    }
  }
}
```

The adapter reads the existing ignored `bridge/.weld-bridge.json` locally.
Never paste its token into a prompt, a screenshot, or a committed configuration.
It forwards requests to loopback and preserves MCP sessions. It cannot start the
bridge itself. If the bridge restarts, the adapter initializes a fresh MCP session
on the next request. Restart the client's integration if tool discovery needs
refreshing after an update.

| Client | Where to configure | How to verify |
|---|---|---|
| LM Studio | `~/.lmstudio/mcp.json` | Chat → Integrations → `mcp/weld`; enable it in a dedicated Weld chat |
| Antigravity | `~/.gemini/config/mcp_config.json` | Customizations → Installed → MCP Servers → weld; enable/restart and confirm 12 tools |
| Gemini macOS app | Settings → Personal Intelligence → Connected Apps → Custom → Local MCP | Add the adapter command; the connected app exposes 12 actions under `@weldcompanion` |

For Gemini, customize its sandbox to allow **read only** on this repository's
`bridge/` folder. Leave write and execute permissions for that folder off. The
Node runtime must remain executable. Allow networking; the adapter itself only
connects to `127.0.0.1`. Full filesystem access is unnecessary.

Verify with `weld_status`, then a small `weld_get_source` request. Read
`weld_get_primer` before working on a generator. `weld_propose_edit` only queues a
proposal; users review and accept it in Weld. Leave sampling disabled unless a
reroll is intended. Do not enable all MCP tools for ordinary model chat.

When more than one generator is connected, pass `tab` with its generator name
from `weld_status` to every editor tool. A poll heartbeat is not an indication of
which tab is active; the bridge refuses ambiguous commands instead of choosing
another generator.

## Gemini web and iPhone

The account-level **Weld Remote** custom Connected App uses
`https://as-mac-mini-1.tail319f4f.ts.net/weld/mcp`. This is separate from the local
Gemini macOS connector: a phone cannot launch a Node command on the Mac.

The existing Tailscale Funnel terminates HTTPS at the OAuth gateway on loopback
port 8767. Its `/weld/mcp` route forwards through the MCP hub's `weld` entry to
the stdio adapter and the loopback bridge. The public URL contains no bridge
credential. Weld uses a separate OAuth issuer at `/weld`, and resource-bound
tokens cannot call the other Mac MCP services; legacy hub tokens cannot call Weld.

On the same Google account, select **Weld Remote** after typing `@` in Gemini web
or on iPhone. Start with “Use weld_status and list the connected generators.”
For source or proposal requests, pass the intended generator name as `tab`.
Actions retain Gemini's confirmation prompts and Weld's editor diff review.
The local handshake was verified, but the Gemini web smoke test and live iPhone
use still need verification.

The Mac must be awake, Tailscale and the bridge must be running, and the intended
Perchance tab must stay open with its Weld bridge connected. The iPhone does not
need a userscript or Tailscale connection: Gemini's servers call the authenticated
public endpoint. This does not inject the Weld drawer into iPhone Safari.

## Verification commands

```sh
npm run build
npm run check
node tests/studio-lm-smoke.js http://127.0.0.1:1234 MODEL_ID
```

Build regenerates embedded modules from `src/`. Edit those source modules rather
than the generated blocks in the userscript. Tests accept either quote style and
multiline formatting when checking the surrounding handwritten script.

See [Dev workflow](DEV.md) for proposal and bridge behavior and [Studio](STUDIO.md)
for model-context assembly.
