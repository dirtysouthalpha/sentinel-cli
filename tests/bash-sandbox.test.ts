import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createBashTool } from "../src/tools/bash.js";
import { sandboxAvailable } from "../src/tools/sandbox.js";

/**
 * Integration: when createBashTool is given { sandbox: true } and bwrap is
 * present, the bash tool runs commands through the bubblewrap namespace (so
 * they can write in-project but cannot reach the network or out-of-project
 * paths). On a host without bwrap the tool must fall back gracefully rather
 * than fail every command.
 */
const canSandbox = sandboxAvailable();

describe("bash tool sandbox integration", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "sentinel-bash-sb-"));
  });

  it("runs a normal command unsandboxed (default)", async () => {
    const bash = createBashTool(projectRoot);
    const res = await bash.execute({ command: "echo hello-world" });
    expect(res.success).toBe(true);
    expect(res.output.trim()).toBe("hello-world");
  });

  describe.skipIf(!canSandbox)("with sandbox enabled (bwrap present)", () => {
    it("writes inside the project root through the sandbox", async () => {
      const bash = createBashTool(projectRoot, { sandbox: true });
      const res = await bash.execute({ command: "echo sb > out.txt" });
      expect(res.success).toBe(true);
      expect(readFileSync(join(projectRoot, "out.txt"), "utf-8").trim()).toBe("sb");
    });

    it("cannot read a host file outside the bind mounts", async () => {
      // /etc/shadow is outside the project root and not bind-mounted.
      const bash = createBashTool(projectRoot, { sandbox: true });
      const res = await bash.execute({ command: "cat /etc/shadow" });
      expect(res.success).toBe(false);
      expect(res.error.toLowerCase()).toMatch(/no such file|permission|cannot/);
    });

    it("blocks network (no exfil to a metadata/public endpoint)", async () => {
      const bash = createBashTool(projectRoot, { sandbox: true });
      // getent should fail to resolve in an isolated net namespace.
      const res = await bash.execute({ command: "getent hosts example.com; echo exit=$?" });
      // exit=2 means name/service failure — the expected blocked-network result.
      expect(res.output).toContain("exit=2");
    }, 20000);

    it("rejects a cwd outside the project root (escape guard)", async () => {
      const bash = createBashTool(projectRoot, { sandbox: true });
      const res = await bash.execute({ command: "echo x", cwd: "/etc" });
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/outside project root/i);
    });
  });
});
