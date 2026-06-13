# Sentinel CLI Upgrade Plan — v0.3.0 → v0.5.0

## Overview

Upgrade Sentinel CLI from a capable v0.3.0 to a hardened, feature-complete v0.5.0
by decomposing the TUI monolith, adding LSP intelligence, enabling parallel tool
execution, implementing plan mode, and hardening headless/CI operation.

**Builds on:** ROADMAP-V2.md (V1–V4 scope, prioritized for maximum impact)
**Version bump:** 0.3.0 → 0.4.0 (Phase 1–2) → 0.5.0 (Phase 3–5)

---

## Phase 1: TUI Decomposition & Input Hardening

**Goal:** Break the 2,398-line `app.ts` monolith into focused modules and fix the
raw-stdin input quirks that are the #1 UX complaint.

### Task 1.1: Extract input handler from app.ts

- **Files:** `src/tui/input-handler.ts` (new), `src/tui/app.ts`
- **What:**
  - Move `setupRawInput()` and all key-binding logic into `src/tui/input-handler.ts`
  - `InputHandler` class: owns raw stdin, keymaps, multi-line paste buffer, history
  - Emits typed events: `submit`, `command`, `interrupt`, `tab-switch`, etc.
  - `app.ts` subscribes to events instead of owning stdin directly
- **Acceptance:**
  - `app.ts` drops below 1,800 lines
  - All existing key bindings work identically
  - Multi-line paste (Shift+Enter or literal paste) still works
  - All 318 existing tests still pass

### Task 1.2: Extract chat renderer from app.ts

- **Files:** `src/tui/chat-renderer.ts` (new), `src/tui/app.ts`
- **What:**
  - Move streaming response rendering, tool-call display, and markdown rendering
    into `ChatRenderer` class
  - `ChatRenderer` owns the chat box blessed element and all write operations
  - `app.ts` calls `renderer.streamChunk()`, `renderer.showToolCall()`, etc.
- **Acceptance:**
  - `app.ts` drops below 1,400 lines
  - Streaming renders identically to current behavior
  - Markdown code blocks, tool-call boxes render correctly

### Task 1.3: Fix raw stdin input quirks

- **Files:** `src/tui/input-handler.ts`
- **What:**
  - Fix backspace not working on Windows Terminal (sequence mismatch)
  - Fix Ctrl+V paste not working in some terminals
  - Fix cursor position tracking on wide characters (CJK)
  - Add proper bracketed-paste support
  - Test on: Windows Terminal, cmd.exe, PowerShell 7
- **Acceptance:**
  - Backspace works in all three Windows terminals
  - Paste works via Ctrl+V and right-click
  - Cursor position accurate with wide chars
  - Manual QA pass on Windows Terminal + PowerShell 7

### Task 1.4: Command palette (Ctrl+K)

- **Files:** `src/tui/command-palette.ts` (new), `src/tui/app.ts`
- **What:**
  - Overlay fuzzy-search palette triggered by Ctrl+K
  - Index: slash commands, file paths (from project detector), agent names, theme names
  - Uses existing `src/core/fuzzy.ts` for matching
  - Enter executes, Escape dismisses
- **Acceptance:**
  - Ctrl+K opens palette, typing filters results in real-time
  - Selecting a slash command executes it
  - Selecting a file opens it in context
  - Selecting a theme switches to it

---

## Phase 2: LSP Integration

**Goal:** Give the agent IDE-grade code intelligence — diagnostics, go-to-def,
references, rename — as a first-class tool.

### Task 2.1: LSP tool implementation

- **Files:** `src/tools/lsp.ts` (new), `src/tools/tool-executor.ts`, `src/tools/index.ts`
- **What:**
  - New `lsp` tool with actions: `diagnostics`, `definition`, `references`, `hover`,
    `rename`, `symbols`, `code_actions`
  - Wraps a lightweight LSP client that manages language server processes
  - Per-project server lifecycle: start on first `lsp` call, stop on session end
  - Tool schema mirrors LSP methods with simplified args (file, line, symbol)
- **Acceptance:**
  - `lsp diagnostics src/foo.ts` returns typed errors/warnings
  - `lsp definition src/foo.ts:42:someFunc` returns definition location
  - `lsp references src/foo.ts:42:someFunc` returns all reference locations
  - Tool definition appears in `TOOL_DEFINITIONS` sent to model

### Task 2.2: LSP client manager

