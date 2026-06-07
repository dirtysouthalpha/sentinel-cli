import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  saveWorkflow,
  listWorkflows,
  getWorkflow,
  deleteWorkflow,
  renderSteps,
  Workflow,
} from "../src/core/workflows-store.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sentinel-wf-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("workflows-store", () => {
  it("returns [] / undefined when nothing is saved", () => {
    expect(listWorkflows(dir)).toEqual([]);
    expect(getWorkflow(dir, "nope")).toBeUndefined();
    expect(deleteWorkflow(dir, "nope")).toBe(false);
  });

  it("saves, lists, and gets a workflow (creating the dir on save)", () => {
    const wf: Workflow = {
      name: "ship",
      description: "build and test",
      steps: ["run the build", "run the tests"],
      params: [],
    };
    saveWorkflow(dir, wf);

    const all = listWorkflows(dir);
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("ship");

    const got = getWorkflow(dir, "ship");
    expect(got).toBeDefined();
    expect(got?.description).toBe("build and test");
    expect(got?.steps).toEqual(["run the build", "run the tests"]);
  });

  it("renders steps substituting $1, $2 and $ARGUMENTS", () => {
    const wf: Workflow = {
      name: "fix",
      steps: ["fix the bug in $1", "add a test for $2", "summary: $ARGUMENTS"],
    };
    const rendered = renderSteps(wf, ["auth.ts", "login"]);
    expect(rendered).toEqual([
      "fix the bug in auth.ts",
      "add a test for login",
      "summary: auth.ts login",
    ]);
  });

  it("renders repeated placeholders and leaves unmatched ones untouched", () => {
    const wf: Workflow = { name: "x", steps: ["$1 then $1, then $3"] };
    expect(renderSteps(wf, ["a", "b"])).toEqual(["a then a, then $3"]);
  });

  it("deletes a workflow and returns true, then false", () => {
    saveWorkflow(dir, { name: "tmp", steps: ["do a thing"] });
    expect(getWorkflow(dir, "tmp")).toBeDefined();
    expect(deleteWorkflow(dir, "tmp")).toBe(true);
    expect(getWorkflow(dir, "tmp")).toBeUndefined();
    expect(listWorkflows(dir)).toEqual([]);
    expect(deleteWorkflow(dir, "tmp")).toBe(false);
  });

  it("round-trips multiple workflows", () => {
    saveWorkflow(dir, { name: "a", steps: ["s1"] });
    saveWorkflow(dir, { name: "b", steps: ["s2", "s3"] });
    const names = listWorkflows(dir)
      .map((w) => w.name)
      .sort();
    expect(names).toEqual(["a", "b"]);
  });
});
