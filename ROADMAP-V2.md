# Sentinel CLI — The Next 10 (V1–V10)

**Goal:** do *everything* Claude Code, opencode, Kilo Code, **and Warp** can do — on
any model, online or local — then pull ahead with deterministic multi-agent workflows
and a first-class **Sentinel Prime** (Hermes agent + Neuralis brain) + **Composio**
integration baked into the core.

This supersedes the forward half of `ROADMAP-10X.md`. The spine it assumed is **done**:

- ✅ Universal provider core + model router + extracted `agent-runner` (old R1)
- ✅ Enforced permissions (yolo/auto/gated) + git checkpoints + `/undo` (old R2)
- ✅ MCP **client** (stdio + Streamable-HTTP) *and* Sentinel-as-MCP-**server** (old R3)
- ✅ Desktop GUI + `sentinel serve` WebSocket engine bridge (v0.2)
- ✅ **Sentinel Prime brain MCP + Composio MCP wired** (global config; 16 tools live)

So V1–V10 are the parity-and-beyond layers, dependency-ordered.

---

## Competitive target (the union we must cover)

| Source | Capabilities we must match |
|--------|----------------------------|
| **Claude Code** | subagents · plan mode · todos · background tasks · hooks · MCP client+server · headless `--json`/SDK · slash commands · memory (CLAUDE.md) · rewind/checkpoints · thinking |
| **opencode** | provider-agnostic · LSP · clean TUI · session sharing links · themes · AGENTS.md · client/server split |
| **Kilo Code** | modes (architect/code/debug/ask/orchestrator/custom) · MCP marketplace · auto-approve · orchestrator (boomerang) · browser automation · @-mentions · memory bank |
| **Warp** | command **blocks** · AI command search (NL→shell) · error detect+fix · autosuggest · command palette · **Agent Mode** (parallel autonomous agents) · **Warp Drive** (workflows/notebooks/env/secrets) · **teams + cloud sync** |
| **Sentinel Prime** | your Hermes agent (persona+tools+brain) + Neuralis brain memory + Composio's 250+ app integrations as native, delegatable resources |

---

## V1 — Orchestration core: subagents · plan mode · todos · background tasks
**Beats:** Claude Code subagents/plan/todos + Kilo orchestrator core.

- **Subagent system** on `agent-runner`: spawn specialized agents (planner, coder,
  reviewer, researcher) with isolated context; parallel fan-out/fan-in; a supervisor
  that delegates and merges results.
- **Plan mode**: read-only research → proposed plan → approve → execute (reuses the
  permissions engine; "plan" = deny-all-writes until approved).
- **Todos / task tracker** surfaced in TUI + GUI; live status, cancel/pause/resume.
- **Background tasks**: long-running jobs detached from the turn, re-attach + notify.
- *DoD:* `/plan "x"` yields an approve-gated plan; an approved plan runs as a supervised
  subagent fan-out with a live todo board.

## V2 — Context & codebase intelligence + LSP
**Beats:** opencode LSP + Claude Code context engineering.

- **Real compaction** (LLM summarization, token-accurate counts) replacing char-slice;
  fold in the existing headroom/compression work.
- **Repo index** (embeddings + retrieval) — local-embeddings option via the B60/Ollama
  gateway so it stays provider-agnostic and free.
- **@-mentions**: `@file`, `@symbol`, `@url`, `@problems`; auto project context
  (package.json, tsconfig, AGENTS.md/CLAUDE.md).
- **LSP integration** feeding diagnostics / go-to-def / refs to the agent.
- *DoD:* the agent answers a cross-file question using retrieval + LSP without manual
  file paths.

## V3 — MCP ecosystem + Sentinel Prime + Composio (the "all your resources" layer)
**Beats:** Kilo MCP marketplace — and makes your stack the headline.

- **MCP marketplace/registry** + per-server permissions UI; OAuth for remote MCP;
  support MCP **resources & prompts**, not just tools.
- **Sentinel Prime mode**: bundle the **Neuralis brain MCP** (recall/think/context/
  opinions — persistent cross-session memory) and the **Hermes agent** as a delegatable
  remote agent ("ask Sentinel Prime"). The CLI gains long-term memory for free.
- **Composio MCP** as the integrations spine: Gmail/Calendar/Drive/Slack/GitHub/250+
  apps become agent tools and workflow steps.
- *DoD:* a session recalls a fact stored in a *previous* session via the brain, and can
  send an email / file a calendar event through Composio, gated by permissions.

## V4 — Terminal-grade UX (Warp parity ①)
**Beats:** Warp's terminal feel — in both TUI and GUI.

- **Command blocks**: group each command + its output, collapsible, copyable, re-runnable.
- **AI command search**: natural language → shell command, with explain + edit before run.
- **Inline error detection + fix**: failed command → diagnosed cause → one-click fix.
- **Autosuggestions**, **command palette (Ctrl/⌘K)**, syntax highlighting, theme parity.
- Replace the raw-stdin input path with a real editor (kills the known input quirks).
- *DoD:* type "undo my last commit but keep changes" → correct `git reset` proposed,
  blocks render, a failed command offers a fix.

## V5 — Warp Drive: workflows · notebooks · env/secrets · prompt library (Warp parity ②)
**Beats:** Warp Drive — built on our markdown command/skill system.

- **Saved & parameterized workflows** (typed args, like Warp workflows) — promote the
  existing `.md` commands into reusable, shareable units.
- **Notebooks**: markdown docs with runnable command/agent cells.
- **Env & secrets vaults** (per-project/global, redacted in logs).
- **Prompt/skill library** with search; one keystroke to insert/run.
- *DoD:* save a multi-step deploy as a parameterized workflow, run it by name with args.

