/**
 * Command palette search (V13 command-palette groundwork).
 *
 * The palette entries themselves are derived from the live command registry
 * (see `getPaletteCommands` in src/tui/commands/registry.ts) so they can never
 * drift from the actual commands. This module only owns the entry *type* and the
 * fuzzy ranking — callers pass the catalog in. `searchCatalog` ranks with the
 * shared fuzzy matcher (src/core/fuzzy.ts); do not reimplement matching here.
 */

import { fuzzyFilter } from "./fuzzy.js";

export interface PaletteCommand {
  /** Display form, including the leading slash (e.g. "/plan"). */
  command: string;
  /** One-line description shown next to the command. */
  description: string;
}

/**
 * Fuzzy-search a palette catalog by command text.
 * Empty/whitespace query → the full catalog in original order.
 * No matches → empty array.
 */
export function searchCatalog(
  query: string,
  catalog: PaletteCommand[],
): PaletteCommand[] {
  const q = query.trim();
  if (!q) return [...catalog];
  return fuzzyFilter(q, catalog, (c) => c.command).map((r) => r.item);
}
