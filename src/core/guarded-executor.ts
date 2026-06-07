import { ChatMessage, ToolCall } from "../ai/types.js";
import { PermissionEngine, toPermissionRequest, PermissionRequest } from "./permissions.js";
import { CheckpointManager } from "./checkpoints.js";

/**
 * Wraps a tool executor with permission gating + checkpointing. The AgentRunner
 * stays generic: callers pass `createGuardedExecutor(...)` as the `executeTool`
 * dependency and get enforcement for free.
 */
export interface GuardOptions {
  engine: PermissionEngine;
  checkpoints?: CheckpointManager;
  /** Resolve an "ask" decision: true = allow, false = deny. Interactive in the TUI; a flag headless. */
  ask: (req: PermissionRequest, reason: string) => Promise<boolean>;
  /** Underlying executor (normally executeToolCall from tools/tool-executor.js). */
  baseExecute: (tc: ToolCall) => Promise<ChatMessage>;
}

const EDIT_TOOLS = new Set(["file", "patch"]);
const MUTATING_FILE_ACTIONS = new Set(["write", "edit", "delete", "mkdir"]);

export function createGuardedExecutor(opts: GuardOptions): (tc: ToolCall) => Promise<ChatMessage> {
  return async (tc: ToolCall): Promise<ChatMessage> => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.arguments) as Record<string, unknown>;
    } catch {
      // leave args empty; permission still evaluated on the tool name
    }

    const req = toPermissionRequest(tc.name, args);
    const result = opts.engine.evaluate(req);

    let allowed: boolean;
    if (result.decision === "allow") allowed = true;
    else if (result.decision === "deny") allowed = false;
    else allowed = await opts.ask(req, result.reason);

    if (!allowed) {
      // Surface denial back to the model as a tool error so it can adapt.
      return {
        role: "tool",
        content: `ERROR: Permission denied for ${tc.name}${req.action ? ` (${req.action})` : ""} — ${result.reason}.`,
        toolCallId: tc.id,
        name: tc.name,
      };
    }

    // Snapshot a file mutation before it happens so it can be undone.
    if (opts.checkpoints && EDIT_TOOLS.has(tc.name)) {
      const path = typeof args.path === "string" ? args.path : undefined;
      const action = typeof args.action === "string" ? args.action : "edit";
      if (path && (tc.name === "patch" || MUTATING_FILE_ACTIONS.has(action))) {
        try {
          opts.checkpoints.snapshot(path, tc.name, action);
        } catch {
          // checkpointing is best-effort; never block the tool on it
        }
      }
    }

    return opts.baseExecute(tc);
  };
}
