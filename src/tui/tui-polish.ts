/**
 * Visual polish and decorations for the TUI
 */

import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";

export class TUIPolish {
  private decorations: blessed.Widgets.Node[] = [];

  constructor(private parent: blessed.Widgets.Screen) {}

  /**
   * Add decorative corners to the screen
   */
  addDecorativeCorners() {
    const c = themeEngine.getBlessedColors();

    const corners = [
      { left: 0, top: 0, char: "┌" },
      { right: 0, top: 0, char: "┐" },
      { left: 0, bottom: 0, char: "└" },
      { right: 0, bottom: 0, char: "┘" },
    ];

    corners.forEach(pos => {
      const corner = blessed.text({
        parent: this.parent,
        ...pos,
        content: `{${c.border}-fg}${pos.char}{/}`,
        tags: true,
        style: { bg: c.bgPrimary },
      });
      this.decorations.push(corner);
    });

    this.parent.render();
  }

  /**
   * Add animated scanline effect (retro CRT style)
   */
  addScanlines() {
    const c = themeEngine.getBlessedColors();

    const scanline = blessed.box({
      parent: this.parent,
      left: 0,
      top: 0,
      width: "100%",
      height: 2,
      style: {
        bg: c.bgPrimary,
        fg: c.bgPrimary,
      },
    });

    let scanY = 0;
    const scanHeight = this.parent.height as number;

    setInterval(() => {
      scanline.top = scanY;
      scanline.style!.bg = "rgba(0,0,0,0.05)";
      scanY = (scanY + 1) % scanHeight;
      this.parent.render();
    }, 50);

    this.decorations.push(scanline);
  }

  /**
   * Add animated glow effect to borders
   */
  addGlowEffect(target: blessed.Widgets.BoxElement) {
    const c = themeEngine.getBlessedColors();
    const colors = [c.accent, c.lime, c.cyan, c.magenta];
    let colorIndex = 0;

    setInterval(() => {
      if (!target.visible) return;

      const color = colors[colorIndex % colors.length];
      target.style!.border = { fg: color as string };
      colorIndex++;
      this.parent.render();
    }, 2000);
  }

  /**
   * Add decorative status dots
   */
  addStatusDots() {
    const c = themeEngine.getBlessedColors();

    const dots = blessed.box({
      parent: this.parent,
      right: 2,
      top: 0,
      width: 5,
      height: 1,
      content: "",
      tags: true,
    });

    const updateDots = () => {
      const states = [
        { color: c.lime, active: true },   // AI ready
        { color: c.cyan, active: true },   // Connected
        { color: c.amber, active: Math.random() > 0.5 }, // Background task
        { color: c.magenta, active: Math.random() > 0.7 }, // MCP
        { color: c.error, active: false },  // Error
      ];

      const content = states
        .map(s => s.active ? `{${s.color}-fg}●{/}` : `{${c.textTertiary}-fg}○{/}`)
        .join(" ");

      dots.setContent(content);
      this.parent.render();
    };

    updateDots();
    setInterval(updateDots, 3000);

    this.decorations.push(dots);
  }

  /**
   * Add animated title bar with scrolling text
   */
  addAnimatedTitle(text: string) {
    const c = themeEngine.getBlessedColors();

    const titleBar = blessed.box({
      parent: this.parent,
      left: 0,
      top: 0,
      width: "100%",
      height: 1,
      tags: true,
      style: { bg: c.bgSecondary },
    });

    let scrollPos = 0;
    const paddedText = `  ${text}  `.repeat(4);

    setInterval(() => {
      const visible = paddedText.slice(scrollPos, scrollPos + (this.parent.width as number));
      titleBar.setContent(`{${c.textSecondary}-fg}${visible}{/}`);
      scrollPos = (scrollPos + 1) % paddedText.length;
      this.parent.render();
    }, 100);

    this.decorations.push(titleBar);
  }

  /**
   * Add particle effects in the background
   */
  addParticles(count = 10) {
    const c = themeEngine.getBlessedColors();

    for (let i = 0; i < count; i++) {
      const particle = blessed.text({
        parent: this.parent,
        left: Math.random() * (this.parent.width as number),
        top: Math.random() * (this.parent.height as number),
        content: ".",
        style: { fg: c.textTertiary },
      });

      const animate = () => {
        let x = particle.left as number;
        let y = particle.top as number;
        let opacity = 1;

        const interval = setInterval(() => {
          opacity -= 0.01;
          if (opacity <= 0) {
            opacity = 1;
            x = Math.random() * (this.parent.width as number);
            y = Math.random() * (this.parent.height as number);
          }

          particle.left = x;
          particle.top = y;
          this.parent.render();
        }, 50);

        this.decorations.push(particle as any);
      };

      animate();
    }
  }

