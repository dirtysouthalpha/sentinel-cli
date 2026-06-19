# Sentinel Automation Loop

Turn Sentinel into a hands-off autonomous coder. Give it a goal — casually,
in plain words — and it runs a continuous **PLAN → ACT → AUDIT → REPEAT** loop,
maintaining a `project_state.md` file as its memory, until the goal is 100%
complete. Works on every model (Z.ai/GLM, Claude, OpenAI, Ollama) — the goal
structuring is pure heuristics, no model call required.

## The easy button

```bash
sentinel loop "fix the flaky login test"
```

That's it. Casual input is fine — `sentinel loop` refines your phrasing into a
structured goal with a verb, scope, and done-condition before the loop starts:

```
🔁 Sentinel loop — autonomous until 100%

  goal:     Fix the flaky login test. Reproduce the issue, diagnose the root
            cause, and fix it. Done when the original failure no longer occurs
            and no existing tests break.
  state:    ./project_state.md  (gitignore this)
  watch:    sentinel loopstatus   (or: tail -f project_state.md)
  stop:     Ctrl+C — checkpoints cleanly; resume with: sentinel loop
  budget:   60 min · $5 · sandbox ON
```

## Three ways to launch

### 1. `sentinel loop` — the easy button (headless daemon)

```bash
sentinel loop "add input validation to every route"     # start with a goal
sentinel loop                                            # bare → prompts for a goal, or resumes
```

- **Goal is optional.** Bare `sentinel loop` prompts interactively ("what do you
  want built?") on first run, and **resumes** from `project_state.md` if one exists.
- **Casual input is refined.** "login validation" becomes "Implement input
  validation on the login form. ... Done when all inputs are validated and
  covered by tests." — so even weak models start in good shape.
- **True daemon.** It keeps iterating (ORIENT→SCAN→PLAN→ACT→AUDIT→REPEAT against
  `project_state.md`) until the goal reads 100%, the budget is spent, or it stalls.
- **Safe defaults.** Sandbox ON (bash confined to project), 60-min / $5 budget
  caps, stall detection (2 no-progress iterations → stop). All overridable.

### 2. `sentinel loopstatus` — check progress (headless, read-only)

```bash
sentinel loopstatus
```

Reads `project_state.md` in the current directory and prints a scannable
dashboard — works in a second terminal while the loop runs:

```
  Goal:        Fix the flaky login test
  Phase:       Phase 2: Reproduce the failure
  Progress:    [███░░░░░░░] 30%
  In progress: Write a reproduction script
  Up next:     • Add a mutex around the shared state  • Run the test 5 times
  Blockers:    none
  Done:        2 tasks complete
```

### 3. `/automationloop` — interactive (TUI or GUI)

```
/automationloop <your goal>
```

Same loop, same goal refinement, but inside the Sentinel TUI/GUI so you can
watch it work, scroll the transcript, and intervene. `/loopstatus` for the
read-only peek.

## How it works

Each iteration of the daemon:

1. **ORIENT** — read `project_state.md`; pull the next task into IN PROGRESS.
2. **SCAN** — list the dir; read every file it will modify (never writes to an
   unread file); verify imports/interfaces it will touch.
3. **PLAN** — if the task is >2 files or >~80 lines, split it into sub-tasks and
   re-queue. Otherwise write a 3-5 bullet plan before any code.
4. **ACT** — write only the code for this one task.
5. **AUDIT** — re-read what it wrote; fix immediately: syntax errors, missing
   imports, undefined vars, hallucinated APIs, broken interfaces.
6. **REPEAT** — back to step 1. No "should I continue?" prompts.

It halts when the queue is empty, everything is checked off, no blockers remain,
and `project_state.md` reads `100% complete`.

## Goal refinement (model-independent)

`refineGoal()` is a pure heuristic — no model call, zero latency, works on every
provider. It detects intent by keyword and expands casual input:

| You type | Refined goal |
|---|---|
| `fix the flaky test` | Fix the flaky test. Reproduce, diagnose, fix. Done when the failure no longer occurs and no existing tests break. |
| `add a health check` | Add a health check. Decompose into small, safe steps. Done when complete, lint+test pass, covered by tests. |
| `refactor the api` | Refactor the api. Preserve all existing behavior — no public signatures change. Done when lint+test pass and the code is simpler. |
| `login validation` | Work on: login validation. Decompose into small, safe steps. Done when lint+test pass and the change is complete. |

Intents: `fix`, `implement`, `add`, `refactor`, `improve`, `clean`, `document`,
`secure`, `test`. No match → generic structure with a default done-condition.
Never fails — always produces a usable goal.

## The state file: `project_state.md`

The loop's brain — the single source of truth across iterations. It always
contains: **GOAL**, **PHASE**, **COMPLETED** `[x]`, **IN PROGRESS** (one task),
**QUEUE** `[ ]`, **BLOCKERS**, **OVERALL PROGRESS** (%).

### Gitignore it

`project_state.md` is scratch state, not project docs:

```bash
echo "project_state.md" >> .gitignore
```

## Choosing a command

| Command | When to use |
|---|---|
| `sentinel loop [goal]` | **The easy button.** Autonomous daemon until 100%. Safe defaults. Start here. |
| `sentinel autopilot <goal>` | Advanced — same engine, full control over verify gates, budgets, stall detection. Power-user path. |
| `sentinel run <task>` | One single task (not a loop). Single pass, then exits. |

## Tips

- **Small goals loop better.** "Add input validation to the login form" loops
  cleanly; "rewrite the frontend" will spend iterations decomposing.
- **Bare `sentinel loop` resumes.** Ctrl+C checkpoints cleanly; re-run bare to
  pick up exactly where it stopped.
- **`--no-sandbox`** if the loop needs to reach outside the project dir; **`--sandbox-net`** if it needs to install packages or fetch URLs.
- **Budget knobs:** `--max-minutes`, `--max-cost`, `--max-iterations`, `--max-stalls`.
- **`sentinel loopstatus` is read-only** — use it freely mid-run.
