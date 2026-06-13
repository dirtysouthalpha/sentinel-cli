import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";
import { state } from "../core/state.js";
import { events } from "../core/events.js";
import { providerManager } from "../ai/provider.js";
import { ProviderError } from "../ai/errors.js";
import { ContextManager } from "../ai/context.js";
import { commandRegistry } from "../commands/registry.js";
import { parseCommand, resolveTemplate } from "../commands/loader.js";
import { getToolDefinitions, executeToolCall } from "../tools/tool-executor.js";
import { ToolCall } from "../ai/types.js";
import { AgentRunner } from "../core/agent-runner.js";
import { extractToolCalls } from "../core/tool-call-extractor.js";
import { buildSystemPrompt } from "../core/system-prompt.js";
import { suggestCommand } from "../core/command-search.js";
import { searchCatalog, COMMAND_CATALOG } from "../core/command-catalog.js";
import { renderMarkdown } from "./render-markdown.js";
// Phase 1: extracted TUI modules
import { InputHandler } from "./input-handler.js";
import { ChatRenderer } from "./chat-renderer.js";
import { CommandPalette } from "./command-palette.js";
// Phase 2: LSP integration — registered centrally in toolManager + TOOL_DEFINITIONS,
// so it flows through getToolDefinitions()/executeToolCall like every other tool.
// Phase 3: todo panel
import { TodoPanel } from "./todo-panel.js";
import {
  saveWorkflow,
  listWorkflows,
  getWorkflow,
  deleteWorkflow,
  renderSteps,
} from "../core/workflows-store.js";
import {
  buildBundle,
  writeBundle,
  readBundle,
  applyBundle,
} from "../core/sync.js";
import { expandMentions } from "../core/mentions.js";
import { parsePipeline, runPipeline, type Pipeline } from "../core/pipeline-engine.js";
import { runGsd, buildPhasePrompt } from "../core/gsd.js";
import { buildIndex, search as searchRepoIndex, RepoIndex } from "../core/repo-index.js";
import { recallRelevant, DEFAULT_RECALL_TOOL } from "../core/brain-recall.js";
import { loadAttachment } from "../core/attachments.js";
import { buildVisionMessage } from "../core/vision.js";
import { createHeaderBar } from "./header-bar.js";
import { TabManager } from "./tab-manager.js";
import {
  SlashHandlerContext,
  handleWorkspaceCommand,
  handleTeamCommand,
  handleExportCommand,
  handleBranchCommand,
  handleTabsCommand,
} from "./slash-handlers.js";
import { sessionManager, Session } from "../core/session-manager.js";
import { RoutedProvider } from "../ai/routed-provider.js";
import { PermissionEngine, PermissionMode, PermissionRequest } from "../core/permissions.js";
import { CheckpointManager } from "../core/checkpoints.js";
import { createGuardedExecutor } from "../core/guarded-executor.js";
import { createSubagentTool, createSubagentAwareExecutor } from "../core/subagent.js";
import { createTodoTool, createTodoAwareExecutor } from "../core/todos.js";
import { createHookAwareExecutor, defaultRunShell } from "../core/hooks.js";
import { BackgroundTaskManager } from "../core/background.js";
import { usageTracker } from "../core/usage-tracker.js";
import { runDiagnostics, formatDiagnostics } from "../core/diagnostics.js";
import { estimateCostUSD } from "../core/pricing.js";
import { exec } from "child_process";
import { MCPManager } from "../mcp/manager.js";
import { createMcpAwareExecutor } from "../mcp/mcp-executor.js";
import { getConfigManager } from "../core/config.js";
import { fetchRegistry, searchRegistry, installEntry } from "../core/marketplace.js";
import { buildAbout } from "../core/about.js";
import { checkForUpdate } from "../core/update-check.js";
import { createLogger } from "../utils/logger.js";
import { readFileSync } from "node:fs";
import { join, isAbsolute, resolve } from "node:path";
import { createSidebar } from "./sidebar.js";

const log = createLogger({ prefix: "tui" });

const VERSION = "0.4.0";

/**
 * Default marketplace registry source for `/marketplace` (V15). A project-local
 * JSON file by default; overridable per-invocation with an explicit path/URL, or
 * by committing a registry document at this path. Can also be a remote URL.
 */
const DEFAULT_MARKETPLACE_SOURCE = ".sentinel/registry.json";

export interface TUIAppOptions {
  projectRoot: string;
  installRoot: string;
  initialTheme?: string;
}

interface CostTracker {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requests: number;
  estimatedCostUSD: number;
}

export class TUIApp {
  private screen!: blessed.Widgets.Screen;
  private chat!: blessed.Widgets.BoxElement;
  private input!: blessed.Widgets.BoxElement;
  private status!: blessed.Widgets.BoxElement;
  private tabBarWidget!: blessed.Widgets.BoxElement;
  private headerBarWidget!: blessed.Widgets.BoxElement;
  private tabManager!: TabManager;

  private projectRoot: string;
  private installRoot: string;
  private isProcessing = false;
  private ac?: AbortController;
  private pendingToolArgs = "";
  private permissionMode: PermissionMode = "yolo";
  private mcp = new MCPManager();
  private mcpConnected = false;
  private background = new BackgroundTaskManager();
  private bgWired = false;
  private pendingPermission?: (allow: boolean) => void;

  // V11 semantic repo index (lite TF-IDF). Built lazily by /index or /search.
  private repoIndex?: RepoIndex;

  // Phase 1: extracted modules
  private inputHandler = new InputHandler({
    onSubmit: (msg) => this.handleInput(msg),
    onCancel: () => { this.ac?.abort(); this.isProcessing = false; state.set("isProcessing", false); this.renderer.addSystem("Cancelled."); },
    onPermissionKey: (allow) => { if (this.pendingPermission) { this.pendingPermission(allow); this.pendingPermission = undefined; this.renderer.addSystem(allow ? "Allowed." : "Denied."); } },
    hasPendingPermission: () => !!this.pendingPermission,
  });
  private renderer = new ChatRenderer();
  private palette = new CommandPalette({
    onCommand: (name) => this.handleInput(name),
    onTheme: (name) => { themeEngine.setTheme(name); state.set("currentTheme", name); this.renderer.addSystem(`Theme → ${themeEngine.getTheme().display}`); },
    onAgent: (name) => { state.set("currentAgent", name); events.emit("agent:switched", name); this.renderer.addSystem(`Agent → ${name}`); },
    onModel: (name) => { state.set("currentModel", name); events.emit("model:changed", name); this.renderer.addSystem(`Model → ${name}`); },
  });
  // Phase 3: todo panel
  private todoPanel?: TodoPanel;
  private sidebarWidget?: blessed.Widgets.BoxElement;

  constructor(options: TUIAppOptions) {
    this.projectRoot = options.projectRoot;
    this.installRoot = options.installRoot;
    if (options.initialTheme) {
      themeEngine.setTheme(options.initialTheme);
    }
  }

  private getContextManager(): ContextManager {
    const session = sessionManager.getActiveSession();
    return session?.contextManager || new ContextManager("fallback");
  }

