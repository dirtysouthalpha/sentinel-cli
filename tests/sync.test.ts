import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  buildBundle,
  writeBundle,
  readBundle,
  applyBundle,
  redactConfig,
  SYNC_BUNDLE_VERSION,
  type SyncBundle,
} from "../src/core/sync.js";

let projectRoot: string;
let globalConfigPath: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "sentinel-sync-proj-"));
  const cfgDir = mkdtempSync(join(tmpdir(), "sentinel-sync-cfg-"));
  globalConfigPath = join(cfgDir, "config.json");
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  try {
    rmSync(join(globalConfigPath, ".."), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function seedSkills(): void {
  const dir = join(projectRoot, ".sentinel", "skills");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "hello.md"), "# Hello\nbody", "utf-8");
  writeFileSync(join(dir, "world.md"), "# World", "utf-8");
  writeFileSync(join(dir, "ignore.txt"), "not a skill", "utf-8");
}

function seedWorkflows(): void {
  const dir = join(projectRoot, ".sentinel", "workflows");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "ship.json"),
    JSON.stringify({ name: "ship", steps: ["build", "test"] }),
    "utf-8"
  );
}

function seedGlobalConfig(): void {
  writeFileSync(
    globalConfigPath,
    JSON.stringify({
      currentModel: "zai/glm-4.6",
      provider: {
        anthropic: { apiKey: "sk-ant-abcdef0123456789ABCDEF" },
        zai: { apiKey: "secret-zai-key-value" },
      },
      note: "token=ghp_0123456789abcdefghijABCDEFGHIJ012345 inline",
    }),
    "utf-8"
  );
}

describe("redactConfig", () => {
  it("blanks secret-shaped keys and masks inline secrets", () => {
    const out = redactConfig({
      provider: { anthropic: { apiKey: "sk-ant-xxxxxxxxxxxxxxxxxxxx" } },
      authToken: "abc123def456",
      keep: "plain value",
      note: "my key is sk-ant-yyyyyyyyyyyyyyyyyyyy here",
    }) as Record<string, any>;

    expect(out.provider.anthropic.apiKey).toBe("[REDACTED]");
    expect(out.authToken).toBe("[REDACTED]");
    expect(out.keep).toBe("plain value");
    // inline secret in a non-secret key is masked, not left verbatim
    expect(out.note).not.toContain("sk-ant-yyyyyyyyyyyyyyyyyyyy");
  });
});

describe("buildBundle", () => {
  it("gathers config (redacted), skills, and workflows", () => {
    seedSkills();
    seedWorkflows();
    seedGlobalConfig();

    const bundle = buildBundle(projectRoot, {
      globalConfigPath,
      now: () => "2026-06-07T00:00:00.000Z",
    });

    expect(bundle.version).toBe(SYNC_BUNDLE_VERSION);
    expect(bundle.exportedAt).toBe("2026-06-07T00:00:00.000Z");

    // config present but redacted
    const cfg = bundle.config as any;
    expect(cfg.currentModel).toBe("zai/glm-4.6");
    expect(cfg.provider.anthropic.apiKey).toBe("[REDACTED]");
    expect(cfg.provider.zai.apiKey).toBe("[REDACTED]");
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain("sk-ant-abcdef0123456789ABCDEF");
    expect(serialized).not.toContain("secret-zai-key-value");
    expect(serialized).not.toContain("ghp_0123456789abcdefghijABCDEFGHIJ012345");

    // skills: only .md files
    expect(Object.keys(bundle.skills ?? {}).sort()).toEqual(["hello.md", "world.md"]);
    expect(bundle.skills?.["hello.md"]).toContain("Hello");

    // workflows: parsed JSON
    expect((bundle.workflows?.["ship.json"] as any).steps).toEqual(["build", "test"]);
  });

  it("tolerates missing pieces (no config, no .sentinel dir)", () => {
    const bundle = buildBundle(projectRoot, {
      globalConfigPath: join(projectRoot, "does-not-exist.json"),
    });
    expect(bundle.version).toBe(SYNC_BUNDLE_VERSION);
    expect(bundle.config).toBeUndefined();
    expect(bundle.skills).toBeUndefined();
    expect(bundle.workflows).toBeUndefined();
  });

  it("omits config when the global config is invalid JSON", () => {
    writeFileSync(globalConfigPath, "{ not json", "utf-8");
    const bundle = buildBundle(projectRoot, { globalConfigPath });
    expect(bundle.config).toBeUndefined();
  });
});

