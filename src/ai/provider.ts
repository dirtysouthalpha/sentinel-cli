import { AIProvider, ChatMessage, ChatOptions, ChatResponse, StreamChunk, ProviderConfig } from "./types.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAIProvider } from "./providers/openai.js";
import { CustomProvider } from "./providers/custom.js";
import { ZAIProvider } from "./providers/zai.js";
import { GeminiProvider } from "./providers/gemini.js";
import { createLogger } from "../utils/logger.js";
import type { HeadroomConfig, SentinelProxyConfig } from "../core/types.js";

export interface ProxyOverrides {
  sentinelProxy?: SentinelProxyConfig;
  headroom?: HeadroomConfig;
}

const log = createLogger({ prefix: "provider" });

class ProviderManager {
  private providers: Map<string, AIProvider> = new Map();
  private static instance: ProviderManager;

  private constructor() {}

  static getInstance(): ProviderManager {
    if (!ProviderManager.instance) {
      ProviderManager.instance = new ProviderManager();
    }
    return ProviderManager.instance;
  }

  registerProvider(provider: AIProvider): void {
    this.providers.set(provider.name, provider);
    log.info(`Registered provider: ${provider.name}`);
  }

  getProvider(name: string): AIProvider | undefined {
    return this.providers.get(name);
  }

  getProviderOrThrow(name: string): AIProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`Provider "${name}" not found. Available: ${this.getAvailableProviderNames().join(", ")}`);
    }
    return provider;
  }

  getAvailableProviderNames(): string[] {
    return Array.from(this.providers.values())
      .filter((p) => p.isAvailable())
      .map((p) => p.name);
  }

  getAllProviderNames(): string[] {
    return Array.from(this.providers.keys());
  }

  // Config stored in JSON uses nested { options: { apiKey, baseURL } } but
  // provider constructors expect a flat ProviderConfig. Normalize either shape.
  private normalizeConfig(raw: unknown): ProviderConfig {
    if (raw && typeof raw === "object") {
      const r = raw as Record<string, unknown>;
      if (r.options && typeof r.options === "object") {
        const opts = r.options as Record<string, unknown>;
        return {
          apiKey: opts.apiKey as string | undefined,
          baseURL: opts.baseURL as string | undefined,
          ...(opts as Omit<typeof opts, "apiKey" | "baseURL">),
        } as ProviderConfig;
      }
      return r as ProviderConfig;
    }
    return {} as ProviderConfig;
  }

  private applyProxy(cfg: ProviderConfig, providerName: string, proxy: ProxyOverrides): ProviderConfig {
    // Headroom wraps everything — takes precedence over sentinel proxy
    if (proxy.headroom?.enabled && proxy.headroom.proxyUrl) {
      return { ...cfg, baseURL: proxy.headroom.proxyUrl, apiKey: proxy.sentinelProxy?.apiKey || cfg.apiKey };
    }
    if (proxy.sentinelProxy?.enabled && providerName === "anthropic") {
      return { ...cfg, baseURL: proxy.sentinelProxy.url, apiKey: proxy.sentinelProxy.apiKey || cfg.apiKey };
    }
    return cfg;
  }

  initializeFromConfig(providers: Record<string, unknown>, proxy: ProxyOverrides = {}): void {
    for (const [name, raw] of Object.entries(providers)) {
      const cfg = this.applyProxy(this.normalizeConfig(raw), name, proxy);
      switch (name) {
        case "anthropic":
          this.registerProvider(new AnthropicProvider(cfg));
          break;
        case "openai":
          this.registerProvider(new OpenAIProvider(cfg));
          break;
        case "zai":
        case "zhipu":
          this.registerProvider(new ZAIProvider(cfg));
          break;
        case "gemini":
        case "google":
          this.registerProvider(new GeminiProvider(cfg));
          break;
        default:
          this.registerProvider(new CustomProvider(name, cfg));
          break;
      }
    }

    if (!this.providers.has("anthropic")) {
      const fallback: ProviderConfig = { apiKey: process.env.ANTHROPIC_API_KEY };
      this.registerProvider(new AnthropicProvider(this.applyProxy(fallback, "anthropic", proxy)));
    }
    if (!this.providers.has("openai")) {
      this.registerProvider(new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }));
    }
    if (!this.providers.has("zai")) {
      this.registerProvider(new ZAIProvider({ apiKey: process.env.ZAI_API_KEY || process.env.ZHIPU_API_KEY }));
    }
    if (!this.providers.has("ollama")) {
      this.registerProvider(new CustomProvider("ollama", {
        baseURL: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      }));
    }
    if (!this.providers.has("gemini")) {
      this.registerProvider(new GeminiProvider({
        apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
      }));
    }
  }

  async chat(
    providerName: string,
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<ChatResponse> {
    const provider = this.getProviderOrThrow(providerName);
    return provider.chat(messages, options);
  }

  async chatStream(
    providerName: string,
    messages: ChatMessage[],
    options?: ChatOptions,
    onChunk?: (chunk: StreamChunk) => void
  ): Promise<ChatResponse> {
    const provider = this.getProviderOrThrow(providerName);
    return provider.chatStream(messages, options, onChunk);
  }
}

export const providerManager = ProviderManager.getInstance();

export { AnthropicProvider } from "./providers/anthropic.js";
export { OpenAIProvider } from "./providers/openai.js";
export { CustomProvider } from "./providers/custom.js";
export { ZAIProvider } from "./providers/zai.js";
