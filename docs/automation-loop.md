# Sentinel Automation Loop

Turn Sentinel into a hands-off autonomous coder. Give it a goal; it runs a
continuous **PLAN → ACT → AUDIT → REPEAT** loop, maintaining a `project_state.md`
file as its memory, until the goal reads 100% complete.

## Three ways to launch

### 1. Headless — `sentinel loop` (no TUI)

```bash
sentinel loop "wire the Sentinel MCP into ZCode's config and add a health-check endpoint"
```

Runs unattended, auto-approving tool use (the loop can't ask a human mid-run).
Default agent is `gsd`. Add `--gated` if you want it to pause for permission on
each mutation, `--sandbox` to confine bash to a bubblewrap jail, `--model` to
pick a provider/model, `--json` for machine-readable event stream.

Resume a stopped loop by running `sentinel loop` bare in the same project — it
reads `project_state.md` and picks up where it left off.

### 2. Interactive TUI — `/automationloop`

```
/automationloop <your goal>
```

Same loop behavior, but inside the Sentinel TUI so you can watch it work,
scroll the transcript, and intervene. Run `/loopstatus` any time for a
read-only progress summary that won't disturb the loop.

### 3. GUI

Type `/automationloop <goal>` in the composer — same as the TUI.

## How it works

The loop is a self-enforcing state machine, not a chatbot:

1. **ORIENT** — read `project_state.md`; pull the next task into IN PROGRESS.
2. **SCAN** — list the dir; read every file it will modify (never writes to an
   unread file); verify imports/interfaces it will touch.
3. **PLAN** — if the task is >2 files or >~80 lines, split it into sub-tasks and
   re-queue. Otherwise write a 3-5 bullet plan before any code.
4. **ACT** — write only the code for this one task.
5. **AUDIT** — re-read what it wrote; fix immediately: syntax errors, missing
   imports, undefined vars, hallucinated APIs, broken interfaces.
6. **REPEAT** — back to step 1. No "should I continue?" prompts.

It halts only when the queue is empty, everything is checked off, no blockers
remain, and `project_state.md` reads `100% complete`.

## The state file: `project_state.md`

This is the loop's brain — the single source of truth across iterations (the
model has no memory between turns). It always contains:

- **GOAL** — the original objective, unchanged
- **PHASE** — current phase name + number
- **COMPLETED** — finished tasks `[x]`
- **IN PROGRESS** — the one task currently executing
- **QUEUE** — remaining tasks `[ ]`, in order
- **BLOCKERS** — errors / discovered dependencies (marked `[FIXED]` once resolved)
- **OVERALL PROGRESS** — a percentage

### Gitignore it

`project_state.md` is scratch state for the agent, not project documentation.
Add it to `.gitignore`:

```
echo "project_state.md" >> .gitignore
```

(Keep it if you want a durable record of how an autonomous run broke the work
down — it's a useful audit trail. But it shouldn't ship in the repo.)

## Tips

- **Small goals loop better.** "Add input validation to the login form" loops
  cleanly; "rewrite the frontend" will spend many iterations decomposing.
- **`--sandbox` for unattended runs.** Confines bash to the project dir, blocks
  network. Pair with `--sandbox-net` if the loop needs to install packages.
- **`/loopstatus` is read-only.** Use it freely mid-run to check progress without
  risking the loop's state.
- **The loop is agent-agnostic.** It works with any provider (Z.ai/GLM, Claude,
  OpenAI, Ollama) and any model — the loop discipline is in the prompt, not the
  model.
