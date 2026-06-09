import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndex, search, tokenize } from "../src/core/repo-index.js";

describe("repo-index", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "sentinel-repo-index-"));

    // A file clearly about authentication/login.
    await writeFile(
      join(dir, "auth.ts"),
      "export function login(user, password) {\n  // authenticate the user against the auth service\n  return authenticate(user, password);\n}\n",
      "utf8"
    );
    // A file about database/storage.
    await writeFile(
      join(dir, "database.ts"),
      "export function queryDatabase(sql) {\n  // run a sql query against the postgres database\n  return db.execute(sql);\n}\n",
      "utf8"
    );
    // A README with general project text.
    await writeFile(
      join(dir, "README.md"),
      "# My Project\n\nThis project does many things unrelated to the queries.\n",
      "utf8"
    );

    // node_modules should be excluded entirely.
    await mkdir(join(dir, "node_modules", "leftpad"), { recursive: true });
    await writeFile(
      join(dir, "node_modules", "leftpad", "index.js"),
      "module.exports = function login() { return 'authenticate everything everywhere'; };\n",
      "utf8"
    );

    // A non-source extension that should be ignored.
    await writeFile(join(dir, "notes.txt"), "login authenticate login authenticate", "utf8");
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("tokenizes lowercase alphanumerics, dropping short tokens", () => {
    expect(tokenize("Hello, World! a b22")).toEqual(["hello", "world", "b22"]);
  });

  it("builds an index over source files and reports the count", () => {
    const index = buildIndex(dir);
    expect(index.fileCount).toBe(3); // auth.ts, database.ts, README.md
    expect(index.docs.map((d) => d.path).sort()).toEqual([
      "README.md",
      "auth.ts",
      "database.ts",
    ]);
    expect(index.truncated).toBe(false);
  });

  it("excludes node_modules and non-source extensions", () => {
    const index = buildIndex(dir);
    const paths = index.docs.map((d) => d.path);
    expect(paths.some((p) => p.includes("node_modules"))).toBe(false);
    expect(paths.some((p) => p.endsWith(".txt"))).toBe(false);
  });

  it("ranks the most relevant file first for a query", () => {
    const index = buildIndex(dir);
    const results = search(index, "user login authentication", 8);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toBe("auth.ts");
    expect(results[0].snippet.length).toBeGreaterThan(0);

    const dbResults = search(index, "sql postgres database query", 8);
    expect(dbResults[0].path).toBe("database.ts");
  });

  it("returns at most k results", () => {
    const index = buildIndex(dir);
    const results = search(index, "the project query database login", 1);
    expect(results.length).toBe(1);
  });

  it("returns empty results for an empty or non-matching query", () => {
    const index = buildIndex(dir);
    expect(search(index, "")).toEqual([]);
    expect(search(index, "zzzznonexistenttoken")).toEqual([]);
  });

  it("respects the maxFiles cap and flags truncation", () => {
    const index = buildIndex(dir, { maxFiles: 1 });
    expect(index.fileCount).toBe(1);
    expect(index.truncated).toBe(true);
  });

  it("respects the maxFileBytes cap (skips large files)", () => {
    const index = buildIndex(dir, { maxFileBytes: 10 });
    // Every fixture file is larger than 10 bytes, so none are indexed.
    expect(index.fileCount).toBe(0);
  });

  it("produces a snippet containing a matching line", () => {
    const index = buildIndex(dir);
    const [top] = search(index, "authenticate", 1);
    expect(top.path).toBe("auth.ts");
    expect(top.snippet.toLowerCase()).toContain("authenticate");
  });
});
