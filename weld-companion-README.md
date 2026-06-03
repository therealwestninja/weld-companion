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

### AI Helper — edit it, or use your own GPT (🤖 dock button)
- **Custom instruction**: override the AI Helper's system prompt with your own.
- **Use your own model**: route the Helper through **OpenAI (GPT)**, **Anthropic (Claude)**, or **Google (Gemini)** with your own API key and chosen model — for a stronger model or your own quota. A **Test** button verifies the key. When a provider is selected, the Helper's "submit" is intercepted and the result is written straight into the code editor.
- Or keep **Perchance built-in** (the default broker) and just use a custom instruction.

### Keyboard shortcuts (viewer)
`/` launcher · `f` favorite · `c` copy output · `[` `]` result history · `?` show this list.

## Privacy & safety
- All favorites, history, comfort settings, and pins live in your browser's userscript storage. Nothing is uploaded.
- Your AI API key is stored **only** in this browser and is sent **only** to the provider you pick (the script's `@connect` list is limited to those three hosts plus perchance.org).
- The script touches Perchance internals (`modelTextEditor`, `saveGenerator`, the AI-helper DOM, `/api/*`). These are **not** a documented API — every feature is feature-detected and silently no-ops if Perchance changes or renames something, so the script never breaks the host page.
- Focus mode hides *your own* clutter (menus, sidebars); it is not an ad blocker and should be used within Perchance's terms.

## Relationship to Weld
This is the first piece of the Weld project that runs outside a generator — the companion to the plugin suite. A future version can fold in the author-facing **Weld Lint** overlay (run `weld.safe`'s trap scanner live in the editor) and **local autosave/version-history** for generator source.

© 2026 therealwestninja · DeviantArt west-ninja · GitHub therealwestninja
