## Roadmap

Items are grouped by the capability or tool they extend, then sorted easiest-first within each group. **Offline** items need no network access; **Online** items use the Companion's `fetch` capability or an external API.

---

### 🗃 Data Manager & storage
*All offline unless noted.*

- **Full state export / import** — one-click export of all Companion data (favorites, Scrapbook, Lore Library, character exports, comfort settings, all Data Manager dumps) as a single portable file. Mirror: import to restore on a new machine. *(offline)*
- **Companion-to-Companion sync** — encode full state as a QR code or short link; scan on another device to import. No server. *(offline)*
- **Asset manager** — inventory every external asset a generator loads, check liveness, offer to re-host dead ones to user.uploads.dev, maintain a personal asset library reusable across generators. *(online)*
- **Grief recovery / session archaeology** — given any IndexedDB dump, reconstruct a human-readable timeline including deleted rows. Not just "here are your characters" but the full database history. *(offline)*

---

### 📒 Library — Scrapbook & reading
*All offline unless noted.*

- **Reading progress indicator** — a thin progress bar at the top of the output area showing how far through a long piece the user is. Small, no dependencies. *(offline)*
- **Clipboard history for creative work** — every copy action on a Perchance page silently added to a local ring buffer. Retrieve anything you copied in the last session. *(offline)*
- **Global quick-save hotkey** — a keyboard chord that opens a quick-save dialog over whatever page is active, saving selected text to the Scrapbook without switching tabs. *(offline)*
- **Session replay** — persist the undo/reroll history as a named session with a full sequence of outputs. Resume a creative session days later. *(offline)*
- **Output templates / post-processing** — per-generator find/replace, regex, or prefix/suffix rules applied to every output before display. No DSL changes needed. *(offline)*
- **Annotation layer** — private sticky notes on any generator page, stored by slug, injected as a small badge when you visit. *(offline)*
- **Prompt / output quality log** — quick thumbs-up / thumbs-down on any output, stored locally per generator. Feeds into a "my ratings" sort in the Generators tab. *(offline)*
- **Tab snapshot / session restore** — save all currently open Perchance-related tabs as a named session, restore them all at once later. *(offline)*
- **Manuscript assembler** — drag saved Scrapbook entries into order, add prose between them, export as `.docx` or `.md`. Perchance as a drafting tool. *(offline)*
- **Cross-generator search** — search Scrapbook entries, generator names, and character descriptions across your full visited history. *(offline)*
- **Scheduled generators** — run a generator on a schedule and save the result to the Scrapbook automatically. Daily tarot pull, weekly writing prompt. *(offline / background)*
- **"Send to…" output routing** — pipe output into another open generator as its seed, append to an Obsidian note, post to a Discord webhook, or copy shaped for a specific app. *(online for webhooks)*
- **Ambient generation / prefetch cache** — maintain a pool of pre-generated outputs for favourite generators, silently refreshing in the background. Zero wait time on open. *(offline)*
- **Research collector on external sites** — extend the userscript to Wikipedia and other research sites; offer "save to research library" with title, URL, excerpt, and tag — integrated with the existing Scrapbook. *(online)*
- **Publishing pipeline** — push formatted output to Ghost, Substack, GitHub Pages, or Ko-fi. The generator as the first step in a content pipeline. *(online)*

---

### 👁 Comfort & reading experience
*All offline.*

- **Ambient theme** — detect local timezone and season; subtly shift the default comfort theme. No configuration needed. *(offline)*
- **Accessibility as first-class** — full keyboard navigation, voice command input, switch access compatibility, session state that survives accidental tab closes. *(offline)*
- **Font/contrast override on generator request** — a generator can request a specific Comfort preset via the bus when it loads. *(offline)*
- **Neurodivergent-friendly session tools** — hyperfocus timer, "session wrap-up," "where was I" context reconstruction. *(offline)*

---

### ⭐ Generators tab & discovery
*Mixed.*

- **Usage patterns / personal analytics** — most-used generators, time-of-day patterns, session lengths. Entirely local. *(offline)*
- **Generator subscription / update notifier** — periodically fetch source of starred generators, notify when it changes. *(online)*
- **Dead generator detection and repair suggestions** — health-check starred generators; ⚠ badge; fix suggestions for renamed imports. *(online)*
- **Discover** — browse Perchance's public gallery from the drawer with a "surprise me" button. *(online)*
- **Competitive awareness for authors** — monitor generators in the same category; alert when a notable one appears or changes. *(online)*
- **Community generator index** — opt-in anonymised signal aggregation for a community-maintained directory. *(online)*

---

### 🔧 Tools tab & authoring
*Mixed.*

