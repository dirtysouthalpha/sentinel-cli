import { describe, it, expect } from "vitest";
import { formatLoopBanner } from "../src/core/loop-banner.js";

const BASE = {
  refinedGoal: "Fix the flaky test. Reproduce, diagnose, fix.",
  statePath: "/home/user/project/project_state.md",
  budget: { maxMinutes: 60, maxCostUSD: 5, maxIterations: 10 },
  sandbox: true,
};

describe("formatLoopBanner — pure startup banner", () => {
  it("includes the refined goal", () => {
    const out = formatLoopBanner(BASE);
    expect(out).toContain("Fix the flaky test");
  });

  it("names the state file path", () => {
    const out = formatLoopBanner(BASE);
    expect(out).toContain("project_state.md");
    expect(out).toContain("gitignore");
  });

  it("names the watch + stop commands", () => {
    const out = formatLoopBanner(BASE);
    expect(out).toContain("sentinel loopstatus");
    expect(out).toContain("tail -f");
    expect(out).toContain("Ctrl+C");
    expect(out).toContain("resume");
  });

  it("shows the budget + sandbox state", () => {
    const out = formatLoopBanner(BASE);
    expect(out).toContain("60 min");
    expect(out).toContain("$5");
    expect(out).toContain("10 iters");
    expect(out).toContain("sandbox ON");
  });

  it("shows sandbox OFF when disabled", () => {
    const out = formatLoopBanner({ ...BASE, sandbox: false });
    expect(out).toContain("sandbox OFF");
  });

  it("says 'starting' on a fresh run, 'resuming' when resuming", () => {
    expect(formatLoopBanner(BASE)).toContain("starting");
    expect(formatLoopBanner({ ...BASE, resuming: true })).toContain("resuming");
  });

  it("shows the raw goal when it differs meaningfully from refined", () => {
    const out = formatLoopBanner({ ...BASE, rawGoal: "fix the flaky test" });
    expect(out).toContain("you said");
    expect(out).toContain("fix the flaky test");
  });

  it("wraps long goals across multiple lines without breaking words", () => {
    const long = "Implement " + "very ".repeat(20) + "long goal that exceeds one line.";
    const out = formatLoopBanner({ ...BASE, refinedGoal: long });
    const goalLines = out.split("\n").filter((l) => l.includes("very") || l.trim().startsWith("long"));
    expect(goalLines.length).toBeGreaterThan(1);
  });

  it("omits budget segments that are undefined", () => {
    const out = formatLoopBanner({ ...BASE, budget: { maxMinutes: 30 } });
    expect(out).toContain("30 min");
    expect(out).not.toContain("$");
    expect(out).not.toContain("iters");
  });
});
