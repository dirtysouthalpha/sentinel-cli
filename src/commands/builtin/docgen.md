---
name: docgen
description: Generate documentation for code
agent: code
subtask: true
---

Generate documentation for $ARGUMENTS.

Steps:
1. Read the target code
2. Analyze public APIs, classes, functions, types
3. Generate:
   - JSDoc/TSDoc comments for functions and classes
   - README section for the module
   - API documentation
   - Usage examples
   - Type documentation

Follow existing documentation patterns in the project.
Keep docs concise but complete. Include examples.
