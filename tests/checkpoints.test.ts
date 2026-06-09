import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { CheckpointManager } from "../src/core/checkpoints.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sentinel-cp-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("CheckpointManager", () => {
  it("snapshots and restores an existing file via undo", () => {
    const f = join(dir, "a.txt");
    writeFileSync(f, "original");
    const cm = new CheckpointManager(dir);
    cm.snapshot("a.txt", "file", "edit");
    writeFileSync(f, "modified");
    expect(readFileSync(f, "utf-8")).toBe("modified");

    const cp = cm.undoLast();
    expect(cp).not.toBeNull();
    expect(readFileSync(f, "utf-8")).toBe("original");
  });

  it("undo of a newly-created file deletes it", () => {
    const cm = new CheckpointManager(dir);
    cm.snapshot("new.txt", "file", "write"); // does not exist yet
    writeFileSync(join(dir, "new.txt"), "created");
    expect(existsSync(join(dir, "new.txt"))).toBe(true);

    cm.undoLast();
    expect(existsSync(join(dir, "new.txt"))).toBe(false);
  });

  it("lists checkpoints and persists across instances", () => {
    writeFileSync(join(dir, "b.txt"), "x");
    const cm = new CheckpointManager(dir);
    cm.snapshot("b.txt", "patch");
    expect(cm.list()).toHaveLength(1);

    const cm2 = new CheckpointManager(dir);
    expect(cm2.list()).toHaveLength(1);
  });

  it("undo applies most-recent-first", () => {
    const f = join(dir, "c.txt");
    writeFileSync(f, "v0");
    const cm = new CheckpointManager(dir);
    cm.snapshot("c.txt", "file", "edit");
    writeFileSync(f, "v1");
    cm.snapshot("c.txt", "file", "edit");
    writeFileSync(f, "v2");

    cm.undoLast(); // -> v1
    expect(readFileSync(f, "utf-8")).toBe("v1");
    cm.undoLast(); // -> v0
    expect(readFileSync(f, "utf-8")).toBe("v0");
  });
});
