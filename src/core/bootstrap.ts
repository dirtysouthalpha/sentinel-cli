import { resolve } from "node:path";
import { loadAllSkills } from "../skills/loader.js";
import { skillRegistry } from "../skills/registry.js";
import { loadAllCommands } from "../commands/loader.js";
import { commandRegistry } from "../commands/registry.js";
import { loadAllAgents } from "../agents/loader.js";
import { agentRegistry } from "../agents/registry.js";

/**
 * Shared process bootstrap: locate the install root and populate the skill /
 * command / agent registries from it. Used by the TUI entry, the headless
 * runner, `serve`, and `gui` so they all see the same builtin content.
 */

export function getInstallRoot(): string {
  return resolve(
    new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")
  );
}

export function loadRegistries(installRoot: string, skillPaths: string[]): void {
  const { skills } = loadAllSkills(installRoot, skillPaths);
  for (const skill of skills) {
    skillRegistry.register(skill);
  }

  const commands = loadAllCommands(installRoot);
  for (const cmd of commands) {
    commandRegistry.register(cmd);
  }

  const agents = loadAllAgents(installRoot);
  for (const agent of agents) {
    agentRegistry.register(agent);
  }
}