- **Time tracker** — session clock, weekly writing hours, exportable CSV log. Tracks automatically because the Companion is already running. *(offline)*
- **Ritual and habit support** — quiet streak tracking; gentle prompt for daily creative rituals. *(offline)*
- **Living style guide** — extract implicit consistency rules from saved outputs; flag when a new output breaks your canon. *(offline)*
- **Weld Lint overlay** — run the brace-trap scanner live in the editor; underline issues as you type. *(offline)*
- **Accessibility audit** — output contrast ratio, font size, `prefers-reduced-motion` compliance. One-line result in the Generators tab. *(offline)*
- **Local version history** — track every edit; rollback to any version; diff between any two. *(offline)*
- **Contextual platform tutorial** — "how does this work?" panel specific to the generator you're looking at. *(offline)*
- **DSL reader / explainer** — "explain this generator in plain English." The AI Helper writes code; this reads it. *(online — uses AI)*
- **Atomic GitHub commits** — push DSL + HTML as a single commit rather than two. *(online)*
- **Richer GitHub manager** — sync-status badge and pre-Pull/Push diff. *(online)*
- **Conflict detection for collaborators** — detect divergence via the bus; alert both authors before either saves. *(offline)*
- **Taste learning from your Scrapbook** — analyse saved outputs to identify patterns; suggest generator prompt adjustments. *(online — uses AI)*
- **Creative writing coach** — identify recurring themes and tendencies; suggest prompts to develop range. *(online — uses AI)*
- **Spaced repetition on any generator** — apply a basic SRS schedule; surface review items at the top of the next session. *(offline)*
- **Platform changelog** — observe when things stop working; crowd-sourced platform observability. *(online, opt-in)*
- **Platform "is it slow?" indicator** — "is Perchance slow right now or is it me?" *(online)*

---

### 🌐 Skybridge — cross-generator & multiplayer
*All require Skybridge plugin in the generator. All offline unless noted.*

- **Notification / async signal** — when a long generation finishes, publish to the bus; the Companion shows a toast across tabs. *(offline)*
- **Co-presence signal** — opt-in, anonymous awareness that someone else is using the same generator right now. Not chat, not identity. *(offline / bus)*
- **Reading journal / progress tracker** — track chapters read, choices made, where you left off. Two tabs stay in sync via bus. *(offline)*
- **Shared table / multiplayer rolls** — one player's roll appears in another's output via the bus. Requires both users to have the Companion installed. *(offline / bus)*
- **Shared timer / game clock** — publish tick events; a companion clock generator subscribes and displays the countdown. *(offline / bus)*
- **Live leaderboard / session stats** — quiz scores written to Companion storage; a scores generator renders the leaderboard. *(offline)*
- **Persistent world state across "rooms"** — multiple generators as interconnected rooms, sharing player state via the bus, persisting across sessions. *(offline)*
- **Offline-capable map + journal** — an exploration generator writes discovered locations to IDB; a map generator reads the same store and renders what's been found. *(offline)*
- **Companion as game master** — multiple generators coordinated as a rules system; cross-generator rules enforced; world state managed in Companion storage. *(offline)*
- **Emotional continuity for AI chat** — session count, sentiment, recurring themes injected as lightweight context at each session start. *(offline)*
- **Grounded storytelling** — fetch current date, a Wikipedia summary, or today's weather and inject it into the prompt before generating. *(online)*
- **Physical world bridge** — post a roll result to a Home Assistant webhook, Raspberry Pi, or IFTTT trigger. The output escapes the browser. *(online)*

---

### 📦 Device capabilities
*New surfaces beyond the current Perchance page.*

- **Opportunistic extension integration** — if Grammarly is active, route output through it. If a dictionary extension is present, wire up "define this word." *(offline)*
- **Dictation input** — use the microphone to dictate a note attached to a Scrapbook entry. *(offline)*
- **Camera — photograph physical assets** — photograph a physical character sheet or map and add it to your collection. *(offline)*
- **Geolocation tagging** — tag a Scrapbook entry with where you were when you saved it. *(offline)*
- **Generator as headless content API** — a Service Worker endpoint that other tools (Obsidian, scripts, curl) can query for fresh generator output on demand. *(offline / local)*

---

### 🤝 Social & sharing
*Mixed.*

- **Recommendation bundles** — export a recommendation as generator slug + note + sample output. Someone else's Companion imports it directly into their favorites. No server. *(offline)*
- **Companion-to-Companion sync via QR** — encode state as a QR code; scan on another device to import. *(offline)*
- **Content moderation layer** — for community generators: flag outputs, require review steps, log locally within the group's shared storage. *(offline)*
- **Safe space signal** — authors flag a generator as a safe space; the Companion applies specific UI behaviours on that page. *(offline)*
- **Legacy export** — a self-contained, human-readable archive of everything made and saved. Plain HTML, no browser extension needed to read it. *(offline)*
- **Cross-tool export formatting** — export characters as Campfire cards, lore as World Anvil articles, locations as Obsidian notes. *(online for some targets)*

---

### 🧑‍⚕️ Human-centred & wellbeing
*All offline.*

- **Time capsule** — write a message today, set a date, surface it the next time Perchance is opened after that date. *(offline)*
- **Character preservation and grief support** — extra backup redundancy for flagged characters; read-only memorial archive; restore path in plain human terms. *(offline)*
- **Consent and boundary memory** — persistent preferences applied as a quiet prepend to each conversation start. *(offline)*
- **Mental health awareness** — opt-in, private session pattern tracking. Gentle check-in if patterns suggest distress. *(offline)*
- **Bereavement and attachment care** — long-term archival of cherished characters in plain readable JSON. *(offline)*