import { CommandDef } from "./types.js";
import { events } from "../core/events.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger({ prefix: "cmd-registry" });

class CommandRegistry {
  private commands: Map<string, CommandDef> = new Map();
  private aliases: Map<string, string> = new Map();
  private static instance: CommandRegistry;

  private constructor() {}

  static getInstance(): CommandRegistry {
    if (!CommandRegistry.instance) {
      CommandRegistry.instance = new CommandRegistry();
    }
    return CommandRegistry.instance;
  }

  register(command: CommandDef): void {
    this.commands.set(command.name, command);
    log.debug(`Registered command: /${command.name}`);
  }

  registerAlias(alias: string, commandName: string): void {
    this.aliases.set(alias, commandName);
  }

  get(name: string): CommandDef | undefined {
    const resolved = this.aliases.get(name) || name;
    return this.commands.get(resolved);
  }

  getAll(): CommandDef[] {
    return Array.from(this.commands.values());
  }

  getNames(): string[] {
    return Array.from(this.commands.keys());
  }

  has(name: string): boolean {
    return this.commands.has(name) || this.aliases.has(name);
  }

  search(query: string): CommandDef[] {
    const lower = query.toLowerCase();
    return this.getAll().filter(
      (c) =>
        c.name.toLowerCase().includes(lower) ||
        c.description.toLowerCase().includes(lower)
    );
  }

  clear(): void {
    this.commands.clear();
    this.aliases.clear();
  }
}

export const commandRegistry = CommandRegistry.getInstance();
