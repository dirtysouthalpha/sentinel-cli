import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";
import { state } from "../core/state.js";
import { events } from "../core/events.js";
import { providerManager } from "../ai/provider.js";
import { ContextManager } from "../ai/context.js";
import { commandRegistry } from "../commands/registry.js";
import { parseCommand, resolveTemplate } from "../commands/loader.js";
import { getToolDefinitions, executeToolCall } from "../tools/tool-executor.js";
import { ToolCall } from "../ai/types.js";
import { AgentRunner } from "../core/agent-runner.js";
import { extractToolCalls } from "../core/tool-call-extractor.js";
import { buildSystemPrompt } from "../core/system-prompt.js";
import { suggestCommand } from "../core/command-search.js";
import { expandMentions } from "../core/mentions.js";
import { recallRelevant, DEFAULT_RECALL_TOOL } from "../core/brain-recall.js";
import { createHeaderBar } from "./header-bar.js";
import { TabManager } from "./tab-manager.js";
import { sessionManager, Session } from "../core/session-manager.js";
import { RoutedProvider } from "../ai/routed-provider.js";
import { PermissionEngine, PermissionMode, PermissionRequest } from "../core/permissions.js";
import { CheckpointManager } from "../core/checkpoints.js";
import { createGuardedExecutor } from "../core/guarded-executor.js";
import { createSubagentTool, createSubagentAwareExecutor } from "../core/subagent.js";
import { createTodoTool, createTodoAwareExecutor } from "../core/todos.js";
import { createHookAwareExecutor, defaultRunShell } from "../core/hooks.js";
import { BackgroundTaskManager } from "../core/background.js";
import { exec } from "child_process";
import { MCPManager } from "../mcp/manager.js";
import { createMcpAwareExecutor } from "../mcp/mcp-executor.js";
import { getConfigManager } from "../core/config.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger({ prefix: "tui" });

const VERSION = "0.2.0";

