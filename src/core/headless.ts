import type { AIProvider } from "../ai/types.js";
import type { AgentRunResult } from "./agent-runner.js";
import type { AutonomousConfig } from "./types.js";
import type { ExitCode, StopReason } from "./exit-codes.js";
import type { PermissionMode } from "./permissions.js";
import { providerManager } from "../ai/provider.js";
import { RoutedProvider } from "../ai/routed-provider.js";
import { getConfigManager } from "./config.js";
import { contextManager } from "../ai/context.js";
import { getToolDefinitions, executeToolCall } from "../tools/tool-executor.js";
import { toolManager } from "../tools/index.js";
import { AgentRunner } from "./agent-runner.js";
import { extractToolCalls } from "./tool-call-extractor.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { compactionBudget } from "./context-window.js";
import { runDiagnostics, formatDiagnostics } from "./diagnostics.js";
import { usageTracker } from "./usage-tracker.js";
import { expandMentions } from "./mentions.js";
import { recallRelevant, DEFAULT_RECALL_TOOL } from "./brain-recall.js";
import { PermissionEngine, PermissionRequest } from "./permissions.js";
import { CheckpointManager } from "./checkpoints.js";
import { createGuardedExecutor } from "./guarded-executor.js";
import { createSubagentTool, createSubagentAwareExecutor } from "./subagent.js";
import { createTodoTool, createTodoAwareExecutor } from "./todos.js";
import { createHookAwareExecutor, defaultRunShell, runOnStopHooks, runSessionHooks } from "./hooks.js";
import type { HooksConfig, HookModule } from "./hooks.js";
import { MCPManager } from "../mcp/manager.js";
import { createMcpAwareExecutor } from "../mcp/mcp-executor.js";
import { loadRegistries } from "./bootstrap.js";
import { EXIT_CODES, resolveExitCode } from "./exit-codes.js";

/**
 * V7 — the headless/CI runner behind `sentinel run` and `sentinel -p`.
 *
 * Extracted from the old inline `run` command action so the whole non-
 * interactive path is importable (`src/index.ts` SDK surface) and testable
 * without a CLI harness. The wiring below is intentionally identical to the
 * TUI path: same guarded executor stack, same subagent/todo/hook layers, same
 * MCP merge, same compaction and verification hooks.
 */

export interface HeadlessOptions {
  task: string;
  projectRoot: string;
  /** provider/model string ("zai/glm-4.6"). Defaults to config. */
  model?: string;
  /** Agent persona (defaults to config default_agent). */
  agent?: string;
  /** Max tool rounds (--max-steps). */
  maxSteps?: number;
  /** NDJSON event stream instead of human text. */
  json?: boolean;
  /** Emit only the final result. */
  quiet?: boolean;
  permissionMode?: PermissionMode;
  /** Auto-approve permission prompts (non-interactive --yes). */
  autoApprove?: boolean;
  signal?: AbortSignal;
  /** Skip MCP connect (tests / offline runs). Default: connect from config. */
  connectMcp?: boolean;
  /** Pre-built provider — test seam that bypasses providerManager/router. */
  provider?: AIProvider;
  /** Model name passed to the provider. */
  modelName?: string;
  /** Install root for skill/command/agent registries. */
  installRoot?: string;
  /** Output seams (default: console / process streams). */
  emitLine?: (line: string) => void;
  writeStdout?: (s: string) => void;
  writeStderr?: (s: string) => void;
  /** Hook seams. */
  runShell?: (cmd: string, env: Record<string, string>) => Promise<void>;
  loadHookModule?: (path: string) => Promise<HookModule>;
}

export interface HeadlessOutcome {
  exitCode: ExitCode;
  stopReason: StopReason | "config_error";
  rounds: number;
  finalContent: string;
  usage: AgentRunResult["usage"];
  configError?: string;
}

