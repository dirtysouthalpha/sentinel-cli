import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitTool } from "../src/tools/git.js";

describe("git tool", () => {
  it("runs status in a real repo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sentinel-git-"));
    try {
      execSync("git init", { cwd: dir });
      execSync("git config user.email t@t.t", { cwd: dir });
      execSync("git config user.name t", { cwd: dir });
      writeFileSync(join(dir, "f.txt"), "hi\n");

      const tool = createGitTool(dir);
      const res = await tool.execute({ action: "status", args: "--short" });
      expect(res.success).toBe(true);
      expect(res.output).toMatch(/f\.txt/);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("reports a git failure cleanly (no throw)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sentinel-git-"));
    try {
      const tool = createGitTool(dir);
      // Not a git repo → git errors; tool returns success:false rather than throwing.
      const res = await tool.execute({ action: "status" });
      expect(res.success).toBe(false);
      expect(typeof res.error).toBe("string");
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});
