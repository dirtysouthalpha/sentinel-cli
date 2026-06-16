/**
 * Progress indicators with bars and time estimates
 */

import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";

export interface ProgressStep {
  name: string;
  status: "pending" | "running" | "done" | "error";
  startTime?: number;
  endTime?: number;
  error?: string;
}

export interface ProgressIndicator {
  total: number;
  current: number;
  steps: ProgressStep[];
  estimatedTimeRemaining?: number;
}

export class ProgressManager {
  private overlay?: blessed.Widgets.BoxElement;
  private progressBar?: blessed.Widgets.BoxElement;
  private stepsList?: blessed.Widgets.ListElement;
  private indicator: ProgressIndicator | null = null;
  private updateInterval?: ReturnType<typeof setInterval>;

  constructor(private parent: blessed.Widgets.Screen) {}

  showProgress(indicator: ProgressIndicator) {
    this.indicator = indicator;
    this.createUI();
    this.update();
    this.overlay!.show();
    this.overlay!.setFront();
    this.startUpdateLoop();
    this.parent.render();
  }

  updateProgress(update: Partial<ProgressIndicator>) {
    if (!this.indicator) return;
    this.indicator = { ...this.indicator, ...update };
    this.update();
    this.parent.render();
  }

  hideProgress() {
    this.stopUpdateLoop();
    if (this.overlay) {
      this.overlay.hide();
      this.parent.render();
    }
  }

  private createUI() {
    if (this.overlay) return;

    const c = themeEngine.getBlessedColors();

    this.overlay = blessed.box({
      parent: this.parent,
      left: "center",
      top: "10%",
      width: "60%",
      height: "40%",
      hidden: true,
      border: { type: "line" },
      style: {
        bg: c.bgPrimary,
        fg: c.textPrimary,
        border: { fg: c.accent || c.cyan },
      },
    });

    const title = blessed.text({
      parent: this.overlay,
      top: 0,
      left: 1,
      width: "100%-2",
      height: 1,
      content: `{${c.cyan}-fg}{bold}Progress{/}`,
      tags: true,
    });

    // Progress bar
    this.progressBar = blessed.box({
      parent: this.overlay,
      top: 2,
      left: 1,
      width: "100%-2",
      height: 1,
      content: "",
      tags: true,
      style: { bg: c.bgSecondary },
    });

    // Steps list
    this.stepsList = blessed.list({
      parent: this.overlay,
      top: 4,
      left: 1,
      width: "100%-2",
      height: "100%-6",
      keys: true,
      mouse: true,
      scrollable: true,
      style: {
        fg: c.textPrimary,
        bg: c.bgPrimary,
        selected: {
          fg: c.textPrimary,
          bg: c.bgSecondary,
        },
      },
    });

    this.overlay.key(["escape", "C-c"], () => {
      this.parent.emit("progress-cancel");
      this.hideProgress();
    });
  }

  private update() {
    if (!this.indicator || !this.progressBar || !this.stepsList) return;

    const c = themeEngine.getBlessedColors();

    // Update progress bar
    const percentage = this.indicator.total > 0 ? Math.round((this.indicator.current / this.indicator.total) * 100) : 0;
    const barWidth = Math.floor((this.overlay!.width as number - 4) * (percentage / 100));
    const filledBar = "█".repeat(barWidth);
    const emptyBar = "░".repeat((this.overlay!.width as number - 4) - barWidth);

    const timeInfo = this.indicator.estimatedTimeRemaining ?
      `{${c.textTertiary}-fg}· ~${this.formatTime(this.indicator.estimatedTimeRemaining)} remaining{/}` : "";

    this.progressBar.setContent(
      `{${c.lime}-bg}${filledBar}{/}{${c.bgSecondary}-bg}${emptyBar}{/} ` +
      `{${c.textPrimary}-fg}${percentage}%{/} ${timeInfo}`
    );

    // Update steps list
    const stepItems = this.indicator.steps.map((step) => {
      const icon = step.status === "running" ? "▶" :
                   step.status === "done" ? "✓" :
                   step.status === "error" ? "✗" : "○";
      const color = step.status === "running" ? c.amber :
                    step.status === "done" ? c.lime :
                    step.status === "error" ? c.error : c.textTertiary;

      let item = `{${color}-fg}${icon}{/} {${c.textPrimary}-fg}${step.name}{/}`;

      if (step.status === "running") {
        const elapsed = step.startTime ? Date.now() - step.startTime : 0;
        item += ` {${c.textTertiary}-fg}(${this.formatTime(elapsed)}){/}`;
      } else if (step.status === "error" && step.error) {
        item += ` {${c.error}-fg}${step.error}{/}`;
      }

      return item;
    });

    this.stepsList.setItems(stepItems);
  }

  private startUpdateLoop() {
    this.stopUpdateLoop();
    this.updateInterval = setInterval(() => {
      this.update();
      this.parent.render();
    }, 1000);
  }

  private stopUpdateLoop() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = undefined;
    }
  }

  private formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  calculateEstimatedTime(): number | undefined {
    if (!this.indicator || this.indicator.current === 0) return undefined;

    const completedSteps = this.indicator.steps.filter(s => s.endTime && s.startTime);
    if (completedSteps.length === 0) return undefined;

    const totalTime = completedSteps.reduce((sum, s) => sum + (s.endTime! - s.startTime!), 0);
    const avgTimePerStep = totalTime / completedSteps.length;
    const remainingSteps = this.indicator.steps.filter(s => s.status === "pending").length;

    return avgTimePerStep * remainingSteps;
  }
}