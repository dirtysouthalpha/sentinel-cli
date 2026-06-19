# Sentinel CLI — Autonomous Loop State

## GOAL
Improve the TUI and GUI, optimize the code and tighten it up. Audit for security issues and fix everything found. Measure before and after. Done when improvement is demonstrable and lint+test pass.

## BASELINE (measured)
- **Lint**: PASS (exit 0, clean)
- **Tests**: 729 passed / 7 failed / 736 total — 94 files (91 passed / 3 failed)
- **Failures** (all env-dependent, NOT code bugs):
  - `tests/bash-sandbox.test.ts` x2 (needs bwrap namespace perms)
  - `tests/sandbox-live.test.ts` x3 (needs bwrap namespace perms)
  - `tests/browser.test.ts` x1 (needs puppeteer/chrome)
  - `1 more` (env)
- **LOC**: src 21,631 / gui 1,791 — biggest files: `src/tui/app.ts` (2,496), `src/cli.ts` (1,007), `gui/src/main.ts` (57,244 bytes), `src/server/serve.ts` (697)

## PHASE
AUDIT (security scan first, then code quality, then TUI/GUI polish)

## COMPLETED
- [x] O1 — Established baseline: lint pass, 729/736 tests (7 env failures cataloged)

## IN PROGRESS
- A1 — Security audit: scan all source for command injection, path traversal, prototype pollution, unsafe eval, hardcoded secrets, regex DoS

## QUEUE
- [ ] A2 — Fix every security issue found in A1
- [ ] Q1 — Code tightening: dedupe, remove dead code, simplify hotspots (app.ts, cli.ts, main.ts)
- [ ] Q2 — TUI improvements (borders, rendering, input handling)
- [ ] Q3 — GUI improvements (main.ts, style.css)
- [ ] V1 — Verify: lint + tests must pass, compare before/after metrics

## BLOCKERS
(none)

## OVERALL PROGRESS
5%