const BANNER = [
  " ____             _   _            _ ",
  "/ ___|  ___ _ __ | |_(_)_ __   ___| |",
  "\\___ \\ / _ \\ '_ \\| __| | '_ \\ / _ \\ |",
  " ___) |  __/ | | | |_| | | | |  __/ |",
  "|____/ \\___|_| |_|\\__|_|_| |_|\\___|_|",
];

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

  private inputBuffer = "";

  private transcript = "";
  private stream = "";
  private streamHeaderShown = false;

  private cost: CostTracker = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    requests: 0,
    estimatedCostUSD: 0,
  };

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

    this.chat = blessed.box({
      parent: this.screen,
      top: 2,
      left: 0,
      width: "100%",
      bottom: 4,
      scrollable: true,
      alwaysScroll: true,
      mouse: true,
      keys: true,
      vi: true,
      tags: true,
      wrap: true,
      padding: { left: 2, right: 2, top: 0, bottom: 0 },
      scrollbar: {
        ch: " ",
        style: { bg: c.border },
      },
      style: { bg: c.bgPrimary, fg: c.textPrimary },
    });

    this.input = blessed.box({
      parent: this.screen,
      left: 0,
      width: "100%",
      bottom: 1,
      height: 3,
      tags: true,
      border: { type: "line" },
      style: {
        bg: c.bgPrimary,
        fg: c.textPrimary,
        border: { fg: c.border },
      },
    });

    this.status = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: "100%",
      height: 1,
      tags: true,
      style: { bg: c.bgSecondary, fg: c.textSecondary },
    });

    this.printWelcome();
    this.setupRawInput();
    this.setupKeys();
    this.refreshStatus();
    this.renderInput();

    state.subscribe("currentAgent", () => this.refreshStatus());
    state.subscribe("currentModel", () => this.refreshStatus());
    state.subscribe("isProcessing", () => this.refreshStatus());
    state.subscribe("compressionStats", () => this.refreshStatus());
    events.on("theme:changed", () => this.applyTheme());

    this.screen.render();
    log.info("TUI started");
  }

  private esc(s: string): string {
    return s.replace(/\{/g, "{open}").replace(/\}/g, "{close}");
  }

  private render(): void {
    this.chat.setContent(this.transcript + this.stream);
    this.chat.setScrollPerc(100);
    this.screen.render();
  }

  private push(block: string): void {
    this.transcript += block;
    this.render();
  }

  private renderInput(): void {
    const c = themeEngine.getBlessedColors();
    if (this.isProcessing) {
      this.input.setContent(`{${c.textTertiary}-fg}  working… press Ctrl+C to cancel{/}`);
    } else if (this.inputBuffer.length === 0) {
      this.input.setContent(
        `{${c.cyan}-fg}❯{/} {${c.textTertiary}-fg}Message Sentinel, or / for commands{/}`
      );
    } else {
      this.input.setContent(`{${c.cyan}-fg}❯{/} ${this.esc(this.inputBuffer)}{inverse} {/inverse}`);
    }
    this.screen.render();
  }

  private addUser(text: string): void {
    const c = themeEngine.getBlessedColors();
    this.push(`\n{${c.cyan}-fg}{bold}You{/}\n${this.esc(text)}\n`);
  }

  private startAssistant(): void {
    this.stream = "";
    this.streamHeaderShown = false;
  }

  private streamAssistant(token: string): void {
    const c = themeEngine.getBlessedColors();
    if (!this.streamHeaderShown) {
      this.transcript += `\n{${c.lime}-fg}{bold}Sentinel{/}\n`;
      this.streamHeaderShown = true;
    }
    this.stream += this.esc(token);
    this.render();
  }

  private endAssistant(): void {
    if (this.streamHeaderShown) {
      this.transcript += this.stream + "\n";
    }
    this.stream = "";
    this.streamHeaderShown = false;
    this.render();
  }

  private addTool(name: string, args: string, ok: boolean, firstLine: string): void {
    const c = themeEngine.getBlessedColors();
    const mark = ok ? `{${c.lime}-fg}ok{/}` : `{${c.error}-fg}err{/}`;
    this.push(
      `{${c.amber}-fg}» ${name}{/} {${c.textTertiary}-fg}${this.esc(args)}{/}\n` +
        `  ${mark} {${c.textTertiary}-fg}${this.esc(firstLine)}{/}\n`
    );
  }

  private addSystem(text: string): void {
    const c = themeEngine.getBlessedColors();
    const body = text
      .split("\n")
      .map((l) => `{${c.textSecondary}-fg}${this.esc(l)}{/}`)
      .join("\n");
    this.push(`\n${body}\n`);
  }

  /** Register the one-time background-task completion notifier. */
  private wireBackground(): void {
    if (this.bgWired) return;
    this.bgWired = true;
    this.background.onUpdate((t) => {
      if (t.status === "running") return;
      const mark = t.status === "done" ? "✓" : t.status === "error" ? "✗" : "∅";
      const detail =
        t.status === "done"
          ? (t.result || "").split("\n").slice(0, 10).join("\n")
          : t.status === "error"
            ? t.error || ""
            : "";
      this.addSystem(`${mark} bg #${t.id} ${t.status}: ${t.label}${detail ? `\n${detail}` : ""}`);
    });
  }

  /** Run a shell command detached; the AbortSignal kills the process on cancel. */
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

  private addError(text: string): void {
    const c = themeEngine.getBlessedColors();
    this.push(`\n{${c.error}-fg}{bold}✗ ${this.esc(text)}{/}\n`);
  }

  private divider(): void {
    const c = themeEngine.getBlessedColors();
    this.push(`{${c.border}-fg}${"─".repeat(60)}{/}\n`);
  }

  private printWelcome(): void {
    const c = themeEngine.getBlessedColors();
    let s = "\n";
    for (const line of BANNER) {
      s += `  {${c.cyan}-fg}{bold}${line}{/}\n`;
    }
    s += `\n  {${c.magenta}-fg}{bold}The Best Coding CLI on the Planet{/}  {${c.textTertiary}-fg}v${VERSION}{/}\n\n`;

    const available = providerManager.getAvailableProviderNames();
    if (available.length === 0) {
      s += `  {${c.amber}-fg}No API key configured.{/} Type {${c.cyan}-fg}{bold}/connect{/} to get started.\n`;
    } else {
      s += `  {${c.lime}-fg}Connected{/} {${c.textTertiary}-fg}(${available.join(", ")}){/}  Just type and I handle the rest.\n`;
    }
    s += `  {${c.textTertiary}-fg}Type {/}{${c.cyan}-fg}/{/}{${c.textTertiary}-fg} for commands · Ctrl+T theme · Ctrl+A agent · Ctrl+M model · Ctrl+Q quit{/}\n`;
    s += `  {${c.textTertiary}-fg}Ctrl+N new tab · Ctrl+W close tab · Ctrl+Tab next tab · Ctrl+R rename tab{/}\n\n`;
    this.push(s);
    this.divider();
  }

  private refreshStatus(): void {
    const c = themeEngine.getBlessedColors();
    const agent = state.get("currentAgent");
    const model = state.get("currentModel");
    const processing = state.get("isProcessing");
    const theme = themeEngine.getTheme();
    const compressionStats = state.get("compressionStats");
    const cm = this.getContextManager();

    const dot = processing ? `{${c.amber}-fg}{bold}WORKING{/}` : `{${c.lime}-fg}{bold}READY{/}`;
    const modelName = model.split("/").pop() || model;
    const sep = `  {${c.border}-fg}│{/}  `;
    const cost =
      this.cost.requests > 0
        ? `${this.cost.totalTokens.toLocaleString()} tok · $${this.cost.estimatedCostUSD.toFixed(4)}`
        : `${cm.getMessageCount()} msgs`;

    const compression = compressionStats.savingsPercent > 0
      ? `{${c.border}-fg}│{/}  {${c.lime}-fg}${compressionStats.savingsPercent}% compressed{/}`
      : "";

    const tabs = `Tabs: ${sessionManager.getSessionCount()}`;

    this.status.setContent(
      ` ${dot}${sep}${agent}${sep}${modelName}${sep}${theme.display}${sep}{${c.textTertiary}-fg}${cost}{/}${sep}${compression}  {${c.textTertiary}-fg}${tabs}{/} `
    );
    this.screen.render();
  }

  private applyTheme(): void {
    const c = themeEngine.getBlessedColors();
    this.chat.style.bg = c.bgPrimary;
    this.chat.style.fg = c.textPrimary;
    this.input.style.bg = c.bgPrimary;
    (this.input.style as Record<string, unknown>).border = { fg: c.border };
    this.status.style.bg = c.bgSecondary;
    this.refreshStatus();
    this.renderInput();
  }

  private updateCost(
    usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined
  ): void {
    if (!usage) return;
    this.cost.promptTokens += usage.promptTokens;
    this.cost.completionTokens += usage.completionTokens;
    this.cost.totalTokens += usage.totalTokens;
    this.cost.requests += 1;
    const inputCost = (usage.promptTokens / 1_000_000) * 3;
    const outputCost = (usage.completionTokens / 1_000_000) * 15;
    this.cost.estimatedCostUSD += inputCost + outputCost;

    const activeId = sessionManager.getActiveSessionId();
    if (activeId) {
      sessionManager.updateSessionCost(activeId, usage.totalTokens, inputCost + outputCost);
    }

    this.refreshStatus();
  }

  private setupRawInput(): void {
    if (!process.stdin.isTTY) return;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    process.stdin.on("data", (chunk: string) => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0);

        if (this.pendingPermission) {
          const allow = ch === "y" || ch === "Y";
          const resolve = this.pendingPermission;
          this.pendingPermission = undefined;
          this.addSystem(allow ? "Allowed." : "Denied.");
          resolve(allow);
          this.renderInput();
          continue;
        }

        if (code === 13) {
          this.submit();
        } else if (code === 127 || code === 8) {
          this.inputBuffer = this.inputBuffer.slice(0, -1);
          this.renderInput();
        } else if (code === 3) {
          if (this.isProcessing) {
            this.ac?.abort();
            this.isProcessing = false;
            state.set("isProcessing", false);
            this.addSystem("Cancelled.");
            this.renderInput();
          }
        } else if (code >= 32 && code !== 127) {
          this.inputBuffer += ch;
          this.renderInput();
        }
      }
    });
  }

  private submit(): void {
    if (this.isProcessing) return;
    const msg = this.inputBuffer.trim();
    this.inputBuffer = "";
    this.renderInput();
    if (!msg) return;
    this.addUser(msg);
    void this.handleInput(msg);
  }

  private async handleInput(input: string): Promise<void> {
    if (input === "/") {
      this.showSlashMenu();
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
      ["/cmd <text>", "AI command-search: natural language → shell command"],
      ["/ask-prime <q>", "Ask Sentinel Prime (Hermes agent)"],
      ["/checkpoints", "List file checkpoints"],
      ["/undo", "Undo the last agent file change"],
      ["/cost", "Session cost breakdown"],
      ["/compact", "Compress context (save tokens)"],
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
      this.transcript = "";
      this.stream = "";
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

    if (parsed.name === "cost") {
      this.addSystem(
        [
          "Session cost:",
          `  Prompt:     ${this.cost.promptTokens.toLocaleString()} tokens`,
          `  Completion: ${this.cost.completionTokens.toLocaleString()} tokens`,
          `  Total:      ${this.cost.totalTokens.toLocaleString()} tokens`,
          `  Requests:   ${this.cost.requests}`,
          `  Est. cost:  $${this.cost.estimatedCostUSD.toFixed(4)}`,
        ].join("\n")
      );
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
      this.handleTabsCommand(parsed.args);
      return;
    }

    if (parsed.name === "cmd") {
      await this.handleCmdSearch(parsed.args.join(" "));
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

    const cmd = commandRegistry.get(parsed.name);
    if (cmd) {
      await this.chatWithAI(resolveTemplate(cmd.template, parsed.args));
      return;
    }

    this.addError(`Unknown command: /${parsed.name}. Type / to see commands.`);
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

  private handleTabsCommand(args: string[]): void {
    const sub = args[0];

    if (!sub || sub === "list") {
      const sessions = sessionManager.getAllSessions();
      const activeId = sessionManager.getActiveSessionId();
      let msg = "Tabs:\n";
      for (const s of sessions) {
        const active = s.id === activeId ? " ←" : "";
        const pin = s.pinned ? "\u{1F4CC}" : "  ";
        msg += `  ${pin} ${s.id.slice(0, 8)}… ${s.title}${active}\n`;
      }
      this.addSystem(msg.trimEnd());
      return;
    }

    if (sub === "new") {
      this.createNewTab();
      this.addSystem("New tab created.");
      return;
    }

    if (sub === "close") {
      const id = args[1];
      if (!id) {
        const activeId = sessionManager.getActiveSessionId();
        if (activeId) {
          this.onTabClose(activeId);
          this.addSystem("Closed active tab.");
        }
      } else {
        this.onTabClose(id);
        this.addSystem(`Closed tab ${id}.`);
      }
      return;
    }

    if (sub === "switch") {
      const id = args[1];
      if (id) {
        this.tabManager.switchTab(id);
        this.addSystem(`Switched to tab.`);
      }
      return;
    }

    if (sub === "rename") {
      const id = args[1];
      const name = args.slice(2).join(" ");
      if (id && name) {
        sessionManager.renameSession(id, name);
        this.tabManager.refresh();
        this.addSystem(`Tab renamed to ${name}.`);
      } else {
        this.tabManager.renameCurrentTab();
      }
      return;
    }

    if (sub === "pin") {
      this.tabManager.togglePinCurrent();
      this.addSystem("Pin toggled.");
      return;
    }

    this.addSystem("Usage: /tabs [list|new|close|switch|rename|pin]");
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

      const runner = new AgentRunner(
        {
          provider,
          context: cm,
          toolDefs: [...childToolDefs, subagentTool.def, todoTool.def],
          executeTool: topExecute,
          extractToolCalls,
        },
        { model: runnerModel, maxRounds: agentName === "gsd" ? 30 : 15, largeContextWarnAt: 50 }
      );

      this.ac = new AbortController();
      runner.on("roundStart", () => this.startAssistant());
      runner.on("token", (t) => this.streamAssistant(t));
      runner.on("streamEnd", () => this.endAssistant());
      runner.on("usage", (u) => this.updateCost(u));
      runner.on("toolStart", (_name, args) => {
        this.pendingToolArgs = args;
      });
      runner.on("toolResult", (name, ok, firstLine) =>
        this.addTool(name, this.truncateArgs(this.pendingToolArgs), ok, firstLine)
      );
      runner.on("contextLarge", () =>
        this.addSystem("Context is getting large — /compact to save tokens.")
      );
      runner.on("runError", (e) => {
        this.endAssistant();
        this.addError(e instanceof Error ? e.message : String(e));
      });

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
      this.addError(err instanceof Error ? err.message : String(err));
    } finally {
      this.ac = undefined;
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
    this.transcript = "";
    this.stream = "";
    this.printWelcome();
    this.addSystem(`Tab "${session.title}" created.`);
  }

  private onTabSwitch(session: Session): void {
    this.transcript = "";
    this.stream = "";

    const msgs = session.contextManager.getMessages();
    for (const msg of msgs) {
      const c = themeEngine.getBlessedColors();
      if (msg.role === "user") {
        this.transcript += `\n{${c.cyan}-fg}{bold}You{/}\n${this.esc(msg.content)}\n`;
      } else if (msg.role === "assistant") {
        this.transcript += `\n{${c.lime}-fg}{bold}Sentinel{/}\n${this.esc(msg.content)}\n`;
      } else if (msg.role === "tool") {
        const firstLine = msg.content.split("\n")[0].slice(0, 200);
        this.transcript += `{${c.textTertiary}-fg}${this.esc(firstLine)}{/}\n`;
      }
    }

    this.cost = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      requests: 0,
      estimatedCostUSD: session.cost.estimatedCostUSD,
    };

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
      this.transcript = "";
      this.stream = "";
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

    this.screen.key(["C-p"], () => {
      this.tabManager.togglePinCurrent();
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

    this.screen.key(["C-m"], () => {
      const models = [
        "zai/glm-4.6",
        "zai/glm-5.1",
        "anthropic/claude-sonnet",
        "anthropic/claude-haiku",
        "openai/gpt-4o",
        "ollama/llama3",
      ];
      const cur = state.get("currentModel");
      const next = models[(models.indexOf(cur) + 1) % models.length];
      state.set("currentModel", next);
      events.emit("model:changed", next);
      this.addSystem(`Model → ${next}`);
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
