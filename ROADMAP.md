# Sentinel CLI - Roadmap to v20

## Version Progression

---

### v0.1 - Foundation *(current)*
- TypeScript ESM project with tsup build
- Blessed TUI with chat, status bar, input
- 14 themes (cyberpunk, tron, matrix, neon, etc.)
- AI provider abstraction (Anthropic, OpenAI, Ollama, custom)
- Skills/commands/agents system with registries and loaders
- Tool system (file, bash, git, search)
- `/connect` onboarding wizard
- Streaming AI responses
- Context management with compaction
- Headless mode (`sentinel ask "question"`)
- 38 unit tests

### v0.2 - Stability
- [ ] Fix all TUI rendering edge cases
- [ ] Resize handling (terminal resize events)
- [ ] Session persistence (save/restore conversations)
- [ ] Error recovery (auto-reconnect on provider failure)
- [ ] Proper blessed textbox handling (no more input bugs)
- [ ] Integration tests for full chat loop
- [ ] Windows Terminal, iTerm2, tmux compatibility testing

### v0.3 - Multi-Model Routing
- [ ] Model routing rules (auto-select model based on task type)
- [ ] Fallback chains (if primary model fails, try secondary)
- [ ] Token counting and cost tracking per-request
- [ ] Model comparison mode (ask multiple models, show all answers)
- [ ] `/models` command to browse and search available models
- [ ] Rate limit handling with automatic retry/backoff

### v0.4 - Smart Context
- [ ] Auto-compaction when context window fills
- [ ] RAG-style codebase indexing (embed + retrieve relevant files)
- [ ] Project-aware context (auto-include package.json, tsconfig, etc.)
- [ ] File reference system (`@file:path/to/file` in messages)
- [ ] URL fetching (`@url:https://...` to include web content)
- [ ] Git diff context (auto-include relevant diffs)

### v0.5 - Plugin System
- [ ] Plugin API with lifecycle hooks (onLoad, onMessage, onResponse)
- [ ] Plugin marketplace/registry
- [ ] Hot-reload plugins without restart
- [ ] Plugin permissions system
- [ ] Example plugins: jira, github, slack, database
- [ ] Plugin sandboxing for security

### v0.6 - MCP Integration
- [ ] MCP client implementation (Model Context Protocol)
- [ ] Local MCP server management (spawn/stop)
- [ ] Remote MCP server connections
- [ ] MCP tool discovery and routing
- [ ] Built-in MCP servers: filesystem, git, database
- [ ] MCP tool permission management

### v0.7 - Advanced TUI
- [ ] Split pane layout (chat + file viewer side by side)
- [ ] Inline diff viewer (show AI edits as colored diffs)
- [ ] Code block syntax highlighting in chat
- [ ] Markdown rendering in chat responses
- [ ] Command palette with fuzzy search (Ctrl+P)
- [ ] Tab completion for commands, files, and agent names
- [ ] Mouse click to open files from chat
- [ ] Image/attachment support in chat

### v0.8 - Code Execution Sandbox
- [ ] Sandboxed code execution (Docker/containers)
- [ ] Live code preview panel
- [ ] Auto-run generated code and show output
- [ ] Test runner integration (auto-detect and run tests)
- [ ] Build system integration
- [ ] Linter integration (real-time lint feedback)

### v0.9 - Git Integration
- [ ] AI-powered commit messages
- [ ] PR description generation
- [ ] Changelog generation
- [ ] Branch management suggestions
- [ ] Merge conflict resolution assistance
- [ ] Git history analysis and summaries

### v1.0 - Production Release
- [ ] Stable API, no breaking changes
- [ ] 95%+ test coverage
- [ ] Full documentation site
- [ ] npm package with global install
- [ ] Homebrew formula
- [ ] Scoop package (Windows)
- [ ] Performance benchmarks (< 100ms startup)
- [ ] Accessibility audit
- [ ] Security audit

---

### v2.0 - Multi-Agent Orchestration
- [ ] Agent pipelines (chain agents: plan -> code -> test -> review)
- [ ] Parallel agent execution
- [ ] Agent communication protocol
- [ ] Supervisor agent that delegates to specialist agents
- [ ] Agent progress dashboard
- [ ] Cancel/pause/resume agent tasks

### v3.0 - Collaboration
- [ ] Shared sessions (multiple users, one conversation)
- [ ] Team skill/agent libraries
- [ ] Code review workflows (AI + human reviewers)
- [ ] Session templates (reusable conversation starters)
- [ ] Export conversations as markdown/HTML

### v4.0 - Browser Automation
- [ ] Playwright integration
- [ ] Visual testing and screenshot comparison
- [ ] Web scraping agent
- [ ] E2E test generation
- [ ] Browser debugging agent

