import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";
import { state } from "../core/state.js";
import { skillRegistry } from "../skills/registry.js";
import { commandRegistry } from "../commands/registry.js";
import { sessionManager } from "../core/session-manager.js";

export function createStatusBar(screen: blessed.Widgets.Screen): blessed.Widgets.BoxElement {
  const c = themeEngine.getBlessedColors();

  const statusBar = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: "100%",
    height: 1,
    style: {
      bg: c.bgTertiary,
      fg: c.textSecondary,
    },
    tags: true,
  });

  function updateStatus(): void {
    const agent = state.get("currentAgent");
    const model = state.get("currentModel");
    const processing = state.get("isProcessing");
    const theme = themeEngine.getTheme();
    const skills = skillRegistry.getNames().length;
    const commands = commandRegistry.getNames().length;
    const compressionStats = state.get("compressionStats");
    const sessionTitle = state.get("sessionTitle");

    const statusIcon = processing
      ? `{${c.amber}-fg}◉ WORKING{/}`
      : `{${c.lime}-fg}◉ ONLINE{/}`;

    const compression = compressionStats.savingsPercent > 0
      ? ` {${c.border}-fg}│{/} {${c.lime}-fg}${compressionStats.savingsPercent}% compressed{/}`
      : "";

    const tabs = sessionManager.getSessionCount();

    statusBar.setContent(
      ` {${c.cyan}-fg}◈{/} {bold}SENTINEL{/} ` +
      `{${c.border}-fg}│{/} ` +
      `${statusIcon} ` +
      `{${c.border}-fg}│{/} ` +
      `{${c.textTertiary}-fg}Agent:{/} {${c.accent}-fg}${agent}{/${c.accent}-fg}} ` +
      `{${c.border}-fg}│{/} ` +
      `{${c.textTertiary}-fg}Model:{/} ${model.split("/").pop()} ` +
      `{${c.border}-fg}│{/} ` +
      `{${c.textTertiary}-fg}Theme:{/} ${theme.display} ` +
      `{${c.border}-fg}│{/} ` +
      `{${c.textTertiary}-fg}${tabs} tabs{/}` +
      compression +
      ` {${c.border}-fg}│{/} ` +
      `{${c.textTertiary}-fg}${skills}◈ ${commands}⚡{/}`
    );
    screen.render();
  }

  state.subscribe("currentAgent", updateStatus);
  state.subscribe("currentModel", updateStatus);
  state.subscribe("currentTheme", updateStatus);
  state.subscribe("isProcessing", updateStatus);
  state.subscribe("compressionStats", updateStatus);
  state.subscribe("sessionTitle", updateStatus);

  updateStatus();

  return statusBar;
}
