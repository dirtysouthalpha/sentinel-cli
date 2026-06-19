/**
 * GitHub PR tool — pure argv builders + conflict extraction + a gh runner seam.
 *
 * Same pattern as worktree.ts: the valuable logic (argv shaping, conflict
 * parsing) is pure and testable; the actual `gh` subprocess is injected so tests
 * run without GitHub. Production wires in a real execFile runner.
 *
 * This replaces the old /pr slash command that shelled `gh` blindly via bash —
 * now PR creation is a first-class tool with auth checks, structured output,
 * and conflict detection.
 */

/** Injectable gh executor. Production = execFile; tests = a fake. */
export interface GhRunner {
  run(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }>;
}

export interface ConflictHunk {
  file: string;
  ours: string;
  theirs: string;
}

// --- Pure argv builders -----------------------------------------------------

/** `gh pr create [--draft] [--label x,y] [--assignee a]` */
export function buildPrCreateArgs(
  title: string,
  body: string,
  draft = false,
  labels?: string[],
  assignees?: string[]
): string[] {
  const args = ["pr", "create", "--title", title, "--body", body];
  if (draft) args.push("--draft");
  if (labels && labels.length > 0) args.push("--label", labels.join(","));
  if (assignees && assignees.length > 0) args.push("--assignee", assignees.join(","));
  return args;
}

/** `gh pr list [--limit N]` */
export function buildPrListArgs(limit?: number): string[] {
  const args = ["pr", "list"];
  if (limit) args.push("--limit", String(limit));
  return args;
}

/** `gh pr merge <n> [--squash|--merge|--rebase] [--delete-branch]` */
export function buildPrMergeArgs(
  number: number,
  strategy: "squash" | "merge" | "rebase" = "squash",
  deleteBranch = false
): string[] {
  const args = ["pr", "merge", String(number), `--${strategy}`];
  if (deleteBranch) args.push("--delete-branch");
  return args;
}

/** `gh pr view <n> --json number,title,state,url,body,additions,deletions` */
export function buildPrViewArgs(number: number): string[] {
  return ["pr", "view", String(number), "--json", "number,title,state,url,body,additions,deletions"];
}

// --- Conflict extraction (pure) --------------------------------------------

/**
 * Parse `<<<<<<< ======= >>>>>>>` conflict markers from file content into
 * structured hunks the model can reason about. Returns one hunk per conflict
 * region, each with the "ours" and "theirs" text separated out.
 */
export function buildConflictHunks(fileContent: string, filePath: string): ConflictHunk[] {
  const hunks: ConflictHunk[] = [];
  const lines = fileContent.split("\n");
  let i = 0;
  while (i < lines.length) {
    if (lines[i].startsWith("<<<<<<< ")) {
      const ours: string[] = [];
      const theirs: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("=======")) {
        ours.push(lines[i]);
        i++;
      }
      i++; // skip the ======= line
      while (i < lines.length && !lines[i].startsWith(">>>>>>> ")) {
        theirs.push(lines[i]);
        i++;
      }
      i++; // skip the >>>>>>> line
      hunks.push({ file: filePath, ours: ours.join("\n"), theirs: theirs.join("\n") });
    } else {
      i++;
    }
  }
  return hunks;
}

// --- The runner wrapper (uses the injected GhRunner) ------------------------

export interface PrResult {
  ok: boolean;
  /** The PR URL on create, JSON on view, list text on list. */
  output?: string;
  error?: string;
}

/** Check whether `gh` is installed and authenticated. */
export async function ghAvailable(runner: GhRunner): Promise<boolean> {
  try {
    const res = await runner.run(["auth", "status"]);
    return res.ok;
  } catch {
    return false;
  }
}

/** Create a PR via `gh`. Returns the PR URL on success. */
export async function createPr(
  runner: GhRunner,
  title: string,
  body: string,
  opts: { draft?: boolean; labels?: string[]; assignees?: string[] } = {}
): Promise<PrResult> {
  if (!(await ghAvailable(runner))) {
    return { ok: false, error: "gh is not authenticated. Run 'gh auth login' first." };
  }
  const res = await runner.run(
    buildPrCreateArgs(title, body, opts.draft, opts.labels, opts.assignees)
  );
  if (!res.ok) return { ok: false, error: res.stderr || "gh pr create failed" };
  // gh prints the PR URL to stdout on success.
  const urlMatch = res.stdout.match(/https:\/\/\S+\/pull\/\d+/);
  return { ok: true, output: urlMatch ? urlMatch[0] : res.stdout.trim() };
}
