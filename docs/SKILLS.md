# Generator skills

Open **Weld > Skills** on a Perchance generator. The library contains **362 presets in 26 sections** for full browser applications as well as creative generators. Dashboards and complex applications come first; all original 48 preset IDs remain compatible with favorites. Two sections — **AI image generation** (prompt libraries, template/slot builders, edit-recipe studios, consent safeguards) and **Website builder** (idea → multi-section site, SEO, design tokens, render safety) — plus Dad-Chat troubleshooting playbooks and extra repair/quality skills were imported from the companion fork. The last six sections are **direct skills** — ready-to-send prompts, the single home for all AI prompt-skills (the [Snippets tab](SNIPPETS.md) is code boilerplate only). A full generated listing of every preset lives in [SKILLS-CATALOG.md](SKILLS-CATALOG.md) (`npm run docs:skills`).

| Section | Presets |
| --- | ---: |
| Dashboards & live data | 9 |
| Prompts, models & plugins | 11 |
| Debug & repair | 8 |
| Design & modernize | 8 |
| Add features | 8 |
| AI & media | 12 |
| Data & persistence | 10 |
| Performance & reliability | 8 |
| Accessibility & quality | 8 |
| Code & planning | 7 |
| Create a generator | 7 |
| Text & randomness | 5 |
| Stories & worlds | 8 |
| Games & interaction | 5 |
| SillyTavern, Chub & character cards | 31 |
| Dad-Chat projects | 29 |
| Rebrand, simplify & privacy | 8 |
| AI input helpers & toolkit | 13 |
| 📐 Working rules (direct) | 10 |
| 🧠 AI methods (direct) | 10 |
| 🎯 Prompt engineering (direct) | 6 |
| 🛡 Review & safety (direct) | 3 |
| 🎨 Web layout & UI (direct) | 7 |
| 🧊 3D & WebGL — Three.js (direct) | 7 |

Browse collapsible sections or combine search, generator/application type, task mode and favorites. Generic tasks remain available for every type. Dashboard tasks cover feed adapters, financial calculations, provenance/freshness, terminal layouts, charts, recovery, report parity and AI analyst grounding. Advanced story/chat tasks cover branches, ensemble characters, memory, card interoperability, sync conflicts, vault recall and multimodal workflows. The prompts/models/plugins section covers compiled prompts, preset exchange, model capabilities, routing, reusable interfaces and agent/tool contracts.

**Skybridge** (Prompts, models & plugins): connect a generator to Weld Companion with the real `weld.skybridge` API (import, trigger call, capability checks, storage, own-model AI, bus) and diagnose a link that will not form. **SillyTavern, Chub & character cards**: Character Card V2/V3 import and export (JSON and PNG), field mapping and validation, alternate greetings and swipes, macros, example dialogue, Author’s Note and depth prompts, prompt inspector, Continue/Regenerate/Impersonate, personas, quick replies, regex rules, expressions, rolling summary, chat-log import/export, group chat, World Info upgrades (secondary keys, probability, recursion, budgets, timed effects), lorebook editor and import/export, and a Chub-style library. **Rebrand, simplify & privacy**: audit and replace branding, centralize it in one config block, remove promotional links and community/social chat features, go fully local. **AI input helpers & toolkit**: Rewrite & Fill buttons for prompt inputs (rewrite filled text, generate empty fields from the others and the generator context), fill-all, locks and undo, streaming with Stop, usage guard, diagnostics panel, command palette, share links and templates. Rebrand and removal skills apply only to generators you own or may modify and keep licence and attribution notices. Format-specific prompts tell the helper to check real sample files and keep unknown fields; they do not assert behavior of any particular app version.

## Structure references and worked examples (1.65.0)

A prompt for a card, lore, chat-log or Dad-Chat skill has two extra parts, placed after the constraints and before your details:

- **STRUCTURE REFERENCE**: the layout diagram or file shape the task needs, so the helper does not guess. Packs: Dad-Chat project layout and load order, chat-turn flow and prompt assembly, data stores, the Dad-native character (`dad-char`), lore entry, world (`dad-world`) and lorebook envelopes, authoring and cost-control rules, editing conventions, hub flow, and the file-type index with its chat, backup, profile, Cloud Backup, transcript, interop and Weld wire shapes (from the [file templates](dad-chat/file-templates/README.md)); and for Tavern work the pipeline diagram, Character Card V2 and V3 structure, PNG chunk layout (`tEXt` `chara` / `ccv3`), `character_book` versus World Info JSON with a field map, chat-log JSONL, prompt order with depth injection, macros and a Tavern-to-Dad-native mapping.
- **WORKED EXAMPLE**: a short concrete request and the shape of a good (and sometimes bad) result. The helper is told to adapt it, never copy its sample values.

