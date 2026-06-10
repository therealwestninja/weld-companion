<div align="center">

# ⚡ Weld Companion for Perchance

**Quality-of-life upgrades for [Perchance](https://perchance.org) — for readers, players, and authors alike.**

Favorites · reading comfort · save & pin results · undo-reroll · a full generator manager with your real folders · **two-way GitHub sync (Pull & Push)** · rename/delete that drive Perchance's own controls · an AI Helper you can edit *or point at your own GPT* · a **federated Data Manager** that browses, edits and backs up every generator's IndexedDB · an **AICC pack** for AI Character Chat with a Lore Library, character GitHub round-trip, and database repair & recovery.

[![Userscript](https://img.shields.io/badge/type-userscript-4493f8)](#install)
[![Version](https://img.shields.io/badge/version-1.32.0-3fb950)](#)
[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-supported-00485b)](https://www.tampermonkey.net/)
[![Violentmonkey](https://img.shields.io/badge/Violentmonkey-supported-663399)](https://violentmonkey.github.io/)
[![Local & account-free](https://img.shields.io/badge/your%20data-100%25%20local-3fb950)](#privacy--safety)

</div>

---

Weld Companion runs **outside** the generator sandbox as a browser userscript, so it works on **any** Perchance generator — not just ones built with the [Weld plugin suite](#relationship-to-weld). Your favorites, history, and settings stay local and account-free. The only network requests it makes are ones **you** initiate to a service **you** choose: an AI provider with your key, or your own GitHub repo with your token.

> [!NOTE]
> This is the first piece of the Weld project that runs *outside* a generator — the companion to the plugin suite.

## Table of contents

- [Install](#install)
- [Features](#features)
  - [Quality-of-life](#quality-of-life)
  - [Generator manager, directory & CRUD](#generator-manager-directory--crud)
  - [Sync with GitHub — Pull & Push](#sync-with-github--pull--push)
  - [AI Helper — edit it, or bring your own GPT](#ai-helper--edit-it-or-bring-your-own-gpt)
  - [Data Manager — browse, edit & back up every generator's IndexedDB](#data-manager--browse-edit--back-up-every-generators-indexeddb)
  - [AICC pack — Lore Library, character round-trip & repair](#aicc-pack--lore-library-character-round-trip--repair)
  - [Skybridge — the bridge to Weld generators](#skybridge--the-bridge-to-weld-generators)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Privacy & safety](#privacy--safety)
- [Compatibility & caveats](#compatibility--caveats)
- [Relationship to Weld](#relationship-to-weld)
- [Contributing](#contributing)
- [License](#license)

## Install

1. Install a userscript manager:
   - **[Tampermonkey](https://www.tampermonkey.net/)** — Chrome, Edge, Safari, Opera
   - **[Violentmonkey](https://violentmonkey.github.io/)** / **[Greasemonkey](https://www.greasespot.net/)** — Firefox
2. Open **[`weld-companion.user.js`](weld-companion.user.js)** and confirm the install when your manager prompts.
3. Browse Perchance. A single **⚡ Weld** item is added to Perchance's own menu bar, just left of the **edit** button. Click it (or press `/`) to open the drawer.

No account and no configuration are needed to start. GitHub sync and a custom AI model are optional, and each is set up in its own panel when you want it.

## Features

Weld Companion adds **one ⚡ Weld item** to Perchance's menu bar — styled like a native item, so nothing of Perchance's is replaced, displaced, or covered. It opens the **Weld drawer**, which holds a result-tools row in its header (copy / save / pin / undo-reroll) and four tabs:

| Tab | What's in it |
| :-- | :----------- |
| ★ **Generators** | Your whole generator directory grouped by your real Perchance folders, plus favorites & recents — with search, sort, and per-row open/edit. A **This Generator** panel gives the open generator two-way GitHub sync (Pull/Push), rename, delete, and backup. |
| 🗃 **Data** | A launcher for the **Data Manager**: browse, edit, back up, export and import the IndexedDB databases of every generator you've visited — full CRUD, deep-scan search, sweep backup, undo for destructive actions. When an AI Character Chat database is open, the **AICC pack** panels appear automatically. |
| 👁 **Comfort** | Eye-comfort theme filters, font size, line height, max width, a dyslexia-friendly font, focus mode — and an option to apply the same sizing to the **code editor**. |
| 🤖 **AI Helper** | A custom instruction, or route the helper to your own OpenAI / Anthropic / Google model with your key. |

### Quality-of-life

- **Favorites & recently-used.** Every generator you open is remembered. Star the ones you keep returning to, then press **`/`** to open the Generators tab and search them (↑/↓ to move, Enter to open).
- **Reading comfort** *(per-generator, remembered).* Pick a **theme** — Off / Dim / Warm / Sepia / Gray / Dark — applied as a full-page filter overlay that works on any generator without breaking its layout (each swatch previews its real effect). Adjust **font size, max width, and line height**, switch on a **dyslexia-friendly font**, or hit **Focus mode** to hide menus and sidebars for distraction-free reading and clean screenshots.
- **Comfort for the editor, too.** A toggle extends your font-size and line-height to the editor's CodeMirror panes for long authoring sessions — size and spacing only, never the font family, so indentation stays monospace and the whitespace-sensitive DSL still reads true.
- **Result tools.** **Copy / Save / Pin** live in the drawer header whenever a generator has output. **Pin** stashes a result in a side tray so you can compare several rolls at once.
- **Result history (undo-reroll).** Lost a great roll to the reroll button? Step **back and forward** through previous outputs with the arrows in the header (or **`[`** / **`]`**). Up to 50 snapshots per session.
- **Resizable inputs.** An expand/collapse toggle on text areas — for the cramped AI-chat and prompt boxes.

### Generator manager, directory & CRUD

The **★ Generators** tab is both your launcher and a real manager.

- **Your whole directory.** Hit **Load all** and the Companion loads *every generator on your account*, grouped by **your own Perchance folders** (e.g. `projects`, `legacy-plugins`). It does this by driving Perchance's own account directory — so your login is handled entirely by Perchance and **your session token is never read or sent by this script**. The list is cached locally and shows instantly next time; the button re-pulls and shows the count.
- **Search & sort.** Filter by name or folder as you type; sort by **Recent**, **A→Z**, **Favorites**, or **Folders** (folder-grouped, with headers). Keyboard nav: ↑/↓ + Enter.
- **Per-row actions:** ★ favorite, **open**, **edit**, ✕ remove from your visited list.
- **CRUD that drives Perchance's *own* functions** (so the Companion never reimplements — or holds credentials for — destructive actions):
  - **＋ New** / **Fork this** — open the editor on a fresh or copied generator.
  - **Save** — triggers Perchance's editor save (a synthetic `Ctrl/Cmd+S`). It's **captcha-aware**: if Perchance gates the save behind a Cloudflare Turnstile, you're told to complete it rather than shown a misleading "saved."
  - **Rename…** — drives Perchance's own rename (`settingsModal.changeGeneratorName`); validates the new name and confirms by watching the URL update.
  - **Delete…** — drives Perchance's own delete (`settingsModal.deleteGenerator`), which carries its own type-"yes" confirmation and redirect.

> Rename and delete are real, consequential actions, so they're handed straight to Perchance's built-in controls — Perchance performs them with its own credentials, and the Companion stays out of the loop. They appear under the **This Generator → ⚙ → Owner actions** panel and as userscript-manager menu commands.

### Sync with GitHub — Pull & Push

If your generators' source lives in a GitHub repo — one folder per generator, e.g. `<name>/<name>-top-panel.txt` (DSL) and `<name>/<name>-html-panel.html` (HTML) — the Companion gives you **two-way sync** from the **This Generator** panel. By default it's a compact row (slug · **⬇ Pull** · **⬆ Push** · **⚙**); the gear reveals the rest.

**⬇ Pull (GitHub → editor).** Fetches the two files from `raw.githubusercontent.com` (public, no auth or cookies) and fills the editor's two CodeMirror panes via the editor's own transaction pipeline — so the change is undoable with `Ctrl+Z`. You then review and click **Save**. Optionally it downloads a local backup of the current source first.

**⬆ Push (editor → GitHub).** Reads both editor panes and commits them to your repo through the **GitHub Contents API** — fetching each file's current SHA, then writing (two files = two commits). A confirmation dialog shows exactly what will be committed before anything goes out.

Push writes to your account, so it needs a token:

> [!IMPORTANT]
> **Push requires a GitHub Personal Access Token.** Use a **fine-grained token scoped to that one repo, with Contents: read & write**, and a short expiry. Paste it into **⚙ → GitHub push (token)**. It's stored locally in the script's storage, sent **only** to `api.github.com` in the `Authorization` header, and is **never logged or written into commit messages**. Clear it any time with the same panel.

Both sides share one mapping. Under the gear:

- **Files for this generator** — the DSL and HTML paths, plus optional per-generator `owner` / `repo` / `branch` overrides. Paste a full `raw.githubusercontent.com` or `github.com` file URL and it auto-fills owner/repo/branch and reduces the field to the bare path. Use this to re-point a generator whose Perchance slug doesn't match its file names (e.g. a random slug like `/fr5y67…`).
- **Repo defaults (all generators)** — your `owner`, `repo`, `branch`, and path templates (`{name}` expands to the slug). Set once; every generator follows.

The same actions are also on your userscript manager's menu: **Update editor from GitHub**, **Push editor to GitHub**, **Map THIS generator → GitHub files**, **Configure GitHub repo (global)**, and **Edit GitHub mapping (JSON)**.

> [!NOTE]
> Perchance itself has no external write API, so a **Pull never auto-saves** — the manual Perchance **Save** is always the gate for what goes live. **Push** is gated by the confirm dialog. Push is current-generator only; cross-page bulk sync isn't possible because each generator's editor lives on its own `#edit` page.

### AI Helper — edit it, or bring your own GPT

Perchance's built-in AI Helper writes generator code from a prompt. The **🤖 AI Helper** tab adds the two things it's missing:

1. **Edit the instruction.** Override the helper's system prompt with your own.
2. **Use your own model.** Route the helper through your own account on any of the three most popular APIs:

   | Provider | Default model | Key format |
   | :------- | :------------ | :--------- |
   | **OpenAI** (GPT) | `gpt-4o` | `sk-…` |
   | **Anthropic** (Claude) | `claude-sonnet-4-20250514` | `sk-ant-…` |
   | **Google** (Gemini) | `gemini-1.5-pro` | `AIza…` |

   Pick a provider, paste your key, optionally set a model, and hit **Test** to verify it. The helper's request then goes to your model — **streaming token-by-token** — and the result is written straight into the code editor. Prefer the default? Leave it on **Perchance built-in** and just use a custom instruction.

> [!IMPORTANT]
> Your API key is stored **only** in this browser and sent **only** to the provider you select. See [Privacy & safety](#privacy--safety).

### Data Manager — browse, edit & back up every generator's IndexedDB

Most Perchance generators that store state do so in **IndexedDB** — AI Character Chat, story apps, virtual pets, anything Dexie-backed. That data is partitioned per generator: each sandbox has its own origin and its own database. The **🗃 Data tab** is a federated coordinator that reaches across all of them.

Open the tab for a compact launcher showing your visited generators with data-badges and a sweep button, or click through to the full three-pane manager: **generators → databases → stores → records**, with a clickable breadcrumb, narrow-screen stacked layout, and Esc-closes-the-topmost-layer.

**What it can do.**

- **Full CRUD per record** — list paginated rows; click any row to edit its JSON with live validation, **Format**, **Copy**, **Duplicate**, or **Delete**; **+ Record** to add one. Both auto-increment and out-of-line key stores are supported.
- **Deep-scan search** — typing filters the loaded page; press **Enter** to walk the entire store with a cursor (case-insensitive, capped at 200 hits).
- **Store tools** — **Export store**, **Import into store** (a missing store is created from the dump's schema), **Clear** (with undo).
- **Database tools** — **Export DB**, **Duplicate as…**, **Delete DB** (with undo).
- **Origin tools** — **Export all** databases for a generator into one `idbml` file; **Import** a dump back in (REPLACE or MERGE).
- **⧉ Sweep backup** — visits every generator on your visited list one at a time in a hidden frame, dumps all databases into a single `idbml-sweep` file, and refreshes the per-generator data-badges in the launcher.
- **Undo for destructive ops** — record delete, store clear, and database delete each capture a pre-operation snapshot and surface an **Undo** button in the toast. Snapshots are held in an in-memory ring (up to 20 entries); if a snapshot is too large to keep it says so honestly and the action still proceeds.
- **Typed export format (`idbml-export` v1)** — `Date`, `ArrayBuffer`, typed arrays / `DataView`, `Blob` / `File`, `Map`, `Set`, `RegExp`, `BigInt`, `undefined`, `NaN` / `±Infinity` are all tagged so they round-trip with their original types. Objects that happen to contain the tag sentinel are escaped and restored — user data is never mangled.

**How it works.** IndexedDB is origin-partitioned: the top frame cannot reach another generator's data directly. The Companion runs as two roles from the same userscript file. An **agent** runs inside each 32-hex generator sandbox frame — the only context where that origin's IDB is reachable. A **coordinator and UI** runs in the top frame, maintains the candidate list from visited history and favorites, spins up a hidden iframe on demand to wake an agent for the chosen generator, and tears it down when you navigate away. The two halves communicate over a nonce-matched `postMessage` channel (`weldDataMgr/2`). Everything is driven by **IDBManEngine v1.2**, an origin-scoped engine with a connection-lifecycle wrapper that prevents leaked connections from blocking later version-bump opens.

**Reach.** The candidate set is your visited history — the same `recent` list the Generators tab uses — plus anything pulled via **Load all**. There is no browser API for enumerating all IndexedDB origins on a device, so that boundary is real and surfaced clearly in the launcher.

**Opening it.**
- The **🗃 Data tab** in the drawer
- Userscript-manager menu → **Weld: Data manager** or **Weld: Sweep backup**
- **`Shift+D`** anywhere on Perchance (ignored while typing)
- Console: `weldDataManager.open()` / `weldDataManager.sweep()`

> [!NOTE]
> Opening a generator in the manager briefly **runs it in a hidden frame** so the agent can come alive — its boot code runs for a moment. Frames are loaded on demand, one at a time, and torn down when you move on.

### AICC pack — Lore Library, character round-trip & repair

When the Data Manager opens a `chatbot-ui-v1` database — the database used by AI Character Chat and any generator built on the same schema — three typed panels appear automatically above the generic stores view. Character data is treated as private by default: the AICC panels are only visible when you've actively opened that database in the manager, and every sharing action requires explicit confirmation before any URL is shown or data is transmitted.

#### 👤 Characters

A card list pulled live from `db.characters`, with four actions per row:

- **Share link** — builds a Perchance hash URL using AICC's own field-stripping rules (drops `id`, `creationTime`, `lastMessageTime`, `folderPath`; clears `folderName`; reduces `customData` to its `PUBLIC` subtree only), so the link re-imports as a native AICC share and de-dupes by `uuid`. Nothing is uploaded; the URL is shown in a modal so you decide whether to copy it.
- **Save .json** — downloads a private character bundle. The format is `{ format: "aicc-character", character: <stripped> }`, importable by the same round-trip logic.
- **Push to GitHub…** — commits one character per run to your configured repo at `<slug>/characters/<name>.<uuid>.json` via the existing GitHub Push pipeline. Confirmation shows the exact path before committing.
- **Attach lore…** — opens a picker over your Lore Library and appends the chosen URL to that character's `loreBookUrls`. If an AICC tab is open on the same origin the write is blocked by the sentry; the panel instead shows you a share link with the lore already attached, which AICC's own import can apply.

#### 📖 Lore Library

A GM-stored catalog of lorebook URLs. Because AICC lore is a list of URLs a character fetches at runtime, a URL hosted anywhere can be shared across every character on every generator that supports lorebooks — one well-known URL is genuinely "world-wide canon" for any character pointing at it.

Add a lorebook by pasting any `https://` URL directly, or upload a local `.txt` file. Uploads go to **user.uploads.dev** (anonymous; anyone with the URL can read) or your **GitHub repo** (`lore/` folder, served from `raw.githubusercontent.com`). Both paths are enabled by default and each has a toggle in the panel header so you can turn off whichever you don't want as a default. The choice is per-upload; if both are enabled you're asked which to use at upload time.

> [!NOTE]
> Direct upload to user.uploads.dev requires a small agent extension that isn't currently included. The upload path falls back to GitHub, or you can paste the URL of a file you've already uploaded elsewhere.

#### 🔧 Repair & recovery

The Repair panel has two modes.

**Run diagnosis** is a read-only scan that checks the same fields AICC's own boot-time upgrade code repairs: missing or invalid character `uuid`s, threads whose `characterId` points at a nonexistent character, messages whose `threadId` points at a nonexistent thread, and summaries AICC will silently discard on the next schema upgrade. The results are reported with counts and per-row context.

**Repair this database…** turns the diagnosis into an action plan using AICC's own repair rules, then shows you the plan before touching anything:

- Characters are normalized to the full set of field defaults AICC fills in on boot (`customCode`, `userCharacter`, `scene`, `streamingResponse`, `roleInstruction` migrated from legacy `systemMessage`, `avatar` migrated from legacy `avatarUrl`, `loreBookUrls`, `autoGenerateMemories`, `maxTokensPerMessage`, and others). Characters with no `id` are dropped and counted; characters with a missing or invalid `uuid` get a fresh one minted.
- Threads with a dead `characterId` are recovered by scanning their messages for the first one with a real `characterId`, falling back to any existing character.
- Messages and lore rows that are structurally broken (no `id`, or pointing at a thread that no longer exists after recovery) are dropped. Messages are normalized to include `variants: [null]` if missing.

After reviewing the plan ("12 characters normalized, 3 threads recovered, 5 orphan messages dropped"), you have two options:

- **Export repaired copy** — downloads the repaired result as an `idbml` file without touching the live database. Use this to verify the output by importing it somewhere first.
- **Back up & apply** — downloads a full pre-repair backup of the current database, then rewrites `characters`, `threads`, `messages`, and `lore` from the repaired plan. The `summaries`, `memories`, and embedding caches are left untouched. The planner is a set of pure functions that never mutate your data until you confirm; the backup comes before any write.

Both options are gated by the **cooperative sentry**: if an AICC tab is open on the same origin, all writes are blocked and the panel explains why. The sentry pings a `BroadcastChannel` per origin and waits 800 ms for any response from a tab it didn't spawn itself; a response means AICC is live. When AICC is closed, the engine writes directly. This is the same gate used for all other AICC pack writes — two writers on a Dexie `++id` store corrupt sequences, and the sentry is the only thing standing between the Companion and that failure mode.

> [!NOTE]
> The sentry is cooperative on unmodified AICC — AICC itself doesn't broadcast its presence, so the Companion can only detect it by waiting for a reply. If a tab is open but unresponsive (background, sleeping), the timeout may not fire a response. The safe default is therefore to close AICC before using repair or any other write from the Companion.

### Skybridge — the bridge to Weld generators

Weld Companion is the **anchor end** of `weld.skybridge`. A generator that imports the **`weld-skybridge-plugin`** can — *with your per-generator consent* — ask the Companion for things it cannot do from inside the sandbox:

- **Cross-generator storage** — namespaced, persistent key/value held on the generator's behalf. With no Companion installed, the plugin falls back to its own storage and honestly reports `has('storage') === false`.
- **Your own AI model** — run a completion through the model **you** configured. Your key **never crosses the bridge**; only the prompt goes up and the text streams back.
- **A cross-tab message bus** — `bus.publish` / `bus.subscribe` on named channels, relayed across different generators and tabs over a `BroadcastChannel` on the shared `perchance.org` origin. This is the transport **`weld.swarm`** rides on for multi-agent orchestration.
- **Web fetch** — fetch a URL on the generator's behalf (cookie-free, `http`/`https` only, never local or private-network addresses, size-capped).
- **Web search** — a keyless DuckDuckGo Instant-Answer lookup (title / url / snippet) for lightweight grounding.
- **Model info** — the name and approximate context size of the model you configured (never the key, no network call).

Under the hood it's a two-way `postMessage` handshake between the Companion (top frame) and the plugin (the generator's `*.perchance.org` child iframe), with a negotiated protocol, per-message nonce, and origin checks. Consent is **per-capability and per-generator**, asked once and remembered. Both ends log the handshake to the console (`[WeldCompanion]` / `[skybridge]`) so a misconnection is diagnosable rather than silent.

> [!IMPORTANT]
> **A generator must *trigger* the plugin.** Importing `{import:weld-skybridge-plugin}` only *defines* its `$output`; call it once early in your panel JS so it initializes `window.weld.skybridge`:
> ```js
> if (typeof root !== 'undefined' && typeof root.weldSkybridge === 'function') root.weldSkybridge();
> var sb = window.weld && window.weld.skybridge;   // now available
> ```
> The call is idempotent. Without it, `window.weld.skybridge` stays `undefined`.

## Keyboard shortcuts

| Key | Action |
| :-: | :----- |
| `/` | Open the Weld drawer (Generators tab) |
| `f` | Favorite / unfavorite the current generator |
| `c` | Copy the current output |
| `[` `]` | Previous / next result (undo-reroll) |
| `Shift+D` | Open the Data Manager |
| `?` | Show the shortcut cheat-sheet |
| `Esc` | Close the drawer |

*(Shortcuts are ignored while you're typing in an input.)*

## Privacy & safety

- **Your data is 100% local.** Favorites, history, comfort settings, pins, your cached directory, and your Lore Library catalog all live in your userscript manager's storage, in your browser. Nothing is uploaded automatically.
- **The Data Manager never phones home.** It reads, edits, and snapshots IndexedDB databases entirely within your browser. Export files are downloaded by you; imports are picked by you. No generator data crosses the network as a result of the Data Manager or AICC pack.
- **Character data is private by default.** The AICC panels only appear when you've actively opened an AI Character Chat database. Every sharing action — share link, GitHub push, lore upload — requires explicit confirmation before anything leaves your device.
- **Credentials are scoped to one destination each, and never logged:**
  - Your **AI key** is sent only to the provider you pick.
  - Your **GitHub token** is sent only to `api.github.com`, in the `Authorization` header — never logged, never placed in commit messages or file content. Use a fine-grained, single-repo, Contents-read/write token.
- **Your Perchance login is never handled by this script.** Directory loading, rename, and delete all drive Perchance's own controls, which carry their own credentials. The Companion reads the results but never reads or transmits your session token.
- **Pull is read-only and anonymous** — it fetches `raw.githubusercontent.com` files with no auth or cookies, fills the editor locally, and never saves or pushes on its own.
- **Declared `@connect` hosts:**

  ```
  @connect api.openai.com                       # OpenAI
  @connect api.anthropic.com                    # Anthropic
  @connect generativelanguage.googleapis.com    # Google
  @connect api.duckduckgo.com                   # keyless web search, only when a Weld agent asks (consent-gated)
  @connect perchance.org                        # generator metadata
  @connect raw.githubusercontent.com            # GitHub Pull (your repo's public source files)
  @connect api.github.com                       # GitHub Push (Contents API, with your token)
  @connect *                                    # consent-gated web fetch for Weld agents, and custom model endpoints you configure
  ```

  Out of the box, calls go only to the AI provider you choose, `perchance.org`, and your own GitHub files. The `*` and DuckDuckGo hosts are reached only through per-generator, consent-gated web-fetch / web-search capabilities or a model endpoint you configure — never silently. Every network call uses the privileged `GM_xmlhttpRequest`, so the Companion keeps working even if Perchance enforces its Content Security Policy.

- **`@grant unsafeWindow`** lets the Companion read the editor's globals and drive Perchance's own modals and the Skybridge handshake on the real page window. It isn't used to alter page content beyond that.
- **It can't break Perchance.** Every feature is feature-detected against Perchance's internals and silently no-ops if something is absent or renamed. The whole script is wrapped so it never throws into the host page.
- **Focus mode hides *your own* clutter** (menus, sidebars) for reading and screenshots. It is **not** an ad blocker — please use it within Perchance's terms.

## Compatibility & caveats

- Tested with **Tampermonkey** and **Violentmonkey**; Greasemonkey should work (uses only standard `GM_*` APIs). Runs on `perchance.org` and `*.perchance.org`. All UI lives in the top frame; only the Data Manager agent runs inside generator sandbox frames (and exits immediately on non-sandbox subdomains).
- **Lives inside Perchance's own bar.** The ⚡ Weld item is inserted left of the **edit** button and height-locked so it never distorts the bar. If a page has no Perchance bar (e.g. *minimal* mode), nothing is injected — the `/` shortcut still opens the drawer, and the item is added if the bar appears later.
- **Themes use a `backdrop-filter` overlay**, so they work on any generator without touching its DOM. "Dark" is an inversion (the standard dark-mode trick), so it renders photos in negative — the non-invert themes (Dim / Warm / Sepia / Gray) are safer on image-heavy generators.
- **GitHub Push is two commits, not one atomic commit**, and has no pre-push diff. If GitHub changed since your last Pull, Push wins. (Atomic multi-file commits and a sync-status/diff view are on the roadmap.)
- **Data Manager reach is bounded by visited history.** There is no browser API for enumerating all IndexedDB origins on a device, so the manager can only reach generators that have run on this device (plus anything pulled via **Load all**). Opening a generator in the manager briefly runs it in a hidden frame — its boot code executes for a moment.
- **The AICC sentry is cooperative.** Unmodified AI Character Chat doesn't broadcast its presence, so the Companion detects it by waiting for a `BroadcastChannel` reply. Close AICC before using any write from the Companion to be safe; a background or sleeping AICC tab may not reply within the timeout.
- Perchance's internal hooks are **not a documented API** — Perchance can rename them at any time. When that happens, the affected feature quietly stops working (or falls back) rather than erroring; update the script and it resumes.
- **Skybridge needs both halves deployed.** Updating the userscript is one end — the matching `weld-skybridge-plugin` generator must also be imported and **re-saved** (and any generator importing it re-saved, to bust Perchance's import cache). The console handshake logs tell you which end is live.

## Relationship to Weld

Weld is a suite of composable plugins for building Perchance AI generators. **Weld Companion is its first userscript** — the layer that improves the experience *around* any generator, which a plugin (running inside the sandbox) structurally cannot do.

Planned additions:
- **Weld Lint overlay** — run Weld's brace-trap scanner live in the editor and underline issues as you type.
- **A richer GitHub manager** — a sync-status badge and pre-Pull/Push diff, building on the two-way sync that's already here.
- **Atomic GitHub commits** — push DSL + HTML as a single commit rather than two.
- **Direct user.uploads.dev upload** — a small agent extension to let the Lore Library upload directly to user.uploads.dev from any origin without needing the GitHub path as a fallback.

## Contributing

Issues and PRs welcome. Because the script leans on undocumented Perchance internals, the most useful reports include:
- your browser + userscript manager and versions,
- which feature misbehaved,
- and (if relevant) whether you were in **edit** mode or **view** mode.

Keep changes feature-detected and fail-soft — never break the host page.

## License

MIT © 2026 **therealwestninja**

- DeviantArt: [west-ninja](https://www.deviantart.com/west-ninja)
- GitHub: [therealwestninja](https://github.com/therealwestninja)
