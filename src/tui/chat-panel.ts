import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";
import { state } from "../core/state.js";
import { events } from "../core/events.js";
import { agentRegistry } from "../agents/registry.js";
import { skillRegistry } from "../skills/registry.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger({ prefix: "chat-panel" });

function buildAsciiHeader(): string {
  const c = themeEngine.getBlessedColors();
  return [
    `{${c.cyan}-fg}  ╔═══════════════════════════════════════════════════════════════════╗{/}`,
    `{${c.cyan}-fg}  ║{/} {${c.accent}-fg} ███████╗███████╗███╗   ██╗████████╗███████╗██████╗     ███╗   ███╗{/} {${c.cyan}-fg}║{/}`,
    `{${c.cyan}-fg}  ║{/} {${c.accent}-fg} ██╔════╝██╔════╝████╗  ██║╚══██╔══╝██╔════╝██╔══██╗    ████╗ ████║{/} {${c.cyan}-fg}║{/}`,
    `{${c.cyan}-fg}  ║{/} {${c.accent}-fg} ███████╗█████╗  ██╔██╗ ██║   ██║   █████╗  ██████╔╝    ██╔████╔██║{/} {${c.cyan}-fg}║{/}`,
    `{${c.cyan}-fg}  ║{/} {${c.accent}-fg} ╚════██║██╔══╝  ██║╚██╗██║   ██║   ██╔══╝  ██╔══██╗    ██║╚██╔╝██║{/} {${c.cyan}-fg}║{/}`,
    `{${c.cyan}-fg}  ║{/} {${c.accent}-fg} ███████║███████╗██║ ╚████║   ██║   ███████╗██║  ██║    ██║ ╚═╝ ██║{/} {${c.cyan}-fg}║{/}`,
    `{${c.cyan}-fg}  ║{/} {${c.accent}-fg} ╚══════╝╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝╚═╝  ╚═╝    ╚═╝     ╚═╝{/} {${c.cyan}-fg}║{/}`,
    `{${c.cyan}-fg}  ╠═══════════════════════════════════════════════════════════════════╣{/}`,
    `{${c.cyan}-fg}  ║{/} {${c.textTertiary}-fg} AI-Powered Development CLI          v0.1.0  TRON x GOTHAM{/} {${c.cyan}-fg}║{/}`,
    `{${c.cyan}-fg}  ╚═══════════════════════════════════════════════════════════════════╝{/}`,
  ].join("\n");
}

export interface ChatPanelElements {
  chatBox: blessed.Widgets.BoxElement;
  inputHandler: (msg: string) => void;
  appendMessage: (role: string, content: string) => void;
  focus: () => void;
}

