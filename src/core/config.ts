import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import { DEFAULT_CONFIG, SentinelConfig } from "./types.js";
import { events } from "./events.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger({ prefix: "config" });

const CONFIG_FILENAMES = ["sentinel.json", ".sentinelrc", ".sentinel.json"];

function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>
): T {
  const result = { ...target };
  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceVal = source[key];
    const targetVal = target[key];
    if (
      sourceVal &&
      typeof sourceVal === "object" &&
      !Array.isArray(sourceVal) &&
      targetVal &&
      typeof targetVal === "object" &&
      !Array.isArray(targetVal)
    ) {
      (result as Record<string, unknown>)[key as string] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>
      );
    } else {
      (result as Record<string, unknown>)[key as string] = sourceVal;
    }
  }
  return result;
}

function expandPath(filepath: string): string {
  if (filepath.startsWith("~")) {
    return join(homedir(), filepath.slice(1));
  }
  return resolve(filepath);
}

export class ConfigManager {
  private config: SentinelConfig;
  private configPath: string | null = null;
  private projectRoot: string;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot || process.cwd();
    this.config = { ...DEFAULT_CONFIG };
  }

  load(): SentinelConfig {
    const globalConfig = this.loadGlobalConfig();
    const projectConfig = this.loadProjectConfig();

    this.config = deepMerge(
      { ...DEFAULT_CONFIG },
      { ...globalConfig, ...projectConfig } as Partial<SentinelConfig>
    );

    if (this.configPath) {
      events.emit("config:loaded", this.configPath);
      log.info(`Config loaded from ${this.configPath}`);
    }

    return this.config;
  }

  private loadGlobalConfig(): Partial<SentinelConfig> {
    const globalPaths = [
      join(homedir(), ".config", "sentinel", "config.json"),
      join(homedir(), ".sentinel", "config.json"),
    ];

    for (const path of globalPaths) {
      if (existsSync(path)) {
        try {
          const content = readFileSync(path, "utf-8");
          this.configPath = path;
          return JSON.parse(content);
        } catch (err) {
          log.warn(`Failed to load global config from ${path}: ${err}`);
        }
      }
    }
    return {};
  }

  private loadProjectConfig(): Partial<SentinelConfig> {
    for (const filename of CONFIG_FILENAMES) {
      const path = join(this.projectRoot, filename);
      if (existsSync(path)) {
        try {
          const content = readFileSync(path, "utf-8");
          this.configPath = path;
          return JSON.parse(content);
        } catch (err) {
          log.warn(`Failed to load project config from ${path}: ${err}`);
        }
      }
    }

    const sentinelDir = join(this.projectRoot, ".sentinel", "config.json");
    if (existsSync(sentinelDir)) {
      try {
        const content = readFileSync(sentinelDir, "utf-8");
        this.configPath = sentinelDir;
        return JSON.parse(content);
      } catch (err) {
        log.warn(`Failed to load .sentinel config: ${err}`);
      }
    }

    return {};
  }

  get<K extends keyof SentinelConfig>(key: K): SentinelConfig[K] {
    return this.config[key];
  }

  set<K extends keyof SentinelConfig>(key: K, value: SentinelConfig[K]): void {
    this.config[key] = value;
    events.emit("config:changed", key, value);
  }

  getAll(): SentinelConfig {
    return { ...this.config };
  }

  getProjectRoot(): string {
    return this.projectRoot;
  }

  getConfigPath(): string | null {
    return this.configPath;
  }

  save(): void {
    const path =
      this.configPath || join(this.projectRoot, "sentinel.json");
    const dir = join(path, "..");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(path, JSON.stringify(this.config, null, 2), "utf-8");
    log.info(`Config saved to ${path}`);
  }

  resolvePath(filepath: string): string {
    return expandPath(filepath);
  }

  getSkillPaths(): string[] {
    return this.config.skills.paths.map(expandPath);
  }
}

let configManager: ConfigManager | null = null;

export function getConfigManager(projectRoot?: string): ConfigManager {
  if (!configManager) {
    configManager = new ConfigManager(projectRoot);
  }
  return configManager;
}
