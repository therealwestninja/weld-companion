# ⚡ Weld Companion for Perchance

Quality-of-life upgrades for **Perchance**, for readers/players and authors alike. It runs *outside* the generator sandbox as a Tampermonkey / Violentmonkey / Greasemonkey userscript, so it works on **any** generator — not just ones built with [Weld](https://github.com/therealwestninja/weld). Your favorites, history, and settings stay local and account-free; the only network calls it makes are ones **you** start, to a service **you** choose.

> This is a quick overview. Full documentation is in **[README.md](README.md)**.

## Install

1. Install **Tampermonkey** (Chrome/Edge/Safari/Opera) or **Violentmonkey / Greasemonkey** (Firefox).
2. Open `weld-companion.user.js` and confirm the install.
3. Browse Perchance — a single **⚡ Weld** item appears in Perchance's menu bar, left of **edit**. Click it (or press `/`) to open the drawer.

No account or setup needed to start; GitHub sync and a custom AI model are optional.

## What it adds

The **⚡ Weld** drawer has a result-tools header (copy / save / pin / undo-reroll) and three tabs.

**★ Generators**
- **Load all** — your *entire* account directory, grouped by your real Perchance **folders**, plus favorites and recents. Search, sort (Recent / A→Z / Favorites / Folders), and per-row ★ / open / edit. Cached locally.
- **This Generator** panel — two-way GitHub sync and owner actions for the open generator (below).
- **CRUD** via Perchance's own functions: New, Fork, **Save** (synthetic `Ctrl/Cmd+S`, captcha-aware), **Rename**, **Delete**.

**👁 Comfort** *(per-generator, remembered)* — theme filters (Off / Dim / Warm / Sepia / Gray / Dark), font size, max width, line height, dyslexia-friendly font, focus mode, and an option to apply the sizing to the **code editor** too.

**🤖 AI Helper** — override the helper's instruction, or route it through your own **OpenAI / Anthropic / Google** model and key (with a Test button and token-by-token streaming). Default stays the built-in Perchance helper.

**Viewer extras** — result **Copy / Save / Pin** bar, **undo-reroll** history (`[` / `]`), and resizable input boxes.

## GitHub sync (author tools)

From the **This Generator** panel (slug · ⬇ Pull · ⬆ Push · ⚙):

- **⬇ Pull** — fetch the generator's DSL + HTML from your repo's public `raw.githubusercontent.com` files and fill the editor's two panes (undoable); you review and **Save**. Optional backup-before-pull.
- **⬆ Push** — commit the editor's contents back to your repo via the GitHub Contents API, behind a confirm dialog. Needs a **fine-grained Personal Access Token** (single repo, Contents read & write), stored locally and sent only to `api.github.com` — never logged. Set it under **⚙ → GitHub push (token)**.

Set `owner` / `repo` / `branch` and path templates once under the gear (paste a GitHub file URL to auto-fill); per-generator overrides re-point slugs that don't match their filenames.

## Keyboard shortcuts

`/` open drawer · `f` favorite · `c` copy output · `[` `]` result history · `?` cheat-sheet · `Esc` close.

## Privacy & safety

- Favorites, history, comfort, pins, and the cached directory are stored **only in your browser**.
- Your **AI key** goes only to the provider you pick; your **GitHub token** only to `api.github.com`. Neither is ever logged.
- **Your Perchance login is never handled by this script** — directory loading, rename, and delete drive Perchance's *own* controls, which carry their own credentials.
- Pull is read-only and anonymous (public raw files, no cookies).
- **Skybridge** — to Weld generators that import `weld-skybridge-plugin`, the Companion offers consent-gated capabilities (durable storage, your own streaming AI model, a cross-tab message bus, web fetch, web search, and model-info), each asked once per generator and remembered. See [README.md](README.md) for details.
- Every feature is feature-detected and fail-soft, so it never breaks the host page; Focus mode hides *your own* clutter and is not an ad blocker.

---

© 2026 therealwestninja · DeviantArt [west-ninja](https://www.deviantart.com/west-ninja) · GitHub [therealwestninja](https://github.com/therealwestninja) · MIT
