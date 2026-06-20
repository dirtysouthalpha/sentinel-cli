import { describe, it, expect } from "vitest";
import {
  PLUGIN_TYPES,
  validatePluginEntry,
  isPluginType,
  type PluginType,
  type PluginEntry,
} from "../src/core/plugin-types.js";

describe("PLUGIN_TYPES — the extended extensibility surface", () => {
  it("includes the v3.0 types on top of skill/mcp", () => {
    expect(PLUGIN_TYPES).toContain("skill");
    expect(PLUGIN_TYPES).toContain("mcp");
    expect(PLUGIN_TYPES).toContain("tool");
    expect(PLUGIN_TYPES).toContain("theme");
    expect(PLUGIN_TYPES).toContain("hook");
  });
});

describe("isPluginType — type guard", () => {
  it("accepts valid plugin types", () => {
    expect(isPluginType("skill")).toBe(true);
    expect(isPluginType("tool")).toBe(true);
    expect(isPluginType("theme")).toBe(true);
    expect(isPluginType("hook")).toBe(true);
    expect(isPluginType("mcp")).toBe(true);
  });
  it("rejects invalid types", () => {
    expect(isPluginType("extension")).toBe(false);
    expect(isPluginType("")).toBe(false);
    expect(isPluginType("package")).toBe(false);
  });
});

describe("validatePluginEntry — entry validation for the registry", () => {
  const VALID_SKILL: PluginEntry = { id: "my-skill", type: "skill", name: "My Skill", content: "# skill body" };
  const VALID_TOOL: PluginEntry = { id: "my-tool", type: "tool", name: "My Tool", url: "https://example.com/tool.js" };
  const VALID_THEME: PluginEntry = { id: "neon", type: "theme", name: "Neon", content: '{"colors":{}}' };

  it("accepts a valid skill entry", () => {
    expect(validatePluginEntry(VALID_SKILL)).toEqual({ ok: true });
  });
  it("accepts a valid tool entry (needs url or content)", () => {
    expect(validatePluginEntry(VALID_TOOL)).toEqual({ ok: true });
  });
  it("accepts a valid theme entry (needs content)", () => {
    expect(validatePluginEntry(VALID_THEME)).toEqual({ ok: true });
  });
  it("rejects an unknown type", () => {
    const r = validatePluginEntry({ ...VALID_SKILL, type: "unknown" as PluginType });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("type");
  });
  it("rejects a skill with no content or url", () => {
    const r = validatePluginEntry({ id: "x", type: "skill", name: "X" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("content");
  });
  it("rejects an entry with no id", () => {
    const r = validatePluginEntry({ id: "", type: "skill", name: "X", content: "y" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("id");
  });
  it("rejects an entry with no name", () => {
    const r = validatePluginEntry({ id: "x", type: "skill", name: "", content: "y" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("name");
  });
  it("rejects path-traversal in the id (security)", () => {
    const r = validatePluginEntry({ id: "../escape", type: "skill", name: "X", content: "y" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/id|traversal|path/i);
  });
});
