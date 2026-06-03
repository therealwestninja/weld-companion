<div align="center">

# 🔧 Weld Companion for Perchance

**Quality-of-life upgrades for [Perchance](https://perchance.org) — for readers, players, and authors alike.**

Favorites · reading comfort · save & pin results · undo-reroll · generator management · an AI Helper you can edit *or point at your own GPT*.

[![Userscript](https://img.shields.io/badge/type-userscript-4493f8)](#install)
[![Version](https://img.shields.io/badge/version-1.0.0-3fb950)](#)
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
| ★ **Generators** | Favorites & recently-used, with search, sort, filter, and per-row open/edit/remove — plus New / Fork / Save / Delete actions |
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
- **Your AI key never leaves your machine** except to the provider you pick. The script's network permissions are limited to exactly four hosts:

  ```
  @connect api.openai.com
  @connect api.anthropic.com
  @connect generativelanguage.googleapis.com
  @connect perchance.org
  ```
- **It can't break Perchance.** Every feature is *feature-detected* against Perchance's internals (the editor, save function, AI-helper elements, and `/api/*` endpoints) and **silently no-ops** if something is absent or renamed. The whole script is wrapped so it never throws into the host page.
- **Focus mode hides *your own* clutter** (menus, sidebars) for reading and screenshots. It is **not** an ad blocker — please use it within Perchance's terms.

## Compatibility & caveats

- Tested with **Tampermonkey** and **Violentmonkey**; Greasemonkey should work (uses only standard `GM_*` APIs).
- Runs on `perchance.org` and `*.perchance.org`, top frame only.
- **Works within Perchance's own bar.** The ⚡ Weld item is inserted to the left of the **edit** button; it's height-locked so it never grows or distorts the bar. If the page has no Perchance menu bar (e.g. a generator in *minimal* mode), nothing is injected — the `/` shortcut still opens the drawer, and the item is added automatically if the bar appears later.
- **Themes use a `backdrop-filter` overlay**, so they work on any generator without touching its DOM. The "Dark" theme is an inversion (the standard dark-mode trick); like all invert-based dark modes it renders photos in negative, so the non-invert themes (Dim / Warm / Sepia / Gray) are the safer pick on image-heavy generators. Needs a current browser (`backdrop-filter` support); on a very old one the picker still works but shows no tint.
- Perchance's internal hooks are **not a documented API** — Perchance can rename them at any time. When that happens, the affected feature quietly stops working (or falls back) rather than erroring; update the script and it resumes.
- The **AI-Helper submit interception** is best-effort against the current helper element IDs. If a future Perchance update changes them, custom-provider routing falls back to no-op (the built-in helper still works); open an issue and it's a one-line fix.

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
