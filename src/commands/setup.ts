import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createInterface } from "readline";
import { DEFAULT_CONFIG, SentinelConfig } from "../core/types.js";

const CONFIG_DIR = join(homedir(), ".config", "sentinel");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

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
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
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
    if (!config.provider) config.provider = {};
    (config.provider as Record<string, unknown>).zai = {
      options: { apiKey: zaiKey },
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
    if (!config.provider) config.provider = {};
    (config.provider as Record<string, unknown>).anthropic = {
      options: { apiKey: anthropicKey },
      models: {
        "claude-fable-5": { name: "Claude Fable 5 (Most Capable)" },
        "claude-opus-4-8": { name: "Claude Opus 4.8" },
        "claude-sonnet-4-6": { name: "Claude Sonnet 4.6 (Recommended)" },
        "claude-haiku-4-5-20251001": { name: "Claude Haiku 4.5 (Fast)" },
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
    if (!config.provider) config.provider = {};
    (config.provider as Record<string, unknown>).openai = {
      options: { apiKey: openaiKey },
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
      if (!config.provider) config.provider = {};
      (config.provider as Record<string, unknown>)[customName] = {
        options: { baseURL: customUrl, apiKey: customKey },
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
  console.log("    anthropic/claude-fable-5           - Most capable");
  console.log("    anthropic/claude-opus-4-8          - High capability");
  console.log("    anthropic/claude-sonnet-4-6        - Best coding (recommended)");
  console.log("    anthropic/claude-haiku-4-5-20251001 - Fast & cheap (fallback)");
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

  console.log("  ── Sentinel Proxy OAuth ────────────────────────────");
  console.log("");
  console.log("  Routes API calls through sentinel-proxy-oauth for OAuth-");
  console.log("  based access (Claude Max subscription, no API key needed).");
  console.log("  Default: http://localhost:8080");
  console.log("  See: C:\\Users\\Administrator\\Downloads\\sentinel-proxy-oauth");
  console.log("");
  const useProxy = await question("  Enable Sentinel Proxy? (y/n): ");
  if (useProxy.toLowerCase() === "y") {
    const proxyUrl = await question("  Proxy base URL (default: http://localhost:8080): ");
    const proxyKey = await question("  API key (default: sk-proxy-anthropic): ");
    const autoStart = await question("  Auto-start proxy on launch? (y/n): ");
    config.sentinelProxy = {
      enabled: true,
      url: proxyUrl || "http://localhost:8080",
      apiKey: proxyKey || "sk-proxy-anthropic",
      autoStart: autoStart.toLowerCase() === "y",
    };
    // Auto-set model to use anthropic via proxy
    if (!config.model || config.model === "zai/glm-4.6") {
      config.model = "anthropic/claude-sonnet-4-6";
    }
    console.log("  OK Sentinel Proxy configured");
  }

  console.log("");

  console.log("  ── Headroom Token Compression ──────────────────────");
  console.log("");
  console.log("  Transparent proxy that compresses tokens before sending");
  console.log("  to the AI provider — reduces cost and extends context.");
  console.log("  Start with: headroom proxy --port 8787 --backend anthropic");
  console.log("  Default proxy URL: http://localhost:8787");
  console.log("");
  const useHeadroom = await question("  Enable Headroom compression? (y/n): ");
  if (useHeadroom.toLowerCase() === "y") {
    const headroomUrl = await question("  Headroom proxy URL (default: http://localhost:8787): ");
    const mode = await question("  Compression mode — aggressive/balanced/conservative (default: balanced): ");
    config.headroom = {
      enabled: true,
      proxyUrl: headroomUrl || "http://localhost:8787",
      compressionMode: (["aggressive", "balanced", "conservative"].includes(mode) ? mode : "balanced") as "aggressive" | "balanced" | "conservative",
      compressToolOutput: true,
      compressHistory: true,
      cacheEnabled: true,
    };
    console.log("  OK Headroom configured");
  }

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