- **Files:** `src/core/lsp-manager.ts` (new)
- **What:**
  - Manages language server processes (spawn, health-check, restart)
  - Server config: TypeScript (`typescript-language-server`), Python (`pylsp`)
  - Per-server capability detection (some servers don't support rename, etc.)
  - Graceful shutdown on process exit
- **Acceptance:**
  - TypeScript server auto-starts when a `.ts` file is referenced
  - Server crash is detected and server restarts automatically
  - No orphan processes after Sentinel exits

### Task 2.3: Inline diagnostics in TUI

- **Files:** `src/tui/chat-renderer.ts`
- **What:**
  - After an edit/patch tool runs, auto-request diagnostics for modified files
  - Display diagnostics as inline annotations in chat (red/yellow markers)
  - Click diagnostic → navigate to file:line (via existing file explorer)
- **Acceptance:**
  - After editing a `.ts` file, type errors appear in chat within 2s
  - Diagnostics are clickable and open the relevant file

---

## Phase 3: Plan Mode & Parallel Tool Execution

**Goal:** Implement read-only plan mode and enable parallel tool calls.

### Task 3.1: Plan mode flow

- **Files:** `src/core/plan-mode.ts` (new), `src/tui/app.ts`, `src/core/agent-runner.ts`
- **What:**
  - When agent mode is `plan`, the permission engine auto-denies all write tools
  - Agent runs its research loop (read, search, LSP) and produces a plan
  - Plan is rendered in chat with numbered tasks
  - User approves → mode switches to `auto` and tasks execute sequentially
  - User rejects → agent revises or stops
- **Acceptance:**
  - `plan` agent mode (or `/plan "task"`) runs read-only
  - No file/bash-write/patch tools execute during planning
  - Plan renders as numbered task list in chat
  - "approve" triggers execution; "reject" prompts revision

### Task 3.2: Parallel tool execution

- **Files:** `src/core/agent-runner.ts`, `src/tools/tool-executor.ts`
- **What:**
  - When the model returns multiple tool calls in a single response, execute
    independent ones in parallel (Promise.allSettled)
  - Detect dependencies: if tool B reads a file tool A writes, serialize them
  - Simple heuristic: file writes to same path → serialize; otherwise parallel
  - Concurrency limit: 4 simultaneous tool calls
- **Acceptance:**
  - Two independent `file read` calls execute simultaneously
  - A `file write` and a `file read` to the same path are serialized
  - Parallel execution is faster than sequential for 3+ independent reads
  - Tool results are returned in original call order

### Task 3.3: Todo board in TUI

- **Files:** `src/tui/todo-panel.ts` (new), `src/tui/app.ts`
- **What:**
  - Side panel showing active todos (from `src/core/todos.ts`)
  - Live status: pending → in_progress → done
  - Toggle with F4 or `/todos` command
  - Progress bar at bottom
- **Acceptance:**
  - F4 opens todo panel showing current task list
  - Status updates in real-time as agent works
  - Progress bar reflects completion percentage

---

## Phase 4: Headless/CI Hardening

**Goal:** Make `sentinel run` CI-ready with streaming JSON, exit codes, and
reliable tool execution.

### Task 4.1: Headless tool execution fix

- **Files:** `src/cli.ts`, `src/core/agent-runner.ts`
- **What:**
  - Wire the full tool execution path for headless `ask`/`run` commands
  - Currently: `ask` skips tool calls (no agentic loop in headless)
  - Fix: use `AgentRunner` directly in headless, same as TUI path
  - Add `--max-rounds` flag to control depth
- **Acceptance:**
  - `sentinel ask "read package.json and tell me the version"` actually reads the file
  - Tool calls execute and results feed back to the model
  - `--max-rounds 5` limits the agentic loop

### Task 4.2: Streaming JSON output mode

- **Files:** `src/cli.ts`, `src/core/agent-runner.ts`
- **What:**
  - `sentinel run "task" --json` streams NDJSON: one event per line
  - Event types: `start`, `tool_call`, `tool_result`, `text`, `error`, `done`
  - Exit codes: 0 = success, 1 = agent error, 2 = config error
  - `--quiet` flag: only emit final result
- **Acceptance:**
  - `sentinel run "list files" --json` produces valid NDJSON
  - Each line is parseable JSON with a `type` field
  - Exit code 0 on success, non-zero on failure
  - `--quiet` emits only the final `done` event

### Task 4.3: CI integration examples

- **Files:** `docs/ci-examples.md` (new)
- **What:**
  - GitHub Actions workflow using `sentinel run`
  - Pre-commit hook example
  - GitLab CI example
- **Acceptance:**
  - Examples are copy-paste runnable
  - GitHub Actions example runs `sentinel run` and checks exit code

---

## Phase 5: Context Intelligence Upgrade

**Goal:** Replace char-slice compaction with real LLM summarization and improve
project auto-context.

### Task 5.1: LLM-based compaction

- **Files:** `src/ai/context.ts`, `src/ai/compression.ts`
- **What:**
  - When context exceeds threshold, use the active model to summarize old messages
  - Summary replaces N old messages with 1 compact message
  - Keep last 6 messages unmodified (working context)
  - Fallback: if model call fails, use existing headroom compression
  - Track token counts accurately (use tiktoken or model-specific tokenizer)
- **Acceptance:**
  - Context compaction produces a coherent summary of prior conversation
  - After compaction, the agent can still reference earlier decisions
  - Token count is accurate within 10% of actual
  - Fallback to headroom works if model summarization fails

### Task 5.2: Project auto-context

- **Files:** `src/core/project-context.ts`, `src/ai/context.ts`
- **What:**
  - On session start, auto-detect project type and inject context:
    - `package.json` → dependencies, scripts, engine requirements
    - `tsconfig.json` → compiler options, paths
    - `CLAUDE.md` / `AGENTS.md` / `.cursorrules` → project conventions
  - Inject as a system-level message, not user message
  - Respect `.gitignore` — never auto-include ignored files
- **Acceptance:**
  - Opening a Node.js project auto-includes package.json info in context
  - CLAUDE.md content appears in system prompt
  - `.env` files are never auto-included

### Task 5.3: @-mentions improvements

- **Files:** `src/core/mentions.ts`
- **What:**
  - `@file:path` → includes file content (with line numbers)
  - `@symbol:name` → uses repo index to find symbol, includes definition + context
  - `@url:https://...` → fetches and includes page content
  - `@problems` → injects current LSP diagnostics
  - Limit: each mention capped at 500 lines to prevent context blowout
- **Acceptance:**
  - `@file:src/cli.ts` includes the file with line numbers
  - `@symbol:AgentRunner` finds and includes the class definition
  - Oversized mentions are truncated with a "showing first 500 lines" note

---

## Execution Order & Dependencies

```
Phase 1 (TUI Decomposition)
  ├── Task 1.1 (input handler)     ← no deps
  ├── Task 1.2 (chat renderer)     ← after 1.1
  ├── Task 1.3 (input quirks)      ← after 1.1
  └── Task 1.4 (command palette)   ← after 1.2

Phase 2 (LSP)                      ← after Phase 1 (app.ts clean)
  ├── Task 2.1 (lsp tool)
  ├── Task 2.2 (lsp manager)       ← after 2.1
  └── Task 2.3 (inline diag)       ← after 2.2

Phase 3 (Plan Mode + Parallel)     ← after Phase 1
  ├── Task 3.1 (plan mode)
  ├── Task 3.2 (parallel tools)
  └── Task 3.3 (todo panel)        ← after 3.1

Phase 4 (Headless/CI)              ← independent, parallel with 2-3
  ├── Task 4.1 (headless fix)
  ├── Task 4.2 (streaming JSON)    ← after 4.1
  └── Task 4.3 (CI examples)       ← after 4.2

Phase 5 (Context Intelligence)     ← after Phase 1
  ├── Task 5.1 (LLM compaction)
  ├── Task 5.2 (auto-context)
  └── Task 5.3 (@-mentions)        ← after 5.2
```

**Parallelizable:** Phases 2, 3, 4, and 5 can run in parallel after Phase 1 completes.

---

## Version Targets

| Phase | Version | Focus |
|-------|---------|-------|
| 1 | v0.3.1 | TUI decomposition, input fixes |
| 2 | v0.4.0 | LSP integration |
| 3 | v0.4.1 | Plan mode, parallel tools |
| 4 | v0.4.2 | Headless/CI hardening |
| 5 | v0.5.0 | Context intelligence |

---

## Risk Register

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| app.ts decomposition breaks TUI rendering | Medium | Incremental extraction, test after each task |
| LSP server management on Windows | Medium | Use `typescript-language-server` npm package, well-tested on Win |
| Parallel tool execution race conditions | Low-Mod | Simple file-path conflict detection, concurrency cap at 4 |
| LLM compaction token accuracy | Low | Fallback to headroom compression on tokenizer failure |
| Raw stdin fixes vary by terminal | High | Test matrix: Windows Terminal, cmd.exe, PowerShell 7 |

---

## Acceptance Criteria (Overall)

- [ ] `app.ts` under 1,400 lines (from 2,398)
- [ ] LSP tool callable by the agent and returns real diagnostics
- [ ] Plan mode runs read-only, produces plan, awaits approval
- [ ] `sentinel run "task" --json` streams valid NDJSON with exit codes
- [ ] LLM-based compaction summarizes old context coherently
- [ ] All 318+ existing tests still pass
- [ ] `npm run lint` (tsc --noEmit) passes
- [ ] Build succeeds and CLI runs on Windows Terminal + PowerShell 7