The skill detail view lists the packs included and lets you read each one before you send. Packs say they summarize public conventions; the project's own code and real sample files win, and the helper must report differences. Other skills are unchanged.

## Direct skills — ready-to-send prompts

The last four sections hold **direct skills**: a direct skill is a pre-written prompt, not a composed workflow. Its detail view shows a run badge (**Single-shot prompt** or **Multi-run prompt**) and a **The prompt that gets sent** disclosure with the full, editable text — there is no task/steps/check composition stage. These moved out of the old Snippets tab so Skills is the one place for AI prompt-skills.

- **📐 Working rules** (10) — the author's working-rules (prove-the-wire, verify-as-wired, byte-identical gate, and the rest), as prompts you can drop on any task.
- **🧠 AI methods** (10) — reusable methods (rotate-45, factory-build, reverse-treeshake, test-the-negative and friends) phrased as instructions to the helper, plus *Diagram the System* — pick the right diagram type from the question, lay it out so it reads (main path as a spine, branches hung off their owner, conditions on the edge), and emit clean Mermaid or inline SVG (adapted from the archify authoring method).
- **🎯 Prompt engineering** (6) — prompt-shaping skills (tighten a prompt, add structure, write a system preamble, and so on).
- **🛡 Review & safety** (3) — review and safety passes to run over generated output.
- **🎨 Web layout & UI** (6) — the biggest "it looks AI-made" complaint, answered. *De-Slop a Layout* names the generic tells (centered column, Inter font, purple gradient, uniform rounded corners, timid spacing) and rewrites with intent; *Pick a Design Direction* derives one bold aesthetic from a concrete generation engine + five tonal dials (not an adjective) with a real type/color/space system; *Build a Striking Layout* produces the production HTML/CSS; a *Responsive & Mobile Pass* and *Visual Polish Micro-Pass* finish it; *Review a UI (slop rubric)* grades a layout like an independent reviewer — acceptance vetoes, the 480px three-second test, banned-defaults and data-realism checks, and a score out of 10; and *Node / Flow Editor UI* builds a node-graph editor (nodes, edges, drag-to-connect, pan/zoom) either in React Flow — with the setup rules an AI always gets wrong (import the stylesheet, size the parent, memoize `nodeTypes`, wire `onNodesChange`, handles inside custom nodes) — or hand-rolled in plain SVG + pointer events for a single-file Perchance page. Grounded in the anti-slop guidance from Anthropic's frontend-design / web-artifacts-builder skills, the oil-ui reviewer method, and the xyflow (React Flow) docs.
- **🧊 3D & WebGL — Three.js** (7) — the "it can't make good 3D models" complaint, answered where the problem actually is. *Light, Tone & Grounding Rig* fixes the flat/plastic look (ACESFilmic tone mapping, sRGB, an IBL environment, a 3-point + rim light rig, grounded contact shadows); *Model by Blockout & Proportion* builds recognizable models by silhouette and ratio instead of a pile of default primitives; *Dial in PBR Materials* kills the plastic surface; *Stylized Low-Poly Look* makes simple geometry an intentional style; *Procedural Geometry from Parameters* generates meshes with correct normals/UVs and seeded variation; *3D Performance Budget* keeps it at 60fps (adaptive DPR, degrade order, context-loss handling); and *Combat & Game Feel* adds the systems that make a browser action game satisfying — hitstop, aim-snapping, input buffering, dodge priority, telegraphs, camera discipline, difficulty tuning (adapted from the guizang game-skill method).

A direct skill's **Send to Perchance AI** and **Copy prompt** work as for any skill; a third **→ AI Helper** action loads the prompt straight into your own AI Helper input (Tools → Model chat, the OpenAI-compatible endpoint), so you can send it through your configured model instead of Perchance's. Any details you type are appended to the prompt verbatim.

## Dad-Chat projects (29 skills)

For a Dad Chat (dad-chat-v2) generator. Every prompt starts with **PROJECT CONTEXT: DAD-CHAT**: the structure is a map to confirm against the real source, Dad-native is the master format and Tavern shapes are share-only.

