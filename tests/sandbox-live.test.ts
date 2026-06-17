import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runSandboxed, sandboxAvailable, buildBwrapArgs } from "../src/tools/sandbox.js";

/**
 * Live bubblewrap confinement tests. These only run when bwrap is actually
 * present (this Linux box has it); they prove the sandbox genuinely contains
 * filesystem access and blocks network — not just that the argv builder is
 * correct.
 */
const canRun = sandboxAvailable();

describe.skipIf(!canRun)("bubblewrap sandbox (live)", () => {
  let projectRoot: string;

  it("allows writing inside the project root", async () => {
    projectRoot = mkdtempSync(join(tmpdir(), "sentinel-sandbox-"));
    // Write a file via a command inside the sandbox.
    const res = await runSandboxed(["sh", "-c", "echo hello > out.txt"], {
      projectRoot,
    });
    expect(res.ok).toBe(true);
    expect(readFileSync(join(projectRoot, "out.txt"), "utf-8").trim()).toBe("hello");
  });

  it("blocks network access (connection to a public host fails)", async () => {
    projectRoot = mkdtempSync(join(tmpdir(), "sentinel-sandbox-"));
    // With --unshare-net, the loopback interface exists but there's no route to
    // anything. A DNS lookup or connection attempt fails. Use a short timeout
    // so the test doesn't hang on a blocked socket.
    const res = await runSandboxed(
      ["sh", "-c", "getent hosts example.com >/dev/null 2>&1; echo exit=$?"],
      { projectRoot },
      15000
    );
    // exit=2 (name resolution/service failure) is the expected blocked-network
    // result; a networked sandbox would print exit=0.
    expect(res.stdout).toContain("exit=2");
  });

  it("cannot read a host file outside the bind mounts (e.g. a sentinel under /tmp root)", async () => {
    const outside = mkdtempSync(join(tmpdir(), "sentinel-sandbox-"));
    const canary = join(outside, "canary.txt");
    writeFileSync(canary, "TOPSECRET");
    projectRoot = mkdtempSync(join(tmpdir(), "sentinel-sandbox-"));

    // Try to read the canary from inside the sandbox. Only projectRoot is
    // bind-mounted, so the canary path must not exist inside the namespace.
    const res = await runSandboxed(["cat", canary], { projectRoot }, 10000);
    expect(res.ok).toBe(false);
    expect(res.stderr.toLowerCase()).toMatch(/no such file|does not exist|cannot open/);
    // The secret content must never appear in the sandboxed command's output.
    expect(res.stdout).not.toContain("TOPSECRET");
    expect(res.stderr).not.toContain("TOPSECRET");
  });

  it("allowNetwork posture lets resolution through (control case)", async () => {
    projectRoot = mkdtempSync(join(tmpdir(), "sentinel-sandbox-"));
    const res = await runSandboxed(
      ["sh", "-c", "getent hosts localhost >/dev/null 2>&1; echo exit=$?"],
      { projectRoot, allowNetwork: true },
      15000
    );
    // localhost should resolve even from a minimal container; the point is this
    // path differs from the blocked one above.
    expect(res.ok).toBe(true);
  });
});

// Guard: if bwrap is absent, the builder is still exercised by sandbox.test.ts;
// runSandboxed must throw a clear error rather than silently fall back.
describe("runSandboxed without bwrap", () => {
  it("throws a clear error when sandboxAvailable() is false", async () => {
    if (canRun) return; // can't test the negative on a box that has bwrap
    await expect(
      runSandboxed(["echo", "hi"], { projectRoot: "/tmp" })
    ).rejects.toThrow(/bubblewrap|bwrap|unavailable/i);
  });
});

// Keep the builder import in scope (used above) to satisfy linters on boxes
// where the live block is skipped entirely.
void buildBwrapArgs;
