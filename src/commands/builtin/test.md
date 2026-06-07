---
name: test
description: Run tests and fix failures
agent: code
subtask: true
---

Run all tests in $1 and fix any failures.

Use @package.json to understand the test setup.

Focus on:
1. Test failures
2. Type errors
3. Linting issues
