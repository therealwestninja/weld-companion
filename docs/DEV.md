# Dev tab: files, AI agents and GitHub

The **Dev** tab (Weld drawer, then Dev) connects the generator you are editing to plain files, to AI coding agents, and to GitHub. One rule runs through all of it: **nothing changes your editor without showing you a diff and getting your click.** You also still press Save in Perchance yourself.

Contents: [Folder sync](#folder-sync) · [Agent bridge](#agent-bridge-mcp) · [GitHub agents and pull requests](#github-agents-and-pull-requests) · [AI helper upgrades](#ai-helper-upgrades) · [Find usages and rename](#find-usages-and-rename) · [Editor markers](#editor-markers) · [Regression check](#regression-check) · [What is and is not verified](#what-is-and-is-not-verified)

## Folder sync

Mirrors the open generator to ordinary files in a folder you choose, so any editor or agent can work on them while you stay in Perchance.

**Set up.** Open a generator's editor, then Dev, then Folder sync, then **Choose folder...** and pick the folder (for example `D:\projects\perch_backups_folder_sync`). The browser remembers the choice; after you restart it, press **Allow access** once. It needs a Chromium browser (Chrome, Edge), because other browsers do not let web pages open folders.

**Files.** `<name>/<name>-top-panel.txt` (lists panel) and `<name>/<name>-html-panel.html` (HTML panel), the same layout as the GitHub backup. Only generators with a safe name (letters, digits, `-`, `_`) are written, and only inside the folder you picked.

**What Weld shows** (checked every few seconds while the page is open):

| State | Meaning | What you can do |
|---|---|---|
| In sync | Editor and folder match | nothing |
| Folder has no copy | First time for this generator | **Write editor to folder** |
| Editor ahead | You edited, the folder did not change | **Write editor to folder**, or tick the automatic option |
| Folder ahead | An agent or editor saved the files | **Review changes...** then **Apply folder copy** |
| Conflict | Both changed since the last sync | review the diff, then choose a side; overwriting asks first |
| Unknown | Differ, and there is no earlier sync point | **Treat folder as latest** or **Treat editor as latest** |

Folder changes are **never** applied automatically, and you get a notification when one arrives. Applying is a normal editor change, so **Ctrl+Z** undoes it. Windows line endings and trailing blank lines are not treated as changes. The optional "write the editor to the folder automatically" only writes local files.

Also here: **Download published copy** (fetches the saved version from Perchance into the folder), **Download all starred generators**, and a list of the generators already in the folder.

**Download all files and assets (this generator)** saves the current editor panels,
all files from its selected `src` draft, and readable cached public assets/models
into `<name>/` in the master save folder. Models are assembled into complete files
under `.weld-backup/assets/`; source files keep their `src/` paths. The local
`.weld-backup/local-manifest.json` records origins, file sizes and SHA-256 checksums.
This option uses the current editor, including unsaved changes, rather than the
published copy. It requires the generator's editor and preview to be loaded.

After that manual download succeeds, automatic project and asset updates are
enabled **only for that generator**. Other generators require their own explicit
selection. Checks run once a minute while that editor is visible and folder
access remains granted; reopening its editor resumes them. The setting also
works when ordinary folder watching is off. Unchanged files are not replaced,
and a changed computer copy blocks automatic replacement when the browser copy
changes too. Use a manual download to explicitly replace matching local files.
Removed source/cache files are retained locally; the manifest lists the current
snapshot. No private chat databases, credentials, ordinary HTTP cache or storage
from other origins are exported; the status reports unavailable storage.

**Pause project and asset updates (this generator)** stops just these updates.
**Pause automatic writes in all tabs** stops both panel mirroring and all project
and asset updates. Changing or disconnecting the save folder clears these
opt-ins, so another location is never populated automatically.

## Agent bridge (MCP)

Lets agents such as Claude Code, Codex, Gemini CLI, Antigravity and Copilot's agent mode **read the generator you have open and propose changes**, through a small program on your computer. It uses MCP, the standard way these tools connect to other programs.

```
agent  --MCP over HTTP-->  bridge (your computer, 127.0.0.1)  <--Weld polls--  the userscript in your browser
```

**Start it** by double-clicking `start-bridge.cmd` in the project folder (Windows). A window opens, prints the setup line for each agent, and copies the token to your clipboard; keep the window open while you use the bridge, and close it to stop. From a terminal in the project folder the equivalent is:

```bash
npm run bridge
```

It prints a secret URL and the one-line setup for each agent, and keeps the same token between runs (stored in `bridge/.weld-bridge.json`, which git ignores; `--rotate-token` makes a new one, `--port <n>` changes the port).

**Start it automatically (no terminal).** A userscript cannot launch programs, so the bridge has to be a process on your computer. Run this once and it starts hidden (no window) at every Windows login; `-Remove` undoes it. If a bridge is already running, starting another just says so and exits.

```powershell
pwsh -File bridge\install-autostart.ps1
```

**macOS: start it automatically.** Use a launchd agent instead. Run this once from the project folder (zsh); it starts the bridge at every login and restarts it if it stops. The log goes to `/tmp/weld-bridge.log`, which also shows the MCP URL.

```bash
NODE=$(which node)
P=~/Library/LaunchAgents/com.weld.bridge.plist
cat > "$P" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.weld.bridge</string>
<key>ProgramArguments</key><array><string>$NODE</string><string>$PWD/bridge/weld-bridge.js</string></array>
<key>WorkingDirectory</key><string>$PWD</string>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>/tmp/weld-bridge.log</string>
<key>StandardErrorPath</key><string>/tmp/weld-bridge.log</string>
</dict></plist>
EOF
launchctl bootstrap gui/$(id -u) "$P"
```

To stop and remove it: `launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.weld.bridge.plist && rm ~/Library/LaunchAgents/com.weld.bridge.plist`. If you later change Node versions (nvm), re-run the block so the plist points at the new `node`. Then add it to Claude Code without pasting the token into chat:

```bash
claude mcp add --scope user --transport http weld "http://127.0.0.1:8765/mcp/$(node -e 'console.log(require("./bridge/.weld-bridge.json").token)')"
```

**Connect Weld.** In the Dev tab, Agent bridge: press **Connect**. Weld fetches the token from the bridge itself (nothing to paste; the bridge only gives it to the userscript, since a web page cannot send the required `X-Weld-Pair` header). Tick "reconnect automatically" and it connects at each page load, waits for the bridge if it is not up yet, and re-pairs if the bridge was given a new token. You can still paste a URL and token by hand.

**Add it to your agents** (use the MCP URL the bridge prints):

| Agent | Setup |
|---|---|
| Claude Code | `claude mcp add --transport http weld <URL>` |
| Codex CLI | in `~/.codex/config.toml`: `[mcp_servers.weld]` and `url = "<URL>"` |
| Gemini CLI | in `~/.gemini/settings.json`: `"mcpServers": { "weld": { "httpUrl": "<URL>" } }` (the folder must be trusted) |
| Copilot (VS Code) | in `.vscode/mcp.json`: `{ "servers": { "weld": { "type": "http", "url": "<URL>" } } }` |
| Antigravity, others | add an HTTP ("streamable") MCP server with the URL; if only stdio is supported, use `npx mcp-remote <URL>` |

**What agents can do:**

| Tool | Does |
|---|---|
| `weld_get_primer` | Perchance syntax and editing rules (works even if Weld is not connected) |
| `weld_status` | which tabs are connected and whether each editor is open |
| `weld_get_source` | the live source with line numbers, including unsaved edits |
| `weld_get_findings`, `weld_get_outline`, `weld_find_usages`, `weld_search`, `weld_get_imports`, `weld_get_html_map` | the same analysis the Project tab shows |
| `weld_sample` | re-rolls the generator and returns statistics. **Off unless you tick "Let agents run samples"**, because `update()` can have side effects on some generators |
| `weld_propose_edit` | proposes a change to one panel, as new text or as line edits |
| `weld_proposal_status` | pending, applied, rejected or out of date |

**Proposals.** An agent's edit never touches the editor. It appears under **Agent proposals** with the agent's name, its note and a diff; you choose **Apply** or **Reject**. If you changed that panel after the proposal was made, it is marked out of date and cannot be applied. The queue is kept in memory only, so it is cleared when the page reloads.

**Security.** The bridge listens on `127.0.0.1` only. Every address contains a random 192-bit token, and requests whose `Host` or `Origin` is not local are refused (this stops a website from reaching it). Weld only connects to a bridge URL on your own computer and never sends editor contents anywhere else. The token is stored in your userscript manager and is **excluded from the state export**. An agent can read your open generator while you are connected, so connect only agents you trust, and press Disconnect when you are done.

**If it does not connect:** check the bridge is running and the token matches (Weld says "rejected the URL or token"); allow your userscript manager's prompt for `127.0.0.1`; and open the generator's editor if an agent reports that proposals cannot be made.

## GitHub agents and pull requests

**Ask an agent through GitHub.** Dev, GitHub agents: describe the task, choose an agent and a task mode, and Weld creates an issue in your backup repo with your request, the file paths, task rules and Weld's findings. No token and no code is posted.

**Task mode:** Auto treats analysis, explanations and uncertain requests as read-only; it recognizes common explicit change requests. Choose **Analyze and report (read-only)** to require an answer without file edits, commits, pushes or a pull request, or **Change code** for an implementation request Auto does not recognize. The confirmation shows the resolved mode before creating the issue. Analysis issues omit edit and merge instructions; Copilot assignment instructions and Claude/Codex mentions carry the same mode. These are agent instructions, not a permission barrier enforced by GitHub.

| Choice | What happens | Needs |
|---|---|---|
| GitHub Copilot cloud agent | the issue is assigned to Copilot with the selected task mode | Copilot cloud agent enabled on the repo |
| Claude (Claude Code GitHub Action) | Weld adds an `@claude` comment | the Claude GitHub app or action set up on the repo |
| Codex cloud | Weld adds an `@codex` comment | Codex cloud connected to the repo |
| Plain issue | just creates the issue | nothing |

Your GitHub token (GitHub tab) needs **Contents** and **Issues** read and write; for Copilot also **Pull requests** and **Actions**. Agents read the repository copy ("Check repo copy" tells you if it differs from your editor). For requested code changes, push your latest editor first; when the resulting pull request is merged, press **Pull** in the GitHub tab to load it. Read-only analysis requires no generator changes or merge.

**Push as PR** (GitHub tab) commits the editor to a new branch (`weld/<name>-<date>`) and opens a pull request into your configured branch, so nothing reaches that branch until you merge. The ordinary **Push** now also lists Weld's analyzer findings in its confirmation dialog (switch this off in Code checks).

## AI helper upgrades

In **Tools, AI Helper**:

- **Perchance primer.** Requests include a short, verified Perchance reference and editing rules (about 650 tokens), so replies use real Perchance and keep your list names and ids. On by default; switch it off in the AI settings.
- **Look things up first.** Tick "Let the model look things up first" and the model can ask Weld for the outline, findings, specific lines, searches and usages before it answers. It works with every provider, including local models without native tool calling, and the lookups are read-only.
- **More providers.** OpenRouter (many hosted models behind one key) and GitHub Models (a GitHub token with the `models:read` permission).
- **Prompt caching.** With Anthropic, the large code context is sent as a cacheable block and the request after it, so follow-up questions about the same code are cheaper and faster.
- The Anthropic default model is now `claude-sonnet-5-5`. Saved settings are unchanged.

## Find usages and rename

Dev, Find usages and rename: pick a list, **Find usages** lists every definition and use across both panels (click one to jump to it), and **Preview rename** shows a diff of renaming it everywhere, including `root.name`, inline handlers and script code. Check the code lines in the diff, then **Apply rename** (Ctrl+Z undoes it). It refuses a name that already exists, an element id that matches, JavaScript keywords and invalid names, and it refuses to apply if you edited after the preview.

## Editor markers

Dev, Editor markers: draws a small coloured bar beside lines that have findings (orange warning, red error); hover for the reason. It only decorates the editor and never edits. Lines scrolled out of view are drawn when they scroll in.

## Regression check

Dev, Regression check: **Save baseline** re-rolls the generator and keeps the results; after you edit, **Compare with baseline** re-rolls again and reports changes in length, repeats and vocabulary (for example "3 common words no longer appear"). Use it on generators whose `update()` has no side effects.

## What is and is not verified

Checked by automated tests (`npm run check`): the analyzer, rename and usages, edit proposals, folder-sync states, the bridge's MCP transport and security checks against a real HTTP server, every Dev tab workflow against a fake page, and the provider request shapes.

Checked by hand in a browser with the built script: the folder-sync cycle (write, agent edit, review, apply) using the browser's real folder API; the full agent loop (a client reads the live editor, proposes an edit, you review and apply it, the client sees "applied"); the Claude Code MCP client connecting to the bridge; and editor markers on a real Perchance editor.

**Not verified:** a complete session with Codex, Gemini, Copilot or Antigravity (their MCP setup above follows each tool's documentation); sampling inside a real Perchance sandbox frame; the Copilot, `@claude` and `@codex` issue flows against live GitHub (the request formats follow GitHub's documentation and are covered by tests with a fake API); and a real userscript manager.
