/**
 * Plugin type system — v3.0 extensibility surface.
 *
 * Extends the marketplace beyond skill/mcp to include tool, theme, and hook
 * plugins. Pure validation logic (no I/O) so the registry can reject malformed
 * or malicious entries (path traversal in ids) before touching the filesystem.
 *
 * This is the type spine; the marketplace client (marketplace.ts) consumes it
 * to widen its accepted entry types.
 */

export type PluginType = "skill" | "mcp" | "tool" | "theme" | "hook";

export const PLUGIN_TYPES: readonly PluginType[] = ["skill", "mcp", "tool", "theme", "hook"];

export interface PluginEntry {
  id: string;
  type: PluginType;
  name: string;
  description?: string;
  /** Remote URL to fetch content from (skills, tools, themes). */
  url?: string;
  /** Inline content (skill markdown, tool JS, theme JSON). Preferred over url. */
  content?: string;
  /** MCP launch command (mcp type only). */
  command?: string[];
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

/** Type guard: is this string a valid plugin type? */
export function isPluginType(s: string): s is PluginType {
  return (PLUGIN_TYPES as readonly string[]).includes(s);
}

/**
 * Validate a plugin entry before installing it. Checks:
 * - Valid type (skill/mcp/tool/theme/hook)
 * - Non-empty id + name
 * - No path traversal in the id (security — prevents ../escape writes)
 * - Has content or url (except mcp which uses command)
 */
export function validatePluginEntry(entry: Partial<PluginEntry>): ValidationResult {
  if (!entry.type || !isPluginType(entry.type)) {
    return { ok: false, error: `Invalid or missing type. Must be one of: ${PLUGIN_TYPES.join(", ")}` };
  }
  if (!entry.id || !entry.id.trim()) {
    return { ok: false, error: "Missing id." };
  }
  // Path-traversal guard: ids become filenames, so block anything that escapes.
  if (/[./\\]/.test(entry.id) || entry.id.includes("..")) {
    return { ok: false, error: `Invalid id '${entry.id}': no path separators or traversal allowed.` };
  }
  if (!entry.name || !entry.name.trim()) {
    return { ok: false, error: "Missing name." };
  }
  // mcp uses command; everything else needs content or url.
  if (entry.type !== "mcp" && !entry.content && !entry.url) {
    return { ok: false, error: `${entry.type} entries require 'content' or 'url'.` };
  }
  if (entry.type === "mcp" && !entry.command && !entry.url) {
    return { ok: false, error: "mcp entries require 'command' or 'url'." };
  }
  return { ok: true };
}
