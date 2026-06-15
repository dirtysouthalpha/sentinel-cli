/**
 * Pure helpers for the interactive switch commands (/model, /agent, /skill).
 *
 * They turn a user argument — a 1-based list number, a full identifier, or a
 * unique short name — into a concrete selection, and merge the model sources
 * (current model, config-declared models, a curated fallback) into one ordered,
 * de-duplicated pick list. Keeping these pure makes the switch UX unit-testable.
 */

/**
 * Resolve `arg` against `list`:
 *  - a 1-based index ("3") → that entry (or null if out of range)
 *  - an exact match → itself
 *  - a unique match on the full id or its trailing "/" segment (e.g. "glm-4.6"
 *    matches "zai/glm-4.6") → that entry
 *  - otherwise null (caller decides whether to treat it as a literal id)
 */
export function resolveSelection(list: string[], arg: string): string | null {
  const a = arg.trim();
  if (!a) return null;
  if (/^\d+$/.test(a)) {
    const i = parseInt(a, 10) - 1;
    return i >= 0 && i < list.length ? list[i] : null;
  }
  if (list.includes(a)) return a;
  const lower = a.toLowerCase();
  const matches = list.filter(
    (x) => x.toLowerCase() === lower || x.toLowerCase().split("/").pop() === lower
  );
  return matches.length === 1 ? matches[0] : null;
}

/** Provider segment of a `provider/model` id. */
function providerOf(id: string): string {
  return id.split("/")[0];
}

/**
 * Build the ordered, de-duplicated model pick list:
 *  current model first, then any config-declared models, then curated models
 *  whose provider is actually available (has a key / is registered).
 */
export function mergeModels(
  curated: string[],
  configModels: string[],
  available: string[],
  current: string
): string[] {
  const out: string[] = [];
  const add = (id: string): void => {
    if (id && !out.includes(id)) out.push(id);
  };
  if (current) add(current);
  for (const m of configModels) add(m);
  for (const m of curated) if (available.includes(providerOf(m))) add(m);
  return out;
}
