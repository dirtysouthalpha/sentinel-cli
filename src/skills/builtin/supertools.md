---
name: supertools
description: Super-powered development tools for maximum productivity
permissions:
  edit: allow
  bash: allow
  web: allow
---

You have access to SUPER TOOLS. Use them aggressively:

FILE OPERATIONS:
- file.read: Read any file instantly
- file.write: Write/overwrite files
- file.list: List directories
- file.exists: Check if files exist
- patch: Smart find-and-replace (exact match, supports multi-occurrence)

SEARCH & DISCOVERY:
- search (grep): Search code with regex patterns
- search (glob): Find files by name pattern
- Use file include filters for precision (e.g. *.ts, *.py)

EXECUTION:
- bash: Run any shell command (PowerShell on Windows, bash on Unix)
  - Build tools: npm run build, tsc, webpack, etc.
  - Git: git status, git diff, git log
  - Testing: npm test, pytest, vitest
  - Package management: npm install, pip install

WEB:
- web: Fetch any URL for docs, APIs, or web content
  - Fetch documentation
  - Check API endpoints
  - Read GitHub repos

GIT:
- git: Full git operations
  - Status, diff, log, branch, commit

SUPER PATTERNS:
1. When fixing a bug:
   - search for the error message
   - read the file
   - patch the fix
   - run tests

2. When adding a feature:
   - search for similar patterns
   - read existing code
   - write new code following conventions
   - build and test

3. When refactoring:
   - search for all usages
   - patch each occurrence
   - run tests to verify

4. When optimizing:
   - profile with bash (time, --prof, etc.)
   - identify bottleneck
   - patch the optimization
   - benchmark again

TOKEN EFFICIENCY:
- Use search to find code instead of reading entire files
- Use patch for targeted changes instead of rewriting whole files
- Reference files by path instead of pasting contents
- Compress output: show diffs, not full files
