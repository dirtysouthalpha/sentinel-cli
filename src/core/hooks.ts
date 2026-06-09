import { exec } from "node:child_process";
import { ChatMessage, ToolCall } from "../ai/types.js";

/**
 * V7 hooks — user-defined shell commands that fire around tool calls
 * (Claude Code-style). A hook is a shell command that runs before
 * (`preToolUse`) and/or after (`postToolUse`) a tool executes. Hooks are
 * observational side-channels: their failures NEVER break the tool call.
 *
 * Layering mirrors the other executor wrappers (mcp/subagent/todo/guarded):
 * `createHookAwareExecutor` wraps a base executor and is composed as the
 * OUTERMOST layer so it sees every tool call (built-in, MCP, subagent, todo).
 *
 * The shell runner is injected (`runShell`) so tests can supply a fake; the
 * real one (`defaultRunShell`) shells out via child_process.
 */

/** A single hook: run `command` when the tool name matches `match`. */
export interface HookRule {
  /** Substring/regex tested against the tool name. Absent = match all tools. */
  match?: string;
  /** Shell command to run. */
  command: string;
}

export interface HooksConfig {
  /** Commands to run BEFORE a matching tool executes. */
  preToolUse?: HookRule[];
  /** Commands to run AFTER a matching tool executes. */
  postToolUse?: HookRule[];
}

/** True if `rule` applies to a tool named `toolName`. */
function ruleMatches(rule: HookRule, toolName: string): boolean {
  if (rule.match === undefined || rule.match === "") return true;
  try {
    return new RegExp(rule.match).test(toolName);
  } catch {
    // Not a valid regex — fall back to a plain substring test.
    return toolName.includes(rule.match);
  }
}

/**
 * Run every rule that matches `toolName`, passing the tool name/args as env.
 * Hook failures are swallowed so they can never break the surrounding tool call.
 */
async function runMatching(
  rules: HookRule[] | undefined,
  toolName: string,
  toolArgs: string,
  runShell: (cmd: string, env: Record<string, string>) => Promise<void>
): Promise<void> {
  if (!rules || rules.length === 0) return;
  const env = { SENTINEL_TOOL_NAME: toolName, SENTINEL_TOOL_ARGS: toolArgs };
  for (const rule of rules) {
    if (!ruleMatches(rule, toolName)) continue;
    try {
      await runShell(rule.command, env);
    } catch {
      // Hooks are best-effort; never block or fail the tool call on them.
    }
  }
}

/**
 * Wrap a base tool executor so configured shell hooks fire before and after
 * each tool call. Returns a drop-in `executeTool` dependency. Compose this as
 * the OUTERMOST executor layer so hooks observe every tool call.
 */
export function createHookAwareExecutor(
  hooks: HooksConfig,
  baseExecute: (tc: ToolCall) => Promise<ChatMessage>,
  runShell: (cmd: string, env: Record<string, string>) => Promise<void>
): (tc: ToolCall) => Promise<ChatMessage> {
  return async (tc: ToolCall): Promise<ChatMessage> => {
    await runMatching(hooks.preToolUse, tc.name, tc.arguments, runShell);
    const result = await baseExecute(tc);
    await runMatching(hooks.postToolUse, tc.name, tc.arguments, runShell);
    return result;
  };
}

/**
 * Real shell runner: executes `cmd` via the platform shell (PowerShell on
 * win32, bash elsewhere) with the given env merged onto the process env.
 * Kept separate from the wrapper so tests can inject a fake.
 */
export function defaultRunShell(cmd: string, env: Record<string, string>): Promise<void> {
  const isWin = process.platform === "win32";
  const shell = isWin ? "powershell.exe" : "/bin/bash";
  return new Promise<void>((resolve, reject) => {
    exec(
      cmd,
      { shell, env: { ...process.env, ...env }, windowsHide: true },
      (error) => {
        if (error) reject(error);
        else resolve();
      }
    );
  });
}
