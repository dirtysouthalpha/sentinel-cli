import { exec } from "node:child_process";
import { pathToFileURL } from "node:url";
import type { ChatMessage, ToolCall } from "../ai/types.js";

/**
 * V7 hooks — user-defined automation that fires around the agent lifecycle.
 * Claude Code-style: shell commands (and JS modules) that run
 *
 *   - `preToolUse`  — before each tool call; may BLOCK it (`blocking: true`)
 *   - `postToolUse` — after each tool call (observational)
 *   - `onStop`      — when the agent run finishes (observational; a failing
 *                     BLOCKING rule escalates the exit code to HOOK_BLOCKED)
 *   - `sessionStart` / `sessionEnd` — process/session boundaries (shell only)
 *
 * Non-blocking hooks are pure side-channels: their failures NEVER break the
 * surrounding tool call. Blocking hooks are gates: a non-zero exit (shell) or a
 * thrown error / `{ block: true }` (JS) denies the action instead.
 *
 * Layering mirrors the other executor wrappers (mcp/subagent/todo/guarded):
 * `createHookAwareExecutor` wraps a base executor and is composed as the
 * OUTERMOST layer so it sees every tool call (built-in, MCP, subagent, todo).
 *
 * The shell runner is injected (`runShell`) so tests can supply a fake; the
 * real one (`defaultRunShell`) shells out via child_process.
 */

/** Payload handed to JS hook modules (default export). */
export interface HookPayload {
  event: "preToolUse" | "postToolUse" | "onStop" | "sessionStart" | "sessionEnd";
  toolName?: string;
  toolArgs?: string;
  stopReason?: string;
  exitCode?: number;
}

/** What a JS hook module's default export may return. */
export type HookModuleResult = void | "block" | { block?: boolean; reason?: string };

export type HookModule = (payload: HookPayload) => HookModuleResult | Promise<HookModuleResult>;

/** A single hook: run `command` (shell) or `script` (JS module) when it applies. */
export interface HookRule {
  /** Substring/regex tested against the tool name. Absent = match all tools. */
  match?: string;
  /** Shell command to run. */
  command?: string;
  /**
   * Path to a JS/ESM module whose default export receives a {@link HookPayload}.
   * Takes precedence over `command` when both are set.
   */
  script?: string;
  /**
   * preToolUse/onStop only: a failing hook DENIES the tool call (or escalates
   * the run's exit code to HOOK_BLOCKED) instead of being swallowed.
   */
  blocking?: boolean;
}

export interface HooksConfig {
  /** Commands to run BEFORE a matching tool executes. */
  preToolUse?: HookRule[];
  /** Commands to run AFTER a matching tool executes. */
  postToolUse?: HookRule[];
  /** Run when the agent finishes (final answer / stop reason). */
  onStop?: HookRule[];
  /** Shell commands run once when a session/process starts. */
  sessionStart?: string[];
  /** Shell commands run once when a session/process ends. */
  sessionEnd?: string[];
}

/** Outcome of firing one rule: ok, failed (swallowed), or blocked (gate hit). */
type FireOutcome = "ok" | "failed" | "blocked";

const OUTCOME_RANK: Record<FireOutcome, number> = { ok: 0, failed: 1, blocked: 2 };

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

function payloadEnv(payload: HookPayload): Record<string, string> {
  const env: Record<string, string> = { SENTINEL_HOOK_EVENT: payload.event };
  if (payload.toolName !== undefined) env.SENTINEL_TOOL_NAME = payload.toolName;
  if (payload.toolArgs !== undefined) env.SENTINEL_TOOL_ARGS = payload.toolArgs;
  if (payload.stopReason !== undefined) env.SENTINEL_STOP_REASON = payload.stopReason;
  if (payload.exitCode !== undefined) env.SENTINEL_EXIT_CODE = String(payload.exitCode);
  return env;
}

/**
 * Load a JS hook module. Dynamic import is required: the script path is a
 * runtime-selected user file, not a known-at-build-time dependency.
 */
async function defaultLoadModule(path: string): Promise<HookModule> {
  const mod = (await import(pathToFileURL(path).href)) as { default?: unknown };
  if (typeof mod.default !== "function") {
    throw new Error(`hook script ${path} has no default export function`);
  }
  return mod.default as HookModule;
}

/**
 * Fire a single rule. Shell rules fail on non-zero exit; JS rules fail on
 * throw and block on an explicit block result. Never throws.
 */
