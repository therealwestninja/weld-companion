<div align="center">

# ⚡ Weld Companion for Perchance

**Quality-of-life upgrades for [Perchance](https://perchance.org) — for readers, players, and authors alike.**

Favorites · reading comfort · save & pin results · undo-reroll · a full generator manager with your real folders · **two-way GitHub sync (Pull & Push)** · rename/delete that drive Perchance's own controls · a **Library** tab for readers and players — a permanent cross-generator **Scrapbook**, AICC **chat-story export** (styled HTML / Markdown / text), a **backup guardian**, night light, and read-aloud · a **Tools** tab housing the AI Helper (edit it *or point at your own GPT*) and AICC character file import/export · a **federated Data Manager** that browses, edits and backs up every generator's IndexedDB · an **AICC pack** for AI Character Chat with a Lore Library, character GitHub round-trip, and database repair & recovery with quarantine.

[![Userscript](https://img.shields.io/badge/type-userscript-4493f8)](#install)
[![Version](https://img.shields.io/badge/version-1.49.0-3fb950)](#)
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
  - [Library — for readers & players](#library--for-readers--players)
  - [Tools — AI Helper & character files](#tools--ai-helper--character-files)
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
   - **[Violentmonkey](https://violentmonkey.github.io/)** — Firefox
2. Open **[`weld-companion.user.js`](weld-companion.user.js)** and confirm the install when your manager prompts.
3. Browse Perchance. A single **⚡ Weld** item is added to Perchance's own menu bar, just left of the **edit** button. Click it (or press `/`) to open the drawer.

No account and no configuration are needed to start. GitHub sync and a custom AI model are optional, and each is set up in its own panel when you want it.

## Features

Weld Companion adds **one ⚡ Weld item** to Perchance's menu bar — styled like a native item, so nothing of Perchance's is replaced, displaced, or covered. It opens the **Weld drawer**, which holds a result-tools row in its header (copy / save / pin / undo-reroll) and four tabs:

| Tab | What's in it |
| :-- | :----------- |
| ★ **Generators** | Your whole generator directory grouped by your real Perchance folders, plus favorites & recents — with search, sort, and per-row open/edit. A **This Generator** panel gives the open generator two-way GitHub sync (Pull/Push), rename, delete, and backup. |
| 📒 **Library** | The reader's home, grouped by task. **📚 Collect**: a permanent **Scrapbook** of saved results (searchable, taggable, exportable), **Chat stories** (read or export any AICC thread as styled HTML, Markdown, or text), **clipboard history**, and your **👍/👎 ratings**. **🛡 Care**: a **backup guardian**, a **time tracker** (per-generator minutes, CSV export), a **time capsule**, **output rules** (post-processing on save), and **Move everything** (full state export/import). Plus **search everything**, **session replay**, and a **spaced-repetition review queue** in Collect; **My Perchance** stats, **tab snapshots**, **My boundaries**, and a **Ctrl/Cmd+Shift+S** quick-save hotkey; a **keepsake HTML archive** and **recommendation bundles** to share generators; **lore link health** (catches removed/quarantined uploads before they break a character), **generator watch** (update notifications for favorites), and a one-click **platform speed check**; night light gains an **ambient mode** that follows hour and season. A sticky header keeps save / read-aloud / rate / random-favorite in reach. |
| 🗃 **Data** | A launcher for the **Data Manager**: browse, edit, back up, export and import the IndexedDB databases of every generator you've visited — full CRUD, deep-scan search, sweep backup, undo for destructive actions. When an AI Character Chat database is open, the **AICC pack** panels appear automatically. |
| 👁 **Comfort** | Eye-comfort theme filters, font size, line height, max width, a dyslexia-friendly font, focus mode — and an option to apply the same sizing to the **code editor**. |
| 🛠 **Tools** | Tool cards. **AI Helper**: a custom instruction, or route the helper to your own OpenAI / Anthropic / Google model with your key. **Character Files**: import and export AI Character Chat character `.json` files, or fetch one straight from a GitHub raw URL. |

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

### Library — for readers & players

Everything in the **📒 Library** tab is for people who *use* generators rather than write them. It's organised by task rather than by feature: a sticky header keeps the actions you reach for constantly — **Save current output**, **Read output** aloud, **Stop**, and **🎲 Random favorite** — above two views you switch between, **📚 Collect** and **🛡 Care**.

#### 📚 Collect — the things you keep

##### 📌 Scrapbook

A permanent, cross-generator collection of saved results. The drawer's **Save** button downloads a one-shot file and **Pins** are per-generator and capped at 12 — the Scrapbook is where great rolls actually live. One click saves the open generator's current output — captured from **inside the generator's sandbox frame** via the agent, reading the real output container and skipping Perchance's own frame chrome (the fullscreen / reload / warnings strip) and any inline scripts. On an AI Character Chat page it recognises the conversation and points you to **Chat stories** instead, where the whole thread exports cleanly from the database; every entry is searchable (text, generator, tags, notes), taggable, annotatable, readable aloud, and links back to the generator it came from. The whole collection (including your per-generator notes) exports to a single JSON file and imports back with duplicate-safe merging. Capacity is 500 entries; when full, the oldest entry rotates out and the save tells you so.

##### 🔍 Search everything

One box that searches everything you've kept, across every generator: Scrapbook entries (title, text, tags, notes), clipboard history, per-generator notes, your 👍/👎 ratings, and recently visited generators — ranked by kind and recency. Copy a hit's text or jump straight to its generator.

##### ⏺ Sessions

Capture the current page's roll history — the same ring the ◀ ▶ history bar walks — as a named, read-only session (up to 20 kept). Replay it in a transcript view with per-roll copy, or export the whole session as Markdown. Works wherever the result-history bar works: generators that render output on the page itself.

##### 🔁 Review

Spaced repetition over your Scrapbook: enroll any entry — vocabulary, names, prompts you want to internalise — and it surfaces here when due. "Got it" stretches the next review out along a 1 → 3 → 7 → 21 → 60-day ladder; "Again" starts the ladder over. Due items appear oldest-first, five at a time.

##### ⭐ Recommend

Recommend a generator to a friend as a small file: the generator slug, your note on why, and an optional sample output. They open it in their Companion — a card shows your note and sample with one-click "Add to favorites" or "Open it." Travels like a character file: no server, no account. (Validated on import; a non-recommendation file is rejected cleanly.)

##### 📋 Clipboard history

Anything you copy on a Perchance page — including text selected *inside* a generator's sandbox frame, which the top page normally can't see (the agent captures the selection at copy time and pushes it up) — lands in a local ring buffer, newest first, capped at 50 with consecutive duplicates skipped. Retrieve a clip an hour after you copied over it: copy it back out, or promote it to a Scrapbook entry in one click. Stored only in this browser; never reads the clipboard itself, only the selection at the moment you copy.

##### 👍 My ratings

Thumbs-up / thumbs-down buttons in the Library header log whether the current roll was good, building a private per-generator quality record (capped at 500 entries with a best-effort snippet). The ratings view tallies 👍/👎 per generator so you can see which ones consistently deliver for you.

##### 📖 Chat stories

People write long roleplay stories in AI Character Chat with no good way to keep or share them — the raw database export is unreadable. This panel lists every chat thread in any AICC-compatible generator (newest first, with character names), and each thread can be **read** in a clean transcript modal — with read-aloud and a reading-progress bar — or **exported** as a styled HTML page (chat-bubble layout, avatars, light/dark aware), Markdown, or plain text. Strictly read-only: nothing is ever written to the chat database. Message visibility follows AICC's own rules — messages hidden from the user stay hidden, system messages are excluded by default, and all exported HTML is fully escaped (generator HTML is never re-emitted), with only a small safe markdown subset rendered.

#### 🛡 Care — keeping your data safe

##### 🛡 Backup guardian

The most common disaster for casual users is the browser quietly evicting months of chats. The guardian shows when your last sweep backup ran, this origin's storage usage against its quota, and whether the browser has marked the storage **persistent** (if not, it says so plainly — eviction is a real risk). One click runs a sweep. If backups are more than 14 days overdue, a gentle reminder toast appears at most once per day.

##### 📊 My Perchance

A reflective summary of your activity, entirely local: time today and this week, your current daily streak, total saves, your 👍/👎 split, the generators you spend the most time with, and the ones you save from most.

##### 📸 Tab snapshots

Save the set of Perchance tabs you have open right now — every tab with the Companion running answers a presence ping over a BroadcastChannel — as a named snapshot (up to 15 kept), and restore the whole working set later with one click. "Fantasy campaign, session 4": five generators, reopened together. Your browser may ask to allow pop-ups for perchance.org the first time you restore.

##### 🔗 Lore link health

The Lore Library stores URLs, and uploads on user.uploads.dev get removed or quarantined over time — silently breaking any character that references them. This card checks each stored lore URL (at most once a day per link, ten per pass, politely spaced) and classifies it: alive, **returned a page** (the tell-tale quarantine signature — an HTML page where a file should be), or dead. Broken links surface with a direct path to the quarantine list. *(online)*

##### 👀 Generator watch

Watches your starred generators' page source and flags when one changes — "this generator was updated." Honest caveat stated in the card: generators with dynamic shell HTML can flag without a real edit; "mark seen" re-baselines. Checks run on demand, up to 30 favorites, spaced half a second apart. *(online)*

##### 🚦 Platform check

"Is Perchance slow right now, or is it me?" One click times a fetch of the platform root and answers plainly: fast (a slow generator is that generator's fault), normal, slow (the platform itself is sluggish), or unreachable. *(online)*

##### ⏱ Time on Perchance

A 30-second heartbeat counts time per generator per day — only while the tab is visible *and* focused, only in this browser, never uploaded. The card shows today and the last 7 days with your top generators, and exports the full log as CSV. Entries older than 90 days are pruned automatically.

##### ⏳ Time capsule

Write a message, pick a future date, seal it. The first time you open Perchance on or after that date, it surfaces — a reminder to revisit a story, a note to your future self. Delivered capsules stay readable in the card until you delete them.

##### ✂ Output rules

Per-generator post-processing applied when output is *saved* (Save current output or quick-save) — the live page is never modified. Rule types: literal or regex find/replace, prefix, suffix, trim, and whitespace collapse; rules can be reordered, toggled off, or set under "all generators" to run everywhere. A bad regex skips that rule instead of poisoning the chain.

##### 🧳 Move everything

One file containing everything the Companion remembers — Scrapbook, clips, capsules, ratings, time log, notes, rules, favorites — exported as JSON and importable on any other browser. **Merge** mode unions lists (by id, local wins on conflicts), sums time-tracking numbers, and shallow-merges note maps so an import never silently destroys local work; **replace** mode makes the file win wholesale per key.

##### ⌨ Quick-save hotkey

**Ctrl/Cmd+Shift+S** anywhere on a Perchance page: if text is selected — even inside the generator's sandbox frame, where the agent captures it — the selection is saved straight to the Scrapbook (tagged `quicksave`); with nothing selected, the generator's current output is saved instead, with your output rules applied.

##### 🛡 My boundaries

Topics you don't want, styles that distress you, lines not to cross — written once, kept locally. One click copies it prefixed as an instruction ("My boundaries for this conversation — please respect them throughout") to paste as the first message of any AI chat. Honest scope: the Companion can't inject this into chats automatically, so it stays a deliberate, visible step rather than invisible plumbing.

##### 📜 Keepsake archive

A single self-contained HTML page holding your saved results and time capsules — readable by anyone with a browser, no app or extension or Perchance account. Made for keeping, printing, or passing on. All saved text is fully HTML-escaped so arbitrary content can't break the page. (Chat stories live in AICC's own database; export those from the Chat stories card.)

##### 🗒 Note badge

If you've saved a note on a generator, a small floating 🗒 badge appears when you visit it — click to read or edit without opening the drawer.

##### Small comforts

**Read aloud** speaks the current page's output, any Scrapbook entry, or a whole chat story using the browser's built-in speech — local, no network, no key. **Per-generator notes** let you jot "great for elf names" on any generator, searchable from the Scrapbook box. **🎲 Random favorite** (in the sticky header) jumps to a random starred generator. **Night light** now lives in the **Comfort** tab beside the theme it controls — it auto-applies a comfort theme (Warm, Dim, Sepia, Gray, or Dark) on an hour schedule, e.g. Warm from 20:00 to 07:00 — or in **ambient mode**, where the theme follows the hour and season (warm in the evening, earlier in winter, later in summer; dark late at night; southern-hemisphere aware) — restoring your previous theme outside those hours; your manual comfort settings always win when it's off.

### Tools — AI Helper & character files

The **🛠 Tools** tab holds self-contained tool cards.

#### 🤖 AI Helper

Perchance's built-in AI Helper writes generator code from a prompt. This card adds the two things it's missing:

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

#### 👤 Character Files

Surfaces AI Character Chat character files without opening the Data Manager. Works against the generator you currently have open.

- **Import characters** — load a `.json` file: a single-character bundle saved by this manager, an AICC share-link envelope (`{ addCharacter: … }`), a raw character object, or a multi-character export. Every character is validated and normalized (the same sanitizer the repair tools use) before anything is written, so a corrupt file can't poison the database. If an AICC tab is open, direct writes are blocked by the sentry and you get per-character **share links** instead — open each in AICC and its own import flow handles the merge. If AICC is closed, characters are written directly, de-duplicated by `uuid` exactly the way AICC's import does (same `uuid` replaces, no `uuid` inserts fresh).
- **Export characters** — downloads every character in the current generator as one `.json` file (`format: "aicc-characters"`), each stripped with AICC's own share rules. Private — nothing is uploaded.
- **Pull character from GitHub** — paste a `raw.githubusercontent.com` URL to a character `.json` and it's fetched (via `GM_xmlhttpRequest`, so CSP can't block it) and run through the same import flow.

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
> Uploads to user.uploads.dev run through the generator's **own** upload-plugin, inside its sandbox frame — so they work on any generator that imports `upload-plugin` (AI Character Chat does). Uploaded content passes through Perchance's moderation; a rejection is reported with the reason rather than silently swallowed.

#### 🔧 Repair & recovery

The Repair panel has two modes.

**Run diagnosis** is a read-only scan that checks the same fields AICC's own boot-time upgrade code repairs: missing or invalid character `uuid`s, threads whose `characterId` points at a nonexistent character, messages whose `threadId` points at a nonexistent thread, and summaries AICC will silently discard on the next schema upgrade. The results are reported with counts and per-row context.

**Repair this database…** turns the diagnosis into an action plan using AICC's own repair rules, then shows you the plan before touching anything:

- Characters are normalized to the full set of field defaults AICC fills in on boot (`customCode`, `userCharacter`, `scene`, `streamingResponse`, `roleInstruction` migrated from legacy `systemMessage`, `avatar` migrated from legacy `avatarUrl`, `loreBookUrls`, `autoGenerateMemories`, `maxTokensPerMessage`, and others). Characters with no `id` are dropped and counted; characters with a missing or invalid `uuid` get a fresh one minted.
- Threads with a dead `characterId` are recovered by scanning their messages for the first one with a real `characterId`, falling back to any existing character.
- Messages and lore rows that are structurally broken (no `id`, or pointing at a thread that no longer exists after recovery) are removed from the live tables. Messages are normalized to include `variants: [null]` if missing.
- **Nothing is destroyed.** Every removed row is moved into a separate **`weld-quarantine`** database on the same origin, where you can inspect or restore it any time from the Data Manager. Quarantine lives in its own database because adding a store to `chatbot-ui-v1` would bump its version past what AICC declares and break AICC's boot.

After reviewing the plan ("12 characters normalized, 3 threads recovered, 5 orphan messages dropped"), you have two options:

- **Export repaired copy** — downloads the repaired result as an `idbml` file without touching the live database. Use this to verify the output by importing it somewhere first.
- **Back up & apply** — downloads a full pre-repair backup of the current database, writes any removed rows into the `weld-quarantine` database, then rewrites `characters`, `threads`, `messages`, and `lore` from the repaired plan. The `summaries`, `memories`, and embedding caches are left untouched. The planner is a set of pure functions that never mutate your data until you confirm; the backup and the quarantine write both come before any change to the live stores.

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

Under the hood it's a two-way `postMessage` handshake between the Companion (top frame) and the plugin (the generator's `*.perchance.org` child iframe), with a negotiated protocol, per-message nonce, and origin checks. The Companion identifies itself in the handshake (`agent: "weld-companion"`) so a plugin knows which anchor answered. Consent is **per-capability and per-generator**, asked once and remembered. Both ends log the handshake to the console (`[WeldCompanion]` / `[skybridge]`) so a misconnection is diagnosable rather than silent.

Two consent-free **meta-requests** help a plugin introspect the link without catching the one-shot handshake: `request('describe')` returns the live manifest (agent, version, build, protocol range, capabilities), and `request('ping')` is a liveness / round-trip probe. For deeper troubleshooting, run **`weldCompanion.skybridgeDiagnostics()`** in the top-frame console — it returns the anchor's agent/version/build, bound-window state, visible child-frame count, advertised capabilities, remembered per-generator permissions, and a ring buffer of recent handshake events.

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
| `Ctrl/Cmd+Alt+P` | Pull from GitHub (on an `#edit` page) |
| `Ctrl/Cmd+Alt+S` | Save / trigger Perchance save (on an `#edit` page) |
| `Ctrl/Cmd+Shift+S` | Quick-save selection or output to the Scrapbook |
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
  @connect editor-copilot.perchance.org         # Perchance's editor AI-assist endpoint, only when you invoke it
  @connect *                                    # consent-gated web fetch for Weld agents, and custom model endpoints you configure
  ```

  Out of the box, calls go only to the AI provider you choose, `perchance.org` (including its editor AI-assist endpoint, only when you invoke it), and your own GitHub files. The `*` and DuckDuckGo hosts are reached only through per-generator, consent-gated web-fetch / web-search capabilities or a model endpoint you configure — never silently. Every network call uses the privileged `GM_xmlhttpRequest`, so the Companion keeps working even if Perchance enforces its Content Security Policy.

- **`@grant unsafeWindow`** lets the Companion read the editor's globals and drive Perchance's own modals and the Skybridge handshake on the real page window. It isn't used to alter page content beyond that.
- **It can't break Perchance.** Every feature is feature-detected against Perchance's internals and silently no-ops if something is absent or renamed. The whole script is wrapped so it never throws into the host page.
- **Focus mode hides *your own* clutter** (menus, sidebars) for reading and screenshots. It is **not** an ad blocker — please use it within Perchance's terms.

## Compatibility & caveats

- Tested with **Tampermonkey** and **Violentmonkey**. **Greasemonkey 4+ is not supported** — the Companion uses the classic synchronous `GM_*` API, which Greasemonkey replaced with an async `GM.*` API; under Greasemonkey it loads but nothing persists (storage, settings, and backups silently fail). Runs on `perchance.org` and `*.perchance.org`. All UI lives in the top frame; only the Data Manager agent runs inside generator sandbox frames (and exits immediately on non-sandbox subdomains).
- **Lives inside Perchance's own bar.** The ⚡ Weld item is inserted left of the **edit** button and height-locked so it never distorts the bar. If a page has no Perchance bar (e.g. *minimal* mode), nothing is injected — the `/` shortcut still opens the drawer, and the item is added if the bar appears later.
- **Themes use a `backdrop-filter` overlay**, so they work on any generator without touching its DOM. "Dark" is an inversion (the standard dark-mode trick), so it renders photos in negative — the non-invert themes (Dim / Warm / Sepia / Gray) are safer on image-heavy generators.
- **GitHub Push is two commits, not one atomic commit**, and has no pre-push diff. If GitHub changed since your last Pull, Push wins. (Atomic multi-file commits and a sync-status/diff view are on the roadmap.)
- **Data Manager reach is bounded by visited history.** There is no browser API for enumerating all IndexedDB origins on a device, so the manager can only reach generators that have run on this device (plus anything pulled via **Load all**). Opening a generator in the manager briefly runs it in a hidden frame — its boot code executes for a moment.
- **Output capture asks the live generator frame.** Saving or reading a result goes through the agent inside the visible sandbox iframe. On pages where no agent is running (non-generator pages, or a generator that blocks the userscript), capture reports “no output found” rather than guessing from the top page's DOM.
- **The AICC sentry is cooperative.** Unmodified AI Character Chat doesn't broadcast its presence, so the Companion detects it by waiting for a `BroadcastChannel` reply. Close AICC before using any write from the Companion to be safe; a background or sleeping AICC tab may not reply within the timeout.
- Perchance's internal hooks are **not a documented API** — Perchance can rename them at any time. When that happens, the affected feature quietly stops working (or falls back) rather than erroring; update the script and it resumes.
- **Skybridge needs both halves deployed.** Updating the userscript is one end — the matching `weld-skybridge-plugin` generator must also be imported and **re-saved** (and any generator importing it re-saved, to bust Perchance's import cache). The console handshake logs tell you which end is live.

## Relationship to Weld

Weld is a suite of composable plugins for building Perchance AI generators. **Weld Companion is its first userscript** — the layer that improves the experience *around* any generator, which a plugin (running inside the sandbox) structurally cannot do.

## Roadmap

Items are grouped by the capability or tool they extend, then sorted easiest-first within each group. **Offline** items need no network access; **Online** items use the Companion's `fetch` capability or an external API.

---

### 🗃 Data Manager & storage
*All offline unless noted.*

- **Companion-to-Companion sync** — encode full state as a QR code or short link; scan on another device to import. No server. *(offline)*
- **Asset manager** — inventory every external asset a generator loads, check liveness, offer to re-host dead ones to user.uploads.dev, maintain a personal asset library reusable across generators. *(online)*
- **Grief recovery / session archaeology** — given any IndexedDB dump, reconstruct a human-readable timeline including deleted rows. Not just "here are your characters" but the full database history. *(offline)*

---

### 📒 Library — Scrapbook & reading
*All offline unless noted.*

- **Manuscript assembler** — drag saved Scrapbook entries into order, add prose between them, export as `.docx` or `.md`. Perchance as a drafting tool. *(offline)*
- **Scheduled generators** — run a generator on a schedule and save the result to the Scrapbook automatically. Daily tarot pull, weekly writing prompt. *(offline / background)*
- **"Send to…" output routing** — pipe output into another open generator as its seed, append to an Obsidian note, post to a Discord webhook, or copy shaped for a specific app. *(online for webhooks)*
- **Ambient generation / prefetch cache** — maintain a pool of pre-generated outputs for favourite generators, silently refreshing in the background. Zero wait time on open. *(offline)*
- **Research collector on external sites** — extend the userscript to Wikipedia and other research sites; offer "save to research library" with title, URL, excerpt, and tag — integrated with the existing Scrapbook. *(online)*
- **Publishing pipeline** — push formatted output to Ghost, Substack, GitHub Pages, or Ko-fi. The generator as the first step in a content pipeline. *(online)*

---

### 👁 Comfort & reading experience
*All offline.*

- **Accessibility as first-class** — full keyboard navigation with visible focus indicators, voice command input (speech API already wired for output), switch access compatibility, session state that survives accidental tab closes. *(offline)*
- **Font/contrast override on generator request** — a generator can request a specific Comfort preset via the bus when it loads, for accessibility-sensitive audiences. *(offline)*
- **Neurodivergent-friendly session tools** — hyperfocus timer with gentle nudge, "session wrap-up" that saves the thread, "where was I" context reconstruction. *(offline)*

---

### ⭐ Generators tab & discovery
*Mixed.*

- **Dead generator detection and repair suggestions** — health-check starred generators; flag broken ones with a ⚠ badge; suggest fixes for renamed imports. *(online)*
- **Discover** — browse Perchance's public gallery from the drawer with a "surprise me" button. Needs fail-soft parsing of the live gallery. *(online)*
- **Competitive awareness for authors** — monitor generators in the same category as yours; alert when a notable one appears or changes; compare outputs side by side. *(online)*
- **Community generator index** — opt-in anonymised signal aggregation for a community-maintained directory that doesn't require a central authority. *(online)*

---

### 🔧 Tools tab & authoring
*Mixed.*

- **Ritual and habit support** — honour daily creative rituals; quiet streak tracking; gentle prompt if you haven't done your morning pull. *(offline)*
- **Living style guide** — extract implicit consistency rules from saved outputs ("all your northern city names end in -vik"), surface them, flag when a new output breaks your canon. *(offline)*
- **Weld Lint overlay** — run the brace-trap scanner live in the editor; underline issues as you type. *(offline)*
- **Accessibility audit** — basic check of output contrast ratio, font size, `prefers-reduced-motion` compliance. One-line result in the Generators tab. *(offline)*
- **Local version history** — track every edit to your generators over time; rollback to any previous version; diff between any two. *(offline)*
- **Contextual platform tutorial** — "how does this work?" panel explaining the DSL, HTML panel, and imports for the specific generator you're looking at. *(offline)*
- **DSL reader / explainer** — "explain this generator in plain English," "what does this line do." The AI Helper writes code; this reads it. *(online — uses AI)*
- **Atomic GitHub commits** — push DSL + HTML as a single commit rather than two. *(online)*
- **Richer GitHub manager** — sync-status badge and pre-Pull/Push diff. *(online)*
- **Conflict detection for collaborators** — hash editor content, detect divergence via the bus, alert both authors before either saves. *(offline)*
- **Taste learning from your Scrapbook** — analyse saved outputs to identify what you consistently like; suggest generator prompt adjustments. *(online — uses AI)*
- **Creative writing coach** — identify recurring themes, stylistic patterns, and tendencies in your writing; suggest prompts to develop range. *(online — uses AI)*
- **Platform changelog** — observe when things stop working; crowd-sourced platform observability. *(online, opt-in)*

---

### 🌐 Skybridge — cross-generator & multiplayer
*All require Skybridge plugin in the generator. All offline unless noted.*

- **Notification / async signal** — when a long generation finishes, publish to the bus; the Companion shows a toast across tabs. *(offline)*
- **Co-presence signal** — opt-in, anonymous awareness that someone else is using the same generator right now. Not chat, not identity. *(offline / bus)*
- **Reading journal / progress tracker** — track chapters read, choices made, where you left off. Two tabs stay in sync via bus. *(offline)*
- **Shared table / multiplayer rolls** — one player's roll appears in another's output via the bus. Requires both users to have the Companion installed. *(offline / bus)*
- **Shared timer / game clock** — publish tick events; a companion clock generator subscribes and displays the countdown. *(offline / bus)*
- **Live leaderboard / session stats** — quiz scores written to Companion storage; a scores generator renders the leaderboard. *(offline)*
- **Persistent world state across "rooms"** — multiple generators as interconnected rooms, sharing player state via the bus, persisting across sessions. *(offline)*
- **Offline-capable map + journal** — an exploration generator writes discovered locations to IDB; a map generator reads the same store and renders what's been found. *(offline)*
- **Companion as game master** — multiple generators coordinated as a rules system; cross-generator rules enforced; world state managed in Companion storage. *(offline)*
- **Emotional continuity for AI chat** — maintain a relationship layer outside AICC: session count, sentiment, recurring themes. Inject lightweight context at each session start. *(offline)*
- **Grounded storytelling** — before generating, fetch current date, a Wikipedia summary, or today's weather and inject it into the prompt. *(online)*
- **Physical world bridge** — post a roll result to a Home Assistant webhook, Raspberry Pi, or IFTTT trigger. The output escapes the browser. *(online)*

---

### 📦 Device capabilities
*New surfaces beyond the current Perchance page.*

- **Opportunistic extension integration** — if Grammarly is active, route output through it for proofread. If a dictionary extension is present, wire up "define this word." *(offline)*
- **Dictation input** — use the microphone to dictate a note attached to a Scrapbook entry. *(offline)*
- **Camera — photograph physical assets** — photograph a physical character sheet or map and add it to your collection. *(offline)*
- **Geolocation tagging** — tag a Scrapbook entry with where you were when you saved it. *(offline)*
- **Generator as headless content API** — a Service Worker endpoint that other tools (Obsidian, scripts, curl) can query for fresh generator output on demand. *(offline / local)*

---

### 🤝 Social & sharing
*Mixed.*

- **Companion-to-Companion sync via QR** — encode state as a QR code; scan on another device to import. *(offline)*
- **Content moderation layer** — for community generators: flag outputs, require review steps, log locally within the group's shared storage. *(offline)*
- **Safe space signal** — generator authors flag a generator as a safe space; the Companion applies specific UI behaviours on that page. *(offline)*
- **Cross-tool export formatting** — export characters as Campfire cards, lore as World Anvil articles, locations as Obsidian notes. Formatted for the destination. *(online for some targets)*

---

### 🧑‍⚕️ Human-centred & wellbeing
*All offline.*

- **Character preservation and grief support** — extra backup redundancy for flagged characters; read-only memorial archive; restore path in plain human terms. *(offline)*
- **Mental health awareness** — opt-in, private session pattern tracking. Gentle check-in if patterns suggest distress. *(offline)*
- **Bereavement and attachment care** — treat cherished characters like photographs; long-term archival in plain readable JSON. *(offline)*

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
