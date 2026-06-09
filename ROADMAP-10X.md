# Sentinel CLI — 10x Roadmap (beat Claude Code / opencode / Kilo)

Goal: the best coding CLI on the planet — **any model, online or local**, with
real orchestration (supertools + GSD) and deterministic multi-agent workflows.

## Competitive thesis

| Tool | Where it wins today | Where Sentinel can win |
|------|---------------------|------------------------|
| **Claude Code** | subagents, MCP, hooks, plan mode, todos, background tasks | provider-agnostic + local-first; deterministic workflows |
| **opencode** | provider-agnostic, LSP, sharing, clean TUI | orchestration depth, GSD pipelines, Windows-first |
| **Kilo Code** | modes, YOLO auto-approve, MCP marketplace, orchestrator | unified router + workflow engine + checkpoints |

**Our moat:** universal provider router (cloud *and* local at parity) → a single
reusable agent runner → real subagent orchestration → deterministic, scriptable
multi-agent workflows. Nobody does all four well.

## Foundation today (v0.2)

- Providers: anthropic, openai, zai, custom/ollama (OpenAI-compat shared layer).
- Tools: file, bash, search, git, web, patch, browser.
- **Agentic loop is trapped inside `tui/app.ts`** — headless `ask` can't use tools.
- Context compaction is a naive char-slice; token counts are estimates.
- `DEFAULT_CONFIG.permissions` exists but **is not enforced** (always-YOLO).
- Markdown-driven skills/commands/agents. No MCP, no sessions, no subagents.

The spine below fixes the structural gaps first, then layers differentiation.

---

## R1 · v0.3 — Universal Provider Core + Model Router  *(the spine)*

**Beats:** opencode's provider breadth, with local at full parity.

- Normalize the provider interface to cover **OpenAI-compat, Anthropic Messages,
  Google Gemini, and local runtimes** (Ollama, LM Studio, llama.cpp server, vLLM,
  LocalAI) via adapters. Capability detection per model (tools / streaming / vision
  / context window).
- **Model router**: task→model rules, fallback chains, retry/backoff, cost+latency
  aware. `/models` browse/search.
- **Extract the agentic loop** out of `tui/app.ts` into `core/agent-runner.ts`,
  reused by TUI, headless, and (later) subagents. Fix headless `ask`/`run` to
  execute tools.
- *Touch:* `ai/provider.ts`, `ai/providers/*`, new `ai/router.ts`, `core/agent-runner.ts`, `cli.ts`.
- *DoD:* the same task runs identically with tool-calls on glm-4.6, claude, gpt-4o,
  and a local llama; fallback kicks in on failure.

## R2 · v0.4 — Tooling v2 + Permissions + Checkpoints

**Beats:** Kilo auto-approve + Claude Code permission modes, plus git-undo.

- **Parallel tool execution**, structured results, multi-file/atomic edits, a real
  test-runner tool, http tool.
- **Permissions engine actually enforced**: modes `yolo` / `auto-edit` / `gated`;
  per-tool allow/deny/ask; path globs; approval prompt in TUI. (Wires up the
  currently-ignored `permissions` config — your "permanent YOLO" becomes one mode.)
- **Checkpoints**: git-backed snapshot before edits, `/undo`, `/diff`, `/revert`.
- *DoD:* `gated` mode prompts before bash; `/undo` restores prior tree.

## R3 · v0.5 — MCP Client

**Beats:** parity with all three (table stakes), done cleanly.

- Local (stdio) + remote (SSE/HTTP) MCP servers; tool discovery + dynamic
  registration into the agent loop; per-server permissions; `.sentinel/mcp.json`;
  server marketplace list. Built-ins: filesystem, git, fetch.
- *DoD:* an external MCP server's tools appear and are callable mid-conversation.

## R4 · v0.6 — Context Engineering + Codebase Intelligence

**Beats:** opencode LSP + Claude Code context, with a local-embeddings option.

- **Real compaction** (LLM summarization, not char-slice) + token-accurate counting.
- **Repo index** (embeddings + retrieval), `@file` / `@symbol` / `@url` mentions,
  auto project context (package.json, tsconfig, AGENTS.md/CLAUDE.md).
- **LSP integration** feeding diagnostics / go-to-def to the agent.
- *Touch:* rewrite `ai/context.ts`, new `core/index/*`, `core/lsp.ts`.

## R5 · v0.7 — Orchestration: Subagents + Supertools + GSD pipelines  *(your ask)*

**Beats:** Kilo orchestrator + Claude Code subagents — and makes **GSD the headline.**

- **Subagent system** on top of `agent-runner`: spawn specialized agents
  (planner, coder, reviewer, researcher) with isolated context; parallel
  fan-out/fan-in; a supervisor that delegates.
- **Supertools v2**: upgrade the 15 markdown commands (`/fix`, `/review`, `/ship`…)
  from single prompts into real **plan → act → verify** workflows.
- **GSD pipeline**: plan → implement → test → review → fix loop, progress
  dashboard, cancel/pause/resume, background tasks.
- *DoD:* `/ship` runs a multi-agent pipeline that edits, tests, self-reviews, and
  reports — unattended.

## R6 · v0.8 — Sessions: persist, resume, branch, share

**Beats:** opencode sharing + Claude Code resume.

- Save/restore conversations, resume by id, branch sessions, export md/html,
  opt-in shareable links, session templates.

## R7 · v0.9 — Plan Mode + Diff-first UX + Advanced TUI

**Beats:** Claude Code plan mode + a richer TUI than opencode (builds on the TUI
we just rewrote).

- Plan mode (read-only research → proposed plan → approve → execute), inline diff
  viewer, syntax highlighting + markdown rendering in chat, command palette
  (Ctrl+P), tab-completion, file-tree pane.

## R8 · v1.0 — Production: hooks, headless/CI, stability

**Beats:** Claude Code hooks + true scriptability — the first "1.0" you'd trust in CI.

- **Hooks** (pre/post tool, on-stop, on-session). **Headless/CI**:
  `sentinel run "task" --json`, exit codes, streaming JSON. Autoupdate, snapshots,
  opt-in telemetry. 95% test coverage, <100ms start, cross-terminal QA, stable
  extension API.

## R9 · v2.0 — Workflow Engine (deterministic multi-agent)  *(the moat)*

**Beats:** none of the three do deterministic multi-agent workflows well.

- Declarative YAML pipelines, conditional branching, parallel fan-out/fan-in,
  scheduled/cron agents, event triggers (git push → auto-review), agent-comms
  protocol. Think "orchestrate dozens of subagents, reproducibly."

## R10 · v3.0 — Ecosystem + Collaboration

- Plugin / skill / agent / MCP marketplace, team libraries, shared live sessions,
  remote agents, optional web companion. Extensibility = lock-in.

---

## Sequencing logic

R1→R2→R3 are the **structural spine** (provider+runner, permissions, MCP) that
everything else needs. R4–R5 deliver the differentiation you asked for
(context + orchestration). R6–R8 harden to 1.0. R9–R10 are the moat + ecosystem.

## Start here

**R1, concrete first PR:** extract `core/agent-runner.ts` from `tui/app.ts`,
normalize the provider interface, add the model router with fallback, and make
headless `run`/`ask` execute tools. This directly delivers "use any API, online or
local" and unblocks all orchestration work.
