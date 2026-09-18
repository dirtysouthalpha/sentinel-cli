# Contributing

Sentinel CLI is an actively developed AI coding-agent engine, and outside contributions are
welcome — **issues and PRs are open.**

## Good places to start
- **New providers / models** — anything OpenAI-compatible should slot in; add it and a test.
- **Tools** — new agent tools (or hardening of existing ones) with tests.
- **MCP servers** — integrations you've wired up and want first-class support for.
- **Bug reports** — with repro steps, your OS, Node version, and the provider/model in use.

## How
1. Open an issue first for anything non-trivial so we can agree on the approach.
2. `npm install && npm test` — the suite runs on Windows, macOS, and Linux; keep it green.
3. Match the existing TypeScript/ESM style. New behavior needs a test.
4. Security-sensitive areas (shell, web, file/patch tools) are reviewed carefully — see
   [`CODE-REVIEW.md`](CODE-REVIEW.md).

## Questions
Open an issue — usage questions and feature ideas are both fine.