export function createChatPanel(
  screen: blessed.Widgets.Screen,
  onMessage: (msg: string) => void
): ChatPanelElements {
  const c = themeEngine.getBlessedColors();

  const headerBox = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: 11,
    style: { bg: c.bgPrimary },
    tags: true,
    content: buildAsciiHeader(),
  });

  const navBar = blessed.box({
    parent: screen,
    top: 11,
    left: 0,
    width: "100%",
    height: 1,
    style: { bg: c.bgTertiary, fg: c.textTertiary },
    tags: true,
    content: buildNavContent(),
  });

  const chatBox = blessed.box({
    parent: screen,
    top: 12,
    left: 0,
    width: "100%",
    bottom: 3,
    scrollable: true,
    alwaysScroll: true,
    mouse: true,
    keys: false,
    vi: false,
    scrollbar: {
      ch: "░",
      track: { bg: c.bgSecondary },
      style: { fg: c.cyan, inverse: false },
    },
    style: {
      bg: c.bgPrimary,
      fg: c.textPrimary,
    },
    tags: true,
    content: buildWelcomeContent(),
  });

  const separatorBar = blessed.box({
    parent: screen,
    bottom: 2,
    left: 0,
    width: "100%",
    height: 1,
    style: { bg: c.bgPrimary, fg: c.border },
    tags: true,
    content: `{${c.cyan}-fg}╔══════════════════════════════════════════════════════════════════════════════╗{/}`,
  });

  const inputLine = blessed.box({
    parent: screen,
    bottom: 1,
    left: 0,
    width: "100%",
    height: 1,
    style: { bg: c.bgSecondary, fg: c.textPrimary },
    tags: true,
    content: `{${c.cyan}-fg}❯{/} `,
  });

  const statusBarBg = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: "100%",
    height: 1,
    style: { bg: c.bgTertiary, fg: c.textSecondary },
    tags: true,
  });

  function updateStatusBar(): void {
    const agent = state.get("currentAgent");
    const model = state.get("currentModel");
    const processing = state.get("isProcessing");
    const theme = themeEngine.getTheme();
    const statusIcon = processing
      ? `{${c.amber}-fg}◉ WORKING{/}`
      : `{${c.lime}-fg}◉ ONLINE{/}`;
    statusBarBg.setContent(
      ` {${c.cyan}-fg}◈{/} {bold}SENTINEL{/} ` +
      `{${c.border}-fg}│{/} ${statusIcon} {${c.border}-fg}│{/} ` +
      `{${c.textTertiary}-fg}Agent:{/} {${c.accent}-fg}${agent}{/${c.accent}-fg}} {${c.border}-fg}│{/} ` +
      `{${c.textTertiary}-fg}Model:{/} ${model.split("/").pop()} {${c.border}-fg}│{/} ` +
      `{${c.textTertiary}-fg}${theme.display}{/}`
    );
    screen.render();
  }

  state.subscribe("currentAgent", updateStatusBar);
  state.subscribe("currentModel", updateStatusBar);
  state.subscribe("isProcessing", updateStatusBar);
  updateStatusBar();

  let currentInput = "";

  function renderInput(): void {
    inputLine.setContent(`{${c.cyan}-fg}❯{/} ${currentInput}`);
    screen.render();
  }

  screen.program.on("keypress", (ch: string, key: { name: string; full: string; ctrl: boolean; meta: boolean; shift: boolean; sequence: string }) => {
    if (key.ctrl || key.meta) return;
    if (key.name === "return" || key.name === "enter") {
      if (currentInput.trim()) {
        const msg = currentInput.trim();
        currentInput = "";
        renderInput();
        appendMessage("user", msg);
        onMessage(msg);
      }
      return;
    }
    if (key.name === "backspace") {
      currentInput = currentInput.slice(0, -1);
      renderInput();
      return;
    }
    if (key.name === "escape") {
      currentInput = "";
      renderInput();
      return;
    }
    if (ch && ch.length === 1 && ch.charCodeAt(0) >= 32) {
      currentInput += ch;
      renderInput();
    }
  });

  function buildNavContent(): string {
    const activePanel = state.get("activePanel");
    const panels = [
      { key: "1", label: "CHAT", active: activePanel === "chat" },
      { key: "2", label: "FILES", active: activePanel === "files" },
      { key: "3", label: "AGENTS", active: activePanel === "agents" },
    ];
    return (
      "  " +
      panels
        .map((p) => {
          const color = p.active ? c.accent : c.textTertiary;
          const marker = p.active ? `{${c.cyan}-fg}◈{/}` : "◇";
          return `${marker} {${color}-fg}[${p.key}] ${p.label}{/${color}-fg}`;
        })
        .join(` {${c.border}-fg}│{/} `) +
      `{right} {${c.textTertiary}-fg}Ctrl+P palette{/} {${c.border}-fg}·{/} {${c.textTertiary}-fg}Ctrl+T theme{/} {${c.border}-fg}·{/} {${c.textTertiary}-fg}Ctrl+Q quit{/}{/}{right}`
    );
  }

  function buildWelcomeContent(): string {
    return [
      "",
      `  {${c.textTertiary}-fg}── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──{/}`,
      "",
      `  {${c.textSecondary}-fg}Welcome to the grid, operator.{/}`,
      "",
      `  {${c.textTertiary}-fg}The city sleeps. The code doesn't. Type a message below{/}`,
      `  {${c.textTertiary}-fg}or use {bold}/commands{/} to get started. The night is young.{/}`,
      "",
      `  {${c.textTertiary}-fg}── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──{/}`,
      "",
    ].join("\n");
  }

  function appendMessage(role: string, content: string): void {
    const c = themeEngine.getBlessedColors();
    const timestamp = new Date().toLocaleTimeString();

    let color: string;
    let icon: string;
    let roleLabel: string;

    switch (role) {
      case "user":
        icon = "▶";
        color = c.cyan;
        roleLabel = "YOU";
        break;
      case "assistant":
        icon = "◈";
        color = c.lime;
        roleLabel = "SENTINEL";
        break;
      case "system":
        icon = "⚡";
        color = c.amber;
        roleLabel = "SYSTEM";
        break;
      case "error":
        icon = "✖";
        color = c.error;
        roleLabel = "ERROR";
        break;
      default:
        icon = "●";
        color = c.textSecondary;
        roleLabel = role.toUpperCase();
    }

    const divider = `{${c.border}-fg}  ──────────────────────────────────────────────────────────────────{/}`;
    const lines = content.split("\n");
    const indentedContent = lines.map((l: string) => `  ${l}`).join("\n");

    const message = [
      "",
      divider,
      `  {${color}-fg}{bold}${icon} [${roleLabel}]{/bold}{/${color}-fg} {${c.textTertiary}-fg}${timestamp}{/${c.textTertiary}-fg}`,
      "",
      indentedContent,
      "",
    ].join("\n");

    chatBox.insertBottom(message);
    chatBox.setScrollPerc(100);
    screen.render();
  }

  function appendStreaming(content: string): void {
    chatBox.insertBottom(content);
    chatBox.setScrollPerc(100);
    screen.render();
  }

  state.subscribe("activePanel", () => {
    navBar.setContent(buildNavContent());
    screen.render();
  });

  return {
    chatBox,
    inputHandler: onMessage,
    appendMessage,
    focus: () => { screen.render(); },
  };
}
