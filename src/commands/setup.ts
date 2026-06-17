import { existsSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createInterface } from "readline";
import { DEFAULT_CONFIG, SentinelConfig } from "../core/types.js";
import { getSecretStore } from "../core/secrets/store.js";
import { providerKeyName } from "../core/secrets/resolver.js";
import { writeAtomicFileSync } from "../utils/atomic-write.js";

const CONFIG_DIR = join(homedir(), ".config", "sentinel");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

/**
 * Persist a provider API key to the platform secret store and return the
 * `keyring://<provider>` marker to write into config (so the config never holds
 * the plaintext). Falls back to the plaintext value if no store is available —
 * logged loudly so the user knows their key is on disk.
 */
async function storeKey(provider: string, value: string): Promise<string> {
  const store = await getSecretStore();
  const ok = await store.set(providerKeyName(provider), value.trim());
  if (ok) return `keyring://${provider}`;
  console.warn(`  ! could not use ${store.kind}; key will be stored as PLAINTEXT in config.`);
  return value.trim();
}

function question(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function loadConfig(): SentinelConfig {
  if (existsSync(CONFIG_FILE)) {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(config: SentinelConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeAtomicFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  console.log(`\n  Config saved to ${CONFIG_FILE}`);
}

export async function runSetup(): Promise<void> {
  console.log("");
  console.log("  ╔════════════════════════════════════════════════════╗");
  console.log("  ║  SENTINEL CLI - Setup Wizard                      ║");
  console.log("  ╚════════════════════════════════════════════════════╝");
  console.log("");

  const config = loadConfig();

  console.log("  ── Z.ai / Zhipu GLM (Recommended) ──────────────────");
  console.log("");
  console.log("  China's leading AI platform. Best value for coding.");
  console.log("  Models: GLM-5.1, GLM-4.7, GLM-4-Flash, CodeGeeX");
  console.log("  Get your API key from: https://open.bigmodel.cn");
  console.log("  Coding Plan: https://bigmodel.cn/coding-plan");
  console.log("");
  const zaiKey = await question("  Z.ai API key (or Enter to skip): ");
  if (zaiKey) {
    const storedApiKey = await storeKey("zai", zaiKey);
    if (!config.provider) config.provider = {};
    (config.provider as Record<string, unknown>).zai = {
      options: { apiKey: storedApiKey },
      models: {
        "glm-5.1": { name: "GLM-5.1 (Most Capable)" },
        "glm-4.6": { name: "GLM-4.6 (Recommended)" },
        "glm-4.5-air": { name: "GLM-4.5 Air (Cheapest)" },
        "codegeex-4": { name: "CodeGeeX 4 (Coding)" },
      },
    };
    config.model = "zai/glm-4.6";
    config.small_model = "zai/glm-4.5-air";
    console.log("  OK Z.ai configured");
  } else {
    console.log("  Skipped. Set ZAI_API_KEY env var to add later.");
  }

  console.log("");

  console.log("  ── Anthropic (Claude) ───────────────────────────────");
  console.log("");
  console.log("  Get your API key from: https://console.anthropic.com/settings/keys");
  console.log("");
  const anthropicKey = await question("  Anthropic API key (or Enter to skip): ");
  if (anthropicKey) {
    const storedApiKey = await storeKey("anthropic", anthropicKey);
    if (!config.provider) config.provider = {};
    (config.provider as Record<string, unknown>).anthropic = {
      options: { apiKey: storedApiKey },
      models: {
        "claude-sonnet": { name: "Claude Sonnet" },
        "claude-haiku": { name: "Claude Haiku" },
      },
    };
    console.log("  OK Anthropic configured");
  } else {
    console.log("  Skipped. Set ANTHROPIC_API_KEY env var to add later.");
  }

  console.log("");

  console.log("  ── OpenAI (GPT) ────────────────────────────────────");
  console.log("");
  console.log("  Get your API key from: https://platform.openai.com/api-keys");
  console.log("");
  const openaiKey = await question("  OpenAI API key (or Enter to skip): ");
  if (openaiKey) {
    const storedApiKey = await storeKey("openai", openaiKey);
    if (!config.provider) config.provider = {};
    (config.provider as Record<string, unknown>).openai = {
      options: { apiKey: storedApiKey },
      models: {
        "gpt-4o": { name: "GPT-4o" },
        "gpt-4o-mini": { name: "GPT-4o Mini" },
      },
    };
    console.log("  OK OpenAI configured");
  } else {
    console.log("  Skipped. Set OPENAI_API_KEY env var to add later.");
  }

  console.log("");

  console.log("  ── Ollama (Local Models - Free) ────────────────────");
  console.log("");
  console.log("  Run AI models locally for free with Ollama.");
  console.log("  Install from: https://ollama.com");
  console.log("  Then: ollama pull llama3");
  console.log("");
  const useOllama = await question("  Configure Ollama? (y/n): ");
  if (useOllama.toLowerCase() === "y") {
    const ollamaUrl = await question("  Ollama URL (default: http://localhost:11434): ");
    if (!config.provider) config.provider = {};
    (config.provider as Record<string, unknown>).ollama = {
      options: { baseURL: ollamaUrl || "http://localhost:11434" },
      models: {
        "llama3": { name: "Llama 3" },
        "codellama": { name: "Code Llama" },
        "mistral": { name: "Mistral" },
        "deepseek-coder": { name: "DeepSeek Coder" },
      },
    };
    console.log("  OK Ollama configured");
  }

  console.log("");

  console.log("  ── Custom Provider (OpenAI-compatible) ─────────────");
  console.log("");
  console.log("  Works with Groq, Together AI, OpenRouter, etc.");
  console.log("");
  const useCustom = await question("  Add custom provider? (y/n): ");
  if (useCustom.toLowerCase() === "y") {
    const customName = await question("  Provider name (e.g. groq): ");
    const customUrl = await question("  API base URL: ");
    const customKey = await question("  API key: ");
    if (customName && customUrl) {
      const storedApiKey = customKey ? await storeKey(customName, customKey) : undefined;
      if (!config.provider) config.provider = {};
      (config.provider as Record<string, unknown>)[customName] = {
        options: { baseURL: customUrl, ...(storedApiKey ? { apiKey: storedApiKey } : {}) },
        models: {},
      };
      console.log(`  OK ${customName} configured`);
    }
  }

  console.log("");

  console.log("  ── Default Model ───────────────────────────────────");
  console.log("");
  console.log("  Format: provider/model-name");
  console.log("  Examples:");
  console.log("    zai/glm-4.6              - Best value (recommended)");
  console.log("    zai/glm-5.1              - Most capable");
  console.log("    zai/glm-4.5-air          - Fast & cheap");
  console.log("    anthropic/claude-sonnet   - Best coding (paid)");
  console.log("    anthropic/claude-haiku    - Fast & cheap (paid)");
  console.log("    openai/gpt-4o            - GPT-4o (paid)");
  console.log("    ollama/llama3            - Local, free");
  console.log("");
  const defaultModel = await question("  Default model (default: zai/glm-4.6): ");
  if (defaultModel) config.model = defaultModel;

  const smallModel = await question("  Small model (default: zai/glm-4.5-air): ");
  if (smallModel) config.small_model = smallModel;

  console.log("");

  console.log("  ── Theme ───────────────────────────────────────────");
  console.log("");
  console.log("  cyberpunk, tron, matrix, neon, dark, blood, terminal,");
  console.log("  ocean, midnight, sunset, forest, paper, mono, light");
  console.log("");
  const theme = await question("  Theme (default: cyberpunk): ");
  if (theme) config.theme = theme;

  console.log("");

  saveConfig(config);

  console.log("");
  console.log("  ╔════════════════════════════════════════════════════╗");
  console.log("  ║  Setup complete!                                  ║");
  console.log("  ╠════════════════════════════════════════════════════╣");
  console.log("  ║                                                    ║");
  console.log("  ║  Run Sentinel:                                     ║");
  console.log("  ║    node dist/cli.js                                ║");
  console.log("  ║                                                    ║");
  console.log("  ║  Or install globally:                              ║");
  console.log("  ║    npm link                                        ║");
  console.log("  ║    sentinel                                        ║");
  console.log("  ║                                                    ║");
  console.log("  ║  Edit config anytime:                              ║");
  console.log("  ║    " + CONFIG_FILE);
  console.log("  ║                                                    ║");
  console.log("  ╚════════════════════════════════════════════════════╝");
  console.log("");
}
