# Sentinel CLI — Autonomous Loop State

## GOAL
Deliver the 10-version roadmap in docs/roadmaps/2026-06-19-v2.2-to-v3.0-ten-versions.md, one version at a time, in order (v2.2 through v3.0). Each version: pure-helper-first TDD, lint+test+build green, version bump, commit, tag, push. Done when all versions shipped, tagged, pushed, and the roadmap reads 100% complete.

## PHASE
COMPLETE — all 9 versions delivered (v2.2.0 through v3.0.0)

## COMPLETED
- [x] v2.2.0 — Multi-model routing: classifyTurn() pure helper (10 tests) + wire small_model/roles into RoutedProvider + DEFAULT_CONFIG seeds router.rules/roles. Tag v2.2.0 pushed.
- [x] v2.3.0 — First-class GitHub PR tool: pure argv builders + conflict extraction (12 tests) + pr tool registered (create/list/view/merge/conflicts) with gh auth check. Tag v2.3.0 pushed.
- [x] v2.4.0 — Persistent memory: pure CRUD memory-store (12 tests) + memory tool (store/recall/list/delete) persisting to .sentinel/memory.json. Tag v2.4.0 pushed.
- [x] v2.5.0 — Diff-at-approval gate: pure formatApprovalPrompt (5 tests) + PermissionRequest.proposedContent + TUI askPermission shows real diff. Tag v2.5.0 pushed.
- [x] v2.6.0 — Real TDD mode: pure parseTestRunnerOutput (8 tests) + TDD_PHASES [plan,test-red,implement,test-green,review,fix] + sentinel run --tdd. Tag v2.6.0 pushed.
- [x] v2.7.0 — Proactive budgets: pure budgetThresholds (10 tests) + AgentRunnerConfig.budgetUSD + warns at 50/80%, aborts at 100%. Tag v2.7.0 pushed.
- [x] v2.8.0 — Cross-turn cache: pure ToolResultCache + shouldCache (12 tests) with mtime invalidation + TTL. Tag v2.8.0 pushed.
- [x] v2.9.0 — Session branching: pure forkMessages (7 tests) + SessionManager.forkSession(id, turnIndex). Tag v2.9.0 pushed.
- [x] v3.0.0 — Plugin extensibility: pure validatePluginEntry + PluginType skill|mcp|tool|theme|hook (11 tests) + marketplace widened. Tag v3.0.0 pushed.

## IN PROGRESS
(none — all versions complete)

## QUEUE
(none — all versions complete)

## BLOCKERS
(none)

## OVERALL PROGRESS
100% complete

## STATUS: GOAL ACHIEVED
All 9 versions (v2.2.0 through v3.0.0) shipped, tagged, pushed to origin/main.
823 tests passing, lint clean, build green. GitHub Release v3.0.0 published.
Downloads copy refreshed at 3.0.0.
