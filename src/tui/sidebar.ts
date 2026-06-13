import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";
import { state } from "../core/state.js";
import { events } from "../core/events.js";
import { agentRegistry } from "../agents/registry.js";
import { skillRegistry } from "../skills/registry.js";

export function createSidebar(screen: blessed.Widgets.Screen): blessed.Widgets.BoxElement {
  const c = themeEngine.getBlessedColors();

  const sidebar = blessed.box({
    parent: screen,
    top: 3,
    right: 0,
    width: 28,
    bottom: 5,
    hidden: true,          // hidden by default — toggle with Ctrl+S or /sidebar
    style: {
      bg: c.bgSecondary,
      fg: c.textPrimary,
    },
    border: { type: "line" },
    tags: true,
    scrollable: true,
    mouse: true,
    keys: true,
    vi: true,
  });

  function renderSidebar(): void {
    const agents = agentRegistry.getAll();
    const skills = skillRegistry.getAll();
    const currentAgent = state.get("currentAgent");
    const currentTheme = themeEngine.getTheme();

    const lines: string[] = [
      `{${c.cyan}-fg}{bold} ◈ COMMAND CENTER{/}`,
      `{${c.border}-fg}${"─".repeat(24)}{/}`,
      "",
      `{${c.textTertiary}-fg} AGENTS{/}`,
    ];

    for (const agent of agents) {
      const active = agent.name === currentAgent;
      const marker = active ? `{${c.cyan}-fg}▸{/}` : `{${c.textTertiary}-fg}·{/}`;
      const name = active
        ? `{${c.accent || c.cyan}-fg}{bold}${agent.name}{/}`
        : `{${c.textSecondary}-fg}${agent.name}{/}`;
      lines.push(` ${marker} ${name}`);
    }

    if (agents.length === 0) {
      lines.push(`   {${c.textTertiary}-fg}No agents loaded{/}`);
    }

    lines.push("");
    lines.push(`{${c.textTertiary}-fg} SKILLS (${skills.length}){/}`);

    for (const skill of skills.slice(0, 10)) {
      lines.push(` {${c.textTertiary}-fg}·{/} {${c.textSecondary}-fg}${skill.name}{/}`);
    }
    if (skills.length > 10) {
      lines.push(`   {${c.textTertiary}-fg}+${skills.length - 10} more{/}`);
    }

    if (skills.length === 0) {
      lines.push(`   {${c.textTertiary}-fg}No skills loaded{/}`);
    }

    lines.push("");
    lines.push(`{${c.textTertiary}-fg} THEME{/}`);
    lines.push(` {${c.cyan}-fg}◈{/} {bold}${currentTheme.display}{/}`);
    lines.push("");
    lines.push(`{${c.textTertiary}-fg} Ctrl+S to close{/}`);

    sidebar.setContent(lines.join("\n"));
    screen.render();
  }

  renderSidebar();

  state.subscribe("currentAgent", renderSidebar);
  events.on("agent:switched", renderSidebar);
  events.on("theme:changed", renderSidebar);

  sidebar.key(["escape", "C-s"], () => {
    sidebar.hide();
    screen.render();
  });

  return sidebar;
}
