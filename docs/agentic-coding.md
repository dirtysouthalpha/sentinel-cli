# Agentic Coding

Sentinel's agent loop is built to edit real codebases reliably. This document
describes the behaviors that make it robust and the config knobs that control
them. Everything here applies to all three runner surfaces — the TUI, the GUI
server (`serve`), and the headless `sentinel run` / `ask` path.

## The edit tools

Sentinel exposes two editing tools; both share one matcher and the same safety
rules.

- **`file` (action `edit`)** — line-aligned block editing. You locate the target
  with `searchLines` (whole lines), an explicit `lineStart`/`lineEnd` range, or an
  `anchorHash`.
- **`patch`** — find/replace, supports `all: true` for multi-occurrence replace.

Shared guarantees:

- **Line-aligned matching.** A search for `foo();` matches a whole line, never a
  fragment inside `  foo();`.
- **Uniqueness guard.** If the search text matches more than once, the edit is
  **rejected** with a count, rather than silently editing the first copy. Add
  surrounding lines until the match is unique.
- **Whitespace tolerance.** If the exact text isn't found, a fallback matches
  ignoring each line's leading/trailing whitespace (indentation drift, trailing
  spaces, CRLF). Set `strictWhitespace: true` to require an exact match.
- **Match transparency.** A successful edit reports `matchType` (`exact` or
  `tolerant`); tolerant matches add a "verify it landed where you intended" note.

## Reading files safely

The `file` `read` action protects the context window:

- `offset` (1-based line) + `limit` (line count) read a window of a large file.
- An un-windowed read of a file over 2000 lines is capped to the first 2000 with
  a note telling you how to page the rest.
- Any returned slice is capped at 100k characters — this also bounds minified
  single-line files that line-windowing can't.
- Binary files (NUL bytes in the first 8KB) are refused rather than dumped as
  mojibake.

File contents are **never** lossily compressed before reaching the model.

## Self-correction loop

When the agent finishes a turn in which it edited files, it runs a verification
command (default `npx tsc --noEmit --pretty false`) and, if it fails, feeds the
errors back so the agent fixes them before stopping.

- Gated on actual edits — non-editing turns pay nothing.
- Bounded by `maxVerifyRetries` (default 2) so a stubborn error can't loop forever.
- A verification that can't run (or times out after 2 minutes) never blocks the
  agent from finishing.

## Resilience

- **Transient retries.** A model call that fails with a rate-limit / 5xx / network
  error is retried with exponential backoff (default 3 attempts), but only before
  any token has streamed, so output is never duplicated.
- **Stuck detection.** The loop detects both exact-repeat and two-cycle (A,B,A,B)
  tool-call loops and nudges the agent to change approach.

## Context management

- Token totals include the system prompt.
- The compaction budget is sized to the active model's context window (75% of it),
  not a fixed constant.
- When utilization passes 80%, older turns are summarized by the model (preserving
  task, decisions, files changed, and open problems), falling back to a structural
  summary only if the model call fails.

## Search & web

- `search` (grep and glob) skips noise directories — `node_modules`, `.git`,
  `dist`, `build`, `.next`, `coverage`, `.turbo`, `out`.
- Search patterns are passed as data, never interpolated into a shell (no
  injection).
- `web` with `format: text` strips HTML to readable text; requests to
  loopback / private / link-local (cloud-metadata) hosts are blocked.

## Configuration

Relevant `sentinel.json` keys:

```jsonc
{
  "autonomous": {
    "enabled": true,            // gsd agent autonomous mode
    "maxRounds": 50,
    "selfEvaluation": true,
    "stuckDetection": true,
    "verifyOnComplete": true,   // run verification + self-correct on completion
    "maxVerifyRetries": 2,
    "verificationCommands": ["npm run lint"]  // first entry overrides the tsc default
  },
  "headroom": {
    "enabled": true,
    "compressToolOutput": true  // set false to disable tool-output compression
  }
}
```

Self-correction (`verifyOnComplete`) is enabled by default in autonomous mode.
Transient retries are always on (configurable via the runner's `maxRetries`).
