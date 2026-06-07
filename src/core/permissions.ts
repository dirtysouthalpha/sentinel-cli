import { resolve, isAbsolute, relative } from "path";

/**
 * Permission enforcement for tool calls. Until R2 the agent ran every tool with
 * zero gating (pure YOLO). This engine resolves an allow/deny/ask decision from
 * a mode + the user's `permissions` config, so callers can enforce guardrails.
 *
 * Design: pure + UI-agnostic. `evaluate()` returns a Decision; the CALLER turns
 * an "ask" into allow/deny (interactive prompt in the TUI, a flag headless).
 */

export type PermissionMode = "yolo" | "auto" | "gated";
export type Decision = "allow" | "deny" | "ask";
export type ToolCategory = "read" | "edit" | "bash" | "network" | "git" | "other";

/** Mirrors the `permissions` block of SentinelConfig (kept structural to avoid a core/types import cycle). */
export interface PermissionsConfigLike {
  bash?: Decision;
  edit?: Decision | Record<string, Decision>;
  read?: Decision;
  network?: Decision;
  git?: Decision;
  [key: string]: unknown;
}

export interface PermissionRequest {
  tool: string; // file | bash | search | git | web | patch | browser | ...
  action?: string; // e.g. file action: read|write|edit|delete|mkdir|...
  path?: string; // target path for edit/read categories
  command?: string; // bash command text
}

export interface PermissionResult {
  decision: Decision;
  category: ToolCategory;
  reason: string;
}

const READ_FILE_ACTIONS = new Set(["read", "exists", "list", "preview"]);
const READ_GIT_ACTIONS = new Set(["status", "log", "diff", "branch", "show", "blame"]);

export function categorize(req: PermissionRequest): ToolCategory {
  switch (req.tool) {
    case "file":
      return READ_FILE_ACTIONS.has(req.action ?? "") ? "read" : "edit";
    case "patch":
      return "edit";
    case "search":
      return "read";
    case "git":
      return READ_GIT_ACTIONS.has(req.action ?? "") ? "read" : "git";
    case "web":
    case "browser":
      return "network";
    case "bash":
      return "bash";
    default:
      return "other";
  }
}

// Mode defaults, used when the config does not pin a category.
const MODE_DEFAULTS: Record<PermissionMode, Record<ToolCategory, Decision>> = {
  yolo: { read: "allow", edit: "allow", bash: "allow", network: "allow", git: "allow", other: "allow" },
  auto: { read: "allow", edit: "allow", bash: "ask", network: "allow", git: "ask", other: "ask" },
  gated: { read: "allow", edit: "ask", bash: "ask", network: "ask", git: "ask", other: "ask" },
};

/** Convert a simple glob (supporting ** and *) to a RegExp anchored to the whole string. */
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++; // collapse `**/`
      } else {
        re += "[^/]*";
      }
    } else if ("\\^$+?.()|[]{}".includes(ch)) {
      re += "\\" + ch;
    } else {
      re += ch;
    }
  }
  return new RegExp(`^${re}$`);
}

export class PermissionEngine {
  constructor(
    private readonly mode: PermissionMode,
    private readonly config: PermissionsConfigLike,
    private readonly projectRoot: string
  ) {}

  /** Path is inside the project root (edits outside are riskier). */
  private inProject(path?: string): boolean {
    if (!path) return true;
    const abs = isAbsolute(path) ? path : resolve(this.projectRoot, path);
    const rel = relative(this.projectRoot, abs);
    return !rel.startsWith("..") && !isAbsolute(rel);
  }

  /** Resolve the configured decision for the `edit` category against a path-glob map. */
  private editConfigDecision(path?: string): Decision | undefined {
    const edit = this.config.edit;
    if (!edit) return undefined;
    if (typeof edit === "string") return edit;
    // Glob map: first matching pattern wins; "*" / "**" are catch-alls.
    const rel = path
      ? (isAbsolute(path) ? relative(this.projectRoot, path) : path).replace(/\\/g, "/")
      : "";
    for (const [pattern, decision] of Object.entries(edit)) {
      if (pattern === "*" || pattern === "**") continue;
      if (rel && globToRegExp(pattern).test(rel)) return decision;
    }
    return edit["**"] ?? edit["*"];
  }

  private configDecision(category: ToolCategory, req: PermissionRequest): Decision | undefined {
    switch (category) {
      case "read":
        return this.config.read;
      case "edit":
        return this.editConfigDecision(req.path);
      case "bash":
        return this.config.bash;
      case "network":
        return this.config.network;
      case "git":
        return this.config.git;
      default:
        return undefined;
    }
  }

  evaluate(req: PermissionRequest): PermissionResult {
    const category = categorize(req);

    if (this.mode === "yolo") {
      return { decision: "allow", category, reason: "yolo mode" };
    }

    // Config rules take precedence over the mode default.
    const configured = this.configDecision(category, req);
    let decision = configured ?? MODE_DEFAULTS[this.mode][category];
    let reason = configured ? `config.${category}` : `${this.mode} default`;

    // Edits outside the project escalate allow -> ask.
    if (category === "edit" && decision === "allow" && !this.inProject(req.path)) {
      decision = "ask";
      reason = "edit outside project root";
    }

    return { decision, category, reason };
  }
}

/** Build a PermissionRequest from a raw tool call (name + parsed args). */
export function toPermissionRequest(tool: string, args: Record<string, unknown>): PermissionRequest {
  return {
    tool,
    action: typeof args.action === "string" ? args.action : undefined,
    path: typeof args.path === "string" ? args.path : undefined,
    command: typeof args.command === "string" ? args.command : undefined,
  };
}
