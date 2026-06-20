---
name: tdd
description: Run a task in test-driven mode (red-green-refactor). Writes a failing test FIRST, implements until it passes, then reviews. Use for features/bugfixes where test coverage matters.
agent: gsd
---

# TEST-DRIVEN DEVELOPMENT (red-green-refactor)

Task: $ARGUMENTS

Run this task in strict TDD order:
1. **RED**: Write a failing test that describes the desired behavior. Run it. Confirm it FAILS.
2. **GREEN**: Write the minimum implementation code to make the test pass. Run it. Confirm it PASSES.
3. **REFACTOR**: Clean up the code while keeping tests green. Run tests again.

Never write implementation before the test. The test is the spec.
If the test passes on the first run before implementation, the test is wrong — rewrite it.
