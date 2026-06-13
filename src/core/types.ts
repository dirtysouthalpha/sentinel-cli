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
  sentinelProxy?: SentinelProxyConfig;
  ui?: UIConfig;
  hooks?: HooksConfig;
  autonomous?: AutonomousConfig;
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
  proxyUrl: string;
  compressionMode: "aggressive" | "balanced" | "conservative";
  compressToolOutput: boolean;
  compressHistory: boolean;
  cacheEnabled: boolean;
}

export interface SentinelProxyConfig {
  enabled: boolean;
  url: string;
  apiKey: string;
  autoStart: boolean;
}

export interface UIConfig {
  showHeader: boolean;
  showBreadcrumbs: boolean;
  showCompressionStats: boolean;
  tabBarPosition: "top" | "bottom";
}

export interface AutonomousConfig {
  enabled: boolean;
  maxRounds: number;
  budgetUSD: number;
  selfEvaluation: boolean;
  completionDetection: boolean;
  stuckDetection: boolean;
  stuckThreshold: number;
  verificationCommands: string[];
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
  autonomous: {
    enabled: false,
    maxRounds: 15,
    budgetUSD: 0,
    selfEvaluation: true,
    completionDetection: true,
    stuckDetection: true,
    stuckThreshold: 3,
    verificationCommands: [],
  },
};
