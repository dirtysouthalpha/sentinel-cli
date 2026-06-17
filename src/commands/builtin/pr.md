---
name: pr
description: Create a pull request with an AI-generated title and description
agent: gsd
subtask: true
---

Create a pull request for the current branch, titled "$ARGUMENTS" if given.

Steps:
1. Confirm this is a git repository and that the current branch is not the default branch (main/master). If it is, create a descriptively-named feature branch first and switch to it.
2. Run `git log main..HEAD` (or `master..HEAD`) to see the commits included in this PR.
3. Run `git diff main...HEAD` (or `master...HEAD`) to review the full change set.
4. Generate a PR title (imperative, ≤ 72 chars) and a structured description:
   - **Summary** — what this PR does, in 1–2 sentences.
   - **Changes** — bullet list of the key changes.
   - **Motivation** — why this change was made.
   - **Testing** — how it was verified.
5. Detect the remote host (GitHub / GitLab / Bitbucket) and use the correct CLI:
   - GitHub: `gh pr create --title "..." --body "..."`
   - GitLab: `glab mr create --title "..." --description "..."`
   - If no CLI is installed, print the title and body and open the repo's compare URL in the browser.
6. Push the branch to the remote first if it isn't already there.
7. Report the PR/MR URL.

Rules:
- If no remote is configured, say so and stop.
- If the working tree is dirty, commit or stash first (warn the user).
