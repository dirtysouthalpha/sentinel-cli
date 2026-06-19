import { describe, it, expect, vi } from "vitest";
import {
  buildAddWorktreeArgs,
  buildRemoveWorktreeArgs,
  buildListWorktreeArgs,
  buildMergeBranchArgs,
  WorktreeManager,
  type GitRunner,
  type WorktreeResult,
} from "../src/core/worktree.js";

describe("buildAddWorktreeArgs — pure argv", () => {
  it("builds a 'git worktree add' argv with a new branch + path", () => {
    expect(buildAddWorktreeArgs("/repo", "feat-x", "/repo/.wt/feat-x")).toEqual([
      "-C",
      "/repo",
      "worktree",
      "add",
      "-b",
      "feat-x",
      "/repo/.wt/feat-x",
    ]);
  });

  it("omits -b when no branch is given (use an existing branch)", () => {
    expect(buildAddWorktreeArgs("/repo", undefined, "/repo/.wt/shared")).toEqual([
      "-C",
      "/repo",
      "worktree",
      "add",
      "/repo/.wt/shared",
    ]);
  });
});

describe("buildRemoveWorktreeArgs — pure argv", () => {
  it("builds 'git worktree remove' with --force flag optional", () => {
    expect(buildRemoveWorktreeArgs("/repo", "/repo/.wt/feat-x", false)).toEqual([
      "-C",
      "/repo",
      "worktree",
      "remove",
      "/repo/.wt/feat-x",
    ]);
    expect(buildRemoveWorktreeArgs("/repo", "/repo/.wt/feat-x", true)).toEqual([
      "-C",
      "/repo",
      "worktree",
      "remove",
      "--force",
      "/repo/.wt/feat-x",
    ]);
  });
});

describe("buildListWorktreeArgs — pure argv", () => {
  it("builds 'git worktree list'", () => {
    expect(buildListWorktreeArgs("/repo")).toEqual([
      "-C",
      "/repo",
      "worktree",
      "list",
      "--porcelain",
    ]);
  });
});

describe("buildMergeBranchArgs — pure argv", () => {
  it("builds 'git merge --no-ff' for a feature branch", () => {
    expect(buildMergeBranchArgs("/repo", "feat-x")).toEqual([
      "-C",
      "/repo",
      "merge",
      "--no-ff",
      "-m",
      "Merge branch 'feat-x'",
      "feat-x",
    ]);
  });
});

/** A fake git runner that records every invocation and returns scripted output. */
function fakeGit(): GitRunner & { calls: { args: string[] }[]; out: string } {
  const calls: { args: string[] }[] = [];
  return {
    calls,
    out: "",
    async run(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
      calls.push({ args });
      return { ok: true, stdout: (this as any).out ?? "", stderr: "" };
    },
  };
}

describe("WorktreeManager — lifecycle over an injected runner", () => {
  it("add builds the worktree and returns its path", async () => {
    const git = fakeGit();
    const wt = new WorktreeManager("/repo", git, "/repo/.wt");
    const res = await wt.add("feat-a");
    expect(res.ok).toBe(true);
    expect(res.path).toBe("/repo/.wt/feat-a");
    expect(git.calls[0].args).toEqual(buildAddWorktreeArgs("/repo", "feat-a", "/repo/.wt/feat-a"));
  });

  it("remove tears down the worktree path", async () => {
    const git = fakeGit();
    const wt = new WorktreeManager("/repo", git, "/repo/.wt");
    await wt.remove("feat-a", true);
    expect(git.calls[0].args).toEqual(buildRemoveWorktreeArgs("/repo", "/repo/.wt/feat-a", true));
  });

  it("merge runs a no-ff merge of the branch", async () => {
    const git = fakeGit();
    const wt = new WorktreeManager("/repo", git, "/repo/.wt");
    await wt.merge("feat-a");
    expect(git.calls[0].args).toEqual(buildMergeBranchArgs("/repo", "feat-a"));
  });

  it("propagates failure from the runner", async () => {
    const git: GitRunner = {
      async run() {
        return { ok: false, stdout: "", stderr: "branch already exists" };
      },
    };
    const wt = new WorktreeManager("/repo", git, "/repo/.wt");
    const res = await wt.add("dupe");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("branch already exists");
  });

  it("add + remove round-trip: two git calls, matching paths", async () => {
    const git = fakeGit();
    const wt = new WorktreeManager("/repo", git, "/repo/.wt");
    await wt.add("rt");
    await wt.remove("rt");
    expect(git.calls).toHaveLength(2);
    expect(git.calls[0].args).toContain("add");
    expect(git.calls[1].args).toContain("remove");
  });
});
