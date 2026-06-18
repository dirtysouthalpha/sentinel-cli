# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Sentinel CLI is a terminal AI coding assistant: a Blessed TUI that runs a full agentic
loop (the model reads files, runs shell commands, searches code, and applies patches via
built-in tools) against any OpenAI-compatible or Anthropic provider. Windows/PowerShell is
a first-class target — do not assume a POSIX shell. TypeScript ESM, Node >= 20.

## Commands

```bash
npm run build        # tsup -> dist/, then scripts/add-shebang.cjs re-adds the cli.js shebang
npm run dev          # tsup --watch
npm test             # vitest run (all tests in tests/)
npm run test:watch   # vitest watch
npm run lint         # tsc --noEmit  (type-check ONLY — there is no ESLint)
npm run clean        # rimraf dist

# Run a single test file / single test
npx vitest run tests/state.test.ts
npx vitest run -t "name of the test"

# Run the app after building
node dist/cli.js              # launches the TUI (requires a TTY)
node dist/cli.js ask "..."    # headless one-shot query, no TUI
node dist/cli.js setup        # interactive API-key/model wizard
node dist/cli.js --no-tui     # load everything but skip the TUI
```

`npm run lint` is a type-check, not a linter — "fix lint" means make `tsc --noEmit` pass.

## Critical conventions

- **ESM with explicit `.js` extensions in imports.** Source is `.ts` but every relative
  import must end in `.js` (e.g. `import { state } from "../core/state.js"`). This is
  required for Node ESM resolution; omitting it builds but fails at runtime.
- **Singletons via `getInstance()` / exported instance.** `state`, `contextManager`,
  `providerManager`, `themeEngine`, `getConfigManager()`, and the three registries are all
  process-wide singletons. Import the exported instance; do not `new` them.
- **Builtin markdown ships in `dist/builtin/`.** `loadAllSkills/Commands/Agents` resolve the
  builtin dir via `utils/builtins.ts` `resolveBuiltinDir`, which prefers
  `dist/builtin/<domain>` (copied at build time by `scripts/copy-builtins.cjs`) and falls
  back to `src/<domain>/builtin/` for local dev. So a `dist`-only/global install works. If you
  add builtin `.md` files, they're picked up automatically on the next `npm run build`.

## Architecture

Data flows: **cli.ts** (bootstrap) → **TUIApp** (the orchestrator + agentic loop) →
**providerManager** (model call) → **tool-executor** → **toolManager** → individual tools.

- `src/cli.ts` — Commander entry point. Subcommands (`config`, `themes`, `skills`, `agents`,
  `setup`, `ask`) plus the default action that wires up config, providers, tools, loads all
  builtins into the registries, then starts `TUIApp`. The default-action body blocks forever
  on `new Promise(() => {})` while the TUI runs.

- `src/tui/app.ts` — **The agentic loop lives here, not in the provider layer.** `chatWithAI()`
  runs a `while (round < maxRounds)` loop: stream a response, extract tool calls, execute each
  via `executeToolCall`, feed results back as messages, repeat until the model stops calling
  tools. `maxRounds` is 30 in `gsd` agent mode, 15 otherwise. Input is handled via **raw
  stdin** (not a Blessed textbox) — `setupRawInput()` reads keycodes directly; this is the
  known source of input-handling quirks. Cost/token tracking is also here (`updateCost`,
  hardcoded $3/$15 per-Mtok pricing).

- `src/tui/agent-stack.ts` — `buildAgentBase()` assembles the shared provider + guarded /
  MCP-aware executor + subagent-tool stack. `chatWithAI`, `runPipelineDelegated`, and
  `runGsdDelegated` all call it instead of each duplicating ~40 lines of identical wiring.

- `src/tui/commands/` — self-contained slash-command handlers (`/marketplace`, `/workspace`,
  `/team`, `/cmd`, `/export`, `/branch`, `/workflow`, `/sync`, `/describe`, `/ask-prime`)
  extracted from `app.ts`'s dispatcher. Each is a free function taking a small `CommandHost`
  adapter (built by `commandHost()` in `app.ts`) so they stay decoupled from the class's
  private rendering internals.

- `src/tui/input.ts` — pure, side-effect-free input logic (line editing, CSI-sequence parsing,
  Tab completion, history stepping). `app.ts`'s raw-stdin handlers are thin wrappers over it,
  so the historically-quirky input path is unit-tested in `tests/input.test.ts`.

