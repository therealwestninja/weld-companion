# Snippets — code boilerplate

The **✂ Snippets** tab is a **file-tree** of ready-to-paste Perchance **code** boilerplate. Expand a
pane folder, type in the filter box to narrow the tree, and click a snippet to drop it at your cursor
in the matching editor pane (open a generator's `#edit` page first). Each leaf shows a `DSL`/`HTML`
badge for the pane it targets.

> AI prompt-skills — the author's **Working rules**, **AI methods**, **Prompt engineering** and
> **Review & safety** — live in the [**Skills** tab](SKILLS.md), the single home for all AI prompts.
> The Snippets tab is code only.

## What's in it

Grouped by editor pane:

- **DSL — top panel:** `$meta`, core plugin imports, the Weld import stack, `super-fetch`,
  `$meta.dynamic`, data/persistence imports.
- **HTML panel — JS:** `grab()`, `aiTextPlugin` call & stream, `superFetch`, `textToImagePlugin`,
  `uploadPlugin`, the `<image>` tag hint, `kv-plugin` usage.

The two userscript-manager menu commands (**Insert $meta block**, **Insert core plugin imports**) use
the same snippets.

## For developers

| File | Role |
| :--- | :--- |
| `src/snippets-core.js` | The code-snippet tree (`tree()`) and helpers (`codeById`, `findById`, `search`, `walk`, `counts`). Pure data, no AI. |
| `src/snippets-ui.js` | The **Snippets** tab (`window.weldSnippets`): the collapsible file-tree, the filter, and insert-at-cursor. |

A code leaf calls the host's `insertSnippet(pane, text, label)`. Covered by tests:

```bash
node tests/snippets-core.test.js   # tree, lookups, search
node tests/snippets-ui.test.js     # the shipped tab, as wired, against a fake host
npm test                           # the whole suite
npm run build                      # re-embeds src/ modules (SNIPPETS bundle)
```
