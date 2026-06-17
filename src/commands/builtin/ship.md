---
name: ship
description: Ship it - build, test, and prepare for release
agent: gsd
subtask: true
---

Ship the project at $ARGUMENTS.

Steps:
1. Run the build command and fix any errors
2. Run all tests and fix any failures
3. Run the linter and fix any issues
4. Verify the output is clean
5. Report what was shipped

If there are no build/test/lint commands configured, detect them from package.json or similar config files.
