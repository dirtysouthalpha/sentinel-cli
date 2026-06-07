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
    top: 1,
    right: 0,
    width: 26,
    bottom: 3,
    style: {
      bg: c.bgSecondary,
      fg: c.textPrimary,
    },
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
      `{${c.accent}-fg}{bold}◈ COMMAND CENTER{/}`,
      "",
      `{${c.textTertiary}-fg}── AGENTS ──────────{/}`,
    ];

    for (const agent of agents) {
      const active = agent.name === currentAgent;
      const marker = active ? `{${c.cyan}-fg}▸{/}` : " ";
      const name = active ? `{${c.accent}-fg}{bold}${agent.name}{/bold}{/${c.accent}-fg}}` : `{${c.textSecondary}-fg}${agent.name}{/${c.textSecondary}-fg}}`;
      lines.push(` ${marker} ${name}`);
    }

    if (agents.length === 0) {
      lines.push(`   {${c.textTertiary}-fg}No agents loaded{/}`);
    }

    lines.push("");
    lines.push(`{${c.textTertiary}-fg}── SKILLS ──────────{/}`);

    for (const skill of skills.slice(0, 8)) {
      lines.push(` {${c.textTertiary}-fg}·{/} {${c.textSecondary}-fg}${skill.name}{/${c.textSecondary}-fg}}`);
    }

    if (skills.length === 0) {
      lines.push(`   {${c.textTertiary}-fg}No skills loaded{/}`);
    }

    lines.push("");
    lines.push(`{${c.textTertiary}-fg}── THEME ───────────{/}`);
    lines.push(` {${c.cyan}-fg}◈{/} {bold}${currentTheme.display}{/bold}`);

    sidebar.setContent(lines.join("\n"));
    screen.render();
  }

  renderSidebar();

  state.subscribe("currentAgent", renderSidebar);
  events.on("agent:switched", renderSidebar);
  events.on("theme:changed", renderSidebar);

  sidebar.key(["escape"], () => {
    sidebar.hide();
    screen.render();
  });

  return sidebar;
}
