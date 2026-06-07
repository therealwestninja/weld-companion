# Weld Companion (userscript)

Quality-of-life upgrades for **Perchance**, for both readers/players and authors. It runs *outside* the generator sandbox (as a Tampermonkey/Greasemonkey userscript), so it works on any generator — not just ones built with Weld. Everything is local and account-free; the only network calls it ever makes are to an AI provider **you** choose, with **your** key.

## Install
1. Install a userscript manager: **Tampermonkey** (Chrome/Edge/Safari) or **Violentmonkey / Greasemonkey** (Firefox).
2. Open `weld-companion.user.js` and confirm the install.
3. Browse Perchance — a small dock appears bottom-right.

## What it adds

### Tier 1 quality-of-life
- **Favorites & recently-used** — it remembers generators you open and lets you star favorites. Press **`/`** anywhere for a search palette to jump back to them (★ button in the dock opens it too).
- **Reading comfort** (👁 dock button) — per-generator, remembered: light/dark/sepia override, font size, max width, line height, a dyslexia-friendly font, and a one-key **Focus mode** that hides chrome for distraction-free reading/screenshots.
- **Result tools** — a small **Copy / Save / Pin** bar above any generator's output. Pin stashes results in a tray so you can compare several rolls side by side.
- **Result history (undo-reroll)** — back/forward arrows step through previous outputs, so the classic "the one before was better" has an answer. Keys: **`[`** and **`]`**.
- **Resizable inputs** — an expand/collapse toggle on text areas (handy for cramped AI-chat/prompt boxes).

### Generator management & CRUD (🗂 dock button)
- A local list of your generators with **sort** (recent / name / favorites-first) and **filter**.
- Quick actions per generator: open, edit, forget (from the local list).
- **CRUD shortcuts** that drive Perchance's own functions when you're in the editor: New, Fork, **Save now** (`saveGenerator`), **Delete** (the platform's own delete, with a confirm).

### GitHub updater — pull your source (author tools)
- **Pull from GitHub** — if your generators' source lives in a GitHub repo (one folder per generator, `<name>-top-panel.txt` + `<name>-html-panel.html`), the **This Generator** panel at the top of the manager pulls the latest straight into the editor's two CodeMirror panes; you review and hit **Save**. Set your `owner`/`repo`/`branch` once (the ⚙ gear, or the **Weld: Configure GitHub repo** menu command); per-generator overrides re-point slugs that don't match their file names. Nothing is auto-pushed — Perchance has no external write API, so the manual Save is the gate.

### AI Helper — edit it, or use your own GPT (🤖 dock button)
- **Custom instruction**: override the AI Helper's system prompt with your own.
- **Use your own model**: route the Helper through **OpenAI (GPT)**, **Anthropic (Claude)**, or **Google (Gemini)** with your own API key and chosen model — for a stronger model or your own quota. A **Test** button verifies the key. When a provider is selected, the Helper's "submit" is intercepted and the result is written straight into the code editor.
- Or keep **Perchance built-in** (the default broker) and just use a custom instruction.

### Keyboard shortcuts (viewer)
`/` launcher · `f` favorite · `c` copy output · `[` `]` result history · `?` show this list.

## Privacy & safety
- All favorites, history, comfort settings, and pins live in your browser's userscript storage. Nothing is uploaded.
- Your AI API key is stored **only** in this browser and is sent **only** to the provider you pick.
- **Web fetch for Weld agents** — a Weld generator can ask the Companion to fetch a URL on its behalf, so an in-page agent can read pages the sandbox's CORS rules would otherwise block. It is **off until you allow it** (asked once per generator, then remembered). When allowed, requests go out **without your cookies** (anonymous), only over `http`/`https`, and **never to local or private-network addresses**; the response body is size-capped. Enabling this is why the script's `@connect` now includes `*` (arbitrary hosts) alongside the AI providers — the per-generator consent prompt is the gate, and you can decline it.
- **Web search for Weld agents** — a generator can ask the Companion to run a keyless web search (DuckDuckGo's Instant Answer API). Same consent model; the query goes to DuckDuckGo without your cookies. Results are intentionally lightweight (title/url/snippet) and sparse for some queries — it is a no-account default, not a full search index.
- **Model info for Weld agents** — a generator can ask the Companion which AI model you have configured, so an in-page agent or summarizer can size its prompts to the model's context window. Only the **provider and model name** (plus an approximate context/output size) are returned — **never your API key**, and no network call is made. Same once-per-generator consent prompt.
- **GitHub updater** — Pull fetches only from `raw.githubusercontent.com` (your repo's public raw URLs), with no auth or cookies; it fills the editor locally and never saves or pushes on its own.
- The script touches Perchance internals (`modelTextEditor`, `saveGenerator`, the AI-helper DOM, `/api/*`). These are **not** a documented API — every feature is feature-detected and silently no-ops if Perchance changes or renames something, so the script never breaks the host page.
- Focus mode hides *your own* clutter (menus, sidebars); it is not an ad blocker and should be used within Perchance's terms.

## Relationship to Weld
This is the first piece of the Weld project that runs outside a generator — the companion to the plugin suite. Over **weld.skybridge** it offers Weld generators five consent-gated capabilities: durable **storage**, your **own AI model** (with responses that **stream token-by-token**, so an in-page agent's answer appears live just as it does on Perchance's built-in model), **web fetch**, **web search** (above), and **model info** (which model you've configured, name only). A future version can fold in the author-facing **Weld Lint** overlay (run `weld.safe`'s trap scanner live in the editor) and **local autosave/version-history** for generator source.

© 2026 therealwestninja · DeviantArt west-ninja · GitHub therealwestninja