- `src/ai/` — Provider abstraction.
  - `provider.ts` — `providerManager` singleton; `initializeFromConfig` maps config keys to
    provider classes and always registers env-var fallbacks for anthropic/openai/zai/ollama.
  - `providers/{anthropic,openai,zai,custom}.ts` — one class per provider implementing
    `chat`/`chatStream`. `custom.ts` backs Ollama and any OpenAI-compatible endpoint.
  - `providers/openai-compat.ts` — shared request-body builder, response parser, and SSE
    stream parser (incl. tool-call delta accumulation). Used by every OpenAI-shaped provider.
  - `context.ts` — `contextManager` singleton. Holds the conversation, estimates tokens
    (`chars/3.5`), and auto-compacts (summarizes all-but-last-6 messages) past `maxTokens`.

- `src/tools/` — Tool implementations: `file`, `bash`, `search`, `git`, `web`, `patch`,
  `browser` (Puppeteer). `tool-executor.ts` holds the JSON-Schema `TOOL_DEFINITIONS` sent to
  the model, plus `executeToolCall` (dispatches to `toolManager`, truncates output at 50K)
  and `parseToolCallsFromContent` (a fallback that scrapes ```tool / ```bash fenced blocks
  when a model can't emit native tool calls).

- `src/core/` — `config.ts` (layered: defaults < global `~/.config/sentinel/config.json` <
  project `sentinel.json`/`.sentinel/config.json`, deep-merged; env vars override at provider
  init), `state.ts` (reactive key/value store with `subscribe`), `events.ts` (event bus),
  `types.ts` (`SentinelConfig` + `DEFAULT_CONFIG`; default model `zai/glm-4.6`, default agent `gsd`).

- **Markdown-driven extensibility.** Skills, commands, and agents are all `.md` files with
  YAML-ish frontmatter (parsed line-by-line, values `JSON.parse`d with string fallback — not a
  real YAML parser) plus a body. Each domain has `loader.ts` + `registry.ts` + `builtin/*.md`.
  - **Commands** (`/fix`, `/review`, …) are prompt templates: the body is fed to the AI with
    `$ARGUMENTS` / `$1`, `$2`… substituted from the user's args (`resolveTemplate`). Adding a
    command = dropping a `.md` in `src/commands/builtin/` (or project `.sentinel/commands/`).
  - **Agents** (`code`, `gsd`, `ask`, `plan`, `debug`) supply a system-prompt fragment appended
    to the base prompt in `TUIApp.getSystemPrompt()`.
  - **Skills** also load from project `.sentinel/`, `.kilo/`, `.opencode/` dirs and configured
    global paths.

- **Pure-helper-first rule for new TUI/GUI behavior.** The TUI (`TUIApp`) and GUI (`gui/src/main.ts`)
  are large, surface-coupled modules with little test coverage. New behavior goes into a **pure,
  dependency-free helper module first** (unit-tested, no TTY/DOM), then a thin binding in the
  surface. Existing seams to follow:
  - `src/tui/input-keys.ts` — word-motion/kill-line editing primitives.
  - `src/tui/search.ts` — transcript search state machine (Ctrl+F).
  - `src/tui/render-chat.ts` — chat-body composition + change-detection memo.
  - `src/tui/commands/info.ts` — extracted slash-command handlers over a `CommandHost`
    (`src/tui/commands/types.ts`); test with a fake host, no blessed.
  - `gui/src/render-diff.ts` — block-list diff for incremental `renderChat`.
  - `gui/src/composer-keys.ts` — global keymap (`resolveKey`).
  - `src/core/project-files.ts` — `@`-mention glob.
  - `src/core/markdown.ts` — the shared block parser (code/diff/prose/heading/hr/table/
    tasklist/list); both surfaces consume it, so add block kinds here, render in both places.

- `src/tui/themes/` — `engine.ts` (`themeEngine` singleton, `getBlessedColors()`) + 14 theme
  variants. Model identifiers are always `provider/model` (e.g. `zai/glm-4.6`); the part before
  the first `/` selects the provider.

## Model/provider identifier format

Everywhere a model is referenced it is `provider/model`. Code splits on the first `/`:
`state.get("currentModel").split("/")` → `[providerName, ...modelParts]`. Provider must be a
registered name (`anthropic`, `openai`, `zai`/`zhipu`, `ollama`, or a custom config key).
