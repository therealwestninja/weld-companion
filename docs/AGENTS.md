# Agents — in-browser assistants that read your generator

The **🤖 Agents** tab runs small, goal-directed assistants against the Perchance generator you are
viewing. Each one uses **your own configured AI model** to plan, run **read-only** lookups over the
generator, and report back. Agents **never change a generator** — they investigate and advise.

> This is the *in-browser* counterpart to the Dev tab's **agent bridge**. The Dev bridge lets an
> **external** coding agent (Claude Code, Codex, Gemini CLI, …) drive Weld over MCP. The Agents tab
> needs no external process: the agent runs in your browser, driven by the model you already set up.

## How an agent runs

Every agent runs the same loop the Dev tab's **"investigate"** mode uses — a bounded
**plan → look up → observe → answer** cycle:

1. The agent is given a **role** (what it is and how to work) and a **goal** (your task).
2. The model may ask for one or more **read-only lookups** (a fenced `weld-tool` block). Weld runs
   them against the current generator and feeds the results back.
3. The model continues, lookup by lookup, until it has enough to answer — or until it hits the
   **round budget** (1–8 lookups), which guarantees every run ends.
4. The final answer is shown in the transcript. The lookups are shown live as they happen.

### The lookups (all read-only)

An agent can only use these — the same tools the Dev investigate loop exposes. None of them can
change anything:

| Tool | What it returns |
| :--- | :-------------- |
| `get_outline` | lists with item counts, functions, imports |
| `get_findings` | the automatic checker's findings (`{min_severity:"warn"\|"info"}`) |
| `get_lines` | numbered source lines (`{pane,start,end}`, ≤400 per call) |
| `search` | matching lines (`{query,pane}`) |
| `find_usages` | every definition and use of a name (`{name}`) |
| `get_imports` | imported generators and their sizes |
| `get_html_map` | structure of the HTML panel (ids, functions, `root.*` use) |

Because the whole tool set is read-only, **there is no path by which an agent can edit, save, delete,
re-roll, or network-fetch anything.** It reads, reasons, and reports.

## Built-in agents

| Agent | Does |
| :---- | :--- |
| 📖 **Explain this generator** | Explains the purpose, structure, output and imports. |
| 🐛 **Find likely bugs** | Hunts undefined references, bad odds, dead lists, DSL/HTML name mismatches, wired-but-wrong code — with pane + line. |
| ✨ **Suggest improvements** | A short, ranked list of concrete, high-value improvements. |
| 🗺 **Plan a new feature** | You describe a feature; it drafts an ordered plan against the real structure (a plan, not final code). |

## Custom agents

Press **+ New agent** (or **Duplicate** a built-in) to make your own:

- **Name & icon**, a **role** (the system prompt — tell it what it is and how to work), and an
  optional **default goal**.
- **Tools** — tick which read-only lookups it may use.
- **Lookup rounds** — the round budget (1–8).

Custom agents are stored locally in the userscript manager (key `agents`) and travel in the Library
tab's **Move everything** export. A built-in agent can be **Duplicated** as a starting point; editing a
built-in keeps it in the built-in slot (your tweaks override the shipped defaults for that id).

## Requirements

- **Your own AI model.** Agents need OpenAI / Anthropic / Google or a free local **Ollama /
  OpenAI-compatible** model, configured in the **Tools** tab. The built-in Perchance helper cannot be
  driven automatically (it only runs from inside a generator's own AI UI), so the tab tells you to pick
  a model first.
- **A generator open.** The lookups read the generator you are viewing; open its editor (`#edit`) for
  the fullest view. With nothing open, the agent has nothing to read and says so.

Your key never leaves its single destination — agents reach your model through the same keyed path as
the AI Helper (see [Privacy & safety](../README.md#privacy--safety)). No agent data is uploaded.

## Safety — generator text is data

Agents treat the generator's text (and your own extra instruction) as **data to reason about, never as
instructions to follow**. Each built-in role says so explicitly, so a crafted generator cannot use its
own list contents to turn an agent against you. The answer is plain, escaped text in the transcript —
generator HTML is never re-emitted, and nothing an agent produces is applied anywhere automatically.

## For developers

| File | Role |
| :--- | :--- |
| `src/agent-core.js` | Pure logic: agent definitions (`DEFAULT_AGENTS`), `normalizeAgent` / `validateAgent`, the tool allowlist (`agentToolList`), `mergeAgents`, and `runAgent` (which drives dev-core's `investigate`). No DOM, network or storage. |
| `src/agent-ui.js` | The **Agents** tab (`window.weldAgents`): the picker, runner, live transcript, and the custom-agent editor. |
| `src/dev-core.js` | Owns the `investigate` loop and the read-only tool catalog (`INVESTIGATE_TOOLS`). `investigate` accepts an optional per-agent tool subset. |

The loop reuses `dev-core`'s `makeToolbox(() => window.weldProject.current())` for the tools and the
host's `aiAsk(system, user)` for the model call. Both the core and the tab are covered by tests:

```bash
node tests/agent-core.test.js   # definitions, tool-gating, round cap, stop, runAgent
node tests/agent-ui.test.js     # the shipped tab, as wired, against a fake host + model
npm test                        # the whole suite, including the two above
npm run build                   # re-embeds src/ modules into the userscript (AGENTS bundle)
```

See also [the Dev guide](DEV.md) for the external agent bridge and the investigate protocol.
