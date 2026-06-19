/**
 * Ponytail system-prompt injection — pure layer.
 *
 * Ponytail is Sentinel's "lazy senior dev" discipline (ported from
 * DietrichGebert/ponytail, MIT). When enabled, its skill body is appended to
 * the system prompt so the YAGNI ladder governs EVERY response by default,
 * not just turns where the user typed /ponytail.
 *
 * This module is intentionally free of file/registry I/O: callers hand it the
 * already-loaded skill body and the config slice, and it decides what (if
 * anything) to inject. That keeps the decision trivially testable.
 */

/** The three intensity tiers from the ponytail skill. */
export type PonytailLevel = "lite" | "full" | "ultra";

/** Config slice. Mirrors SentinelConfig.ponytail. */
export interface PonytailConfig {
  enabled: boolean;
  level: PonytailLevel;
}

export const DEFAULT_PONYTAIL: PonytailConfig = {
  enabled: true,
  level: "ultra",
};

const VALID_LEVELS: readonly PonytailLevel[] = ["lite", "full", "ultra"];

/**
 * Normalize an unknown config value into a valid PonytailConfig. Unknown keys,
 * missing fields, and bogus levels all fall back to the safe default rather
 * than throwing — a malformed config should never break the system prompt.
 */
export function normalizePonytailConfig(raw: unknown): PonytailConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PONYTAIL };
  const r = raw as Partial<PonytailConfig> & { level?: unknown };

  const level =
    typeof r.level === "string" && (VALID_LEVELS as readonly string[]).includes(r.level)
      ? (r.level as PonytailLevel)
      : DEFAULT_PONYTAIL.level;

  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : DEFAULT_PONYTAIL.enabled,
    level,
  };
}

/**
 * Decide what ponytail prompt text (if any) to inject into the system prompt.
 *
 * @param cfg       Resolved ponytail config slice.
 * @param skillBody The ponytail skill's markdown body (already loaded from the
 *                  registry). Empty/undefined ⇒ treated as "skill missing" and
 *                  nothing is injected — the rest of the system still works.
 * @returns         The section to append, or null when disabled/absent.
 */
export function resolvePonytailSection(
  cfg: PonytailConfig,
  skillBody: string | undefined
): string | null {
  if (!cfg.enabled) return null;
  if (!skillBody || !skillBody.trim()) return null;

  // Pin the active intensity as a header so the ladder + "ultra" behavior in
  // the skill body is unambiguous to the model. The skill's own Intensity
  // table describes each tier; this line selects which one is in force.
  return `# Ponytail — lazy-senior-dev discipline (ALWAYS ON, level: ${cfg.level})

${skillBody.trim()}

Active level is **${cfg.level}**. This governs every response until the user
says "stop ponytail" or "normal mode". Do not restate that ponytail is active
unless the user asks.`;
}
