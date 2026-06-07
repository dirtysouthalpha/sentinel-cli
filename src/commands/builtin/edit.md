---
name: edit
description: Hash-anchored file edit
agent: code
subtask: true
---

Edit $1 using hash-anchored edits. Provide the exact lines to replace or use an anchor hash.

Usage:
- /edit <file> line:start-end hash:<hash> "new content"
- /edit <file> search:"old text" "new content"
- /edit <file> anchor:<hash> "new content"

Examples:
- /edit src/app.ts line:10-20 hash:abc123 "const newCode = 'hello';"
- /edit src/app.ts search:"function old()" "function new()"