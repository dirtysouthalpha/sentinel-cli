import { describe, it, expect, beforeEach } from "vitest";
import { agentRegistry } from "../src/agents/registry.js";
import type { AgentDef } from "../src/agents/types.js";

/**
 * M3: the agent's `steps` frontmatter is parsed by the loader but both runner
 * call sites used the hardcoded `gsd ? 30 : 15`. roundsFor() now honors `steps`,
 * falling back to that legacy default so behavior is unchanged for agents
 * without the field.
 */
function mkAgent(name: string, steps?: number): AgentDef {
  return {
    name,
    description: name,
    mode: "primary",
    systemPrompt: "",
    source: "builtin",
    ...(steps !== undefined ? { steps } : {}),
  };
}

describe("AgentRegistry.roundsFor", () => {
  beforeEach(() => {
    agentRegistry.clear();
  });

  it("returns the agent's steps when set", () => {
    agentRegistry.register(mkAgent("orchestrator", 80));
    expect(agentRegistry.roundsFor("orchestrator")).toBe(80);
  });

  it("falls back to the legacy gsd?30:15 default when steps is absent", () => {
    agentRegistry.register(mkAgent("gsd")); // no steps
    agentRegistry.register(mkAgent("code")); // no steps
    expect(agentRegistry.roundsFor("gsd")).toBe(30);
    expect(agentRegistry.roundsFor("code")).toBe(15);
  });

  it("honors a custom fallback", () => {
    expect(agentRegistry.roundsFor("unknown", 42)).toBe(42);
  });

  it("treats non-positive steps as absent (falls back, never returns 0)", () => {
    // steps:0 or negative is nonsensical; round down to the default rather than
    // letting the agent loop zero times or hang on a bad frontmatter value.
    agentRegistry.register(mkAgent("zero", 0));
    agentRegistry.register(mkAgent("neg", -5));
    expect(agentRegistry.roundsFor("zero")).toBe(15);
    expect(agentRegistry.roundsFor("neg")).toBe(15);
  });

  it("ignores non-numeric steps and uses the default", () => {
    // The loader coerces bad frontmatter; if steps is somehow undefined, fall back.
    agentRegistry.register(mkAgent("weird")); // steps omitted
    expect(agentRegistry.roundsFor("weird")).toBe(15);
  });
});