export async function runHeadless(opts: HeadlessOptions): Promise<HeadlessOutcome> {
  const emitLine = opts.emitLine ?? ((line: string) => console.log(line));
  const writeStdout = opts.writeStdout ?? ((s: string) => process.stdout.write(s));
  const writeStderr = opts.writeStderr ?? ((s: string) => console.error(s));
  const json = !!opts.json;
  const quiet = !!opts.quiet;

  const config = getConfigManager(opts.projectRoot).load();
  providerManager.initializeFromConfig(config.provider as never, {
    sentinelProxy: config.sentinelProxy,
    headroom: config.headroom,
  });
  toolManager.initialize(opts.projectRoot);
  loadRegistries(opts.installRoot ?? process.cwd(), config.skills.paths);

  const agentName = opts.agent || config.default_agent;

  // Provider resolution: explicit override > config router > config model.
  let provider: AIProvider | undefined = opts.provider;
  let modelName: string | undefined = opts.modelName;
  if (!provider) {
    if (config.router && !opts.model) {
      provider = new RoutedProvider(config.router, agentName);
    } else {
      const model = opts.model || config.model;
      const parts = model.split("/");
      modelName = parts.slice(1).join("/") || undefined;
      const single = providerManager.getProvider(parts[0]);
      if (!single || !single.isAvailable()) {
        return {
          exitCode: EXIT_CODES.CONFIG_ERROR,
          stopReason: "config_error",
          rounds: 0,
          finalContent: "",
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          configError: `Provider "${parts[0]}" not available. Configure it (sentinel setup) or set an API key.`,
        };
      }
      provider = single;
    }
  }

  const projectRoot = opts.projectRoot;
  contextManager.setSystemPrompt(buildSystemPrompt(agentName, projectRoot));

  // R3: connect configured MCP servers and merge their tools into the toolset.
  const connectMcp = opts.connectMcp !== false;
  const mcp = new MCPManager();
  if (connectMcp) await mcp.connect((config.mcp as never) || {});
  const toolDefs = [...getToolDefinitions(), ...mcp.getToolDefs()];
  const mcpAware = createMcpAwareExecutor(mcp, executeToolCall);

  // R2: enforce permissions + checkpoint mutations. Default mode is "yolo"
  // (unchanged behavior); auto|gated turn on guardrails.
  const mode: PermissionMode = opts.permissionMode || "yolo";
  const engine = new PermissionEngine(mode, config.permissions as never, projectRoot);
  const checkpoints = new CheckpointManager(projectRoot);
  const guardedExecute = createGuardedExecutor({
    engine,
    checkpoints,
    baseExecute: mcpAware,
    ask: async (req: PermissionRequest, reason: string) => {
      // Headless: approve only with --yes; otherwise deny. Stay silent in
      // --json mode so the denial note can't be mistaken for protocol output.
      const label = `${req.tool}${req.action ? `(${req.action})` : ""}`;
      if (opts.autoApprove) return true;
      if (!json) writeStderr(`Permission required: ${label} [${reason}] — denied (pass --yes to allow).\n`);
      return false;
    },
  });

  // V1: subagent delegation. The child reuses the same guarded executor (so
  // permissions/checkpoints still apply) but its toolset omits the subagent
  // tool, capping nesting at one level.
  const subagentTool = createSubagentTool({
    provider,
    toolDefs,
    executeTool: guardedExecute,
    extractToolCalls,
    model: modelName,
    systemPrompt: buildSystemPrompt(agentName, projectRoot),
  });
  const subagentExecute = createSubagentAwareExecutor(subagentTool, guardedExecute);
  // V1: todo tracker (parent-only) composed over the subagent executor.
  const todoTool = createTodoTool();
  const parentExecute = createTodoAwareExecutor(todoTool, subagentExecute);

  // V7: user-defined hooks (pre/post tool, onStop, session) — outermost layer.
  const hooks: HooksConfig | undefined = config.hooks;
  const runShell = opts.runShell ?? defaultRunShell;
  const topExecute = hooks ? createHookAwareExecutor(hooks, parentExecute, runShell, opts.loadHookModule) : parentExecute;

  const autoCfg: AutonomousConfig = config.autonomous || {
    enabled: false, maxRounds: 15, budgetUSD: 0, selfEvaluation: true,
    completionDetection: true, stuckDetection: true, stuckThreshold: 3,
    verificationCommands: [],
  };
  const isAutonomous = autoCfg.enabled && agentName === "gsd";
  const maxRounds = opts.maxSteps
    ? opts.maxSteps
    : isAutonomous ? (autoCfg.maxRounds || 50) : agentName === "gsd" ? 30 : 15;

  if (hooks) await runSessionHooks(hooks, "sessionStart", { SENTINEL_PROJECT: projectRoot }, runShell);

  const runner = new AgentRunner(
    {
      provider,
      context: contextManager,
      toolDefs: [...toolDefs, subagentTool.def, todoTool.def],
      executeTool: topExecute,
      extractToolCalls,
      runVerification: async () => {
        const cmd = autoCfg.verificationCommands?.[0];
        const r = await runDiagnostics(projectRoot, cmd ? { command: cmd } : {});
        return { ok: r.ok, output: formatDiagnostics(r.diagnostics) };
      },
      compactContext: async () => {
        if (contextManager.getContextUtilization() < 0.8) return false;
        await contextManager.compactWithLLM(async (texts) => {
          const resp = await provider!.chatStream(
            [{
              role: "user",
              content:
                "Summarize this conversation excerpt concisely. Preserve the task/goal, " +
                "decisions made, files changed, and any unresolved problems; omit chit-chat.\n\n" +
                texts.join("\n"),
            }],
            { model: modelName, temperature: 0.3, maxTokens: 400 }
          );
          return resp.content || "";
        });
        return true;
      },
    },
    {
      model: modelName,
      maxRounds,
      selfEvaluation: isAutonomous && autoCfg.selfEvaluation !== false,
      stuckDetection: isAutonomous && autoCfg.stuckDetection !== false,
      stuckThreshold: autoCfg.stuckThreshold || 3,
      budgetUSD: autoCfg.budgetUSD || 0,
      getEstimatedCost: () => usageTracker.snapshot().estimatedCostUSD,
      verifyOnComplete: isAutonomous && autoCfg.verifyOnComplete !== false,
      maxVerifyRetries: autoCfg.maxVerifyRetries,
    }
  );

  const emit = (obj: Record<string, unknown>) => {
    if (json && !quiet) emitLine(JSON.stringify(obj));
  };

  if (!quiet) {
    runner.on("roundStart", (round: number) => emit({ type: "round_start", round }));
    runner.on("token", (text: string) => {
      if (json) emit({ type: "token", text });
      else writeStdout(text);
    });
    runner.on("streamEnd", () => {
      if (!json) writeStdout("\n");
    });
    runner.on("usage", (u: Record<string, unknown>) => emit({ type: "usage", ...u }));
    runner.on("toolStart", (name: string, args: string) => {
      emit({ type: "tool_start", name, args });
      if (!json) writeStdout(`[tool] ${name} ${args}\n`);
    });
    runner.on("toolResult", (name: string, ok: boolean, firstLine: string, full: string) => {
      emit({ type: "tool_result", name, ok, firstLine, full });
      if (!json) writeStdout(`  ${ok ? "ok" : "ERR"} ${firstLine}\n`);
    });
    runner.on("roundEnd", (round: number, willContinue: boolean) => emit({ type: "round_end", round, willContinue }));
    runner.on("runError", (e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      emit({ type: "error", message });
      if (!json) writeStderr(`\nError: ${message}\n`);
    });
  }

  const ac = opts.signal ? undefined : new AbortController();
  if (!opts.signal) {
    process.once("SIGINT", () => ac!.abort());
  }

  // disconnect MCP (kills child processes) on ANY exit path, including a throw
  // before the agent loop — otherwise the process can't drain and exit.
  let result;
  try {
    // V2: expand @file / @url mentions in the task before the agent runs.
    let outboundTask = await expandMentions(opts.task, projectRoot);
    // V3: auto-recall from the Sentinel Prime brain when its MCP is connected.
    if (connectMcp && mcp.has(DEFAULT_RECALL_TOOL)) {
      try {
        outboundTask += await recallRelevant(mcpAware, opts.task);
      } catch {
        // best-effort
      }
    }
    contextManager.setMaxTokens(compactionBudget(modelName || ""));
    result = await runner.run(outboundTask, opts.signal ?? ac!.signal);
  } finally {
    if (connectMcp) await mcp.disconnect();
  }

  // In quiet mode, only emit the final result
  if (quiet && json) {
    emitLine(JSON.stringify({ type: "done", stopReason: result.stopReason, rounds: result.rounds, usage: result.usage, result: result.finalContent }));
  } else if (quiet) {
    emitLine(result.finalContent);
  } else {
    emit({ type: "done", stopReason: result.stopReason, rounds: result.rounds, usage: result.usage });
  }

  let exitCode = resolveExitCode(result.stopReason);
  if (hooks) {
    const hookBlocked = await runOnStopHooks(hooks, result.stopReason, exitCode, runShell, opts.loadHookModule);
    if (hookBlocked) exitCode = EXIT_CODES.HOOK_BLOCKED;
  }

  if (hooks) {
    await runSessionHooks(hooks, "sessionEnd", { SENTINEL_PROJECT: projectRoot, SENTINEL_EXIT_CODE: String(exitCode) }, runShell);
  }

  return {
    exitCode,
    stopReason: result.stopReason,
    rounds: result.rounds,
    finalContent: result.finalContent,
    usage: result.usage,
  };
}
