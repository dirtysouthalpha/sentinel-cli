import type { CommandContext, CommandSpec, CommandGroup } from "./context.js";
import type { PaletteCommand } from "../../core/command-catalog.js";
import { metaCommands } from "./handlers/meta.js";
import { sessionCommands } from "./handlers/session.js";
import { configCommands } from "./handlers/config.js";
import { taskCommands } from "./handlers/tasks.js";
import { repoCommands } from "./handlers/repo.js";
import { extensionCommands } from "./handlers/extensions.js";
import { aiCommands } from "./handlers/ai.js";

/** Every built-in slash command, in no particular order. */
export const BUILTIN_COMMANDS: CommandSpec[] = [
  ...metaCommands,
  ...sessionCommands,
  ...configCommands,
  ...taskCommands,
  ...repoCommands,
  ...extensionCommands,
  ...aiCommands,
];

/**
 * name/alias -> spec. Built once at module load. A duplicate name across
 * handler files is a programmer error; the last writer wins, but the
 * registry test asserts there are none.
 */
function buildIndex(specs: CommandSpec[]): Map<string, CommandSpec> {
  const index = new Map<string, CommandSpec>();
  for (const spec of specs) {
    index.set(spec.name, spec);
    for (const alias of spec.aliases ?? []) index.set(alias, spec);
  }
  return index;
}

const COMMAND_INDEX = buildIndex(BUILTIN_COMMANDS);

/** Resolve a command name (or alias) to its spec, or undefined if unknown. */
export function resolveCommand(name: string): CommandSpec | undefined {
  return COMMAND_INDEX.get(name);
}

/** Help-menu sections, in render order, with human labels. */
const GROUP_ORDER: { group: CommandGroup; label: string }[] = [
  { group: "core", label: "Setup & Models" },
  { group: "session", label: "Session" },
  { group: "agentic", label: "Agentic" },
  { group: "repo", label: "Code & Repo" },
  { group: "extensions", label: "Extensions" },
];

/** Built-in commands grouped and sorted for the /help menu. */
export function getHelpGroups(): { label: string; commands: CommandSpec[] }[] {
  return GROUP_ORDER.map(({ group, label }) => ({
    label,
    commands: BUILTIN_COMMANDS.filter((c) => (c.group ?? "core") === group).sort((a, b) =>
      a.name.localeCompare(b.name)
    ),
  })).filter((g) => g.commands.length > 0);
}

/**
 * The slash commands as palette entries — the single source for the Ctrl+K
 * palette and /palette, derived from the registry so it can never drift.
 */
export function getPaletteCommands(): PaletteCommand[] {
  return BUILTIN_COMMANDS.map((c) => ({
    command: `/${c.name}`,
    description: c.description,
  }));
}

/**
 * Dispatch a parsed slash command to its built-in handler.
 * Returns true if a built-in handled it; false if the name is unknown (so the
 * caller can fall back to markdown template commands / an unknown-command note).
 */
export async function dispatchCommand(
  name: string,
  ctx: CommandContext
): Promise<boolean> {
  const spec = COMMAND_INDEX.get(name);
  if (!spec) return false;
  await spec.run(ctx);
  return true;
}