## V6 — Sessions: persist · resume · branch · share
**Beats:** opencode sharing + Claude Code resume.

- Save/restore conversations, resume by id, **branch** sessions, export md/html,
  opt-in shareable links, session templates. (Extends the GUI session work.)
- *DoD:* resume a 3-day-old session, branch it, share a read-only link.

## V7 — Hooks · headless/CI · SDK · stability → **v1.0**
**Beats:** Claude Code hooks + true scriptability — the first "1.0" you'd trust in CI.

- **Hooks**: pre/post tool, on-stop, on-session (shell + JS).
- **Headless/CI**: `sentinel run "task" --json`, streaming JSON, exit codes.
- **Extension/plugin API**, autoupdate, opt-in telemetry, snapshots.
- Hardening: ≥90% test coverage, <100ms cold start, cross-terminal QA, stable API.
- *DoD:* a CI job runs a Sentinel task headless, a pre-commit hook blocks on a failing
  test, exit codes are correct.

## V8 — Autonomous Agent Mode + multi-agent panels (Warp parity ③ + Kilo orchestrator)
**Beats:** Warp Agent Mode + Kilo boomerang — with GSD as the headline.

- **Parallel autonomous agents** with an agent-management dashboard (GUI): spawn, watch,
  steer, kill; per-agent logs/cost.
- **GSD pipeline** as a first-class autonomous run: plan → implement → test → review →
  fix loop, unattended, checkpointed, self-reviewing.
- **Delegation to Sentinel Prime / Hermes** as a remote worker agent.
- **Voice input** (optional, Warp-style) via the local Omni/whisper stack.
- *DoD:* `/ship` runs a multi-agent pipeline that edits, tests, self-reviews, and reports
  unattended; the dashboard shows all agents live.

## V9 — Deterministic workflow engine (the moat)
**Beats:** nobody does reproducible multi-agent orchestration well.

- **Declarative YAML pipelines**: conditional branching, parallel fan-out/fan-in, retries.
- **Scheduled/cron agents** + **event triggers** (git push → auto-review; new email via
  Composio → triage).
- **Agent-comms protocol** (shared scratchpad / message bus); Composio actions as steps.
- *DoD:* a committed `*.workflow.yaml` reproducibly orchestrates a dozen subagents +
  Composio steps, same result every run.

## V10 — Teams · cloud sync · collaboration · marketplace (Warp parity ④ + ecosystem)
**Beats:** Warp teams + a real ecosystem = lock-in.

- **Cloud-synced** settings/workflows/history/secrets; **shared live sessions**; team
  permissions + SSO.
- **Marketplace** for plugins / skills / agents / MCP servers; team libraries.
- **Remote agents** + optional web companion. The Sentinel Prime stack (Hermes brain +
  Composio) becomes the optional self-hosted **team backend**.
- *DoD:* two users share a live session; a team workflow + MCP server install from the
  marketplace; settings roam across machines.

---

## Sequencing logic

- **V1–V3** = capability core (orchestration, context, resources). V3 lights up your
  Sentinel Prime + Composio investment for every later layer.
- **V4–V5** = the Warp *feel* (blocks/command-search) and Warp *Drive* (workflows).
- **V6–V7** = harden to a CI-trustworthy **v1.0**.
- **V8–V10** = the differentiation: autonomous multi-agent, the deterministic workflow
  **moat**, then teams/marketplace = the **everything-Warp-plus** finish.

## Start here (first PR of V1)

Add the **subagent spawn** API to `core/agent-runner.ts` (isolated context + result
merge) and wire **plan mode** through the existing permissions engine (a `plan` mode that
denies writes until approval). This unblocks V8's autonomous pipelines and reuses
machinery you already shipped.

---

## V11–V20 — the long game (toward a 20-version GA)

After V1–V10 reach feature parity + the workflow moat, V11–V20 deepen each pillar to
production grade:

- **V11 — Semantic repo RAG.** Local embeddings index (via the B60/Ollama gateway, zero
  cloud cost), semantic retrieval feeding the agent, `/index`, incremental re-index on change.
- **V12 — Deep LSP.** Multi-language LSP servers; diagnostics-driven auto-fix loops;
  go-to-def / find-refs / rename exposed as agent tools.
- **V13 — Command blocks + ⌘K palette (deep V4).** Full block rendering (collapsible,
  re-runnable), fuzzy command palette, history search, autosuggestions.
- **V14 — Voice & multimodal.** Voice input (local whisper/Omni), image/screenshot input to
  vision models, paste-image-to-chat.
- **V15 — Plugin/extension SDK + marketplace client.** Install skills/agents/MCP servers
  from a registry; versioned, sandboxed extensions.
- **V16 — Sandboxing & safety.** Sandboxed bash, network egress policy, secret redaction,
  tamper-evident audit log; safe-by-default for autonomous runs.
- **V17 — Observability & cost governance.** Per-session/per-tool metrics, token budgets,
  traces, a `/usage` dashboard; alerts when a run exceeds budget.
- **V18 — Multi-repo / workspaces.** Cross-repo context + retrieval, workspace-scoped
  sessions and workflows for monorepos and multi-service projects.
- **V19 — Team collaboration & cloud sync.** Shared live sessions, cloud-synced
  settings/workflows/history/secrets, team roles + SSO.
- **V20 — GA hardening.** Cross-platform QA, ≥95% coverage, autoupdate, startup/perf
  budgets, a stable public extension API, and a docs site. The 1.0-you'd-bet-the-company-on.

Build cadence: parallel worktree subagents per wave (disjoint modules), then serial
integration + central verification (tsc + full test suite + build) + push.
