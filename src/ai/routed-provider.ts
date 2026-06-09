import { AIProvider, ChatMessage, ChatOptions, ChatResponse, StreamChunk } from "./types.js";
import { providerManager } from "./provider.js";
import { route, runWithRouter, RouterConfig } from "./router.js";
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

  private resolveChain(options?: ChatOptions): string[] {
    const chain = route(
      this.cfg,
      { agent: this.agent, requiresTools: !!(options?.tools && options.tools.length) },
      this.targetAvailable
    );
    log.debug(`route -> ${chain.join(" | ")}`);
    return chain;
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    return runWithRouter(
      this.resolveChain(options),
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
      this.resolveChain(options),
      (providerName, model) =>
        providerManager.chatStream(providerName, messages, { ...options, model }, wrapped),
      { retry: this.cfg.retry, firstChunkSeen: () => firstChunk }
    );
  }
}
