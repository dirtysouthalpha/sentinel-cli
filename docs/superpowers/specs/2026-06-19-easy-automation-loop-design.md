# Easy Automation Loop — Design

**Date:** 2026-06-19
**Goal:** Make the automation loop extremely easy: type casually (slash command or `sentinel loop`), get a well-formed autonomous loop that runs until 100% — works on every model, no expert phrasing required.

## Problem

Today `sentinel loop <goal>` has five real blockers (evidence in the friction inventory):
1. It's not actually unattended — runs one capped pass (~50 rounds), exits 3. The docs promise "until 100%".
2. Bare `sentinel loop` errors instead of resuming (goal is a required arg).
3. No headless way to watch progress (`/loopstatus` is TUI-only).
4. Dangerous default: silent yolo permissions, no sandbox, no confirmation.
5. Three near-identical commands (`run`/`loop`/`autopilot`) with no decision aid.

Plus the new requirement: the user wants to **type casually** and have the loop "break it into the proper formatting for a good loop" — and it must work **regardless of model**.

## Design

### 1. `sentinel loop` becomes a true daemon

Merge with the existing `runAutopilotSession` driver (checkpoints, budgets, stall detection, SIGINT-clean resume). Each iteration feeds the resolved automationloop template as the task; the loop re-orients against `project_state.md` every iteration until it reads 100%. One obvious "run until done" command. No new driver code — reuse autopilot's.

**Loop body per iteration:** the automationloop template (`src/commands/builtin/automationloop.md`) already enforces ORIENT→SCAN→PLAN→ACT→AUDIT→REPEAT against `project_state.md`. The driver just re-invokes it each iteration until the state file says 100%.

**Defaults (safe + honest):**
- Sandbox **ON** by default (bash confined to project, like autopilot). `--no-sandbox` opts out.
- Budgets: `--max-minutes 60`, `--max-cost 5` (USD) defaults — stops a runaway loop without surprising the user. Overridable.
- Stall detection: 2 consecutive no-progress iterations → stop and report (inherited from autopilot).

### 2. Casual goal → structured loop (model-independent)

**The crux: a pure `refineGoal(raw)` heuristic function.** No model call. Works on every provider, zero latency, zero cost. Takes casual input and expands it into a well-formed loop goal with an explicit verb, scope, and done-condition.

Pure, fully tested (`tests/refine-goal.test.ts`). Intent detection by keyword:

| Casual input | Refined to |
|---|---|
| `login form validation` | `Implement input validation on the login form. Add field-level validation, error messages, and tests. Done when all login inputs are validated and covered by tests.` |
| `fix the flaky test` | `Fix the flaky test. Reproduce the failure, diagnose the root cause, fix it, and verify the test passes reliably. Done when the test passes 5 consecutive runs.` |
| `refactor api` | `Refactor the API layer. Decompose into small, safe steps. Preserve all existing behavior. Done when lint+test pass and no public signatures changed.` |

Intent templates (`implement`, `fix`, `refactor`, `add`, `improve`, `clean`, `document`, `secure`, `test`) each inject a verb-appropriate done-condition and guardrail. **Fallback:** if no intent matches, wrap the raw goal with a generic structure ("Done when lint+test pass and the change is complete") — never fails, just adds discipline.

The refined goal is what gets substituted into `$ARGUMENTS` of the template. The user sees the refinement in the startup banner so they can sanity-check it before the loop commits to it.

### 3. Frictionless launch — three entry points, all easy

**A. `sentinel loop` bare (interactive):**
- No `project_state.md` → prompt on stdin: "What do you want built? > ". Read the goal, `refineGoal()` it, start the daemon.
- `project_state.md` exists → resume from it (no prompt).
- `sentinel loop <goal>` → `refineGoal(goal)`, start immediately.

**B. `/automationloop` in the TUI/GUI:**
- Already works. Apply `refineGoal()` to the goal before substituting into the template, so casual phrasing in the composer gets the same structuring.

**C. `sentinel loopstatus` (headless peek):**
- New subcommand. Reads `project_state.md` in cwd, prints the scannable summary (goal, phase, progress bar, in-progress, next 3 queued, blockers, done count). Read-only. Works in a second terminal mid-run.

### 4. Clear startup banner

When the daemon starts, print (text mode, model-independent):
```
🔁 Sentinel loop — autonomous until 100%

  goal:    Implement input validation on the login form. ...Done when all
           login inputs are validated and covered by tests.
  state:   ./project_state.md  (gitignore this)
  watch:   sentinel loopstatus   (or: tail -f project_state.md)
  stop:    Ctrl+C — checkpoints cleanly; resume with: sentinel loop
  budget:  60 min · $5 · sandbox ON

  starting… (first iteration orients against project_state.md)
```
If the goal was refined, show both the raw and refined versions. One banner, everything the user needs.

### 5. De-confuse the command surface

Reword `--help` so the three commands are obviously distinct:
- `sentinel loop [goal]` — "Autonomous daemon: refine your goal, run PLAN→ACT→AUDIT→REPEAT until 100%. Sandbox on by default. The easy button."
- `sentinel autopilot <goal>` — "Advanced autonomous driver (same engine as loop) with full budget/stall/verify knobs. For when you need precise control."
- `sentinel run <task>` — "Run one agentic task headlessly (single pass, not a loop)."

Add a one-line "Choosing a command" note under the loop description.

## Components

| Component | File | What |
|---|---|---|
| Goal refiner (pure) | `src/core/refine-goal.ts` | `refineGoal(raw): { raw, refined, intent }`. Heuristic intent detection + template expansion. Zero deps. |
| Refiner tests | `tests/refine-goal.test.ts` | Every intent template + fallback + idempotency (already-refined input passes through). |
| Loop daemon wiring | `src/cli.ts` | `loop` action: optional goal, interactive prompt, `refineGoal()`, delegate to `runAutopilotSession` with the template as task. Banner. Safe defaults. |
| `sentinel loopstatus` | `src/cli.ts` | New subcommand: read+pretty-print `project_state.md`. |
| Banner helper (pure) | `src/core/loop-banner.ts` | `formatLoopBanner({goal, statePath, budget, sandbox})` → the startup banner string. Tested. |
| Template refinement | `src/commands/builtin/automationloop.md` | Unchanged body; the refinement happens before substitution. |
| Docs | `docs/automation-loop.md` | Update to reflect daemon behavior + casual input + safe defaults. |

## What this is NOT

- **Not a model call for goal refinement.** Pure heuristics. If the user wants model-powered goal decomposition, that's the loop *itself* doing its PLAN step — the refiner just gives it a well-structured starting goal so even weak models start in good shape.
- **Not removing `autopilot`.** It stays as the advanced knob-heavy version. `loop` is the friendly default; `autopilot` is the power-user path. Same engine.
- **Not a new driver.** Reuses `runAutopilotSession` verbatim.

## Risks & mitigations

- **Goal refiner misclassifies intent** → the fallback always produces a valid (if generic) structured goal. Worst case: slightly less tailored done-condition. Never breaks.
- **Sandbox on by default surprises a user who needs network** → banner says "sandbox ON"; `--no-sandbox` and `--sandbox-net` are documented in `--help` and the banner.
- **Merge with autopilot changes loop's exit semantics** → loop now exits 0 when 100%, or non-zero on budget/stall (same as autopilot). Documented in banner + `--help`.
