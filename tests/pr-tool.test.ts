import { describe, it, expect } from "vitest";
import {
  buildPrCreateArgs,
  buildPrListArgs,
  buildPrMergeArgs,
  buildPrViewArgs,
  buildConflictHunks,
  type GhRunner,
} from "../src/core/pr-tool.js";

describe("buildPrCreateArgs — pure argv", () => {
  it("builds 'gh pr create' with title + body", () => {
    expect(buildPrCreateArgs("Add health check", "Implements GET /healthz")).toEqual([
      "pr", "create", "--title", "Add health check", "--body", "Implements GET /healthz",
    ]);
  });
  it("adds --draft when draft is true", () => {
    const args = buildPrCreateArgs("WIP", "draft", true);
    expect(args).toContain("--draft");
  });
  it("adds labels + assignees when provided", () => {
    const args = buildPrCreateArgs("T", "B", false, ["bug", "ui"], ["alice"]);
    expect(args).toContain("--label");
    expect(args).toContain("bug,ui");
    expect(args).toContain("--assignee");
    expect(args).toContain("alice");
  });
});

describe("buildPrListArgs", () => {
  it("builds 'gh pr list' with optional limit", () => {
    expect(buildPrListArgs()).toEqual(["pr", "list"]);
    expect(buildPrListArgs(5)).toEqual(["pr", "list", "--limit", "5"]);
  });
});

describe("buildPrMergeArgs", () => {
  it("builds 'gh pr merge' with squash by default", () => {
    expect(buildPrMergeArgs(42)).toEqual(["pr", "merge", "42", "--squash"]);
  });
  it("supports merge + rebase strategies", () => {
    expect(buildPrMergeArgs(7, "merge")).toEqual(["pr", "merge", "7", "--merge"]);
    expect(buildPrMergeArgs(7, "rebase")).toEqual(["pr", "merge", "7", "--rebase"]);
  });
  it("deletes the branch on merge when deleteBranch is true", () => {
    const args = buildPrMergeArgs(1, "squash", true);
    expect(args).toContain("--delete-branch");
  });
});

describe("buildPrViewArgs", () => {
  it("builds 'gh pr view' with --json for machine parsing", () => {
    expect(buildPrViewArgs(3)).toEqual([
      "pr", "view", "3", "--json", "number,title,state,url,body,additions,deletions",
    ]);
  });
});

describe("buildConflictHunks — surface merge conflicts to the model", () => {
  it("extracts <<<<<<< ======= >>>>>>> blocks as structured hunks", () => {
    const file = `line1
<<<<<<< HEAD
our change
=======
their change
>>>>>>> branch-x
line5`;
    const hunks = buildConflictHunks(file, "src/foo.ts");
    expect(hunks).toHaveLength(1);
    expect(hunks[0].file).toBe("src/foo.ts");
    expect(hunks[0].ours).toBe("our change");
    expect(hunks[0].theirs).toBe("their change");
  });
  it("handles multi-line ours/theirs", () => {
    const file = `<<<<<<< HEAD
line a
line b
=======
line x
line y
>>>>>>> feat`;
    const hunks = buildConflictHunks(file, "f.ts");
    expect(hunks[0].ours).toBe("line a\nline b");
    expect(hunks[0].theirs).toBe("line x\nline y");
  });
  it("returns empty array when no conflicts", () => {
    expect(buildConflictHunks("just normal code", "f.ts")).toEqual([]);
  });
  it("handles multiple conflict blocks in one file", () => {
    const file = `<<<<<<< HEAD
a
=======
b
>>>>>>> x
middle
<<<<<<< HEAD
c
=======
d
>>>>>>> y`;
    expect(buildConflictHunks(file, "f.ts")).toHaveLength(2);
  });
});
