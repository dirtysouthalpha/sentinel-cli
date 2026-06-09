import blessed from "blessed";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { SentinelConfig, DEFAULT_CONFIG } from "../core/types.js";
import { themeEngine } from "../tui/themes/engine.js";

const CONFIG_DIR = join(homedir(), ".config", "sentinel");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

function loadConfig(): SentinelConfig {
  try {
    if (existsSync(CONFIG_FILE)) return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {}
  return { ...DEFAULT_CONFIG };
}

function saveConfig(config: SentinelConfig): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function runConnectOnboarding(
  screen: blessed.Widgets.Screen,
  chatLog: blessed.Widgets.Log,
  inputBar: blessed.Widgets.TextboxElement,
  printLine: (role: string, content: string) => void,
  onComplete: () => void
): void {
  const c = themeEngine.getBlessedColors();
  const config = loadConfig();
  let step = 0;
  let selectedProvider = "";
  let apiKey = "";
  let baseUrl = "";

  const providers = [
    { id: "zai", name: "Z.ai / Zhipu GLM (Recommended)", desc: "Best value. GLM-5.1, GLM-4.7, CodeGeeX. Coding Plan available.", key: "", url: "https://open.bigmodel.cn/api/coding/paas/v4" },
    { id: "anthropic", name: "Anthropic (Claude)", desc: "Best for coding. Requires API key.", key: "sk-ant-...", url: "" },
    { id: "openai", name: "OpenAI (GPT-4o)", desc: "Powerful general model. Requires API key.", key: "sk-...", url: "" },
    { id: "ollama", name: "Ollama (Local - Free)", desc: "Run models locally. No API key needed.", key: "", url: "http://localhost:11434" },
    { id: "groq", name: "Groq (Fast)", desc: "Ultra-fast inference. Requires API key.", key: "gsk_...", url: "https://api.groq.com/openai/v1" },
    { id: "openrouter", name: "OpenRouter (Multi-model)", desc: "Access to 100+ models. Requires API key.", key: "sk-or-...", url: "https://openrouter.ai/api/v1" },
    { id: "together", name: "Together AI", desc: "Open source models at scale.", key: "", url: "https://api.together.xyz/v1" },
    { id: "custom", name: "Custom (OpenAI-compatible)", desc: "Any OpenAI-compatible endpoint.", key: "", url: "" },
  ];

  function showWelcome(): void {
    chatLog.log("");
    chatLog.log(`{${c.cyan}-fg}{bold} +====================================================+{/}`);
    chatLog.log(`{${c.cyan}-fg}{bold} |{/}  {bold}CONNECT - Choose Your AI Provider{/}              {${c.cyan}-fg}{bold}|{/}`);
    chatLog.log(`{${c.cyan}-fg}{bold} +====================================================+{/}`);
    chatLog.log("");
    chatLog.log(`{${c.textSecondary}-fg}  Select a provider to connect to. You can add more later.{/}`);
    chatLog.log(`{${c.textSecondary}-fg}  Type the number and press Enter.{/}`);
    chatLog.log("");

    providers.forEach((p, i) => {
      const configured = (config.provider as Record<string, unknown>)?.[p.id];
      const status = configured ? `{${c.lime}-fg}(configured){/}` : `{${c.textTertiary}-fg}(not set up){/}`;
      chatLog.log(`  {${c.accent}-fg}${String(i + 1).padStart(2)}.{/} {bold}${p.name}{/} - ${p.desc} ${status}`);
    });

    chatLog.log("");
    chatLog.log(`  {${c.textTertiary}-fg}Type a number (1-8) or "skip" to skip setup:{/}`);
    chatLog.log(`{${c.border}-fg}  ------------------------------------------------------------{/}`);

    step = 1;
    inputBar.focus();
    screen.render();
  }

  function showApiKeyPrompt(): void {
    const prov = providers.find((p) => p.id === selectedProvider)!;
    chatLog.log("");
    chatLog.log(`{${c.accent}-fg}{bold}  Connecting: ${prov.name}{/}`);
    chatLog.log("");

    if (prov.id === "ollama") {
      chatLog.log(`{${c.textSecondary}-fg}  Ollama runs locally - no API key needed.{/}`);
      chatLog.log(`{${c.textSecondary}-fg}  Make sure Ollama is installed: https://ollama.com{/}`);
      chatLog.log(`{${c.textSecondary}-fg}  Then run: ollama pull llama3{/}`);
      chatLog.log("");
      chatLog.log(`  Press Enter to confirm, or type a custom URL.`);
      chatLog.log(`  Default: http://localhost:11434`);
      chatLog.log(`{${c.border}-fg}  ------------------------------------------------------------{/}`);
      step = 3;
      baseUrl = "http://localhost:11434";
    } else if (prov.id === "custom") {
      chatLog.log(`{${c.textSecondary}-fg}  Enter the base URL for your OpenAI-compatible API:{/}`);
      chatLog.log(`  Examples: http://localhost:8080/v1, https://my-api.example.com/v1`);
      chatLog.log(`{${c.border}-fg}  ------------------------------------------------------------{/}`);
      step = 2;
    } else if (prov.id === "zai") {
      chatLog.log(`{${c.textSecondary}-fg}  Z.ai (Zhipu GLM) - China's leading AI platform.{/}`);
      chatLog.log(`{${c.textSecondary}-fg}  Supports GLM-5.1, GLM-4.7, CodeGeeX, and more.{/}`);
      chatLog.log("");
      chatLog.log(`  Get your API key from: https://open.bigmodel.cn`);
      chatLog.log(`  Coding Plan: https://bigmodel.cn/coding-plan`);
      chatLog.log("");
      chatLog.log(`  Paste your Z.ai API key:`);
      chatLog.log(`{${c.border}-fg}  ------------------------------------------------------------{/}`);
      step = 2;
    } else {
      const keyHint = prov.key ? ` (starts with ${prov.key.slice(0, 6)}...)` : "";
      chatLog.log(`{${c.textSecondary}-fg}  Enter your ${prov.name} API key${keyHint}:{/}`);
      chatLog.log("");

      const envVar = prov.id === "anthropic" ? "ANTHROPIC_API_KEY" : prov.id === "openai" ? "OPENAI_API_KEY" : `${prov.id.toUpperCase()}_API_KEY`;
      chatLog.log(`{${c.textTertiary}-fg}  Tip: You can also set the ${envVar} environment variable.{/}`);

      if (prov.id === "anthropic") {
        chatLog.log(`{${c.textTertiary}-fg}  Get a key: https://console.anthropic.com/settings/keys{/}`);
      } else if (prov.id === "openai") {
        chatLog.log(`{${c.textTertiary}-fg}  Get a key: https://platform.openai.com/api-keys{/}`);
      } else if (prov.id === "groq") {
        chatLog.log(`{${c.textTertiary}-fg}  Get a key: https://console.groq.com/keys{/}`);
      } else if (prov.id === "openrouter") {
        chatLog.log(`{${c.textTertiary}-fg}  Get a key: https://openrouter.ai/keys{/}`);
      } else if (prov.id === "together") {
        chatLog.log(`{${c.textTertiary}-fg}  Get a key: https://api.together.xyz/settings/api-keys{/}`);
      }

      chatLog.log("");
      chatLog.log(`  Paste your API key:`);
      chatLog.log(`{${c.border}-fg}  ------------------------------------------------------------{/}`);
      step = 2;
    }

    inputBar.focus();
    screen.render();
  }

  function showCustomUrlPrompt(): void {
    chatLog.log("");
    chatLog.log(`{${c.textSecondary}-fg}  Now enter the API base URL:{/}`);
    chatLog.log(`  This should end in /v1 for OpenAI-compatible APIs.`);
    chatLog.log(`{${c.border}-fg}  ------------------------------------------------------------{/}`);
    step = 3;
    inputBar.focus();
    screen.render();
  }

  function showCustomKeyPrompt(): void {
    chatLog.log("");
    chatLog.log(`{${c.textSecondary}-fg}  Enter your API key (or press Enter if none needed):{/}`);
    chatLog.log(`{${c.border}-fg}  ------------------------------------------------------------{/}`);
    step = 4;
    inputBar.focus();
    screen.render();
  }

  function testAndSave(): void {
    const prov = providers.find((p) => p.id === selectedProvider)!;

    if (!config.provider) config.provider = {};
    const providerConfig: Record<string, unknown> = { options: {}, models: {} };

    if (apiKey) {
      (providerConfig.options as Record<string, unknown>).apiKey = apiKey;
    }
    if (baseUrl || prov.url) {
      (providerConfig.options as Record<string, unknown>).baseURL = baseUrl || prov.url;
    }

    if (prov.id === "zai") {
      providerConfig.models = {
        "glm-5.1": { name: "GLM-5.1 (Most Capable)" },
        "glm-4.6": { name: "GLM-4.6 (Recommended)" },
        "glm-4.5-air": { name: "GLM-4.5 Air (Cheapest)" },
        "codegeex-4": { name: "CodeGeeX 4 (Coding)" },
      };
      if (!config.model || config.model === DEFAULT_CONFIG.model) {
        config.model = "zai/glm-4.6";
        config.small_model = "zai/glm-4.5-air";
      }
    } else if (prov.id === "anthropic") {
      providerConfig.models = {
        "claude-sonnet": { name: "Claude Sonnet" },
        "claude-haiku": { name: "Claude Haiku" },
      };
      if (!config.model || config.model === DEFAULT_CONFIG.model) {
        config.model = "anthropic/claude-sonnet";
      }
    } else if (prov.id === "openai") {
      providerConfig.models = {
        "gpt-4o": { name: "GPT-4o" },
        "gpt-4o-mini": { name: "GPT-4o Mini" },
      };
    } else if (prov.id === "ollama") {
      providerConfig.models = {
        "llama3": { name: "Llama 3" },
        "codellama": { name: "Code Llama" },
        "mistral": { name: "Mistral" },
        "deepseek-coder": { name: "DeepSeek Coder" },
      };
    } else if (prov.id === "groq") {
      providerConfig.models = {
        "llama-3.1-70b-versatile": { name: "Llama 3.1 70B" },
        "mixtral-8x7b-32768": { name: "Mixtral 8x7B" },
      };
    } else if (prov.id === "openrouter") {
      providerConfig.models = {
        "anthropic/claude-sonnet": { name: "Claude Sonnet via OpenRouter" },
        "openai/gpt-4o": { name: "GPT-4o via OpenRouter" },
      };
    }

    (config.provider as Record<string, unknown>)[prov.id] = providerConfig;
    saveConfig(config);

    chatLog.log("");
    chatLog.log(`{${c.lime}-fg}{bold}  Connected!{/} ${prov.name} is configured.`);
    chatLog.log(`{${c.textTertiary}-fg}  Config saved to ${CONFIG_FILE}{/}`);

    if (prov.id === "zai") {
      chatLog.log(`{${c.textSecondary}-fg}  Switch model: /model zai/glm-4.6{/}`);
      chatLog.log(`{${c.textSecondary}-fg}  Best model:   /model zai/glm-5.1{/}`);
      chatLog.log(`{${c.textSecondary}-fg}  Fast model:   /model zai/glm-4.5-air{/}`);
    } else if (prov.id === "anthropic") {
      chatLog.log(`{${c.textSecondary}-fg}  Switch model: /model anthropic/claude-sonnet{/}`);
    } else if (prov.id === "openai") {
      chatLog.log(`{${c.textSecondary}-fg}  Switch model: /model openai/gpt-4o{/}`);
    } else if (prov.id === "ollama") {
      chatLog.log(`{${c.textSecondary}-fg}  Pull models: ollama pull llama3{/}`);
      chatLog.log(`{${c.textSecondary}-fg}  Switch model: /model ollama/llama3{/}`);
    } else if (prov.id === "groq") {
      chatLog.log(`{${c.textSecondary}-fg}  Switch model: /model groq/llama-3.1-70b-versatile{/}`);
    }

    chatLog.log("");

    showAddMore();
  }

  function showAddMore(): void {
    chatLog.log(`{${c.textTertiary}-fg}  Add another provider? Type /connect or just start chatting.{/}`);
    chatLog.log(`{${c.border}-fg}  ------------------------------------------------------------{/}`);
    step = 99;
    inputBar.focus();
    screen.render();
    onComplete();
  }

  const originalSubmit = inputBar.listeners("submit");
  const originalCancel = inputBar.listeners("cancel");

  function onboardingSubmit(value: string): boolean {
    const msg = (value || "").trim();

    if (step === 1) {
      if (msg.toLowerCase() === "skip") {
        chatLog.log(`{${c.textTertiary}-fg}  Setup skipped. Type /connect anytime to set up.{/}`);
        chatLog.log(`{${c.border}-fg}  ------------------------------------------------------------{/}`);
        cleanup();
        onComplete();
        return true;
      }
      const num = parseInt(msg);
      if (num >= 1 && num <= providers.length) {
        selectedProvider = providers[num - 1].id;
        showApiKeyPrompt();
        return true;
      }
      chatLog.log(`{${c.error}-fg}  Invalid choice. Type 1-${providers.length} or "skip".{/}`);
      return true;
    }

    if (step === 2) {
      if (selectedProvider === "custom") {
        if (!msg) {
          chatLog.log(`{${c.error}-fg}  URL is required for custom provider.{/}`);
          return true;
        }
        baseUrl = msg;
        showCustomKeyPrompt();
        return true;
      }
      if (!msg) {
        chatLog.log(`{${c.error}-fg}  API key is required. Paste your key:{/}`);
        return true;
      }
      apiKey = msg;
      if (selectedProvider === "anthropic" || selectedProvider === "openai" || selectedProvider === "zai") {
        testAndSave();
      } else {
        chatLog.log("");
        chatLog.log(`{${c.textSecondary}-fg}  Enter base URL (or press Enter for default):{/}`);
        const prov = providers.find((p) => p.id === selectedProvider)!;
        if (prov.url) chatLog.log(`  Default: ${prov.url}`);
        chatLog.log(`{${c.border}-fg}  ------------------------------------------------------------{/}`);
        step = 3;
        inputBar.focus();
        screen.render();
      }
      return true;
    }

    if (step === 3) {
      const prov = providers.find((p) => p.id === selectedProvider)!;
      baseUrl = msg || prov.url || baseUrl;
      testAndSave();
      return true;
    }

    if (step === 4) {
      apiKey = msg;
      testAndSave();
      return true;
    }

    return false;
  }

  function cleanup(): void {
    inputBar.removeAllListeners("submit");
    inputBar.removeAllListeners("cancel");
    inputBar.on("submit", originalSubmit[0] as (...args: unknown[]) => void);
    inputBar.on("cancel", originalCancel[0] as (...args: unknown[]) => void);
  }

  inputBar.removeAllListeners("submit");
  inputBar.removeAllListeners("cancel");

  inputBar.on("submit", (value: string) => {
    const handled = onboardingSubmit(value);
    inputBar.clearValue();
    inputBar.focus();
    screen.render();
    if (!handled) {
      cleanup();
      (originalSubmit[0] as (val: string) => void)(value);
    }
  });

  inputBar.on("cancel", () => {
    chatLog.log(`{${c.textTertiary}-fg}  Setup cancelled. Type /connect to try again.{/}`);
    chatLog.log(`{${c.border}-fg}  ------------------------------------------------------------{/}`);
    cleanup();
    inputBar.clearValue();
    inputBar.focus();
    screen.render();
    onComplete();
  });

  showWelcome();
}
