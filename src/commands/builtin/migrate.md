---
name: migrate
description: Migrate code from one framework/library/version to another
agent: code
subtask: true
---

Migrate $1 from $2 to $3.

Steps:
1. Identify all code that needs migration
2. Check the migration guide for breaking changes
3. Update imports and dependencies
4. Refactor code to match new API
5. Update configuration files
6. Run tests to verify
7. Fix any issues

Common migrations:
- React class -> hooks
- JavaScript -> TypeScript
- Express -> Fastify
- REST -> GraphQL
- CommonJS -> ESM