  /**
   * Add gradient border effect
   */
  addGradientBorder(target: blessed.Widgets.BoxElement) {
    const c = themeEngine.getBlessedColors();

    // Create gradient segments
    const segments = 8;
    const gradientColors = [
      c.lime, c.cyan, c.accent, c.magenta, c.amber, c.error,
    ];

    for (let i = 0; i < segments; i++) {
      const segment = blessed.box({
        parent: target,
        left: Math.floor((target.width as number) * (i / segments)),
        top: 0,
        width: Math.ceil((target.width as number) / segments),
        height: 1,
        style: {
          bg: gradientColors[i % gradientColors.length] as string,
        },
      });

      this.decorations.push(segment);
    }

    // Animate
    let offset = 0;
    setInterval(() => {
      offset = (offset + 1) % segments;
      this.decorations.forEach((dec: any, i) => {
        if (dec.style?.bg) {
          const colorIndex = (i + offset) % gradientColors.length;
          dec.style.bg = gradientColors[colorIndex];
        }
      });
      this.parent.render();
    }, 500);
  }

  /**
   * Add keyboard shortcut hint bar
   */
  addShortcutBar() {
    const c = themeEngine.getBlessedColors();

    const shortcuts = [
      { key: "Ctrl+T", desc: "Actions" },
      { key: "Ctrl+G", desc: "Search" },
      { key: "F1", desc: "Help" },
      { key: "Ctrl+Q", desc: "Quit" },
    ];

    const bar = blessed.box({
      parent: this.parent,
      left: 0,
      bottom: 1,
      width: "100%",
      height: 1,
      content: "",
      tags: true,
      style: { bg: c.bgSecondary },
    });

    const content = shortcuts
      .map(s => `{${c.textTertiary}-fg}[{${c.accent}-fg}${s.key}{/}] {${c.textSecondary}-fg}${s.desc}{/}`)
      .join("  ");

    bar.setContent("  " + content);
    this.decorations.push(bar);
  }

  /**
   * Add timestamp indicator
   */
  addTimestamp() {
    const c = themeEngine.getBlessedColors();

    const timestamp = blessed.text({
      parent: this.parent,
      left: 2,
      bottom: 2,
      content: "",
      tags: true,
    });

    const update = () => {
      const now = new Date();
      timestamp.setContent(`{${c.textTertiary}-fg}${now.toLocaleTimeString()}{/}`);
      this.parent.render();
    };

    update();
    setInterval(update, 1000);

    this.decorations.push(timestamp);
  }

  /**
   * Add animated connection status
   */
  addConnectionStatus() {
    const c = themeEngine.getBlessedColors();

    const status = blessed.text({
      parent: this.parent,
      right: 2,
      top: 1,
      content: "",
      tags: true,
    });

    const icons = ["⚡", "🔗", "📡", "🌐"];
    let iconIndex = 0;

    const update = () => {
      const icon = icons[iconIndex % icons.length];
      status.setContent(`{${c.lime}-fg}${icon} Connected{/}`);
      iconIndex++;
      this.parent.render();
    };

    update();
    setInterval(update, 5000);

    this.decorations.push(status);
  }

  /**
   * Add animated cursor blink effect
   */
  addCursorBlink() {
    const c = themeEngine.getBlessedColors();

    const cursor = blessed.text({
      parent: this.parent,
      content: "█",
      tags: true,
    });

    let visible = true;

    setInterval(() => {
      visible = !visible;
      cursor.setContent(visible ? `{${c.accent}-fg}█{/}` : " ");
      this.parent.render();
    }, 500);

    this.decorations.push(cursor);
  }

  /**
   * Clean up all decorations
   */
  destroy() {
    this.decorations.forEach(dec => {
      try {
        (dec as any).destroy?.();
      } catch {
        // Ignore
      }
    });
    this.decorations = [];
  }
}

/**
 * Welcome message with ASCII art banner
 */
export function renderWelcomeBanner(): string {
  const c = themeEngine.getBlessedColors();

  return `
{${c.cyan}-bg}{${c.bgPrimary}-fg}╔═══════════════════════════════════════════════════════════════╗{/}
{${c.cyan}-bg}{${c.bgPrimary}-fg}║{/} {${c.lime}-fg}{bold}Welcome to Sentinel CLI{/}{${c.cyan}-bg}{${c.bgPrimary}-fg}                                   ║{/}
{${c.cyan}-bg}{${c.bgPrimary}-fg}║{/} {${c.textSecondary}-fg}Your AI-powered coding assistant for terminal{/}{${c.cyan}-bg}{${c.bgPrimary}-fg}          ║{/}
{${c.cyan}-bg}{${c.bgPrimary}-fg}╚═══════════════════════════════════════════════════════════════╝{/}

{${c.textTertiary}-fg}Getting started:{/}
  • Type a message to chat with Sentinel
  • Press {${c.accent}-fg}/{/} for commands or {${c.accent}-fg}Ctrl+T{/} for quick actions
  • Use {${c.accent}-fg}/help{/} to see all available commands

{${c.textTertiary}-fg}Keyboard shortcuts:{/}
  • {${c.accent}-fg}Ctrl+T{/} - Quick actions
  • {${c.accent}-fg}Ctrl+G{/} - Search chat
  • {${c.accent}-fg}Ctrl+O{/} - Multi-line mode
  • {${c.accent}-fg}F1{/} - Show help
  • {${c.accent}-fg}Ctrl+Q{/} - Quit

`;
}