import { AgentDef } from "./types.js";
import { events } from "../core/events.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger({ prefix: "agent-registry" });

class AgentRegistry {
  private agents: Map<string, AgentDef> = new Map();
  private static instance: AgentRegistry;

  private constructor() {}

  static getInstance(): AgentRegistry {
    if (!AgentRegistry.instance) {
      AgentRegistry.instance = new AgentRegistry();
    }
    return AgentRegistry.instance;
  }

  register(agent: AgentDef): void {
    this.agents.set(agent.name, agent);
    log.debug(`Registered agent: ${agent.name}`);
  }

  get(name: string): AgentDef | undefined {
    return this.agents.get(name);
  }

  getAll(): AgentDef[] {
    return Array.from(this.agents.values());
  }

  getNames(): string[] {
    return Array.from(this.agents.keys());
  }

  has(name: string): boolean {
    return this.agents.has(name);
  }

  getByMode(mode: AgentDef["mode"]): AgentDef[] {
    return this.getAll().filter((a) => a.mode === mode);
  }

  clear(): void {
    this.agents.clear();
  }
}

export const agentRegistry = AgentRegistry.getInstance();
