import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";
import { state } from "../core/state.js";
import { events } from "../core/events.js";
import { providerManager } from "../ai/provider.js";
import { ContextManager } from "../ai/context.js";
import { commandRegistry } from "../commands/registry.js";
import { parseCommand, resolveTemplate } from "../commands/loader.js";
import { refineGoal } from "../core/refine-goal.js";
import { AgentRunner } from "../core/agent-runner.js";
import { makeCompactionSummarizer } from "../core/compaction-summarizer.js";
import { extractToolCalls } from "../core/tool-call-extractor.js";
import { buildSystemPrompt } from "../core/system-prompt.js";
import { searchCatalog, COMMAND_CATALOG } from "../core/command-catalog.js";
import { renderMarkdown } from "./render-markdown.js";
import { capTranscript } from "./transcript.js";
import { renderCard } from "./cards.js";
import { accentBorderFor, glowText, neonDivider, pulseDot, pulsePrompt } from "./borders.js";
import { resolveSelection, mergeModels } from "./switcher.js";
import { skillRegistry } from "../skills/registry.js";
import { agentRegistry } from "../agents/registry.js";
import { composeChatBody, ChatBodyMemo } from "./render-chat.js";
import { SearchSession } from "./search.js";
import { detectNeeds } from "../core/onboarding.js";
import { expandMentions } from "../core/mentions.js";
import { extractImageMentions, loadAttachment, type Attachment } from "../core/attachments.js";
import { formatApprovalPrompt } from "../core/approval-diff.js";
import { parsePipeline, runPipeline, type Pipeline } from "../core/pipeline-engine.js";
import { runGsd, buildPhasePrompt, TDD_PHASES } from "../core/gsd.js";
import { runAutopilotSession, summarizeAutopilot } from "../core/autopilot-session.js";
import { writeRouterConfig, probeRouter, routerStartHelp, DEFAULT_ROUTER_URL, DEFAULT_CLAUDE_MODEL } from "../core/router-connect.js";
import { buildIndex, search as searchRepoIndex, RepoIndex } from "../core/repo-index.js";
import { recallRelevant, DEFAULT_RECALL_TOOL } from "../core/brain-recall.js";
import { createHeaderBar } from "./header-bar.js";
import { buildAgentBase } from "./agent-stack.js";
import {
  insertText,
  backspace,
  deleteForward,
  moveLeft,
  moveRight,
  parseCsi,
  completeCommand,
  stepHistory,
  wordBack,
  wordForward,
  killToEnd,
  killWordBack,
  type LineState,
} from "./input.js";
import { formatTokens, formatCost, humanizeToolCall, summarizeToolResult } from "./format.js";
import { CommandHost } from "./commands/types.js";
import {
  handleCost,
  handleUsage,
  handleAbout,
  handleContext,
  handleCompact,
  handleClear,
  handleSetupHelp,
  handleProviders,
  handleTheme,
  handlePermissions,
  handlePlan,
  handleCheckpoints,
  handleUndo,
  handleOut,
} from "./commands/info.js";
import { handleMarketplace, handleWorkspaceCommand, handleTeamCommand } from "./commands/registry-commands.js";
import { handleExportCommand, handleBranchCommand } from "./commands/session-commands.js";
import { handleCmdSearch } from "./commands/cmd-search.js";
import { handleWorkflowCommand } from "./commands/workflow.js";
import { handleSyncCommand } from "./commands/sync.js";
import { handleAskPrime, handleDescribe } from "./commands/ai-commands.js";
import { TabManager } from "./tab-manager.js";
import { sessionManager, Session } from "../core/session-manager.js";
import { PermissionMode, PermissionRequest } from "../core/permissions.js";
import { CheckpointManager } from "../core/checkpoints.js";
import { createSubagentAwareExecutor } from "../core/subagent.js";
import { createTodoTool, createTodoAwareExecutor } from "../core/todos.js";
import { createHookAwareExecutor, defaultRunShell } from "../core/hooks.js";
import { BackgroundTaskManager } from "../core/background.js";
import { usageTracker } from "../core/usage-tracker.js";
import { runDiagnostics, formatDiagnostics } from "../core/diagnostics.js";
import { estimateCostUSD } from "../core/pricing.js";
import { MCPManager } from "../mcp/manager.js";
import { getConfigManager } from "../core/config.js";
import { buildAbout } from "../core/about.js";
import { checkForUpdate } from "../core/update-check.js";
import { createLogger } from "../utils/logger.js";
import { exec } from "child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const log = createLogger({ prefix: "tui" });

const VERSION = "1.1.0";

