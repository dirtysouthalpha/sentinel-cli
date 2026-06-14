import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";
import { state } from "../core/state.js";
import { events } from "../core/events.js";
import { providerManager, providerEnvVar } from "../ai/provider.js";
import { ProviderError } from "../ai/errors.js";
import { ContextManager } from "../ai/context.js";
import { commandRegistry } from "../commands/registry.js";
import { parseCommand, resolveTemplate } from "../commands/loader.js";
import { dispatchCommand, resolveCommand, getHelpGroups, BUILTIN_COMMANDS } from "./commands/registry.js";
import type { CommandContext } from "./commands/context.js";
import { fuzzyFilter } from "../core/fuzzy.js";
import { getToolDefinitions, executeToolCall } from "../tools/tool-executor.js";
import { ToolCall } from "../ai/types.js";
import { AgentRunner } from "../core/agent-runner.js";
import { extractToolCalls } from "../core/tool-call-extractor.js";
import { buildSystemPrompt } from "../core/system-prompt.js";
import { renderMarkdown } from "./render-markdown.js";
// Phase 1: extracted TUI modules
import { InputHandler } from "./input-handler.js";
import { ChatRenderer } from "./chat-renderer.js";
import { CommandPalette } from "./command-palette.js";
// Phase 2: LSP integration — registered centrally in toolManager + TOOL_DEFINITIONS,
// so it flows through getToolDefinitions()/executeToolCall like every other tool.
// Phase 3: todo panel
import { TodoPanel } from "./todo-panel.js";
import { expandMentions } from "../core/mentions.js";
import { runPipeline, type Pipeline } from "../core/pipeline-engine.js";
import { runGsd, buildPhasePrompt } from "../core/gsd.js";
import { RepoIndex } from "../core/repo-index.js";
import { recallRelevant, DEFAULT_RECALL_TOOL } from "../core/brain-recall.js";
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
import { compactionBudget } from "../core/context-window.js";
import { exec } from "child_process";
import { MCPManager } from "../mcp/manager.js";
import { createMcpAwareExecutor } from "../mcp/mcp-executor.js";
import { getConfigManager } from "../core/config.js";
import { createLogger } from "../utils/logger.js";
import { join, resolve } from "node:path";
import { createSidebar } from "./sidebar.js";
import { VERSION } from "../core/version.js";

const log = createLogger({ prefix: "tui" });

