import type { CommandContext, CommandSpec } from "./context.js";
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