// Braille spinner frames for the animated "working…" indicator.
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
// Hard cap on transcript length. Past this the oldest lines are trimmed so a
// long session never pays an unbounded per-paint cost (see capTranscript).
const MAX_TRANSCRIPT_LINES = 2000;
// Curated, switchable models offered by /model and the Ctrl+O cycler. Merged
// with config-declared models and filtered by available providers at runtime.
const CURATED_MODELS = [
  "zai/glm-4.6",
  "zai/glm-4.5-air",
  "anthropic/claude-sonnet",
  "anthropic/claude-haiku",
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "ollama/llama3",
];
// Built-in agent modes (fallback when the registry is empty).
const BUILTIN_AGENTS = ["gsd", "code", "ask", "plan", "debug"];

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
  // FIFO queue of permission prompts. A single resolver field would strand the
  // first request when two gated tool calls ask concurrently (parallel pipeline
  // steps) — the second overwrote the first, which then never resolved.
  private permissionQueue: Array<{ label: string; reason: string; resolve: (allow: boolean) => void; diffPreview?: string }> = [];
  private permissionActive = false;
  // True while a modal (e.g. tab-rename) is capturing keypresses via its own
  // screen.program listener. While set, the raw-stdin handler ignores input so
  // keystrokes don't also feed the hidden main input buffer (and Enter doesn't
  // double-submit: once to the modal, once as a billed AI turn).
  private modalActive = false;

  // V11 semantic repo index (lite TF-IDF). Built lazily by /index or /search.
  private repoIndex?: RepoIndex;

  private inputBuffer = "";
  private inputCursor = 0; // caret position within inputBuffer
  private inputHistory: string[] = [];
  private historyIndex = -1; // -1 = editing a fresh line (not browsing history)
  private historyDraft = ""; // stashed in-progress line while browsing history
  private pasting = false; // inside a bracketed-paste span (ESC[200~ … ESC[201~)
  private pasteBuf = ""; // accumulated paste body (may span stdin chunks)

  // Interactive slash-command menu (opencode-style filter-as-you-type).
  private slashBox!: blessed.Widgets.BoxElement;
  private slashActive = false;

  // Ctrl+F in-conversation search overlay. While active, keystrokes feed the
  // search box (gated like modalActive) and the status bar shows "N/M".
  private search = new SearchSession();
  private searchActive = false;
  private slashItems: { command: string; description: string }[] = [];
  private slashIndex = 0;

  // The most recent tool call's full (untruncated) output, for /out. Tool cards
  // collapse to 5 lines; this lets the user view the whole thing on demand.
  private lastToolOutput: { name: string; argsJson: string; ok: boolean; output: string } | null = null;

  private transcript = "";
  private stream = ""; // legacy live-tail slot; assistant tail now rendered in flushRender
  private streamRaw = ""; // un-escaped assistant text, re-rendered as a card at each paint
  private streaming = false; // an assistant message is currently streaming

  // Holds a trailing partial ESC byte (0x1b) when a stdin chunk ends on ESC with
  // no following byte. SSH/ConPTY routinely fragment escape sequences across
  // reads, so without reassembly the next chunk's "[A" arrives as literal text
  // (arrow keys leak into the buffer). Prepended to the next chunk in onInputChunk.
  private escBuf = "";
  // Render coalescing: every mutation marks state dirty and schedules a single
  // paint per tick instead of repainting synchronously (per-token renders are
  // the main source of flicker/lag). `chatDirty` gates the expensive chat
  // setContent so a keystroke-only paint doesn't re-parse the whole transcript.
  private renderScheduled = false;
  private chatDirty = false;
  // Memo of the last chat body string painted, so redundant paints (coalesced
  // scheduleRender calls, or a stream token that produced identical output)
  // skip the expensive box.setContent re-tokenize. See render-chat.ts.
  private bodyMemo = new ChatBodyMemo();
  // Auto-follow the bottom only while the user is already there, so scrolling up
  // during a run isn't yanked back down.
  private stickToBottom = true;
  private destroyed = false;
  // Animated working indicator.
  private spinnerInterval?: ReturnType<typeof setInterval>;
  private spinnerFrame = 0;
  private workStartedAt = 0;
  // Ambient animation tick — always running, drives the breathing status dot
  // and the pulsing idle prompt. Coalesces through scheduleRender() so it's
  // effectively free when the terminal isn't visible.
  private ambientInterval?: ReturnType<typeof setInterval>;
  private pulseFrame = 0;

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
      onModalActive: (active) => this.setModalActive(active),
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
      mouse: true, // wheel scroll only; keys/vi removed so the box never steals
      // focus-based keys from the raw-stdin line editor.
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

    // Interactive slash-command menu: a hidden overlay just above the input.
    this.slashBox = blessed.box({
      parent: this.screen,
      left: 1,
      width: "70%",
      bottom: 4,
      height: 3,
      hidden: true,
      tags: true,
      border: { type: "line" },
      style: {
        bg: c.bgSecondary,
        fg: c.textPrimary,
        border: { fg: c.accent || c.cyan },
      },
    });

    this.printWelcome();
    this.setupRawInput();
    this.setupKeys();
    this.refreshStatus();
    this.renderInput();

    state.subscribe("currentAgent", () => this.refreshStatus());
    state.subscribe("currentModel", () => this.refreshStatus());
    state.subscribe("isProcessing", () => this.onProcessingChange());
    state.subscribe("compressionStats", () => this.refreshStatus());
    events.on("theme:changed", () => this.applyTheme());

    // Track whether the user has scrolled up. Our own auto-scroll lands at 100%,
    // which keeps stickToBottom true; a wheel/keys scroll away from the bottom
    // clears it so new output no longer yanks the view down.
    this.chat.on("scroll", () => {
      this.stickToBottom = this.chat.getScrollPerc() >= 99;
      this.refreshStatus();
    });

    // Restore the terminal (bracketed paste, raw mode, alt screen) even on an
    // unexpected exit — destroy() is idempotent via the `destroyed` guard.
    process.on("exit", () => this.destroy());

    // Ambient heartbeat: every 480ms advance the pulse frame and re-render the
    // chrome that lives (breathing status dot + pulsing idle prompt). Cheap —
    // one setContent + one coalesced render per tick. Only the prompt re-renders
    // when idle; the spinner owns the prompt while processing.
    this.ambientInterval = setInterval(() => {
      this.pulseFrame = (this.pulseFrame + 1) % 8;
      this.refreshStatus();
      if (!this.isProcessing && this.inputBuffer.length === 0) {
        this.renderInput();
      }
    }, 480);

    this.screen.render();
    log.info("TUI started");
  }

  private esc(s: string): string {
    // Single pass — a two-step replace corrupts "{" into "{open{close}".
    return s.replace(/[{}]/g, (ch) => (ch === "{" ? "{open}" : "{close}"));
  }

  /** Mark the chat body dirty and schedule a coalesced paint. */
  private render(): void {
    this.chatDirty = true;
    this.scheduleRender();
  }

  /** Coalesce all paints within a tick into one screen.render(). */
  private scheduleRender(): void {
    if (this.renderScheduled || this.destroyed) return;
    this.renderScheduled = true;
    setImmediate(() => this.flushRender());
  }

  /**
   * The single paint. Re-lays the chat body only when it changed (so a
   * keystroke-only repaint doesn't re-parse the whole transcript), follows the
   * bottom only while sticky, and never lets a render error crash the process.
   */
  private flushRender(): void {
    this.renderScheduled = false;
    if (this.destroyed) return;
    try {
      if (this.chatDirty) {
        // Compose the full body once (pure helper) and skip the expensive
        // box.setContent re-tokenize when it's identical to the last paint
        // (coalesced renders, or a stream token that produced no visible change).
        const body = composeChatBody({
          transcript: this.transcript,
          streamRaw: this.streamRaw,
          streaming: this.streaming,
          renderAssistantCard: (raw) => this.assistantCard(raw),
        });
        this.chatDirty = false;
        if (this.bodyMemo.changed(body)) {
          this.chat.setContent(body);
          if (this.stickToBottom) this.chat.setScrollPerc(100);
        }
      }
      this.screen.render();
      // Blessed positions/shows the hardware cursor during render; re-hide it so
      // the blinking caret never appears mid-screen (we draw our own in the input).
      if (process.stdin.isTTY) process.stdout.write("\x1b[?25l");
    } catch (err) {
      log.error(`render failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Jump the chat scrollback to the top or bottom (Home/End). */
  private scrollChat(toTop: boolean): void {
    this.stickToBottom = !toTop; // landing at the bottom re-engages auto-follow
    try {
      this.chat.setScrollPerc(toTop ? 0 : 100);
    } catch {
      // setScrollPerc can throw before the box has laid out — ignore.
    }
    this.refreshStatus();
    this.scheduleRender();
  }

  /** Start/stop the working-indicator spinner as the run state flips. */
  private onProcessingChange(): void {
    const proc = state.get("isProcessing");
    if (proc && !this.spinnerInterval) {
      this.workStartedAt = Date.now();
      this.spinnerFrame = 0;
      this.spinnerInterval = setInterval(() => {
        this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER.length;
        this.renderInput();
      }, 120);
    } else if (!proc && this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = undefined;
    }
    this.refreshStatus();
    this.renderInput();
  }

  private push(block: string): void {
    this.transcript += block;
    this.transcript = capTranscript(this.transcript, MAX_TRANSCRIPT_LINES);
    this.render();
  }

  private renderInput(): void {
    const c = themeEngine.getBlessedColors();
    if (this.isProcessing) {
      const frame = SPINNER[this.spinnerFrame];
      const secs = this.workStartedAt ? Math.floor((Date.now() - this.workStartedAt) / 1000) : 0;
      this.input.setContent(
        `{${c.cyan}-fg}${frame}{/} {${c.textTertiary}-fg}working ${secs}s · press Ctrl+C to cancel{/}`
      );
    } else if (this.inputBuffer.length === 0) {
      // Pulsing prompt — the idle heartbeat. Bright accent at the peak of the
      // ambient cycle, dim at the trough. Only when effects.pulse is on; calm
      // steady cyan otherwise.
      const effects = themeEngine.getEffects();
      const prompt = effects.pulse ? pulsePrompt(this.pulseFrame, c) : `{${c.cyan}-fg}❯{/${c.cyan}-fg}`;
      this.input.setContent(
        `${prompt} {${c.textTertiary}-fg}Message Sentinel, or / for commands{/}`
      );
    } else {
      // Render the caret as an inverse cell at its real position within the line.
      const cur = Math.max(0, Math.min(this.inputCursor, this.inputBuffer.length));
      const before = this.esc(this.inputBuffer.slice(0, cur));
      const atChar = cur < this.inputBuffer.length ? this.esc(this.inputBuffer[cur]) : " ";
      const after = cur < this.inputBuffer.length ? this.esc(this.inputBuffer.slice(cur + 1)) : "";
      this.input.setContent(`{${c.cyan}-fg}❯{/} ${before}{inverse}${atChar}{/inverse}${after}`);
    }
    this.scheduleRender();
  }

  /** Outer width of a message card, derived from the current terminal width. */
  private cardWidth(): number {
    const cols = (this.screen?.width as number) || 80;
    // Leave room for the chat box padding (2+2) and the card's 2-space indent;
    // cap so long-line prose stays readable.
    return Math.max(24, Math.min(cols - 6, 100));
  }

  /** Render a role message as a bordered, per-role-colored card. */
  private card(label: string, body: string, colorKey: string): string {
    const c = themeEngine.getBlessedColors() as unknown as Record<string, string>;
    const fx = themeEngine.getEffects();
    const color = c[colorKey] || c.textPrimary;
    // Neon accent border for cyberpunk themes (glow on); the role color is kept
    // for the label so "you" stays cyan and "sentinel" stays lime.
    const borderColor = fx.glow ? color : c.border;
    return renderCard({
      label,
      body,
      width: this.cardWidth(),
      labelColor: color,
      borderColor,
    });
  }

  /** The assistant card, body markdown-rendered (code/diff/inline-code styled). */
  private assistantCard(raw: string): string {
    const body = renderMarkdown(
      raw,
      themeEngine.getBlessedColors() as unknown as Record<string, string>,
      themeEngine.getEffects()
    );
    return this.card("sentinel", body, "lime");
  }

  /** Selectable agent modes (registry, falling back to the built-ins). */
  private listAgents(): string[] {
    const names = agentRegistry.getNames();
    return names.length ? names : BUILTIN_AGENTS;
  }

  /** Selectable models: current + config-declared + curated (available providers). */
  private listModels(): string[] {
    const providers = (getConfigManager().getAll().provider || {}) as Record<
      string,
      { models?: Record<string, unknown> }
    >;
    const configModels: string[] = [];
    for (const [name, p] of Object.entries(providers)) {
      for (const m of Object.keys(p?.models || {})) configModels.push(`${name}/${m}`);
    }
    return mergeModels(
      CURATED_MODELS,
      configModels,
      providerManager.getAvailableProviderNames(),
      state.get("currentModel") || ""
    );
  }

  /** Render a numbered pick list with the current item marked. */
  private numberedList(title: string, items: string[], current: string, usage: string): string {
    const lines = items.map((it, i) => {
      const mark = it === current ? " ←" : "";
      return `  ${String(i + 1).padStart(2)}. ${it}${mark}`;
    });
    return [`${title} — switch with ${usage}:`, ...lines].join("\n");
  }

  private addUser(text: string): void {
    // User input is shown verbatim (escaped); no markdown so pasted code stays literal.
    this.push("\n" + this.card("you", this.esc(text), "cyan") + "\n");
  }

  private startAssistant(): void {
    this.stream = "";
    this.streamRaw = "";
    this.streaming = false;
  }

  private streamAssistant(token: string): void {
    this.streaming = true;
    this.streamRaw += token; // accumulate; the live card is rendered in flushRender
    this.render();
  }

  private endAssistant(): void {
    if (this.streaming) {
      // Bake the completed assistant card into the transcript at the current width.
      this.transcript += "\n" + this.assistantCard(this.streamRaw) + "\n";
      this.transcript = capTranscript(this.transcript, MAX_TRANSCRIPT_LINES);
    }
    this.stream = "";
    this.streamRaw = "";
    this.streaming = false;
    // A scanline-style divider after each completed turn — the CRT texture only
    // appears on cyberpunk themes (effects.scanlines); plain themes get nothing
    // extra here so the transcript stays clean.
    if (themeEngine.getEffects().scanlines) this.divider();
    this.render();
  }

  private addTool(name: string, argsJson: string, ok: boolean, output: string): void {
    // Stash the full (untruncated) output so /out can show it — the card itself
    // collapses long output to 5 lines with no in-app way to see the rest.
    this.lastToolOutput = { name, argsJson, ok, output: output || "" };
    const c = themeEngine.getBlessedColors();
    const cut = (t: string, n: number): string => (t.length > n ? t.slice(0, n - 1) + "…" : t);
    const mark = ok ? `{${c.lime}-fg}✓{/}` : `{${c.error}-fg}✗{/}`;
    const rail = (ch: string): string => `{${c.textSecondary}-fg}${ch}{/}`;
    const action = this.esc(cut(humanizeToolCall(name, argsJson), 58));
    const summary = this.esc(cut(summarizeToolResult(name, argsJson, ok, output), 30));

    // A left-rail "card": status header + a short preview of the output body,
    // with the remainder collapsed. Left rail only — full borders misalign the
    // moment blessed word-wraps a line.
    let card = `\n  ${rail("╭")} ${mark} {${c.textPrimary}-fg}${action}{/}`;
    if (summary) card += `  {${c.textSecondary}-fg}${summary}{/}`;
    card += "\n";

    const stripped = (output || "").replace(/^\[[^\]]*output\]\n/, "").replace(/\s+$/, "");
    const lines = stripped ? stripped.split("\n") : [];
    const MAX = 5;
    for (const l of lines.slice(0, MAX)) {
      card += `  ${rail("│")} {${c.textSecondary}-fg}${this.esc(cut(l, 72))}{/}\n`;
    }
    const extra = lines.length - Math.min(lines.length, MAX);
    card += `  ${rail("╰")}`;
    if (extra > 0) card += ` {${c.textSecondary}-fg}… ${extra} more line${extra === 1 ? "" : "s"}{/}`;
    card += "\n";

    this.push(card);
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
    const fx = themeEngine.getEffects();
    const cols = (this.screen?.width as number) || 80;
    // Scanline texture: a dotted/dashed rule reads as CRT scanlines when the
    // theme wants them; a solid dim rule otherwise.
    if (fx.scanlines) {
      const ch = "╌";
      const seg = ch.repeat(Math.floor((cols - 6) / 2));
      this.push(`{${c.accent}-fg}${seg}{/${c.accent}-fg}\n`);
    } else {
      this.push(`{${c.border}-fg}${"─".repeat(Math.min(cols - 6, 60))}{/${c.border}-fg}\n`);
    }
  }

  private printWelcome(): void {
    const c = themeEngine.getBlessedColors();
    const fx = themeEngine.getEffects();
    const available = providerManager.getAvailableProviderNames();
    const agent = state.get("currentAgent") || "gsd";
    const model = (state.get("currentModel") || "").split("/").pop() || "";
    const project =
      this.projectRoot.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "project";
    const cols = (this.screen?.width as number) || 80;
    const cardW = Math.min(cols - 6, 80);

    const banner = [
      "  ___  ___ _ __ | |_(_)_ __   ___| |",
      " / __|/ _ \\ '_ \\| __| | '_ \\ / _ \\ |",
      " \\__ \\  __/ | | | |_| | | | |  __/ |",
      " |___/\\___|_| |_|\\__|_|_| |_|\\___|_|",
    ]
      .map((l) => `{${c.cyan}-fg}${l}{/${c.cyan}-fg}`)
      .join("\n");

    const providers =
      available.length === 0
        ? `{${c.amber}-fg}no provider configured yet{/}`
        : `{${c.lime}-fg}●{/${c.lime}-fg}  {${c.textSecondary}-fg}${available.join(" · ")}{/}`;

    // Neon frame top + bottom — the showpiece. Diamond center marks when glow.
    const frame = (mark: boolean) => neonDivider(cardW, c, fx, { mark });

    const rail = fx.glow ? `{${c.accent}-fg}▐{/${c.accent}-fg} ` : "  ";

    let s = `\n${frame(true)}\n`;
    s += `\n${banner}\n`;
    s += `\n${glowText(`v${VERSION}`, c, fx, c.cyan)}  {${c.textSecondary}-fg}· the terminal coding agent — any model, OAuth or key{/}\n`;
    s += `\n${rail}{${c.textSecondary}-fg}project{/}    {${c.textPrimary}-fg}${project}{/}\n`;
    s += `${rail}{${c.textSecondary}-fg}model{/}      {${c.textPrimary}-fg}${model}{/}  {${c.textSecondary}-fg}· agent {/}{${c.textPrimary}-fg}${agent}{/}\n`;
    s += `${rail}{${c.textSecondary}-fg}providers{/}  ${providers}\n`;

    // First-run onboarding: if nothing is usable, walk the user through the
    // easiest paths before they hit a confusing no-key error. detectNeeds is
    // env-first, so a fleet node with ZAI_API_KEY set isn't nagged.
    const needsSetup = detectNeeds(process.env, available);
    if (needsSetup) {
      s += `\n${glowText("▸ Get started in 30 seconds:", c, fx, c.amber)}\n`;
      s += `{${c.textSecondary}-fg}  1.{/} {${c.textPrimary}-fg}node dist/cli.js setup{/} {${c.textSecondary}-fg}— a guided wizard (key stored in your OS keyring){/}\n`;
      s += `{${c.textSecondary}-fg}  2.{/} {${c.textPrimary}-fg}export ZAI_API_KEY=…{/} {${c.textSecondary}-fg}(or ANTHROPIC_API_KEY / OPENAI_API_KEY), then restart{/}\n`;
      s += `{${c.textSecondary}-fg}  3.{/} {${c.textPrimary}-fg}/connect{/} {${c.textSecondary}-fg}— ride a Claude Max subscription keylessly via the OAuth router{/}\n`;
      s += `{${c.textSecondary}-fg}  4.{/} {${c.textPrimary}-fg}/setup{/} {${c.textSecondary}-fg}— see all options anytime{/}\n`;
      s += `\n{${c.textSecondary}-fg}Then type a message to start.{/}\n`;
    } else {
      s += `\n${glowText("▸", c, fx, c.cyan)} {${c.textPrimary}-fg}type a message to start{/}\n`;
    }
    s += `${glowText("▸", c, fx, c.cyan)} {${c.amber}-fg}/{/} {${c.textPrimary}-fg}for commands & skills{/}  {${c.textSecondary}-fg}— /connect · /model · /skill · /theme{/}\n`;
    s += `${glowText("▸", c, fx, c.cyan)} {${c.amber}-fg}gsd{/} {${c.textPrimary}-fg}<task>{/}  {${c.textSecondary}-fg}— plan → build → test → ship, autonomously{/}\n`;
    s += `${glowText("▸", c, fx, c.cyan)} {${c.textSecondary}-fg}tab completes · ↑ history · ctrl+q quit · ? for shortcuts{/}\n`;
    s += `\n${frame(false)}\n`;
    this.push(s);
  }

  private refreshStatus(): void {
    const c = themeEngine.getBlessedColors();
    const agent = state.get("currentAgent");
    const model = state.get("currentModel");
    const processing = state.get("isProcessing");
    const compressionStats = state.get("compressionStats");
    const cm = this.getContextManager();

    const modelName = model.split("/").pop() || model;
    const effects = themeEngine.getEffects();
    // Breathing dot: pulses accent↔dim across the ambient tick when ready,
    // steady amber while working.
    const stateSeg = processing
      ? `{${c.amber}-fg}{bold}●{/bold}{/${c.amber}-fg}{/${c.amber}-fg}`
      : pulseDot(this.pulseFrame, c);
    const stateLabel = processing
      ? `{${c.amber}-fg}working{/}`
      : `{${c.textSecondary}-fg}ready{/}`;
    const mode = `{${c.textSecondary}-fg}${agent}{/} {${c.textTertiary}-fg}·{/} {${c.textSecondary}-fg}${modelName}{/}`;

    const tok = this.cost.requests > 0
      ? `${formatTokens(this.cost.totalTokens)} tok`
      : `${cm.getMessageCount()} msgs`;
    const ctx = compressionStats.savingsPercent > 0
      ? `{${c.textSecondary}-fg}${tok}{/} {${c.textTertiary}-fg}·{/} {${c.lime}-fg}${compressionStats.savingsPercent}% saved{/}`
      : `{${c.textSecondary}-fg}${tok}{/}`;
    const cost = this.cost.requests > 0
      ? `{${c.textSecondary}-fg}$${formatCost(this.cost.estimatedCostUSD)}{/}`
      : "";
    const n = sessionManager.getSessionCount();
    const tabs = `{${c.textTertiary}-fg}${n} tab${n === 1 ? "" : "s"}{/}`;

    // When the user has scrolled up, flag that live output is still arriving below.
    const scrollHint = this.stickToBottom ? "" : `{${c.amber}-fg}↓ more below{/}`;

    // Accent separators when glow on, dim when off — routes through the same
    // decision point as everything else.
    const sepColor = accentBorderFor(c, effects);
    const sep = `  {${sepColor}-fg}│{/}  `;
    const segs = [`${stateSeg} ${stateLabel}`, mode, ctx, cost, tabs, scrollHint].filter(Boolean);
    this.status.setContent(" " + segs.join(sep) + " ");
    this.scheduleRender();
  }

  private applyTheme(): void {
    const c = themeEngine.getBlessedColors();
    const effects = themeEngine.getEffects();
    this.chat.style.bg = c.bgPrimary;
    this.chat.style.fg = c.textPrimary;
    this.input.style.bg = c.bgPrimary;
    // Input border: neon accent for cyberpunk themes, dim border otherwise.
    (this.input.style as Record<string, unknown>).border = { fg: accentBorderFor(c, effects) };
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
    // Use real per-model pricing (not a hardcoded $3/$15) so cost is correct for
    // the default zai/glm-4.6 and every non-Sonnet model — matches /usage.
    const turnCost = estimateCostUSD(state.get("currentModel") || "", usage.promptTokens, usage.completionTokens);
    this.cost.estimatedCostUSD += turnCost;

    const activeId = sessionManager.getActiveSessionId();
    if (activeId) {
      sessionManager.updateSessionCost(activeId, usage, turnCost);
    }

    this.refreshStatus();
  }

  private setupRawInput(): void {
    if (!process.stdin.isTTY) return;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    // Enable bracketed paste: the terminal wraps pasted text in ESC[200~…ESC[201~
    // so we can insert it whole instead of treating each embedded newline as Enter.
    process.stdout.write("\x1b[?2004h");
    // Hide the real hardware cursor — we draw our own inverse-cell caret in the
    // input box, so the blinking terminal cursor would otherwise sit wherever
    // Blessed last parked it (mid-screen). flushRender re-asserts this after every
    // paint since Blessed re-shows the cursor on render.
    try {
      (this.screen.program as { hideCursor?: () => void }).hideCursor?.();
    } catch {
      /* ignore — falls back to the per-paint escape in flushRender */
    }
    process.stdout.write("\x1b[?25l");

    // Guard the stdin handler: a throw here would otherwise propagate out of the
    // listener and could detach it, freezing all input. Reset transient paste
    // state so a mid-paste error can't leave us swallowing every keystroke.
    process.stdin.on("data", (chunk: string) => {
      try {
        this.onInputChunk(chunk);
      } catch (err) {
        this.pasting = false;
        log.error(`input failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  }

  /** Insert a pasted span at the caret, keeping newlines so multi-line snippets
   *  stay intact (and never auto-submit). */
  private insertPaste(text: string): void {
    if (!text) return;
    const normalized = text.replace(/\r\n?/g, "\n");
    this.applyLine(insertText(this.line(), normalized));
    this.maybeSlash();
    this.renderInput();
  }

  /**
   * Parse a raw stdin chunk into key actions. Handles ESC/CSI sequences (arrows,
   * Home/End, Delete) as cursor/history actions instead of inserting their bytes,
   * plus inline line editing (insert/delete at the caret). This replaces the old
   * byte-by-byte loop that leaked `[A`/`[D` into the buffer.
   */
  private onInputChunk(chunk: string): void {
    // A modal (tab-rename) is capturing input via its own screen.program
    // listener; drop everything so keystrokes don't also edit the hidden main
    // buffer and Enter doesn't fire a second, billed AI turn.
    if (this.modalActive) return;
    // Ctrl+F search overlay owns input while open.
    if (this.searchActive) {
      this.handleSearchInput(chunk);
      return;
    }
    // Reassemble escape sequences that were split across reads: prepend any ESC
    // byte held over from the previous chunk. SSH/ConPTY fragment sequences
    // routinely, so without this the next chunk's "[A" would land as literal text.
    if (this.escBuf) {
      chunk = this.escBuf + chunk;
      this.escBuf = "";
    }
    let i = 0;
    while (i < chunk.length) {
      const ch = chunk[i];
      const code = ch.charCodeAt(0);

      // ---- escape / CSI / SS3 sequences -------------------------------------
      if (code === 27) {
        const next = chunk[i + 1];
        if (next === "[" || next === "O") {
          // Consume until the final byte (0x40–0x7e).
          let j = i + 2;
          while (j < chunk.length && !(chunk.charCodeAt(j) >= 0x40 && chunk.charCodeAt(j) <= 0x7e)) j++;
          const seq = chunk.slice(i + 2, j + 1); // params + final
          // Bracketed-paste markers.
          if (seq === "200~") {
            this.pasting = true;
            this.pasteBuf = "";
            i = j + 1;
            continue;
          }
          if (seq === "201~") {
            this.pasting = false;
            this.insertPaste(this.pasteBuf);
            this.pasteBuf = "";
            i = j + 1;
            continue;
          }
          if (this.pasting) {
            // An escape sequence inside the paste body — keep it literal.
            this.pasteBuf += chunk.slice(i, j + 1);
            i = j + 1;
            continue;
          }
          this.handleCsi(seq);
          i = j + 1;
          continue;
        }
        if (this.pasting) {
          this.pasteBuf += ch;
          i += 1;
          continue;
        }
        // If ESC is the last byte of this chunk with no following byte, the
        // continuation ("[A", "[O", …) is coming in the next read. Hold the ESC
        // instead of treating it as a lone keypress — otherwise over SSH/ConPTY
        // the next chunk's "[A" leaks into the buffer as literal text.
        if (i === chunk.length - 1) {
          this.escBuf = ch;
          return;
        }
        if (this.slashActive) this.hideSlash(); // lone ESC closes the slash menu
        i += 1;
        continue;
      }

      // While pasting, accumulate every byte literally (newlines included) — no
      // Enter/submit, no slash-menu, no editing keys until the paste ends.
      if (this.pasting) {
        this.pasteBuf += ch;
        i += 1;
        continue;
      }

      // ---- permission prompt swallows the next keypress ----------------------
      if (this.permissionActive) {
        const allow = ch === "y" || ch === "Y";
        const current = this.permissionQueue.shift();
        this.permissionActive = false;
        this.addSystem(allow ? "Allowed." : "Denied.");
        current?.resolve(allow);
        this.showNextPermission(); // surface the next queued request, if any
        this.renderInput();
        i += 1;
        continue;
      }

      if (code === 13 || code === 10) {
        if (this.slashActive) this.acceptSlash(); // Enter selects from the menu
        else this.submit();
      } else if (code === 127 || code === 8) {
        // backspace: delete char before the caret
        if (this.inputCursor > 0) {
          this.applyLine(backspace(this.line()));
          this.renderInput();
          this.maybeSlash();
        }
      } else if (code === 3) {
        // Ctrl+C: cancel a run, else clear the line. Abort the in-flight request
        // (which now actually stops the model mid-stream) and let the run's own
        // `finally` clear isProcessing — clearing it here would unlock the input
        // while the aborted run is still tearing down, allowing a second
        // concurrent run to clobber shared state.
        if (this.isProcessing) {
          if (this.ac) {
            this.ac.abort();
            this.addSystem("Cancelling…");
          }
        } else {
          this.setInputLine("", 0);
        }
        this.hideSlash();
        this.renderInput();
      } else if (code === 9) {
        if (this.slashActive) this.acceptSlash(); // Tab selects from the menu
        else this.completeInput();
      } else if (code === 1) {
        this.inputCursor = 0; // Ctrl+A → start of line
        this.renderInput();
      } else if (code === 5) {
        this.inputCursor = this.inputBuffer.length; // Ctrl+E → end of line
        this.renderInput();
      } else if (code === 21) {
        this.setInputLine("", 0); // Ctrl+U → clear line
        this.hideSlash();
        this.renderInput();
      } else if (code === 23) {
        // Ctrl+W → delete the word before the caret
        this.applyLineEdit(killWordBack(this.inputBuffer, this.inputCursor));
        this.hideSlash();
        this.renderInput();
      } else if (code === 11) {
        // Ctrl+K → kill from caret to end of line
        this.applyLineEdit(killToEnd(this.inputBuffer, this.inputCursor));
        this.renderInput();
      } else if (code === 12) {
        // Ctrl+L → scroll the transcript to the top (clear-to-top, common TUI meaning)
        this.scrollChat(true);
      } else if (code === 6) {
        // Ctrl+F → open the in-conversation search overlay
        this.openSearch();
      } else if (ch === "?" && this.inputBuffer.length === 0 && !this.slashActive) {
        // ? (with an empty composer) → keyboard cheatsheet overlay
        this.showCheatsheet();
      } else if (code >= 32) {
        // printable: insert at caret (handles pasted runs char-by-char)
        this.applyLine(insertText(this.line(), ch));
        this.renderInput();
        this.maybeSlash();
      }
      i += 1;
    }
  }

  /** Handle a CSI/SS3 sequence body (params + final byte), e.g. "A", "1;5C", "3~". */
  private handleCsi(seq: string): void {
    if (this.permissionActive) return;
    switch (parseCsi(seq)) {
      case "up": // menu nav when open, else history
        if (this.slashActive) this.moveSlash(-1);
        else this.recallHistory(-1);
        break;
      case "down":
        if (this.slashActive) this.moveSlash(1);
        else this.recallHistory(1);
        break;
      case "right":
        if (this.inputCursor < this.inputBuffer.length) {
          this.applyLine(moveRight(this.line()));
          this.renderInput();
        }
        break;
      case "left":
        if (this.inputCursor > 0) {
          this.applyLine(moveLeft(this.line()));
          this.renderInput();
        }
        break;
      case "wordRight": // Ctrl+Right → jump to next word start
        {
          const next = wordForward(this.inputBuffer, this.inputCursor);
          if (next !== this.inputCursor) {
            this.inputCursor = next;
            this.renderInput();
          }
        }
        break;
      case "wordLeft": // Ctrl+Left → jump to previous word start
        {
          const prev = wordBack(this.inputBuffer, this.inputCursor);
          if (prev !== this.inputCursor) {
            this.inputCursor = prev;
            this.renderInput();
          }
        }
        break;
      case "home": // jump the scrollback to the top (line-start is Ctrl+A)
        this.scrollChat(true);
        break;
      case "end": // jump the scrollback to the bottom (line-end is Ctrl+E)
        this.scrollChat(false);
        break;
      case "delete":
        if (this.inputCursor < this.inputBuffer.length) {
          this.applyLine(deleteForward(this.line()));
          this.renderInput();
        }
        break;
      case "none":
        break;
    }
  }

  /** Shell-style Tab completion for the leading /command token. */
  private completeInput(): void {
    const names = COMMAND_CATALOG.map((c) => c.command.replace(/^\//, ""));
    const r = completeCommand(this.inputBuffer, names);
    if (r.kind === "none") return;
    if (r.kind === "single") {
      this.setInputLine(r.line, r.cursor);
    } else {
      if (r.line !== null) this.setInputLine(r.line, r.cursor);
      this.addSystem("  " + r.candidates.map((m) => `/${m}`).join("   "));
    }
    this.renderInput();
  }

  /** Show/refresh or hide the slash menu based on the current buffer. */
  private maybeSlash(): void {
    if (this.inputBuffer.startsWith("/") && !this.inputBuffer.includes(" ")) this.updateSlash();
    else this.hideSlash();
  }

  private updateSlash(): void {
    const c = themeEngine.getBlessedColors();
    this.slashItems = searchCatalog(this.inputBuffer.slice(1)).slice(0, 8);
    if (this.slashItems.length === 0) {
      this.hideSlash();
      return;
    }
    this.slashIndex = this.slashActive ? Math.min(this.slashIndex, this.slashItems.length - 1) : 0;
    const lines = this.slashItems.map((it, i) => {
      const name = it.command.padEnd(14);
      return i === this.slashIndex
        ? `{${c.accent || c.cyan}-fg}{bold}❯ ${name}{/} {${c.textSecondary}-fg}${this.esc(it.description)}{/}`
        : `  {${c.textPrimary}-fg}${name}{/} {${c.textTertiary}-fg}${this.esc(it.description)}{/}`;
    });
    this.slashBox.height = this.slashItems.length + 2;
    this.slashBox.setContent(lines.join("\n"));
    this.slashBox.show();
    this.slashBox.setFront();
    this.slashActive = true;
    this.scheduleRender();
  }

  private hideSlash(): void {
    if (!this.slashActive) return;
    this.slashActive = false;
    this.slashBox.hide();
    this.scheduleRender();
  }

  private moveSlash(dir: number): void {
    if (!this.slashActive || this.slashItems.length === 0) return;
    this.slashIndex = (this.slashIndex + dir + this.slashItems.length) % this.slashItems.length;
    this.updateSlash();
  }

  /** Fill the input with the highlighted command (ready for args / Enter to run). */
  private acceptSlash(): void {
    const it = this.slashItems[this.slashIndex];
    this.hideSlash();
    if (!it) return;
    const cmd = it.command.split(/\s/)[0];
    this.setInputLine(`${cmd} `, cmd.length + 1);
    this.renderInput();
  }

  /** Snapshot the live buffer/caret as a LineState for the pure input helpers. */
  private line(): LineState {
    return { buffer: this.inputBuffer, cursor: this.inputCursor };
  }

  /** Write a LineState (produced by a pure input helper) back to the live state. */
  private applyLine(s: LineState): void {
    this.inputBuffer = s.buffer;
    this.inputCursor = s.cursor;
  }

  /** Apply a LineEdit ({line, cursor}) from the word-motion/kill primitives. */
  private applyLineEdit(e: { line: string; cursor: number }): void {
    this.inputBuffer = e.line;
    this.inputCursor = e.cursor;
  }

  private setInputLine(text: string, cursor: number): void {
    this.inputBuffer = text;
    this.inputCursor = Math.max(0, Math.min(cursor, text.length));
  }

  /** Step through input history (dir -1 = older, +1 = newer). */
  private recallHistory(dir: number): void {
    const step = stepHistory(
      {
        history: this.inputHistory,
        index: this.historyIndex,
        draft: this.historyDraft,
        buffer: this.inputBuffer,
      },
      dir
    );
    if (!step) return;
    this.historyIndex = step.index;
    this.historyDraft = step.draft;
    this.setInputLine(step.line, step.line.length);
    this.renderInput();
  }

  private submit(): void {
    if (this.isProcessing) return;
    this.stickToBottom = true; // sending a message returns you to the live view
    const msg = this.inputBuffer.trim();
    this.setInputLine("", 0);
    this.historyIndex = -1;
    this.historyDraft = "";
    this.renderInput();
    if (!msg) return;
    if (this.inputHistory[this.inputHistory.length - 1] !== msg) this.inputHistory.push(msg);
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
      ["/model [name|#]", "List or switch model (no arg = pick list)"],
      ["/agent [name|#]", "List or switch agent (gsd, code, debug, plan, ask)"],
      ["/skill [name|#]", "List or run a skill: /skill <name> [args]"],
      ["/theme [name]", "List or switch theme"],
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
      // destroy() flushes dirty sessions and disconnects MCP before exiting —
      // a bare screen.destroy()+exit drops up to one autosave interval of
      // history and orphans MCP child processes.
      this.destroy();
      process.exit(0);
      return;
    }

    if (parsed.name === "clear") {
      // Delegate the data reset (context + cost) to the extracted handler, then
      // do the UI-only reset here (transcript/welcome). Keeps the B1 invariant
      // — context is wiped, not just the render buffer — in one tested place.
      handleClear(this.commandHost(), parsed.args);
      this.transcript = "";
      this.streamRaw = "";
      this.stream = "";
      this.bodyMemo.reset();
      this.printWelcome();
      this.addSystem("Cleared.");
      this.refreshStatus();
      this.scheduleRender();
      return;
    }

    if (parsed.name === "compact") {
      handleCompact(this.commandHost(), parsed.args);
      return;
    }

    if (parsed.name === "export") {
      handleExportCommand(this.commandHost(), parsed.args);
      return;
    }

    if (parsed.name === "branch") {
      handleBranchCommand(this.commandHost());
      return;
    }

    if (parsed.name === "cost") {
      handleCost(this.commandHost(), parsed.args);
      return;
    }

    if (parsed.name === "usage") {
      handleUsage(this.commandHost(), parsed.args);
      return;
    }

    if (parsed.name === "about") {
      handleAbout(this.commandHost(), parsed.args);
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
      handleContext(this.commandHost(), parsed.args);
      return;
    }

    // /setup shows provider-connection help. /connect (below) handles the
    // keyless Claude OAuth router and the generic help for a bare /connect.
    if (parsed.name === "setup") {
      handleSetupHelp(this.commandHost(), parsed.args);
      return;
    }

    if (parsed.name === "theme") {
      handleTheme(this.commandHost(), parsed.args);
      return;
    }

    if (parsed.name === "permissions" || parsed.name === "perms") {
      handlePermissions(this.commandHost(), parsed.args);
      return;
    }

    // /plan toggles read-only research mode; /plan off restores yolo.
    if (parsed.name === "plan") {
      handlePlan(this.commandHost(), parsed.args);
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
      await handleMarketplace(this.commandHost(), parsed.args);
      return;
    }

    if (parsed.name === "checkpoints") {
      handleCheckpoints(this.commandHost(), parsed.args);
      return;
    }

    if (parsed.name === "undo") {
      handleUndo(this.commandHost(), parsed.args);
      return;
    }

    if (parsed.name === "out" || parsed.name === "output") {
      handleOut(this.commandHost(), parsed.args);
      return;
    }

    // /regenerate — drop the last assistant turn and re-run the preceding user
    // turn (same engine primitive the GUI's regenerate button uses).
    if (parsed.name === "regenerate" || parsed.name === "retry") {
      const cm = this.getContextManager();
      const msgs = cm.getMessages();
      // Find the last user message index; truncate after it and re-run.
      let lastUser = -1;
      for (let k = msgs.length - 1; k >= 0; k--) {
        if (msgs[k].role === "user") { lastUser = k; break; }
      }
      if (lastUser < 0) {
        this.addError("Nothing to regenerate (no prior user turn).");
        return;
      }
      const userText = msgs[lastUser].content;
      cm.truncateToCount(lastUser);
      this.transcript = "";
      this.printWelcome();
      this.bodyMemo.reset();
      this.refreshStatus();
      this.scheduleRender();
      void this.chatWithAI(userText);
      return;
    }

    if (parsed.name === "agent" || parsed.name === "agents") {
      const agents = this.listAgents();
      const cur = state.get("currentAgent");
      const arg = parsed.args.join(" ").trim();
      if (!arg) {
        this.addSystem(this.numberedList("Agents", agents, cur, "/agent <name|number>"));
        return;
      }
      const picked = resolveSelection(agents, arg) ?? (agentRegistry.has(arg) ? arg : null);
      if (!picked) {
        this.addError(`Unknown agent: ${arg}. Run /agent to list them.`);
        return;
      }
      state.set("currentAgent", picked);
      events.emit("agent:switched", picked);
      const activeId = sessionManager.getActiveSessionId();
      if (activeId) sessionManager.updateSessionAgent(activeId, picked);
      this.addSystem(`Agent → ${picked}`);
      return;
    }

    if (parsed.name === "model" || parsed.name === "models") {
      const models = this.listModels();
      const cur = state.get("currentModel");
      const arg = parsed.args.join(" ").trim();
      if (!arg) {
        this.addSystem(
          this.numberedList("Models", models, cur, "/model <name|number>") +
            "\n  (or pass any provider/model id directly)"
        );
        return;
      }
      // Resolve a number / known id / unique short name; otherwise accept a
      // literal provider/model id so custom models still work.
      const picked = resolveSelection(models, arg) ?? (arg.includes("/") ? arg : null);
      if (!picked) {
        this.addError(`Unknown model: ${arg}. Run /model to list them, or pass a provider/model id.`);
        return;
      }
      state.set("currentModel", picked);
      events.emit("model:changed", picked);
      const activeId = sessionManager.getActiveSessionId();
      if (activeId) sessionManager.updateSessionModel(activeId, picked);
      this.addSystem(`Model → ${picked}`);
      return;
    }

    if (parsed.name === "skill" || parsed.name === "skills") {
      const skills = skillRegistry.getAll();
      const names = skills.map((s) => s.name);
      const arg = parsed.args[0];
      if (!arg) {
        if (skills.length === 0) {
          this.addSystem("No skills loaded.");
          return;
        }
        const lines = skills.map((s, i) => `  ${String(i + 1).padStart(2)}. ${s.name.padEnd(22)} ${s.description}`);
        this.addSystem(["Skills — run with /skill <name|number> [args]:", ...lines].join("\n"));
        return;
      }
      const pickedName = resolveSelection(names, arg);
      const skill = pickedName ? skillRegistry.get(pickedName) : undefined;
      if (!skill) {
        this.addError(`Unknown skill: ${arg}. Run /skill to list them.`);
        return;
      }
      const rest = parsed.args.slice(1);
      this.addSystem(`▶ Running skill "${skill.name}"…`);
      // Skills are prompt templates (like commands): substitute $ARGUMENTS/$1…
      // then run the body through the agent.
      await this.chatWithAI(resolveTemplate(skill.content, rest));
      return;
    }

    if (parsed.name === "providers") {
      handleProviders(this.commandHost(), parsed.args);
      return;
    }

    if (parsed.name === "tabs") {
      this.handleTabsCommand(parsed.args);
      return;
    }

    if (parsed.name === "cmd") {
      await handleCmdSearch(this.commandHost(), parsed.args.join(" "));
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

    if (parsed.name === "workflow") {
      await handleWorkflowCommand(this.commandHost(), parsed.args);
      return;
    }

    if (parsed.name === "sync") {
      handleSyncCommand(this.commandHost(), parsed.args);
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

    // /autopilot — fully autonomous "ralph loop": runs the GSD cycle over and
    // over (each iteration verified by a deterministic gate + a strict model
    // gate) until the project is production-ready, the iteration budget runs
    // out, or it stalls. Set-and-forget; Ctrl+C stops it.
    if (parsed.name === "autopilot" || parsed.name === "auto") {
      const goal = parsed.args.join(" ").trim();
      if (!goal) {
        this.addSystem(
          "Usage: /autopilot <goal>  — autonomously grind until the project is production-ready.\n" +
            "  e.g. /autopilot make the CLI feature-complete with tests, docs, and a clean build"
        );
        return;
      }
      await this.runAutonomous(goal);
      return;
    }

    // /connect claude — point the anthropic provider at your OAuth router
    // (keyless) so you can use a Claude subscription. Takes effect immediately.
    if (parsed.name === "connect") {
      const target = (parsed.args[0] || "").toLowerCase();
      if (!target) {
        // Bare /connect → generic provider-connection help.
        this.addSystem(
          [
            "Connect an AI provider:",
            "  Claude (keyless): /connect claude [router-url]  — use your OAuth router",
            "  Env var:          set ZAI_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY",
            "  Wizard:           run  node dist/cli.js setup  in a terminal",
            "  Then switch with: /model   (lists models)",
          ].join("\n")
        );
        return;
      }
      if (target !== "claude") {
        this.addSystem("Usage: /connect claude [router-url]  — use Claude via your OAuth router (keyless)");
        return;
      }
      const url = parsed.args[1] || DEFAULT_ROUTER_URL;
      try {
        const path = writeRouterConfig(url, DEFAULT_CLAUDE_MODEL);
        const fresh = getConfigManager().load();
        providerManager.initializeFromConfig(fresh.provider as never);
        state.set("currentModel", DEFAULT_CLAUDE_MODEL);
        this.addSystem(`✓ Connected Claude via OAuth router (keyless) → ${url}\n  config: ${path}\n  model → ${DEFAULT_CLAUDE_MODEL}`);
        const probe = await probeRouter(url);
        this.addSystem(
          probe.reachable
            ? `✓ Router reachable — ${probe.detail}. Go ahead and chat.`
            : `! Router not running yet (${probe.detail}).\n${routerStartHelp()}`
        );
      } catch (err) {
        this.addError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    if (parsed.name === "ask-prime") {
      await handleAskPrime(this.commandHost(), parsed.args);
      return;
    }

    if (parsed.name === "describe") {
      await handleDescribe(this.commandHost(), parsed.args);
      return;
    }

    if (parsed.name === "workspace" || parsed.name === "ws") {
      handleWorkspaceCommand(this.commandHost(), parsed.args);
      return;
    }

    if (parsed.name === "team") {
      handleTeamCommand(this.commandHost(), parsed.args);
      return;
    }

    const cmd = commandRegistry.get(parsed.name);
    if (cmd) {
      // For the automation loop, refine casual goal input into a well-structured
      // loop goal (pure heuristic, model-independent) before substituting into
      // the template — so "/loop login validation" gets a done-condition.
      // Fires for both /automationloop and its /loop alias.
      let args = parsed.args;
      if ((cmd.name === "automationloop" || cmd.name === "loop") && args.length > 0) {
        const { refined } = refineGoal(args.join(" "));
        args = [refined];
      }
      // v2.6: /tdd runs the GSD pipeline with TDD_PHASES (test-red before implement).
      if (cmd.name === "tdd" && args.length > 0) {
        await this.runGsdDelegated(args.join(" "), TDD_PHASES);
        return;
      }
      // v2.9: /fork branches the session at a turn index.
      if (cmd.name === "fork") {
        const activeId = sessionManager.getActiveSession()?.id;
        if (!activeId) { this.addSystem("No active session to fork."); return; }
        const turnIdx = args.length > 0 ? parseInt(args[0], 10) : undefined;
        const msgs = this.getContextManager().getMessageCount();
        const idx = turnIdx !== undefined && !Number.isNaN(turnIdx) ? Math.max(0, Math.min(turnIdx, msgs - 1)) : msgs - 1;
        const forked = sessionManager.forkSession(activeId, idx);
        if (forked) {
          sessionManager.setActiveSession(forked.id);
          this.addSystem(`Forked session at turn ${idx + 1} → new session "${forked.title}".`);
          this.tabManager.refresh();
        } else {
          this.addSystem("Fork failed — see logs.");
        }
        return;
      }
      await this.chatWithAI(resolveTemplate(cmd.template, args));
      return;
    }

    this.addError(`Unknown command: /${parsed.name}. Type / to see commands.`);
  }

  private commandHost(): CommandHost {
    return {
      projectRoot: this.projectRoot,
      tabManager: this.tabManager,
      addSystem: (t) => this.addSystem(t),
      addError: (t) => this.addError(t),
      chatWithAI: (m) => this.chatWithAI(m),
      getCost: () => this.cost,
      resetCost: () => {
        this.cost = {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          requests: 0,
          estimatedCostUSD: 0,
        };
      },
      getContext: () => this.getContextManager(),
      markSessionDirty: () => {
        const id = sessionManager.getActiveSessionId();
        if (id) sessionManager.markDirty(id);
      },
      requestRender: () => {
        this.refreshStatus();
        this.scheduleRender();
      },
      getPermissionMode: () => this.permissionMode,
      setPermissionMode: (mode) => {
        this.permissionMode = mode;
      },
      getLastToolOutput: () => this.lastToolOutput,
    };
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

  /** Interactive permission prompt: resolves when the user presses y/N.
   *  For file mutations, shows the actual diff so the user approves code, not a filename. */
  private askPermission(req: PermissionRequest, reason: string): Promise<boolean> {
    const label = `${req.tool}${req.action ? `(${req.action})` : ""}`;
    // v2.5: build a diff preview for file edits/writes so the user sees what changes.
    let diffPreview = "";
    if ((req.tool === "file" || req.tool === "edit") && req.path && req.proposedContent) {
      try {
        let prior = "";
        try { prior = readFileSync(resolve(this.projectRoot, req.path), "utf-8"); } catch { /* new file */ }
        diffPreview = "\n" + formatApprovalPrompt(prior, req.proposedContent, req.path);
      } catch { /* diff is best-effort; never block the ask on it */ }
    }
    return new Promise((resolve) => {
      this.permissionQueue.push({ label, reason, resolve, diffPreview });
      if (!this.permissionActive) this.showNextPermission();
    });
  }

  /**
   * Toggle input suppression while a modal (tab-rename) is open. While active
   * the raw-stdin handler ignores all keys so they aren't double-fed into the
   * main input buffer (and Enter doesn't submit a phantom AI turn). Mirrors the
   * permissionActive gate. Public so TabManager can call it around the modal.
   */
  setModalActive(active: boolean): void {
    this.modalActive = active;
  }

  /** Show a centered keyboard-cheatsheet overlay; any key dismisses it. */
  private showCheatsheet(): void {
    const c = themeEngine.getBlessedColors();
    const lines = [
      "{bold}Sentinel — keyboard shortcuts{/}",
      "",
      "{bold}Editing{/}",
      "  Ctrl+A / Ctrl+E     line start / end",
      "  Ctrl+W              delete word before caret",
      "  Ctrl+K              delete caret → end of line",
      "  Ctrl+U              clear line",
      "  Ctrl+← / Ctrl+→     jump word back / forward",
      "  Tab                 complete /command",
      "",
      "{bold}Navigation{/}",
      "  Ctrl+F              search transcript",
      "  Ctrl+L              scroll to top",
      "  Home / End          top / bottom of transcript",
      "  ?                   this cheatsheet",
      "",
      "{bold}Tabs / models{/}",
      "  Ctrl+N / Ctrl+W     new / close tab",
      "  Ctrl+1..9           switch tab",
      "  Ctrl+R              rename tab",
      "  Ctrl+O / Shift+Tab  cycle model / agent",
      "  Ctrl+T              cycle theme",
      "  Ctrl+Q              quit",
      "",
      "{bold}Run{/}",
      "  Ctrl+C              cancel the current run",
      "  /                   slash-command menu",
    ];
    const w = 56;
    const h = lines.length + 4;
    const left = Math.floor(((this.screen.width as number) - w) / 2);
    const top = Math.floor(((this.screen.height as number) - h) / 2);
    const overlay = blessed.box({
      parent: this.screen,
      top: 0, left: 0, width: "100%", height: "100%",
      style: { bg: "black", fg: "white" }, opacity: 0.7,
    });
    const box = blessed.box({
      parent: this.screen, top, left, width: w, height: h,
      border: { type: "line" },
      style: { bg: c.bgSecondary, fg: c.textPrimary, border: { fg: c.accent || c.cyan } },
      tags: true,
    });
    blessed.text({
      parent: box, top: 1, left: 1, width: w - 2,
      content: lines.join("\n"), tags: true,
      style: { fg: c.textPrimary },
    });
    this.setModalActive(true);
    this.screen.render();
    const close = (): void => {
      this.screen.program.removeListener("keypress", close);
      overlay.destroy();
      box.destroy();
      this.setModalActive(false);
      this.screen.render();
    };
    this.screen.program.on("keypress", close);
    overlay.on("destroy", () => this.screen.program.removeListener("keypress", close));
  }

  /** Open the Ctrl+F transcript search overlay. */
  private openSearch(): void {
    this.searchActive = true;
    this.search.reset();
    this.renderSearchBar();
  }

  /** Close the search overlay and repaint the status bar. */
  private closeSearch(): void {
    this.searchActive = false;
    this.search.reset();
    this.slashBox.hide();
    this.screen.render();
    this.refreshStatus();
  }

  /** Drive the search overlay from a raw stdin chunk. */
  private handleSearchInput(chunk: string): void {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      const code = ch.charCodeAt(0);
      if (code === 27) {
        // Esc closes; an ESC-led sequence (arrows) is ignored for simplicity.
        this.closeSearch();
        return;
      }
      if (code === 13 || code === 10) {
        // Enter → next match (and scroll to it).
        const m = this.search.next();
        if (m !== null) this.scrollToOffset(m);
        this.renderSearchBar();
        return;
      }
      if (code === 8 || code === 127) {
        this.search.query = this.search.query.slice(0, -1);
      } else if (code >= 32) {
        this.search.query += ch;
      }
      // Re-run on the visible transcript.
      this.search.findAll(this.transcript);
      this.renderSearchBar();
      const cur = this.search.current();
      if (cur !== null) this.scrollToOffset(cur);
    }
  }

  /** Render the search bar into the slash overlay box + match counter. */
  private renderSearchBar(): void {
    const c = themeEngine.getBlessedColors();
    const count = this.search.count();
    const idx = this.search.indexOneBased();
    const counter = count > 0 ? `{${c.textTertiary}-fg} ${idx}/${count}{/}` : `{${c.textTertiary}-fg} (no matches){/}`;
    this.slashBox.setContent(
      `{${c.cyan}-fg}{bold}Search{/} {${c.textSecondary}-fg}${this.esc(this.search.query)}{/}${counter}`
    );
    this.slashBox.show();
    this.screen.render();
  }

  /** Scroll the chat so the line containing `offset` is visible. */
  private scrollToOffset(offset: number): void {
    // Map a character offset in the transcript to a line number, then scroll.
    const upto = this.transcript.slice(0, offset);
    const line = upto.split("\n").length - 1;
    try {
      this.chat.setScroll(line);
      this.stickToBottom = false;
      this.refreshStatus();
    } catch {
      // setScroll can throw before layout — ignore.
    }
  }

  /** Render the prompt for the head of the permission queue (if any). */
  private showNextPermission(): void {
    const next = this.permissionQueue[0];
    if (!next) {
      this.permissionActive = false;
      return;
    }
    this.permissionActive = true;
    const c = themeEngine.getBlessedColors();
    const more = this.permissionQueue.length > 1 ? ` {${c.textTertiary}-fg}(+${this.permissionQueue.length - 1} queued){/}` : "";
    const diff = next.diffPreview
      ? `\n{${c.textTertiary}-fg}${this.esc(next.diffPreview)}{/}\n`
      : "\n";
    this.push(
      `\n{${c.amber}-fg}{bold}⚠ Permission{/} allow {bold}${this.esc(next.label)}{/}? ` +
        `{${c.textSecondary}-fg}[y/N] (${this.esc(next.reason)}){/}${more}${diff}`
    );
    this.renderInput();
  }

  private async chatWithAI(userMessage: string): Promise<void> {
    this.isProcessing = true;
    state.set("isProcessing", true);
    this.renderInput();

    const cm = this.getContextManager();

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
      cm.setSystemPrompt(buildSystemPrompt(agentName, this.projectRoot));

      // Shared provider + guarded/MCP-aware executor + subagent-tool stack
      // (src/tui/agent-stack.ts; also used by /pipeline and /ship).
      const { provider, runnerModel, mcpAware, execute, childToolDefs, subagentTool } =
        buildAgentBase({
          config,
          model: state.get("currentModel"),
          agent: agentName,
          mcp: this.mcp,
          permissionMode: this.permissionMode,
          projectRoot: this.projectRoot,
          ask: (req, reason) => this.askPermission(req, reason),
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
          summarizeForCompaction: makeCompactionSummarizer(provider, runnerModel),
        },
        { model: runnerModel, maxRounds: agentRegistry.roundsFor(agentName), maxContextTokens: 84000 }
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
      runner.on("toolResult", (name, ok, _firstLine, full) => {
        usageTracker.recordTool(name, ok); // V17: per-tool metrics
        this.addTool(name, this.pendingToolArgs, ok, full);
      });
      runner.on("contextLarge", () => {
        cm.compact();
      });
      runner.on("compacted", (t) =>
        this.addSystem(`↺ Auto-compressed context → ~${Math.round(t / 1000)}k tokens (no restart needed).`)
      );
      runner.on("runError", (e) => {
        this.endAssistant();
        this.addError(e instanceof Error ? e.message : String(e));
      });

      // V2: expand @file / @url mentions into the message before the agent runs.
      // D2: pull image @-mentions out BEFORE expandMentions (which would read
      // binary images as utf8). Load each as an attachment; missing files are
      // noted inline. Non-image mentions stay for expandMentions.
      const { mentions: imgMentions, stripped } = extractImageMentions(userMessage);
      const imageAttachments: Attachment[] = [];
      const imageErrors: string[] = [];
      for (const m of imgMentions) {
        try {
          imageAttachments.push(loadAttachment(resolve(this.projectRoot, m)));
        } catch (err) {
          imageErrors.push(`@${m}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      let outbound = await expandMentions(stripped, this.projectRoot);
      if (imageErrors.length > 0) {
        outbound += `\n[${imageErrors.join("; ")}]`;
      }
      // V3: auto-recall relevant memories from the Sentinel Prime brain (when its
      // MCP server is connected). Read-only, so it bypasses the permission guard.
      if (this.mcp.has(DEFAULT_RECALL_TOOL)) {
        try {
          outbound += await recallRelevant(mcpAware, userMessage);
        } catch {
          // recall is best-effort; never block the turn on it
        }
      }
      const runResult = await runner.run(outbound, this.ac.signal, imageAttachments);

      // Aborting mid-stream means streamEnd never fired, leaving the assistant
      // block open — close it and confirm the cancel.
      if (runResult.stopReason === "aborted") {
        this.endAssistant();
        this.addSystem("Cancelled.");
      }

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
   * Shared prologue/epilogue for the delegated runners (pipeline / GSD /
   * autopilot): set isProcessing, own a fresh AbortController, connect MCP once,
   * build the agent stack, run the body, and on the way out clear processing
   * state + re-render. The body receives the assembled `subagentTool` and the
   * run's `signal`; it can throw — errors are surfaced via addError and the
   * cleanup still runs. This removes ~3× the same ~20-line block.
   */
  private async runDelegated(
    body: (deps: { subagentTool: ReturnType<typeof buildAgentBase>["subagentTool"]; signal: AbortSignal }) => Promise<void>
  ): Promise<void> {
    this.isProcessing = true;
    state.set("isProcessing", true);
    this.ac = new AbortController();
    this.renderInput();

    try {
      const config = getConfigManager().getAll();
      const agentName = state.get("currentAgent");

      // Connect MCP once per session so delegated subagents see MCP tools too.
      if (!this.mcpConnected) {
        this.mcpConnected = true;
        try {
          await this.mcp.connect((config.mcp as Record<string, never>) || {});
        } catch {
          // non-fatal: continue with built-in tools only
        }
      }

      const { subagentTool } = buildAgentBase({
        config,
        model: state.get("currentModel"),
        agent: agentName,
        mcp: this.mcp,
        permissionMode: this.permissionMode,
        projectRoot: this.projectRoot,
        ask: (req, reason) => this.askPermission(req, reason),
      });

      await body({ subagentTool, signal: this.ac.signal });

      const activeId = sessionManager.getActiveSessionId();
      if (activeId) sessionManager.markDirty(activeId);
    } catch (err) {
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
    await this.runDelegated(async ({ subagentTool, signal }) => {
      this.addSystem(`▶ Running pipeline "${pipeline.name}" (${pipeline.steps.length} step(s))...`);

      const results = await runPipeline(
        pipeline,
        async (step, prior) => {
          if (signal.aborted) return "ERROR: cancelled";
          const priorBlock = prior.length
            ? "Prior step results:\n" +
              prior.map((r) => `### ${r.name}\n${r.result}`).join("\n\n")
            : "";
          return subagentTool.execute(
            {
              task: step.prompt,
              context: priorBlock || undefined,
            },
            signal
          );
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
    });
  }

  /**
   * V8: run the autonomous GSD pipeline (plan → implement → test → review → fix)
   * for a single task. Each phase is delegated to an isolated subagent (same
   * guarded + MCP-aware executor stack the main loop and pipelines use), receiving
   * the task plus all prior phase outputs. After review, a fix phase runs only when
   * the review output signals a problem. Mirrors `runPipelineDelegated`'s wiring.
   */
  private async runGsdDelegated(task: string, phases?: readonly string[]): Promise<void> {
    // v2.2 wiring: resolve router roles for per-phase model selection.
    const config = getConfigManager(this.projectRoot).getAll();
    const resolvePhaseModel = (phase: string): string | undefined => {
      if (!config.router) return undefined;
      const { resolveRole } = require("../ai/router.js") as typeof import("../ai/router.js");
      if (phase === "plan" || phase === "test-red") {
        const chain = resolveRole(config.router!, "plan");
        return chain[0]?.split("/").slice(1).join("/");
      }
      if (phase === "review" || phase === "test-green") {
        const chain = resolveRole(config.router!, "smol");
        return chain[0]?.split("/").slice(1).join("/");
      }
      return undefined;
    };
    await this.runDelegated(async ({ subagentTool, signal }) => {
      this.addSystem(`▶ Shipping: "${task}" — autonomous GSD pipeline (plan → implement → test → review → fix)...`);

      const results = await runGsd(
        task,
        async (phase, t, prior) => {
          if (signal.aborted) return "ERROR: cancelled";
          const priorBlock = prior.length
            ? prior.map((p) => `### ${p.phase}\n${p.output}`).join("\n\n")
            : undefined;
          // v2.2: pass the per-phase model override (plan → strong, review → smol).
          const phaseModel = resolvePhaseModel(phase);
          return subagentTool.execute(
            {
              task: buildPhasePrompt(phase, t, prior),
              context: priorBlock,
              ...(phaseModel ? { model: phaseModel } : {}),
            },
            signal
          );
        },
        {
          onPhaseStart: (phase) => this.addSystem(`  • phase "${phase}"...`),
          onPhaseEnd: (r) => {
            const first = r.output.split("\n")[0].slice(0, 200);
            this.addSystem(`    ${r.output.startsWith("ERROR") ? "✗" : "✓"} ${r.phase}: ${first}`);
          },
          ...(phases ? { phases } : {}),
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
    });
  }

  /**
   * Fully autonomous "ralph loop". Repeatedly runs the GSD cycle on the goal and
   * gates each iteration on BOTH a deterministic check (lint/test/build) and a
   * strict model verdict, feeding remaining work back into the next iteration.
   * Keeps going until production-ready, the iteration budget is spent, or it
   * stalls (stops changing anything). Cancellable with Ctrl+C.
   */
  private async runAutonomous(goal: string): Promise<void> {
    await this.runDelegated(async ({ subagentTool, signal }) => {
      const config = getConfigManager().getAll();
      const ap = config.autopilot ?? { maxIterations: 10, maxStalls: 2 };
      const maxIterations = Math.max(1, ap.maxIterations ?? 10);
      const maxStalls = Math.max(1, ap.maxStalls ?? 2);

      this.addSystem(`🤖 {bold}Autopilot engaged.{/} Ctrl+C to stop.`);

      const result = await runAutopilotSession({
        goal,
        projectRoot: this.projectRoot,
        maxIterations,
        maxStalls,
        verifyCommands: ap.verifyCommands,
        maxMinutes: ap.maxMinutes,
        maxCostUSD: ap.maxCostUSD,
        costSpent: () => usageTracker.snapshot().estimatedCostUSD,
        resume: true, // auto-resume a prior interrupted run for the same goal
        runSubagent: (args, sig) => subagentTool.execute(args, sig),
        signal,
        log: (m) => this.addSystem(m),
      });

      this.addSystem("\n" + summarizeAutopilot(result));
    });
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
    this.bodyMemo.reset(); // force a full repaint of the new tab's transcript

    const msgs = session.contextManager.getMessages();
    for (const msg of msgs) {
      const c = themeEngine.getBlessedColors();
      if (msg.role === "user") {
        this.transcript += "\n" + this.card("you", this.esc(msg.content), "cyan") + "\n";
      } else if (msg.role === "assistant") {
        this.transcript += "\n" + this.assistantCard(msg.content) + "\n";
      } else if (msg.role === "tool") {
        const firstLine = msg.content.split("\n")[0].slice(0, 200);
        this.transcript += `{${c.textTertiary}-fg}${this.esc(firstLine)}{/}\n`;
      }
    }
    this.transcript = capTranscript(this.transcript, MAX_TRANSCRIPT_LINES);
    this.stickToBottom = true; // land at the live view when switching tabs

    // Restore the FULL cost tracker from the session, not just dollars —
    // previously token/request tallies were zeroed while cost survived, so
    // /cost showed "0 tokens, 0 requests, $0.42" after a tab switch.
    this.cost = { ...session.cost };

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
      this.destroy(); // flush sessions + disconnect MCP before exit
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

    this.screen.key(["S-tab"], () => { // Shift+Tab; Ctrl+A is reserved for line-start in the raw-stdin editor
      const agents = this.listAgents();
      const cur = state.get("currentAgent");
      const next = agents[(agents.indexOf(cur) + 1) % agents.length] || agents[0];
      state.set("currentAgent", next);
      events.emit("agent:switched", next);
      this.addSystem(`Agent → ${next}`);
    });

    this.screen.key(["C-o"], () => { // Ctrl+O; Ctrl+M IS the Enter key, do not bind it
      const models = this.listModels();
      if (models.length === 0) return;
      const cur = state.get("currentModel");
      const next = models[(models.indexOf(cur) + 1) % models.length] || models[0];
      state.set("currentModel", next);
      events.emit("model:changed", next);
      const activeId = sessionManager.getActiveSessionId();
      if (activeId) sessionManager.updateSessionModel(activeId, next);
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
    if (this.destroyed) return; // idempotent: called on /quit, Ctrl+Q, and process exit
    this.destroyed = true;
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = undefined;
    }
    if (this.ambientInterval) {
      clearInterval(this.ambientInterval);
      this.ambientInterval = undefined;
    }
    sessionManager.shutdown();
    void this.mcp.disconnect();
    if (process.stdin.isTTY) {
      process.stdout.write("\x1b[?2004l"); // disable bracketed paste
      process.stdout.write("\x1b[?25h"); // restore the hardware cursor
    }
    if (this.screen) this.screen.destroy();
  }
}
