# Changelog — `agentic-hardening` line

This branch hardens the agent core for reliable real-world coding. It descends
from the `R1…` baseline (provider core, permissions, MCP), **not** from the
`origin/main` autopilot line — the two histories are unrelated.

## Reliability & correctness (the bugs that would bite in a trial)

- **Providers — streaming tool calls.** The Anthropic provider listened for
  event types the API never emits, so **tool calls were never captured when
  streaming from Claude** — the agent couldn't use tools. Fixed to the real
  `content_block_start` / `input_json_delta` events. Hardened non-streaming
  parsing against malformed tool calls.
- **Providers — SSE compatibility.** Accept `data:` with or without the spec-
  optional space (openai-compat, anthropic, gemini); process a final event that
  lacks a trailing newline (was dropping the `usage` record → broken cost/budget).
  All four streaming providers now have tests (were zero).
- **Tool output compression** no longer touches `file` reads or small outputs —
  it had been lossily truncating file contents, causing edits against corrupt input.
- **File editor** — line-aligned matching, uniqueness guard (refuses ambiguous
  edits instead of hitting the wrong copy), whitespace-tolerant fallback, and a
  match-type signal. `read` gains offset/limit, an oversized-file cap, a binary
  guard, and a char cap for minified one-liners.
- **Shell-injection** closed in `search` and `@symbol` mentions; `@symbol` and
  several tools were also Unix-only and are now cross-platform (Windows).
- **Resource leaks** — LSP servers and the headless browser are killed on exit.
- **bash / git** — clear timeout & buffer-exceeded messages, 10MB buffers.
- **web** — strips HTML to readable text; SSRF guard (blocks loopback/private/
  metadata hosts).

## Agent loop

- **Self-correction**: verifies (type-check) on completion after edits and feeds
  failures back to fix before stopping (bounded, timeout-safe, `--pretty false`).
- **Transient retry** of model calls (rate-limit/5xx/network) with backoff, only
  before any token streams.
- **LLM context compaction** wired into the loop (was dead code); model-aware
  compaction budget; system prompt counted in token totals.
- Stuck detection now also catches A/B/A/B oscillation.
- Parity: self-correction + compaction wired across TUI, server, and headless CLI.

## Ergonomics & ease of use

- **One source of truth for commands.** Command names + descriptions had drifted
  across four places (the registry, a hardcoded help list, the palette catalog,
  and the inline `/`-autocomplete) — the palette and tab-completion were missing
  ~10 real commands. All now derive from the command registry, so they can't
  drift. `/help <command>` shows usage + aliases; unknown commands suggest the
  closest match ("Did you mean /model?").
- **Command layer refactor.** The 615-line, 38-branch `handleCommand` god-method
  became a thin dispatcher over a tested registry (`src/tui/commands/`); `app.ts`
  dropped from 1818 → ~1100 lines, with first-ever command-dispatch tests.
- **Friendlier failures.** Auth (401/403) names the exact env var to set; 404
  flags a bad model id; 5xx and network errors get plain-language guidance (incl.
  an "is Ollama running?" hint); user-cancellation no longer double-reports.
- **At-a-glance safety.** The status bar now shows the permission mode (amber for
  `yolo`/`plan`). Keybinding hints corrected (Ctrl+K is kill-line, Ctrl+P is the
  palette) and made consistent everywhere.
- **Search** on Windows spawns PowerShell with `-NoProfile` (faster, deterministic).

## Quality

- Tests: **492 passing across 74 files** (from 367/52). Includes a full-stack
  integration test (real SSE parse → agent loop → real file tool → disk).
- `docs/agentic-coding.md` documents the capabilities and config knobs.

## Known gaps (not yet verified)

- **No live model run completed**: the local proxy at `:8080` rejects the
  configured key (`E005 Invalid proxy key`) — a config/auth issue, not code. The
  full pipeline is verified up to the auth boundary.
- **TUI rendering/input** is unverified (no TTY in the build environment). Start a
  trial headless (`run` / `ask`), then graduate to the TUI.
