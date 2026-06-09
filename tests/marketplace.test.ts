import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  fetchRegistry,
  searchRegistry,
  installEntry,
  Registry,
  MarketplaceEntry,
} from "../src/core/marketplace.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sentinel-mkt-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const sampleRegistry: Registry = {
  entries: [
    {
      id: "hello-skill",
      type: "skill",
      name: "Hello Skill",
      description: "A friendly greeting skill",
      content: "---\nname: hello\n---\nSay hello.",
    },
    {
      id: "remote-skill",
      type: "skill",
      name: "Remote Skill",
      description: "Fetched over the wire",
      url: "https://example.com/remote-skill.md",
    },
    {
      id: "fs-mcp",
      type: "mcp",
      name: "filesystem",
      description: "MCP filesystem server",
      command: ["npx", "-y", "@modelcontextprotocol/server-filesystem"],
    },
  ],
};

describe("fetchRegistry", () => {
  it("loads + validates a registry from a local file path", async () => {
    const path = join(dir, "registry.json");
    writeFileSync(path, JSON.stringify(sampleRegistry), "utf-8");
    const reg = await fetchRegistry(path);
    expect(reg.entries).toHaveLength(3);
    expect(reg.entries[0].id).toBe("hello-skill");
  });

  it("loads a registry from a URL via injected fetchText", async () => {
    const reg = await fetchRegistry("https://registry.example/index.json", {
      fetchText: async (url) => {
        expect(url).toBe("https://registry.example/index.json");
        return JSON.stringify(sampleRegistry);
      },
    });
    expect(reg.entries.map((e) => e.id)).toEqual(["hello-skill", "remote-skill", "fs-mcp"]);
  });

  it("throws when the local file does not exist", async () => {
    await expect(fetchRegistry(join(dir, "missing.json"))).rejects.toThrow(/not found/i);
  });

  it("throws on invalid JSON", async () => {
    const path = join(dir, "bad.json");
    writeFileSync(path, "{ not json", "utf-8");
    await expect(fetchRegistry(path)).rejects.toThrow(/not valid JSON/i);
  });

  it("throws on a malformed registry (entries not an array)", async () => {
    await expect(
      fetchRegistry("https://x/y.json", { fetchText: async () => JSON.stringify({ entries: "nope" }) })
    ).rejects.toThrow(/entries must be an array/i);
  });

  it("throws on an entry with a bad type", async () => {
    const bad = { entries: [{ id: "x", type: "plugin", name: "X" }] };
    await expect(
      fetchRegistry("https://x/y.json", { fetchText: async () => JSON.stringify(bad) })
    ).rejects.toThrow(/invalid type/i);
  });
});

describe("searchRegistry", () => {
  it("matches case-insensitively on name, description, and id", () => {
    expect(searchRegistry(sampleRegistry, "hello").map((e) => e.id)).toEqual(["hello-skill"]);
    expect(searchRegistry(sampleRegistry, "MCP").map((e) => e.id)).toEqual(["fs-mcp"]);
    expect(searchRegistry(sampleRegistry, "remote-skill").map((e) => e.id)).toEqual(["remote-skill"]);
  });

  it("returns all entries for an empty query", () => {
    expect(searchRegistry(sampleRegistry, "")).toHaveLength(3);
  });

  it("returns [] when nothing matches", () => {
    expect(searchRegistry(sampleRegistry, "zzz-nope")).toEqual([]);
  });
});

describe("installEntry", () => {
  it("writes a skill markdown file from inline content", async () => {
    const entry = sampleRegistry.entries[0];
    const summary = await installEntry(dir, entry);
    expect(summary).toMatch(/Installed skill/);
    const dest = join(dir, ".sentinel", "skills", "hello-skill.md");
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, "utf-8")).toContain("Say hello.");
  });

  it("fetches skill content from url when no inline content", async () => {
    const entry = sampleRegistry.entries[1];
    const summary = await installEntry(dir, entry, {
      fetchText: async (url) => {
        expect(url).toBe("https://example.com/remote-skill.md");
        return "# Remote\nfetched body";
      },
    });
    expect(summary).toMatch(/Installed skill/);
    const dest = join(dir, ".sentinel", "skills", "remote-skill.md");
    expect(readFileSync(dest, "utf-8")).toContain("fetched body");
  });

  it("writes an MCP server config into mcp.install.json", async () => {
    const entry = sampleRegistry.entries[2];
    const summary = await installEntry(dir, entry);
    expect(summary).toMatch(/Installed MCP server/);
    const installPath = join(dir, ".sentinel", "mcp.install.json");
    const record = JSON.parse(readFileSync(installPath, "utf-8"));
    expect(record.filesystem).toEqual({
      type: "local",
      enabled: true,
      command: ["npx", "-y", "@modelcontextprotocol/server-filesystem"],
    });
  });

  it("merges multiple MCP installs into the same file", async () => {
    await installEntry(dir, sampleRegistry.entries[2]);
    const remote: MarketplaceEntry = {
      id: "remote-mcp",
      type: "mcp",
      name: "weather",
      url: "https://mcp.example/weather",
    };
    await installEntry(dir, remote);
    const record = JSON.parse(readFileSync(join(dir, ".sentinel", "mcp.install.json"), "utf-8"));
    expect(Object.keys(record).sort()).toEqual(["filesystem", "weather"]);
    expect(record.weather).toEqual({ type: "remote", enabled: true, url: "https://mcp.example/weather" });
  });

  it("returns an error string (does not throw) on network failure for a remote skill", async () => {
    const entry = sampleRegistry.entries[1];
    const summary = await installEntry(dir, entry, {
      fetchText: async () => {
        throw new Error("boom");
      },
    });
    expect(summary).toMatch(/Failed to fetch skill/);
    expect(existsSync(join(dir, ".sentinel", "skills", "remote-skill.md"))).toBe(false);
  });

  it("returns a message when a skill has neither content nor url", async () => {
    const summary = await installEntry(dir, { id: "empty", type: "skill", name: "Empty" });
    expect(summary).toMatch(/no content or url/);
  });
});
