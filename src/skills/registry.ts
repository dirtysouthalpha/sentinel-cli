import { SkillDef } from "./types.js";
import { events } from "../core/events.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger({ prefix: "skill-registry" });

class SkillRegistry {
  private skills: Map<string, SkillDef> = new Map();
  private static instance: SkillRegistry;

  private constructor() {}

  static getInstance(): SkillRegistry {
    if (!SkillRegistry.instance) {
      SkillRegistry.instance = new SkillRegistry();
    }
    return SkillRegistry.instance;
  }

  register(skill: SkillDef): void {
    this.skills.set(skill.name, skill);
    events.emit("skill:loaded", skill.name);
    log.debug(`Registered skill: ${skill.name}`);
  }

  get(name: string): SkillDef | undefined {
    return this.skills.get(name);
  }

  getAll(): SkillDef[] {
    return Array.from(this.skills.values());
  }

  getNames(): string[] {
    return Array.from(this.skills.keys());
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  unregister(name: string): boolean {
    return this.skills.delete(name);
  }

  clear(): void {
    this.skills.clear();
  }

  search(query: string): SkillDef[] {
    const lower = query.toLowerCase();
    return this.getAll().filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        s.description.toLowerCase().includes(lower)
    );
  }
}

export const skillRegistry = SkillRegistry.getInstance();
