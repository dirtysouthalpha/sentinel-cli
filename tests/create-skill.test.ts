import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createCreateSkillTool, sanitizeSkillName } from "../src/tools/create-skill.js";

describe("sanitizeSkillName", () => {
  it("lowercases and kebab-cases", () => {
    expect(sanitizeSkillName("Deploy To Vercel")).toBe("deploy-to-vercel");
    expect(sanitizeSkillName("fix_bug-now")).toBe("fix-bug-now");
  });
  it("strips leading/trailing dashes", () => {
    expect(sanitizeSkillName("--weird--")).toBe("weird");
  });
  it("collapses double-dots (no traversal)", () => {
    expect(sanitizeSkillName("..evil")).toBe("evil");
    expect(sanitizeSkillName("a..b")).toBe("a.b");
  });
});

describe("create_skill tool", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "sentinel-skill-"));
  });

  it("writes a valid .md skill with frontmatter + body", async () => {
    const tool = createCreateSkillTool(root);
    const res = await tool.execute({
      name: "deploy-vercel",
      description: "Deploys the project to Vercel",
      body: "1. Run `vercel --prod`\n2. Confirm the URL",
    });
    expect(res.success).toBe(true);
    const dest = join(root, ".sentinel", "skills", "deploy-vercel.md");
    expect(existsSync(dest)).toBe(true);
    const content = readFileSync(dest, "utf-8");
    expect(content).toMatch(/^---\nname: deploy-vercel/);
    expect(content).toContain("description: Deploys the project to Vercel");
    expect(content).toContain("Run `vercel --prod`");
  });

  it("rejects an empty name/description/body", async () => {
    const tool = createCreateSkillTool(root);
    expect((await tool.execute({ name: "", description: "x", body: "y" })).success).toBe(false);
    expect((await tool.execute({ name: "x", description: "", body: "y" })).success).toBe(false);
    expect((await tool.execute({ name: "x", description: "y", body: "" })).success).toBe(false);
  });

  it("refuses a path-traversal name", async () => {
    const tool = createCreateSkillTool(root);
    const res = await tool.execute({ name: "..evil", description: "x", body: "y" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Invalid skill name/);
  });
});
