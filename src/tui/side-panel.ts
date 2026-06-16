/**
 * Split View / Side Panel for file preview, MCP tools, session tree
 */

import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";

export type SidePanelTab = "files" | "mcp" | "sessions" | "preview";

export class SidePanel {
  private panel?: blessed.Widgets.BoxElement;
  private tabBar?: blessed.Widgets.BoxElement;
  private content?: blessed.Widgets.BoxElement;
  private currentTab: SidePanelTab = "files";

  constructor(private parent: blessed.Widgets.Screen, private widthPercent = 25) {}

  toggle() {
    if (this.panel && this.panel.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  show() {
    this.createUI();
    this.panel!.show();
    this.renderTab();
    this.parent.render();
  }

  hide() {
    if (this.panel) {
      this.panel.hide();
      this.parent.render();
    }
  }

  private createUI() {
    if (this.panel) return;

    const c = themeEngine.getBlessedColors();

    this.panel = blessed.box({
      parent: this.parent,
      right: 0,
      top: 0,
      width: `${this.widthPercent}%`,
      bottom: 1,
      hidden: true,
      border: { type: "line" },
      style: {
        bg: c.bgPrimary,
        fg: c.textPrimary,
        border: { fg: c.border },
      },
    });

    // Tab bar
    this.tabBar = blessed.box({
      parent: this.panel,
      top: 0,
      left: 0,
      width: "100%",
      height: 1,
      content: "",
      tags: true,
      style: { bg: c.bgSecondary },
    });

    // Content area
    this.content = blessed.box({
      parent: this.panel,
      top: 2,
      left: 0,
      width: "100%",
      height: "100%-3",
      scrollable: true,
      alwaysScroll: true,
      mouse: true,
      scrollbar: {
        ch: " ",
        style: { bg: c.border },
      },
      style: {
        bg: c.bgPrimary,
        fg: c.textPrimary,
      },
    });

    // Close button
    const close = blessed.text({
      parent: this.panel,
      bottom: 0,
      left: 0,
      width: "100%",
      height: 1,
      content: `{${c.textTertiary}-fg}Press Ctrl+P to close{/}`,
      tags: true,
      style: { bg: c.bgSecondary },
    });

    // Tab clicking
    this.tabBar.on("click", (data) => {
      const clickedTab = this.getTabAtPosition(data.x);
      if (clickedTab) {
        this.switchTab(clickedTab);
      }
    });

    this.panel.key(["1"], () => this.switchTab("files"));
    this.panel.key(["2"], () => this.switchTab("mcp"));
    this.panel.key(["3"], () => this.switchTab("sessions"));
    this.panel.key(["4"], () => this.switchTab("preview"));
    this.panel.key(["escape"], () => this.hide());
  }

  private getTabAtPosition(x: number): SidePanelTab | null {
    const tabs: SidePanelTab[] = ["files", "mcp", "sessions", "preview"];
    const tabWidth = Math.floor((this.panel!.width as number) / 4);
    const idx = Math.floor(x / tabWidth);
    return tabs[idx] || null;
  }

  private switchTab(tab: SidePanelTab) {
    this.currentTab = tab;
    this.renderTab();
    this.parent.render();
  }

  private renderTab() {
    const c = themeEngine.getBlessedColors();

    // Render tab bar
    const tabs: { id: SidePanelTab; label: string; icon: string }[] = [
      { id: "files", label: "Files", icon: "📁" },
      { id: "mcp", label: "MCP", icon: "🔧" },
      { id: "sessions", label: "Sessions", icon: "💬" },
      { id: "preview", label: "Preview", icon: "👁️" },
    ];

    const tabBarContent = tabs
      .map((tab) => {
        const isActive = tab.id === this.currentTab;
        const color = isActive ? c.accent || c.cyan : c.textSecondary;
        const bracket = isActive ? "[" : " ";
        return `{${color}-fg}${bracket}${tab.icon} ${tab.label}${isActive ? "]" : " "}{/}`;
      })
      .join(" ");

    this.tabBar!.setContent(tabBarContent);

    // Render content
    this.renderContent();
  }

  private renderContent() {
    const c = themeEngine.getBlessedColors();

    switch (this.currentTab) {
      case "files":
        this.renderFiles();
        break;
      case "mcp":
        this.renderMCP();
        break;
      case "sessions":
        this.renderSessions();
        break;
      case "preview":
        this.renderPreview();
        break;
    }
  }

  private renderFiles() {
    const files = (globalThis as { repoFiles?: string[] }).repoFiles || [];
    let content = `{${c.cyan}-fg}{bold}Files{/}\n`;
    content += `{${c.border}-fg}${"─".repeat(40)}{/}\n\n`;

    for (const file of files.slice(0, 50)) {
      const icon = file.endsWith(".ts") || file.endsWith(".js") ? "📜" :
                   file.endsWith(".json") ? "📋" :
                   file.endsWith(".md") ? "📝" : "📄";
      content += `{${c.textSecondary}-fg}${icon} {/}{${c.textPrimary}-fg}${file}{/}\n`;
    }

    if (files.length > 50) {
      content += `\n{${c.textTertiary}-fg}... and ${files.length - 50} more{/}`;
    }

    this.content!.setContent(content);
  }

  private renderMCP() {
    const tools = (globalThis as { mcpTools?: string[] }).mcpTools || [];
    let content = `{${c.cyan}-fg}{bold}MCP Tools{/}\n`;
    content += `{${c.border}-fg}${"─".repeat(40)}{/}\n\n`;

    if (tools.length === 0) {
      content += `{${c.textTertiary}-fg}No MCP tools connected.{/}\n\n`;
      content += `{${c.textSecondary}-fg}Configure MCP in sentinel.json{/}`;
    } else {
      for (const tool of tools) {
        content += `{${c.textPrimary}-fg}• ${tool}{/}\n`;
      }
    }

    this.content!.setContent(content);
  }

  private renderSessions() {
    const sessions = (globalThis as { sessions?: any[] }).sessions || [];
    let content = `{${c.cyan}-fg}{bold}Sessions{/}\n`;
    content += `{${c.border}-fg}${"─".repeat(40)}{/}\n\n`;

    for (const session of sessions) {
      const active = session.active ? "● " : "  ";
      content += `{${c.lime}-fg}${active}{/}{${c.textPrimary}-fg}${session.projectName || "Untitled"}{/}\n`;
    }

    this.content!.setContent(content);
  }

  private renderPreview() {
    const preview = (globalThis as { filePreview?: string }).filePreview || "No file selected";
    this.content!.setContent(`{${c.cyan}-fg}{bold}Preview{/}\n\n${preview}`);
  }

  updatePreview(content: string) {
    (globalThis as { filePreview?: string }).filePreview = content;
    if (this.currentTab === "preview") {
      this.renderContent();
    }
  }

  setFiles(files: string[]) {
    (globalThis as { repoFiles?: string[] }).repoFiles = files;
    if (this.currentTab === "files") {
      this.renderContent();
    }
  }

  setMCPTools(tools: string[]) {
    (globalThis as { mcpTools?: string[] }).mcpTools = tools;
    if (this.currentTab === "mcp") {
      this.renderContent();
    }
  }
}