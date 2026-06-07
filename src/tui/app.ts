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
import { createHeaderBar } from "./header-bar.js";
import { TabManager } from "./tab-manager.js";
import { sessionManager, Session } from "../core/session-manager.js";
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

    const cmd = commandRegistry.get(parsed.name);
    if (cmd) {
      await this.chatWithAI(resolveTemplate(cmd.template, parsed.args));
      return;
    }

    this.addError(`Unknown command: /${parsed.name}. Type / to see commands.`);
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

  private async chatWithAI(userMessage: string): Promise<void> {
    this.isProcessing = true;
    state.set("isProcessing", true);
    this.renderInput();

    const cm = this.getContextManager();
    cm.addMessage("user", userMessage);

    const modelStr = state.get("currentModel");
    const [providerName, ...modelParts] = modelStr.split("/");
    const modelName = modelParts.join("/") || undefined;

    try {
      const provider = providerManager.getProvider(providerName);
      if (!provider) throw new Error(`No provider "${providerName}". Try /providers`);
      if (!provider.isAvailable()) throw new Error(`No API key for "${providerName}". Type /connect`);

      const gsdMode = state.get("currentAgent") === "gsd";
      const toolDefs = getToolDefinitions();
      const maxRounds = gsdMode ? 30 : 15;

      cm.setSystemPrompt(this.getSystemPrompt());

      for (let round = 1; round <= maxRounds; round++) {
        if (!this.isProcessing) break;

        const aiMessages = cm.toAIMessages();

        this.startAssistant();
        const response = await provider.chatStream(aiMessages, { model: modelName, tools: toolDefs }, (chunk) => {
          if (chunk.content) this.streamAssistant(chunk.content);
        });
        this.endAssistant();

        if (response.usage) this.updateCost(response.usage);

        const toolCalls = response.toolCalls || this.extractToolCalls(response.content);
        if (response.content) {
          cm.addMessage("assistant", response.content, { toolCalls });
        }

        if (!toolCalls || toolCalls.length === 0) break;

        for (const tc of toolCalls) {
          const resultMsg = await executeToolCall(tc);
          const ok = !resultMsg.content.startsWith("ERROR");
          const firstLine = resultMsg.content.split("\n")[0].slice(0, 200);
          this.addTool(tc.name, this.truncateArgs(tc.arguments), ok, firstLine);
          cm.addMessage("tool", `[Tool: ${resultMsg.name}]\n${resultMsg.content}`);
        }
      }

      const activeId = sessionManager.getActiveSessionId();
      if (activeId) sessionManager.markDirty(activeId);

      if (cm.getMessageCount() > 50) {
        this.addSystem("Context is getting large — /compact to save tokens.");
      }
    } catch (err) {
      this.endAssistant();
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
    if (this.screen) this.screen.destroy();
  }
}