/** Actionable "no API key" message that names the exact env var when known. */
function noKeyMessage(providerName: string): string {
  const env = providerEnvVar(providerName);
  return `No API key for "${providerName}". ${env ? `Set ${env} or ` : ""}run /connect`;
}

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

  /** Display form of a command: "/name <usage>" (usage omitted when absent). */
  private commandDisplay(name: string, usage?: string): string {
    return usage ? `/${name} ${usage}` : `/${name}`;
  }

  private showSlashMenu(): void {
    const c = themeEngine.getBlessedColors();

    // Rendered from the live registry (single source of truth) — grouped.
    let s = "";
    for (const { label, commands } of getHelpGroups()) {
      s += `\n{${c.cyan}-fg}{bold}${label}{/}\n`;
      for (const cmd of commands) {
        const display = this.commandDisplay(cmd.name, cmd.usage);
        s += `  {${c.accent}-fg}${display.padEnd(22)}{/} {${c.textTertiary}-fg}${cmd.description}{/}\n`;
      }
    }

    // Markdown template commands (skills) live in a separate registry.
    const cmds = commandRegistry.getAll();
    if (cmds.length > 0) {
      s += `\n{${c.cyan}-fg}{bold}Super Tools{/}\n`;
      for (const cmd of cmds) {
        s += `  {${c.accent}-fg}${`/${cmd.name}`.padEnd(22)}{/} {${c.textTertiary}-fg}${cmd.description}{/}\n`;
      }
    }

    s += `\n{${c.textTertiary}-fg}Tip: /help <command> for details · Ctrl+P for the palette{/}\n`;
    this.push(s);
  }

  /** /help <command> — usage + description for one command, with alias info. */
  private showCommandHelp(name: string): void {
    const c = themeEngine.getBlessedColors();
    const spec = resolveCommand(name);
    if (!spec) {
      this.addError(`Unknown command: /${name}. Type /help to see all commands.`);
      return;
    }
    const lines = [
      `{${c.accent}-fg}{bold}${this.commandDisplay(spec.name, spec.usage)}{/}`,
      `  ${spec.description}`,
    ];
    if (spec.aliases && spec.aliases.length > 0) {
      lines.push(`  {${c.textTertiary}-fg}Aliases: ${spec.aliases.map((a) => `/${a}`).join(", ")}{/}`);
    }
    this.push("\n" + lines.join("\n") + "\n");
  }

  private buildCommandContext(args: string[], commandName: string): CommandContext {
    return {
      projectRoot: this.projectRoot,
      args,
      commandName,
      addSystem: (t) => this.addSystem(t),
      addError: (t) => this.addError(t),
      push: (s) => this.push(s),
      chatWithAI: (m) => this.chatWithAI(m),
      getContextManager: () => this.getContextManager(),
      getCost: () => this.renderer.getCost(),
      getPermissionMode: () => this.permissionMode,
      setPermissionMode: (m) => {
        this.permissionMode = m;
      },
      getRepoIndex: () => this.repoIndex,
      setRepoIndex: (i) => {
        this.repoIndex = i;
      },
      isMcpConnected: () => this.mcpConnected,
      mcp: this.mcp,
      background: this.background,
      wireBackground: () => this.wireBackground(),
      runShell: (c, s) => this.runShell(c, s),
      runPipeline: (pl) => this.runPipelineDelegated(pl),
      runGsd: (task) => this.runGsdDelegated(task),
      slashCtx: () => this.slashCtx(),
      showSlashMenu: () => this.showSlashMenu(),
      showCommandHelp: (name) => this.showCommandHelp(name),
      clearScreen: () => {
        this.renderer.setTranscript("");
        this.renderer.clearStream();
        this.printWelcome();
      },
      quit: () => {
        this.screen.destroy();
        process.exit(0);
      },
    };
  }

  private async handleCommand(input: string): Promise<void> {
    const parsed = parseCommand(input);

    // Built-in slash commands live in src/tui/commands/; dispatchCommand resolves
    // the name (and aliases) and runs the handler against a CommandContext.
    if (await dispatchCommand(parsed.name, this.buildCommandContext(parsed.args, parsed.name))) {
      return;
    }

    // Fall back to markdown template commands, then an unknown-command note.
    const cmd = commandRegistry.get(parsed.name);
    if (cmd) {
      await this.chatWithAI(resolveTemplate(cmd.template, parsed.args));
      return;
    }

    // Unknown — offer the closest matches so a typo is one keystroke from fixed.
    const suggestions = fuzzyFilter(parsed.name, BUILTIN_COMMANDS, (s) => s.name)
      .slice(0, 3)
      .map((r) => `/${r.item.name}`);
    const hint = suggestions.length
      ? ` Did you mean ${suggestions.join(", ")}?`
      : " Type / to see commands.";
    this.addError(`Unknown command: /${parsed.name}.${hint}`);
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
        if (!single.isAvailable()) throw new Error(noKeyMessage(providerName));
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
      // Size the compaction budget to the model's actual context window.
      cm.setMaxTokens(compactionBudget(runnerModel || state.get("currentModel")));
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
        if (!single.isAvailable()) throw new Error(noKeyMessage(providerName));
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
        if (!single.isAvailable()) throw new Error(noKeyMessage(providerName));
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

    // Ctrl+P — command palette (VS Code-style). Note: Ctrl+K is intentionally
    // NOT bound here — it's kill-to-end-of-line in the input handler (readline).
    this.screen.key(["C-p"], () => {
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
