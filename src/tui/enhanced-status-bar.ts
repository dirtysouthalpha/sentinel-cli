/**
 * Enhanced status bar with hover tooltips and detailed breakdowns
 */

import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";
import { state } from "../core/state.js";
import { sessionManager } from "../core/session-manager.js";
import { usageTracker } from "../core/usage-tracker.js";

export interface StatusStats {
  working: boolean;
  agent: string;
  model: string;
  msgs: number;
  compression: string;
  cost: string;
  tabs: number;
  scroll: boolean;
}

export class EnhancedStatusBar {
  private status!: blessed.Widgets.BoxElement;
  private tooltip?: blessed.Widgets.BoxElement;
  private hoverSection: string | null = null;

  constructor(private parent: blessed.Widgets.Screen, private bottomOffset = 0) {
    this.createUI();
    this.setupInteractions();
  }

  private createUI() {
    const c = themeEngine.getBlessedColors();

    this.status = blessed.box({
      parent: this.parent,
      bottom: this.bottomOffset,
      left: 0,
      width: "100%",
      height: 1,
      tags: true,
      mouse: true,
      style: { bg: c.bgSecondary, fg: c.textSecondary },
    });

    this.status.on("mousemove", (data) => this.handleMouseMove(data));
    this.status.on("leave", () => this.hideTooltip());
  }

  private setupInteractions() {
    // Handle click on sections
    this.status.on("click", (data) => {
      const section = this.getSectionAtPosition(data.x);
      if (section) {
        this.parent.emit("status-click", section);
      }
    });
  }

  private getSectionAtPosition(x: number): string | null {
    const content = this.status.getContent();
    // This is a simplified version - real implementation would calculate
    // the actual section based on content width
    if (x < 20) return "working";
    if (x < 35) return "agent";
    if (x < 55) return "msgs";
    if (x < 65) return "cost";
    if (x < 70) return "tabs";
    if (x < 75) return "scroll";
    return null;
  }

  private handleMouseMove(data: { x: number }) {
    const section = this.getSectionAtPosition(data.x);
    if (section !== this.hoverSection) {
      this.hoverSection = section;
      if (section) {
        this.showTooltip(section);
      } else {
        this.hideTooltip();
      }
    }
  }

  private showTooltip(section: string) {
    const c = themeEngine.getBlessedColors();

    this.tooltip = blessed.box({
      parent: this.parent,
      left: 2,
      bottom: this.bottomOffset + 2,
      width: "60%",
      height: 8,
      hidden: true,
      border: { type: "line" },
      style: {
        bg: c.bgPrimary,
        fg: c.textPrimary,
        border: { fg: c.accent || c.cyan },
      },
    });

    const content = this.getTooltipContent(section);
    this.tooltip.setContent(content);
    this.tooltip.show();
    this.tooltip.setFront();
    this.parent.render();
  }

  private hideTooltip() {
    if (this.tooltip) {
      this.tooltip.hide();
      this.parent.render();
    }
  }

  private getTooltipContent(section: string): string {
    const c = themeEngine.getBlessedColors();

    switch (section) {
      case "working":
        const workStarted = (globalThis as { workStartedAt?: number }).workStartedAt || 0;
        const elapsed = workStarted ? Math.floor((Date.now() - workStarted) / 1000) : 0;
        return `{${c.cyan}-fg}{bold}Processing Status{/}\n` +
               `{${c.textSecondary}-fg}Time elapsed: ${elapsed}s{/}\n` +
               `{${c.textTertiary}-fg}Press Ctrl+C to cancel{/}`;

      case "agent":
        const agent = state.get("currentAgent") || "gsd";
        return `{${c.cyan}-fg}{bold}Current Agent{/}\n` +
               `{${c.textPrimary}-fg}${agent}{/}\n\n` +
               `{${c.textTertiary}-fg}Click to switch agent{/}\n` +
               `{${c.textTertiary}-fg}Or use: /agent{/}`;

      case "msgs":
        const cm = (globalThis as { getContextManager?: () => any }).getContextManager?.();
        const msgCount = cm?.getMessageCount?.() || 0;
        const msgsByRole = cm?.getMessages?.()?.reduce((acc: any, m: any) => {
          acc[m.role] = (acc[m.role] || 0) + 1;
          return acc;
        }, {}) || {};
        return `{${c.cyan}-fg}{bold}Message Count{/}\n` +
               `{${c.textPrimary}-fg}Total: ${msgCount}{/}\n\n` +
               Object.entries(msgsByRole)
                 .map(([role, count]: [string, any]) =>
                   `{${c.textSecondary}-fg}${role}: ${count}{/}`)
                 .join("\n");

      case "cost":
        const cost = (globalThis as { cost?: { estimatedCostUSD: number } }).cost?.estimatedCostUSD || 0;
        const tokens = (globalThis as { cost?: { totalTokens: number } }).cost?.totalTokens || 0;
        return `{${c.cyan}-fg}{bold}Session Cost{/}\n` +
               `{${c.textPrimary}-fg}Estimated: $${cost.toFixed(4)}{/}\n` +
               `{${c.textSecondary}-fg}Tokens: ${tokens.toLocaleString()}{/}\n\n` +
               `{${c.textTertiary}-fg}Click for detailed breakdown{/}`;

      case "tabs":
        const tabs = sessionManager.getSessionCount();
        return `{${c.cyan}-fg}{bold}Open Tabs{/}\n` +
               `{${c.textPrimary}-fg}${tabs} session${tabs === 1 ? "" : "s"}{/}\n\n` +
               `{${c.textTertiary}-fg}Ctrl+Tab to switch{/}`;

      case "scroll":
        return `{${c.cyan}-fg}{bold}Scroll Position{/}\n` +
               `{${c.textTertiary}-fg}↓ = Live output below{/}\n\n` +
               `{${c.textTertiary}-fg}Home/End to jump{/}`;

      default:
        return "";
    }
  }

  render(stats: StatusStats) {
    const c = themeEngine.getBlessedColors();

    const stateSeg = stats.working
      ? `{${c.amber}-fg}●{/} {${c.amber}-fg}working{/}`
      : `{${c.lime}-fg}●{/}`;
    const agentSeg = `{${c.textSecondary}-fg}${stats.agent}{/}`;
    const msgsSeg = `{${c.textPrimary}-fg}${stats.msgs}{/}`;
    const costSeg = `{${c.textSecondary}-fg}${stats.cost}{/}`;
    const tabsSeg = stats.tabs > 1 ? `{${c.cyan}-fg}${stats.tabs}t{/}` : "";
    const scrollSeg = !stats.scroll ? "" : `{${c.grey}-fg}↓{/}`;

    const sep = ` {${c.border}-fg}|{/} `;
    const segs = [stateSeg, agentSeg, msgsSeg, stats.compression, costSeg, tabsSeg, scrollSeg].filter(Boolean);

    this.status.setContent(" " + segs.join(sep) + " ");
    this.parent.render();
  }

  hide() {
    this.status.hide();
    this.hideTooltip();
  }
}