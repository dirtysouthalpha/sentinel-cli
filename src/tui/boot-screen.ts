/**
 * Animated Boot Screen with ASCII art, loading bars, and initialization
 */

import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger({ prefix: "boot" });

export interface BootStep {
  name: string;
  status: "pending" | "running" | "done" | "error";
  icon?: string;
}

export class BootScreen {
  private box?: blessed.Widgets.BoxElement;
  private logo?: blessed.Widgets.TextElement;
  private progressBar?: blessed.Widgets.BoxElement;
  private stepsList?: blessed.Widgets.BoxElement;
  private version?: blessed.Widgets.TextElement;
  private tips?: blessed.Widgets.TextElement;
  private steps: BootStep[] = [];
  private currentStep = 0;
  private progress = 0;
  private active = false;
  private animationFrame?: ReturnType<typeof setInterval>;

  constructor(private parent: blessed.Widgets.Screen) {
    this.steps = [
      { name: "Initializing terminal", status: "pending", icon: "⚡" },
      { name: "Loading configuration", status: "pending", icon: "⚙️" },
      { name: "Connecting to AI provider", status: "pending", icon: "🤖" },
      { name: "Loading session history", status: "pending", icon: "💾" },
      { name: "Initializing MCP servers", status: "pending", icon: "🔧" },
      { name: "Building repository index", status: "pending", icon: "📚" },
      { name: "Starting user interface", status: "pending", icon: "🎨" },
    ];
  }

  async boot(): Promise<void> {
    return new Promise((resolve) => {
      this.createUI();
      this.active = true;

      // Animate through steps
      this.runBootSequence(resolve);
    });
  }

  private createUI() {
    const c = themeEngine.getBlessedColors();

    this.box = blessed.box({
      parent: this.parent,
      left: "center",
      top: "center",
      width: "70%",
      height: "80%",
      border: { type: "double" },
      style: {
        bg: c.bgPrimary,
        fg: c.textPrimary,
        border: { fg: c.accent || c.cyan },
      },
    });

    // ASCII Art Logo
    const logoAscii = this.getAsciiLogo();
    this.logo = blessed.text({
      parent: this.box,
      top: 2,
      left: "center",
      width: "100%",
      height: 8,
      content: this.colorizeLogo(logoAscii),
      tags: true,
      style: {
        bg: c.bgPrimary,
        fg: c.accent || c.cyan,
      },
    });

    // Version info
    const VERSION = "1.1.0";
    this.version = blessed.text({
      parent: this.box,
      top: 11,
      left: "center",
      width: "100%",
      height: 1,
      content: `{${c.textTertiary}-fg}Sentinel CLI v${VERSION} — AI-Powered Coding Assistant{/}`,
      tags: true,
      style: { bg: c.bgPrimary },
    });

    // Progress bar container
    const progressContainer = blessed.box({
      parent: this.box,
      top: 14,
      left: 5,
      width: "100%-10",
      height: 3,
      style: { bg: c.bgSecondary },
    });

    this.progressBar = blessed.box({
      parent: progressContainer,
      left: 0,
      top: 0,
      width: "0%",
      height: "100%",
      content: "",
      tags: true,
      style: {
        bg: c.lime,
        fg: c.bgPrimary,
      },
    });

    // Steps list
    this.stepsList = blessed.box({
      parent: this.box,
      top: 19,
      left: 5,
      width: "100%-10",
      height: 10,
      content: "",
      tags: true,
      style: { bg: c.bgPrimary },
    });

    // Tips
    this.tips = blessed.text({
      parent: this.box,
      bottom: 2,
      left: 5,
      width: "100%-10",
      height: 2,
      content: "",
      tags: true,
      style: {
        bg: c.bgPrimary,
        fg: c.textTertiary,
      },
    });

    this.parent.render();
  }

  private getAsciiLogo(): string {
    return `
    ██╗  ██╗ █████╗  ██████╗██╗  ██╗███████╗██████╗
    ██║  ██║██╔══██╗██╔════╝██║ ██╔╝██╔════╝██╔══██╗
    ███████║███████║██║     █████╔╝ █████╗  ██████╔╝
    ██╔══██║██╔══██║██║     ██╔═██╗ ██╔══╝  ██╔══██╗
    ██║  ██║██║  ██║╚██████╗██║  ██╗███████╗██║  ██║
    ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝
    `;
  }

