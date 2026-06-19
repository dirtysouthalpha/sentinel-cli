import { AIProvider, ChatMessage, ChatOptions, ChatResponse, StreamChunk } from "./types.js";
import { providerManager } from "./provider.js";
import { route, runWithRouter, RouterConfig } from "./router.js";
import { classifyTurn } from "./classify-turn.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger({ prefix: "router" });

/**
 * An AIProvider that fronts a chain of real providers. It resolves a target
 * chain ("provider/model") via the router rules, then runs the call across that
 * chain with retry/backoff and cross-target fallback. Because it implements
 * AIProvider, the AgentRunner and TUI consume it exactly like a single provider.
 *
 * Each chain target's model overrides ChatOptions.model, so the runner is
 * constructed with model: undefined when routing is active.
 *
 * **v2.2:** resolveChain now calls {@link classifyTurn} on the messages to
 * populate `taskKind` and `requiresVision` before consulting the rule engine —
 * so simple reads/chat route to `small_model` (when configured) and vision
 * turns route to vision-capable targets. Previously the router only received
 * `requiresTools`, leaving it effectively single-model.
 */
export class RoutedProvider implements AIProvider {
  name = "router";

  constructor(private readonly cfg: RouterConfig, private readonly agent?: string) {}

  isAvailable(): boolean {
    // Per-target availability is enforced by route()'s filter below.
    return true;
  }

  private targetAvailable = (target: string): boolean => {
    const providerName = target.split("/")[0];
    const prov = providerManager.getProvider(providerName);
    return !!prov && prov.isAvailable();
  };

  private resolveChain(messages: ChatMessage[], options?: ChatOptions): string[] {
    const { taskKind, requiresVision } = classifyTurn(
      messages,
      !!(options?.tools && options.tools.length)
    );
    const chain = route(
      this.cfg,
      { agent: this.agent, requiresTools: !!(options?.tools && options.tools.length), taskKind, requiresVision },
      this.targetAvailable
    );
    log.debug(`route [${taskKind}${requiresVision ? "+vision" : ""}] -> ${chain.join(" | ")}`);
    return chain;
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    return runWithRouter(
      this.resolveChain(messages, options),
      (providerName, model) => providerManager.chat(providerName, messages, { ...options, model }),
      { retry: this.cfg.retry, firstChunkSeen: () => false }
    );
  }

  async chatStream(
    messages: ChatMessage[],
    options?: ChatOptions,
    onChunk?: (chunk: StreamChunk) => void
  ): Promise<ChatResponse> {
    let firstChunk = false;
    const wrapped = (c: StreamChunk) => {
      if (c.content) firstChunk = true;
      onChunk?.(c);
    };
    return runWithRouter(
      this.resolveChain(messages, options),
      (providerName, model) =>
        providerManager.chatStream(providerName, messages, { ...options, model }, wrapped),
      { retry: this.cfg.retry, firstChunkSeen: () => firstChunk }
    );
  }
}