async function fireRule(
  rule: HookRule,
  payload: HookPayload,
  runShell: (cmd: string, env: Record<string, string>) => Promise<void>,
  loadModule: (path: string) => Promise<HookModule>
): Promise<FireOutcome> {
  try {
    if (rule.script) {
      const hook = await loadModule(rule.script);
      const res = await hook(payload);
      const wantsBlock = res === "block" || (typeof res === "object" && res !== null && res.block === true);
      if (!wantsBlock) return "ok";
      if (rule.blocking) return "blocked";
      const reason = typeof res === "object" && res !== null && res.reason ? res.reason : "blocked";
      console.error(`[hook] ${reason} (non-blocking script hook; run continued)`);
      return "ok";
    }
    if (rule.command) {
      await runShell(rule.command, payloadEnv(payload));
      return "ok";
    }
    return "ok";
  } catch {
    // Failure semantics: observational hooks swallow; gates trip.
    return rule.blocking ? "blocked" : "failed";
  }
}

/**
 * Run every rule that matches `toolName`. Returns the worst outcome seen
 * ("blocked" beats "failed" beats "ok").
 */
async function runMatching(
  rules: HookRule[] | undefined,
  event: HookPayload["event"],
  toolName: string,
  toolArgs: string,
  runShell: (cmd: string, env: Record<string, string>) => Promise<void>,
  loadModule: (path: string) => Promise<HookModule>
): Promise<FireOutcome> {
  if (!rules || rules.length === 0) return "ok";
  let worst: FireOutcome = "ok";
  for (const rule of rules) {
    if (event !== "onStop" && !ruleMatches(rule, toolName)) continue;
    const outcome = await fireRule(rule, { event, toolName, toolArgs }, runShell, loadModule);
    if (OUTCOME_RANK[outcome] > OUTCOME_RANK[worst]) worst = outcome;
  }
  return worst;
}

/**
 * Wrap a base tool executor so configured hooks fire before and after each
 * tool call. Returns a drop-in `executeTool` dependency. Compose this as the
 * OUTERMOST executor layer so hooks observe every tool call.
 *
 * A blocking preToolUse hook that fails DENIES the call: the tool never runs
 * and the agent receives a "blocked by hook" error result it can react to
 * (the pre-commit-gate use case).
 */
export function createHookAwareExecutor(
  hooks: HooksConfig,
  baseExecute: (tc: ToolCall) => Promise<ChatMessage>,
  runShell: (cmd: string, env: Record<string, string>) => Promise<void>,
  loadModule: (path: string) => Promise<HookModule> = defaultLoadModule
): (tc: ToolCall) => Promise<ChatMessage> {
  return async (tc: ToolCall): Promise<ChatMessage> => {
    const pre = await runMatching(hooks.preToolUse, "preToolUse", tc.name, tc.arguments, runShell, loadModule);
    if (pre === "blocked") {
      return {
        role: "tool",
        content:
          `ERROR: tool "${tc.name}" was blocked by a blocking preToolUse hook ` +
          `(non-zero exit or explicit block). Fix what the hook checks, or drop ` +
          `\`blocking\` from the hook config.`,
        toolCallId: tc.id,
        name: tc.name,
      };
    }
    const result = await baseExecute(tc);
    await runMatching(hooks.postToolUse, "postToolUse", tc.name, tc.arguments, runShell, loadModule);
    return result;
  };
}

/**
 * Fire onStop hooks after a run finishes, with the stop reason and provisional
 * exit code in scope (env vars for shell rules; payload for JS rules).
 * Observational failures change nothing; a failing BLOCKING rule reports true,
 * which the caller escalates to EXIT_CODES.HOOK_BLOCKED.
 */
export async function runOnStopHooks(
  hooks: HooksConfig,
  stopReason: string,
  exitCode: number,
  runShell: (cmd: string, env: Record<string, string>) => Promise<void>,
  loadModule: (path: string) => Promise<HookModule> = defaultLoadModule
): Promise<boolean> {
  if (!hooks.onStop || hooks.onStop.length === 0) return false;
  let blocked = false;
  for (const rule of hooks.onStop) {
    const outcome = await fireRule(rule, { event: "onStop", stopReason, exitCode }, runShell, loadModule);
    if (outcome === "blocked") blocked = true;
  }
  return blocked;
}

/**
 * Fire sessionStart/sessionEnd shell commands once per process. Failures are
 * swallowed (observational). Env carries the hook event plus caller-supplied
 * context (project root; exit code for sessionEnd).
 */
export async function runSessionHooks(
  hooks: HooksConfig,
  kind: "sessionStart" | "sessionEnd",
  env: Record<string, string>,
  runShell: (cmd: string, env: Record<string, string>) => Promise<void> = defaultRunShell
): Promise<void> {
  const cmds = kind === "sessionStart" ? hooks.sessionStart : hooks.sessionEnd;
  if (!cmds || cmds.length === 0) return;
  for (const cmd of cmds) {
    try {
      await runShell(cmd, { SENTINEL_HOOK_EVENT: kind, ...env });
    } catch {
      // Session hooks are best-effort; never block startup/teardown.
    }
  }
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
