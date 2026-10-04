# Character & World Studio

Available in Weld → **Studio**.

## Start a project

1. In **Tools → AI Helper**, save your local or cloud provider and model. For LM Studio, use the OpenAI-compatible provider and your server endpoint. Studio uses these existing settings; it does not need a second API key.
2. Open **Studio → New project / chatbot template**. Name the world and choose Single character, Narrated adventure, Ensemble cast, Quest giver, or World simulator.
3. Fill **World & settings** with the public setting, rules, and chatbot instruction.
4. In **Characters**, write personality, voice, goals, boundaries, opening message, example dialogue, and personal beliefs. Author notes are excluded from ordinary chat requests.
5. Add canon in **Lore**, then connections in **Relationships** and events in **Timeline**.
6. In **Test chat & memory**, choose a character and create a playthrough. Preview its context, then send a test message.

Templates provide editable behavioral instructions. Ensemble mode additionally includes public cast profiles so the narrator can portray distinct voices. Put secrets in private lore, not in public profiles or the world description.

## Canon, knowledge, and memory

- **Canon** describes the world itself. Optional subject/attribute/value fields let the checker find contradictions such as two different canonical ages for the same character.
- **Knowledge** determines who receives a lore entry, relationship, or timeline event. Public entries are available to everyone. Private entries are available only to checked characters; an empty list makes them author-only. A character's personal beliefs can intentionally disagree with canon.
- **Playthrough memory** belongs to one session. Model suggestions remain pending until you edit and approve them. Approval never rewrites world canon.

Lore activation can be always-on, comma-separated keyword/phrase matching, or disabled/reference-only. Matching is case-insensitive substring matching across the new message and recent conversation. Higher priority entries enter the lore budget first. Oversized entries are skipped as whole entries, with their titles shown in the context preview.

The exact system text and conversation text sent to the model are available through **Preview model context** and each saved test reply. Budgets count characters, not model tokens. Older conversation messages drop out before the total budget is exceeded; oversized fixed context produces an error rather than silently dropping world rules or approved memories. Models can still hallucinate or disregard instructions; context filtering is not a guarantee of faithful roleplay.

## Conversations and evaluation

Each playthrough has its own history, memories, proposals, and saved test replies. **Branch this playthrough** copies that state into an independent continuation. Change providers or models in Tools between tests, then compare saved replies A and B. Each reply records its model, request text, full context, and your evaluation notes.

**Stop generation** aborts the client request and ignores late callbacks. Whether the server immediately stops generating depends on the provider. Failed requests do not append fictional successful replies.

Memory suggestions use up to the latest 24 messages, dropping older ones to fit the project's context budget, and ask for a bounded JSON array. Invalid structured output is rejected. Review suggested memories for accuracy before approval. Approved memories can be edited or forgotten.

## Consistency checks

Local checks flag:

- conflicting structured facts;
- duplicate character names;
- missing character references in sessions, relationships, or knowledge lists;
- private entries known by nobody (an informational author-only reminder);
- keyword entries without keywords;
- missing or out-of-order timeline prerequisites.

Each issue links to its editor. **Ask model to review world consistency** performs an optional prose audit through your configured provider. It asks before sending all author material, including private lore and author notes. This review is advisory and never edits the project automatically.

## Existing lore and character tools

**Import existing Lore Library notes** copies catalog notes, tags, and source links into disabled, author-only entries. It does not fetch remote documents. Paste or edit their actual lore text, set activation, and choose knowledge visibility before using them.

Character import accepts a named AICC character, an AICC character bundle, or a share envelope. It maps the existing instruction and opening messages into the Studio editor for review.

**Export AICC character** reuses the companion's existing character sanitizer and bundle format. It includes a static character instruction and always-active known lore. Import that downloaded bundle using the existing Character Files tools. Dynamic retrieval and playthrough memory are active inside the Studio playground; the export does not install a runtime into Perchance's native Agent or arbitrary third-party chatbots.

## Saves, imports, and snapshots

Text edits save as you type; numeric settings save when committed. Studio stores separate project records in the userscript manager's local storage. After a page refresh, choose the saved project to reopen it. Draft unsent chat messages, context previews, and unsaved model audit reports are page-session-only.

Project JSON exports include characters, world, lore, relationships, timeline, template settings, playthroughs, approved/pending memory, and saved test replies. Provider keys are not part of the project. Imports validate format, version, types, IDs, collection sizes, and text limits before a preview/confirmation, then create a new project without replacing an existing one.

The latest ten snapshots are retained per project. Restoration first snapshots the current state. Snapshots can be downloaded separately. The main project export contains the current project state, not its snapshot archive.

Projects are limited to 4 MB of serialized text, with bounded collection sizes. Save an export and split large campaigns into separate projects before reaching this limit. Browser storage can also fill sooner; storage errors are shown. An already-observed edit from another tab prevents a stale save and asks you to export your draft and reopen the project. This revision check is not an atomic multi-user collaboration system; avoid editing the same project simultaneously in multiple tabs.

## Development and verification

Studio sources are maintained in:

- src/studio-core.js — project validation, context selection, memory approval, consistency, portability.
- src/studio-ui.js — interface and persistence.

The installable userscript contains a generated copy of these modules, so users need only the one userscript. After editing source, run from the repository root:

    npm run build
    npm run check

The check command rejects a stale generated bundle and runs the existing plus Studio regression tests. For an isolated browser fixture with a simulated model:

    node scripts/preview-studio.js 8766

Open http://127.0.0.1:8766. This fixture uses its own localStorage, not Perchance or Tampermonkey data. Stop the server with Ctrl+C.

For an optional live LM Studio smoke test using a synthetic world and the production provider adapter:

    node tests/studio-lm-smoke.js

The smoke test expects a running local server at http://127.0.0.1:1234. Optional arguments select endpoint and model ID. It is excluded from ordinary CI because CI has no local model server.
