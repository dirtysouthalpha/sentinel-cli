# Sentinel CLI — Next 5 Versions (v1.2.0 → v1.6.0)

Current: **v1.1.0**. The engine spine (router, agent-runner, permissions/checkpoints,
MCP client+server, TUI + Tauri GUI, sessions, subagents, todos, hooks, background) is
**done**. These five releases layer parity-and-beyond features onto that spine, ordered
by **visible impact first**, engineering health woven throughout.

Each release = a set of shippable, testable units. Conventions: ESM + tsup, one vitest
test per module, `.md`-template slash commands, provider-agnostic core, hand-mirrored
WS protocol (to be codegenned in v1.6).

---

## v1.2.0 — Chat parity & polish (GUI focus)

**Goal:** close the "I can't read my own conversation" gaps. Highest user-visible wins.

### Fixes shipped (immediate)
- ✅ **Word-wrap / horizontal overflow bug (GUI)** — flexbox `min-width: auto` blowout
  on `.chat`/`.block`/`.body` fixed; long tokens + code lines now wrap or scroll in-box.
  Verified: `scrollWidth == clientWidth`, zero horizontal overflow at 900px.

### Features
- **Message edit / retry / regenerate (GUI)** — per-turn actions on assistant+user
  blocks: edit a user prompt → re-run; regenerate an assistant reply. Standard
  ChatGPT/Claude UX. Contained to `gui/src/main.ts` render layer.
- **In-conversation search (GUI)** — `Cmd-F` over message blocks; highlight + jump
  next/prev. Messages accumulate unbounded today; this is table-stakes.
- **Incremental DOM (GUI)** — stop rebuilding `chat.innerHTML` on every non-streaming
  state change; keyed append of new blocks only. Fixes jank on long transcripts.
- **Git slash commands** — `/commit`, `/pr`, `/branch`, `/diff` (`.md` templates wiring
  the existing git tool). Closes an obvious parity gap.
- **`architect` + `orchestrator` agents** — Kilo-parity modes promised in ROADMAP-V2.

### DoD
Edit a turn and re-run it; search finds a phrase 50 turns back; no horizontal overflow
on any message; `/commit` produces a conventional-commit message.

---

## v1.3.0 — Context & codebase intelligence

**Goal:** smarter, cheaper, longer conversations. The biggest quality + cost lever.
Aligns with ROADMAP-V2 V2.

### Features
- **Real LLM compaction** — replace the current char-slice summarizer in
  `src/ai/context.ts` with a model-generated summary of dropped turns (auto-compact at
  the 120k cap already fires; make the summary meaningful). Keeps semantic continuity.
- **Repo-index retrieval into context** — wire `repo-index.ts` (embedding infra exists)
  into the system prompt: agent can answer cross-file questions via retrieval without
  manual `@`-mention of every file.
- **`/search` — NL→shell (Warp parity)** — natural-language command search: "undo my
  last commit but keep changes" → proposes `git reset HEAD~1`. Surfaces as a slash cmd.
- **File-tree / explorer panel (GUI)** — collapsible tree of the workspace with the
  existing file/search tools; click to drop a file mention into the composer.

### DoD
Agent answers a cross-file question using retrieval, not a manual file list; a compacted
session still recalls the earlier decision; `/search` proposes correct shell for 3 NL prompts.

---

## v1.4.0 — Multimodal + memory (flagship)

**Goal:** turn two declared-but-thin features into flagships.

### Features
- **Vision UI** — `vision.ts` is 18 LOC today (dead code). Build the surface:
  - GUI: paste-image / drag-drop / clipboard image in the composer → builds a vision
    message and sends it.
  - CLI: `sentinel run --image path/to/x.png "what's wrong here?"`.
  - TUI: `@paste` / file mention for images.
- **Neuralis brain recall/store** — flesh out `brain-recall.ts` (41 LOC) into a real
  recall/store loop using `repo-index.ts` embeddings: the agent remembers facts across
  sessions. Aligns with ROADMAP-V2 V3.
- **`/memory` + `/init`** — edit the project memory file (AGENTS.md / CLAUDE.md /
  SENTINEL.md) in-flow; `/init` scaffolds one from the repo.

### DoD
Paste a screenshot of an error into the GUI and the agent diagnoses it; a session
recalls a fact stored in a previous session via the brain; `/init` writes a memory file.

---

## v1.5.0 — Workflow engine + share + billing

**Goal:** Warp-Drive-class power-user features on the existing scaffold.
Aligns with ROADMAP-V2 V5 + V6.

### Features
- **Runnable workflows** — `workflows-store.ts` (99 LOC scaffold) → parameterized
  multi-step workflows you save by name and run with args (`/run deploy --env prod`).
- **`/share` session links** — `sync.ts` (234 LOC) + `session-export.ts` already exist;
  surface read-only shareable session links from the GUI + CLI.
- **Hooks UX depth** — `hooks.ts` (102 LOC) → full lifecycle: pre/post-tool, on-error,
  on-permit callbacks; settings tab in the GUI. Matches Claude Code hook depth.
- **Live pricing + usage dashboard** — `pricing.ts` (static table) fetches live per-model
  pricing with caching; `usage-tracker.ts` powers a per-session/per-day cost dashboard
  in the GUI right panel. Turns cost tracking into a budget feature.

### DoD
Save a deploy as a workflow, run it by name; share a session link that opens read-only;
a pre-tool hook blocks a write in gated mode; the dashboard shows today's spend by model.

---

## v1.6.0 — Terminal UX & engineering health

**Goal:** close the opencode/Warp TUI ergonomics gap and pay down the god-object
that blocks every future surface. Aligns with ROADMAP-V2 V4 + V7.

### Features
- **TUI mouse + scrollback** — wheel scrollback, click-to-copy on cards via blessed
  mouse reporting; closes the opencode ergonomics gap.
- **Extract `app.ts` agentic loop → `src/core/loop.ts`** — the 2192-line `app.ts`
  god-object owns the loop + rendering + keys. Split: pure loop in core, thin view in
  `tui/app.ts`. Unblocks both surfaces and every future feature.
- **Shared protocol codegen** — generate `gui/src/main.ts` WS types from
  `src/server/protocol.ts` so the hand-mirror can't drift (eliminates a whole class of
  runtime WS bugs).
- **`/help` keyboard shortcuts** — discoverable shortcut cheatsheet in both surfaces.
- **CHANGELOG.md + ROADMAP consolidation** — three overlapping ROADMAP files → one;
  CHANGELOG generated from conventional commits.

### DoD
Mouse-wheel scrolls the transcript; the extracted loop passes all existing tests
unchanged; a deliberately-introduced protocol field mismatch fails CI at codegen time.

---

## Cross-cutting themes (every release)

- **One test per new module** (existing culture — 347 passing today).
- **Provider-agnostic**: every feature works on any model, online or local.
- **Three surfaces in sync**: TUI, GUI, headless CLI get each feature where it makes sense.
- **`.md`-template commands first**: slash commands stay declarative and user-editable.

## Suggested sequencing rationale

1. **v1.2 first** — visible polish + the wrap fix builds momentum and trust.
2. **v1.3 second** — context quality is the single biggest product lever.
3. **v1.4 third** — vision + memory are the differentiators (cheap to build, high wow).
4. **v1.5 fourth** — power-user depth once the core feels great.
5. **v1.6 last** — engineering health + TUI parity, positioned so the god-object refactor
   lands *after* feature velocity, not before.
