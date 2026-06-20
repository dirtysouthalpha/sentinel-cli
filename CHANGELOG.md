# Changelog

All notable changes to Sentinel CLI are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/) and this project adheres to
[Semantic Versioning](https://semver.org/).

## [3.1.0] — 2026-06-19

The "everything wired" release. v3.0 shipped 9 pure modules; v3.1 wires every
one of them end-to-end. No more "built but not wired."

### Wiring (9 steps connecting existing pure modules to their surfaces)
- **routing**: `resolveRole` per-phase model routing in GSD (plan→strong, review→smol).
- **team**: `/team` command + `team` tool → `runTeam()` with real `WorktreeManager`.
- **memory**: Top 5 memories auto-injected into the system prompt across sessions.
- **diff**: GUI permission cards show the actual diff (green/red) for file mutations.
- **TDD**: `/tdd` runs TDD_PHASES (test-red before implement); `parseTestRunnerOutput` in the fix gate.
- **budget**: `--max-cost` passes `budgetUSD` into the runner; proactive warnings active.
- **cache**: `executeToolCall` memoizes file:read/search/web across turns with mtime invalidation.
- **fork**: `/fork [turn]` branches a session at a turn index.
- **install**: `sentinel install <type> <id>` validates + installs plugins per-type.

823 tests, lint clean, build green.

---

## [3.0.0] — 2026-06-19

The 10-version roadmap complete. 9 versions (v2.2–v3.0), each a pure-tested
module + thin wiring, shipped with a tag. Every competitive gap from the analysis
("built but not wired") addressed.

- **v2.2** Multi-model routing (`classifyTurn`), **v2.3** PR tool + conflict extraction,
  **v2.4** Persistent memory (`MemoryStore`), **v2.5** Diff-at-approval (`formatApprovalPrompt`),
  **v2.6** TDD mode (`TDD_PHASES` + `parseTestRunnerOutput`), **v2.7** Proactive budgets
  (`budgetThresholds`), **v2.8** Cross-turn cache (`ToolResultCache`), **v2.9** Session
  branching (`forkMessages`), **v3.0** Plugin types (`validatePluginEntry`).

---

## [2.1.0] — 2026-06-19

The "extremely easy automation loop" release. The loop went from a single
capped pass that errored on bare invocation to a true, friendly, set-and-forget
daemon. Type casually; it structures your goal and runs until 100%.

### Automation loop — now the easy button
- **True daemon.** `sentinel loop` now delegates to the same iterate-until-done
  engine as `autopilot` (checkpoints, budgets, stall detection, SIGINT-clean
  resume). No more single-pass-then-exit-3.
- **Casual input → structured goal.** New `refineGoal()` — a pure heuristic (no
  model call, zero latency, works on every provider). Detects intent (fix / add
  / refactor / improve / clean / document / secure / test) and expands casual
  input into a goal with a verb, scope, and done-condition. "login validation"
  becomes "Implement input validation on the login form. ...Done when all inputs
  are validated and covered by tests." 21 tests.
- **Bare `sentinel loop` works.** Goal is now optional. Bare invocation prompts
  interactively ("what do you want built?") on first run, or resumes from
  `project_state.md` if one exists.
- **`sentinel loopstatus`** — new headless subcommand. Reads `project_state.md`
  and prints a scannable dashboard (goal, phase, progress bar, in-progress task,
  next 3 queued, blockers, done count). Works in a second terminal mid-run.
- **Safe defaults + clear banner.** Sandbox ON by default (bash confined to
  project). Budget caps: 60 min / $5 / 10 iters / 2 stalls. Startup banner names
  the refined goal, state path, watch/stop/resume commands, and the budget.
  `formatLoopBanner()` pure helper, 9 tests.
- **`/automationloop` in TUI + GUI** now runs `refineGoal` on the goal before
  substituting into the template (same casual-input structuring).

### Command clarity
- Reworded `run` / `loop` / `autopilot` `--help` so they're obviously distinct:
  `loop` = the easy button (autonomous daemon, safe defaults), `autopilot` =
  advanced same-engine power-user path (full verify/budget/stall knobs),
  `run` = one-shot single pass.

### Stats
- **734 tests** (+30: 21 refineGoal + 9 banner). Lint clean. Engine + GUI build green.

---

## [2.0.1] — 2026-06-18

The "make it POP" visual release. The TUI was flat and static; now it's a
living cyberpunk HUD. Every cyberpunk theme's `effects` object (scanlines /
glow / pulse — previously 100% dead code) is now wired in and renders.

