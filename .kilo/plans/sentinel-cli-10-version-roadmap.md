# Sentinel CLI: 10-Version Roadmap

## Vision

Make Sentinel CLI the absolute best coding CLI on Earth — surpassing oh-my-pi, Kilo Code, and Open Code by combining:
- **TypeScript flexibility** where it shines (plugins, agents, skills)
- **Windows-first design** (no WSL required, full PowerShell support)
- **YOLO-mode by default** (GSD agent auto-executes tools)
- **Z.ai as primary** (Coding Plan API for best value)
- **Cyberpunk aesthetics** that actually work in cmd.exe
- **Editor integration** via ACP (Agent Client Protocol)

---

## Current State (v0.2.0)

**Built:**
- TypeScript 5.5+, Node.js 20+, ESM modules
- TUI with blessed, raw stdin input (no textbox crashes)
- 4 AI providers: Z.ai, Anthropic, OpenAI, Custom (Ollama planned)
- 6 tools: file, bash, search, git, web, patch
- 12 commands: fix, review, build, test, analyze, refactor, ship, optimize, secure, docgen, explain, migrate
- 5 agents: gsd (default YOLO), code, ask, plan, debug
- 2 skills: supertools, get-shit-done
- 14 cyberpunk themes
- Token compression at 120K, cost tracking
- Tool calling agentic loop (30 rounds GSD, 15 normal)

**Passing:**
- TypeScript: 0 errors
- Build: succeeds (cli.js 121KB)
- Tests: 38/38 pass

**Known Gaps:**
- No hash-anchored edits
- No LSP integration
- No subagent support
- No browser tool
- No Python execution
- No memory system (Hindsight)
- No DAP debugging
- No plugin marketplace

---

## v0.3.0: Hash-Anchored Edits & Browser Tool

**Goal:** Make edits land on first try, enable web automation.

### Features

**Hash-Anchored File Edits**
- Edit tool with content-hash anchors (oh-my-pi style)
- Format: `edit src/app.ts line:50-80 hash:abc123`
- Auto-reject patches with stale anchors
- 60% fewer output tokens on same work
- Whitespace-immune (no more string-not-found loops)

**Browser Tool**
- Puppeteer integration for headless Chromium
- Screenshots, page navigation, form filling
- Supports Electron app automation (Slack, etc.)
- Stealth mode by default (normal user agent)

**Enhanced Patch Tool**
- Diff preview before apply
- Preview-then-accept workflow
- Rollback support

**New Commands:**
- `/edit <file> <line-range>` - Hash-anchored edit
- `/browse <url>` - Browser automation
- `/preview <file>` - Show pending changes

### Estimated Effort: 2 weeks

---

## v0.4.0: LSP Integration

**Goal:** Give the agent everything your IDE knows.

### Features

**LSP Client**
- TypeScript/JavaScript Language Server Protocol
- Diagnostics in TUI
- Go-to-definition, references, symbol search
- Hover info, auto-complete suggestions
- Code actions (quick fixes, refactorings)
- Rename with workspace/willRenameFiles

**LSP Tool**
- Unified `lsp` tool for all LSP operations
- Auto-start servers on project open
- Multi-language support (TS, Python, Go, Rust)

**TUI Enhancements**
- Inline diagnostics in chat
- Jump to file:line from LSP results
- Symbol browser panel (toggle with F2)

### Estimated Effort: 3 weeks

---

## v0.5.0: Subagent Framework

**Goal:** Parallel task execution with typed results.

### Features

**Subagent System**
- Spawn isolated subagents for parallel work
- Each subagent runs in its own context/worktree
- Schema-validated JSON results (no prose parsing)
- Agent-to-agent communication via IRC protocol

**Task Tool**
- `task` command for subagent fan-out
- Support for constraints between agents
- Cost and duration per subagent
- Merged results with conflict resolution

**Agent Marketplace Concept**
- Built-in subagents: reviewer, linter, tester, migrator
- Custom subagents via markdown (like agents/)
- Subagent chaining and pipelines

### Estimated Effort: 3 weeks

---

## v0.6.0: Python Execution & Notebook Support

**Goal:** Persistent Python kernel with tool re-entry.

### Features

**Python Execution**
- Persistent Python kernel (survives across tool calls)
- Full pandas, numpy, matplotlib support
- Tool re-entry: call `file`/`web` from Python
- Variable persistence between cells

**JavaScript/Bun Execution**
- Parallel Bun worker
- Shared prelude with Python
- Cross-language data exchange

**Notebook Integration**
- Jupyter notebook parsing
- Cell execution in TUI
- Export notebook results

### Estimated Effort: 2 weeks

---

## v0.7.0: Advanced Memory System (Hindsight)

**Goal:** Agent remembers your codebase between sessions.

### Features

