---
name: loopstatus
description: Read and pretty-print project_state.md so you can check autonomous-loop progress at a glance, without interrupting the loop. Read-only.
agent: ask
---

# LOOP STATUS

Read project_state.md in the current project. If it does not exist, say so in one line and stop.

If it exists, print a clean, scannable summary — nothing else, no commentary:

- **Goal:** (one line)
- **Phase:** (current phase)
- **Progress:** (percentage + a simple bar, e.g. [######----] 60%)
- **In progress:** (the single active task)
- **Up next:** (the next 3 QUEUE items)
- **Blockers:** (any unresolved items, or "none")
- **Done:** (count of completed tasks, e.g. "12 tasks complete")

Do not modify anything. Read-only. This command exists so progress can be checked without touching the loop.
