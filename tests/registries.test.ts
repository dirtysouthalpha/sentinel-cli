import { describe, it, expect, beforeEach } from "vitest";
import { skillRegistry } from "../src/skills/registry.js";
import { agentRegistry } from "../src/agents/registry.js";
import { commandRegistry } from "../src/commands/registry.js";
import { SkillDef } from "../src/skills/types.js";
import { AgentDef } from "../src/agents/types.js";
import { CommandDef } from "../src/commands/types.js";

describe("SkillRegistry", () => {
  beforeEach(() => {
    skillRegistry.clear();
  });

  it("should register and retrieve skills", () => {
    const skill: SkillDef = {
      name: "test",
      description: "Test skill",
      content: "Test content",
      source: "builtin",
    };
    skillRegistry.register(skill);
    expect(skillRegistry.get("test")).toEqual(skill);
  });

  it("should search skills", () => {
    skillRegistry.register({ name: "coding", description: "Code generation", content: "", source: "builtin" });
    skillRegistry.register({ name: "testing", description: "Test generation", content: "", source: "builtin" });
    const results = skillRegistry.search("code");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("coding");
  });
});

describe("AgentRegistry", () => {
  beforeEach(() => {
    agentRegistry.clear();
  });

  it("should register and retrieve agents", () => {
    const agent: AgentDef = {
      name: "test",
      description: "Test agent",
      mode: "primary",
      systemPrompt: "Test prompt",
      source: "builtin",
    };
    agentRegistry.register(agent);
    expect(agentRegistry.get("test")).toEqual(agent);
  });

  it("should filter by mode", () => {
    agentRegistry.register({ name: "a1", description: "", mode: "primary", systemPrompt: "", source: "builtin" });
    agentRegistry.register({ name: "a2", description: "", mode: "assistant", systemPrompt: "", source: "builtin" });
    expect(agentRegistry.getByMode("primary")).toHaveLength(1);
  });
});

describe("CommandRegistry", () => {
  beforeEach(() => {
    commandRegistry.clear();
  });

  it("should register and retrieve commands", () => {
    const cmd: CommandDef = {
      name: "test",
      description: "Test command",
      template: "Do $ARGUMENTS",
      source: "builtin",
    };
    commandRegistry.register(cmd);
    expect(commandRegistry.get("test")).toEqual(cmd);
  });

  it("should support aliases", () => {
    commandRegistry.register({ name: "test", description: "", template: "", source: "builtin" });
    commandRegistry.registerAlias("t", "test");
    expect(commandRegistry.get("t")).toEqual(commandRegistry.get("test"));
  });
});
