---
name: diff
description: Show a git diff and explain the changes in plain language
agent: gsd
subtask: true
---

Show and explain git changes. Argument: $ARGUMENTS (optional target).

Steps:
1. Determine what to diff:
   - If $ARGUMENTS is empty: `git diff` (unstaged) plus `git diff --staged`.
   - If $ARGUMENTS is `staged` or `cached`: `git diff --staged`.
   - If $ARGUMENTS is a file or path: `git diff -- <path>`.
   - If $ARGUMENTS is a commit-ish, ref, or range like `HEAD~3..HEAD`: `git diff <args>`.
   - If $ARGUMENTS is `main`/`master`: `git diff <default>...HEAD`.
2. Run the diff.
3. If the output is empty, say "No changes." and stop.
4. Summarize the changes in plain language:
   - A one-line overview of what changed and why.
   - A bullet list of the notable hunks (files changed, additions/deletions).
5. Keep the summary concise. Show the raw diff only if the user asks for it or the changes are small.

Rules:
- Do not modify any files.
- Cap raw diff output shown inline at ~4000 chars; summarize beyond that.
