---
name: team
description: Run multiple independent tasks in PARALLEL across isolated git worktrees. Pass branches+prompts as arguments.
agent: gsd
---

# PARALLEL TEAM EXECUTION

You are coordinating a team of parallel subagents, each working in an isolated git worktree on its own branch.

$ARGUMENTS

## How it works
1. Parse the arguments into a list of independent tasks (branch name + prompt each).
2. Use the `team` tool with a JSON array of tasks: `[{"branch":"fix-a","prompt":"fix test A"},{"branch":"fix-b","prompt":"fix test B"}]`.
3. The team tool creates a worktree per task, runs each in parallel, merges results back sequentially.
4. Merge conflicts are REPORTED, not force-resolved — surface them to the user.

## Rules
- Tasks must be INDEPENDENT (no shared file edits, or conflicts will result).
- Each branch name should be kebab-case and descriptive.
- Small tasks work best (1-3 files each).
- After the team run, review the merged results and run tests to verify.
