<p align="center">
  <img src="assets/logo.svg" width="200" alt="Sentinel CLI Logo">
</p>

<h1 align="center">Sentinel CLI</h1>

<p align="center">
  <strong>The Best Coding CLI on the Planet</strong>
</p>

<p align="center">
  AI-powered coding assistant with real-time tool execution, token compression, and cyberpunk aesthetics.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.2.0-00D4FF?style=for-the-badge&labelColor=06080C" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-39FF14?style=for-the-badge&labelColor=06080C" alt="License">
  <img src="https://img.shields.io/badge/node-%3E%3D20-FF2E63?style=for-the-badge&labelColor=06080C" alt="Node.js">
  <img src="https://img.shields.io/badge/tests-38%20passing-00D4FF?style=for-the-badge&labelColor=06080C" alt="Tests">
  <img src="https://img.shields.io/badge/themes-14-FFB800?style=for-the-badge&labelColor=06080C" alt="Themes">
</p>

---

## Features

- **Real Tool Execution** - AI reads files, runs commands, searches code, applies patches. Full agentic loop.
- **Get Shit Done Mode** - Switch to GSD agent for fast, no-nonsense execution
- **Token Compression** - Auto-compressing context saves money. Real-time cost tracking.
- **14 Cyberpunk Themes** - Tron x Gotham, Matrix, Neon, Blood, and more
- **Multi-Provider** - Z.ai GLM, Anthropic Claude, OpenAI GPT-4o, Ollama, Groq, OpenRouter
- **Windows First** - Full PowerShell support. No WSL required.
- **6 Built-in Tools** - file, bash, search, git, web, patch
- **12 Built-in Commands** - /fix, /review, /build, /test, /analyze, /refactor, /ship, /optimize, /secure, /docgen, /explain, /migrate
- **Extensible** - Custom skills, commands, agents via markdown files

## Quick Start

```bash
# Clone and install
git clone https://github.com/brandt/sentinel-cli.git
cd sentinel-cli
npm install

# Build
npm run build

# Run the setup wizard
node dist/cli.js setup

# Or install globally
npm link
sentinel
```

## First Run

```bash
# Start the TUI
sentinel

# Connect your AI provider
/connect

# Choose Z.ai (recommended), Anthropic, OpenAI, Ollama, or custom
# Paste your API key
# Start coding!
```

## Providers

| Provider | Models | API Key |
|----------|--------|---------|
| **Z.ai** (Recommended) | GLM-5.1, GLM-4.7, GLM-4-Flash, CodeGeeX | `ZAI_API_KEY` |
| **Anthropic** | Claude Sonnet, Claude Haiku | `ANTHROPIC_API_KEY` |
| **OpenAI** | GPT-4o, GPT-4o Mini | `OPENAI_API_KEY` |
| **Ollama** | Llama 3, Code Llama, Mistral, DeepSeek | Free (local) |
| **Groq** | Llama 3.1 70B, Mixtral | `GROQ_API_KEY` |
| **OpenRouter** | 100+ models | `OPENROUTER_API_KEY` |
| **Custom** | Any OpenAI-compatible | Provider-specific |

## Commands

### Core
- `/help` - Show all commands
- `/connect` - Set up AI provider
- `/model <name>` - Switch model (e.g. `/model zai/glm-4.6`)
- `/agent <name>` - Switch agent (`code`, `gsd`, `ask`, `plan`, `debug`)
- `/theme <name>` - Switch theme
- `/providers` - Check API status
- `/cost` - Session cost breakdown
- `/compact` - Compress context to save tokens
- `/context` - Show context stats

### Super Tools
- `/fix <target>` - Fix lint errors and bugs
- `/review <target>` - Code review
- `/build <target>` - Build and verify
- `/test <target>` - Generate and run tests
- `/analyze <target>` - Analyze code structure
- `/refactor <target>` - Refactor for clarity
- `/ship <target>` - Build, test, prepare release
- `/optimize <target>` - Performance optimization
- `/secure <target>` - Security audit
- `/docgen <target>` - Generate documentation
- `/explain <target>` - Explain code in detail
- `/migrate <target>` - Framework migration

### Keyboard Shortcuts
- `Ctrl+Q` - Quit
- `Ctrl+C` - Cancel request
- `Ctrl+T` - Cycle theme
- `Ctrl+A` - Cycle agent
- `Ctrl+M` - Cycle model

## Agents

| Agent | Mode | Description |
|-------|------|-------------|
| `code` | Primary | Expert coding with best practices |
| `gsd` | Primary | Get Shit Done - fast, auto-approve |
| `ask` | Primary | Questions and explanations |
| `plan` | Primary | Architecture and planning |
| `debug` | Primary | Bug analysis and fixing |

## Tools

| Tool | Description |
|------|-------------|
| `file` | Read, write, list, delete, mkdir |
| `bash` | Execute shell commands |
| `search` | Grep and glob code search |
| `git` | Git operations |
| `web` | Fetch URLs and APIs |
| `patch` | Smart find-and-replace |

## Themes

14 built-in themes: `cyberpunk`, `tron`, `matrix`, `neon`, `dark`, `blood`, `terminal`, `ocean`, `midnight`, `sunset`, `forest`, `paper`, `mono`, `light`

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev

# Run tests
npm test

# Type check
npx tsc --noEmit

# Lint
npm run lint
```

## Architecture

```
src/
  cli.ts              Entry point
  tui/
    app.ts            Blessed TUI with streaming
    connect.ts        /connect onboarding wizard
    themes/           14 theme variants + engine
  ai/
    provider.ts       Provider manager
    providers/
      anthropic.ts    Claude (native API + tools)
      openai.ts       GPT-4o (OpenAI API + tools)
      zai.ts          Z.ai/Zhipu GLM (Coding Plan)
      custom.ts       Any OpenAI-compatible
      openai-compat.ts Shared helpers
    context.ts        Context manager with auto-compaction
  tools/
    file.ts           File operations
    bash.ts           Shell execution (PowerShell/bash)
    search.ts         Code search (grep/glob)
    git.ts            Git operations
    web.ts            URL fetcher
    patch.ts          Smart find-and-replace
    tool-executor.ts  Tool calling bridge
  skills/builtin/     Markdown skill definitions
  commands/builtin/   Markdown command templates
  agents/builtin/     Markdown agent definitions
  core/
    config.ts         Config manager
    state.ts          Reactive state
    events.ts         Event bus
```

## Z.ai / Zhipu GLM Setup

Z.ai is the recommended provider for best value:

1. Get an API key from [open.bigmodel.cn](https://open.bigmodel.cn)
2. Optionally subscribe to [Coding Plan](https://bigmodel.cn/coding-plan) for higher limits
3. Run `/connect` in Sentinel and choose option 1
4. Or set `ZAI_API_KEY` environment variable

Models:
- `glm-5.1` - Most capable (3x quota in peak hours)
- `glm-4.6` - Recommended for coding
- `glm-4.5-air` - Fast and cheap
- `codegeex-4` - Specialized for code

## License

MIT

---

<p align="center">
  Built with TypeScript, Blessed, and <span style="color:#00D4FF">cyberpunk</span> dreams.
</p>
