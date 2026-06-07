<div align="center">

# 🔧 Weld Companion for Perchance

**Quality-of-life upgrades for [Perchance](https://perchance.org) — for readers, players, and authors alike.**

Favorites · reading comfort · save & pin results · undo-reroll · generator management · an AI Helper you can edit *or point at your own GPT*.

[![Userscript](https://img.shields.io/badge/type-userscript-4493f8)](#install)
[![Version](https://img.shields.io/badge/version-1.8.4-3fb950)](#)
[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-supported-00485b)](https://www.tampermonkey.net/)
[![Violentmonkey](https://img.shields.io/badge/Violentmonkey-supported-663399)](https://violentmonkey.github.io/)
[![Local & account-free](https://img.shields.io/badge/data-100%25%20local-3fb950)](#privacy--safety)

</div>

---

Weld Companion runs **outside** the generator sandbox as a browser userscript, so it works on **any** Perchance generator — not just ones built with the [Weld plugin suite](#relationship-to-weld). Everything it stores is local and account-free. The only network requests it ever makes are to an AI provider **you** choose, with **your** key.

> [!NOTE]
> This is the first piece of the Weld project that runs outside a generator — the companion to the plugin suite.

## Table of contents
- [Install](#install)
- [Features](#features)
  - [Quality-of-life](#quality-of-life)
  - [Generator management & CRUD](#generator-management--crud)
  - [AI Helper — edit it, or bring your own GPT](#ai-helper--edit-it-or-bring-your-own-gpt)
  - [Skybridge — the bridge to Weld generators](#skybridge--the-bridge-to-weld-generators)
  - [Pull from GitHub — sync generators from your repo](#pull-from-github--sync-generators-from-your-repo)
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
3. Browse Perchance. A single ⚡ Weld item is added to Perchance’s menu bar. Click it (or press `/`) to open the drawer with all features. On pages with no Perchance bar, nothing is injected — the `/` shortcut still opens the drawer.

That's it — no account, no configuration required to start.

## Features

Weld Companion adds a single **⚡ Weld** item to Perchance’s own menu bar — placed just to the left of the **edit** button and styled like any native item, so nothing of Perchance’s is replaced, displaced, or covered. Click it (or press `/`) to open the Weld drawer, which holds everything: a result-tools row in its header (copy / save / pin / undo-reroll), and three tabs:

| Tab | What's in it |
| :-- | :----------- |
| ★ **Generators** | Favorites & recently-used, with search, sort, filter, and per-row open/edit/remove — plus New / Fork / Save / Delete actions, and a **This Generator** panel that pulls the open generator's source from your GitHub repo |
| 👁 **Comfort** | A theme picker (eye-comfort filters), font size, line height, max width, dyslexia font, focus mode |
| 🤖 **AI Helper** | Custom instruction, or route to your own OpenAI / Anthropic / Google model |

### Quality-of-life

- **Favorites & recently-used.** Every generator you open is remembered. Star the ones you keep coming back to, then press **`/`** anywhere to open the **Generators** tab and search them (↑/↓ to move, Enter to open). No more re-finding the same handful of generators.
- **Reading comfort** *(per-generator, remembered).* Pick a **theme** — Off / Dim / Warm / Sepia / Gray / Dark — applied as a full-page filter overlay that works on **any** generator without breaking its layout (each swatch previews its real effect). Adjust **font size, max width, and line height** for text-heavy story and chat generators, switch on a **dyslexia-friendly font**, or hit **Focus mode** to hide menus and sidebars for distraction-free reading and clean screenshots.
- **Result tools.** **Copy / Save / Pin** live in the drawer header whenever a generator has output. **Pin** stashes a result in a side tray so you can compare several rolls at once.
- **Result history (undo-reroll).** Lost a great roll to the reroll button? Step **back and forward** through previous outputs with the arrows in the drawer header (or **`[`** / **`]`**). Up to 50 snapshots per session.
- **Resizable inputs.** An expand/collapse toggle on text areas — for the cramped AI-chat and prompt boxes.

### Generator management & CRUD

The **★ Generators** tab is both your launcher and a lightweight manager:

- **Sort** by recently-used, name (A→Z), or favorites-first.
- **Filter** by name as you type, with ↑/↓ + Enter keyboard navigation.
- Per-row quick actions: **open**, **edit**, and **✕ remove** (from the local list).
- **CRUD shortcuts** that drive Perchance's *own* functions when you're in the editor:
  - ＋ **New**
  - **Fork this** (open the editor to copy it)
  - **Save** — triggers Perchance's `saveGenerator`
  - **Delete…** — Perchance's own delete, behind a confirmation

> The local list is built from generators you've opened and starred. CRUD buttons call Perchance's built-in save/delete; they don't reimplement them.

### AI Helper — edit it, or bring your own GPT

Perchance's built-in AI Helper writes generator code from a prompt. The **🤖 AI Helper** tab adds the two things it's missing:

1. **Edit the instruction.** Override the Helper's system prompt with your own, so it behaves the way *you* want.
2. **Use your own model.** Route the Helper through your own account on any of the three most popular GPT APIs:

   | Provider | Default model | Key format |
   | :------- | :------------ | :--------- |
   | **OpenAI** (GPT) | `gpt-4o` | `sk-…` |
   | **Anthropic** (Claude) | `claude-sonnet-4-20250514` | `sk-ant-…` |
   | **Google** (Gemini) | `gemini-1.5-pro` | `AIza…` |

   Pick a provider, paste your key, optionally set a model, and hit **Test** to verify it. From then on, the Helper's request is sent to your model and the result is written straight into the code editor. Prefer to keep the default? Leave it on **Perchance built-in** and just use a custom instruction.

> [!IMPORTANT]
> Your API key is stored **only** in this browser and is sent **only** to the provider you select. See [Privacy & safety](#privacy--safety).

### Skybridge — the bridge to Weld generators

Weld Companion is also the **anchor end** of `weld.skybridge`. A generator that imports the **`weld-skybridge-plugin`** can — *with your per-generator consent* — ask the companion for things it cannot do from inside the sandbox:

- **Cross-generator storage** — namespaced, persistent key/value the companion holds on the generator's behalf. With no companion installed, the plugin falls back to its own storage or memory and honestly reports `has('storage') === false`.
- **Your own AI model** — run a completion through the model **you** configured in the AI Helper tab. Your API key **never crosses the bridge**; only the prompt goes up and the text comes back.
- **A cross-tab message bus** — `bus.publish`/`bus.subscribe` on named channels, relayed by the companion across *different generators and tabs* over a `BroadcastChannel` on the shared `perchance.org` apex origin (something `weld.sync`, being same-origin, can't do). This is the transport **`weld.swarm`** rides on for multi-agent orchestration.
- **Web fetch** — fetch a URL on the generator's behalf (cookie-free, `http`/`https` only, never local or private-network addresses, size-capped), so an in-page agent can read pages the sandbox's CORS rules block.
- **Web search** — a keyless DuckDuckGo Instant-Answer lookup (title / url / snippet) for lightweight grounding without an account.
- **Model info** — the name and approximate context size of the model you configured (never the key, no network call), so an agent can size its prompts.

Under the hood it's a two-way `postMessage` handshake between the companion (top frame) and the plugin (the generator's `*.perchance.org` child iframe), with a negotiated protocol, per-message nonce, and origin checks. Consent is **per-capability and per-generator**, asked once and remembered. Because the userscript runs in the manager's sandbox, the bridge binds to the real page window via `unsafeWindow` (the permission requested at install). Both ends log the handshake to the console (`[WeldCompanion]` / `[skybridge]`) so a misconnection is diagnosable rather than silent.

> [!IMPORTANT]
> **A generator must *trigger* the plugin.** Importing `{import:weld-skybridge-plugin}` only *defines* its `$output`; Perchance does not auto-run it. Call it once early in your panel JS so it initializes `window.weld.skybridge`:
> ```js
> if (typeof root !== 'undefined' && typeof root.weldSkybridge === 'function') root.weldSkybridge();
> var sb = window.weld && window.weld.skybridge;   // now available
> ```
> The call is idempotent. Without it, `window.weld.skybridge` stays `undefined` no matter how the bridge is configured.

### Pull from GitHub — sync generators from your repo

If your generators' source lives in a GitHub repo — one folder per generator, in the `<name>-top-panel.txt` (DSL) / `<name>-html-panel.html` (HTML) layout — the Companion can pull the latest version straight into the editor. Because it runs as a userscript, *not* inside the sandbox, it can write directly into Perchance's editor panes — something a generator never could.

It lives in a **This Generator** panel at the top of the ★ Generators tab. By default it's a single compact row: the open generator's slug and one **⬇ Pull** button. A **⚙** gear reveals the rest:

- **Files for this generator** — the GitHub paths for the DSL/top panel and the HTML panel, plus optional per-generator `owner` / `repo` / `branch` overrides. Use this to re-point a generator whose Perchance slug doesn't match its file names (e.g. a random slug like `/fr5y67…`).
- **Repo defaults (all generators)** — your `owner`, `repo`, `branch`, and the path templates (`{name}` expands to the slug). Set these once and every generator follows. (Also under your userscript manager's menu: **Weld: Configure GitHub repo**.)

**The flow:** open the generator's `#edit` page → click **⬇ Pull** → the Companion fetches the two files from `raw.githubusercontent.com` and fills the editor's two CodeMirror panes (DSL on top, HTML below) → you review and click Perchance's **Save**.

> [!IMPORTANT]
> Nothing is pushed or saved automatically. **Pull only fills the editor fields — you always review and Save yourself.** There is no Perchance API that writes a generator's source from outside the editor, so the manual Save is both the safety net and the only way changes go live.

The same actions are on your userscript manager's menu: **Update editor from GitHub**, **Map THIS generator → GitHub files**, **Configure GitHub repo (global)**, and **Edit GitHub mapping (JSON)** for bulk edits.

## Keyboard shortcuts

| Key | Action |
| :-: | :----- |
| `/` | Open the Weld drawer (Generators tab) |
| `f` | Favorite / unfavorite the current generator |
| `c` | Copy the current output |
| `[` `]` | Previous / next result (undo-reroll) |
| `?` | Show the shortcut cheat-sheet |

*(Shortcuts are ignored while you're typing in an input.)*

## Privacy & safety

- **100% local.** Favorites, history, comfort settings, and pins live in your userscript manager's storage, in your browser. Nothing is uploaded.
- **Your AI key never leaves your machine** except to the provider you pick. The script declares these `@connect` hosts:

  ```
  @connect api.openai.com                       # OpenAI
  @connect api.anthropic.com                    # Anthropic
  @connect generativelanguage.googleapis.com    # Google
  @connect api.duckduckgo.com                   # keyless web search, only when a Weld agent asks (consent-gated)
  @connect perchance.org                        # generator metadata
  @connect raw.githubusercontent.com            # GitHub updater (pulls your repo's public source files)
  @connect *                                    # consent-gated web fetch for Weld agents, and custom model endpoints you configure
  ```
  Out of the box, calls go only to the AI provider you choose, `perchance.org`, and your own GitHub raw files; the `*` and DuckDuckGo hosts are reached only through the per-generator, consent-gated web-fetch / web-search capabilities (see [Skybridge](#skybridge--the-bridge-to-weld-generators)) or a model endpoint you configure — never silently.
- **`@grant unsafeWindow` is used only for Skybridge** — to attach the bridge's message listener and frame-announce to the *real* page window (a userscript manager otherwise sandboxes `window` so cross-frame messages never arrive). It is not used to read or alter page content beyond the bridge handshake.
- **It can't break Perchance.** Every feature is *feature-detected* against Perchance's internals (the editor, save function, AI-helper elements, and `/api/*` endpoints) and **silently no-ops** if something is absent or renamed. The whole script is wrapped so it never throws into the host page.
- **Focus mode hides *your own* clutter** (menus, sidebars) for reading and screenshots. It is **not** an ad blocker — please use it within Perchance's terms.

## Compatibility & caveats

- Tested with **Tampermonkey** and **Violentmonkey**; Greasemonkey should work (uses only standard `GM_*` APIs).
- Runs on `perchance.org` and `*.perchance.org`, top frame only.
- **Works within Perchance's own bar.** The ⚡ Weld item is inserted to the left of the **edit** button; it's height-locked so it never grows or distorts the bar. If the page has no Perchance menu bar (e.g. a generator in *minimal* mode), nothing is injected — the `/` shortcut still opens the drawer, and the item is added automatically if the bar appears later.
- **Themes use a `backdrop-filter` overlay**, so they work on any generator without touching its DOM. The "Dark" theme is an inversion (the standard dark-mode trick); like all invert-based dark modes it renders photos in negative, so the non-invert themes (Dim / Warm / Sepia / Gray) are the safer pick on image-heavy generators. Needs a current browser (`backdrop-filter` support); on a very old one the picker still works but shows no tint.
- Perchance's internal hooks are **not a documented API** — Perchance can rename them at any time. When that happens, the affected feature quietly stops working (or falls back) rather than erroring; update the script and it resumes.
- The **AI-Helper submit interception** is best-effort against the current helper element IDs. If a future Perchance update changes them, custom-provider routing falls back to no-op (the built-in helper still works); open an issue and it's a one-line fix.
- **Skybridge needs both halves deployed.** Updating the userscript is only one end — the matching `weld-skybridge-plugin` generator must also be imported and **re-saved** (and any generator that imports it re-saved, to bust Perchance's import cache, which is keyed on `__generatorLastEditTime`). The console handshake logs (`[WeldCompanion]` / `[skybridge]`) tell you which end is live; missing `[skybridge]` lines mean the plugin generator is still the cached old version.

## Relationship to Weld

Weld is a suite of composable plugins for building Perchance AI generators. **Weld Companion is its first userscript** — the layer that can improve the experience *around* any generator, which a plugin (running inside the sandbox) structurally cannot.

Planned additions, both author-facing:
- **Weld Lint overlay** — run Weld's brace-trap scanner live in the editor and underline issues as you type, with one-click fixes.
- **Local autosave / version history** — snapshot your generator source across sessions for crash recovery and undo-across-reloads.

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