### TUI — neon borders, glow, animation
- **Neon border system** (`src/tui/borders.ts`, pure + tested). `accentBorderFor`,
  `glowText`, `neonDivider`, `pulseDot`, `pulsePrompt` — the decision points
  that pick neon accent vs dim border per the theme's effects flags.
- **Ambient animation tick.** A permanent 480ms heartbeat drives a breathing
  status dot (accent↔dim cycle) and a pulsing `❯` prompt. The UI feels alive
  at rest, not just while processing. Coalesces through `scheduleRender()`.
- **Message cards** now use neon-accent borders on cyberpunk themes (the role
  color is kept for the label: "you" stays cyan, "sentinel" stays lime).
- **Welcome banner** is now the showpiece: neon `neonDivider` frame top +
  bottom with `◆` center marks, glowing version line, accent `▐` left-rail on
  the key-value block.
- **Chrome decoration.** Header bar: glowing session dot + accent breadcrumb
  marks + trailing `╸`. Tab bar: active-tab accent underline + accent
  separators. Status bar: accent separators, leading breathing dot. Input
  border: neon accent on cyberpunk themes.
- **Scanline texture.** `effects.scanlines` gates a `╌` scanline divider after
  each turn and dashed rules between sections — the CRT feel, only on themes
  that ask for it.
- **Markdown glow.** Headings, code-block frames, and HRs glow accent on
  cyberpunk themes; dim tertiary otherwise.

### GUI — animated background
- **Constellation particle field.** Wired the dead `<canvas id="bg-canvas">`
  (declared in HTML, CSS-positioned, but never drawn to). 60 slow-moving
  accent-tinted particles connected by faint proximity lines — recolors with
  the active theme (reads `--accent-rgb`), pauses when the tab is hidden.
- **Pure palette helpers** (`gui/src/background-palette.ts`, tested):
  `hexToRGB`, `readAccentRGB`.

### Non-cyberpunk themes unchanged
Every effect is gated on the per-theme `effects` flags. `light`, `paper`,
`mono`, etc. have no `effects` → `accentBorderFor` returns the dim border →
they look exactly as before. No regression for users who want a clean look.

704 tests, lint clean, engine + GUI build green.

---

## [2.0.0] — 2026-06-18

The "codebase intelligence" release. Closes the four gaps that separated
Sentinel from the 2026 leaders (opencode, Claude Code, Aider): LSP structural
awareness, real model-driven compaction, parallel multi-agent teams with
git-worktree isolation, and first-class vision/multimodal. Plus Ponytail
(lazy-senior-dev discipline) on by default at ultra.

### Codebase Intelligence (new)
- **LSP structural awareness.** New `lsp` tool + `LSPManager` spawn language
  servers per language and give the agent real go-to-definition,
  find-all-references, and diagnostics instead of grep-only navigation.
  Graceful degradation: no server configured → falls back to search, never
  throws. Config: `lsp: { typescript: { command, args } }`.
- **Model-driven compaction.** `compactWithSummarizer` is now wired into the
  live agent loop. On overflow, the model produces a real semantic summary
  (preserving decisions, files touched, outcomes) instead of a lossy concat.
  Falls back to the concat path if the summarizer is absent or fails.
- **Parallel multi-agent teams.** `runTeam` fans N tasks out across isolated
  git worktrees (each on its own branch), runs them concurrently, merges
  branches back sequentially, and cleans up. Merge conflicts are reported, not
  force-resolved. Replaces the v1.2 `team.ts` CRUD stub.
