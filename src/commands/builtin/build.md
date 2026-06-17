---
name: build
description: Build the project
agent: code
subtask: true
---

Build the project in $1 and fix any build errors.

Check @package.json or @tsconfig.json for build configuration.

Focus on:
1. Compilation errors
2. Missing dependencies
3. Configuration issues
