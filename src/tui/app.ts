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
import { searchCatalog } from "../core/command-catalog.js";
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
import { usageTracker } from "../core/usage-tracker.js";
import { runDiagnostics, formatDiagnostics } from "../core/diagnostics.js";
import { estimateCostUSD } from "../core/pricing.js";
import { exec } from "child_process";
import { MCPManager } from "../mcp/manager.js";
import { createMcpAwareExecutor } from "../mcp/mcp-executor.js";
import { getConfigManager } from "../core/config.js";
import { fetchRegistry, searchRegistry, installEntry } from "../core/marketplace.js";
import { exportSessionMarkdown, exportSessionHtml } from "../core/session-export.js";
import { WorkspaceStore } from "../core/workspace.js";
import { createLogger } from "../utils/logger.js";
import { writeFileSync, readFileSync } from "node:fs";
import { join, isAbsolute, resolve } from "node:path";

const log = createLogger({ prefix: "tui" });

const VERSION = "0.2.0";

/**
 * Default marketplace registry source for `/marketplace` (V15). A project-local
 * JSON file by default; overridable per-invocation with an explicit path/URL, or
 * by committing a registry document at this path. Can also be a remote URL.
 */
const DEFAULT_MARKETPLACE_SOURCE = ".sentinel/registry.json";

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

  // V11 semantic repo index (lite TF-IDF). Built lazily by /index or /search.
  private repoIndex?: RepoIndex;

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
      ["/checkpoints", "List file checkpoints"],
      ["/undo", "Undo the last agent file change"],
      ["/cost", "Session cost breakdown"],
      ["/usage", "Usage metrics: tokens, cost, per-tool table"],
      ["/diagnostics", "Run typecheck/build, report errors (alias /diag)"],
      ["/export [md|html] [path]", "Export this session's transcript to a file"],
      ["/branch", "Duplicate this session into a new tab"],
      ["/workspace ...", "Multi-repo roots: list | add | remove | use (alias /ws)"],
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

    if (parsed.name === "export") {
      this.handleExportCommand(parsed.args);
      return;
    }

    if (parsed.name === "branch") {
      this.handleBranchCommand();
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

    if (parsed.name === "usage") {
      this.addSystem(usageTracker.render());
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
      this.handleTabsCommand(parsed.args);
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

    if (parsed.name === "workspace" || parsed.name === "ws") {
      this.handleWorkspaceCommand(parsed.args);
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

  /**
   * /workspace (alias /ws) — track several project roots (V18).
   * Subcommands: list | add [path] | remove <path> | use <path>.
   * `use` records the active root for the *next* session/tab — it does NOT
   * hot-swap the running projectRoot.
   */
  private handleWorkspaceCommand(args: string[]): void {
    const sub = (args[0] || "list").toLowerCase();
    let store: WorkspaceStore;
    try {
      store = new WorkspaceStore();
    } catch (err) {
      this.addError(`Workspace error: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    if (sub === "list") {
      const roots = store.listRoots();
      const active = store.getActive();
      if (roots.length === 0) {
        this.addSystem(
          "No workspace roots yet. Add one with /workspace add [path] (defaults to this project)."
        );
        return;
      }
      let msg = "Workspace roots:\n";
      for (const r of roots) msg += `  ${r === active ? "→" : " "} ${r}\n`;
      this.addSystem(msg.trimEnd());
      return;
    }

    if (sub === "add") {
      const path = args.slice(1).join(" ").trim() || this.projectRoot;
      try {
        const root = store.addRoot(path);
        this.addSystem(`Added workspace root: ${root}`);
      } catch (err) {
        this.addError(`Failed to add root: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (sub === "remove" || sub === "rm") {
      const path = args.slice(1).join(" ").trim();
      if (!path) {
        this.addSystem("Usage: /workspace remove <path>");
        return;
      }
      const removed = store.removeRoot(path);
      this.addSystem(removed ? `Removed workspace root: ${path}` : `Not a tracked root: ${path}`);
      return;
    }

    if (sub === "use") {
      const path = args.slice(1).join(" ").trim();
      if (!path) {
        this.addSystem("Usage: /workspace use <path>");
        return;
      }
      try {
        const root = store.setActive(path);
        this.addSystem(
          `Active workspace root → ${root}\nThis affects the next session / new tab — your current session keeps its project root.`
        );
      } catch (err) {
        this.addError(`Failed to set active root: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    this.addSystem(
      "Usage: /workspace <list | add [path] | remove <path> | use <path>>  (alias: /ws)"
    );
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

  private handleExportCommand(args: string[]): void {
    // Parse args: format (md|html|markdown) and/or an output path, in any order.
    let format: "md" | "html" = "md";
    let outPath: string | undefined;
    for (const arg of args) {
      const lower = arg.toLowerCase();
      if (lower === "md" || lower === "markdown") {
        format = "md";
      } else if (lower === "html" || lower === "htm") {
        format = "html";
      } else {
        outPath = arg;
      }
    }

    const session = sessionManager.getActiveSession();
    if (!session) {
      this.addSystem("No active session to export.");
      return;
    }

    const messages = session.contextManager
      .getMessages()
      .map((m) => ({ role: m.role, content: m.content }));

    if (messages.length === 0) {
      this.addSystem("Nothing to export — this session has no messages yet.");
      return;
    }

    const title = session.title || "Sentinel Session";
    const ext = format === "html" ? "html" : "md";
    const content =
      format === "html"
        ? exportSessionHtml({ title, messages })
        : exportSessionMarkdown({ title, messages });

    const defaultName = `sentinel-export-${session.id.slice(0, 8)}.${ext}`;
    const target = outPath
      ? isAbsolute(outPath)
        ? outPath
        : resolve(this.projectRoot, outPath)
      : join(this.projectRoot, defaultName);

    try {
      writeFileSync(target, content, "utf8");
      this.addSystem(`Exported ${messages.length} messages to ${target}`);
    } catch (err) {
      this.addSystem(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private handleBranchCommand(): void {
    const source = sessionManager.getActiveSession();
    if (!source) {
      this.addSystem("No active session to branch.");
      return;
    }

    // Create a new session/tab, then copy the source's conversation into it so
    // the branch starts as an independent duplicate of the current context.
    const branch = sessionManager.createSession({
      projectRoot: this.projectRoot,
      title: `${source.title} (branch)`,
      model: source.model,
      agent: source.agent,
    });

    const srcCm = source.contextManager;
    const dstCm = branch.contextManager;
    const sysPrompt = srcCm.getSystemPrompt();
    if (sysPrompt) dstCm.setSystemPrompt(sysPrompt);
    for (const m of srcCm.getMessages()) {
      if (m.role === "system") continue; // re-derived from the system prompt
      dstCm.addMessage(m.role as "user" | "assistant" | "tool", m.content, m.metadata);
    }
    sessionManager.markDirty(branch.id);

    // Switch the UI to the new branch tab and replay its transcript.
    this.tabManager.refresh();
    this.tabManager.switchTab(branch.id);
    this.addSystem(`Branched into a new tab: "${branch.title}" (${srcCm.getMessageCount()} messages copied).`);
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