- **Git-worktree isolation.** Pure argv builders + `WorktreeManager` over an
  injectable git runner. Parallel agents can no longer race on a shared tree.

### Vision / Multimodal (new)
- **GUI image paste.** Paste an image into the composer → thumbnail chip
  preview (removable) → sent as a multimodal message. No more "save it and
  @mention the path."
- **TUI image @-mention.** `@shot.png` in the TUI loads the image as an
  attachment; non-image mentions still pass to `expandMentions` as text.
- **`attachmentFromDataUrl` / `extractImageMentions`** — pure helpers backing
  both paths.

### Ponytail (new, default ON at ultra)
- Integrated the [Ponytail](https://github.com/DietrichGebert/ponytail) skill
  suite (MIT, DietrichGebert): lazy-senior-dev discipline with a YAGNI ladder
  (stdlib → native → existing dep → one line → minimum). Five builtin skills:
  `ponytail`, `ponytail-review`, `ponytail-audit`, `ponytail-debt`,
  `ponytail-help`.
- **On by default at "ultra"** in the system prompt — the YAGNI ladder governs
  every response. Override in config: `{ "ponytail": { "enabled": false } }`
  or `{ "level": "lite" }`.

### Autonomy
- Agent authors reusable skills via `create_skill` when it hits a repeatable
  sub-task no tool covers.
- `open_url` launches the user's REAL browser for OAuth/login flows.
- Failed tool calls now nudge the agent to research the error (web/search)
  instead of getting stuck.
- Subagent delegation to named specialist agents (orchestrator pattern).
- Parallel tool dispatch within a round (order-preserving).

### Security
- **Cross-platform keyring** (libsecret/Keychain/DPAPI/encrypted-file) with
  env-first secret resolution; legacy plaintext keys scrubbed.
- **Bubblewrap sandbox** for bash on Linux, default-on for autopilot.
- Redaction of secrets from tool output at the trust boundary.
- Browser tool: SSRF guard, screenshot path containment, wrong-page fix.
- WS origin allow-list; atomic config writes; `git config` restricted to
  read-only forms; headless `sentinel run` defaults to gated (not yolo).

### TUI
- Word-motion + kill-line editing keys (Ctrl+A/E/W/U/K, Meta+B/F/D).
- In-conversation search (Ctrl+F), `?` cheatsheet overlay, `/out` full output.
- Markdown rendering: headings, tables, task-lists, lists, blockquotes, hr.
- `/clear` now wipes conversation context, not just the render buffer.
- 20 themes including 5 new cyberpunk×tron themes (vaporwave, synthwave,
  outrun, glitch, hologram).
- Body memoization skips redundant chat re-tokenization.

### GUI
- Incremental `renderChat` (diffBlocks) + stick-to-bottom scroll gate — no
  more full-rebuild flicker.
- Message edit + regenerate; `@`-mention file autocomplete.
- Full theme-palette propagation via CSS variables (no more 16→5 collapse).
- GFM tables, task-list checkboxes, strikethrough.
- Global keymap + cheatsheet + in-chat find.
- First-run onboarding wizard.
- App-window mode (`sentinel gui --window` / `sentinelwindow`).
- Expandable tool cards; real `file:write` diffs.

### Onboarding
- Shared first-run state machine + provider catalog.
- GUI wizard + TUI first-run guide + friendly headless provider help.

### Production
- CI workflow: lint + test + build on push/PR.
- `puppeteer` made optional (dynamic import); bundle 13.9MB → 390KB.

### Tests
- **682 tests** across 90 files (up from ~613 in v1.2). Every new capability
  follows the pure-helper-first pattern: a tested pure module, then a thin
  binding.

---

## [1.2.0] — 2026-06-17

Baseline hardening release: security (keyring, sandbox, redaction, SSRF,
atomic writes, WS origin), TUI/GUI UX overhaul (20 themes, markdown rendering,
search, cheatsheet, incremental render, edit/regenerate, @-mention,
onboarding), autonomy (create_skill, open_url, error→research nudge,
subagent specialists, parallel tool dispatch), and the compaction-strategy
module (cohesive units + summarize seam).
