#!/usr/bin/env node
/**
 * Agent eval harness. For each task in tasks.json it:
 *   1. seeds a temp working dir with the task's fixture files,
 *   2. runs the built CLI headlessly (`node dist/cli.js run --json ...`) in it,
 *   3. scores the run with the deterministic checks in src/core/eval.ts.
 *
 * Usage:  npm run build  &&  npm run eval
 * Needs a provider key in the environment (ANTHROPIC_API_KEY / OPENAI_API_KEY /
 * ZAI_API_KEY / GEMINI_API_KEY), or a local Ollama. Exit code is non-zero if any
 * task fails, so this is CI-wireable.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const cli = join(repoRoot, "dist", "cli.js");

if (!existsSync(cli)) {
  console.error("dist/cli.js not found — run `npm run build` first.");
  process.exit(2);
}

const { evaluateTask, summarize } = await import(join(repoRoot, "dist", "index.js"));
const tasks = JSON.parse(readFileSync(join(here, "tasks.json"), "utf-8"));
const TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS || 120000);

function runCli(prompt, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, "run", "--json", "--permission-mode", "yolo", prompt], {
      cwd,
      env: process.env,
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ out, err, code });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ out, err: String(e), code: -1 });
    });
  });
}

const results = [];
for (const task of tasks) {
  const dir = mkdtempSync(join(tmpdir(), `sentinel-eval-${task.id}-`));
  try {
    for (const [rel, content] of Object.entries(task.fixture || {})) {
      const p = join(dir, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
    const started = Date.now();
    const { out, err, code } = await runCli(task.prompt, dir);
    const durationMs = Date.now() - started;

    const ctx = {
      output: out + "\n" + err,
      fileExists: (p) => existsSync(join(dir, p)),
      readFile: (p) => (existsSync(join(dir, p)) ? readFileSync(join(dir, p), "utf-8") : null),
    };
    const meta = { durationMs, error: code === 0 ? undefined : `cli exited ${code}` };
    results.push(evaluateTask(task, ctx, meta));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("\n  Sentinel Agent Evals\n  " + "─".repeat(50));
for (const r of results) {
  const mark = r.passed ? "PASS" : "FAIL";
  console.log(`  [${mark}] ${r.id}${r.durationMs ? `  (${(r.durationMs / 1000).toFixed(1)}s)` : ""}`);
  if (!r.passed) {
    if (r.error) console.log(`         ! ${r.error}`);
    for (const c of r.checks.filter((c) => !c.passed)) console.log(`         - ${c.detail}`);
  }
}
const s = summarize(results);
console.log("  " + "─".repeat(50));
console.log(`  ${s.passed}/${s.total} passed  (pass rate ${(s.passRate * 100).toFixed(0)}%)\n`);
process.exit(s.failed > 0 ? 1 : 0);
