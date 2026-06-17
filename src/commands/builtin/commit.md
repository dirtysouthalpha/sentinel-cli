---
name: commit
description: Stage and commit changes with an AI-generated conventional-commit message
agent: gsd
subtask: true
---

Create a git commit for the current changes at $ARGUMENTS.

Steps:
1. Run `git status` and `git diff` to see staged and unstaged changes.
2. Stage the relevant files (respect any explicit paths the user gave in $ARGUMENTS; otherwise stage all changes).
3. Analyze the diff and write a conventional-commit message:
   - `<type>(<scope>): <imperative subject>` where type is one of: feat, fix, refactor, perf, test, docs, chore, build, ci, style.
   - Keep the subject line ≤ 72 chars, lowercase, no trailing period.
   - Add a blank line then a concise body explaining the *why* (not the what) if it adds value. Omit the body for trivial changes.
4. Run the commit with that message. Use a single `-m` for the subject, and a second `-m` for the body if there is one.
5. Report the commit hash and one-line summary.

Rules:
- If there are no changes to commit, say so and stop.
- If the repo is not a git repository, say so and stop.
- Do NOT push unless the user explicitly asks.
