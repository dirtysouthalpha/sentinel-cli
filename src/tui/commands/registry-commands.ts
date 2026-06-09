import { isAbsolute, resolve } from "node:path";
import { fetchRegistry, searchRegistry, installEntry } from "../../core/marketplace.js";
import { WorkspaceStore } from "../../core/workspace.js";
import { TeamStore } from "../../core/team.js";
import type { CommandHost } from "./types.js";

/**
 * Default marketplace registry source for `/marketplace`. A project-local JSON
 * file by default; overridable per-invocation with an explicit path/URL.
 */
export const DEFAULT_MARKETPLACE_SOURCE = ".sentinel/registry.json";

/**
 * /marketplace (alias /market) — extension registry client.
 *   list [source]            — show every entry in a registry
 *   search <query> [source]  — filter entries by id/name/description
 *   install <id> [source]    — install a skill (.md) or MCP server config
 * `source` defaults to DEFAULT_MARKETPLACE_SOURCE; may be a local path or URL.
 */
export async function handleMarketplace(host: CommandHost, args: string[]): Promise<void> {
  const sub = (args[0] || "").toLowerCase();
  const usage =
    "Usage: /marketplace list [source]  ·  /marketplace search <query> [source]  ·  /marketplace install <id> [source]";

  if (!sub) {
    host.addSystem(usage);
    return;
  }

  // Resolve a source token against the project root when it's a relative path;
  // URLs and absolute paths pass through.
  const resolveSource = (token?: string): string => {
    const src = token || DEFAULT_MARKETPLACE_SOURCE;
    if (/^https?:\/\//i.test(src) || isAbsolute(src)) return src;
    return resolve(host.projectRoot, src);
  };

  const loadRegistry = async (source: string) => fetchRegistry(source);

  if (sub === "list") {
    const source = resolveSource(args[1]);
    try {
      const reg = await loadRegistry(source);
      if (reg.entries.length === 0) {
        host.addSystem("Marketplace registry is empty.");
        return;
      }
      let msg = `Marketplace (${reg.entries.length} entr${reg.entries.length === 1 ? "y" : "ies"}):\n`;
      for (const e of reg.entries) {
        msg += `  ${e.id.padEnd(20)} [${e.type}] ${e.name}${e.description ? ` — ${e.description}` : ""}\n`;
      }
      host.addSystem(msg.trimEnd());
    } catch (err) {
      host.addError(`Marketplace list failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (sub === "search") {
    const query = (args[1] || "").trim();
    if (!query) {
      host.addSystem("Usage: /marketplace search <query> [source]");
      return;
    }
    const source = resolveSource(args[2]);
    try {
      const reg = await loadRegistry(source);
      const hits = searchRegistry(reg, query);
      if (hits.length === 0) {
        host.addSystem(`No marketplace entries match "${query}".`);
        return;
      }
      let msg = `${hits.length} match${hits.length === 1 ? "" : "es"} for "${query}":\n`;
      for (const e of hits) {
        msg += `  ${e.id.padEnd(20)} [${e.type}] ${e.name}${e.description ? ` — ${e.description}` : ""}\n`;
      }
      host.addSystem(msg.trimEnd());
    } catch (err) {
      host.addError(`Marketplace search failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (sub === "install") {
    const id = (args[1] || "").trim();
    if (!id) {
      host.addSystem("Usage: /marketplace install <id> [source]");
      return;
    }
    const source = resolveSource(args[2]);
    try {
      const reg = await loadRegistry(source);
      const entry = reg.entries.find((e) => e.id === id);
      if (!entry) {
        host.addError(`No marketplace entry with id "${id}". Try /marketplace list`);
        return;
      }
      // installEntry never throws on network failure — it returns a status string.
      const summary = await installEntry(host.projectRoot, entry);
      host.addSystem(summary);
      if (entry.type === "mcp") {
        host.addSystem(
          "MCP server recorded in .sentinel/mcp.install.json. Merge it into your config.mcp and restart to connect."
        );
      } else {
        host.addSystem("Skill installed. It loads on next start (or restart the session).");
      }
    } catch (err) {
      host.addError(`Marketplace install failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  host.addSystem(usage);
}

/**
 * /workspace (alias /ws) — track several project roots.
 * Subcommands: list | add [path] | remove <path> | use <path>.
 * `use` records the active root for the *next* session/tab — it does NOT
 * hot-swap the running projectRoot.
 */
export function handleWorkspaceCommand(host: CommandHost, args: string[]): void {
  const sub = (args[0] || "list").toLowerCase();
  let store: WorkspaceStore;
  try {
    store = new WorkspaceStore();
  } catch (err) {
    host.addError(`Workspace error: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (sub === "list") {
    const roots = store.listRoots();
    const active = store.getActive();
    if (roots.length === 0) {
      host.addSystem(
        "No workspace roots yet. Add one with /workspace add [path] (defaults to this project)."
      );
      return;
    }
    let msg = "Workspace roots:\n";
    for (const r of roots) msg += `  ${r === active ? "→" : " "} ${r}\n`;
    host.addSystem(msg.trimEnd());
    return;
  }

  if (sub === "add") {
    const path = args.slice(1).join(" ").trim() || host.projectRoot;
    try {
      const root = store.addRoot(path);
      host.addSystem(`Added workspace root: ${root}`);
    } catch (err) {
      host.addError(`Failed to add root: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (sub === "remove" || sub === "rm") {
    const path = args.slice(1).join(" ").trim();
    if (!path) {
      host.addSystem("Usage: /workspace remove <path>");
      return;
    }
    const removed = store.removeRoot(path);
    host.addSystem(removed ? `Removed workspace root: ${path}` : `Not a tracked root: ${path}`);
    return;
  }

  if (sub === "use") {
    const path = args.slice(1).join(" ").trim();
    if (!path) {
      host.addSystem("Usage: /workspace use <path>");
      return;
    }
    try {
      const root = store.setActive(path);
      host.addSystem(
        `Active workspace root → ${root}\nThis affects the next session / new tab — your current session keeps its project root.`
      );
    } catch (err) {
      host.addError(`Failed to set active root: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  host.addSystem(
    "Usage: /workspace <list | add [path] | remove <path> | use <path>>  (alias: /ws)"
  );
}

/**
 * /team — a shared team manifest: a team name, a shared extension registry, and
 * a roster of members. The registry URL doubles as a /marketplace source so the
 * whole team installs the same skills/MCP servers.
 * Subcommands: info (default) | name <n> | registry <url> | add <member> | remove <member>.
 */
export function handleTeamCommand(host: CommandHost, args: string[]): void {
  const sub = (args[0] || "info").toLowerCase();
  let store: TeamStore;
  try {
    store = new TeamStore();
  } catch (err) {
    host.addError(`Team error: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (sub === "info") {
    const team = store.get();
    let msg = "Team:\n";
    msg += `  name:     ${team.name || "(unset)"}\n`;
    msg += `  registry: ${team.registry || "(unset)"}\n`;
    const members = team.members || [];
    if (members.length === 0) {
      msg += "  members:  (none) — add with /team add <member>";
    } else {
      msg += `  members:  ${members.length}\n`;
      for (const m of members) msg += `    - ${m}\n`;
      msg = msg.trimEnd();
    }
    host.addSystem(msg);
    return;
  }

  if (sub === "name") {
    const name = args.slice(1).join(" ").trim();
    if (!name) {
      host.addSystem("Usage: /team name <name>");
      return;
    }
    try {
      store.setName(name);
      host.addSystem(`Team name → ${name}`);
    } catch (err) {
      host.addError(`Failed to set team name: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (sub === "registry") {
    const url = args.slice(1).join(" ").trim();
    if (!url) {
      host.addSystem("Usage: /team registry <url>");
      return;
    }
    try {
      store.setRegistry(url);
      host.addSystem(
        `Team registry → ${url}\nUse it as a /marketplace source, e.g. /marketplace list ${url}`
      );
    } catch (err) {
      host.addError(`Failed to set team registry: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (sub === "add") {
    const member = args.slice(1).join(" ").trim();
    if (!member) {
      host.addSystem("Usage: /team add <member>");
      return;
    }
    try {
      store.addMember(member);
      host.addSystem(`Added team member: ${member}`);
    } catch (err) {
      host.addError(`Failed to add member: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (sub === "remove" || sub === "rm") {
    const member = args.slice(1).join(" ").trim();
    if (!member) {
      host.addSystem("Usage: /team remove <member>");
      return;
    }
    const removed = store.removeMember(member);
    host.addSystem(removed ? `Removed team member: ${member}` : `Not a team member: ${member}`);
    return;
  }

  host.addSystem(
    "Usage: /team <info | name <n> | registry <url> | add <member> | remove <member>>"
  );
}
