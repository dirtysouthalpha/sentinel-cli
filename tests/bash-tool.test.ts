import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { createBashTool } from "../src/tools/bash.js";

const isWindows = process.platform === "win32";
const sleepCmd = (sec: number) => (isWindows ? `Start-Sleep -Seconds ${sec}` : `sleep ${sec}`);

describe("bash tool", () => {
  const tool = createBashTool(tmpdir());

  it("runs a simple command and returns stdout", async () => {
    const res = await tool.execute({ command: "echo hello" });
    expect(res.success).toBe(true);
    expect(res.output).toMatch(/hello/);
  });

  it("reports a clear timeout message", async () => {
    const res = await tool.execute({ command: sleepCmd(5), timeout: 300 });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/timed out after 300ms/i);
  }, 10000);

  it("marks a non-zero exit as failure", async () => {
    const res = await tool.execute({ command: isWindows ? "exit 3" : "exit 3" });
    expect(res.success).toBe(false);
  });
});
