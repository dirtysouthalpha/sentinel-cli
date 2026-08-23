# Changelog — 1.0.0 (V7: hooks · headless/CI · stable exit codes)

The first release you'd trust in CI. Everything below is live-verified
against a real provider (`zai/glm-4.6`): a piped `-p` task really edited a
file on disk and streamed valid NDJSON, and every exit code below was
exercised end-to-end.

## Headless / non-interactive (V7)

- **`sentinel -p [prompt]` / `--print`** — one-shot non-interactive agentic
  run. Takes the prompt as an argument or reads a task piped on stdin
  (`echo "fix the tests" | sentinel -p`); works without a TTY. Composes with
  `--model`, `--agent`, `--output-format`.
- **`--output-format text|json|stream-json`** on both `run` and `-p`
  (`json`/`stream-json` ≡ the existing `--json` NDJSON stream).
- **Stable, documented exit codes** — now a semver-frozen public contract,
  pinned by test and printed in `sentinel run --help`:
  `0` success · `1` agent error (incl. stuck / budget exceeded) ·
  `2` config error (unknown provider, missing key) · `3` max rounds ·
  `4` blocked by a hook · `130` SIGINT. `stuck`/`budget_exceeded` now fail
  loudly (previously mapped to the generic `1` alongside everything else);
  `task_complete` now succeeds (previously `1`).
- **`runHeadless` SDK export** — the whole headless path (permissions →
  checkpoints → MCP → subagents → todos → hooks → agent loop) is extracted
  from the inline CLI action into `src/core/headless.ts` and exported from
  the package entry, so CI scripts can run it in-process with injectable
  I/O seams.
- `ask` now exits non-zero on failure (401/403 → `2`, everything else → `1`).

## Hooks (V7 completion)

- **Blocking hooks** (`blocking: true`): a failing `preToolUse` gate now
  DENIES that tool call — the tool never runs and the agent receives a
  "blocked by hook" error it can react to. A failing `onStop` gate escalates
  the run's exit code to `4`. Non-blocking hooks remain purely observational
  (failures swallowed), so existing configs behave identically.
- **JS script hooks** (`script: "./gate.mjs"`) — ESM module whose default
  export receives a structured payload (`event`, `toolName`, `toolArgs`,
  `stopReason`, `exitCode`) and may return `{ block: true, reason }`.
- **`onStop`** hooks fire after a run with `SENTINEL_STOP_REASON` /
  `SENTINEL_EXIT_CODE` in env; **`sessionStart`/`sessionEnd`** shell hooks
  fire once per process (`sessionEnd` sees the final exit code).
- Env vars on every shell hook: `SENTINEL_HOOK_EVENT`, `SENTINEL_TOOL_NAME`,
  `SENTINEL_TOOL_ARGS`, plus the above per event.

## Fixes found on the way

- **`getConfigManager` cross-project bug** — a process-global singleton meant
  the first project's config was silently returned for every other
  `projectRoot`. Now keyed per root (matters for the SDK path and tests).
- **Three lint errors** that kept `eslint .` red: NUL-byte binary guard and
  ANSI-strip regexes (intentional control chars — now scoped disables) and an
  empty catch in `connect.ts`.
- **Version drift**: `src/server/serve.ts` still said `0.3.0` and `cli.ts`
  hard-coded `0.4.0`. Both now import the single `core/version.ts` constant
  (`1.0.0`, kept in sync with package.json).

## Roadmap position

ROADMAP-V2 V1–V6 were already shipped (subagents/plan/todos/background,
  LSP + compaction + @-mentions, MCP marketplace/Prime/Composio, palette +
  command search, workflows, sessions). V7 is now complete enough to call
  1.0: hooks, headless `--json`/`-p`, SDK export, stable exit codes, and the
  agentic-hardening test line. V8–V10 (autonomous Agent Mode, deterministic
  workflow engine, teams/cloud) are explicitly post-1.0.

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

## Verified live

- **End-to-end model run confirmed** on `zai/glm-4.6`: `ask` returns a correct
  response, and `run` drives the full agentic loop — real `file` tool call →
  result fed back → correct multi-step answer. This exercises the hardened
  streaming tool-call assembly against a live provider.
- Headless boot (`--no-tui`) loads cleanly: providers, themes, 8 tools, skills,
  commands, agents — no import-cycle or load-time errors from the command refactor.

## Known gaps

- **anthropic-via-proxy** still returns `E005 Invalid proxy key`: the local proxy
  at `:8080` rejects the configured `sentinelProxy.apiKey`. The app sends the
  right key — this is proxy-side auth (likely an expired/rotated OAuth key), not
  app code. Use `zai` until the proxy key is refreshed. (In the TUI this 403 now
  renders as the friendly "Authentication failed… check ANTHROPIC_API_KEY or run
  /connect" message from the error-format work.)
- **TUI rendering/input** is unverified here (no TTY in this environment). The
  underlying logic is unit-tested and boots clean; it needs a real terminal to
  watch it paint.
