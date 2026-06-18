import { AIProvider, ChatMessage, ChatOptions, ChatResponse, StreamChunk, ProviderConfig } from "./types.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAIProvider } from "./providers/openai.js";
import { CustomProvider } from "./providers/custom.js";
import { ZAIProvider } from "./providers/zai.js";
import { GeminiProvider } from "./providers/gemini.js";
import { createLogger } from "../utils/logger.js";

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

  initializeFromConfig(providers: Record<string, ProviderConfig>): void {
    for (const [name, rawConfig] of Object.entries(providers)) {
      // The setup wizard and project config persist provider settings as
      // `{ model, options: { apiKey, baseURL } }` (core/types shape), but
      // providers read the flat `{ apiKey, baseURL }` shape. Flatten any nested
      // `options` so keys saved via `sentinel setup` are actually picked up.
      const nested = (rawConfig as { options?: Record<string, unknown> }).options;
      const config = (nested ? { ...rawConfig, ...nested } : rawConfig) as ProviderConfig;
      // `keyring://<provider>` is a secret-store *marker*, not a real key. The
      // actual key was primed into process.env by bootstrapKeys() before this
      // runs, so drop the marker here and let the provider's env-var fallback
      // resolve it. Otherwise the literal "keyring://zai" gets sent as the
      // bearer token and the API rejects it with 401.
      if (typeof config.apiKey === "string" && config.apiKey.startsWith("keyring://")) {
        config.apiKey = "";
      }
      switch (name) {
        case "anthropic":
          this.registerProvider(new AnthropicProvider(config));
          break;
        case "openai":
          this.registerProvider(new OpenAIProvider(config));
          break;
        case "zai":
        case "zhipu":
          this.registerProvider(new ZAIProvider(config));
          break;
        case "gemini":
        case "google":
          this.registerProvider(new GeminiProvider(config));
          break;
        default:
          this.registerProvider(new CustomProvider(name, config));
          break;
      }
    }

    if (!this.providers.has("anthropic")) {
      this.registerProvider(new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }));
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
