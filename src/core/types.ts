import type { RouterConfig } from "../ai/router.js";
import type { HooksConfig } from "./hooks.js";

export interface SentinelConfig {
  model: string;
  small_model: string;
  provider: Record<string, unknown>;
  router?: RouterConfig;
  theme: string;
  custom_css: string;
  permissions: PermissionsConfig;
  skills: SkillsConfig;
  mcp: Record<string, McpServerConfig>;
  default_agent: string;
  compaction: CompactionConfig;
  share: "manual" | "auto" | "never";
  autoupdate: "notify" | "auto" | "never";
  snapshot: boolean;
  sessions?: SessionsConfig;
  headroom?: HeadroomConfig;
  ui?: UIConfig;
  hooks?: HooksConfig;
  autopilot?: AutopilotConfig;
}

export interface AutopilotConfig {
  /** Hard safety cap on iterations of the autonomous loop. */
  maxIterations: number;
  /** Give up after this many consecutive iterations that change nothing. */
  maxStalls: number;
  /** Shell commands run each iteration as the deterministic production gate.
   *  When omitted, the runner auto-detects lint/test/build from package.json. */
  verifyCommands?: string[];
  /** Stop once this many wall-clock minutes have elapsed (0/undefined = no limit). */
  maxMinutes?: number;
  /** Stop once estimated cost reaches this many USD (0/undefined = no limit). */
  maxCostUSD?: number;
}

export interface ProviderConfig {
  options: {
    apiKey?: string;
    baseURL?: string;
    [key: string]: unknown;
  };
  models: Record<string, { name: string; [key: string]: unknown }>;
}

export interface PermissionsConfig {
  bash: "allow" | "deny" | "ask";
  edit: string | Record<string, "allow" | "deny" | "ask">;
  read: "allow" | "deny" | "ask";
  skill: Record<string, "allow" | "deny" | "ask">;
  [key: string]: unknown;
}

export interface SkillsConfig {
  paths: string[];
  urls: string[];
}

export interface McpServerConfig {
  type: "local" | "remote";
  command?: string[];
  url?: string;
  enabled: boolean;
}

export interface CompactionConfig {
  auto: boolean;
  prune: boolean;
}

export interface SessionsConfig {
  autoSave: boolean;
  saveInterval: number;
  maxSessions: number;
  restoreOnStartup: "all" | "active" | "none";
  defaultTitle: string;
}

export interface HeadroomConfig {
  enabled: boolean;
  compressionMode: "aggressive" | "balanced" | "conservative";
  compressToolOutput: boolean;
  compressHistory: boolean;
  cacheEnabled: boolean;
}

export interface UIConfig {
  showHeader: boolean;
  showBreadcrumbs: boolean;
  showCompressionStats: boolean;
  tabBarPosition: "top" | "bottom";
}

export const DEFAULT_CONFIG: SentinelConfig = {
  model: "zai/glm-4.6",
  small_model: "zai/glm-4.5-air",
  provider: {},
  theme: "opencode",
  custom_css: "",
  permissions: {
    bash: "ask",
    edit: { "src/**": "allow", "*": "ask" },
    read: "allow",
    skill: { "*": "allow" },
  },
  skills: {
    paths: ["./.sentinel/skills", "~/.config/sentinel/skills"],
    urls: [],
  },
  mcp: {},
  default_agent: "gsd",
  compaction: { auto: true, prune: true },
  share: "manual",
  autoupdate: "notify",
  snapshot: true,
  autopilot: { maxIterations: 10, maxStalls: 2 },
};
