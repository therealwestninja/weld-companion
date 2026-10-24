/* Structure references for Skills prompts: layout diagrams, file shapes and worked examples.
   Plain text only (String.raw, so JSON escapes stay literal). No network or editor access.
   Dad-Chat packs are distilled from docs/dad-chat/architecture.md and dad-native-format.md. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WeldSkillsRefs = factory();
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const pack = (id, title, text) => Object.freeze({ id, title, text: text.trim() });
  const packs = [
    // ------------------------------------------------------------------ Dad-Chat
    pack('dad-layout', 'Dad-Chat project layout and load order', String.raw`
Dad-Chat (Dad Chat v2) is one Perchance generator made of these files. Names below come
from the project documentation; confirm each against the real source before relying on it.

  main.pjs ......... plugin imports + tuning knobs + $meta. NO app logic.
  |                  imports: kv, generateText, image, uploadPlugin, superFetchPlugin,
  |                           createServerSocket, weldSkybridge, comments forum
  |                  knobs:   chatToCardMaxMessages = 40, chatToCardMaxCast = 6
  |                  helpers: themeStyle, forumSubmitStyle, galleryEmbedHtml, $meta, commentOptions
  v
  index.html ....... (a) hub SERVER: the first <script type="text/x-server-plugin"> block
  |                      (card index, ratings, authors, regions presence; code is public)
  |                  (b) app shell: DOM layout + first-paint CSS + the script tags below
  v
  src/
    styling.css .... ALL app CSS. The loading-screen block is duplicated inline in
    |                index.html for first paint: keep both copies in sync.
    manifest.json .. PWA manifest (display only)

  SCRIPT LOAD ORDER (later files reach earlier ones only through window.*):
    1  pjs-globals.js ....... root.* imports -> window.* (kv, generateText, image,
    |                         uploadPlugin, superFetchPlugin); ensureLib/ensureCss;
    |                         escHtml; pjsLiteral (wrap EVERY root.image({prompt}) call)
    2  weld-skybridge.js ..... optional Weld Companion link, fully additive
    3  agent-core.js ........ VFS tool definitions + argument sanitizers (window.DadAgentCore)
    4  code-viewer.js, providers.js ... provider/model catalog (window.Dad_PROVIDER_GROUPS)
    5  on-device-webgpu.js ... WebGPU model download manager (Profile modal)
    6  small UI modules ...... diag.js, theme-customizer.js, i18n.js, secret-vendor.js,
    |                         reminder-presets.js, prefix-styles.js, persona-dropdown.js,
    |                         avatar-generator.js, tokenizer.js, regions.js, image-link.js,
    |                         forge-core.js (Dad-native normalize/repair),
    |                         forge-bridge.js (Dad-native <-> Tavern/Forge conversion + download)
    7  henry-tucker.js ....... built-in soft preset (persona, greetings, lore, world bible);
    |                         seeded on demand, never force-injected
    8  image-forge.js ........ window.ImageForge: world/style prompt prepend, negative, CFG;
    |                         wraps every image call
    9  app.js (about 2.4 MB) . THE APP: state, chat engine, prompt assembly, render,
    |                         persistence, import/export, hub client, all modals
    10 studios (need app.js globals): forge-studio.js (window.WS, World Studio),
                              story-forge.js (window.StoryForge), scene-cast.js
                              (window.SceneCast), immersive.js (voice/SFX/scene image)

  WHERE NEW CODE BELONGS
    helper many files need ........ pjs-globals.js (loads first)
    provider or model ............. providers.js (a group in Dad_PROVIDER_GROUPS)
    UI widget with no chat state .. small module, loaded before app.js
    chat state or prompt change ... app.js, a narrow edit beside the related function
    world / lore / cast tooling ... a studio file (loads after app.js)
    styling ....................... styling.css (plus the inline first-paint copy if relevant)
    new Perchance import .......... main.pjs, then bridge it to window.* in pjs-globals.js

  DEBUG HANDLES: window.ProseEngine, ImageForge, WS, StoryForge, SceneCast,
  DadAgentCore, OnDeviceWebGPU.
`),
    pack('dad-flow', 'Dad-Chat chat-turn flow and prompt assembly', String.raw`
  INPUT              handleSend() in app.js: composer text + attachments + @Name guest
  |                  summons (resolveTurnSummonId; narration/impersonation use the GUEST
  |                  persona and lorebook, not the host's)
  v
  PROMPT ASSEMBLY    MemoryEngine.buildHistory (the diagnostics viewer runs the SAME
  |                  builders, so preview == real prompt)
  |   1 pre-instructions (preset/custom + tone) ......... FIXED, always sent, sent first
  |   2 character persona (+ player userDesc) ............ FIXED, always sent
  |        every persona character is paid on every turn: cost control lives here
  |   3 dynamic context, in this order:
  |        world block -> matched lore ([WORLD/LORE DATABASE], <= 6,656 chars,
  |        world description <= 50% of that, then the active [WORLD STATE] facts
  |        <= 1,500 chars when the world has any, then ranked entries) -> manual memory -> summaries ->
  |        retrieved memories -> pinned
  |   4 recent chat turns, then steering: reminder, density, ledger, author's note,
  |        prose director, scene state
  |   Lore ranking: keyword gate (threshold 0.9, typo tolerant) -> +0.1 per extra key
  |   match (max 0.3) -> priority bonus (up to +0.5) -> constant entries first -> fill the
  |   budget in rank order (injected / partial for priority > 80 / budget_cut).
  |   Ledger and prose blocks skip non-roleplay presets (Dad, Schnell Studio).
  v
  GENERATION         provider route from providers.js (cloud / local runtime / on-device)
  |                  mid-turn tools: web_search (DDG via superFetch, SearXNG fallback),
  |                  image_gen (through ImageForge), VFS file tools (agent-core.js)
  v
  RENDER             nodes -> DOM (createNodeDOM); markdown via marked + DOMPurify;
  |                  speaker-label stripping (stripKnownSpeakerLabels via
  |                  getCleanNodeContent); streaming renderer; action bars
  |                  (Illustrate, Send-to-Image-Gen, TTS, rating)
  v
  POST-TURN          Immersive.onTurnComplete (scene state/beat/preference), continuity
                     ledger updater (roleplay only), _persistThreads -> debounced Cloud
                     Backup, embedding warm-start for vectorized lore

  BUDGETS: lore block 6,656 chars; global scan depth 4; per-entry scanDepth 1-20;
  chat-to-card window 40 messages; free-tier total 8,000 (oldest chat trimmed first,
  curated content never trimmed).
`),
    pack('dad-data', 'Dad-Chat data stores (where state lives)', String.raw`
  config.characterBook[id] ............ character objects (authority store for cards)
  config.worldBook.worlds[id] ......... worlds; config.worldBook.activeWorldId = live one
  standalone lorebooks + lorebookRefs[] linked books, merged AFTER embedded lore
  threads -> nodes (threads, currentThreadId)  chat history as a branch TREE;
                                       the renderer walks the active branch only
                                       (getRenderPath)
  thread.* settings (authorNote, proseDirector, detachFromOrigin, userDescOverride,
  per-thread toggles) override app and character defaults

  PERSISTENCE
    live session ............. localStorage
    slots / index metadata ... kv.chatApp
    image blobs .............. ImageDB; per-thread VFS workspaces live outside slots
    optional Cloud Backup .... mirrors the last 200 messages to a public editable upload file

  GOTCHA: config is a top-level const (a global lexical), NOT window.config. A guard like
  window.config || {} is always empty.
`),
    pack('dad-character', 'Dad-native character file (dad-char) with example', String.raw`
Envelope: { "type": "dad-char", "version": 2, "data": { ...character... } }

FIELDS (config.characterBook[id])
  id ................ unique string (char_..., char_preset_..., char_imported_...); never reuse
  name .............. display name and the {{char}} value
  avatar ............ portrait only (URL or data); never reaches the model
  description ....... SHORT BIO, 1-3 sentences (import caps at 2000). Never paste the persona here
  systemPrompt ...... PERSONA BODY sent every turn (FIXED context). Canon + voice only
  profile ........... optional editor fields that compile into systemPrompt: name, age, gender,
                      appearance, personality, background, scenario, systemNote,
                      customSections[{header, content}]. If you emit profile, keep systemPrompt
                      consistent with it
  exampleDialogue ... [{name1, content1, name2, content2}] few-shot voice pairs (< ~40 words each)
  firstMessage ...... string[]: [0] = opening greeting, [1...] = alternates (hooks live here)
  userOverride ...... {name, description} player persona
  preInstruction .... preset key (default, roleplay, roleplay_v2, dad_roleplay, author_mode...) or "custom"
  preInstructionCustom  only used when preInstruction is "custom"
  reminderMessage ... ONE focused end-of-prompt directive
  authorNote, tags, lorebook {entryId: entry}, lorebookRefs [{id, enabled}]
  NEVER author: lorebookArchive, lastLoreRun, useCount, lastInjectedAt (runtime only)

EXAMPLE
{
  "type": "dad-char",
  "version": 2,
  "data": {
    "id": "char_mara_quill",
    "name": "Mara Quill",
    "description": "Dry-witted ferry pilot who knows every sandbar on the Sable River.",
    "systemPrompt": "# Character Profile: {{char}}\n## Appearance\nLean, sunburnt, braid tied with fishing line.\n## Personality\nBlunt, patient with strangers, hates wasted words.\n## Background\nInherited the ferry from her father; still owes the bank for the new boiler.\n## Scenario\n{{user}} needs passage upriver before storm season closes the channel.\n[SYSTEM NOTE: Short plain sentences. Never narrate {{user}}'s actions.]",
    "exampleDialogue": [
      { "name1": "{{user}}", "content1": "Can you get me to Harrow Bend by dark?",
        "name2": "{{char}}", "content2": "Maybe. Depends what you're carrying and whether you plan to complain about it." }
    ],
    "firstMessage": [
      "Mara is coiling rope when you reach the dock. \"Ferry leaves when the fog does. Pay now or swim later.\"",
      "The boiler coughs twice. Mara slaps it and looks you over. \"You the one asking about Harrow Bend?\""
    ],
    "preInstruction": "dad_roleplay",
    "reminderMessage": "Keep Mara guarded and practical; let trust be earned over several scenes.",
    "tags": ["river", "slice-of-life"],
    "lorebook": {
      "lore_boiler": { "id": "lore_boiler", "name": "The Boiler", "keys": ["boiler", "engine", "steam"],
        "content": "The Wren's boiler is new, patched and mortgaged. {{char}} talks to it like a stubborn mule.",
        "priority": 10, "constant": false, "vectorized": false, "enabled": true,
        "excludeRecursion": false, "scanDepth": null }
    }
  }
}
`),
    pack('dad-lore', 'Dad-native lore entry schema, ranking and example', String.raw`
ONE entry schema is used everywhere: character lorebook, standalone lorebook and world.

{
  "id": "lore_abc123",
  "name": "Bad Luck",
  "keys": ["bad luck", "bay gelding", "horse"],
  "content": "Bad Luck is {{char}}'s swaybacked bay gelding. Patient, stubborn, smarter than he looks.",
  "priority": 10,
  "constant": false,
  "vectorized": false,
  "enabled": true,
  "excludeRecursion": false,
  "scanDepth": null
}

  id ............ stable per entry
  name .......... real human name shown as [Entry: name]; never "Entry 3"
  keys .......... 3-6 lowercase trigger words, DISTINCT across entries. Overlap (the same
                  key in 3 entries) co-fires entries and burns the 6,656-char budget
  content ....... "Name - role. Fact 1. Fact 2. Voice cue. Constraint." Target <= 45 words
                  (authoring cap 70). {{char}} and {{user}} are the only placeholders
  priority ...... 1-100, default 10; higher wins ties and budget order (bonus up to +0.5)
  constant ...... always inject, bypasses keys. Reserve for <= 2 entries per book
  vectorized .... opt-in semantic matching (needs embeddings; otherwise keyword gate)
  enabled ....... false = skipped entirely but preserved across import/export
  excludeRecursion  true = hidden from recursive discovery
  scanDepth ..... number 1-20 or null. null = global window of 4 = the correct default;
                  never author 50 (import clamps to 20)

BAD ENTRY                                   GOOD ENTRY
  name: "Entry 3"                             name: "Settlements"
  keys: ["nevada","desert","frontier",        keys: ["town","settlement","outpost","saloon"]
         "west","town"]   (overlaps others)   content: 40 words, one pass per topic
  content: 200 words, tells the same          priority: 10   constant: false
           thing three ways                   scanDepth: null
  scanDepth: 50   constant: true (not needed)

Ranking: keyword gate (0.9, typo tolerant) -> +0.1 per extra key match (max 0.3) ->
+ priority bonus -> constants first -> budget fill in rank order.
`),
    pack('dad-world', 'Dad-native worlds, lorebooks and file envelopes', String.raw`
FILE ENVELOPES (what the app writes and imports)
  character ........ { "type": "dad-char", "version": 2, "data": { ...character... } }
  character lore ... { "version": "2.0", "characterId", "characterName", "exportedAt", "entries": [ ... ] }
  standalone book .. { "version": "2.0", "lorebookId", "lorebookName", "characterName",
                       "description", "enabled", "exportedAt", "entries": [ ... ] }
  world ............ { "type": "dad-world", "version": 1, "exportedAt": "...", "world": { ... } }
  chat + character . { "type": "dad-char-chat", "version": 2, "character": { }, "thread": { } }

WORLD (config.worldBook.worlds[id], live one chosen by activeWorldId)
{
  "type": "dad-world",
  "version": 1,
  "exportedAt": "2026-10-05T00:00:00.000Z",
  "world": {
    "id": "world_sable_river",
    "name": "The Sable River",
    "description": "A slow brown river cutting through dust country. Ferries are the only roads. Everyone knows everyone's debts. Magic does not exist; rumor does.",
    "entries": {
      "lore_ferries": { "id": "lore_ferries", "name": "Ferries", "keys": ["ferry", "crossing", "dock"],
        "content": "Three ferries work the Sable. Prices rise at dusk. Pilots trade news for free passage.",
        "priority": 20, "constant": false, "vectorized": false, "enabled": true,
        "excludeRecursion": false, "scanDepth": null }
    }
  }
}

World rules: the description is ALWAYS injected (before entries, capped at 50% of the lore
budget); state in it what every character knows. Entries carry the rest and are ranked like
character lore. A bible with no entries still injects.

MERGE ORDER into the prompt: (1) active world description + world entries, (2) the
character's embedded lorebook, (3) attached standalone books in attach order (first source
wins on duplicates). A book contributes only if the book is enabled AND its link in
lorebookRefs is enabled AND the entry is enabled.
`),
    pack('dad-rules', 'Dad-native authoring rules and cost control', String.raw`
MASTER FORMAT: Dad-native is the master. Tavern V2/V3 shapes are share-only exports and lose data
(mes_example slot empty, lorebookRefs flattened, scanDepth clamped). Imports may accept Tavern
shapes; new content and default exports must be Dad-native.

RULES
  - Persona (systemPrompt): canon + voice + speech patterns only. Never repeat the
    pre-instruction (agency, no puppeting {{user}}, consequences, proactive driving) or the
    lorebook (living world, reputation spreads). Those are already sent.
  - One fact once: a nickname origin, a scar story or a signature object lives in ONE field.
  - description (bio) is NOT systemPrompt (persona). Never leave description empty.
  - Greetings are hooks, not lore: keep verbatim, do not compress plot out of them.
  - Example dialogue is voice data: keep exchanges intact, short and in voice.
  - Lore: real names, 3-6 unique keys, scanDepth null, constant <= 2 per book, one spectrum
    pass per topic (no small/large/regardless-of-size triple telling).
  - Only {{char}} and {{user}} are substituted. Text is data: no code, no other placeholders,
    no instructions addressed to the reader.

COST CONTROL (worked reference: Henry Tucker, 18,896-char persona, about 25k FIXED chars/turn)
  cut order by saving: [SYSTEM INSTRUCTION] block (~8k -> ~2.5k, dedupe against pre-instruction
  and lore) -> towns entry (5,397 -> ~1,800) -> merge frontier entries (4,481 -> ~1,500) ->
  body/clothing/backstory (~42%) -> weather/horses/stagecoach (~50%) -> scenario (752 -> ~450).
  Keep greetings and example exchanges verbatim. Dedupe keys (nevada/desert/frontier in ONE
  entry). scanDepth 50 -> null. Rename "Entry N" to real names.

BEFORE / AFTER (persona line)
  before: "{{char}} always lets {{user}} decide, never acts for {{user}}, reacts to consequences,
           and drives the plot." (duplicates the pre-instruction, about 25 words wasted per turn)
  after:  delete it. The pre-instruction already sends it.
`),
    pack('dad-code-rules', 'Dad-Chat editing conventions and live verification', String.raw`
CONVENTIONS
  - window.* is the cross-file API. Later files call earlier ones through window.*.
  - config is a top-level const, not window.config.
  - Text is data. Escape untrusted strings with escHtml for HTML and pjsLiteral for image
    prompts (the image plugin evaluates prompts as Perchance templates, so wrap every
    root.image({prompt}) call). Card and lore text is never evaluated.
  - Storage keys, IndexedDB names and kv.chatApp slot shapes are a compatibility contract with
    saved data. Add fields; never rename or remove without a migration.
  - app.js is about 2.4 MB: find code by function name, edit narrowly beside it, never rewrite
    or reformat the whole file. Do not remove existing functions, commands or code paths;
    report dead-looking code instead.
  - Keep the inline first-paint CSS in index.html and the loading block in styling.css in sync.
  - Never hardcode or log keys, tokens or webhook URLs.

HOW TO MAKE ONE SAFE EDIT
  1 Find the function and every caller (search the name across src/ and index.html).
  2 State the file, the function and the load-order position you will touch.
  3 Change the smallest amount of code that works; keep public window.* names.
  4 Re-read the edited region and check the neighbors it calls and is called by.
  5 Verify: reload the page, exercise the changed path (open and close the modal, run the
    flow), confirm zero console errors and an empty perchanceErrors list. If you cannot run
    the page, say so plainly instead of claiming it works.
`),
    pack('dad-hub', 'Dad-Chat hub (sharing) flow', String.raw`
  client (app.js hub section) <--createServerSocket() RPC--> server (first script in index.html)

  RPCs: hubSearch, hubGetCard, hubGetAuthor, hubRegisterAuthor, hubBeginUpload, hubRegisterCard,
        hubUpdateCard, hubMyCards, hubRate, hubReport, hubDownloaded, hubStats (+ admin/backup)
  card bodies .... live in per-user editable upload files (bodyUrl)
  server index ... holds ONLY metadata + ratings + owner keys; owner keys are never returned
  presence ....... live region counts ride the ephemeral dad:regions pubsub channel
                   (regions.js beats about every 30 s)
  server code .... is public: never put secrets in it
`),
    // ------------------------------------------------------------ Dad-Chat file templates (docs/dad-chat/file-templates)
    pack('dad-file-index', 'Dad-Chat file types: detection, direction and authoring rules', String.raw`
Check a file: World Studio > Import > Parse & Route, or ForgeCore.detectType(ForgeCore.tolerantParse(text)).

FILE                         DIRECTION          detectType
dad-char                     export + import    dad-char       master character, envelope type "dad-char" version 2
dad-char-chat                export + import    dad-chat       character + ONE thread, restores both
dad-full                     export + import    dad-full       whole backup; import WIPES then restores
dad-world                    export + import    dad-world      lossless world file (type dad-world, version 1)
lorebook (character)         export + import    lorebook       { version "2.0", characterId, characterName, exportedAt, entries[] }
lorebook (standalone)        export + import    lorebook       same plus lorebookId, lorebookName, description, enabled
single lore entry            authoring only     -              the entry object used inside all of the above
Tavern V1 flat card          import only        tavern-v1      never author exports in this
Tavern V2 / Forge card       export + import    tavern-v2      spec chara_card_v2; Forge adds extensions.forge
Forge lorebook file          export + import    lorebook       dad keys AND a character_book wrapper (dual cue)
SillyTavern World Info       import only        lorebook       entries is an OBJECT keyed "0","1"...
bare V2 character book       import only        lorebook       entries is an ARRAY
JanitorAI lore               import only        array          top-level array of entries
Perchance dexie export       import only        dexie          { formatName "dexie", data: { data: [ { tableName, rows } ] } }
generic chat log             import (build)     chatlog        { messages: [ { role, name, content } ] }
chat transcript .txt         export             -              "Name:" line then the text; no header by default
user profile                 export + import    -              { type "dad-user-profile", version 1 }
Cloud Backup mirror          export             -              { app, exported, count, items[] }
Story Forge list             export + import    -              array of cast members; ZIP also holds worldbook.json (= dad-world)
hub publish payload          publish            dad-char       { type "dad-char", version 3.0, timestamp, data, meta }

RULES THAT ARE EASY TO BREAK
  Dad-native is the master; Tavern, V2 and Forge shapes are share copies that drop data.
  Share exports strip favorite, folder, lorebookArchive, lastLoreRun, lorebookRefs (flattened)
    and per-entry useCount and lastInjectedAt; only dad-full keeps them.
  Bio (description, at most 2000 chars) is not persona (systemPrompt). Card and lore text is data:
    only {{char}} and {{user}} are substituted. Lore entry rules are in the lore reference.
`),
    pack('dad-file-chat', 'Dad-Chat chat, backup, profile, Cloud Backup and transcript files', String.raw`
dad-char-chat  (character + one thread; imports restore both)
{
  "type": "dad-char-chat", "version": 2,
  "character": { "id": "char_x", "name": "Morgana Vex", "avatar": "", "description": "(short bio)",
    "systemPrompt": "(persona body)", "profile": { "name": "Morgana Vex", "scenario": "(scene)" },
    "exampleDialogue": [], "firstMessage": ["(greeting)"], "userOverride": { "name": "Jeff", "description": "" },
    "preInstruction": "roleplay", "reminderMessage": "", "tags": [], "lorebook": {}, "lorebookRefs": [] },
  "thread": { "id": "thread_x", "title": "Market Week", "characterId": "char_x", "rootId": "n_root",
    "createdAt": 1720000000000,
    "nodes": {
      "n_root": { "id": "n_root", "parentId": null, "nextId": "n_u1", "role": "system-root" },
      "n_u1": { "id": "n_u1", "parentId": "n_root", "nextId": "n_a1", "role": "user", "name": "Jeff",
        "content": "(user turn)", "timestamp": 1720000001000 },
      "n_a1": { "id": "n_a1", "parentId": "n_u1", "nextId": null, "role": "assistant",
        "name": "Morgana Vex", "content": "(reply)", "timestamp": 1720000002000 } } }
}
  THREAD SHAPE (as in the template): nodes form a linked list. One system-root node (parentId
  null), every later node's parentId is the previous node and nextId the next, the last nextId
  is null. Roles used: system-root, user, assistant. rootId names the system-root node.

dad-full  (import WIPES the app, then restores; backup-only fields are kept)
  { "type": "dad-full", "version": 2, "appVersion": "Dad-CORE v2.0", "date": "ISO time",
    "config": { "characterBook": { "<charId>": { ...character plus favorite, folder... } },
                "worldBook": { "version": 1, "activeWorldId": null, "worlds": { } } },
    "threads": { "<threadId>": { id, title, characterId, rootId, nodes } },
    "currentThreadId": "<threadId>" }
  A hand-made backup must warn the user that importing it replaces everything.

user profile (Profile download .UserProfile.json; avatar accepted only as https on import)
  { "type": "dad-user-profile", "version": 1, "profileLabel": "Main", "chatName": "Jeff",
    "avatar": null, "systemPromptContext": "(who the player is)" }

Cloud Backup mirror (last 200 messages, text cut at 2000 chars)
  { "app": "dad-chat", "exported": "ISO time", "count": 2, "items": [
    { "threadId": "thread_x", "nodeId": "n_u1", "role": "user", "name": "Jeff", "ts": 1720000001000, "text": "..." } ] }

hub publish payload (card bodies live in per-user editable files, not the index)
  { "type": "dad-char", "version": 3.0, "timestamp": 1720000000000, "data": { id, name, description,
    systemPrompt, firstMessage[], tags[], lorebook {}, lorebookRefs [] },
    "meta": { "stripped_images": false, "hub_card": true, "original_id": "char_x" } }

TRANSCRIPTS (.txt, UTF-8 with BOM, neutral name transcript_YYYY-MM-DD_HH-MM.txt)
  Default: no header. Each turn is "Name:" on its own line, the text on the next lines, a blank
  line between turns, and an image as a line "[Image: caption]".
    Jeff:
    I approach the wagon.

    Morgana Vex:
    She slides a tin across the counter.
  With header:true the same turns sit between a title block (DadChat - Chat Transcript, Thread,
  Character, User, Messages, Exported) and a rule line, with a footer line and link.
`),
    pack('dad-file-interop', 'Tavern, Forge, World Info, JanitorAI, dexie and Story Forge file shapes', String.raw`
Forge character card = Tavern V2 card with data.extensions.forge:
  { "kind": "character", "world_bible": "(world text)", "user_persona": { "name": "", "description": "" },
    "source": { "app": "daddy-ai-chat", "type": "dad-char", "id": "char_x" } }

Forge lorebook file (dual cue: dad keys AND a character_book wrapper, same entries twice):
  { "name": "", "description": "", "characterName": "", "characterId": "", "scan_depth": null,
    "token_budget": 512, "recursive_scanning": true, "extensions": {}, "entries": [ ...V2 entries ],
    "character_book": { "name", "description", "extensions": {}, "entries": [ ...V2 entries ] } }

V2 book entry (inside character_book.entries, bare book or Forge file)
  { "id": 0, "entry_id": 0, "keys": [], "secondary_keys": [], "comment": "Entry name", "name": "Entry name",
    "content": "", "constant": false, "vectorized": false, "selective": false, "insertion_order": 10,
    "priority": 10, "enabled": true, "position": "before_char", "case_sensitive": false,
    "exclude_recursion": false, "scan_depth": null, "display_index": 0, "extensions": {} }
  Bare V2 book: { name, description, scan_depth 4, token_budget 512, recursive_scanning, extensions, entries: [ ARRAY ] }

SillyTavern World Info: { "entries": { "0": { uid, key[], keysecondary[], comment, content, constant,
  selective, selectiveLogic, order, position, disable, excludeRecursion, probability, depth, group,
  scanDepth, sticky, cooldown, delay, displayIndex } } }   entries is an OBJECT, "disable" is the
  inverse of enabled, "order" is priority, "comment" is the entry name.

JanitorAI lore: a TOP-LEVEL array of { keys[], name, content, priority, constant, enabled }.
  The lore importer checks arrays first.

Perchance dexie character export:
  { "formatName": "dexie", "data": { "data": [ { "tableName": "characters", "rows": [
    { "name", "roleInstruction", "initialMessages": [ { "author": "ai", "content" } ],
      "reminderMessage", "avatar": { "url" } } ] } ] } }
  The persona text is roleInstruction and the greetings are initialMessages; confirm the Dad-Chat
  importer's real mapping before relying on it.

Generic chat log (source for Studio > AI build): { "messages": [ { "role": "user|assistant", "name", "content" } ] }

Story Forge character list (ZIP part): [ { id, name, role, aliases[], appearance, personality,
  background, relationships, scenario, systemNote, tags[], firstMessage, quotes[] } ]. The ZIP
  also holds *_World.png, *_Name.png, worldbook.json (a dad-world file) and README.txt.

CONVERSION NOTES: a Tavern V1 card is flat (name, description, personality, scenario, first_mes,
  mes_example, system_prompt, post_history_instructions, alternate_greetings, tags). V2 and Forge
  exports are lossy; see the Tavern <-> Dad-native mapping for what each field becomes.
`),
    pack('dad-file-weld', 'Weld Skybridge wire shapes (ai, modelInfo, storage, bus)', String.raw`
A Dad-Chat feature talks to the Weld companion through weld.skybridge (sb.has(...) to detect a
capability, sb.ai(prompt, options) for completions, the storage and bus calls). Prompts go
up, completions come down, keys never cross. Every result is DATA ({ ok, ... }), never an
exception. With no companion present, storage falls back (kv, then persist, then memory) and
ai reports { ok: false, reason }.

ai request   { "prompt": "(text)", "system": "(optional)", "maxTokens": 200, "temperature": 0.7, "json": false }
ai result    { "ok": true, "value": "(completion text)" }   or   { "ok": false, "reason": "(why)" }
modelInfo    { "ok": true, "provider": "companion", "model": "(name)", "contextWindow": 0, "maxOutput": 0 }
storage link record   { "at": 1720000000000, "protocol": 1 }
bus envelope          { "channel": "dad:regions", "message": { "generator": "dad-chat", "count": 1 } }

Rules: never put a key, token or webhook URL in a request, a result, a stored record or a bus
message; check ok before reading value; keep the feature working when the companion is absent.
`),
    // Weld pathways for ANY generator (not only Dad-Chat)
    pack('weld-caps', 'Weld Skybridge capabilities and request shapes', String.raw`
Every call is sb.request(capability, payload) on window.weld.skybridge. It resolves DATA, never throws:
{ ok: true, value } or { ok: false, reason, code? }. Gate each call on sb.has('<capability>'). With no
companion every capability is absent, so the generator must keep working without it.

storage    { op:'get', key } / { op:'set', key, value } / { op:'list', prefix }   (sb.storage.* wraps these and falls back)
ai         { prompt, system?, maxTokens?, temperature?, json? }  -> { ok, value }   (the key never crosses)
model      {}  -> { ok, provider, model, contextWindow, maxOutput }  or { ok:false, reason:'no-own-model' }
fetch      { url, method?, headers?, body? }  -> { ok, status, url, body, truncated }  (public http(s) only, 200 KB cap)
search     { query, max? (1-10) }  -> { ok, results:[{ title, url, snippet }] }
bus        { op:'publish'|'subscribe'|'unsubscribe', channel, message? }   (small validated envelopes)
download   { filename, text, mime? }  -> { ok, value:{ filename, bytes } }
           text up to 5 MB; types: txt md json csv html xml css js; executables are refused
clipboard  { text }  -> { ok, value:{ chars } }   (up to 1 MB; may fail with reason 'clipboard-blocked')
notify     { text, ms? }  -> { ok }   (one line, 200 chars, shown on the host page; rate limited)
tokens     { text }  -> { ok, value:{ tokens, chars, words, method } }   (local estimate, no model or network)

Reasons seen: denied, unsupported, bad-request, text-required, too-large, blocked-type, unsupported-type,
rate-limited, no-own-model, timeout, network-error. Branch on ok and show the reason; never expect an exception.
`),
    pack('weld-family', 'Rules for a generator that joins the Weld family', String.raw`
- Tag: lowercase generator name, characters outside a-z 0-9 - become -, trim dashes, max 64. Key every stored
  record and every status display by this tag, never by the display title.
- Own keys only: write under weld:genvault:<tag>/ (snapshot, chat/index, chat/snap-<at>-<rand6>). Stamp
  generator and folder with YOUR tag. Never read, copy or rewrite another generator's keys.
- Custodian rule: the companion stores and displays; the generator owns, migrates and cleans its own data.
  Legacy dadchat:vault:* keys are read-only to everything but their owner.
- Both generator-copy shapes are valid ({ bundle, source } or { modelText, outputTemplate, srcManifest }); optional
  fields (redacted count) may be missing; unknown fields must not break parsing.
- Secrets: store secret-shaped config values (key, secret, token, webhook) as [redacted]; never log, store or
  send keys, prompts or tokens outside the storage tier.
- Fallback ladder: companion storage -> kv -> memory. A denied or absent companion is a normal state, shown
  honestly (a small status line: linked or not, protocol, storage backend), never an error screen.
- Bus: dad:genvault announces { v:1, type:'vault-updated', generator, at, from }; dad-chat:presence beats
  { v:1, type:'presence'|'presence-bye', id, from, gen, at }. Keep them under 2 KB, validate every inbound one.
- Load order: the bridge file after the plugin import, the vault file last; call root.weldSkybridge() once.
`),
    // Dad-Chat family Weld-app skills (from the generator's prompts/weld-app; the generator source wins on any disagreement)
    pack('dad-skill-vault-bridge', 'Skill: generator-vault-bridge (vault storage and bus contract)', String.raw`
## generator-vault-bridge

Purpose: let any dad-chat-family generator keep persistent off-origin backup
copies through companion storage, surviving browser cache resets. (Sender
reference: dad-chat-sync ${'`'}src/gen-vault.js${'`'}, skybridge protocol 1. Replaces
the older vault skill text — that one documented a sibling-only shape.)

Key namespaces (all values JSON, up to ~2MB; ${'`'}get${'`'} is null-safe on miss):
- ${'`'}weld:genvault:<gen>/snapshot${'`'} — generator-source copy, ONE key per
  generator. ${'`'}<gen>${'`'} matches ${'`'}^[a-z0-9-]{1,64}$${'`'}.
- ${'`'}weld:genvault:<gen>/chat/index${'`'} — chat-copy index (array of
  ${'`'}{name, key, takenAt, threadCount, charCount}${'`'}).
- ${'`'}weld:genvault:<gen>/chat/snap-<at>-<rand6>${'`'} — chat copies (max 10/gen):
  ${'`'}{v:1, at, protocol, generator, folder, savedBy, name, kind:"dad-full",
  size, redacted, data:{threads, currentThreadId, config}}${'`'}. ${'`'}redacted${'`'} is
  OPTIONAL (sibling senders omit it) — never require it.
- Generator-copy records come in TWO shapes — support both, never assume one:
  (a) ${'`'}{v, at, protocol, generator, folder, savedBy, title,
  bundle:{name,imports,code}, source:{apiUrl,fetchedAt,bytes,truncated,
  reason,coverage}}${'`'} (note: covers main.pjs + imports only — index.html and
  src/ files are NOT in it); (b) ${'`'}{v, at, protocol, generator, folder,
  savedBy, title, modelText, outputTemplate, srcManifest}${'`'}.
- Legacy ${'`'}dadchat:vault:index${'`'} + ${'`'}dadchat:vault:*${'`'}: read-only visibility.
  Generators own migration; the app never migrates, renames, or deletes these.

Ops: ${'`'}set${'`'} (write/overwrite), ${'`'}get${'`'} (null-safe), ${'`'}list${'`'} (prefix match on
${'`'}weld:genvault:${'`'}). Resolve result objects (${'`'}{ok:true,…}${'`'} / ${'`'}{ok:false,
reason}${'`'}) — never throw across the bridge.
Bus: relay ${'`'}dad:genvault${'`'} envelopes ${'`'}{v:1, type:"vault-updated", generator,
at, from}${'`'} (~2KB cap, drop malformed) so member views refresh. Never publish
on member channels yourself.
Consent: vault reads/writes ride the standard per-capability storage consent.
Denial resolves ${'`'}{ok:false, reason:'denied by the user'}${'`'} — senders fall back
to kv, then memory, on their own.
Privacy: never log or persist storage values, prompts, keys, or tokens
outside the storage tier itself. Records arrive secret-redacted
(${'`'}[redacted]${'`'}); sibling records may carry a ${'`'}redacted${'`'} count or not. Never
un-redact, and flag (never transmit) any plaintext secret-shaped value found.
Custodian rule: never rewrite ${'`'}generator${'`'}/${'`'}folder${'`'}, never move keys across
owners, never "repair" records, exact-key deletes only with user confirm.

Health check: generator ${'`'}dad-chat-sync${'`'} round-trips (set → get → list shows
${'`'}weld:genvault:dad-chat-sync/snapshot${'`'}); a mismatched-${'`'}generator${'`'} record is
refused everywhere except byte-identical passthrough reads.
`),
    pack('dad-skill-session-slots', 'Skill: dadchat-session-slots (local save slots, file compatibility)', String.raw`
## dadchat-session-slots

Purpose: the named-restore-point system of dad-chat-family generators, for
reimplementation or file-level compatibility elsewhere. (Reference: dad-chat-sync
${'`'}SaveSlots${'`'}, ${'`'}src/app.js${'`'}, ${'`'}window.SaveSlots${'`'} + ${'`'}window.openSaveSlots()${'`'}.)

Scope note: slots live in each generator's LOCAL kv store — the companion
app never sees them live and MUST NOT try to sync, mirror, or manage them.
This skill exists so files exported from slots stay readable/writable by
other tools, and so the slot system can be rebuilt faithfully elsewhere.

Keys (local kv folder, e.g. ${'`'}kv.chatApp${'`'}): index ${'`'}save_slots${'`'} (object
id → ${'`'}{name, takenAt, threadCount, charCount, currentTitle}${'`'}) + one record
per slot at ${'`'}saveslot:<id>${'`'}, id = ${'`'}slot_<base36time>_<rand6>${'`'}
(${'`'}/^slot_[a-z0-9]+_[a-z0-9]+$/${'`'}). Existing session keys (${'`'}threads${'`'},
${'`'}current_thread_id${'`'}, ${'`'}config${'`'}) are never touched by slot writes.
Record: ${'`'}{version:1, name, takenAt,
data:{threads, currentThreadId, config}}${'`'} — a full live snapshot (threads =
branch-tree map, config = whole config incl. characterBook). Max 8 slots;
names 1–40 printable chars, no control chars, unique case-insensitively,
confirm before replace. Validate on list AND restore (version, name,
timestamp, data/threads/config/currentThreadId); damaged slots are offered
for deletion, never applied.
Flows: save clones the LIVE objects; restore always confirms (stronger
wording while generation/pending-save runs), stops live generation, then
assign → per-thread image migration → persist → reload. Quota failure toasts
a recovery path (download slot as ${'`'}dad-full${'`'} file, delete old slots) and
never half-writes. Delete offers download-first. Slots survive factory reset
— they are the recovery path.
NOT snapshotted: image blobs + per-thread VFS workspaces (shared live by
uuid; restores are instant, placeholders only if the image store was wiped).
File shape: slot downloads are ${'`'}dad-full${'`'} JSON — see skill
${'`'}dadchat-dad-full${'`'}. Slot keys can never collide with ${'`'}weld:genvault:*${'`'} or
${'`'}dadchat:vault:*${'`'} (disjoint namespaces by construction, local-kv only).

Health check: save → index + ${'`'}saveslot:*${'`'} exist, session keys untouched;
restore round-trips counts; reset keeps slots restorable.
`),
    pack('dad-skill-presence-bus', 'Skill: dadchat-presence-bus (presence and dad:genvault channels)', String.raw`
## dadchat-presence-bus

Purpose: the two skybridge-bus channels dad-chat-family generators use, and
what the companion app relays vs owns. (Reference: dad-chat-sync
${'`'}src/weld-bridge.js${'`'}; bus used only when the companion advertises ${'`'}bus${'`'}.)

${'`'}dad-chat:presence${'`'} — per-tab liveness. Envelopes
${'`'}{v:1, type, id, from, gen, at}${'`'} where type is ${'`'}presence${'`'} or ${'`'}presence-bye${'`'},
${'`'}id${'`'} = ${'`'}<tabId>:<seq>${'`'}, ${'`'}from${'`'} = tab id (8–64 chars ${'`'}[A-Za-z0-9_-]${'`'}), ${'`'}gen${'`'} =
generator tag (≤64), ${'`'}at${'`'} = epoch ms. Validation (relay AND display): object,
≤2048 serialized chars, ${'`'}v:1${'`'}, known type, non-empty ${'`'}from${'`'} (≤64), ${'`'}at${'`'} sane
and within ±5 min, ${'`'}id${'`'} present (≤96), ${'`'}gen${'`'} string (≤64). Beats every ~20s;
peers expire after ~60s silence; ${'`'}presence-bye${'`'} on tab hide. Own-tab echoes
and duplicate ids are ignored; malformed messages count as ignored, never
error. The app's role: relay + count peers per tab. It never synthesizes
presence for a generator.
${'`'}dad:genvault${'`'} — vault change notices. Envelopes ${'`'}{v:1,
type:"vault-updated", generator, at, from}${'`'}, ~2KB cap. Purpose: refresh open
vault views cross-tab. The app relays and may refresh its own family-section
view; it NEVER publishes these (generators announce their own saves/deletes).
${'`'}dad:regions${'`'} is server-side pubsub (hub live-region counts), NOT companion
bus — the family section does not subscribe to it; per-country presence is
the hub server's job.
General bus rules: small envelopes only; validate shape + size, drop
malformed silently with a counter; ${'`'}{ok:false, reason}${'`'} on denial/failure,
never throw; no routing of chats and no channel subscriptions on a member's
behalf — AI and bus stay opt-in helpers.

Health check: two tabs beating show "1 other tab" each; a ${'`'}vault-updated${'`'}
envelope refreshes the family view within seconds; malformed envelopes
increment the ignored counter and nothing else.
`),
    pack('dad-skill-dad-full', 'Skill: dadchat-dad-full (dad-full JSON envelope)', String.raw`
## dadchat-dad-full

Purpose: the ${'`'}dad-full${'`'} JSON envelope — the interchange format for full
session payloads across the dad-chat family. Download it, read it, write it
compatibly. (Reference: dad-chat-sync template ${'`'}src/file-templates/
03-dad-full.json${'`'}; producers: slot download, vault chat-copy download, full
backup.)

Envelope: ${'`'}{type:"dad-full", version:2, appVersion:"Dad-CORE v2.0",
date:<ISO>, config, threads, currentThreadId}${'`'} plus provenance (${'`'}slotName${'`'}
for slot files, ${'`'}vaultName${'`'} for vault files — either, never both required).
- ${'`'}config${'`'}: whole config object — ${'`'}characterBook${'`'} (Dad-native character
  objects per ${'`'}src/dad-native-format.md${'`'} §1: id/name/avatar/description/
  systemPrompt/profile/exampleDialogue/firstMessage/tags/lorebook/
  lorebookRefs…), ${'`'}worldBook${'`'} (${'`'}{version, activeWorldId, worlds}${'`'}), settings.
  Local-only fields may be present (${'`'}lorebookArchive${'`'}, ${'`'}lastLoreRun${'`'},
  per-entry ${'`'}useCount/lastInjectedAt${'`'}) — a compatible reader MUST ignore and
  MUST NOT author them. Secret-shaped values should arrive as ${'`'}[redacted]${'`'};
  treat any plaintext secret-shaped value as untrusted (flag, never forward).
- ${'`'}threads${'`'}: map id → ${'`'}{id, title, characterId, rootId, nodes:{id →
  {id, parentId, nextId, role, content…}}}${'`'} — a branch tree; the active
  branch is what renders. ${'`'}currentThreadId${'`'} may be null (empty session).
- Filenames: ${'`'}dad-save-<safe-name>-<epoch>.json${'`'} (slots),
  ${'`'}genvault_<gen>_chat_<safe-name>-<epoch>.json${'`'} (vault copies).
- Writers: Dad-native shapes only, never Tavern; ${'`'}{{char}}${'`'}/${'`'}{{user}}${'`'} are
  the only placeholders (literal replace at prompt time — never evaluate
  text on import). Readers: validate ${'`'}type${'`'}/${'`'}version${'`'}/threads/config before
  applying anything; damaged payloads are refused with the reason named,
  never partially applied.

Health check: a slot-downloaded file re-imports with identical thread and
character counts; a tampered ${'`'}type${'`'} field is refused with a named reason.
`),
    pack('dad-skill-wire-envelopes', 'Skill: dadchat-wire-envelopes (ai, model, storage, bus shapes)', String.raw`
## dadchat-wire-envelopes

Purpose: compact reference for every small wire shape between
dad-chat-family generators and the companion app. (References: dad-chat-sync
${'`'}src/file-templates/23–27${'`'}, ${'`'}src/weld-bridge.js${'`'}.)

- AI request (generator → app): ${'`'}{prompt, system?, maxTokens?, temperature?,
  json?}${'`'} (template 23). Prompts are opaque text — never log or persist them.
  Cap ${'`'}maxTokens${'`'} to the model's ${'`'}maxOutput${'`'} when known.
- AI result (app → generator): ${'`'}{ok:true, value}${'`'} or ${'`'}{ok:false, reason}${'`'}
  (template 24). Reasons are short machine strings (${'`'}unsupported${'`'},
  ${'`'}disconnected${'`'}, ${'`'}denied…${'`'}, ${'`'}error${'`'}) — never stack traces, never key
  material.
- Model info (app → generator): ${'`'}{ok:true, provider, model, contextWindow,
  maxOutput}${'`'} (template 25). Absent companion model → ${'`'}{ok:false,
  reason:"no-own-model"}${'`'} — healthy bridge, not a fault; display honestly.
- Storage record (either direction): any JSON value up to ~2MB; the minimal
  shape is ${'`'}{at, protocol}${'`'} (template 26, the link-record shape
  ${'`'}weld:link-record${'`'} ${'`'}{at, protocol, backend, build}${'`'}). ${'`'}get${'`'} on missing keys
  resolves null inside ${'`'}{ok:true}${'`'}; ${'`'}list(prefix)${'`'} returns matching keys
  (may include tombstoned keys — surface as stale, never purge).
- Bus envelope (either direction): ${'`'}{v:1, type, …fields}${'`'} ≤ ~2KB (template
  27 shows the shape class). Known types: ${'`'}presence${'`'} / ${'`'}presence-bye${'`'} (channel
  ${'`'}dad-chat:presence${'`'}), ${'`'}vault-updated${'`'} (channel ${'`'}dad:genvault${'`'}). Validate
  ${'`'}v${'`'} + ${'`'}type${'`'} + size; drop malformed with a counter.
- Universal: every cross-bridge call resolves a result object — ${'`'}{ok:true,…}${'`'}
  or ${'`'}{ok:false, reason}${'`'} — and NEVER throws across the bridge.

Health check: ${'`'}modelInfo${'`'} → ok-shape or honest ${'`'}no-own-model${'`'}; storage
self-test ${'`'}set=true get=true list=true${'`'}; an over-size bus message is dropped
and counted.
`),
    pack('dad-skill-world-state', 'Skill: dadchat-world-state (Living State worlds)', String.raw`
## dadchat-world-state

Purpose: the Living State system — how a dad-chat world records what has
*changed* from its base setting, and how that reaches the model.
(Reference: dad-chat-sync ${'`'}src/app.js${'`'} ${'`'}LoreEngine.buildWorldBlock${'`'},
${'`'}src/forge-studio.js${'`'} World Studio card, template
${'`'}src/file-templates/04-dad-world.json${'`'}, spec ${'`'}src/dad-native-format.md${'`'} §4.)

- World shape: ${'`'}{id, name, description, entries:{id →
  {id,name,keys[],content,priority,constant,vectorized,enabled,
  excludeRecursion,scanDepth}}, state:{updatedAt, facts:[{id,text,active}]}}${'`'}.
  ${'`'}state${'`'} is ABSENT on legacy worlds — every reader tolerates that, never
  migrates or fabricates it.
- Meaning: base ${'`'}description${'`'} + ${'`'}entries${'`'} say what the world *was*; active
  ${'`'}state.facts${'`'} say what *changed* (someone gone, money moved, a door now
  locked). One short sentence per fact.
- Prompt injection order inside the world block: description first (capped at
  50% of the 6,656-char lore budget), then ${'`'}[WORLD STATE — what has changed]${'`'}
  with the active facts (capped 1,500 chars, always sent when present), then
  ranked entries get the remainder. The world block merges AHEAD of character
  lore, so it reaches every character in that world.
- Studio: the "Living State" card adds (${'`'}WS.addStateFact${'`'}) / removes
  (${'`'}WS.toggleStateFact${'`'}) facts. ⬇ Dad-native world export carries ${'`'}state${'`'};
  re-import adopts it only when the existing world has none.
- ${'`'}dad-full${'`'} slot/vault copies carry the whole ${'`'}config${'`'}, so ${'`'}worldBook${'`'}
  (including ${'`'}state${'`'}) travels automatically — a compatible reader must
  preserve it byte-identical and must never author ${'`'}useCount${'`'}-style fields.

Health check: a world with 3 active facts renders ${'`'}[WORLD STATE]${'`'} with all 3;
a legacy world without ${'`'}state${'`'} renders its bible unchanged.
`),
    pack('dad-skill-curated-density', 'Skill: dadchat-curated-density (prompt packing and budgets)', String.raw`
## dadchat-curated-density

Purpose: how a dad-chat turn packs the most continuity per token, and the
budgets every block obeys. (Reference: dad-chat-sync ${'`'}src/app.js${'`'}
${'`'}MemoryEngine.buildHistory${'`'}, ${'`'}CuratedDensity${'`'}, ${'`'}SummarizationEngine${'`'},
${'`'}ContinuityLedger${'`'}, ${'`'}src/architecture.md${'`'} §4.)

- Model window: read live via ${'`'}root.generateText({getMetaObject:true})${'`'}
  → ${'`'}idealMaxContextTokens${'`'} (≈6,000) — a recommendation, never hardcoded.
  Token counting uses the o200k tokenizer when loaded, chars/4 fallback.
- Prompt layers, in order: FIXED context (pre-instructions + character
  persona — always sent, never counted) → CURATED (always kept, each piece
  self-capped) → recent CHAT (the only thing that yields) → steering
  injections by depth (reminder, ledger at 3, author's note, prose at 1,
  immersive scene state, manual pin last).
- Curated caps: world block ≤6,656 chars (bible ≤50%, state ≤1,500 chars,
  entries get the rest) + character lore ≤6,656 chars; summaries selected
  (≤12, oldest-high-level + newest) then token-capped ≤1,800 (oldest
  foundation first, newest fill, middle yields); recalled memories ≤1,500
  chars (top-5, score>0.6, labelled use-only-if-relevant); pinned anchors
  ≤1,500 tokens; continuity ledger ≤900 tokens + card baselines ≤420.
- Duplicate suppression (${'`'}CuratedDensity.dedupeBlocks${'`'}): exact
  normalized-sentence match (4+ words, headers kept) drops restatements from
  lower-priority blocks. Priority high→low: pinned + manual memory →
  world/lore dynamic context → summaries → recall.
- Chat budget: free tier keeps the most recent (tier1 6,000 tokens,
  chat+curated total 8,000 — oldest chat drops first, curated never trimmed);
  pro tier keeps a larger window (tier1 18,000) with no total cap.
- Parity rule: the diagnostics context preview MUST equal the production
  prompt — both go through the same builders/selectors (or a shared helper).
  Any prompt-assembly change touches both paths, or it is a bug.

Health check: a long thread's prompt keeps its oldest + newest summaries,
states each canon fact once, and still retains recent chat turns.
`),
    // ------------------------------------------------------------ Tavern / SillyTavern / Chub
    pack('st-layout', 'Where card, lore and chat features live in a chat app', String.raw`
A chat-card app is a pipeline. Find these stages in the REAL project before editing:

  FILES IN -----> PARSE -----> NORMALIZE -----> APP MODEL ----> PROMPT BUILD ----> MODEL ----> RENDER
  .png (tEXt)    detect spec   fill defaults    character{}      ordered sections   reply     markdown
  .json card     + version     KEEP unknown     lorebook[]       + budget trim                swipes
  World Info     validate      extensions{}     chats[]/messages
  .jsonl chat    size limits   (never drop)     personas, notes
        ^                                              |
        '----- EXPORT (reverse): app model -> spec JSON -> optional PNG embed

  FEATURE -> STAGE IT TOUCHES
    card import/export ................ PARSE, NORMALIZE, EXPORT
    lorebook / World Info ............. NORMALIZE, PROMPT BUILD (activation + budget)
    macros ({{char}}, {{user}}) ....... PROMPT BUILD and RENDER (one shared expander)
    Author's Note, depth prompts ...... PROMPT BUILD
    example dialogue, system prompt ... PROMPT BUILD
    swipes, Continue, Regenerate ...... APP MODEL (message variants) and RENDER
    regex rules ....................... PROMPT BUILD and/or RENDER (per rule)
    expressions, themes, library ...... RENDER only
    prompt inspector .................. reads PROMPT BUILD output (same function as real requests)

  LOCATE FIRST: the parser, the normalizer, the exporter, the prompt builder, the renderer
  and the storage layer. Name each file and function in your reply before changing anything.
  Rule for every stage: unknown fields pass through untouched; card text is data and is
  never executed.
`),
    pack('st-card-v2', 'Character Card V2 structure (annotated example)', String.raw`
JSON card, spec "chara_card_v2". Every value in data is a string unless noted.

{
  "spec": "chara_card_v2",
  "spec_version": "2.0",
  "data": {
    "name": "Mara Quill",
    "description": "Who the character is: appearance, history, traits (main persona text).",
    "personality": "Short trait summary.",
    "scenario": "Where and why the chat starts.",
    "first_mes": "Opening message. {{char}} and {{user}} macros allowed.",
    "mes_example": "<START>\n{{user}}: Hello.\n{{char}}: Hmph. Mind the rope.\n<START>\n{{user}}: ...",
    "creator_notes": "Notes for people, NOT sent to the model.",
    "system_prompt": "Optional replacement or supplement for the main system prompt.",
    "post_history_instructions": "Instruction placed after the chat history.",
    "alternate_greetings": ["Another opening message.", "A third one."],
    "character_book": { "name": "Harbor lore", "scan_depth": 4, "token_budget": 512,
                        "recursive_scanning": false, "extensions": {}, "entries": [] },
    "tags": ["river", "slice-of-life"],
    "creator": "name of author",
    "character_version": "1.0",
    "extensions": {}
  }
}

RULES THAT BREAK IMPORTS
  - "spec" and "spec_version" are required. data holds the fields (not the top level).
  - Missing fields are empty strings or empty arrays, never invented text.
  - Keep UNKNOWN keys inside extensions (and any other unknown keys) when round-tripping.
  - Legacy V1 cards have the same fields at the TOP level with no spec; accept and upgrade them.
  - Unicode must survive: read and write UTF-8, never Latin-1.
  - mes_example blocks are separated by <START>; each starts on its own line.

COMMON EXTENSIONS (keep, do not require): talkativeness, fav, world, depth_prompt
{ prompt, depth, role }.
`),
    pack('st-card-v3', 'Character Card V3 differences from V2', String.raw`
JSON card, spec "chara_card_v3", spec_version "3.0". Same data fields as V2 PLUS:

{
  "spec": "chara_card_v3",
  "spec_version": "3.0",
  "data": {
    "name": "...", "description": "...", "personality": "...", "scenario": "...",
    "first_mes": "...", "mes_example": "...", "creator_notes": "...",
    "system_prompt": "...", "post_history_instructions": "...",
    "alternate_greetings": [], "tags": [], "creator": "", "character_version": "",
    "extensions": {},
    "nickname": "Short name used for {{char}} when set",
    "group_only_greetings": ["Greetings used only in group chats"],
    "creator_notes_multilingual": { "en": "...", "ja": "..." },
    "source": ["https://example.com/original"],
    "creation_date": 1700000000,
    "modification_date": 1700000500,
    "assets": [
      { "type": "icon", "uri": "ccdefault:", "name": "main", "ext": "png" },
      { "type": "background", "uri": "embeded://assets/bg/0.png", "name": "bg", "ext": "png" }
    ],
    "character_book": { "entries": [] }
  }
}

  - V3 PNG cards use the tEXt keyword "ccv3"; V2 uses "chara". If both exist, prefer ccv3.
  - Asset uri forms: "ccdefault:" (use the default), "embeded://path" (inside a CHARX zip;
    note the spelling is the spec's own), http(s) URL, or a data: URI.
  - CHARX is a zip: card.json at the root plus the assets folder.
  - V3 lorebook entries add use_regex (bool) and position values "before_char" | "after_char".
  - Strategy: READ V3 and V2, WRITE the version the user chose, keep unknown fields, and say
    which V3-only fields (assets, nickname, group_only_greetings) have no home in the app.
  - These field lists summarize the public spec; verify against the linked V3 specification
    and a real V3 card before relying on a detail.
`),
    pack('st-card-png', 'PNG card layout (where the JSON hides)', String.raw`
  PNG FILE
   |- 8-byte signature ........ 89 50 4E 47 0D 0A 1A 0A      (reject anything else)
   |- IHDR chunk ............... image header
   |- ... other chunks ......... may include tEXt "chara" (V2) and/or tEXt "ccv3" (V3)
   |- IDAT chunk(s) ............ the pixels: NEVER recompress or redraw to add metadata
   '- IEND chunk

  CHUNK = [4-byte big-endian data length][4-byte type][data][4-byte CRC32 of type + data]

  tEXt data = keyword + 0x00 + text
              keyword "chara"  text = base64( UTF-8 bytes of the V2 JSON )
              keyword "ccv3"   text = base64( UTF-8 bytes of the V3 JSON )

  READ
    1 verify signature; walk chunks by length (stop at IEND; cap total size)
    2 collect tEXt chunks, split at the first 0x00, match keyword (ccv3 first, then chara)
    3 base64 decode -> UTF-8 decode -> JSON.parse inside try/catch -> validate spec

  WRITE
    1 walk the chunks of the ORIGINAL image; copy every chunk byte-for-byte
    2 drop any existing tEXt chunk with keyword chara or ccv3
    3 build the new tEXt chunk (correct length, CRC32 over type + data)
    4 insert it before IEND; leave IHDR and IDAT untouched
    5 if the image is not a PNG, convert it to PNG on a canvas ONCE and say so; never
      silently swap in a placeholder image

  VERIFY: re-read the file you wrote with the real importer and compare every field
  (including Unicode and long text); check the pixels still match the source image.
`),
    pack('st-lore', 'Lorebook shapes: card character_book and World Info JSON', String.raw`
A) EMBEDDED IN A CARD (V2/V3 character_book)
{
  "name": "Harbor lore", "description": "", "scan_depth": 4, "token_budget": 512,
  "recursive_scanning": false, "extensions": {},
  "entries": [
    { "id": 0, "name": "The Boiler", "comment": "memo for humans",
      "keys": ["boiler", "engine"], "secondary_keys": ["steam"], "selective": false,
      "content": "The Wren's boiler is new, patched and mortgaged.",
      "enabled": true, "constant": false, "case_sensitive": false,
      "insertion_order": 100, "priority": 10, "position": "before_char", "extensions": {} }
  ]
}

B) STANDALONE SILLYTAVERN WORLD INFO FILE (entries keyed by id; common fields)
{
  "entries": {
    "0": {
      "uid": 0, "key": ["boiler", "engine"], "keysecondary": ["steam"],
      "comment": "The Boiler", "content": "The Wren's boiler is new, patched and mortgaged.",
      "constant": false, "selective": true, "selectiveLogic": 0,
      "order": 100, "position": 0, "disable": false,
      "excludeRecursion": false, "preventRecursion": false, "delayUntilRecursion": false,
      "probability": 100, "useProbability": true, "depth": 4,
      "group": "", "groupOverride": false, "groupWeight": 100,
      "scanDepth": null, "caseSensitive": null, "matchWholeWords": null,
      "sticky": null, "cooldown": null, "delay": null, "displayIndex": 0
    }
  }
}

FIELD MAP (card book  <->  World Info file)
  keys ................ key                 | secondary_keys ... keysecondary
  content ............. content             | name / comment ... comment
  enabled ............. NOT disable         | constant ......... constant
  insertion_order ..... order               | priority ......... (no direct field; keep in extensions)
  selective ........... selective           | position ......... position (string vs number)
  case_sensitive ...... caseSensitive       | scan_depth ....... scanDepth (per entry in WI)
  World Info position numbers: 0 before char, 1 after char, 2 and 3 around the Author's
  Note, 4 at depth (uses depth and role). Treat numbers beyond this as unknown and keep them.
  selectiveLogic: 0 AND ANY, 1 NOT ALL, 2 NOT ANY, 3 AND ALL (verify with a real export).

Rules: inspect a real exported file first; convert keys between string and array carefully;
keep unknown fields; show a preview with warnings; merge, never overwrite silently.
`),
    pack('st-chatlog', 'Chat log JSONL structure', String.raw`
One JSON object per line. Line 1 is metadata; every later line is one message.

{"user_name":"You","character_name":"Mara Quill","create_date":"2026-10-05 @09h 30m 00s","chat_metadata":{}}
{"name":"Mara Quill","is_user":false,"is_system":false,"send_date":"2026-10-05 @09h 30m 05s","mes":"Mara is coiling rope when you reach the dock.","swipe_id":0,"swipes":["Mara is coiling rope when you reach the dock.","The boiler coughs twice."],"extra":{}}
{"name":"You","is_user":true,"is_system":false,"send_date":"2026-10-05 @09h 30m 40s","mes":"Can you get me to Harrow Bend?","extra":{}}

  mes ............ the active text; swipes[swipe_id] should equal mes
  swipe_id ....... index of the active variant; swipes is the list of all variants
  is_system ...... narrator/system lines (hidden from the model in some flows)
  extra .......... keep unknown keys; send_date formats vary, so preserve the original string
  Import: parse line by line (skip blank lines, report bad lines by number), validate before
  mutating, import into a NEW chat, never overwrite. Export: one object per line, UTF-8.
`),
    pack('st-prompt-order', 'Prompt assembly order with depth injection', String.raw`
Typical Tavern-style order (the project's own order wins; locate its prompt builder):

  [ system prompt ]                  main prompt, or the card's system_prompt if allowed
  [ world info: before character ]   entries with position "before"
  [ character description ]
  [ personality ]
  [ scenario ]
  [ world info: after character ]
  [ user persona description ]       position is configurable
  [ example dialogue ]               each <START> block, dropped FIRST when over budget
  [ chat history, oldest -> newest ]
        |-- Author's Note injected at depth N from the END (depth 0 = after the last message)
        |-- world info entries set to "at depth"
        '-- depth prompt from the card (extensions.depth_prompt: prompt, depth, role)
  [ post_history_instructions ]      last, strongest position

  BUDGET: when the context is full drop in this order: example dialogue, oldest history,
  low-priority lore. Never drop the system prompt or the newest user message.
  Show an approximate token count per section and label it an estimate.
  Anything that reaches the model must be visible in a preview the user can read.
`),
    pack('st-macros', 'Macro list and safe expansion rules', String.raw`
  ALWAYS     {{user}}  {{char}}  (legacy forms <USER> and <BOT>)
  COMMON     {{random:a,b,c}} one random item        {{pick:a,b,c}} stable per chat
             {{roll:1d20}} dice                      {{time}}  {{date}}  {{weekday}}
             {{newline}}  {{trim}}                   {{// comment}} removed from output
  RULES      expand once, no recursion; unknown macros stay UNCHANGED; never evaluate code;
             one shared expander used by display and prompt; implement only the macros the
             user lists. Names with braces or Unicode must expand verbatim.

  EXAMPLE    "{{char}} nods at {{user}}. {{random:Rain,Fog}} again."
          -> "Mara nods at Ben. Fog again."      "{{unknown_thing}}" stays "{{unknown_thing}}"
`),
    pack('st-dad-map', 'Tavern V2/V3 <-> Dad-native field mapping', String.raw`
IMPORT (Tavern -> Dad-native)             EXPORT (Dad-native -> Tavern, lossy)
  description -> systemPrompt               systemPrompt -> description
    (+ [Scenario] + [Examples] if absent)     bio description -> personality
  personality -> bio description            profile.scenario -> scenario
  scenario -> profile.scenario              firstMessage[0] -> first_mes
  first_mes + alternate_greetings           firstMessage[1...] -> alternate_greetings
     -> firstMessage[]                      custom pre-instruction -> system_prompt
  system_prompt -> custom pre-instruction   reminderMessage -> post_history_instructions
  post_history_instructions                 lorebook -> character_book
     -> reminderMessage
  character_book -> lorebook (keys,         DROPPED OR LOSSY ON EXPORT
     priority, scanDepth clamped to 20)       mes_example slot is always empty (the text
  extensions.forge -> persona, world            survives inside description)
     bible, kind                              lorebookRefs flattened; scanDepth > 20 clamped
  creator_notes -> bio if personality          empty personality becomes a creator-notes bio
     is empty
  NO DAD SLOT (dropped on import): selective, probability, group*, sticky, cooldown, delay,
  role, book-level scan_depth, non-forge extensions.*
`),
    // ------------------------------------------------------------------ Websites and cross-cutting edge cases
    pack('web-spec', 'Site Spec: the one model behind a generated website', String.raw`
ONE JSON object is the source of truth. AI stages fill parts of it, editable fields edit parts of it,
the preview and the export render only from it. Adapt names to the generator; keep it versioned.

{ "v": 1, "mode": "single" | "multi",
  "brief": { "idea": "", "audience": "", "goal": "", "tone": "", "language": "en", "inferred": ["tone"] },
  "brand": { "name": "", "tagline": "",
             "palette": { "bg": "#ffffff", "text": "#111111", "accent": "#0a6c5a", "muted": "#667085" },
             "fonts": { "heading": "serif-system", "body": "sans-system" } },
  "pages": [ { "id": "p1", "slug": "home", "title": "", "navLabel": "",
               "seo": { "title": "", "description": "" },
               "sections": [ { "id": "s1", "type": "hero", "fields": { "heading": "", "text": "", "cta": "" },
                               "image": { "prompt": "", "alt": "" }, "locked": [] } ] } ],
  "footer": { "text": "", "links": [] },
  "meta": { "stage": "done", "rev": 1, "updated": 0 } }

SECTION TYPES AND LIMITS (characters)
  hero     heading 80, text 220, cta 30         features items 3-6 {title 40, text 120}
  about    text 600                            services items {title, text}
  pricing  plans 1-4 {name, price, items[]}    ONLY prices the user wrote
  testimonials                                ONLY real quotes the user supplied
  faq      items 3-8 {q 100, a 300}            gallery items {alt, image}
  contact  heading, text, email (user supplied) cta heading, button     footer text, links
RULES  single mode = one page, nav items are #anchors.   multi mode = 2-7 pages, slugs unique
lowercase a-z 0-9 -, home first, every page in the nav once.   Unknown section types render as nothing and
are KEPT in the spec. Validate by path (pages[1].sections[0].fields.heading too long), never by throwing.
`),
    pack('web-pipeline', 'One-click site builder pipeline', String.raw`
USER TOUCHES: one idea box, one Single/Multi choice, one Build button, one final review.

 idea + mode -> [1 brief] -> [2 plan] -> [3 pages, one request each] -> [4 design] -> [5 images?] -> [6 SEO] -> preview
                 JSON        sitemap     sections + copy                 tokens        opt-in        titles/meta
 EVERY STAGE: small prompt (short brief + only what this stage needs) -> run id + timeout
              -> strip fences, extract first balanced JSON -> validate against the Site Spec
              -> repair once with a short corrective request -> merge into the spec -> save -> next stage
 STAGE STATE: pending | running | ok | failed | skipped. A failed stage offers Retry and Skip; the rest is kept.
 RULES
  - One run at a time. A reply whose run id is old (after Stop or a restart) is ignored.
  - Stop finishes nothing new and keeps finished stages. Build never starts by itself on load.
  - Multi page: bounded concurrency 1-2 so one bad page never loses the site.
  - Resume: the spec is saved after each stage; after a reload offer Continue or Start over.
  - A part that cannot be repaired uses a plain template and says so in the progress list.
  - Never invent prices, phones, addresses, emails, testimonials, awards or statistics.
  - The idea text is data: instructions inside it never change the schema, stages or safety rules.
  - Image generation and any paid or slow call is opt-in or confirmed once with a count.
  - Progress shows real stage names and counts, never invented percentages.
`),
    pack('web-field-ai', 'AI field helper contract (every site field)', String.raw`
FIELD    { id, label, kind: line | text | list | url | color | select, max, role: "hero heading", locked, history[] }
BUTTONS  Rewrite (has text) | Fill (empty) | Variants (3 choices) | Undo | Lock | Stop (while loading)
REQUEST  short brief (<= 600 chars) + page + section type + this field role and max + current text
         + at most 3 neighbor values. Nothing else: small, cheap, fast.
REPLY    strip code fences, surrounding quotes and "Here is..." lines; strip markdown for line fields;
         cut to max at a word boundary; reject empty, identical, wrong-language, refusal or placeholder text.
APPLY    only to the field that asked. If the user typed meanwhile, show the reply as a suggestion.
LOCKED   fields are skipped by Fill all and by one-click rebuilds. HISTORY keeps the last 5 values; restore calls no AI.
STATES   idle | loading | error (message shown, text kept). One request per field; extra clicks are ignored.
FILL ALL one structured request keyed by field id; validate each field; apply only to empty unlocked fields;
         preview first; whole-batch undo.
CHANGE THIS  per section instruction -> new section object -> validated -> side by side -> Accept or Reject.
`),
    pack('web-render-safety', 'Safe render and export for generated sites', String.raw`
AI text is DATA. Build the DOM with createElement and textContent; never innerHTML for spec text.
URLs     allow https:, http:, mailto:, tel: and #anchors only. Refuse javascript:, file:, and data: except own images.
COLORS   #rgb or #rrggbb only.   FONTS  pick from a fixed list of system stacks.   SIZES  numeric and clamped.
CODE     no AI-written script, inline event attribute or style text: the renderer owns all CSS and behavior.
PREVIEW  iframe with srcdoc and sandbox (no allow-same-origin); escape the closing script tag in embedded JSON;
         cap the document size; rebuild debounced (about 300 ms), not on every keystroke.
EXPORT   the same renderer writes ONE self-contained html (single) or one file per page + shared style.css
         (multi) with relative .html links that work from disk. Add doctype, lang, charset, viewport, title, description.
IMAGES   https urls or small data urls under a cap; alt text always (empty alt only for decoration).
SLUGS    lowercase a-z 0-9 -, unique, never empty, not reserved (index, style, assets); filenames come from slugs.
`),
    pack('web-edges', 'Edge cases checklist for AI-built sites', String.raw`
INPUT   empty idea, one word, 5,000+ characters, non-English, right-to-left, emoji, pasted HTML, hostile "ignore the
        rules" text, an idea naming a real brand or person (no implied endorsement), mode switched mid-run.
REPLY   not JSON, JSON in fences, truncated JSON, extra keys, missing sections, wrong types, over the limit,
        wrong language, lorem ipsum or [Company Name] filler, refusal, duplicate slugs.
RUN     double click, Stop mid-stage, tab closed or reloaded mid-run, offline, rate limit, a stage that never
        returns (timeout), two tabs building at once, a late reply after Stop (ignore by run id).
DATA    spec near the storage cap (images as urls, not base64), corrupt saved spec, older spec version (migrate
        additively), imported spec from someone else (validate, never trust).
OUTPUT  very long words, missing images, 1 page vs 12 pages, empty sections, long nav on a phone, dark mode, print,
        keyboard only, reduced motion, export opened from disk.
SANDBOX clipboard, downloads, popups and storage may each be blocked in the generator frame: offer a fallback
        (selectable text box, Weld Skybridge download or clipboard, memory-only mode with a visible warning).
`),
    pack('weld-limits', 'Perchance and Weld limits that bite', String.raw`
- The native helper input is believed to take roughly 6k tokens. A skill prompt plus your details must stay
  small; split big work into slices and finish one before starting the next.
- Weld caps generator writes at about 2 MB. Keep images and large JSON out of the lists and HTML panels.
- Weld storage values over 2 MB make Tampermonkey slow; Skybridge storage refuses them (reason value-over-2mb).
- A generator runs in a sandboxed frame: localStorage may be missing or partitioned; clipboard, downloads and
  window.open may be blocked. Wrap each use in try/catch and show a fallback.
- Perchance lists and HTML are not plain JavaScript: bracket and brace text can be templating. Confirm with the
  live preview and perchanceErrors before trusting an edit; many bracket patterns are harmless.
- Plugin calls are async and can be slow, fail or answer late: use a run id, a timeout and Stop; do not stack requests.
- Weld proposes edits and the user accepts a diff: never assume an edit was applied.
- Both panels, and every imported plugin generator, must be saved again after a change for it to take effect.
`),
    // ------------------------------------------------------------------ AI image prompts
    pack('img-anatomy', 'PROMPT ANATOMY and STRUCTURED PROMPT shape for image models', String.raw`
Image prompts that work well in public prompt collections share one order. Use it as a checklist, not a rule:

  1 SUBJECT    who or what, how many, age range, pose, expression, outfit, props
  2 IDENTITY   edits only: "keep the face exactly as in Image 1", repeated once more at the end
  3 SCENE      place, era, weather, time of day, background elements
  4 LIGHT      key, fill, rim; hard or soft; flash, golden hour, window; colour temperature
  5 CAMERA     lens (35mm wide, 85mm portrait, fisheye), aperture, angle, framing, depth of field
  6 STYLE      photoreal, flat vector, 3D isometric, clay, film grain, magazine cover
  7 TEXT       exact words in quotes, language, font feel, position, outline or shadow for contrast
  8 LAYOUT     aspect ratio, left and right split, margins, safe area, number of panels
  9 AVOID      a short list: warped face, extra limbs, watermark, blur, muted colours

Plain forms: one paragraph, or labelled sentences ("Crucial Fit Details: ...", "Text: ...").
Multi-step jobs use tags: <role>, <rules>, <step 1 - analyse>, <step 2 - shots>, <output format>.

STRUCTURED PROMPT (JSON) shape:
{
  "subject": { "description": "", "expression": "", "face": { "preserve_original": true } },
  "accessories": { },
  "photography": { "camera_style": "", "lighting": "", "angle": "", "shot_type": "", "texture": "" },
  "background": { "setting": "", "elements": [] },
  "negative_prompt": ""
}
Not every model reads JSON better than prose. Check what the plugin accepts, and keep a flattened text
fallback. Put each constraint in its own key or sentence and never leave empty keys in the sent version.
Honest limits: results vary per run, text inside images can be misspelled, and quality words such as 8K
do not guarantee quality. Ask the user to check text and facts in the output.
`),
    pack('img-templates', 'PROMPT LIBRARY CATEGORIES, template model and SLOT SYNTAX', String.raw`
PROMPT LIBRARY CATEGORIES (common grouping in public collections; a generator may use fewer):
  Photorealism and aesthetics | Creative experiments | Education and knowledge | E-commerce and virtual studio
  Workplace and productivity | Photo editing and restoration | Interior design | Social media and marketing
  Daily life and translation | Social networking and avatars

Template model (one JSON object per prompt; keep user-added items in a separate list from built-ins):
{
  "id": "stable-slug",
  "title": "", "description": "", "category": "", "tags": [],
  "prompt": "A quote card with the text '{quote|Stay curious}' by {author|Ada}",
  "slots": [ { "name": "quote", "label": "Quote", "default": "Stay curious" } ],
  "needsImages": 0, "aspect": "1:1", "language": "en",
  "credit": { "author": "", "url": "", "license": "" }
}

SLOT SYNTAX: {name|default} in the prompt text; the same name may appear twice and shares one value.
Other collections use [Bracket text] or {argument name="x" default="y"}; map those to slots on import
and keep the default. Escape a literal brace with a backslash. Unknown or empty slots fall back to the
default; a template with no slots is a plain prompt. Slot values are data: render as text, never HTML or code.
Credit: keep author, link and license (many collections use CC BY 4.0, which requires attribution).
`),
    pack('img-recipes', 'EDIT RECIPES and studio patterns for image models', String.raw`
Each recipe lists the inputs, the clause that matters, and the usual failure. Image N means the Nth uploaded picture.

  Outpaint     input 1 image + target ratio. "Expand to 16:9, extend scenery both sides, match lighting and texture,
               complete cut-off objects logically, do not alter the original centre."  Failure: seams, repeated objects.
  Remove       input 1 image + what to remove. "Remove X, rebuild the background plausibly, keep everything else
               identical."  Failure: smeared texture where the object was.
  Restore      old or damaged photo. "Repair scratches and fading, keep faces and composition, do not add detail that
               was not there; optionally colourize with natural tones."  Failure: faces changed, plastic skin.
  Try-on       Image 1 garment + Image 2 model. "Wear the garment, natural drape and folds, keep fabric, colour and
               logos exactly, match lighting and shadows."  Failure: wrong fit, altered logos.
  Translate    image with text + language. "Replace all visible text with <language>, keep layout and style."
               Failure: misspelled or missing words; always check.
  Sketch to UI hand sketch. "Turn into a clean high-fidelity screen, keep layout, use real-looking labels."
  Infographic  topic + elements + style + label language. Name every element and arrow; say "labels in <language>".
  Cover        subject + exact headline in quotes + layout side + contrast treatment + format ratio.
  Product      product image + scene + light. "Keep product shape, colour and logo; new background only."
  Avatar set   one style block + a short line per pose, so the set stays consistent.
  Keyframes    describe only what is visible, list anchors that must stay constant, then write one prompt per shot.
  Miniature    "<place> as an isometric / tilt-shift miniature diorama, clay or plastic, soft studio light, clean background".

Always send a Preserve clause (what must not change) with edits, keep the original file untouched, and let
the user review the prompt first. Plugins differ in how they take input images: check the source.
`),
    pack('img-consent', 'LIKENESS AND CONSENT rules for generated images', String.raw`
- Use a real person photo only if the user states they have the right to use it. Ask once per session, not on every click.
- Do not generate named real people in sexual, deceptive, hateful, political or defamatory scenes, or as fake
  endorsements. Be careful with public figures and never present generated images as real photographs or news.
- Treat subjects who may be minors with extra care: no sexualised or identity-changing edits.
- Keep reference images on the user device; do not log, upload or store them beyond the action the user took.
- Label AI output where it could be mistaken for a photo (caption, filename or metadata) and let the user edit the label.
- Respect licences: keep credit for imported prompts; do not bundle third-party images or prompts without permission.
- A filter is never complete: say so, and keep the user in control of every send.
`)
  ];

  // Concrete worked examples shown to the AI helper (preset id -> text). Adapt, do not copy values.
  const examples = {
    'card-spec-export': String.raw`
Request: "Export Mara Quill as a V2 card PNG."
Good result: the app has {name:'Mara Quill', persona:'...', greeting:'...', altGreetings:['...']}.
The exporter builds {spec:'chara_card_v2', spec_version:'2.0', data:{name:'Mara Quill',
description:<persona>, first_mes:<greeting>, alternate_greetings:[...], personality:'',
mes_example:'', character_book:null-or-book, extensions:<kept unknown fields>}}, base64-encodes
the UTF-8 JSON into a tEXt chunk "chara" inserted before IEND, and re-reads the finished PNG
with the importer to confirm every field matches. Empty fields stay '' (never invented).
Bad result: redrawing the image on a canvas (changes pixels), dropping extensions, or
writing description text into personality "to fill the gap".`,
    'card-spec-import': String.raw`
Request: "Import this PNG card."
Good result: signature ok -> tEXt chunks found: ccv3 AND chara -> prefer ccv3 -> base64 -> UTF-8
-> JSON ok -> spec 'chara_card_v3' -> preview "Mara Quill: 2 alternate greetings, 14 lore
entries, warning: 3 assets not used" -> user confirms -> saved as a NEW character, unknown
extensions kept in a retained blob.
Bad result: executing HTML in description, overwriting an existing "Mara Quill" silently, or
failing the whole import because one lore entry has an unknown field.`,
    'card-batch-import': String.raw`
Request: "Import these 40 cards I dropped in."
Good result: queue of 40 -> each parsed on its own (PNG ccv3 preferred over chara, JSON V2/V3)
-> preview list: 36 ok, 2 "duplicate of Mara Quill (same name and content hash)", 1 "not a
card: no chara/ccv3 chunk", 1 "JSON parse error at byte 812" -> user unticks the duplicates
-> one confirm -> per-card result list, unknown extensions kept on every imported card.
Bad result: stopping at file 7 because it is corrupt, importing duplicates silently, or
merging two different characters that only share a name.`,
    'card-field-map': String.raw`
Good result is a table like:
  app field        | card field            | status  | note
  persona          | description           | exact   |
  greeting         | first_mes             | exact   |
  greetings[1..]   | alternate_greetings   | exact   |
  authorNote       | extensions.depth_prompt | lossy | role and depth must be added
  mood sprites     | (none in V2)          | missing | V3 assets could carry them
Every row is based on code you read (cite the function) or a sample card; unverified rows are
labeled "unverified".`,
    'card-validator': String.raw`
Good finding: "[warn] first_mes is empty -> the chat opens with no greeting. Fix: write a
greeting or set alternate_greetings[0]." "[warn] lore 'Settlements' has key 'town' which is
also a key in 'Saloon' -> both fire together; keep 'town' in one." "[error] description
contains <script>: strip on display, keep as data."
Bad finding: "Description could be better." (no field, no fix).`,
    'token-diet': String.raw`
Before (31 words): "Mara is a ferry pilot. She is a ferry pilot who works on the river. She
always speaks bluntly and never wastes words, because she does not like to waste words."
After (15 words): "Ferry pilot on the Sable River. Blunt; hates wasted words." Saved about 16
words. Every fact survived (job, place, voice). Mark guesses as "check with author".`,
    'card-creator-editor': String.raw`
Good result: one form with a labeled input for each V2 field (name, description, personality,
scenario, first message, example messages, system prompt, post-history, alternate greetings,
creator notes, tags, creator, version, lorebook), an approximate token count under each long
field, a live preview of the assembled prompt section, autosave of drafts, and Export/Import
buttons that call the existing card code. Existing saved characters open unchanged.`,
    'alt-greetings-swipes': String.raw`
Stored message: {id:'m7', role:'ai', variants:['Mara nods.','Mara shrugs.'], active:1}.
The visible text is variants[active]; the model receives ONLY the active variant. Regenerate
appends a variant (never deletes). Arrow buttons change active. Old messages without
variants load as variants:[text], active:0.`,
    'macros-support': String.raw`
Test box: input "{{char}} greets {{user}}. {{random:red,blue}} sky. {{nope}}" with
char=Mara, user=Ben shows "Mara greets Ben. blue sky. {{nope}}" (unknown macro unchanged,
no recursion, no code evaluated). The same expander is used for display and for the prompt.`,
    'example-dialogue': String.raw`
mes_example text "<START>\n{{user}}: Hi.\n{{char}}: Mind the rope.\n<START>\n{{user}}: Bye.\n{{char}}: Hmph."
parses into 2 blocks of 2 lines each. Under budget pressure the blocks are dropped before any
history is trimmed. A per-character switch disables them. Export writes them back unchanged.`,
    'author-note-depth': String.raw`
History = 10 messages, note depth 2, role system: the note is inserted before the last 2
messages (position 8 of 10). Depth 0 = after the final message. Depth 50 with 10 messages
goes at the very top of history. Repeat interval 3 = inserted on every 3rd turn. The preview
shows the exact landing position and the note never appears in the visible transcript.`,
    'system-post-history': String.raw`
Card has system_prompt "Stay in first person." and post_history_instructions "Keep replies
under 120 words." With "use card instructions" ON both are sent, system prompt first and the
post-history text after the last message, and the inspector shows both with their positions.
With the switch OFF neither is sent. A card with neither field changes nothing.`,
    'prompt-inspector': String.raw`
Good output (read-only, built from the same function as the real request):
  SYSTEM ............ ~120 tokens (est.)
  CHARACTER ......... ~410 tokens (est.)
  LORE .............. ~300 tokens (est.)  triggered: "The Boiler" (key: boiler), "Ferries" (key: dock)
  HISTORY ........... ~2,100 tokens (est.)  truncated: oldest 6 messages
  NOTES ............. ~40 tokens (est.)
Keys and tokens never appear in it.`,
    'continue-impersonate': String.raw`
Continue: last AI message "Mara looks at the river" becomes "Mara looks at the river and
sighs." in the SAME message (no new bubble). Regenerate: replaces or adds a variant of the
last reply. Impersonate: puts a drafted user message in the input box for review; nothing is
sent automatically. One request at a time; Stop keeps what has arrived.`,
    'message-actions': String.raw`
Message 4 of 9 is edited: its text changes in place, its id stays 'm4', any summary built from
messages 1-6 is marked stale, and the change is saved in the old format plus an edited flag.
Hide-from-model keeps the message visible but skips it in the prompt. Delete asks first.`,
    'personas': String.raw`
Personas: [{id:'p1', name:'Ben', description:'A tired courier.', avatar:''}]. {{user}} becomes
"Ben" and the description is inserted at the chosen prompt position. Deleting a persona that
chats still use falls those chats back to the previous user name instead of breaking them.`,
    'quick-replies': String.raw`
Set "River": [{label:'Pay', text:'*hands over coins*'}, {label:'Ask about the storm', text:'What do you know about the storm?'}].
Clicking inserts the text into the input (or sends it when "send immediately" is on).
Sets can be global or per character, are reorderable and are saved in the existing format.`,
    'regex-scripts': String.raw`
Rule: find "\*(.+?)\*" replace "<em>$1</em>", applies to: display only, enabled. The stored
message keeps its asterisks; only the rendered text changes. A rule with an invalid pattern
shows "Invalid pattern" in the test box and is skipped, never thrown. Rule count and input
length are capped.`,
    'expressions': String.raw`
Character "Mara" has images: neutral (default), angry, happy. A reply containing "grins" maps
to "happy" by the editable keyword table; a missing image falls back to neutral. The lookup
never blocks sending and a toggle turns it off.`,
    'rolling-summary': String.raw`
Chat reaches 40 messages with a threshold of 30: messages 1-20 are replaced in the PROMPT by
the summary "Ben boarded the ferry at dusk..." (shown and editable). Messages 1-20 stay in the
transcript. Lock stops auto-refresh; Regenerate rebuilds it; a failed request keeps the old one.`,
    'chat-log-import-export': String.raw`
Export writes the metadata line then one message per line (see the structure reference). A
message with 3 swipes exports swipes:[a,b,c] and swipe_id:1. Import into a NEW chat, report
"line 14: invalid JSON, skipped", and keep unknown extra keys.`,
    'group-chat': String.raw`
Members: Mara (talkativeness 0.8), Doc (0.3), muted: Ox. After a user message the engine picks
one speaker (mention by name first, else weighted draw excluding muted and the last speaker).
Each member's card and lore are separate prompt sections; nobody speaks for the user.`,
    'sampler-presets': String.raw`
Plugin accepts only {maxTokens, temperature}: presets "Short" {maxTokens:150, temperature:0.7}
and "Wild" {maxTokens:400, temperature:1.1}. Controls the plugin does not support (e.g.
repetition penalty) are not shown, and the UI says so.`,
    'instruct-formats': String.raw`
Plain: "Mara: Hello." ChatML-style: "<|im_start|>assistant\nHello.<|im_end|>". Custom template:
prefix "### Response:\n", suffix "\n". One formatter function serves every request, the default
stays identical to today's output, and a preview shows the formatted text.`,
    'world-info-advanced': String.raw`
Entry {keys:['boiler'], secondary_keys:['steam'], selective:true, probability:100,
constant:false, position:'before_char', order:100} fires only when "boiler" AND "steam" both
appear in the scan window. Old entries with only keys and content keep working with defaults.
When over budget, drop low-order entries first and list what was dropped.`,
    'world-info-timed': String.raw`
sticky 3: entry stays active for 3 messages after it triggers. cooldown 5: cannot retrigger
for 5 messages after firing. delay 4: not active until the chat has 4 messages. Counters are
stored per chat and reset safely on delete, edit and branch. Entries without timing behave as before.`,
    'lore-editor-ui': String.raw`
Test box: paste "We tied up at the dock near the boiler house." and it lists "The Boiler"
(keys: boiler) and "Ferries" (keys: dock) as triggered, with the matching key highlighted.
Duplicate keys across entries show a warning; an entry over about 200 words shows a size warning.`,
    'lore-import-export': String.raw`
World Info file entry {uid:0, key:['boiler'], keysecondary:[], content:'...', comment:'The Boiler',
disable:false, order:100} imports as {id:'0', keys:['boiler'], name:'The Boiler', enabled:true,
insertion_order:100}. Export reverses it. Unknown fields are retained, a preview lists
warnings, and import MERGES into the chosen lorebook.`,
    'card-library-page': String.raw`
Grid card: avatar, "Mara Quill", tagline (first sentence of description), tags "river,
slice-of-life". Detail page: sanitized creator notes, greetings, linked lorebooks, buttons
Chat, Edit, Export, Delete (confirms). Everything comes from characters stored on this device.`,
    'card-metadata-tags': String.raw`
Tags input "River, river , Slice-of-life" normalizes to ["river","slice-of-life"] (trim,
case-insensitive duplicates removed, count and length capped). creator, character_version and
creator_notes are written into exported cards and read back; older characters load without them.`,
    'lorebook-attach': String.raw`
Character "Mara" has an embedded book (5 entries) plus attached standalone book "Sable River"
(12 entries, enabled). The active list shows 17 entries; an entry id present in both is injected
once (first source wins). Detaching "Sable River" removes its 12 without deleting the book.`,
    'chat-appearance': String.raw`
Options: bubble or flat style, per-character accent color, background image with a contrast
overlay, font size, compact mode. Every combination keeps text readable in light and dark, and
the default look is unchanged until the user opts in.`,
    'lorebook-builder': String.raw`
Source: "Mara's ferry, the boiler she owes the bank for, the storm season." Output (3 entries):
{name:'The Boiler', keys:['boiler','engine','steam'], content:'The Wren's boiler is new, patched
and mortgaged.'} {name:'Storm Season', keys:['storm','channel','flood'], ...}
{name:'The Bank', keys:['bank','debt','loan'], ...}. Facts from the source are tagged
"established"; anything new is tagged "proposed".`,
    'lore-activation-audit': String.raw`
Fixture: scan window "We reached the dock." Entries: "Ferries" keys [dock, ferry] fires; "The
Boiler" keys [boiler] does not; "Docks of Old" keys [dock] also fires (overlap with Ferries).
Report: which entries reached the prompt, why, and the overlap to fix. Unsupported settings are
labeled "not honored by this app" rather than "broken".`,
    'character-export-fix': String.raw`
Check list: file starts with 89 50 4E 47 0D 0A 1A 0A; one tEXt chunk with keyword "chara"; its
CRC matches; base64 decodes to UTF-8 JSON with spec 'chara_card_v2'; the image still shows the
original portrait; importing the exported file reproduces name, greetings and lore exactly.`,
    'character-interop': String.raw`
Matrix of formats (V1, V2 JSON, V2 PNG, V3 JSON, V3 PNG, CHARX, World Info) against
operations (import, export): "exact", "lossy (fields dropped: ...)" or "unsupported", each
backed by a real fixture you ran or labeled "not tested".`,
    'dad-orient': String.raw`
Good report: "index.html loads 24 scripts; order matches the diagram except theme-customizer.js
is loaded after i18n.js (diagram lists it before). app.js is 2.31 MB. window.WS exists after
forge-studio.js. MISSING vs documentation: scene-cast.js not found (searched src/ and index.html)."
Every statement names a file and how you confirmed it.`,
    'dad-diagnose': String.raw`
Symptom: "Lore entry 'Ferries' never appears in the prompt."
Trace: handleSend -> MemoryEngine.buildHistory -> lore ranking. Check: entry enabled? keys
lowercase? scanDepth null (window of 4)? Is the link in lorebookRefs enabled? Is the 6,656
char budget cut it (budget_cut)? Evidence: run the diagnostics viewer and read the
[WORLD/LORE DATABASE] block. Root cause: "keys ['ferry'] vs message 'ferries' - typo tolerance
too low for plurals" with the function name and line. No code changed.`,
    'dad-fix': String.raw`
Confirmed defect: "Alternate greeting 2 is ignored." Cause: firstMessage[1] is read as a string
instead of an array item in the greeting picker. Fix: change the read to firstMessage[idx]; touch
only that function; keep window.* names; verify by creating a chat with greeting 2 and checking
the first node text. Report: file, function, before/after lines, what you ran.`,
    'dad-add-feature': String.raw`
Request: "Add a Pin message button."
Plan: (1) where: render path createNodeDOM in app.js (action bar) + a pin flag on the node (tree
node field, additive); (2) data: node.pinned = true, included by the existing pinned-context
builder; (3) UI: button in the action bar, CSS in styling.css; (4) persistence: _persistThreads
already saves nodes; (5) checks: pin, unpin, reload, branch switch, export. Old threads (no
pinned field) behave as before.`,
    'dad-improve-feature': String.raw`
Request: "Make the author's note better."
Observe first: note layers (config -> char -> thread), where injected (late-prompt), current
limits. Improve in small steps: show the layer that won, add a character counter, warn when
the note repeats the reminderMessage. Keep the thread.authorNote storage key and old values.`,
    'dad-new-module': String.raw`
New file src/pet-names.js. Steps: create the module exposing window.PetNames; add one script
tag in index.html AFTER app.js if it needs app globals (before it if app.js should call it);
no new Perchance import unless needed (then main.pjs + pjs-globals.js bridge); add CSS to
styling.css; feature-detect window.PetNames wherever it is called so a missing file cannot break
the app.`,
    'dad-prompt-audit': String.raw`
Good report lists each block with: source function, FIXED or DYNAMIC, approximate chars, and
whether the diagnostics viewer shows it. Example finding: "persona repeats the pre-instruction
rule 'never act for {{user}}' (about 90 chars/turn). Preview and real prompt use the same
builder: yes (buildDiagnosticHistory)." Findings are ranked by chars saved per turn.`,
    'dad-prompt-tune': String.raw`
Request: "Replies repeat the same opening."
Fix candidates ordered by cost: (1) one reminderMessage line "Vary your openings." (cost: ~40
chars/turn); (2) a prose-director setting if present; (3) example dialogue diversity. Show the
exact text and where it is injected; do not duplicate the existing pre-instruction.`,
    'dad-provider-add': String.raw`
Add provider "Acme Local" in providers.js inside the right group of window.Dad_PROVIDER_GROUPS:
fields copied from a neighbor entry (id, label, base URL, model list, key handling through
secret-vendor, capabilities). The key is read from the user's settings, never hardcoded. Verify
the provider shows in the model picker and that a failed call shows an actionable error.`,
    'dad-ui-polish': String.raw`
Request: "Make the chat bubbles easier to read on phones."
Edit styling.css only: font size, line height, max-width in rem; check the inline first-paint
copy in index.html is untouched or updated to match. Test 360px, 768px and desktop widths, light
and dark themes (theme-customizer variables), long messages and code blocks.`,
    'dad-perf-size': String.raw`
Good report: "Fixed chars per turn for Henry Tucker: about 25k. Top three savings: system
instruction block (~5.5k), towns entry (~3.6k), duplicate frontier entries (~3k). app.js loads
2.4 MB before first render: candidates to lazy-load: pdf.js (already lazy), d3 (already lazy)."
Measured values are labeled measured; guesses are labeled estimate.`,
    'dad-persistence-audit': String.raw`
Table: key / store / shape / written by / read by / migration risk. Example row: "chatApp |
kv | slots+index | _persistThreads | boot | adding a field is safe, renaming breaks old slots".
Cloud Backup mirrors the last 200 messages only; say what a restore would lose.`,
    'dad-hub-work': String.raw`
Request: "Show download counts on cards."
hubDownloaded already records downloads. Add the count to the metadata the server returns from
hubSearch (server block in index.html), render it in the card tile, and leave owner keys out of
every response. Verify with a card that has 0 and one that has 12 downloads.`,
    'dad-safety-review': String.raw`
Source -> sink report: "card.description -> createNodeDOM -> marked + DOMPurify -> innerHTML:
sanitized (ok)". "character name -> toast text via innerHTML: NOT escaped -> use escHtml".
"image prompt from lore text -> root.image without pjsLiteral: template injection -> wrap".`,
    'dad-import-export': String.raw`
Rules in practice: default export = dad-char JSON/PNG (lossless). Tavern V2/CCV2/Forge shapes
are labeled "lossy share copy" in the dialog. Imports accept dad-char, dad-world, standalone
lorebook and Tavern shapes, show a preview, and never overwrite silently. Exported files carry no
lorebookArchive, lastLoreRun, useCount or lastInjectedAt.`,
    'dad-release-check': String.raw`
Checklist with results: load page ok; send a message ok; open and close each modal touched ok;
import a dad-char file ok; console errors 0; perchanceErrors empty; not run: hub upload (no
test account). Items you could not run are listed as not run.`,
    'dad-character-create': String.raw`
Brief: "A gruff river ferry pilot, protective of her father's ferry." Reply: one fenced JSON block
shaped like the dad-char example (envelope type dad-char, version 2) with a fresh id, a 1-3
sentence description, a persona in systemPrompt that does NOT repeat the pre-instruction, 2-3
greetings, 3-5 short example exchanges, preInstruction "dad_roleplay", and a lorebook of at most
a few real-named entries. No avatar. Then a short note listing choices to review.`,
    'dad-character-improve': String.raw`
Input description (too long): "Mara is a ferry pilot who is blunt and ... [900 chars of persona]".
Output: bio "Dry-witted ferry pilot who knows every sandbar on the Sable River." moves to
description; the 900 chars stay in systemPrompt (trimmed of pre-instruction duplicates). Show
BEFORE / AFTER per field with the reason and the characters saved.`,
    'dad-lore-build': String.raw`
Source: "The Wren is a ferry. Its boiler is new but mortgaged. Storm season closes the channel."
Entry 1: name "The Boiler", keys [boiler, engine, steam], priority 10, content "The Wren's boiler
is new, patched and mortgaged. {{char}} talks to it like a stubborn mule." (about 20 words).
Entry 2: name "Storm Season", keys [storm, channel, flood], content "From late autumn the channel
floods and ferries stop. Prices double before the first storm."
Returned as a standalone lorebook envelope (version "2.0") in one fenced JSON block.`,
    'dad-lore-audit': String.raw`
Good findings: "[warn] key 'nevada' appears in 3 entries: Settlements, Frontier, Weather -> keep it
in Frontier only." "[warn] 'Entry 3' has no real name -> 'Stagecoach'." "[error] scanDepth 50 in
'Weather' -> null." "[info] 3 constant entries; keep at most 2." Each finding names the entry
and the fix; nothing is rewritten unless asked.`,
    'dad-world-build': String.raw`
Brief: "A dry river frontier where ferries replace roads." Output: one dad-world file (type
dad-world, version 1). description = what EVERY character knows (4-6 sentences, no secrets);
entries = Ferries, The Bank, Storm Season, Rumors, each with 3-6 unique keys and about 40 words.
No overlap of keys across entries, scanDepth null, at most 2 constant entries.`,
    'dad-token-diet': String.raw`
Report per field: characters before -> after, what was removed and why ("duplicates
pre-instruction", "same fact in 3 places", "stage-direction filler"). Greetings and example
exchanges stay verbatim. Total fixed chars per turn before and after. Mark any cut you are
unsure about as "author to confirm".`,
    'dad-convert-tavern': String.raw`
Input V2 card: {data:{name:'Mara', description:'(persona text)', personality:'Blunt.', first_mes:'Hi.', alternate_greetings:['Yo.'], mes_example:'<START>...', character_book:{entries:[{keys:['boiler'], content:'...'}]}}}.
Output dad-char: systemPrompt = persona + "[Examples]" + mes_example if no exampleDialogue pairs can be
made; description = 'Blunt.'; firstMessage = ['Hi.', 'Yo.']; lorebook entries get real names,
3-6 keys, priority 10, scanDepth null. Then list what was DROPPED (selective, probability,
sticky...) with the entry names.`,
    'dad-greetings-examples': String.raw`
Greeting hooks (each a different situation, 2-4 sentences, ends with something {{user}} can
answer): 1 "Mara is coiling rope when you reach the dock..." 2 "The boiler coughs twice..." 3 "A
stranger's note is pinned to the ferry bell..." Example dialogue: 4 pairs, each under 40 words,
all in her voice, none narrating {{user}}'s actions.`,
    'dad-file-validate': String.raw`
Input: a dad-char file whose description holds three paragraphs of persona, with a lore entry
using scanDepth 50 and key "Boiler". Findings: "[error] data.description is persona -> systemPrompt,
bio becomes 1-2 sentences." "[error] lore_1.scanDepth 50 -> null." "[warn] key 'Boiler' -> 'boiler'."
"[info] detectType: dad-char." Then the corrected file in one fenced block; fine fields stay untouched.`,
    'dad-file-chat': String.raw`
Input: five pasted turns between Jeff and Morgana. Output: one dad-char-chat file whose thread has a
system-root node n_root, then n_u1 -> n_a1 -> n_u2 -> n_a2 -> n_u3, every parentId and nextId set, the
last nextId null, rootId "n_root", speaker names exactly as pasted. Report "5 turns converted, 0
dropped". For a transcript request: "Jeff:" line, the text, a blank line, "Morgana Vex:" and so on.`,
    'dad-file-backup': String.raw`
Request: "back up my two characters and one chat". Output: one dad-full file with config.characterBook
holding both characters (folder and favorite kept), threads holding the chat, currentThreadId set to it.
Checklist: rootId exists, characterId resolves, worldBook present. Warning shown first: "Importing this
file replaces everything in the app."`,
    'dad-file-convert': String.raw`
Input: SillyTavern World Info { entries: { "0": { key: ["boiler","steam"], comment: "Boiler", content: "...", order: 10, disable: false } } }.
Output: a Dad-native lorebook (version "2.0") entry { name "Boiler", keys ["boiler","steam"], priority 10,
enabled true, scanDepth null }. Dropped: selectiveLogic, probability, group, sticky, cooldown, delay
(listed with the entry names).`,
    'dad-weld-wire': String.raw`
Request: "let the greeting generator use my own model". Gate on sb.has('ai'); call sb.ai(prompt, { system,
maxTokens: 200, temperature: 0.7 }) with the request fields shown in the reference; branch on ok; on
{ ok: false, reason } show the reason and fall back to the existing provider path. No key leaves the
page, and with no companion the feature behaves exactly as before.`,
    'dad-vault-bridge': String.raw`
Request: "keep a backup copy of this generator in the companion". Write one record under
weld:genvault:<tag>/snapshot (a bundle or modelText shape, with generator and folder set to YOUR tag),
announce it on dad:genvault with { v: 1, type: "vault-updated", generator, at, from }, check ok on every
call, and on { ok: false, reason: "denied by the user" } fall back to kv, then memory. Never copy another
generator's key or rewrite its generator field; secret-shaped config values are stored as [redacted].`,
    'dad-session-slots': String.raw`
Request: "add named restore points". Keep an index object save_slots (id -> { name, takenAt, threadCount,
charCount, currentTitle }) and one record per slot at saveslot:<id> with { version: 1, name, takenAt,
data: { threads, currentThreadId, config } }, max 8 slots, confirm before replacing or restoring, and
offer a dad-full download before deleting. Slots stay in local kv; they never touch weld:genvault keys.`,
    'dad-world-state': String.raw`
Request: "show what has changed in the world". Read config.worldBook.worlds[id].state if it exists, and
render only facts with active true as one sentence each under [WORLD STATE - what has changed], after the
description and before ranked entries. A world with state { updatedAt, facts: [{ id: "f1", text: "Mara left
town.", active: true }] } shows that line; a legacy world with no state key renders exactly as before and
is never given one. When saving a dad-full file, write worldBook back untouched so state survives.`,
    'dad-curated-density': String.raw`
Request: "why was my oldest summary dropped". Trace the layers in order: fixed context, then curated blocks
(world block, character lore, summaries, recalled memories, pins, ledger) each under its own cap, then recent
chat. Only recent chat may yield. Check that summaries keep the oldest foundation and the newest, that a
restated sentence appears once, that the model window comes from getMetaObject and not a constant, and that
the diagnostics preview calls the same builders as the real prompt.`,
    'site-one-click-builder': String.raw`
Request: "Add a one-click website builder to my bakery generator."
Good result: a new Builder page with ONE textarea ("Describe your site"), a Single/Multi radio, a Build button.
Build runs stage 1 (brief JSON) -> 2 (plan: home, menu, about, contact) -> 3 (one request per page) -> 4 (tokens)
-> 6 (SEO). A progress list shows "Brief ok, Plan ok, Page 2 of 4 running"; Stop and Retry work. Each result
sits in a field with Rewrite / Fill. The contact page leaves phone and address EMPTY because the idea gave none.
Preview shows the site; Export downloads index.html + menu.html + style.css. Nothing says "published".
Bad result: one giant request that returns the whole site, invented opening hours and 5-star reviews, a build
that starts on page load, or a Stop button that lets the old run overwrite the new one.`,
    'site-ai-fields': String.raw`
Request: "Put AI help in every field on the page."
Good result: next to "Hero heading" (has text) a Rewrite button; next to empty "Meta description" a Fill button.
Fill sends: brief (400 chars), page "home", section "seo", role "meta description", max 155, neighbors (title,
hero heading). Reply '"Fresh sourdough baked daily in Ames."' becomes: Fresh sourdough baked daily in Ames.
(quotes stripped, 155 max). The old value goes to history; Undo restores it with no AI call. Locked fields skipped.
Bad result: sending the whole page for every field, replacing text the user typed during loading.`,
    'site-pipeline-resilience': String.raw`
Request: "Sometimes the build breaks halfway."
Good result: reply 'Sure! json {"pages":[{"slug":"home"' (truncated) -> extraction fails -> ONE short repair request
with the broken text -> still invalid -> that page uses the plain template, progress says "Page 1: used default
layout (AI reply was cut off)"; pages 2-4 still build. Reload offers Continue from stage 3.
Bad result: throwing away finished stages, retrying forever, or applying a reply from a stopped run.`,
    'ai-json-contract': String.raw`
Request: "The model sometimes wraps JSON in text."
Good result: parseAiJson(text) strips fences, finds the first balanced {...}, JSON.parse in try/catch, then
validates {title:string<=80, items:array 3-6}. Invalid -> one corrective request -> else a clear message and the
user's current values untouched. The reply is never used as HTML.
Bad result: JSON.parse(reply) with no catch, or eval/innerHTML on the reply.`
  };

  // Which packs each preset receives (preset id -> pack ids, in display order).
  const links = {
    'card-spec-export': ['st-layout', 'st-card-v2', 'st-card-png', 'st-card-v3'],
    'card-spec-import': ['st-layout', 'st-card-v2', 'st-card-v3', 'st-card-png'],
    'card-batch-import': ['st-card-v2', 'st-card-v3', 'st-card-png'],
    'card-field-map': ['st-card-v2', 'st-card-v3', 'st-lore'],
    'card-validator': ['st-card-v2', 'st-lore'],
    'token-diet': ['st-prompt-order', 'st-card-v2'],
    'card-creator-editor': ['st-layout', 'st-card-v2'],
    'alt-greetings-swipes': ['st-card-v2', 'st-chatlog'],
    'macros-support': ['st-macros'],
    'example-dialogue': ['st-card-v2', 'st-prompt-order', 'st-macros'],
    'author-note-depth': ['st-prompt-order'],
    'system-post-history': ['st-prompt-order', 'st-card-v2'],
    'prompt-inspector': ['st-prompt-order', 'st-layout'],
    'continue-impersonate': ['st-prompt-order', 'st-chatlog'],
    'message-actions': ['st-chatlog'],
    'personas': ['st-prompt-order', 'st-macros'],
    'quick-replies': ['st-layout'],
    'regex-scripts': ['st-layout'],
    'expressions': ['st-layout', 'st-card-v3'],
    'img-prompt-library': ['img-templates', 'img-anatomy'],
    'img-prompt-slots': ['img-templates'],
    'img-json-prompt-builder': ['img-anatomy'],
    'img-photo-composer': ['img-anatomy'],
    'img-reference-edit': ['img-recipes', 'img-consent'],
    'img-edit-recipes': ['img-recipes'],
    'img-infographic-studio': ['img-recipes', 'img-anatomy'],
    'img-cover-poster-studio': ['img-recipes', 'img-anatomy'],
    'img-product-studio': ['img-recipes', 'img-consent'],
    'img-avatar-pack': ['img-recipes', 'img-consent'],
    'img-storyboard-keyframes': ['img-recipes', 'img-anatomy'],
    'img-diorama-presets': ['img-recipes'],
    'img-prompt-lint': ['img-anatomy'],
    'img-negative-prompts': ['img-anatomy'],
    'img-seed-lock': ['img-anatomy'],
    'img-ab-variations': ['img-anatomy'],
    'img-aspect-presets': ['img-recipes'],
    'img-import-credit': ['img-templates', 'img-consent'],
    'img-likeness-guard': ['img-consent'],
    'rolling-summary': ['st-prompt-order'],
    'chat-log-import-export': ['st-chatlog', 'st-layout'],
    'group-chat': ['st-prompt-order', 'st-chatlog'],
    'sampler-presets': ['st-layout'],
    'instruct-formats': ['st-prompt-order'],
    'world-info-advanced': ['st-lore', 'st-prompt-order'],
    'world-info-timed': ['st-lore'],
    'lore-editor-ui': ['st-lore', 'st-layout'],
    'lore-import-export': ['st-lore'],
    'card-library-page': ['st-card-v2', 'st-layout'],
    'card-metadata-tags': ['st-card-v2', 'st-card-v3'],
    'lorebook-attach': ['st-lore', 'st-layout'],
    'chat-appearance': ['st-layout'],
    'lorebook-builder': ['st-lore'],
    'lore-activation-audit': ['st-lore', 'st-prompt-order'],
    'character-export-fix': ['st-card-v2', 'st-card-png'],
    'character-interop': ['st-card-v2', 'st-card-v3', 'st-lore', 'st-card-png'],
    // Dad-Chat code skills
    'dad-orient': ['dad-layout', 'dad-flow', 'dad-data'],
    'dad-diagnose': ['dad-layout', 'dad-flow', 'dad-data', 'dad-code-rules'],
    'dad-fix': ['dad-layout', 'dad-flow', 'dad-code-rules'],
    'dad-add-feature': ['dad-layout', 'dad-data', 'dad-code-rules'],
    'dad-improve-feature': ['dad-layout', 'dad-flow', 'dad-code-rules'],
    'dad-new-module': ['dad-layout', 'dad-code-rules'],
    'dad-prompt-audit': ['dad-flow', 'dad-rules', 'dad-layout'],
    'dad-prompt-tune': ['dad-flow', 'dad-rules'],
    'dad-provider-add': ['dad-layout', 'dad-code-rules'],
    'dad-ui-polish': ['dad-layout', 'dad-code-rules'],
    'dad-perf-size': ['dad-layout', 'dad-flow', 'dad-rules'],
    'dad-persistence-audit': ['dad-data', 'dad-layout', 'dad-code-rules'],
    'dad-hub-work': ['dad-hub', 'dad-layout', 'dad-code-rules', 'dad-file-chat'],
    'dad-safety-review': ['dad-layout', 'dad-code-rules', 'dad-hub'],
    'dad-import-export': ['dad-character', 'dad-world', 'dad-file-index', 'st-dad-map'],
    'dad-release-check': ['dad-layout', 'dad-code-rules'],
    // Dad-Chat content skills
    'dad-character-create': ['dad-character', 'dad-lore', 'dad-rules'],
    'dad-character-improve': ['dad-character', 'dad-rules', 'dad-flow'],
    'dad-lore-build': ['dad-lore', 'dad-world', 'dad-rules'],
    'dad-lore-audit': ['dad-lore', 'dad-flow', 'dad-rules'],
    'dad-world-build': ['dad-world', 'dad-lore', 'dad-rules', 'dad-file-index'],
    'dad-token-diet': ['dad-rules', 'dad-character', 'dad-lore'],
    'dad-convert-tavern': ['st-dad-map', 'st-card-v2', 'dad-character', 'dad-lore'],
    'dad-greetings-examples': ['dad-character', 'dad-rules'],
    // Dad-Chat file template skills
    'dad-file-validate': ['dad-file-index', 'dad-file-chat', 'dad-file-interop'],
    'dad-file-chat': ['dad-file-chat', 'dad-file-index'],
    'dad-file-backup': ['dad-file-chat', 'dad-file-index'],
    'dad-file-convert': ['dad-file-interop', 'dad-file-index', 'st-dad-map'],
    'dad-weld-wire': ['dad-file-weld', 'dad-layout', 'dad-code-rules'],
    'skybridge-download': ['weld-caps'],
    'skybridge-clipboard': ['weld-caps'],
    'skybridge-notify': ['weld-caps'],
    'skybridge-token-meter': ['weld-caps'],
    'skybridge-fetch-search': ['weld-caps'],
    'skybridge-vault-backup': ['weld-family', 'dad-skill-vault-bridge', 'weld-caps'],
    'skybridge-presence': ['weld-family', 'dad-skill-presence-bus'],
    'skybridge-family-adapt': ['weld-family', 'weld-caps'],
    'skybridge-health-check': ['weld-caps', 'weld-family'],
    'dad-vault-bridge': ['dad-skill-vault-bridge', 'dad-skill-presence-bus', 'dad-skill-wire-envelopes', 'dad-skill-dad-full'],
    'dad-session-slots': ['dad-skill-session-slots', 'dad-skill-dad-full', 'dad-data'],
    'dad-world-state': ['dad-skill-world-state', 'dad-skill-dad-full', 'dad-world'],
    'dad-curated-density': ['dad-skill-curated-density', 'dad-flow'],
    'site-one-click-builder': ['web-spec', 'web-pipeline', 'web-field-ai', 'web-edges'],
    'site-from-idea': ['web-spec', 'web-render-safety'],
    'site-ai-fields': ['web-field-ai', 'web-spec'],
    'site-brief-expander': ['web-pipeline', 'web-spec', 'web-edges'],
    'site-spec-model': ['web-spec', 'web-edges'],
    'site-pipeline-resilience': ['web-pipeline', 'web-edges', 'weld-limits'],
    'site-multipage': ['web-spec', 'web-render-safety'],
    'site-single-page': ['web-spec'],
    'site-section-library': ['web-spec', 'web-render-safety'],
    'site-design-tokens': ['web-spec', 'web-render-safety'],
    'site-copywriter': ['web-spec', 'web-field-ai'],
    'site-imagery': ['web-spec', 'web-render-safety', 'weld-limits'],
    'site-seo-meta': ['web-spec', 'web-render-safety'],
    'site-contact-forms': ['web-render-safety', 'weld-caps'],
    'site-interactive-widgets': ['web-spec'],
    'site-feature-blocks': ['web-spec', 'web-render-safety'],
    'site-section-editing': ['web-field-ai', 'web-spec'],
    'site-wrap-generator': ['web-spec', 'web-render-safety'],
    'site-project-library': ['web-spec', 'weld-limits', 'web-edges'],
    'site-live-preview': ['web-render-safety', 'weld-limits'],
    'site-export-bundle': ['web-render-safety', 'weld-caps', 'weld-limits'],
    'site-render-safety': ['web-render-safety', 'web-spec'],
    'site-quality-audit': ['web-render-safety', 'web-edges'],
    'site-edge-cases': ['web-edges', 'web-pipeline', 'weld-limits'],
    'ai-json-contract': ['web-edges'],
    'ai-context-budget': ['weld-limits'],
    'sandbox-frame-fallbacks': ['weld-limits', 'weld-caps'],
    'unicode-text-safety': ['web-edges'],
    'size-limit-guard': ['weld-limits'],
    'cross-tab-state': ['weld-limits', 'weld-caps'],
    'backup-readiness': ['weld-limits'],
    'undo-redo': ['web-field-ai'],
    'large-generator-slicing': ['weld-limits'],
    'perchance-syntax-guard': ['weld-limits']
  };

  const byId = Object.freeze(packs.reduce((m, p) => { m[p.id] = p; return m; }, {}));
  return Object.freeze({ packs: Object.freeze(packs), byId, links: Object.freeze(links), examples: Object.freeze(examples) });
});
