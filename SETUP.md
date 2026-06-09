# Sentinel CLI Setup Guide

## Quick Start

```bash
# Run the interactive setup wizard
node dist/cli.js setup
```

The wizard walks you through configuring API keys, models, and themes.

---

## API Providers

### Option 1: Anthropic (Claude) - Recommended for Coding

Best for: Code generation, refactoring, debugging

1. Get an API key: https://console.anthropic.com/settings/keys
2. Configure:

```bash
# Option A: Environment variable
set ANTHROPIC_API_KEY=sk-ant-xxxxx

# Option B: Setup wizard
node dist/cli.js setup

# Option C: Config file (sentinel.json)
{
  "provider": {
    "anthropic": {
      "options": { "apiKey": "sk-ant-xxxxx" },
      "models": {
        "claude-sonnet": { "name": "Claude Sonnet" },
        "claude-haiku":  { "name": "Claude Haiku" }
      }
    }
  }
}
```

Models: `anthropic/claude-sonnet`, `anthropic/claude-haiku`

### Option 2: OpenAI (GPT)

Best for: General purpose, GPT-4o

1. Get an API key: https://platform.openai.com/api-keys
2. Configure:

```bash
# Option A: Environment variable
set OPENAI_API_KEY=sk-xxxxx

# Option B: Setup wizard
node dist/cli.js setup

# Option C: Config file
{
  "provider": {
    "openai": {
      "options": { "apiKey": "sk-xxxxx" },
      "models": {
        "gpt-4o":      { "name": "GPT-4o" },
        "gpt-4o-mini": { "name": "GPT-4o Mini" }
      }
    }
  }
}
```

Models: `openai/gpt-4o`, `openai/gpt-4o-mini`

### Option 3: Ollama (Local - Free)

Best for: Privacy, offline use, free

1. Install Ollama: https://ollama.com
2. Pull a model: `ollama pull llama3`
3. Configure:

```bash
# Option A: Setup wizard (recommended)
node dist/cli.js setup

# Option B: Config file
{
  "provider": {
    "ollama": {
      "options": { "baseURL": "http://localhost:11434" },
      "models": {
        "llama3":         { "name": "Llama 3" },
        "codellama":      { "name": "Code Llama" },
        "mistral":        { "name": "Mistral" },
        "deepseek-coder": { "name": "DeepSeek Coder" }
      }
    }
  }
}
```

Models: `ollama/llama3`, `ollama/codellama`, `ollama/mistral`, `ollama/deepseek-coder`

### Option 4: Custom (Groq, Together, OpenRouter, etc.)

Any OpenAI-compatible API endpoint:

```bash
node dist/cli.js setup
# Choose "Add custom provider"

# Or in config:
{
  "provider": {
    "groq": {
      "options": {
        "baseURL": "https://api.groq.com/openai/v1",
        "apiKey": "gsk_xxxxx"
      }
    }
  }
}
```

---

## Switching Models

Inside the TUI:

```
/model anthropic/claude-sonnet    Switch to Claude Sonnet
/model openai/gpt-4o             Switch to GPT-4o
/model ollama/llama3             Switch to local Llama 3
/providers                       Check which providers are configured
Ctrl+M                           Cycle through models
```

## Configuration Files

Sentinel checks config in this order:

1. **Environment variables** (highest priority)
   - `ANTHROPIC_API_KEY`
   - `OPENAI_API_KEY`
   - `OLLAMA_BASE_URL` (default: http://localhost:11434)

2. **Project config**: `sentinel.json` in project root

3. **Global config**: `~/.config/sentinel/config.json`

4. **Defaults**: built-in defaults

## Switching Agents

```
/agent code      Coding agent (default)
/agent ask       Q&A agent
/agent plan      Planning agent
/agent debug     Debugging agent
Ctrl+A           Cycle agents
```

## Switching Themes

```
/theme cyberpunk     Tron x Gotham (default)
/theme matrix        Green terminal
/theme tron          Cyan grid
/theme neon          Purple neon
/theme dark          Classic dark
Ctrl+T               Cycle themes
```
