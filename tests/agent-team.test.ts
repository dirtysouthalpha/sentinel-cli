import { describe, it, expect, vi } from "vitest";
import { runTeam, type TeamTask, type WorktreeOps, type RunSubagent } from "../src/core/agent-team.js";

/** Fake worktree ops that record every call + script merge outcomes. */
function fakeWorktree(mergeResults: Record<string, { ok: boolean; error?: string }> = {}): WorktreeOps & {
  added: string[]; removed: string[]; merged: string[];
} {
  return {
    added: [], removed: [], merged: [],
    async add(branch) { (this as any).added.push(branch); return { ok: true, path: `/wt/${branch}` }; },
    async remove(branch) { (this as any).removed.push(branch); return { ok: true }; },
    async merge(branch) {
      (this as any).merged.push(branch);
      const scripted = mergeResults[branch];
      if (scripted) return { ok: scripted.ok, error: scripted.error };
      return { ok: true };
    },
  } as any;
}

describe("runTeam — fan-out + merge + cleanup", () => {
  it("runs all tasks in parallel, merges, and cleans up worktrees", async () => {
    const wt = fakeWorktree();
    const runSubagent: RunSubagent = vi.fn(async (prompt) => ({ ok: true, output: `did: ${prompt}` }));
    const tasks: TeamTask[] = [
      { branch: "feat-a", prompt: "implement A" },
      { branch: "feat-b", prompt: "implement B" },
    ];

    const report = await runTeam(tasks, { runSubagent, worktree: wt });

    expect(report.results).toHaveLength(2);
    expect(report.results.map((r) => r.branch)).toEqual(["feat-a", "feat-b"]);
    expect(report.merged).toBe(2);
    expect(report.conflicts).toBe(0);
    expect(report.failed).toBe(0);
    // Both worktrees created + removed.
    expect((wt as any).added).toEqual(["feat-a", "feat-b"]);
    expect((wt as any).removed).toEqual(["feat-a", "feat-b"]);
    // Subagent ran once per task.
    expect(runSubagent).toHaveBeenCalledTimes(2);
  });

  it("returns results in input order regardless of completion order", async () => {
    const wt = fakeWorktree();
    // Make the first task slow so it finishes second.
    const runSubagent: RunSubagent = vi.fn(async (prompt) => {
      if (prompt.includes("slow")) await new Promise((r) => setTimeout(r, 30));
      return { ok: true, output: prompt };
    });
    const tasks: TeamTask[] = [
      { branch: "slow", prompt: "slow task" },
      { branch: "fast", prompt: "fast task" },
    ];

    const report = await runTeam(tasks, { runSubagent, worktree: wt });
    expect(report.results.map((r) => r.branch)).toEqual(["slow", "fast"]);
    expect(report.results.map((r) => r.output)).toEqual(["slow task", "fast task"]);
  });

  it("continues other tasks when one subagent fails; marks it failed", async () => {
    const wt = fakeWorktree();
    const runSubagent: RunSubagent = vi.fn(async (prompt) => {
      if (prompt.includes("boom")) return { ok: false, error: "agent error" };
      return { ok: true, output: "ok" };
    });
    const tasks: TeamTask[] = [
      { branch: "ok-1", prompt: "work 1" },
      { branch: "fail", prompt: "boom" },
      { branch: "ok-2", prompt: "work 2" },
    ];

    const report = await runTeam(tasks, { runSubagent, worktree: wt });
    expect(report.failed).toBe(1);
    expect(report.merged).toBe(2);
    const failRes = report.results.find((r) => r.branch === "fail")!;
    expect(failRes.ok).toBe(false);
    expect(failRes.error).toContain("agent error");
    // The failed task's branch is NOT merged.
    expect((wt as any).merged).toEqual(["ok-1", "ok-2"]);
  });

  it("flags merge conflicts and reports them without crashing", async () => {
    const wt = fakeWorktree({
      "feat-conflict": { ok: false, error: "CONFLICT (content): Merge conflict in src/foo.ts" },
    });
    const runSubagent: RunSubagent = async () => ({ ok: true, output: "did" });
    const tasks: TeamTask[] = [
      { branch: "feat-clean", prompt: "clean" },
      { branch: "feat-conflict", prompt: "conflicting" },
    ];

    const report = await runTeam(tasks, { runSubagent, worktree: wt });
    expect(report.merged).toBe(1);
    expect(report.conflicts).toBe(1);
    const conflictRes = report.results.find((r) => r.branch === "feat-conflict")!;
    expect(conflictRes.conflict).toBe(true);
    expect(conflictRes.error).toContain("CONFLICT");
  });

  it("handles empty task list", async () => {
    const wt = fakeWorktree();
    const runSubagent: RunSubagent = async () => ({ ok: true });
    const report = await runTeam([], { runSubagent, worktree: wt });
    expect(report.results).toEqual([]);
    expect(report.merged).toBe(0);
  });

  it("always cleans up worktrees even when a subagent throws", async () => {
    const wt = fakeWorktree();
    const runSubagent: RunSubagent = async () => {
      throw new Error("network down");
    };
    const tasks: TeamTask[] = [{ branch: "feat-x", prompt: "x" }];

    const report = await runTeam(tasks, { runSubagent, worktree: wt });
    expect(report.results[0].ok).toBe(false);
    expect(report.results[0].error).toContain("network down");
    // Worktree was created + cleaned up despite the throw.
    expect((wt as any).added).toEqual(["feat-x"]);
    expect((wt as any).removed).toEqual(["feat-x"]);
  });
});
