/**
 * Deterministic project-verification helpers used by the autonomous loop as its
 * objective production gate. Kept separate from the loop so both the TUI and the
 * headless CLI share one implementation, and so the command-resolution logic is
 * unit-testable without spawning anything.
 */
import { exec } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

export interface VerifyResult {
  passed: boolean;
  summary: string;
}

/**
 * Resolve the commands that constitute "the checks": an explicit override, else
 * the lint/test/build scripts detected in the project's package.json. Pure.
 */
export function resolveVerifyCommands(projectRoot: string, override?: string[]): string[] {
  if (override && override.length) return override;
  try {
    const pkgPath = join(projectRoot, "package.json");
    if (!existsSync(pkgPath)) return [];
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    const cmds: string[] = [];
    if (scripts.lint) cmds.push("npm run lint");
    if (scripts.test) cmds.push("npm test");
    if (scripts.build) cmds.push("npm run build");
    return cmds;
  } catch {
    return [];
  }
}

function shExitCode(cmd: string, cwd: string): Promise<number> {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout: 600000, maxBuffer: 20 * 1024 * 1024 }, (err) => {
      const c = err as (Error & { code?: number }) | null;
      resolve(c && typeof c.code === "number" ? c.code : c ? 1 : 0);
    });
  });
}

/** Run every verify command in the project root; passes only if all exit 0. */
export async function runVerifyCommands(
  projectRoot: string,
  commands: string[],
  isAborted: () => boolean = () => false
): Promise<VerifyResult> {
  if (!commands.length) return { passed: true, summary: "no verify commands configured" };
  const parts: string[] = [];
  let passed = true;
  for (const cmd of commands) {
    if (isAborted()) return { passed: false, summary: "cancelled" };
    const code = await shExitCode(cmd, projectRoot);
    parts.push(`${cmd} → ${code === 0 ? "ok" : `exit ${code}`}`);
    if (code !== 0) passed = false;
  }
  return { passed, summary: parts.join("; ") };
}

/**
 * Hash of the working tree (git HEAD + porcelain) for stall detection. Returns
 * null when it's not a git repo, so the caller treats the iteration as changed.
 */
export function workingTreeHash(projectRoot: string): Promise<string | null> {
  return new Promise((resolve) => {
    exec(
      "git rev-parse HEAD && git status --porcelain",
      { cwd: projectRoot, timeout: 30000, maxBuffer: 20 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : stdout)
    );
  });
}
