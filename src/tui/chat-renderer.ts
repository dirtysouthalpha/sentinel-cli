import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";
import { state } from "../core/state.js";
import { sessionManager } from "../core/session-manager.js";
import { renderMarkdown } from "./render-markdown.js";

export interface CostTracker {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requests: number;
  estimatedCostUSD: number;
}

export class ChatRenderer {
  private chat!: blessed.Widgets.BoxElement;
  private status!: blessed.Widgets.BoxElement;
  private screen!: blessed.Widgets.Screen;

  private transcript = "";
  private stream = "";
  private streamRaw = "";
  private streamHeaderShown = false;

  private cost: CostTracker = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    requests: 0,
    estimatedCostUSD: 0,
  };

  private version = "0.3.0";

  init(chat: blessed.Widgets.BoxElement, status: blessed.Widgets.BoxElement, screen: blessed.Widgets.Screen): void {
    this.chat = chat;
    this.status = status;
    this.screen = screen;
  }

  setVersion(v: string): void { this.version = v; }
  getCost(): CostTracker { return { ...this.cost }; }
  setCost(cost: CostTracker): void { this.cost = { ...cost }; }

  private esc(s: string): string {
    return s.replace(/[{}]/g, (ch) => (ch === "{" ? "{open}" : "{close}"));
  }

  render(): void {
    this.chat.setContent(this.transcript + this.stream);
    this.chat.setScrollPerc(100);
    this.screen.render();
  }

  push(block: string): void {
    this.transcript += block;
    this.render();
  }

  // ── message rendering ──────────────────────────────────────────────────────

  addUser(text: string): void {
    const c = themeEngine.getBlessedColors();
    const lines = this.esc(text).split("\n");
    // First line gets the "You" header inline; subsequent lines are indented
    const header = `{${c.cyan}-fg}{bold}❯ You{/}`;
    const body = lines.map((l) => `  {${c.textPrimary}-fg}${l}{/}`).join("\n");
    this.push(`\n${header}\n${body}\n`);
  }

  // ── streaming ──────────────────────────────────────────────────────────────

  startAssistant(): void {
    this.stream = "";
    this.streamRaw = "";
    this.streamHeaderShown = false;
  }

  streamAssistant(token: string): void {
    const c = themeEngine.getBlessedColors();
    if (!this.streamHeaderShown) {
      this.transcript += `\n{${c.lime}-fg}{bold}◈ Sentinel{/}\n`;
      this.streamHeaderShown = true;
    }
    this.stream += this.esc(token);
    this.streamRaw += token;
    this.render();
  }

  endAssistant(): void {
    if (this.streamHeaderShown) {
      this.transcript += renderMarkdown(this.streamRaw, themeEngine.getBlessedColors() as unknown as Record<string, string>) + "\n";
    }
    this.stream = "";
    this.streamRaw = "";
    this.streamHeaderShown = false;
    this.render();
  }

  // ── structured messages ────────────────────────────────────────────────────

  addTool(name: string, args: string, ok: boolean, firstLine: string): void {
    const c = themeEngine.getBlessedColors();
    const mark = ok ? `{${c.lime}-fg}✓{/}` : `{${c.error}-fg}✗{/}`;
    const a = this.esc(args).replace(/\s+/g, " ").slice(0, 80);
    const fl = firstLine ? `\n    {${c.textTertiary}-fg}${this.esc(firstLine).slice(0, 100)}{/}` : "";
    this.push(`  {${c.amber}-fg}▸ ${name}{/} {${c.textTertiary}-fg}${a}{/}\n  ${mark}${fl}\n`);
  }

  addSystem(text: string): void {
    const c = themeEngine.getBlessedColors();
    const body = text
      .split("\n")
      .map((l) => `  {${c.textSecondary}-fg}${this.esc(l)}{/}`)
      .join("\n");
    this.push(`\n{${c.border}-fg}─── system {/}\n${body}\n`);
  }

  addError(text: string): void {
    const c = themeEngine.getBlessedColors();
    this.push(`\n{${c.error}-fg}{bold}✗ Error:{/} {${c.error}-fg}${this.esc(text)}{/}\n`);
  }

  divider(): void {
    const c = themeEngine.getBlessedColors();
    this.push(`{${c.border}-fg}${"─".repeat(72)}{/}\n`);
  }

  // ── welcome ────────────────────────────────────────────────────────────────

  printWelcome(availableProviders: string[]): void {
    const c = themeEngine.getBlessedColors();
    const providerList = availableProviders.length > 0
      ? `{${c.lime}-fg}●{/} {${c.textSecondary}-fg}${availableProviders.join(", ")}{/}`
      : `{${c.amber}-fg}● no provider{/} {${c.textTertiary}-fg}— run {/}{${c.cyan}-fg}/connect{/}`;

    const model = state.get("currentModel").split("/").pop() || "";
    const agent = state.get("currentAgent");

    let s = `\n`;
    s += `  {${c.cyan}-fg}{bold}◈ SENTINEL{/} {${c.textTertiary}-fg}v${this.version}{/}  ${providerList}\n`;
    s += `  {${c.textTertiary}-fg}model:{/} {${c.accent || c.cyan}-fg}${model}{/}  {${c.textTertiary}-fg}agent:{/} {${c.accent || c.cyan}-fg}${agent}{/}\n`;
    s += `\n`;
    s += `  {${c.textTertiary}-fg}↩ send  /{/}{${c.cyan}-fg}cmd{/}{${c.textTertiary}-fg}  ↑↓ history  Ctrl+P palette  Ctrl+Q quit{/}\n`;
    this.push(s);
    this.divider();
  }

  // ── powerline status bar ───────────────────────────────────────────────────

  refreshStatus(): void {
    const c = themeEngine.getBlessedColors();
    const agent    = state.get("currentAgent");
    const model    = (state.get("currentModel") as string).split("/").pop() || "";
    const processing = state.get("isProcessing") as boolean;
    const compressionStats = state.get("compressionStats") as { savingsPercent: number };
    const tabs     = sessionManager.getSessionCount();

    // status dot
    const dot = processing
      ? `{${c.amber}-fg}⠶ working{/}`
      : `{${c.lime}-fg}● ready{/}`;

    // cost / token display
    const costStr = this.cost.requests > 0
      ? `$${this.cost.estimatedCostUSD.toFixed(4)}  ${this.cost.totalTokens.toLocaleString()} tok`
      : ``;

    const compression = compressionStats.savingsPercent > 0
      ? `{${c.lime}-fg}${compressionStats.savingsPercent}%↓{/}  `
      : ``;

    const tabStr = tabs > 1 ? `  {${c.textTertiary}-fg}${tabs} tabs{/}` : ``;

    // Segment separator
    const sep = `  {${c.border}-fg}▌{/}  `;

    this.status.setContent(
      ` ${dot}` +
      `${sep}{${c.accent || c.cyan}-fg}${agent}{/}` +
      `${sep}{${c.textSecondary}-fg}${model}{/}` +
      (costStr ? `${sep}{${c.textTertiary}-fg}${compression}${costStr}{/}` : ``) +
      tabStr +
      `  {${c.textTertiary}-fg}Ctrl+P menu  Ctrl+S sidebar  Ctrl+Q quit{/} `
    );
    this.screen.render();
  }

  applyTheme(chat: blessed.Widgets.BoxElement, input: blessed.Widgets.BoxElement): void {
    const c = themeEngine.getBlessedColors();
    chat.style.bg = c.bgPrimary;
    chat.style.fg = c.textPrimary;
    input.style.bg = c.bgSecondary;
    this.status.style.bg = c.bgTertiary;
    this.refreshStatus();
  }

  // ── cost ───────────────────────────────────────────────────────────────────

  updateCost(usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined): void {
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

  // ── transcript access ──────────────────────────────────────────────────────

  getTranscript(): string { return this.transcript; }
  setTranscript(t: string): void { this.transcript = t; }
  clearStream(): void { this.stream = ""; this.streamRaw = ""; this.streamHeaderShown = false; }
}
