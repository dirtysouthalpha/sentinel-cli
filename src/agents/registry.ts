import { AgentDef } from "./types.js";
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

  /**
   * Resolve the agentic-loop round budget for an agent. Honors the agent's
   * `steps` frontmatter (parsed by the loader but historically ignored — both
   * call sites used the hardcoded `gsd ? 30 : 15`). Falls back to that legacy
   * default so behavior is unchanged for agents without a `steps` field, and
   * clamps to a sane minimum.
   */
  roundsFor(name: string, fallback = name === "gsd" ? 30 : 15): number {
    const agent = this.agents.get(name);
    const steps = agent?.steps;
    if (typeof steps === "number" && steps >= 1) return Math.max(1, Math.floor(steps));
    return fallback;
  }

  clear(): void {
    this.agents.clear();
  }
}

export const agentRegistry = AgentRegistry.getInstance();
