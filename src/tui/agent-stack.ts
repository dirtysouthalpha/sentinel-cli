import { providerManager } from "../ai/provider.js";
import { RoutedProvider } from "../ai/routed-provider.js";
import { PermissionEngine, PermissionMode, PermissionRequest } from "../core/permissions.js";
import { CheckpointManager } from "../core/checkpoints.js";
import { createGuardedExecutor } from "../core/guarded-executor.js";
import { createSubagentTool } from "../core/subagent.js";
import { createMcpAwareExecutor } from "../mcp/mcp-executor.js";
import { getToolDefinitions, executeToolCall } from "../tools/tool-executor.js";
import { extractToolCalls } from "../core/tool-call-extractor.js";
import { buildSystemPrompt } from "../core/system-prompt.js";
import { MCPManager } from "../mcp/manager.js";
import { SentinelConfig } from "../core/types.js";
import { usageTracker } from "../core/usage-tracker.js";
import { estimateCostUSD } from "../core/pricing.js";

export interface AgentBaseOptions {
  config: SentinelConfig;
  /** Full "provider/model" identifier, e.g. "zai/glm-4.6". */
  model: string;
  agent: string;
  mcp: MCPManager;
  permissionMode: PermissionMode;
  projectRoot: string;
  ask: (req: PermissionRequest, reason: string) => Promise<boolean>;
}

/**
 * Build the provider + guarded/MCP-aware executor + subagent-tool stack shared by
 * the interactive chat loop (`chatWithAI`) and the delegated `/pipeline` and
 * `/ship` runners. This ~40-line block was previously copy-pasted into all three
 * call sites; centralizing it keeps their tool / permission / routing wiring
 * provably identical.
 *
 * Connecting MCP servers stays with the caller — that's per-session lifecycle
 * state. This only assembles the executor stack from an already-connected manager.
 */
export function buildAgentBase(opts: AgentBaseOptions) {
  const { config, model, agent, mcp, permissionMode, projectRoot, ask } = opts;

  const [providerName, ...modelParts] = model.split("/");
  const modelName = modelParts.join("/") || undefined;

  let provider;
  let runnerModel = modelName;
  if (config.router) {
    provider = new RoutedProvider(config.router, agent);
    runnerModel = undefined;
  } else {
    const single = providerManager.getProvider(providerName);
    if (!single) throw new Error(`No provider "${providerName}". Try /providers`);
    if (!single.isAvailable()) throw new Error(`No API key for "${providerName}". Type /connect`);
    provider = single;
  }

  // Permission gating + checkpoints, composed over MCP routing.
  const engine = new PermissionEngine(permissionMode, config.permissions as never, projectRoot);
  const checkpoints = new CheckpointManager(projectRoot);
  const mcpAware = createMcpAwareExecutor(mcp, executeToolCall);
  const execute = createGuardedExecutor({
    engine,
    checkpoints,
    baseExecute: mcpAware,
    ask,
  });

  // Subagent delegation — the child reuses the guarded executor and omits the
  // subagent tool itself (depth capped at 1).
  const childToolDefs = [...getToolDefinitions(), ...mcp.getToolDefs()];
  const subagentTool = createSubagentTool({
    provider,
    toolDefs: childToolDefs,
    executeTool: execute,
    extractToolCalls,
    model: runnerModel,
    systemPrompt: buildSystemPrompt(agent, projectRoot),
    // Record subagent token cost so /usage and the autopilot cost ceiling see it.
    onUsage: (u) => usageTracker.recordCostUSD(estimateCostUSD(model, u.promptTokens, u.completionTokens)),
  });

  return { provider, runnerModel, mcpAware, execute, childToolDefs, subagentTool };
}
