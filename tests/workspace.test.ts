import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { WorkspaceStore } from "../src/core/workspace.js";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sentinel-ws-"));
  file = join(dir, "workspace.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("WorkspaceStore", () => {
  it("starts empty when the file is missing (never throws)", () => {
    const ws = new WorkspaceStore(file);
    expect(ws.listRoots()).toEqual([]);
    expect(ws.getActive()).toBeUndefined();
    expect(existsSync(file)).toBe(false);
  });

  it("adds, lists, and resolves roots", () => {
    const ws = new WorkspaceStore(file);
    const a = ws.addRoot(join(dir, "a"));
    ws.addRoot(join(dir, "b"));
    expect(a).toBe(resolve(join(dir, "a")));
    expect(ws.listRoots()).toEqual([resolve(join(dir, "a")), resolve(join(dir, "b"))]);
  });

  it("dedupes roots (including non-normalized duplicates)", () => {
    const ws = new WorkspaceStore(file);
    ws.addRoot(join(dir, "a"));
    ws.addRoot(join(dir, "a", "..", "a"));
    ws.addRoot(join(dir, "a"));
    expect(ws.listRoots()).toEqual([resolve(join(dir, "a"))]);
  });

  it("removes a root and clears active when it pointed there", () => {
    const ws = new WorkspaceStore(file);
    ws.addRoot(join(dir, "a"));
    ws.setActive(join(dir, "a"));
    expect(ws.getActive()).toBe(resolve(join(dir, "a")));
    expect(ws.removeRoot(join(dir, "a"))).toBe(true);
    expect(ws.listRoots()).toEqual([]);
    expect(ws.getActive()).toBeUndefined();
    expect(ws.removeRoot(join(dir, "a"))).toBe(false);
  });

  it("setActive adds the root if not already tracked", () => {
    const ws = new WorkspaceStore(file);
    ws.setActive(join(dir, "x"));
    expect(ws.listRoots()).toEqual([resolve(join(dir, "x"))]);
    expect(ws.getActive()).toBe(resolve(join(dir, "x")));
  });

  it("round-trips through save then load", () => {
    const ws = new WorkspaceStore(file);
    ws.addRoot(join(dir, "a"));
    ws.addRoot(join(dir, "b"));
    ws.setActive(join(dir, "b"));
    expect(existsSync(file)).toBe(true);

    const reloaded = new WorkspaceStore(file);
    expect(reloaded.listRoots()).toEqual([
      resolve(join(dir, "a")),
      resolve(join(dir, "b")),
    ]);
    expect(reloaded.getActive()).toBe(resolve(join(dir, "b")));
  });

  it("drops a stale active root on load if it is not in roots", () => {
    rmSync(file, { force: true });
    const bad = JSON.stringify({ roots: [join(dir, "a")], active: join(dir, "gone") });
    writeFileSync(file, bad, "utf-8");
    const ws = new WorkspaceStore(file);
    expect(ws.listRoots()).toEqual([resolve(join(dir, "a"))]);
    expect(ws.getActive()).toBeUndefined();
  });

  it("tolerates a corrupt file → empty workspace (never throws)", () => {
    writeFileSync(file, "{ not valid json", "utf-8");
    const ws = new WorkspaceStore(file);
    expect(ws.listRoots()).toEqual([]);
    expect(ws.getActive()).toBeUndefined();
  });
});
