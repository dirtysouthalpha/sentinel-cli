import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { TeamStore } from "../src/core/team.js";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sentinel-team-"));
  file = join(dir, "team.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("TeamStore", () => {
  it("starts empty when the file is missing (never throws)", () => {
    const t = new TeamStore(file);
    expect(t.get()).toEqual({ name: undefined, registry: undefined, members: [] });
    expect(t.listMembers()).toEqual([]);
    expect(existsSync(file)).toBe(false);
  });

  it("sets name and registry", () => {
    const t = new TeamStore(file);
    t.setName("acme");
    t.setRegistry("https://example.com/registry.json");
    expect(t.get().name).toBe("acme");
    expect(t.get().registry).toBe("https://example.com/registry.json");
    expect(existsSync(file)).toBe(true);
  });

  it("adds, lists, and dedupes members", () => {
    const t = new TeamStore(file);
    expect(t.addMember("alice")).toBe("alice");
    t.addMember("bob");
    t.addMember("alice");
    t.addMember("  alice  ");
    expect(t.listMembers()).toEqual(["alice", "bob"]);
  });

  it("removes a member and reports whether it existed", () => {
    const t = new TeamStore(file);
    t.addMember("alice");
    t.addMember("bob");
    expect(t.removeMember("alice")).toBe(true);
    expect(t.listMembers()).toEqual(["bob"]);
    expect(t.removeMember("alice")).toBe(false);
    expect(t.removeMember("nobody")).toBe(false);
  });

  it("round-trips through save then load", () => {
    const t = new TeamStore(file);
    t.setName("acme");
    t.setRegistry("https://example.com/registry.json");
    t.addMember("alice");
    t.addMember("bob");
    expect(existsSync(file)).toBe(true);

    const reloaded = new TeamStore(file);
    expect(reloaded.get()).toEqual({
      name: "acme",
      registry: "https://example.com/registry.json",
      members: ["alice", "bob"],
    });
  });

  it("dedupes members on load", () => {
    writeFileSync(
      file,
      JSON.stringify({ name: "acme", members: ["alice", "alice", "bob"] }),
      "utf-8"
    );
    const t = new TeamStore(file);
    expect(t.listMembers()).toEqual(["alice", "bob"]);
  });

  it("tolerates a corrupt file → empty manifest (never throws)", () => {
    writeFileSync(file, "{ not valid json", "utf-8");
    const t = new TeamStore(file);
    expect(t.get()).toEqual({ name: undefined, registry: undefined, members: [] });
  });
});