- **Code, makes changes:** fix a bug, add a feature, improve or enhance an existing feature, add a new module or studio file, improve prompt assembly or steering text, add or fix a provider, polish styling, add or repair import and export, work on the hub, connect a feature to Weld Skybridge with the real wire shapes.
- **Code, review only:** map the project against the layout, diagnose a problem through the chat-turn flow, audit prompt assembly and token cost, audit saved data and storage keys, review escaping and secrets, review size and speed, check a change before shipping.
- **Content (review only, returns an importable file in the reply and does not edit the generator):** write a character, improve a character, build lore entries, audit a lorebook, build a world, cut fixed prompt cost, convert a Tavern V2/V3 card to Dad-native, write greetings and example dialogue.
- **File templates (review only, returns a file in the reply):** validate a file against its template and name its type, build a `dad-char-chat` or transcript file from pasted turns, prepare a `dad-full` backup, user profile or Cloud Backup file, convert World Info, JanitorAI, dexie, Story Forge or a chat log to Dad-native.

The source documents are in [dad-chat/](dad-chat/README.md). When they change, update `src/skills-refs.js` too; `tests/skills-core.test.js` checks that the packs still agree with the documents on key names and numbers and that every JSON example parses and follows the Dad-native rules.

Dropdown options use opaque backgrounds and text colors from Weld's adopted theme, with matching native dark/light controls (1.60.1).

Every preset has a workflow and acceptance checks. The detail view distinguishes **Review only** from **Makes changes**; researched additions link to their primary sources at inspected revisions or current official provider docs. See [selection rationale and all 14 repositories](SKILLS-SOURCES.md). These are original Perchance adaptations, not installed third-party agent packages.

## Run a skill

1. Open the generator editor (`#edit`) and its native AI helper.
2. Choose a preset. Search, section, type and mode filters narrow the catalog; favorites are saved locally as preset IDs. Quick-start buttons clear filters and select a task.
3. Add your goal, constraints or reproduction steps. Feature/build/specification tasks need a specific brief; upgrade failure analysis needs a proposed plan.
4. Optionally enable **Include live findings**, then select **Build prompt**. This reads the current editor through Weld's existing adapter and performs fresh analysis. Findings are heuristics; the prompt asks the helper to validate them. Rebuild if the editor changes.
5. Review or edit **Instructions to send**. Changes to goal, type, findings or concise-reply settings disable handoff until you rebuild so they cannot silently be omitted. An incompatible selected skill/type is reported; choose a matching preset or clear the type filter. Rebuilding or choosing another preset replaces your edited prompt.
6. Select **Send to Perchance AI**. Weld opens the native helper, appends the prompt to any existing draft, verifies the input retained it and focuses the input. It does not submit the request.
7. Review the helper input and press its **Send** button to run the skill. The native helper controls its own code edits and execution; Weld does not apply a proposal or guarantee model behavior.

**Copy prompt** uses the same editable instructions and works without the editor. Clipboard failure is reported with a manual-copy fallback. Unavailable native input produces an actionable error in Skills; there is no silent fallback to an unrelated model or window.

## Scope and persistence

Each preset identifies **Review only** or **Makes changes**. Review prompts request evidence and recommendations without edits. Implementation prompts request the smallest complete change, preserved features/storage, verified integration points and honest validation. These are AI instructions, not enforcement of the helper's behavior.

The optional **Concise helper replies** setting keeps explanations short while requiring complete code, names, errors and verification evidence. It does not reduce the scope of implementation or promise token savings.

Weld does not transmit source, findings or prompts while you browse this tab. Optional analysis is local. The handoff writes only to the native input; sending through the helper uses Perchance's AI service. No additional provider setup is required.

Favorites persist through Weld storage and contain only catalog IDs. Search, selection, goal and edited prompt are kept in memory for the page session. Changing generators clears the goal, findings option and draft so instructions for one generator are not reused accidentally. Reloading clears session drafts. Weld does not read credential settings when composing prompts. User-entered details and findings are included verbatim, so review them before handoff.

## Development

Edit `src/skills-core.js` (catalog and pure prompt composition), `src/skills-refs.js` (structure packs, preset-to-pack links and worked examples), `src/skills-dad.js` (Dad-Chat rows), `src/skills-direct.js` (the direct-skill prompts — the four `RULES`/`METHODS`/`PROMPTS`/`REVIEW` arrays) and `src/skills-ui.js` (interface), then run `npm run build` and `npm run check`. The generated `SKILLS` block belongs to the build. Native helper internals are feature-detected by the shared `openPerchanceAI` adapter; live validation and installation in a userscript manager are separate checks.
