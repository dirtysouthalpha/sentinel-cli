# Autopilot — set-and-forget runbook

Point Sentinel at Claude (via your OAuth router, **keyless**), give it a goal, and
walk away. Autopilot loops the GSD cycle — plan → implement → test → review → fix —
and keeps going until the project is **production-ready**, gating every iteration
on real checks *and* a strict model verdict. It checkpoints, commits each step,
respects a cost/time budget, recovers from context overflow without a restart, and
resumes after a crash.

---

## 1. One-time setup

**Connect Claude through your OAuth router** (no API key needed):

```bash
# Start the router (anthropic-oauth-router repo), leave it running:
python cli.py serve
python cli.py authenticate          # opens browser; log in with Claude

# Then point Sentinel at it (writes ~/.config/sentinel/config.json):
sentinel connect claude             # or:  sentinel connect claude --url http://127.0.0.1:8080/v1/anthropic
```

`sentinel connect` configures the `anthropic` provider keyless, switches the model
to Claude, and probes the router (telling you if it isn't up yet). Inside the TUI
you can run `/connect claude` instead.

---

## 2. Run it

**Headless (the real set-and-forget — background it or cron it):**

```bash
sentinel autopilot "make the CLI feature-complete with tests, docs, and a clean build"
```

**Inside the TUI:**

```
/autopilot make X production-ready
```

`/auto` is a shorthand alias. Press **Ctrl+C** any time to stop after the current
step (it stops cleanly and leaves a resumable checkpoint).

---

## 3. Bounds (so it can never run forever)

Autopilot stops at the **first** of these:

| Bound | CLI flag | Config key | Default |
|------|----------|------------|---------|
| Iterations | `--max-iterations N` | `autopilot.maxIterations` | 10 |
| No-progress streak | `--max-stalls N` | `autopilot.maxStalls` | 2 |
| Wall-clock minutes | `--max-minutes N` | `autopilot.maxMinutes` | — (off) |
| Estimated spend (USD) | `--max-cost N` | `autopilot.maxCostUSD` | — (off) |
| Production-ready | — | — | stops with success |

Example — grind for at most 2 hours or $5, whichever first:

```bash
sentinel autopilot "ship the v2 dashboard" --max-minutes 120 --max-cost 5 --max-iterations 20
```

Set defaults in `sentinel.json` (project) or `~/.config/sentinel/config.json` (global):

```json
{
  "autopilot": {
    "maxIterations": 20,
    "maxStalls": 3,
    "maxMinutes": 180,
    "maxCostUSD": 10,
    "verifyCommands": ["npm run lint", "npm test", "npm run build"]
  }
}
```

`verifyCommands` is the **deterministic gate**. Omit it and autopilot auto-detects
`lint`/`test`/`build` from your `package.json`. A run is only "production-ready"
when **every** verify command exits 0 *and* the model gate agrees nothing remains.

---

## 4. Crash? Resume.

After each iteration autopilot writes `.sentinel/autopilot.json` (the goal, evolving
to-do list, and history). If the machine reboots or it gets killed:

```bash
sentinel autopilot "<the same goal>" --resume
```

It picks up exactly where it left off — iteration count and stall counter intact.
In the TUI, `/autopilot` with the same goal auto-resumes. The checkpoint is deleted
once the project reaches production-ready.

---

## 5. What you get back

- **Atomic git history** — each changed iteration is its own commit
  (`autopilot[3] added retry logic…`), so you can `git log`, diff, or revert any
  single step.
- **Never wedges** — if the context gets too long, the agent auto-compresses and
  retries instead of erroring out. You never have to relaunch.
- **A clear verdict** at the end:

| Exit | Status | Meaning |
|-----:|--------|---------|
| 0 | `production_ready` | Checks pass and the goal is delivered. |
| 3 | `max_iterations` / `budget_exhausted` | Ran out of iterations or hit the cost/time ceiling — `--resume` to continue. |
| 4 | `stalled` | Stopped making changes; see the remaining items it printed. |
| 130 | `aborted` | You pressed Ctrl+C. |

---

## 6. Tips

- **Write a sharp goal.** "make X production-ready with tests and docs" beats "fix
  stuff." The model gate holds it to whatever "production-ready" means for your goal.
- **Start small.** `--max-iterations 3` for a first run to watch its behavior, then
  raise the bounds once you trust it.
- **Keep the verify gate honest.** If your `npm test`/`build` are reliable, the
  deterministic gate does most of the work and the model can't declare victory early.
- **Run it on a branch** if you want the per-iteration commits isolated from `main`.