  private colorizeLogo(ascii: string): string {
    const c = themeEngine.getBlessedColors();
    const lines = ascii.split("\n").filter(line => line.trim());

    return lines.map((line, i) => {
      // Gradient effect
      const gradient = [
        c.lime,
        c.cyan,
        c.magenta,
        c.amber,
        c.accent || c.cyan,
      ];
      const color = gradient[i % gradient.length];
      return `{${color}-bg}{${c.bgPrimary}-fg}${line}{/}`;
    }).join("\n");
  }

  private async runBootSequence(resolve: () => void) {
    const totalSteps = this.steps.length;

    for (let i = 0; i < totalSteps; i++) {
      await this.runStep(i);
    }

    // Final delay before dismiss
    await this.sleep(500);
    this.dismiss();
    resolve();
  }

  private async runStep(stepIndex: number) {
    if (!this.active) return;

    const step = this.steps[stepIndex];
    step.status = "running";
    this.currentStep = stepIndex;
    this.updateUI();

    // Simulate work (in real app, actually do the work)
    await this.sleep(300 + Math.random() * 500);

    step.status = "done";
    this.progress = ((stepIndex + 1) / this.steps.length) * 100;
    this.updateUI();
  }

  private updateUI() {
    const c = themeEngine.getBlessedColors();

    // Update progress bar
    const barWidth = Math.floor((this.box!.width as number - 10) * (this.progress / 100));
    const filled = "█".repeat(barWidth);
    const empty = "░".repeat((this.box!.width as number - 10) - barWidth);

    this.progressBar!.setContent(
      `{${c.bgPrimary}-fg}{${c.lime}-bg}${filled}{/}` +
      `{${c.textPrimary}-fg}${empty}{/}`
    );
    this.progressBar!.width = `${this.progress}%`;

    // Update steps list
    let stepsContent = "";
    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      const icon = step.status === "running" ? "▶" :
                   step.status === "done" ? "✓" :
                   step.status === "error" ? "✗" : "○";

      const color = step.status === "running" ? c.amber :
                    step.status === "done" ? c.lime :
                    step.status === "error" ? c.error : c.textTertiary;

      const isCurrent = i === this.currentStep;
      const prefix = isCurrent ? "{bold}" : "";

      stepsContent += `${prefix}{${color}-fg}${icon}{/} {${c.textPrimary}-fg}${step.name}{/}\n`;
    }

    this.stepsList!.setContent(stepsContent);

    // Update tips
    const tips = [
      "Tip: Press Ctrl+T for quick actions",
      "Tip: Use /commands for powerful features",
      "Tip: Ctrl+O enables multi-line editing",
      "Tip: Press F1 for keyboard shortcuts",
    ];
    this.tips!.setContent(`{${c.textTertiary}-fg}${tips[Math.floor(Math.random() * tips.length)]}{/}`);

    this.parent.render();
  }

  dismiss() {
    this.active = false;
    if (this.box) {
      this.box.hide();
      this.box.destroy();
      this.box = undefined;
    }
    this.parent.render();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Splash screen for quick transitions
 */
export class SplashScreen {
  private overlay?: blessed.Widgets.BoxElement;

  constructor(private parent: blessed.Widgets.Screen) {}

  show(title: string, subtitle?: string, duration = 1000) {
    const c = themeEngine.getBlessedColors();

    this.overlay = blessed.box({
      parent: this.parent,
      left: 0,
      top: 0,
      width: "100%",
      height: "100%",
      style: {
        bg: c.bgPrimary,
        fg: c.textPrimary,
      },
    });

    const titleBox = blessed.text({
      parent: this.overlay,
      top: "center",
      left: "center",
      width: "shrink",
      height: "shrink",
      content: `{${c.accent}-fg}{bold}${title}{/}`,
      tags: true,
      style: {
        bg: c.bgPrimary,
        fg: c.accent,
      },
    });

    if (subtitle) {
      const subtitleBox = blessed.text({
        parent: this.overlay,
        top: "center+2",
        left: "center",
        width: "shrink",
        height: "shrink",
        content: `{${c.textSecondary}-fg}${subtitle}{/}`,
        tags: true,
        style: {
          bg: c.bgPrimary,
          fg: c.textSecondary,
        },
      });
    }

    this.overlay.show();
    this.parent.render();

    setTimeout(() => this.hide(), duration);
  }

  hide() {
    if (this.overlay) {
      this.overlay.destroy();
      this.overlay = undefined;
    }
    this.parent.render();
  }
}