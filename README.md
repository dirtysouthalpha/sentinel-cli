<p align="center">
  <img src="assets/logo.svg" width="120" alt="Sentinel CLI">
</p>

<h1 align="center">Sentinel CLI</h1>

<p align="center"><strong>An AI coding agent with a real engine — and a desktop GUI to match.</strong></p>

<p align="center">
  Multi-provider (cloud <em>and</em> local) · model router with fallback · enforced permissions + undo ·
  MCP client <em>and</em> server · a glassmorphism desktop GUI.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D20-3b82f6?style=flat-square" alt="node">
  <img src="https://img.shields.io/badge/license-MIT-34d399?style=flat-square" alt="license">
  <img src="https://img.shields.io/badge/tests-81%20passing-3b82f6?style=flat-square" alt="tests">
  <img src="https://img.shields.io/badge/MCP-client%20%2B%20server-a78bfa?style=flat-square" alt="mcp">
</p>

<p align="center">
  <img src="assets/screenshot-chat.png" width="860" alt="Sentinel CLI desktop GUI">
</p>

---

## What is Sentinel?

Sentinel is a UI-agnostic coding **engine** — a streaming agentic loop with real tools (file, bash, search, git, web, patch) — exposed through **three faces** that all share the same core:

| Face | Command | For |
|------|---------|-----|
| **Desktop GUI** | `sentinel gui` | A glassmorphism app: block-based chat, inline diffs, command palette, MCP. |
| **Headless CLI** | `sentinel run "task" --json` | Scripts, CI, one-shot agentic tasks with a JSON event stream. |
| **MCP server** | `sentinel mcp-serve` | Expose Sentinel's tools to Claude Desktop or any other MCP client. |

## Features

- **Any model, online or local.** Anthropic, OpenAI, Z.ai (GLM), Google Gemini, Ollama / LM Studio / llama.cpp / vLLM, or any OpenAI-compatible endpoint. Models are `provider/model` strings.
- **Model router** — rule-based selection with **fallback chains** and retry/backoff (`config.router`). A bad model or a dead provider transparently falls through to the next.
- **Enforced permissions + checkpoints.** Three modes — `yolo` / `auto` / `gated` — honor a per-tool, path-glob config. Every file edit is snapshotted, so **`undo`** reverts the agent's last change.
- **MCP, both directions.** Connect to MCP servers (stdio + Streamable HTTP) and use their tools inline (`mcp__server__tool`); or run Sentinel itself as an MCP server.
- **Block-based GUI** with streaming, **inline syntax-highlighted diffs**, an inline approve/deny permission prompt, a ⌘K command palette (commands · models · agents · themes · MCP tools), autocomplete (`/` `@` `mcp`), sessions/tabs, and a live model-router / cost panel.

<p align="center">
  <img src="assets/screenshot-palette.png" width="430" alt="Command palette">
  &nbsp;
  <img src="assets/screenshot-welcome.png" width="430" alt="Welcome">
</p>

## Quick start

```bash
git clone https://github.com/<you>/sentinel-cli.git
cd sentinel-cli
npm install
npm run build

# configure a provider (any of these)
set ZAI_API_KEY=...        # or ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY
#   ...or Ollama running locally needs no key

# 1) Desktop GUI
cd gui && npm install && npm run build && cd ..
node dist/cli.js gui

# 2) Headless agent (executes tools)
node dist/cli.js run "fix the failing test in src/foo.ts"
node dist/cli.js run --json --permission-mode gated "refactor X"   # gated: prompts before mutations

# 3) MCP server (point Claude Desktop at it)
node dist/cli.js mcp-serve
```

Or link it globally and use `sentinel` directly: `npm link`.

## Providers

| Provider | Example model | Key |
|----------|---------------|-----|
| Z.ai (GLM) | `zai/glm-4.6`, `zai/glm-5.1` | `ZAI_API_KEY` |
| Anthropic | `anthropic/claude-sonnet` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai/gpt-4o` | `OPENAI_API_KEY` |
| Google | `gemini/gemini-2.0-flash` | `GEMINI_API_KEY` |
| Ollama (local) | `ollama/llama3.1` | — |
| Any OpenAI-compatible | `custom/<model>` | provider-specific |

Add a `router` block to `sentinel.json` to auto-select and fall back:

```json
{
  "router": {
    "default": "zai/glm-4.6",
    "rules": [{ "match": { "agent": "gsd" }, "use": "anthropic/claude-sonnet", "fallbacks": ["zai/glm-4.6"] }],
    "retry": { "maxAttempts": 2, "baseDelayMs": 200, "maxDelayMs": 2000, "retryOn": [429, 500, 502, 503, 504] }
  }
}
```

## MCP

**Use other servers** — add them to `sentinel.json` under `mcp`; their tools appear as `mcp__<server>__<tool>`:

```json
{ "mcp": { "everything": { "type": "local", "command": ["npx", "-y", "@modelcontextprotocol/server-everything"], "enabled": true } } }
```

`sentinel mcp` lists discovered tools. **Be a server** — `sentinel mcp-serve` exposes Sentinel's built-in tools over stdio to any MCP client.

## Permissions & undo

```bash
sentinel run --permission-mode gated "…"   # prompt before bash / edits
sentinel run --permission-mode gated --yes "…"  # auto-approve (headless)
sentinel checkpoints     # list file snapshots the agent made
sentinel undo            # revert the last agent file change
```
In the GUI, switch modes from the palette or the `mode` pill; gated edits show an inline **Allow / Deny** with a diff.

## Architecture

```
            ┌──────────── core engine (UI-agnostic) ───────────┐
GUI  ─ws─►  │ AgentRunner · providers + router · permissions   │
CLI  ──────►│ + checkpoints · MCP client/server · sessions     │
MCP server ►│ · tools (file/bash/search/git/web/patch)          │
            └──────────────────────────────────────────────────┘
```
The GUI talks to `sentinel serve` (a local-only WebSocket on `127.0.0.1` with a per-launch token). One engine, three faces. See [`ROADMAP-10X.md`](ROADMAP-10X.md) and [`CLAUDE.md`](CLAUDE.md).

## Develop

```bash
npm run build      # tsup -> dist (+ copies builtins into dist/builtin)
npm run lint       # tsc --noEmit
npm test           # vitest (81 tests)
npm run dev        # tsup --watch
# GUI: cd gui && npm run dev   (then open with ?port=&token= from `sentinel serve`)
```

> **Desktop‑native (Tauri):** `sentinel gui` renders the real design in your browser today. A native Tauri shell (window chrome + sidecar packaging) is the next packaging step — the engine bridge is already shell-agnostic.

## License

MIT
