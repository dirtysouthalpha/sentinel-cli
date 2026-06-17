---
name: branch
description: Create and switch to a new git branch named from $ARGUMENTS
agent: gsd
subtask: true
---

Manage git branches. Argument: $ARGUMENTS (a branch name or action).

If $ARGUMENTS is a name, create and switch to a new branch:
- Use a kebab-case name derived from the argument (lowercase, words joined by `-`).
- Prefix with a conventional type if the intent is clear: `feat/`, `fix/`, `refactor/`, `docs/`, `chore/` (e.g. `/branch fix login bug` → `fix/login-bug`).
- Base the new branch on the current default branch if practical.
- Create with `git checkout -b <name>` (or `git switch -c`).

If $ARGUMENTS is empty, list the branches (mark the current one) and stop.

If $ARGUMENTS starts with `list`, run `git branch -a` and stop.
If $ARGUMENTS starts with `delete ` followed by a name, delete that branch with `git branch -d` and report the result.

Steps:
1. Verify this is a git repository.
2. If creating: check for an existing branch with that name; if it exists, switch to it instead of erroring.
3. Run the appropriate git command.
4. Report the final state (`git branch --show-current`).

Rules:
- Never force-delete or force-push.
- Never operate on main/master directly.