### v5.0 - Database Integration
- [ ] Schema analysis and migration generation
- [ ] SQL query builder with AI
- [ ] Database documentation generator
- [ ] Data seeding and fixture generation
- [ ] Multi-database support (Postgres, MySQL, SQLite, MongoDB)

### v6.0 - DevOps Automation
- [ ] CI/CD pipeline generation
- [ ] Docker/compose file generation
- [ ] Kubernetes manifest generation
- [ ] Infrastructure-as-Code assistance
- [ ] Monitoring and alerting setup
- [ ] Deployment automation

### v7.0 - Security Suite
- [ ] Dependency vulnerability scanning
- [ ] Code security audit (OWASP)
- [ ] Secret detection and rotation
- [ ] License compliance checking
- [ ] Security policy generation
- [ ] Penetration testing assistance

### v8.0 - Performance Suite
- [ ] Performance profiling agent
- [ ] Bundle analysis for frontend
- [ ] Memory leak detection
- [ ] Database query optimization
- [ ] Caching strategy recommendations
- [ ] Load test generation

### v9.0 - Documentation Engine
- [ ] API documentation generator (OpenAPI)
- [ ] README generator
- [ ] Architecture documentation (ADR)
- [ ] Inline code documentation
- [ ] Tutorial generator
- [ ] Changelog automation

### v10.0 - AI-Native IDE
- [ ] Full terminal-based IDE mode
- [ ] File tree with inline editing
- [ ] Multi-tab interface
- [ ] Integrated terminal
- [ ] Debugger integration
- [ ] Code navigation (go to definition, find references)
- [ ] Integrated testing panel

### v11.0 - Voice & Multimodal
- [ ] Voice input (speech-to-text)
- [ ] Voice output (text-to-speech for responses)
- [ ] Image understanding (screenshot analysis)
- [ ] Diagram generation (Mermaid, PlantUML)
- [ ] Whiteboard mode (ASCII art generation)

### v12.0 - Knowledge Base
- [ ] Persistent project knowledge graph
- [ ] Auto-learn from conversations
- [ ] Team knowledge sharing
- [ ] Documentation search
- [ ] Stack Overflow integration
- [ ] Custom training/fine-tuning on project code

### v13.0 - Mobile Companion
- [ ] Mobile app (React Native)
- [ ] Push notifications for long-running tasks
- [ ] Quick code review on mobile
- [ ] Voice commands
- [ ] Session handoff (desktop <-> mobile)

### v14.0 - Marketplace
- [ ] Community skill marketplace
- [ ] Agent marketplace
- [ ] Theme marketplace
- [ ] Plugin marketplace
- [ ] Rating and review system
- [ ] Revenue sharing for creators

### v15.0 - Enterprise
- [ ] SSO/SAML authentication
- [ ] Role-based access control
- [ ] Audit logging
- [ ] Compliance reporting (SOC2, GDPR)
- [ ] On-premise deployment option
- [ ] Custom model hosting
- [ ] Admin dashboard

### v16.0 - AI Workflows
- [ ] Visual workflow builder
- [ ] Conditional branching in agent pipelines
- [ ] Scheduled tasks (cron-like AI tasks)
- [ ] Event-driven triggers (git push -> auto review)
- [ ] Webhook integrations
- [ ] Custom workflow templates

### v17.0 - Code Intelligence
- [ ] Real-time code analysis
- [ ] Predictive error detection
- [ ] Auto-fix suggestions as you type
- [ ] Code smell detection
- [ ] Architecture drift detection
- [ ] Dependency impact analysis

### v18.0 - Cloud Platform
- [ ] Cloud-hosted Sentinel (web interface)
- [ ] Team workspaces
- [ ] Shared agent/skill libraries
- [ ] Cloud-based model routing
- [ ] Usage analytics dashboard
- [ ] Team billing and quotas

### v19.0 - AI Agent Framework
- [ ] Visual agent builder (no-code)
- [ ] Agent testing framework
- [ ] Agent performance metrics
- [ ] Agent A/B testing
- [ ] Custom agent training data
- [ ] Agent version control

### v20.0 - Autonomous Development
- [ ] Fully autonomous coding agent
- [ ] Self-directed task planning
- [ ] Auto-discovery of bugs and fixes
- [ ] Continuous integration agent
- [ ] Self-improving codebase
- [ ] Natural language project management
- [ ] Autonomous deployment pipeline
- [ ] Zero-config project bootstrapping

---

## Release Cadence

| Versions | Cadence | Focus |
|----------|---------|-------|
| 0.x | Bi-weekly | Core features, stability |
| 1.x | Monthly | Production features |
| 2-5 | Monthly | Major feature sets |
| 6-10 | Bi-monthly | Integration and automation |
| 11-15 | Bi-monthly | Platform and ecosystem |
| 16-20 | Quarterly | Advanced AI capabilities |

## Contributing

Each version milestone will have its own GitHub project board with issues tagged by version. See CONTRIBUTING.md for guidelines.
