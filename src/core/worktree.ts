/**
 * Git worktree lifecycle — pure argv builders + a thin manager over an injected
 * git runner.
 *
 * Why this design: parallel multi-agent teams need ISOLATION. Two agents
 * editing one working tree race on every `patch`. Git worktrees give each
 * agent its own checkout on its own branch; results merge back. The valuable,
 * testable logic is the argv shaping (which flags, what order); the actual
 * subprocess is injected, so we test without touching a real repo.
 *
 * This mirrors the LSP client / sandbox pattern: pure decisions at the core,
 * I/O at the edges.
 */

/** Injectable git executor. Production = child_process; tests = a fake. */
export interface GitRunner {
  run(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }>;
}

/** Result of a worktree operation. */
export interface WorktreeResult {
  ok: boolean;
  /** Absolute path of the worktree (for add), when applicable. */
  path?: string;
  error?: string;
}

// --- Pure argv builders -----------------------------------------------------

/** `git -C <repo> worktree add [-b <branch>] <path>` */
export function buildAddWorktreeArgs(
  repoRoot: string,
  branch: string | undefined,
  worktreePath: string
): string[] {
  const base = ["-C", repoRoot, "worktree", "add"];
  if (branch) return [...base, "-b", branch, worktreePath];
  return [...base, worktreePath];
}

/** `git -C <repo> worktree remove [--force] <path>` */
export function buildRemoveWorktreeArgs(
  repoRoot: string,
  worktreePath: string,
  force = false
): string[] {
  const base = ["-C", repoRoot, "worktree", "remove"];
  if (force) base.push("--force");
  return [...base, worktreePath];
}

/** `git -C <repo> worktree list --porcelain` */
export function buildListWorktreeArgs(repoRoot: string): string[] {
  return ["-C", repoRoot, "worktree", "list", "--porcelain"];
}

/** `git -C <repo> merge --no-ff -m <msg> <branch>` */
export function buildMergeBranchArgs(repoRoot: string, branch: string): string[] {
  return ["-C", repoRoot, "merge", "--no-ff", "-m", `Merge branch '${branch}'`, branch];
}

// --- Manager: lifecycle over the injected runner ----------------------------

/**
 * Owns the worktree parent dir and builds paths deterministically:
 * `<parentDir>/<branch>`. The parent is usually `<repoRoot>/.sentinel/worktrees`
 * so worktrees live alongside the repo but are easily gitignored.
 */
export class WorktreeManager {
  constructor(
    private readonly repoRoot: string,
    private readonly git: GitRunner,
    private readonly parentDir: string
  ) {}

  /** Resolve the worktree path for a branch name. */
  pathFor(branch: string): string {
    return `${this.parentDir}/${branch}`;
  }

  /** Create a worktree on a new branch. Returns its absolute path on success. */
  async add(branch: string): Promise<WorktreeResult> {
    const path = this.pathFor(branch);
    const res = await this.git.run(buildAddWorktreeArgs(this.repoRoot, branch, path));
    if (!res.ok) return { ok: false, error: res.stderr || "git worktree add failed" };
    return { ok: true, path };
  }

  /** Remove a worktree. `force` for dirty trees (e.g. cleanup after a failed run). */
  async remove(branch: string, force = false): Promise<WorktreeResult> {
    const path = this.pathFor(branch);
    const res = await this.git.run(buildRemoveWorktreeArgs(this.repoRoot, path, force));
    if (!res.ok) return { ok: false, error: res.stderr || "git worktree remove failed" };
    return { ok: true, path };
  }

  /** Merge a branch back into the current HEAD of repoRoot (--no-ff). */
  async merge(branch: string): Promise<WorktreeResult> {
    const res = await this.git.run(buildMergeBranchArgs(this.repoRoot, branch));
    if (!res.ok) return { ok: false, error: res.stderr || "git merge failed" };
    return { ok: true };
  }
}