**Hindsight Memory**
- `retain` tool to queue facts during sessions
- `recall` tool to search memory bank
- `reflect` tool to synthesize answers from memories
- Project-scoped by default (per repo)

**Session Compression**
- Auto-summarize sessions after N turns
- Mental model generation (project structure)
- Load previous context on first turn

### Estimated Effort: 3 weeks

---

## v0.8.0: DAP Debugging Support

**Goal:** Agent drives real debuggers, not just print statements.

### Features

**Debug Adapter Protocol**
- Support for lldb, dlv, debugpy, node-inspect
- Breakpoints (set, clear, toggle)
- Stepping (step, step over, step out)
- Inspect variables, call stack, threads

**Auto-Debug Mode**
- Agent auto-attaches on segfault/hang
- Step through crash path
- Auto-generate minimal repro

### Estimated Effort: 4 weeks

---

## v0.9.0: Enhanced Tool Harness (32+ Tools)

**Goal:** Whatever the task needs, it's already in the box.

### Features

**Expand to 32 Tools:**
- Files & Search: read, write, edit, ast_edit, ast_grep, search, find
- Runtime: bash, eval, ssh
- Code Intelligence: lsp, debug
- Coordination: task, irc, todo, job, ask
- Outside the Box: browser, web_search, github, inspect_image, render_mermaid
- Memory & State: checkpoint, rewind, retain, recall, reflect
- Misc: resolve, search_tool_bm25

### Estimated Effort: 6 weeks

---

## v1.0.0: ACP & RPC Embedding

**Goal:** Editor integration and embeddability.

### Features

**Agent Client Protocol (ACP)**
- JSON-RPC over stdio
- Compatibility with Zed editor
- Editor-driven agent (read buffer, write through editor)

**RPC Mode**
- `sentinel --mode rpc` for process isolation
- NDJSON protocol

**Node.js SDK**
- `@sentinel/cli` npm package
- Direct embedding in Node processes

### Estimated Effort: 4 weeks

---

## v1.1.0: Multi-Agent Orchestration & Workflow Engine

**Goal:** Chain agents for complex tasks.

### Features

**Workflow Engine**
- YAML-based workflow definitions
- Agent chaining and branching
- Parallel execution paths

**Built-in Workflows:**
- `ship` - Review ? Test ? Build ? Deploy
- `migrate` - Analyze ? Plan ? Apply ? Verify
- `debug` - Reproduce ? Debug ? Fix ? Test
- `audit` - Scan ? Lint ? Test ? Report

**Agent Supervisor**
- Meta-agent that orchestrates workflows
- Smart task delegation

### Estimated Effort: 5 weeks

---

## v1.2.0: Plugin Marketplace & Extension System

**Goal:** Extensible by anyone, discoverable by all.

### Features

**Plugin System**
- TypeScript-based plugins
- Full access to tool API, slash commands, agents

**Marketplace**
- Official plugin registry
- Search by category, rating
- One-click install via `/plugin install <name>`

**Built-in Plugins:**
- sentinel-plugin-docker, terraform, k8s, aws, slack, notion

### Estimated Effort: 6 weeks

---

## Summary

| Version | Focus | Major Features | Weeks | Status |
|---------|-------|----------------|-------|--------|
| v0.2.0 | Base | TUI, tools, agents, providers | - | ? Done |
| v0.3.0 | Edits + Web | Hash-anchored edits, browser tool | 2 | ?? Planned |
| v0.4.0 | LSP | Full LSP integration, diagnostics | 3 | ?? Planned |
| v0.5.0 | Subagents | Parallel task execution, schema validation | 3 | ?? Planned |
| v0.6.0 | Runtime | Python/JS kernels, notebook support | 2 | ?? Planned |
| v0.7.0 | Memory | Hindsight, session summarization | 3 | ?? Planned |
| v0.8.0 | Debugging | DAP support, real debuggers | 4 | ?? Planned |
| v0.9.0 | Tools | Expand to 32+ tools, tool discovery | 6 | ?? Planned |
| v1.0.0 | Embedding | ACP, RPC, Node.js SDK | 4 | ?? Planned |
| v1.1.0 | Workflows | Multi-agent orchestration, workflows | 5 | ?? Planned |
| v1.2.0 | Plugins | Plugin marketplace, extension system | 6 | ?? Planned |

**Total: 38 weeks to v1.2.0**

---

## Questions for User

1. **Rust adoption:** Should we add N-API native modules for grep/AST, or stay pure TypeScript?
2. **Workflow complexity:** Do you want a full YAML workflow engine or simpler agent chaining?
3. **Marketplace hosting:** Should marketplace be self-hosted or use npm as registry?
4. **Embedding priority:** Is ACP (editor integration) or Node SDK more important for v1.0?
5. **Python support:** Should Python kernel be required, optional, or skip entirely?