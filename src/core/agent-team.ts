/**
 * Team coordinator — fan N tasks out across isolated git worktrees, run them in
 * parallel, collect results, merge branches back, clean up.
 *
 * This replaces the v1.2 team.ts CRUD stub with real multi-agent coordination.
 * Each task gets its own worktree (own branch, own working tree) so parallel
 * agents can't race on shared files. Results merge back into the base branch;
 * conflicts are reported, not force-resolved.
 *
 * DESIGN — why everything is injected:
 * The orchestration logic (fan-out, Promise.all, ordered collection, merge +
 * cleanup ordering, conflict reporting) is the valuable part and is fully
 * testable with fake worktree + fake subagent runners. Production wires in the
 * real WorktreeManager + the subagent tool; tests wire in fakes. No subprocess,
 * no provider, no real git — pure coordination.
 */

import type { WorktreeManager, WorktreeResult } from "./worktree.js";

/** One unit of parallel work: a branch name + a prompt for the subagent. */
export interface TeamTask {
  /** Branch name (also names the worktree dir). Must be a valid git branch. */
  branch: string;
  /** The task prompt the subagent executes inside this worktree. */
  prompt: string;
}

/** Result of one task's execution. */
export interface TeamTaskResult {
  branch: string;
  ok: boolean;
  /** The subagent's final text output, when it ran. */
  output?: string;
  /** Failure reason (subagent error, merge conflict, etc.). */
  error?: string;
  /** True when the merge back had conflicts the user must resolve. */
  conflict?: boolean;
}

/** Injectable subagent runner. Production = the real subagent tool. */
export type RunSubagent = (prompt: string, worktreePath: string) => Promise<{ ok: boolean; output?: string; error?: string }>;

/** Injectable worktree ops. Production = WorktreeManager; tests = a fake. */
export interface WorktreeOps {
  add(branch: string): Promise<WorktreeResult>;
  remove(branch: string, force?: boolean): Promise<WorktreeResult>;
  merge(branch: string): Promise<WorktreeResult>;
}

/** Run a single task: create worktree → run subagent → (merge is deferred). */
async function runOne(
  task: TeamTask,
  runSubagent: RunSubagent,
  wt: WorktreeOps
): Promise<{ result: TeamTaskResult; addOk: boolean }> {
  const addRes = await wt.add(task.branch);
  if (!addRes.ok || !addRes.path) {
    return {
      result: { branch: task.branch, ok: false, error: addRes.error ?? "worktree add failed" },
      addOk: false,
    };
  }
  try {
    const sub = await runSubagent(task.prompt, addRes.path);
    return {
      result: {
        branch: task.branch,
        ok: sub.ok,
        output: sub.output,
        error: sub.error,
      },
      addOk: true,
    };
  } catch (err) {
    return {
      result: {
        branch: task.branch,
        ok: false,
        error: `subagent threw: ${err instanceof Error ? err.message : String(err)}`,
      },
      addOk: true,
    };
  }
}

/**
 * Fan out N tasks in parallel, each in its own worktree. After all finish,
 * merge successful branches back SEQUENTIALLY (merges must serialize on one
 * HEAD), then clean up every worktree. Returns one result per task, in input
 * order, plus an overall summary.
 */
export async function runTeam(
  tasks: TeamTask[],
  opts: { runSubagent: RunSubagent; worktree: WorktreeOps }
): Promise<{ results: TeamTaskResult[]; merged: number; conflicts: number; failed: number }> {
  if (tasks.length === 0) {
    return { results: [], merged: 0, conflicts: 0, failed: 0 };
  }

  // v3.1 guard: filter out malformed tasks (missing branch or prompt) before
  // fanning out — they'd crash the worktree creation. Report them as failures.
  const valid: TeamTask[] = [];
  const malformed: TeamTaskResult[] = [];
  for (const t of tasks) {
    if (!t.branch || !t.prompt) {
      malformed.push({
        branch: t.branch || "(missing)",
        ok: false,
        error: "Task missing required 'branch' or 'prompt' field.",
      });
    } else {
      valid.push(t);
    }
  }
  if (valid.length === 0) {
    return { results: malformed, merged: 0, conflicts: 0, failed: malformed.length };
  }

  // Fan out: all tasks run concurrently in their own worktrees.
  const executions = await Promise.all(
    valid.map((t) => runOne(t, opts.runSubagent, opts.worktree))
  );

  // Merge successful branches back sequentially (one HEAD, can't parallelize).
  let merged = 0;
  let conflicts = 0;
  const results: TeamTaskResult[] = executions.map((e) => {
    const r = { ...e.result };
    if (e.result.ok) {
      // Defer merge to the sequential pass below; mark pending here.
      return r;
    }
    return r;
  });

  for (let i = 0; i < executions.length; i++) {
    const ex = executions[i];
    if (!ex.result.ok) continue;
    const mergeRes = await opts.worktree.merge(ex.result.branch);
    if (mergeRes.ok) {
      merged++;
      results[i].ok = true;
    } else {
      // Conflict or other merge failure — report, don't crash the others.
      const msg = mergeRes.error ?? "merge failed";
      const isConflict = /conflict|merge|CONFLICT/i.test(msg);
      results[i].ok = false;
      results[i].error = msg;
      results[i].conflict = isConflict;
      if (isConflict) conflicts++;
    }
  }

  // Cleanup: remove every worktree we created (force, since trees may be dirty).
  for (const ex of executions) {
    if (ex.addOk) {
      try {
        await opts.worktree.remove(ex.result.branch, true);
      } catch {
        // best-effort cleanup; never fail the team run on a teardown error
      }
    }
  }

  const failed = results.filter((r) => !r.ok).length + malformed.length;
  return { results: [...malformed, ...results], merged, conflicts, failed };
}

/** Adapt a WorktreeManager to the WorktreeOps interface. */
export function asWorktreeOps(wt: WorktreeManager): WorktreeOps {
  return {
    add: (b) => wt.add(b),
    remove: (b, f) => wt.remove(b, f ?? false),
    merge: (b) => wt.merge(b),
  };
}