describe("writeBundle / readBundle", () => {
  it("round-trips a bundle to disk", () => {
    seedSkills();
    seedWorkflows();
    const bundle = buildBundle(projectRoot, {
      globalConfigPath: join(projectRoot, "nope.json"),
    });
    const out = join(projectRoot, "sentinel-sync.json");
    writeBundle(out, bundle);
    expect(existsSync(out)).toBe(true);

    const read = readBundle(out);
    expect(read).toEqual(bundle);
  });

  it("rejects a bundle without a numeric version", () => {
    const bad = join(projectRoot, "bad.json");
    writeFileSync(bad, JSON.stringify({ skills: {} }), "utf-8");
    expect(() => readBundle(bad)).toThrow(/version/i);
  });

  it("rejects an unsupported (newer) version", () => {
    const future = join(projectRoot, "future.json");
    writeFileSync(future, JSON.stringify({ version: 999 }), "utf-8");
    expect(() => readBundle(future)).toThrow(/Unsupported/i);
  });

  it("rejects non-JSON", () => {
    const bad = join(projectRoot, "garbage.json");
    writeFileSync(bad, "<<<not json>>>", "utf-8");
    expect(() => readBundle(bad)).toThrow(/JSON/i);
  });
});

describe("applyBundle", () => {
  it("writes skills and workflows back to .sentinel/", () => {
    const bundle: SyncBundle = {
      version: SYNC_BUNDLE_VERSION,
      skills: { "restored.md": "# Restored skill" },
      workflows: { "deploy.json": { name: "deploy", steps: ["go"] } },
    };
    const applied = applyBundle(projectRoot, bundle);

    expect(applied).toContain("skill: restored.md");
    expect(applied).toContain("workflow: deploy.json");

    const skillPath = join(projectRoot, ".sentinel", "skills", "restored.md");
    expect(readFileSync(skillPath, "utf-8")).toContain("Restored skill");

    const wfPath = join(projectRoot, ".sentinel", "workflows", "deploy.json");
    expect(JSON.parse(readFileSync(wfPath, "utf-8")).steps).toEqual(["go"]);
  });

  it("does not touch the global config (returns [] for an empty bundle)", () => {
    const applied = applyBundle(projectRoot, { version: SYNC_BUNDLE_VERSION });
    expect(applied).toEqual([]);
    expect(existsSync(join(projectRoot, ".sentinel"))).toBe(false);
  });

  it("sanitizes path-traversal filenames", () => {
    const bundle: SyncBundle = {
      version: SYNC_BUNDLE_VERSION,
      skills: { "../../evil.md": "nope" },
    };
    const applied = applyBundle(projectRoot, bundle);
    expect(applied[0]).not.toContain("..");
    // file lands inside the skills dir, not outside the project
    const inside = join(projectRoot, ".sentinel", "skills");
    expect(existsSync(inside)).toBe(true);
  });

  it("build -> write -> read -> apply full round-trip", () => {
    seedSkills();
    seedWorkflows();
    const bundle = buildBundle(projectRoot, {
      globalConfigPath: join(projectRoot, "nope.json"),
    });
    const out = join(projectRoot, "bundle.json");
    writeBundle(out, bundle);

    // apply into a fresh project
    const dest = mkdtempSync(join(tmpdir(), "sentinel-sync-dest-"));
    try {
      const applied = applyBundle(dest, readBundle(out));
      expect(applied).toContain("skill: hello.md");
      expect(applied).toContain("workflow: ship.json");
      expect(existsSync(join(dest, ".sentinel", "skills", "hello.md"))).toBe(true);
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });
});