  start(): void {
    const c = themeEngine.getBlessedColors();

    this.screen = blessed.screen({
      smartCSR: true,
      title: "Sentinel CLI",
      fullUnicode: true,
      autoPadding: true,
      warnings: false,
    });

    this.tabManager = new TabManager({
      screen: this.screen,
      onSwitch: (session) => this.onTabSwitch(session),
      onClose: (id) => this.onTabClose(id),
      onCreate: () => this.createNewTab(),
    });

    this.tabBarWidget = this.tabManager.getTabBar();

    this.headerBarWidget = createHeaderBar({
      screen: this.screen,
      projectRoot: this.projectRoot,
    });

    // ── accent line beneath header (visual separation) ──────────────────────
    blessed.box({
      parent: this.screen,
      top: 2,
      left: 0,
      width: "100%",
      height: 1,
      tags: false,
      style: { bg: c.cyan, fg: c.cyan },
    });

    this.chat = blessed.box({
      parent: this.screen,
      top: 3,
      left: 0,
      width: "100%",
      bottom: 5,
      scrollable: true,
      alwaysScroll: true,
      mouse: true,
      keys: true,
      vi: true,
      tags: true,
      wrap: true,
      padding: { left: 2, right: 3, top: 0, bottom: 0 },
      scrollbar: {
        ch: "▌",
        style: { fg: c.border, bg: c.bgPrimary },
      },
      style: { bg: c.bgPrimary, fg: c.textPrimary },
    });

    // ── separator above input area ───────────────────────────────────────────
    blessed.box({
      parent: this.screen,
      bottom: 4,
      left: 0,
      width: "100%",
      height: 1,
      tags: false,
      style: { bg: c.border, fg: c.border },
    });

    this.input = blessed.box({
      parent: this.screen,
      left: 0,
      width: "100%",
      bottom: 1,
      height: 3,
      tags: true,
      padding: { left: 2, top: 1 },
      style: {
        bg: c.bgSecondary,
        fg: c.textPrimary,
      },
    });

    this.status = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: "100%",
      height: 1,
      tags: true,
      style: { bg: c.bgTertiary, fg: c.textSecondary },
    });

    // Slash-command autocomplete overlay just above the input
    const slashBox = blessed.box({
      parent: this.screen,
      left: 1,
      width: "75%",
      bottom: 5,
      height: 8,
      hidden: true,
      tags: true,
      border: { type: "line" },
      scrollable: true,
      style: {
        bg: c.bgSecondary,
        fg: c.textPrimary,
        border: { fg: c.accent || c.cyan },
      },
    });

    // Phase 1: wire extracted modules
    this.renderer.init(this.chat, this.status, this.screen);
    this.renderer.setVersion(VERSION);
    this.inputHandler.init(this.input, this.screen, slashBox);
    this.palette.init(this.screen);
    // Sidebar (hidden by default, Ctrl+S to toggle)
    this.sidebarWidget = createSidebar(this.screen);
    // Phase 3: todo panel
    const todoTool = createTodoTool();
    this.todoPanel = new TodoPanel({ screen: this.screen, store: todoTool.store });

    this.renderer.printWelcome(providerManager.getAvailableProviderNames());
    this.inputHandler.start();
    this.setupKeys();
    this.renderer.refreshStatus();
    this.inputHandler.render();

    state.subscribe("currentAgent", () => this.renderer.refreshStatus());
    state.subscribe("currentModel", () => this.renderer.refreshStatus());
    state.subscribe("isProcessing", () => this.renderer.refreshStatus());
    state.subscribe("compressionStats", () => this.renderer.refreshStatus());
    events.on("theme:changed", () => this.renderer.applyTheme(this.chat, this.input));

    // Populate tab bar with the already-created session.
    this.tabManager.refresh();

    this.screen.render();
    log.info("TUI started");
  }

  // ---- forwarding wrappers (Phase 1: delegates to extracted modules) -------
  private esc(s: string): string { return s.replace(/[{}]/g, (ch) => (ch === "{" ? "{open}" : "{close}")); }
  private render(): void { this.renderer.render(); }
  private push(block: string): void { this.renderer.push(block); }
  private renderInput(): void { this.inputHandler.render(this.isProcessing); }
  private addUser(text: string): void { this.renderer.addUser(text); }
  private startAssistant(): void { this.renderer.startAssistant(); }
  private streamAssistant(token: string): void { this.renderer.streamAssistant(token); }
  private endAssistant(): void { this.renderer.endAssistant(); }
  private addTool(name: string, args: string, ok: boolean, firstLine: string): void { this.renderer.addTool(name, args, ok, firstLine); }
  private addSystem(text: string): void { this.renderer.addSystem(text); }
  private addError(text: string): void { this.renderer.addError(text); }
  private divider(): void { this.renderer.divider(); }
  private printWelcome(): void { this.renderer.printWelcome(providerManager.getAvailableProviderNames()); }
  private refreshStatus(): void { this.renderer.refreshStatus(); }
  private applyTheme(): void { this.renderer.applyTheme(this.chat, this.input); this.inputHandler.render(); }
  private updateCost(usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined): void { this.renderer.updateCost(usage); }
  private setupRawInput(): void { /* delegated to InputHandler */ }
  private renderInputDefault(): void { this.inputHandler.render(this.isProcessing); }

  /** Build the narrow context the extracted leaf slash-handlers operate on. */
  private slashCtx(): SlashHandlerContext {
    return {
      projectRoot: this.projectRoot,
      addSystem: (t) => this.addSystem(t),
      addError: (t) => this.addError(t),
      tabManager: this.tabManager,
      createNewTab: () => this.createNewTab(),
      onTabClose: (id) => this.onTabClose(id),
    };
  }
  private wireBackground(): void {
    if (this.bgWired) return;
    this.bgWired = true;
    this.background.onUpdate((t) => {
      if (t.status === "running") return;
      const mark = t.status === "done" ? "✓" : t.status === "error" ? "✗" : "∅";
      const detail = t.status === "done" ? (t.result || "").split("\n").slice(0, 10).join("\n") : t.status === "error" ? t.error || "" : "";
      this.addSystem(`${mark} bg #${t.id} ${t.status}: ${t.label}${detail ? `\n${detail}` : ""}`);
    });
  }
  private runShell(command: string, signal: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const isWindows = process.platform === "win32";
      const shell = isWindows ? "powershell.exe" : undefined;
      exec(command, { cwd: this.projectRoot, signal, maxBuffer: 10 * 1024 * 1024, shell }, (error, stdout, stderr) => {
        const out = `${stdout || ""}${stderr ? `\n${stderr}` : ""}`.trim();
        if (error) return reject(new Error((stderr || error.message || "command failed").trim().slice(0, 4000)));
        resolve((out || "(no output)").slice(0, 4000));
      });
    });
  }


  private async handleInput(input: string): Promise<void> {
    if (input === "/") {
      // Open the full command palette instead of dumping a text wall
      this.palette.open();
      this.inputHandler.clearLine();
      return;
    }
    if (input.startsWith("/")) {
      await this.handleCommand(input);
      return;
    }
    await this.chatWithAI(input);
  }

  private showSlashMenu(): void {
    const c = themeEngine.getBlessedColors();
    const cmds = commandRegistry.getAll();

    const core: [string, string][] = [
      ["/connect", "Set up AI provider"],
      ["/model <name>", "Switch model"],
      ["/agent <name>", "Switch agent (gsd, code, debug, plan, ask)"],
      ["/theme <name>", "Switch theme"],
      ["/providers", "Check API status"],
      ["/permissions <mode>", "Guardrails: yolo | auto | gated | plan"],
      ["/plan [off]", "Read-only research mode: propose a plan, no edits"],
      ["/bg <command>", "Run a shell command in the background"],
      ["/tasks", "List background tasks (and their status)"],
      ["/mcp", "List connected MCP tools"],
      ["/marketplace ...", "Extension registry: list | search <q> | install <id> [source]"],
      ["/cmd <text>", "AI command-search: natural language → shell command"],
      ["/palette [query]", "Search the command palette (alias /p)"],
      ["/index", "Build a semantic index of the repo (TF-IDF, local)"],
      ["/search <query>", "Semantic search the repo index for relevant files"],
      ["/workflow ...", "Saved workflows: list | save | run | delete"],
      ["/sync ...", "Portable settings bundle: export [path] | import <path>"],
      ["/pipeline run <f.json>", "Run a deterministic JSON pipeline of agent steps"],
      ["/ship <task>", "Autonomous GSD: plan → implement → test → review → fix"],
      ["/ask-prime <q>", "Ask Sentinel Prime (Hermes agent)"],
      ["/describe <img> [q]", "Vision: describe a local image (one-shot)"],
      ["/checkpoints", "List file checkpoints"],
      ["/undo", "Undo the last agent file change"],
      ["/cost", "Session cost breakdown"],
      ["/usage", "Usage metrics: tokens, cost, per-tool table"],
      ["/diagnostics", "Run typecheck/build, report errors (alias /diag)"],
      ["/export [md|html] [path]", "Export this session's transcript to a file"],
      ["/branch", "Duplicate this session into a new tab"],
      ["/workspace ...", "Multi-repo roots: list | add | remove | use (alias /ws)"],
      ["/team ...", "Shared team: info | name <n> | registry <url> | add | remove"],
      ["/compact", "Compress context (save tokens)"],
      ["/about", "Version, runtime, and feature summary"],
      ["/update", "Check npm for a newer Sentinel release"],
      ["/clear", "Clear chat history"],
      ["/help", "Full help"],
      ["/quit", "Exit Sentinel"],
    ];

    let s = `\n{${c.cyan}-fg}{bold}Commands{/}\n`;
    for (const [name, desc] of core) {
      s += `  {${c.accent}-fg}${name.padEnd(18)}{/} {${c.textTertiary}-fg}${desc}{/}\n`;
    }
    if (cmds.length > 0) {
      s += `\n{${c.cyan}-fg}{bold}Super Tools{/}\n`;
      for (const cmd of cmds) {
        s += `  {${c.accent}-fg}${`/${cmd.name}`.padEnd(18)}{/} {${c.textTertiary}-fg}${cmd.description}{/}\n`;
      }
    }
    this.push(s);
  }

  private async handleCommand(input: string): Promise<void> {
    const parsed = parseCommand(input);

    if (parsed.name === "help" || parsed.name === "?") {
      this.showSlashMenu();
      return;
    }

    if (parsed.name === "quit" || parsed.name === "exit" || parsed.name === "q") {
      this.screen.destroy();
      process.exit(0);
      return;
    }

    if (parsed.name === "clear") {
      this.renderer.setTranscript("");
      this.renderer.clearStream();
      this.printWelcome();
      this.addSystem("Cleared.");
      return;
    }

    if (parsed.name === "compact") {
      const cm = this.getContextManager();
      const before = cm.getMessageCount();
      cm.compact();
      const after = cm.getMessageCount();
      this.addSystem(`Compacted: ${before} → ${after} messages.`);
      const activeId = sessionManager.getActiveSessionId();
      if (activeId) sessionManager.markDirty(activeId);
      return;
    }

    if (parsed.name === "export") {
      handleExportCommand(this.slashCtx(), parsed.args);
      return;
    }

    if (parsed.name === "branch") {
      handleBranchCommand(this.slashCtx());
      return;
    }

    if (parsed.name === "cost") {
      const cost = this.renderer.getCost();
      this.addSystem(
        [
          "Session cost:",
          `  Prompt:     ${cost.promptTokens.toLocaleString()} tokens`,
          `  Completion: ${cost.completionTokens.toLocaleString()} tokens`,
          `  Total:      ${cost.totalTokens.toLocaleString()} tokens`,
          `  Requests:   ${cost.requests}`,
          `  Est. cost:  $${cost.estimatedCostUSD.toFixed(4)}`,
        ].join("\n")
      );
      return;
    }

    if (parsed.name === "usage") {
      this.addSystem(usageTracker.render());
      return;
    }

    if (parsed.name === "about") {
      this.addSystem(buildAbout(VERSION));
      return;
    }

    if (parsed.name === "update") {
      this.addSystem("Checking for updates …");
      const r = await checkForUpdate(VERSION);
      if (r.latest === null) {
        this.addSystem("Could not check for updates (offline?).");
      } else if (r.updateAvailable) {
        this.addSystem(
          `v${r.latest} available (you have v${r.current}). Update: npm i -g sentinel-cli`
        );
      } else {
        this.addSystem(`Sentinel is up to date (v${r.current}).`);
      }
      return;
    }

    // /diagnostics (alias /diag): run the project's typecheck/build and surface
    // structured errors. Optional args override the command (e.g. /diag npm run build).
    if (parsed.name === "diagnostics" || parsed.name === "diag") {
      const command = parsed.args.join(" ").trim() || undefined;
      this.addSystem(`Running diagnostics: ${command || "npx tsc --noEmit"} …`);
      try {
        const { ok, diagnostics } = await runDiagnostics(this.projectRoot, { command });
        if (ok && diagnostics.length === 0) {
          this.addSystem("No problems found.");
        } else {
          this.addSystem(formatDiagnostics(diagnostics));
        }
      } catch (err) {
        this.addError(`Diagnostics failed: ${(err as Error).message}`);
      }
      return;
    }

    if (parsed.name === "context") {
      const cm = this.getContextManager();
      const msgs = cm.getMessages();
      const totalChars = msgs.reduce((sum, m) => sum + m.content.length, 0);
      this.addSystem(
        [
          "Context:",
          `  Messages: ${msgs.length}`,
          `  Size: ~${Math.ceil(totalChars / 4)} tokens`,
          "  Auto-compacts as it fills.",
        ].join("\n")
      );
      return;
    }

    if (parsed.name === "connect" || parsed.name === "setup") {
      this.addSystem(
        [
          "Connect an AI provider:",
          "  Wizard:  run  node dist/cli.js setup  in a terminal",
          "  Env var: set ZAI_API_KEY=your-key  (or ANTHROPIC_API_KEY / OPENAI_API_KEY)",
          "  Config:  add a provider block to sentinel.json",
          "  Then switch with:  /model zai/glm-4.6",
        ].join("\n")
      );
      return;
    }

    if (parsed.name === "theme") {
      const name = parsed.args[0];
      if (!name) {
        let list = "Themes:\n";
        for (const t of themeEngine.getAllThemes()) {
          const cur = t.name === themeEngine.getTheme().name ? "  ←" : "";
          list += `  ${t.name.padEnd(12)} ${t.display}${cur}\n`;
        }
        this.addSystem(list.trimEnd());
        return;
      }
      if (themeEngine.setTheme(name)) {
        state.set("currentTheme", name);
        this.addSystem(`Theme → ${themeEngine.getTheme().display}`);
      } else {
        this.addError(`Unknown theme: ${name}`);
      }
      return;
    }

    if (parsed.name === "permissions" || parsed.name === "perms") {
      const mode = parsed.args[0];
      if (!mode) {
        this.addSystem(`Permission mode: ${this.permissionMode}  (yolo | auto | gated | plan)`);
        return;
      }
      if (mode === "yolo" || mode === "auto" || mode === "gated" || mode === "plan") {
        this.permissionMode = mode;
        this.addSystem(`Permission mode → ${mode}`);
      } else {
        this.addError(`Unknown mode: ${mode}. Use yolo | auto | gated | plan.`);
      }
      return;
    }

    // /plan toggles read-only research mode; /plan off restores yolo.
    if (parsed.name === "plan") {
      if (parsed.args[0] === "off") {
        this.permissionMode = "yolo";
        this.addSystem("Plan mode off → yolo. Edits/commands re-enabled.");
      } else {
        this.permissionMode = "plan";
        this.addSystem("Plan mode on (read-only). I'll research and propose a plan; edits/commands are blocked until you `/plan off`.");
      }
      return;
    }

    // /bg <cmd> runs a shell command in the background; /bg cancel <id> stops it.
    if (parsed.name === "bg") {
      if (parsed.args[0] === "cancel") {
        const id = parsed.args[1];
        if (!id) return void this.addError("Usage: /bg cancel <id>");
        this.addSystem(this.background.cancel(id) ? `bg #${id} cancelled.` : `No running bg task #${id}.`);
        return;
      }
      const command = parsed.args.join(" ").trim();
      if (!command) return void this.addSystem("Usage: /bg <shell command>   ·   /bg cancel <id>   ·   /tasks");
      this.wireBackground();
      const task = this.background.start(command, (signal) => this.runShell(command, signal));
      this.addSystem(`▶ bg #${task.id} started: ${command}`);
      return;
    }

    // /tasks lists background tasks and their status.
    if (parsed.name === "tasks") {
      const tasks = this.background.list();
      if (tasks.length === 0) return void this.addSystem("No background tasks. Start one with /bg <command>.");
      const mark: Record<string, string> = { running: "▶", done: "✓", error: "✗", cancelled: "∅" };
      this.addSystem(
        "Background tasks:\n" +
          tasks.map((t) => `${mark[t.status] || "?"} #${t.id} [${t.status}] ${t.label}`).join("\n")
      );
      return;
    }

    if (parsed.name === "mcp") {
      if (!this.mcpConnected) {
        this.addSystem("MCP connects on your first message. Send one, then run /mcp.");
        return;
      }
      const tools = this.mcp.list();
      if (tools.length === 0) {
        this.addSystem("No MCP tools (no servers configured or none discovered).");
        return;
      }
      let msg = `MCP tools (${tools.length}):\n`;
      for (const t of tools) msg += `  mcp__${t.server}__${t.tool}\n`;
      this.addSystem(msg.trimEnd());
      return;
    }

    if (parsed.name === "marketplace" || parsed.name === "market") {
      await this.handleMarketplace(parsed.args);
      return;
    }

    if (parsed.name === "checkpoints") {
      const cps = new CheckpointManager(this.projectRoot).list();
      if (cps.length === 0) {
        this.addSystem("No checkpoints yet. They're created when the agent edits files.");
        return;
      }
      let msg = `Checkpoints (${cps.length}, newest last):\n`;
      for (const c of cps) {
        msg += `  ${c.id}  ${c.tool.padEnd(6)} ${c.existed ? "edit  " : "create"}  ${c.path}\n`;
      }
      this.addSystem(msg.trimEnd());
      return;
    }

    if (parsed.name === "undo") {
      const cp = new CheckpointManager(this.projectRoot).undoLast();
      if (!cp) {
        this.addSystem("Nothing to undo.");
        return;
      }
      this.addSystem(`Undid ${cp.tool} ${cp.existed ? "edit" : "create"} of ${cp.path}`);
      return;
    }

    if (parsed.name === "agent") {
      const name = parsed.args[0];
      if (!name) {
        this.addSystem(`Agent: ${state.get("currentAgent")}`);
        return;
      }
      state.set("currentAgent", name);
      events.emit("agent:switched", name);
      const activeId = sessionManager.getActiveSessionId();
      if (activeId) sessionManager.updateSessionAgent(activeId, name);
      this.addSystem(`Agent → ${name}`);
      return;
    }

    if (parsed.name === "model") {
      const name = parsed.args[0];
      if (!name) {
        this.addSystem(`Model: ${state.get("currentModel")}`);
        return;
      }
      state.set("currentModel", name);
      events.emit("model:changed", name);
      const activeId = sessionManager.getActiveSessionId();
      if (activeId) sessionManager.updateSessionModel(activeId, name);
      this.addSystem(`Model → ${name}`);
      return;
    }

    if (parsed.name === "providers") {
      const available = providerManager.getAvailableProviderNames();
      let msg = "Providers:\n";
      for (const name of providerManager.getAllProviderNames()) {
        msg += `  ${name.padEnd(12)} ${available.includes(name) ? "ok" : "no key"}\n`;
      }
      this.addSystem(msg.trimEnd());
      return;
    }

    if (parsed.name === "tabs") {
      handleTabsCommand(this.slashCtx(), parsed.args);
      return;
    }

    if (parsed.name === "cmd") {
      await this.handleCmdSearch(parsed.args.join(" "));
      return;
    }

    // /palette [query] (alias /p) — searchable text command palette (V13).
    if (parsed.name === "palette" || parsed.name === "p") {
      const query = parsed.args.join(" ").trim();
      const matches = searchCatalog(query);
      if (matches.length === 0) {
        this.addSystem(`No commands match: ${query}`);
        return;
      }
      const width = Math.max(...matches.map((m) => m.command.length));
      const header = query ? `Palette — ${matches.length} match(es) for "${query}":` : "Palette:";
      const lines = matches.map((m) => `  ${m.command.padEnd(width)} — ${m.description}`);
      this.addSystem([header, ...lines].join("\n"));
      return;
    }

    // /index — build the lite TF-IDF repo index (V11).
    if (parsed.name === "index") {
      this.repoIndex = buildIndex(this.projectRoot);
      const note = this.repoIndex.truncated ? " (truncated — file cap hit)" : "";
      this.addSystem(`Indexed ${this.repoIndex.fileCount} file(s)${note}.`);
      return;
    }

    // /search <query> — semantic search over the repo index (builds it first if needed).
    if (parsed.name === "search") {
      const query = parsed.args.join(" ").trim();
      if (!query) {
        this.addSystem("Usage: /search <query>");
        return;
      }
      if (!this.repoIndex) {
        this.repoIndex = buildIndex(this.projectRoot);
        this.addSystem(`Built index of ${this.repoIndex.fileCount} file(s).`);
      }
      const results = searchRepoIndex(this.repoIndex, query, 8);
      if (results.length === 0) {
        this.addSystem(`No matches for: ${query}`);
        return;
      }
      let msg = `Top ${results.length} result(s) for "${query}":\n`;
      for (const r of results) {
        msg += `  ${r.path}  (${r.score.toFixed(3)})\n`;
        if (r.snippet) msg += `      ${r.snippet}\n`;
      }
      this.addSystem(msg.trimEnd());
      return;
    }

    // /workflow — saved, parameterized workflows (Warp Drive, V5).
    if (parsed.name === "workflow") {
      const sub = (parsed.args[0] || "").toLowerCase();

      if (!sub || sub === "list") {
        const wfs = listWorkflows(this.projectRoot);
        if (wfs.length === 0) {
          this.addSystem(
            "No workflows yet. Save one with:\n  /workflow save <name> <step1> ; <step2> ..."
          );
          return;
        }
        let msg = `Workflows (${wfs.length}):\n`;
        for (const wf of wfs) {
          const desc = wf.description ? ` — ${wf.description}` : "";
          msg += `  ${wf.name.padEnd(16)} ${wf.steps.length} step(s)${desc}\n`;
        }
        this.addSystem(msg.trimEnd());
        return;
      }

      if (sub === "save") {
        const name = parsed.args[1];
        if (!name) {
          this.addSystem("Usage: /workflow save <name> <step1> ; <step2> ...");
          return;
        }
        const rest = parsed.args.slice(2).join(" ").trim();
        const steps = rest
          .split(" ; ")
          .map((s) => s.trim())
          .filter(Boolean);
        if (steps.length === 0) {
          this.addSystem("Usage: /workflow save <name> <step1> ; <step2> ...");
          return;
        }
        try {
          saveWorkflow(this.projectRoot, { name, steps });
          this.addSystem(`Saved workflow "${name}" (${steps.length} step(s)).`);
        } catch (err) {
          this.addError(
            `Failed to save workflow: ${err instanceof Error ? err.message : String(err)}`
          );
        }
        return;
      }

      if (sub === "delete") {
        const name = parsed.args[1];
        if (!name) {
          this.addSystem("Usage: /workflow delete <name>");
          return;
        }
        this.addSystem(
          deleteWorkflow(this.projectRoot, name)
            ? `Deleted workflow "${name}".`
            : `No workflow named "${name}".`
        );
        return;
      }

      if (sub === "run") {
        const name = parsed.args[1];
        if (!name) {
          this.addSystem("Usage: /workflow run <name> [args...]");
          return;
        }
        const wf = getWorkflow(this.projectRoot, name);
        if (!wf) {
          this.addError(`No workflow named "${name}". Try /workflow list`);
          return;
        }
        const rendered = renderSteps(wf, parsed.args.slice(2));
        const composed =
          "Execute this workflow:\n" +
          rendered.map((step, i) => `${i + 1}. ${step}`).join("\n");
        this.addSystem(`▶ Running workflow "${name}" (${rendered.length} step(s))...`);
        await this.chatWithAI(composed);
        return;
      }

      this.addSystem(
        "Usage: /workflow list  ·  /workflow save <name> <step1> ; <step2> ...  ·  /workflow run <name> [args...]  ·  /workflow delete <name>"
      );
      return;
    }

    // /sync — V19 portable settings bundle. `export [path]` writes the (redacted)
    // global config + project skills/workflows to a JSON file; `import <path>`
    // restores skills + workflows from one. Secrets are stripped on export and the
    // global config is never overwritten on import.
    if (parsed.name === "sync") {
      const sub = (parsed.args[0] || "").toLowerCase();

      if (!sub || sub === "export") {
        const rawPath = parsed.args.slice(1).join(" ").trim() || "sentinel-sync.json";
        const outPath = isAbsolute(rawPath) ? rawPath : resolve(this.projectRoot, rawPath);
        try {
          const bundle = buildBundle(this.projectRoot);
          writeBundle(outPath, bundle);
          const parts: string[] = [];
          parts.push(bundle.config ? "config (secrets redacted)" : "no config");
          parts.push(`${Object.keys(bundle.skills ?? {}).length} skill(s)`);
          parts.push(`${Object.keys(bundle.workflows ?? {}).length} workflow(s)`);
          this.addSystem(`Exported sync bundle → ${outPath}\n  ${parts.join("  ·  ")}`);
        } catch (err) {
          this.addError(
            `Sync export failed: ${err instanceof Error ? err.message : String(err)}`
          );
        }
        return;
      }

      if (sub === "import") {
        const rawPath = parsed.args.slice(1).join(" ").trim();
        if (!rawPath) {
          this.addSystem("Usage: /sync import <path>");
          return;
        }
        const inPath = isAbsolute(rawPath) ? rawPath : resolve(this.projectRoot, rawPath);
        try {
          const bundle = readBundle(inPath);
          const applied = applyBundle(this.projectRoot, bundle);
          const summary =
            applied.length > 0
              ? `Applied ${applied.length} item(s):\n  ${applied.join("\n  ")}`
              : "Nothing to apply (bundle had no skills or workflows).";
          const note = bundle.config
            ? "\nNote: the bundle's global config was NOT applied (review it manually)."
            : "";
          this.addSystem(`Imported sync bundle ← ${inPath}\n${summary}${note}`);
        } catch (err) {
          this.addError(
            `Sync import failed: ${err instanceof Error ? err.message : String(err)}`
          );
        }
        return;
      }

      this.addSystem("Usage: /sync export [path]  ·  /sync import <path>");
      return;
    }

    // /pipeline — V9 deterministic pipeline engine. Steps defined in a JSON file
    // run in order; consecutive `parallel:true` steps run concurrently. Each step
    // is delegated to an isolated subagent and may reference prior step results.
    if (parsed.name === "pipeline") {
      const sub = (parsed.args[0] || "").toLowerCase();
      const rawPath = parsed.args.slice(1).join(" ").trim();
      if (sub !== "run" || !rawPath) {
        this.addSystem("Usage: /pipeline run <path.json>");
        return;
      }
      const filePath = isAbsolute(rawPath) ? rawPath : resolve(this.projectRoot, rawPath);
      let pipeline: Pipeline;
      try {
        pipeline = parsePipeline(readFileSync(filePath, "utf8"));
      } catch (err) {
        this.addError(
          `Pipeline load failed: ${err instanceof Error ? err.message : String(err)}`
        );
        return;
      }
      await this.runPipelineDelegated(pipeline);
      return;
    }

    // /ship — V8 autonomous GSD pipeline: plan → implement → test → review → fix.
    // Each phase is delegated to an isolated subagent that sees the task + all prior
    // phase outputs; fix runs only when the review signals a problem.
    if (parsed.name === "ship") {
      const task = parsed.args.join(" ").trim();
      if (!task) {
        this.addSystem("Usage: /ship <task>  — autonomously plan, implement, test, review, and fix");
        return;
      }
      await this.runGsdDelegated(task);
      return;
    }

    if (parsed.name === "ask-prime") {
      const question = parsed.args.join(" ").trim();
      if (!question) {
        this.addSystem("Usage: /ask-prime <question>");
        return;
      }
      const prime = providerManager.getProvider("sentinel-prime");
      if (!prime || !prime.isAvailable()) {
        this.addError(
          "Sentinel Prime not configured — add a `sentinel-prime` provider in config."
        );
        return;
      }
      try {
        const res = await prime.chat([{ role: "user", content: question }], {
          model: "hermes-agent",
        });
        this.addSystem(res.content || "(no answer)");
      } catch (err) {
        this.addError(`Sentinel Prime error: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (parsed.name === "describe") {
      const imagePath = parsed.args[0];
      if (!imagePath) {
        this.addSystem('Usage: /describe <imagePath> [prompt]');
        return;
      }
      const prompt = parsed.args.slice(1).join(" ").trim() || "Describe this image in detail.";

      let att;
      try {
        att = loadAttachment(resolve(this.projectRoot, imagePath));
      } catch (err) {
        this.addError(err instanceof Error ? err.message : String(err));
        return;
      }

      const [providerName, ...modelParts] = state.get("currentModel").split("/");
      const modelName = modelParts.join("/") || undefined;
      const provider = providerManager.getProvider(providerName);
      if (!provider) {
        this.addError(`No provider "${providerName}". Try /providers`);
        return;
      }
      if (!provider.isAvailable()) {
        this.addError(`No API key for "${providerName}". Type /connect`);
        return;
      }

      this.addSystem(`Describing ${att.name} with ${state.get("currentModel")}...`);
      try {
        const res = await provider.chat([buildVisionMessage(prompt, [att])], {
          model: modelName,
        });
        this.addSystem(res.content || "(no description)");
      } catch (err) {
        this.addError(`Vision error: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (parsed.name === "workspace" || parsed.name === "ws") {
      handleWorkspaceCommand(this.slashCtx(), parsed.args);
      return;
    }

    if (parsed.name === "team") {
      handleTeamCommand(this.slashCtx(), parsed.args);
      return;
    }

    const cmd = commandRegistry.get(parsed.name);
    if (cmd) {
      await this.chatWithAI(resolveTemplate(cmd.template, parsed.args));
      return;
    }

    this.addError(`Unknown command: /${parsed.name}. Type / to see commands.`);
  }

  /**
   * /marketplace (alias /market) — V15 extension registry client.
   *   list [source]            — show every entry in a registry
   *   search <query> [source]  — filter entries by id/name/description
   *   install <id> [source]    — install a skill (.md) or MCP server config
   * `source` defaults to DEFAULT_MARKETPLACE_SOURCE; may be a local path or URL.
   */
  private async handleMarketplace(args: string[]): Promise<void> {
    const sub = (args[0] || "").toLowerCase();
    const usage =
      "Usage: /marketplace list [source]  ·  /marketplace search <query> [source]  ·  /marketplace install <id> [source]";

    if (!sub) {
      this.addSystem(usage);
      return;
    }

    // Resolve a source token against the project root when it's a relative path;
    // URLs and absolute paths pass through.
    const resolveSource = (token?: string): string => {
      const src = token || DEFAULT_MARKETPLACE_SOURCE;
      if (/^https?:\/\//i.test(src) || isAbsolute(src)) return src;
      return resolve(this.projectRoot, src);
    };

    const loadRegistry = async (source: string) => fetchRegistry(source);

    if (sub === "list") {
      const source = resolveSource(args[1]);
      try {
        const reg = await loadRegistry(source);
        if (reg.entries.length === 0) {
          this.addSystem("Marketplace registry is empty.");
          return;
        }
        let msg = `Marketplace (${reg.entries.length} entr${reg.entries.length === 1 ? "y" : "ies"}):\n`;
        for (const e of reg.entries) {
          msg += `  ${e.id.padEnd(20)} [${e.type}] ${e.name}${e.description ? ` — ${e.description}` : ""}\n`;
        }
        this.addSystem(msg.trimEnd());
      } catch (err) {
        this.addError(`Marketplace list failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (sub === "search") {
      const query = (args[1] || "").trim();
      if (!query) {
        this.addSystem("Usage: /marketplace search <query> [source]");
        return;
      }
      const source = resolveSource(args[2]);
      try {
        const reg = await loadRegistry(source);
        const hits = searchRegistry(reg, query);
        if (hits.length === 0) {
          this.addSystem(`No marketplace entries match "${query}".`);
          return;
        }
        let msg = `${hits.length} match${hits.length === 1 ? "" : "es"} for "${query}":\n`;
        for (const e of hits) {
          msg += `  ${e.id.padEnd(20)} [${e.type}] ${e.name}${e.description ? ` — ${e.description}` : ""}\n`;
        }
        this.addSystem(msg.trimEnd());
      } catch (err) {
        this.addError(`Marketplace search failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (sub === "install") {
      const id = (args[1] || "").trim();
      if (!id) {
        this.addSystem("Usage: /marketplace install <id> [source]");
        return;
      }
      const source = resolveSource(args[2]);
      try {
        const reg = await loadRegistry(source);
        const entry = reg.entries.find((e) => e.id === id);
        if (!entry) {
          this.addError(`No marketplace entry with id "${id}". Try /marketplace list`);
          return;
        }
        // installEntry never throws on network failure — it returns a status string.
        const summary = await installEntry(this.projectRoot, entry);
        this.addSystem(summary);
        if (entry.type === "mcp") {
          this.addSystem(
            "MCP server recorded in .sentinel/mcp.install.json. Merge it into your config.mcp and restart to connect."
          );
        } else {
          this.addSystem("Skill installed. It loads on next start (or restart the session).");
        }
      } catch (err) {
        this.addError(`Marketplace install failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    this.addSystem(usage);
  }


  /** /cmd <natural language> — AI command-search: NL → one shell command. */
  private async handleCmdSearch(nl: string): Promise<void> {
    const query = nl.trim();
    if (!query) {
      this.addSystem("Usage: /cmd <natural language>  e.g. /cmd list the 5 largest files");
      return;
    }

    const [providerName, ...modelParts] = state.get("currentModel").split("/");
    const modelName = modelParts.join("/") || undefined;
    const provider = providerManager.getProvider(providerName);
    if (!provider) {
      this.addError(`No provider "${providerName}". Try /providers`);
      return;
    }
    if (!provider.isAvailable()) {
      this.addError(`No API key for "${providerName}". Type /connect`);
      return;
    }

    this.addSystem(`Searching for a command for: ${query}`);
    try {
      const { command, explanation } = await suggestCommand(provider, query, {
        model: modelName,
      });
      if (!command) {
        this.addSystem(
          explanation
            ? `No command produced. ${explanation}`
            : "No command produced."
        );
        return;
      }
      let msg = `Suggested command:\n  ${command}`;
      if (explanation) msg += `\n\n${explanation}`;
      msg += `\n\nRun it with /bg ${command}  — or copy/paste it into your shell.`;
      this.addSystem(msg);
    } catch (err) {
      this.addError(
        `Command search failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }


  private getSystemPrompt(): string {
    const agentName = state.get("currentAgent");
    return buildSystemPrompt(agentName, this.projectRoot);
  }

  /** Interactive permission prompt: resolves when the user presses y/N. */
  private askPermission(req: PermissionRequest, reason: string): Promise<boolean> {
    const c = themeEngine.getBlessedColors();
    const label = `${req.tool}${req.action ? `(${req.action})` : ""}`;
    this.push(
      `\n{${c.amber}-fg}{bold}⚠ Permission{/} allow {bold}${this.esc(label)}{/}? ` +
        `{${c.textTertiary}-fg}[y/N] (${this.esc(reason)}){/}\n`
    );
    return new Promise((resolve) => {
      this.pendingPermission = resolve;
    });
  }

  private async chatWithAI(userMessage: string): Promise<void> {
    this.isProcessing = true;
    state.set("isProcessing", true);
    this.renderInput();

    const cm = this.getContextManager();
    const [providerName, ...modelParts] = state.get("currentModel").split("/");
    const modelName = modelParts.join("/") || undefined;

    try {
      const config = getConfigManager().getAll();

      // R3: connect MCP servers once, then expose their tools to the agent.
      if (!this.mcpConnected) {
        this.mcpConnected = true;
        try {
          await this.mcp.connect((config.mcp as Record<string, never>) || {});
        } catch {
          // non-fatal: continue with built-in tools only
        }
      }

      const agentName = state.get("currentAgent");
      let provider;
      let runnerModel = modelName;
      if (config.router) {
        provider = new RoutedProvider(config.router, agentName);
        runnerModel = undefined;
      } else {
        const single = providerManager.getProvider(providerName);
        if (!single) throw new Error(`No provider "${providerName}". Try /providers`);
        if (!single.isAvailable()) throw new Error(`No API key for "${providerName}". Type /connect`);
        provider = single;
      }

      cm.setSystemPrompt(buildSystemPrompt(agentName, this.projectRoot));

      // R2: permission gating + checkpoints, composed over R3 MCP routing.
      const engine = new PermissionEngine(this.permissionMode, config.permissions as never, this.projectRoot);
      const checkpoints = new CheckpointManager(this.projectRoot);
      const mcpAware = createMcpAwareExecutor(this.mcp, executeToolCall);
      const execute = createGuardedExecutor({
        engine,
        checkpoints,
        baseExecute: mcpAware,
        ask: (req, reason) => this.askPermission(req, reason),
      });

      // V1: subagent delegation — child reuses the guarded executor, omits the
      // subagent tool (depth capped at 1).
      const childToolDefs = [...getToolDefinitions(), ...this.mcp.getToolDefs()];
      const subagentTool = createSubagentTool({
        provider,
        toolDefs: childToolDefs,
        executeTool: execute,
        extractToolCalls,
        model: runnerModel,
        systemPrompt: buildSystemPrompt(agentName, this.projectRoot),
      });
      const subagentExecute = createSubagentAwareExecutor(subagentTool, execute);
      // V1: todo tracker — render the board in the TUI whenever it changes.
      const todoTool = createTodoTool();
      todoTool.store.onChange((items) => {
        if (items.length) this.addSystem(todoTool.store.render());
      });
      const parentExecute = createTodoAwareExecutor(todoTool, subagentExecute);

      // V7: user-defined shell hooks fire around every tool call. Outermost
      // layer so they observe built-in, MCP, subagent, and todo tools alike.
      const topExecute = config.hooks
        ? createHookAwareExecutor(config.hooks, parentExecute, defaultRunShell)
        : parentExecute;

      const autoCfg: import("../core/types.js").AutonomousConfig = config.autonomous || {
        enabled: false, maxRounds: 15, budgetUSD: 0, selfEvaluation: true,
        completionDetection: true, stuckDetection: true, stuckThreshold: 3,
        verificationCommands: [],
      };
      const isAutonomous = autoCfg.enabled && agentName === "gsd";

      const runner = new AgentRunner(
        {
          provider,
          context: cm,
          toolDefs: [...childToolDefs, subagentTool.def, todoTool.def],
          executeTool: topExecute,
          extractToolCalls,
          runVerification: async () => {
            const cmd = autoCfg.verificationCommands?.[0];
            const r = await runDiagnostics(this.projectRoot, cmd ? { command: cmd } : {});
            return { ok: r.ok, output: formatDiagnostics(r.diagnostics) };
          },
          compactContext: async () => {
            // Only when the context is getting full — then summarize the older
            // turns with the model (preserving decisions/files/open problems)
            // instead of the lossy char-slice fallback.
            if (cm.getContextUtilization() < 0.8) return false;
            await cm.compactWithLLM(async (texts) => {
              const resp = await provider.chatStream(
                [{
                  role: "user",
                  content:
                    "Summarize this conversation excerpt concisely. Preserve the task/goal, " +
                    "decisions made, files changed, and any unresolved problems; omit chit-chat.\n\n" +
                    texts.join("\n"),
                }],
                { model: runnerModel, temperature: 0.3, maxTokens: 400 }
              );
              return resp.content || "";
            });
            return true;
          },
        },
        {
          model: runnerModel,
          maxRounds: isAutonomous ? (autoCfg.maxRounds || 50) : (agentName === "gsd" ? 30 : 15),
          largeContextWarnAt: 50,
          selfEvaluation: isAutonomous && autoCfg.selfEvaluation !== false,
          stuckDetection: isAutonomous && autoCfg.stuckDetection !== false,
          stuckThreshold: autoCfg.stuckThreshold || 3,
          budgetUSD: autoCfg.budgetUSD || 0,
          getEstimatedCost: () => usageTracker.snapshot().estimatedCostUSD,
          verifyOnComplete: isAutonomous && autoCfg.verifyOnComplete !== false,
          maxVerifyRetries: autoCfg.maxVerifyRetries,
        }
      );

      this.ac = new AbortController();
      runner.on("roundStart", () => this.startAssistant());
      runner.on("token", (t) => this.streamAssistant(t));
      runner.on("streamEnd", () => this.endAssistant());
      runner.on("usage", (u) => {
        this.updateCost(u);
        usageTracker.recordTokens(u); // V17: also feed the observability tracker
        // V17+pricing: attribute real per-model cost so /usage shows $ spend.
        usageTracker.recordCostUSD(estimateCostUSD(state.get("currentModel"), u.promptTokens, u.completionTokens));
      });
      runner.on("toolStart", (_name, args) => {
        this.pendingToolArgs = args;
      });
      runner.on("toolResult", (name, ok, firstLine) => {
        usageTracker.recordTool(name, ok); // V17: per-tool metrics
        this.addTool(name, this.truncateArgs(this.pendingToolArgs), ok, firstLine);
      });
      runner.on("contextLarge", () =>
        this.addSystem("Context is getting large — /compact to save tokens.")
      );
      runner.on("runError", (e) => {
        this.endAssistant();
        this.addError(e instanceof Error ? e.message : String(e));
      });
      runner.on("selfEvaluation", (a) => this.addSystem(`Self-eval: ${a}`));
      runner.on("taskComplete", (r) => this.addSystem(`Task complete: ${r}`));
      runner.on("budgetExceeded", (c, b) =>
        this.addSystem(`Budget exceeded: $${c.toFixed(4)} / $${b.toFixed(2)}`)
      );
      runner.on("stuckDetected", (name, n) =>
        this.addSystem(`Stuck on ${name} (${n}x) — trying different approach`)
      );
      runner.on("verifyFailed", () =>
        this.addSystem("Verification found problems — feeding them back to fix…")
      );
      runner.on("verifyPassed", () => this.addSystem("Verification passed ✓"));
      runner.on("compacted", () => this.addSystem("Context compacted (summarized older turns)."));
      runner.on("retry", (attempt, delayMs, err) =>
        this.addSystem(
          `Transient error (${err instanceof Error ? err.message.slice(0, 80) : String(err)}) — ` +
          `retry ${attempt} in ${Math.round(delayMs)}ms`
        )
      );

      // V2: expand @file / @url mentions into the message before the agent runs.
      let outbound = await expandMentions(userMessage, this.projectRoot);
      // V3: auto-recall relevant memories from the Sentinel Prime brain (when its
      // MCP server is connected). Read-only, so it bypasses the permission guard.
      if (this.mcp.has(DEFAULT_RECALL_TOOL)) {
        try {
          outbound += await recallRelevant(mcpAware, userMessage);
        } catch {
          // recall is best-effort; never block the turn on it
        }
      }
      await runner.run(outbound, this.ac.signal);

      const activeId = sessionManager.getActiveSessionId();
      if (activeId) sessionManager.markDirty(activeId);
    } catch (err) {
      this.endAssistant();
      // Auto-switch to small_model on persistent rate limits so the next message works
      if (err instanceof ProviderError && err.status === 429) {
        const cfg = getConfigManager().getAll();
        const fallback = cfg.small_model as string | undefined;
        const current = state.get("currentModel");
        if (fallback && fallback !== current) {
          this.addSystem(`Rate limited on ${current}. Switching to ${fallback} — your next message will use the fallback model.`);
          state.set("currentModel", fallback);
        } else {
          this.addError(`Rate limited on ${current}. Try again in a few minutes or switch models with /model.`);
        }
      } else {
        this.addError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      this.ac = undefined;
      this.isProcessing = false;
      state.set("isProcessing", false);
      this.renderInput();
    }
  }

  /**
   * V9: run a parsed pipeline by delegating each step to an isolated subagent.
   * Uses the pure `runPipeline` engine (sequential by default; consecutive
   * `parallel:true` steps run concurrently). Each step's subagent receives the
   * prior steps' results as context, and a per-step error is recorded without
   * aborting the rest of the pipeline.
   */
  private async runPipelineDelegated(pipeline: Pipeline): Promise<void> {
    this.isProcessing = true;
    state.set("isProcessing", true);
    this.renderInput();

    try {
      const config = getConfigManager().getAll();
      const [providerName, ...modelParts] = state.get("currentModel").split("/");
      const modelName = modelParts.join("/") || undefined;
      const agentName = state.get("currentAgent");

      // Connect MCP once (mirrors chatWithAI) so subagents see MCP tools too.
      if (!this.mcpConnected) {
        this.mcpConnected = true;
        try {
          await this.mcp.connect((config.mcp as Record<string, never>) || {});
        } catch {
          // non-fatal: continue with built-in tools only
        }
      }

      let provider;
      let runnerModel = modelName;
      if (config.router) {
        provider = new RoutedProvider(config.router, agentName);
        runnerModel = undefined;
      } else {
        const single = providerManager.getProvider(providerName);
        if (!single) throw new Error(`No provider "${providerName}". Try /providers`);
        if (!single.isAvailable()) throw new Error(`No API key for "${providerName}". Type /connect`);
        provider = single;
      }

      // Same guarded + MCP-aware executor stack the main loop uses.
      const engine = new PermissionEngine(this.permissionMode, config.permissions as never, this.projectRoot);
      const checkpoints = new CheckpointManager(this.projectRoot);
      const mcpAware = createMcpAwareExecutor(this.mcp, executeToolCall);
      const execute = createGuardedExecutor({
        engine,
        checkpoints,
        baseExecute: mcpAware,
        ask: (req, reason) => this.askPermission(req, reason),
      });
      const childToolDefs = [...getToolDefinitions(), ...this.mcp.getToolDefs()];
      const subagentTool = createSubagentTool({
        provider,
        toolDefs: childToolDefs,
        executeTool: execute,
        extractToolCalls,
        model: runnerModel,
        systemPrompt: buildSystemPrompt(agentName, this.projectRoot),
      });

      this.addSystem(`▶ Running pipeline "${pipeline.name}" (${pipeline.steps.length} step(s))...`);

      const results = await runPipeline(
        pipeline,
        async (step, prior) => {
          const priorBlock = prior.length
            ? "Prior step results:\n" +
              prior.map((r) => `### ${r.name}\n${r.result}`).join("\n\n")
            : "";
          return subagentTool.execute({
            task: step.prompt,
            context: priorBlock || undefined,
          });
        },
        {
          onStepStart: (s) =>
            this.addSystem(`  • step "${s.name}"${s.parallel ? " (parallel)" : ""}...`),
        }
      );

      let summary = `Pipeline "${pipeline.name}" complete (${results.length} step(s)):\n`;
      for (const r of results) {
        const first = r.result.split("\n")[0].slice(0, 200);
        summary += `  ${r.result.startsWith("ERROR") ? "✗" : "✓"} ${r.name}: ${first}\n`;
      }
      this.addSystem(summary.trimEnd());

      const activeId = sessionManager.getActiveSessionId();
      if (activeId) sessionManager.markDirty(activeId);
    } catch (err) {
      this.addError(err instanceof Error ? err.message : String(err));
    } finally {
      this.isProcessing = false;
      state.set("isProcessing", false);
      this.renderInput();
    }
  }

  /**
   * V8: run the autonomous GSD pipeline (plan → implement → test → review → fix)
   * for a single task. Each phase is delegated to an isolated subagent (same
   * guarded + MCP-aware executor stack the main loop and pipelines use), receiving
   * the task plus all prior phase outputs. After review, a fix phase runs only when
   * the review output signals a problem. Mirrors `runPipelineDelegated`'s wiring.
   */
  private async runGsdDelegated(task: string): Promise<void> {
    this.isProcessing = true;
    state.set("isProcessing", true);
    this.renderInput();

    try {
      const config = getConfigManager().getAll();
      const [providerName, ...modelParts] = state.get("currentModel").split("/");
      const modelName = modelParts.join("/") || undefined;
      const agentName = state.get("currentAgent");

      // Connect MCP once (mirrors chatWithAI) so subagents see MCP tools too.
      if (!this.mcpConnected) {
        this.mcpConnected = true;
        try {
          await this.mcp.connect((config.mcp as Record<string, never>) || {});
        } catch {
          // non-fatal: continue with built-in tools only
        }
      }

      let provider;
      let runnerModel = modelName;
      if (config.router) {
        provider = new RoutedProvider(config.router, agentName);
        runnerModel = undefined;
      } else {
        const single = providerManager.getProvider(providerName);
        if (!single) throw new Error(`No provider "${providerName}". Try /providers`);
        if (!single.isAvailable()) throw new Error(`No API key for "${providerName}". Type /connect`);
        provider = single;
      }

      // Same guarded + MCP-aware executor stack the main loop uses.
      const engine = new PermissionEngine(this.permissionMode, config.permissions as never, this.projectRoot);
      const checkpoints = new CheckpointManager(this.projectRoot);
      const mcpAware = createMcpAwareExecutor(this.mcp, executeToolCall);
      const execute = createGuardedExecutor({
        engine,
        checkpoints,
        baseExecute: mcpAware,
        ask: (req, reason) => this.askPermission(req, reason),
      });
      const childToolDefs = [...getToolDefinitions(), ...this.mcp.getToolDefs()];
      const subagentTool = createSubagentTool({
        provider,
        toolDefs: childToolDefs,
        executeTool: execute,
        extractToolCalls,
        model: runnerModel,
        systemPrompt: buildSystemPrompt(agentName, this.projectRoot),
      });

      this.addSystem(`▶ Shipping: "${task}" — autonomous GSD pipeline (plan → implement → test → review → fix)...`);

      const results = await runGsd(
        task,
        async (phase, t, prior) => {
          const priorBlock = prior.length
            ? prior.map((p) => `### ${p.phase}\n${p.output}`).join("\n\n")
            : undefined;
          return subagentTool.execute({
            task: buildPhasePrompt(phase, t, prior),
            context: priorBlock,
          });
        },
        {
          onPhaseStart: (phase) => this.addSystem(`  • phase "${phase}"...`),
          onPhaseEnd: (r) => {
            const first = r.output.split("\n")[0].slice(0, 200);
            this.addSystem(`    ${r.output.startsWith("ERROR") ? "✗" : "✓"} ${r.phase}: ${first}`);
          },
        }
      );

      let summary = `GSD pipeline complete (${results.length} phase(s)):\n`;
      for (const r of results) {
        const first = r.output.split("\n")[0].slice(0, 200);
        summary += `  ${r.output.startsWith("ERROR") ? "✗" : "✓"} ${r.phase}: ${first}\n`;
      }
      if (!results.some((r) => r.phase === "fix")) {
        summary += "  (review was clean — no fix phase needed)\n";
      }
      this.addSystem(summary.trimEnd());

      const activeId = sessionManager.getActiveSessionId();
      if (activeId) sessionManager.markDirty(activeId);
    } catch (err) {
      this.addError(err instanceof Error ? err.message : String(err));
    } finally {
      this.isProcessing = false;
      state.set("isProcessing", false);
      this.renderInput();
    }
  }

  private extractToolCalls(content: string): ToolCall[] | null {
    if (!content) return null;
    const calls: ToolCall[] = [];
    const patterns: [RegExp, "tool" | "bash"][] = [
      [/```tool\s*\n([\s\S]*?)```/g, "tool"],
      [/```bash\s*\n([\s\S]*?)```/g, "bash"],
    ];
    for (const [re, kind] of patterns) {
      let match;
      while ((match = re.exec(content)) !== null) {
        const body = match[1].trim();
        if (kind === "bash") {
          calls.push({ id: `call_${calls.length}`, name: "bash", arguments: JSON.stringify({ command: body }) });
        } else {
          try {
            const parsed = JSON.parse(body);
            calls.push({
              id: parsed.id || `call_${calls.length}`,
              name: parsed.name,
              arguments: typeof parsed.arguments === "string" ? parsed.arguments : JSON.stringify(parsed.arguments),
            });
          } catch {
            // skip unparseable
          }
        }
      }
    }
    return calls.length > 0 ? calls : null;
  }

  private truncateArgs(argsStr: string): string {
    try {
      const preview = JSON.stringify(JSON.parse(argsStr));
      return preview.length > 80 ? preview.slice(0, 80) + "…" : preview;
    } catch {
      return argsStr.length > 80 ? argsStr.slice(0, 80) + "…" : argsStr;
    }
  }

  private createNewTab(): void {
    const session = sessionManager.createSession({
      projectRoot: this.projectRoot,
    });
    this.tabManager.refresh();
    this.renderer.setTranscript("");
    this.renderer.clearStream();
    this.printWelcome();
    this.addSystem(`Tab "${session.title}" created.`);
  }

  private onTabSwitch(session: Session): void {
    this.renderer.setTranscript("");
    this.renderer.clearStream();

    let rebuilt = "";
    const msgs = session.contextManager.getMessages();
    for (const msg of msgs) {
      const c = themeEngine.getBlessedColors();
      if (msg.role === "user") {
        rebuilt += `\n{${c.cyan}-fg}{bold}You{/}\n${this.esc(msg.content)}\n`;
      } else if (msg.role === "assistant") {
        rebuilt += `\n{${c.lime}-fg}{bold}Sentinel{/}\n${this.esc(msg.content)}\n`;
      } else if (msg.role === "tool") {
        const firstLine = msg.content.split("\n")[0].slice(0, 200);
        rebuilt += `{${c.textTertiary}-fg}${this.esc(firstLine)}{/}\n`;
      }
    }
    this.renderer.setTranscript(rebuilt);

    this.renderer.setCost({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      requests: 0,
      estimatedCostUSD: session.cost.estimatedCostUSD,
    });

    this.refreshStatus();
    this.render();
  }

  private onTabClose(sessionId: string): void {
    sessionManager.closeSession(sessionId);
    this.tabManager.refresh();

    const activeSession = sessionManager.getActiveSession();
    if (activeSession) {
      this.onTabSwitch(activeSession);
    } else {
      this.renderer.setTranscript("");
      this.renderer.clearStream();
      this.printWelcome();
    }
  }

  private setupKeys(): void {
    this.screen.key(["C-q"], () => {
      this.screen.destroy();
      process.exit(0);
    });

    this.screen.key(["C-n"], () => {
      this.createNewTab();
    });

    this.screen.key(["C-w"], () => {
      const activeId = sessionManager.getActiveSessionId();
      if (activeId) this.onTabClose(activeId);
    });

    for (let i = 1; i <= 9; i++) {
      this.screen.key([`C-${i}`], () => {
        this.tabManager.switchToIndex(i - 1);
      });
    }

    this.screen.key(["C-r"], () => {
      this.tabManager.renameCurrentTab();
    });

    // Ctrl+P — command palette (VS Code-style)
    this.screen.key(["C-p"], () => {
      if (this.palette.isOpen()) this.palette.close();
      else this.palette.open();
    });
    // Ctrl+K — also opens palette (legacy binding)
    this.screen.key(["C-k"], () => {
      if (this.palette.isOpen()) this.palette.close();
      else this.palette.open();
    });

    // Ctrl+S — toggle sidebar
    this.screen.key(["C-s"], () => {
      if (!this.sidebarWidget) return;
      if (this.sidebarWidget.hidden) {
        this.sidebarWidget.show();
        this.sidebarWidget.focus();
      } else {
        this.sidebarWidget.hide();
      }
      this.screen.render();
    });

    this.screen.key(["C-t"], () => {
      themeEngine.cycleTheme();
      state.set("currentTheme", themeEngine.getTheme().name);
      this.addSystem(`Theme → ${themeEngine.getTheme().display}`);
    });

    this.screen.key(["C-a"], () => {
      const agents = ["gsd", "code", "ask", "plan", "debug"];
      const cur = state.get("currentAgent");
      const next = agents[(agents.indexOf(cur) + 1) % agents.length];
      state.set("currentAgent", next);
      events.emit("agent:switched", next);
      this.addSystem(`Agent → ${next}`);
    });

    // Ctrl+M — cycle through configured models
    this.screen.key(["C-m"], () => {
      const cfg = getConfigManager().getAll();
      const providerModels: string[] = [];
      const providers = cfg.provider as Record<string, { models?: Record<string, unknown> }> | undefined;
      if (providers) {
        for (const [pname, pcfg] of Object.entries(providers)) {
          if (pcfg?.models) {
            for (const mname of Object.keys(pcfg.models)) {
              providerModels.push(`${pname}/${mname}`);
            }
          }
        }
      }
      if (providerModels.length === 0) return;
      const cur = state.get("currentModel");
      const idx = providerModels.indexOf(cur);
      const next = providerModels[(idx + 1) % providerModels.length];
      state.set("currentModel", next);
      events.emit("model:changed", next);
      this.addSystem(`Model → ${next}`);
    });

    // F4 — todo panel
    this.screen.key(["f4"], () => {
      if (this.todoPanel) this.todoPanel.toggle();
    });

    this.screen.on("resize", () => this.render());
  }

  initSessionManager(): void {
    sessionManager.initialize(this.projectRoot);
    if (sessionManager.getSessionCount() === 0) {
      sessionManager.createSession({
        projectRoot: this.projectRoot,
      });
    }
    sessionManager.syncToState();
  }

  destroy(): void {
    sessionManager.shutdown();
    void this.mcp.disconnect();
    if (this.screen) this.screen.destroy();
  }
}
