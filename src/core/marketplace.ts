import {
  existsSync as fsExistsSync,
  mkdirSync as fsMkdirSync,
  readFileSync as fsReadFileSync,
  writeFileSync as fsWriteFileSync,
} from "node:fs";
import { join } from "node:path";

/**
 * V15 plugin/extension marketplace client.
 *
 * A "registry" is a JSON document listing installable extensions — skills
 * (markdown files dropped into `.sentinel/skills/`) and MCP servers (entries
 * merged into `config.mcp`). The functions here are pure-ish: all I/O (network
 * fetch + filesystem) is injectable so they can be unit-tested without touching
 * the real disk or network. No singletons.
 */

export interface MarketplaceEntry {
  id: string;
  type: "skill" | "mcp";
  name: string;
  description?: string;
  /** Remote URL to fetch skill content from (skills), or remote MCP endpoint. */
  url?: string;
  /** MCP launch command, e.g. ["npx","-y","@scope/server"]. */
  command?: string[];
  /** Inline skill markdown content (preferred over `url` when present). */
  content?: string;
}

export interface Registry {
  entries: MarketplaceEntry[];
}

/** Async text fetcher — defaults to global fetch; injectable for tests. */
export type FetchText = (url: string) => Promise<string>;

export interface FetchRegistryOptions {
  fetchText?: FetchText;
  /** Filesystem hook (defaults to node:fs readFileSync) for local-path sources. */
  readFile?: (path: string) => string;
  existsSync?: (path: string) => boolean;
}

export interface InstallOptions {
  fetchText?: FetchText;
  writeFile?: (path: string, data: string) => void;
  mkdir?: (path: string) => void;
  readFile?: (path: string) => string;
  existsSync?: (path: string) => boolean;
}

/** Shape installEntry produces for an MCP entry (mirrors core/types McpServerConfig). */
export interface InstalledMcpConfig {
  type: "local" | "remote";
  command?: string[];
  url?: string;
  enabled: boolean;
}

const defaultFetchText: FetchText = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
};

function isUrl(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

/** Validate + narrow an arbitrary parsed object into a Registry. Throws on bad shape. */
function validateRegistry(parsed: unknown): Registry {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("registry must be a JSON object");
  }
  const entriesRaw = (parsed as { entries?: unknown }).entries;
  if (!Array.isArray(entriesRaw)) {
    throw new Error("registry.entries must be an array");
  }
  const entries: MarketplaceEntry[] = [];
  for (const e of entriesRaw) {
    if (!e || typeof e !== "object") {
      throw new Error("each registry entry must be an object");
    }
    const entry = e as Record<string, unknown>;
    if (typeof entry.id !== "string" || !entry.id) {
      throw new Error("registry entry missing string `id`");
    }
    if (entry.type !== "skill" && entry.type !== "mcp") {
      throw new Error(`registry entry "${entry.id}" has invalid type (expected skill|mcp)`);
    }
    if (typeof entry.name !== "string" || !entry.name) {
      throw new Error(`registry entry "${entry.id}" missing string \`name\``);
    }
    entries.push({
      id: entry.id,
      type: entry.type,
      name: entry.name,
      description: typeof entry.description === "string" ? entry.description : undefined,
      url: typeof entry.url === "string" ? entry.url : undefined,
      command: Array.isArray(entry.command)
        ? entry.command.filter((c): c is string => typeof c === "string")
        : undefined,
      content: typeof entry.content === "string" ? entry.content : undefined,
    });
  }
  return { entries };
}

/**
 * Load a registry from a URL (network) or a local file path. JSON-parsed and
 * structurally validated. Throws on malformed input or fetch/read failure so
 * callers can surface a clear error (the TUI wrapper catches it).
 */
export async function fetchRegistry(
  source: string,
  opts: FetchRegistryOptions = {}
): Promise<Registry> {
  let raw: string;
  if (isUrl(source)) {
    const fetchText = opts.fetchText || defaultFetchText;
    raw = await fetchText(source);
  } else {
    const readFile = opts.readFile || ((p: string) => fsReadFileSync(p, "utf-8"));
    const exists = opts.existsSync || fsExistsSync;
    if (!exists(source)) {
      throw new Error(`registry file not found: ${source}`);
    }
    raw = readFile(source);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`registry is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  return validateRegistry(parsed);
}

/** Case-insensitive substring match over id, name, and description. */
export function searchRegistry(registry: Registry, query: string): MarketplaceEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...registry.entries];
  return registry.entries.filter((e) => {
    return (
      e.id.toLowerCase().includes(q) ||
      e.name.toLowerCase().includes(q) ||
      (e.description ? e.description.toLowerCase().includes(q) : false)
    );
  });
}

/**
 * Install a marketplace entry into a project.
 *
 * - skill: writes markdown to `<projectRoot>/.sentinel/skills/<id>.md`, using
 *   `entry.content` or, failing that, fetching `entry.url`.
 * - mcp: records an McpServerConfig-shaped object keyed by name into
 *   `<projectRoot>/.sentinel/mcp.install.json` (a record the caller can merge
 *   into config.mcp).
 *
 * Returns a human-readable summary. Never throws on network errors — instead
 * returns an error string so the TUI can display it inline.
 */
export async function installEntry(
  projectRoot: string,
  entry: MarketplaceEntry,
  opts: InstallOptions = {}
): Promise<string> {
  const writeFile = opts.writeFile || ((p: string, d: string) => fsWriteFileSync(p, d, "utf-8"));
  const mkdir = opts.mkdir || ((p: string) => fsMkdirSync(p, { recursive: true }));
  const readFile = opts.readFile || ((p: string) => fsReadFileSync(p, "utf-8"));
  const exists = opts.existsSync || fsExistsSync;
  const fetchText = opts.fetchText || defaultFetchText;

  if (entry.type === "skill") {
    let content = entry.content;
    if (!content && entry.url) {
      try {
        content = await fetchText(entry.url);
      } catch (err) {
        return `Failed to fetch skill "${entry.id}" from ${entry.url}: ${
          err instanceof Error ? err.message : String(err)
        }`;
      }
    }
    if (!content) {
      return `Skill "${entry.id}" has no content or url to install.`;
    }
    const skillsDir = join(projectRoot, ".sentinel", "skills");
    mkdir(skillsDir);
    const dest = join(skillsDir, `${entry.id}.md`);
    writeFile(dest, content);
    return `Installed skill "${entry.name}" → ${dest}`;
  }

  // type === "mcp"
  const mcpConfig: InstalledMcpConfig = {
    type: entry.url ? "remote" : "local",
    enabled: true,
  };
  if (entry.command && entry.command.length > 0) mcpConfig.command = entry.command;
  if (entry.url) mcpConfig.url = entry.url;

  if (!mcpConfig.command && !mcpConfig.url) {
    return `MCP entry "${entry.id}" has neither command nor url; nothing to install.`;
  }

  const sentinelDir = join(projectRoot, ".sentinel");
  mkdir(sentinelDir);
  const installPath = join(sentinelDir, "mcp.install.json");

  let record: Record<string, InstalledMcpConfig> = {};
  if (exists(installPath)) {
    try {
      const existing = JSON.parse(readFile(installPath));
      if (existing && typeof existing === "object") {
        record = existing as Record<string, InstalledMcpConfig>;
      }
    } catch {
      // Corrupt file — start fresh rather than throw.
      record = {};
    }
  }
  record[entry.name] = mcpConfig;
  writeFile(installPath, JSON.stringify(record, null, 2));
  return `Installed MCP server "${entry.name}" → ${installPath} (merge into config.mcp)`;
}
