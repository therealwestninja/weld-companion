# Generator skills

Open **Weld > Skills** on a Perchance generator. The library contains **166 presets in 17 sections** for full browser applications as well as creative generators. Dashboards and complex applications come first; all original 48 preset IDs remain compatible with favorites.

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
| Rebrand, simplify & privacy | 8 |
| AI input helpers & toolkit | 13 |

Browse collapsible sections or combine search, generator/application type, task mode and favorites. Generic tasks remain available for every type. Dashboard tasks cover feed adapters, financial calculations, provenance/freshness, terminal layouts, charts, recovery, report parity and AI analyst grounding. Advanced story/chat tasks cover branches, ensemble characters, memory, card interoperability, sync conflicts, vault recall and multimodal workflows. The prompts/models/plugins section covers compiled prompts, preset exchange, model capabilities, routing, reusable interfaces and agent/tool contracts.

**Skybridge** (Prompts, models & plugins): connect a generator to Weld Companion with the real `weld.skybridge` API (import, trigger call, capability checks, storage, own-model AI, bus) and diagnose a link that will not form. **SillyTavern, Chub & character cards**: Character Card V2/V3 import and export (JSON and PNG), field mapping and validation, alternate greetings and swipes, macros, example dialogue, Author’s Note and depth prompts, prompt inspector, Continue/Regenerate/Impersonate, personas, quick replies, regex rules, expressions, rolling summary, chat-log import/export, group chat, World Info upgrades (secondary keys, probability, recursion, budgets, timed effects), lorebook editor and import/export, and a Chub-style library. **Rebrand, simplify & privacy**: audit and replace branding, centralize it in one config block, remove promotional links and community/social chat features, go fully local. **AI input helpers & toolkit**: Rewrite & Fill buttons for prompt inputs (rewrite filled text, generate empty fields from the others and the generator context), fill-all, locks and undo, streaming with Stop, usage guard, diagnostics panel, command palette, share links and templates. Rebrand and removal skills apply only to generators you own or may modify and keep licence and attribution notices. Format-specific prompts tell the helper to check real sample files and keep unknown fields; they do not assert behavior of any particular app version.

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

Edit `src/skills-core.js` (catalog and pure prompt composition) and `src/skills-ui.js` (interface), then run `npm run build` and `npm run check`. The generated `SKILLS` block belongs to the build. Native helper internals are feature-detected by the shared `openPerchanceAI` adapter; live validation and installation in a userscript manager are separate checks.
