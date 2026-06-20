# Sentinel CLI — Feature Wave State

## GOAL
Add 8 missing features to match Claude Code / opencode parity.

## PHASE
COMPLETE — all 8 features delivered

## COMPLETED
- [x] F1 — GUI command palette (Ctrl+K): already implemented from earlier work. Wired to global keymap + ⌘K button.
- [x] F2 — TUI syntax highlighting: src/tui/syntax-highlight.ts tokenizer (ts/js/py/bash/json). render-markdown.ts uses it for code blocks. Keyword/string/comment/number/function colors.
- [x] F3 — File tree viewer: src/core/tree-builder.ts (buildTree/formatTree/parseGitignore, 11 tests) + src/tools/tree.ts tool. Registered.
- [x] F4 — GUI diff accept/reject: computeDiff() now shows ✓ Accept / ✗ Reject buttons on file/patch edits. Reject triggers /undo (checkpoint restore).
- [x] F5 — Live token/cost counter: already wired — GUI handles usage events → renderRight(); TUI handles usage → updateCost().
- [x] F6 — MCP browser: `sentinel mcp browse` lists popular servers with install instructions.
- [x] F7 — Completion bell: terminal bell on GSD completion + loop completion.
- [x] F8 — Session export: sessionToMarkdown pure helper (4 tests) + exportSessionMarkdown/Html aliases + /export command.

## IN PROGRESS
(none)

## QUEUE
(none)

## BLOCKERS
(none)

## OVERALL PROGRESS
100% complete

## STATUS: GOAL ACHIEVED
836 tests, lint clean, engine + GUI build green.
