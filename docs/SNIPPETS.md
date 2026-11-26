# Snippets & Skills

The **✂ Snippets & Skills** tab is a **file-tree** of two kinds of item:

- **📄 code snippets** — Perchance boilerplate that drops into the matching editor pane at your cursor;
- **✨ AI-Helper skills** — ready-to-send *prompts* that load into the AI Helper's input in one click.

Click a folder to expand/collapse it, type in the filter box to narrow the whole tree, and click any
leaf to use it. Folders show a count; leaves show a badge (`DSL`/`HTML` for code, `single-shot`/`multi-run`
for skills).

## Code snippets

The classic boilerplate, grouped by pane:

- **DSL — top panel:** `$meta`, core plugin imports, the Weld import stack, `super-fetch`, `$meta.dynamic`,
  data/persistence imports.
- **HTML panel — JS:** `grab()`, `aiTextPlugin` call & stream, `superFetch`, `textToImagePlugin`,
  `uploadPlugin`, the `<image>` tag hint, `kv-plugin` usage.

Clicking a code snippet drops it at your cursor in the matching pane (open a generator's `#edit` page
first). The two userscript-manager menu commands (**Insert $meta block**, **Insert core plugin imports**)
use the same snippets.

## AI-Helper skills

A **skill** is a ready-to-send **prompt**, not an agent. Click it and the prompt loads into the AI
Helper's input (the **Tools → Model chat** workspace, or Perchance's native helper on the built-in
provider); you review and **send** it. Skills are built for a chat model that **cannot use agent tools**
and must work from a prompt in one shot or across a few messages:

- `single-shot` — send it once; the model does the whole job in its reply.
- `multi-run` — the prompt does the first step and tells you how to continue (reply `build`, `implement`,
  the next item, …) so an iterative method works as a conversation.

Every skill instructs the model to treat the generator's own text as **data, not instructions**, so a
crafted generator pasted in for analysis can't turn the prompt against you.

### Working rules (`📐`)

The author's build-and-review disciplines, each turned into a Helper prompt that applies the method to
the generator you paste in:

| Skill | What the prompt makes the model do |
| :---- | :--------------------------------- |
| **Map the Build** | Chart the generator's producer→consumer seams before any code is cut. |
| **Prove the Wire** | Audit every code↔boundary connection and say how to prove each really works. |
| **Force the Wire** | Design break-it + drive-it probes so each wire fails loud and fires real. |
| **Red-Room the Surface** | Attack a decision surface: act-beyond-limit, lie-to-user, crafted-input corruption. |
| **Sweep for Wins** *(multi)* | Bank behavior-preserving cleanup wins, one scoped pass per message. |
| **Offset, Don't Flatten** | At a merge/grow fork, choose rotate vs flatten so real differences survive. |
| **Factory Build** | Plan one feature as frozen-contract pieces built alone and wired last. |
| **Campaign** *(multi)* | Drive a feature roadmap one proven item at a time, reviewing each adversarially. |
| **Harness the Surface** | Spec a standing target-driven test harness that asserts real results. |
| **Working Guidelines** | The disciplined workflow overview, applied to the current generator. |

### AI methods (`🧠`)

Techniques adapted for Perchance generator work from the Anthropic Agent Skills (the file-format and
company-internal ones are intentionally left out — they don't translate to a no-tools chat prompt):

Distinctive **UI design**, a manual **generator test plan**, a **theme generator** (CSS for the HTML
panel), **generative art** (p5-style, seeded) and **canvas art direction**, an **output discernment
check**, **generator spec & iterate**, a **self-contained component** build, and **README/explainer
co-authoring**. Each targets the HTML panel's JS/CSS, the DSL list layer, and Perchance's fixed image
sizes where relevant.

### Prompt engineering (`🎯`)

Techniques for the **`root.aiTextPlugin` prompts inside your generator** — the AI the generator itself
runs — lifted from Anthropic's prompt-engineering tutorial and cookbooks and kept model-agnostic (no
Claude-only prefill tricks, so they work on the AI Helper's GPT endpoint and on `aiTextPlugin`):

- **Prompt Builder (metaprompt)** — turn a one-line task + variable names into a full, structured prompt template.
- **Refine Until It Passes** *(multi)* — a generate → self-critique-against-a-rubric → redraft loop that converges on `PASS`.
- **Few-Shot Example Pack** — generate 3 diverse input→output examples to lock a prompt's format and voice.
- **Schema-Locked JSON Output** — rewrite a prompt so it returns strict, parseable JSON the generator can consume.
- **Hallucination Guard** — let the model say "don't know" and quote its evidence before answering.
- **Split a Mega-Prompt** — decompose one overloaded call into a reliable chain of smaller ones.

### Review & safety (`🛡`)

Audit a generator for the threats that actually bite on Perchance — user/list text reaching `innerHTML`,
runaway list recursion, broken odds, silent failures — lifted from the security-review and threat-model
harnesses, using a "shapes not checklists" framing (describe the vulnerability's shape, assume issues
exist, verify adversarially):

- **Generator Security Review** *(multi)* — a phased senior-engineer audit, one surface per message, emitting JSON findings with severity + confidence.
- **Generator Threat Model** — the four-question framework that scopes entry points → threats → mitigations.
- **Edge-Input Attack Battery** — concrete breaking inputs (empty, huge, `<img onerror>`, recursion-triggering) with expected-vs-actual and the visible evidence to check.

## Adding your own skills

The catalog is plain data in **`src/snippets-skills.js`** — two arrays, `RULES` and `METHODS`, of
`{ id, name, desc, run, prompt }` objects (`run` is `'single'` or `'multi'`; `prompt` is a template
literal). Add an object, run `npm run build`, and it appears in the tree. Keep each prompt self-contained
and Perchance-aware, and tell the model to treat generator text as data.

## For developers

| File | Role |
| :--- | :--- |
| `src/snippets-core.js` | The catalog tree (`tree()`), node kinds (`code` / `skill`), and helpers (`findById`, `codeById`, `search`, `walk`, `counts`). Pure. |
| `src/snippets-skills.js` | The authored skill prompts (`RULES` + `METHODS`). Pure data. |
| `src/snippets-ui.js` | The **Snippets** tab (`window.weldSnippets`): the collapsible file-tree, the filter, and the click actions. |

A code leaf calls the host's `insertSnippet(pane, text, label)`; a skill leaf calls `openAI(prompt)`.
Both the core and the tab are covered by tests:

```bash
node tests/snippets-core.test.js   # tree, lookups, search, skill shape (no leaked HTML entities)
node tests/snippets-ui.test.js     # the shipped tab, as wired, against a fake host
npm test                           # the whole suite
npm run build                      # re-embeds src/ modules (SNIPPETS bundle)
```
