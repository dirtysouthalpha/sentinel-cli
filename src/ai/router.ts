import { ChatResponse } from "./types.js";
import { ProviderError, isRetryableStatus } from "./errors.js";

export type TaskKind = "code" | "chat" | "search" | "plan" | "cheap";

export interface RouterRule {
  match: {
    agent?: string;
    taskKind?: TaskKind;
    requiresTools?: boolean;
    requiresVision?: boolean;
    minContextTokens?: number;
  };
  use: string;
  fallbacks?: string[];
}

/**
 * A named routing role (omp-inspired). Maps a logical task slot to a concrete
 * "provider/model" target plus optional ordered fallbacks. Roles are resolved
 * independently of the rule engine via {@link resolveRole}.
 */
export interface RouterRole {
  /** Primary "provider/model" target for this role. */
  model: string;
  /** Ordered fallback "provider/model" targets, tried after `model`. */
  fallback?: string[];
}

/**
 * Well-known role names. `string` is kept in the union so callers may define
 * custom roles without a type error, while still getting autocomplete for the
 * common ones.
 */
export type RouterRoleName = "default" | "plan" | "smol" | "commit" | (string & {});

export interface RouterConfig {
  default: string;
  rules?: RouterRule[];
  /**
   * Optional named roles. A caller resolves a role to an ordered candidate
   * chain via {@link resolveRole}. Absent roles leave all existing behavior
   * unchanged.
   */
  roles?: Record<string, RouterRole>;
  retry?: {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    retryOn: number[];
  };
}

export interface RouterInput {
  agent?: string;
  taskKind?: TaskKind;
  requiresTools?: boolean;
  requiresVision?: boolean;
  contextTokens?: number;
}

/**
 * Deterministic, fixed jitter (ms) added to each backoff delay.
 * Kept constant so retry timing is fully reproducible/injectable.
 */
const FIXED_JITTER_MS = 25;

function ruleMatches(rule: RouterRule, input: RouterInput): boolean {
  const m = rule.match;
  if (m.agent !== undefined && m.agent !== input.agent) return false;
  if (m.taskKind !== undefined && m.taskKind !== input.taskKind) return false;
  if (m.requiresTools !== undefined && m.requiresTools !== !!input.requiresTools) return false;
  if (m.requiresVision !== undefined && m.requiresVision !== !!input.requiresVision) return false;
  if (m.minContextTokens !== undefined) {
    if ((input.contextTokens ?? 0) < m.minContextTokens) return false;
  }
  return true;
}

/**
 * Select a chain of targets for the given input.
 * Uses the first matching rule (top-down). Returns [use, ...fallbacks]
 * filtered to available targets. Falls back to [cfg.default] when empty.
 */
export function route(
  cfg: RouterConfig,
  input: RouterInput,
  isAvailable: (target: string) => boolean
): string[] {
  let chain: string[] | undefined;

  if (cfg.rules) {
    for (const rule of cfg.rules) {
      if (ruleMatches(rule, input)) {
        chain = [rule.use, ...(rule.fallbacks ?? [])];
        break;
      }
    }
  }

  if (!chain) {
    chain = [cfg.default];
  }

  const filtered = chain.filter((target) => isAvailable(target));

  if (filtered.length > 0) return filtered;

  // Nothing in the rule chain is available — fall back to the default only if
  // it is actually runnable; otherwise an empty chain (caller raises a clear error).
  return isAvailable(cfg.default) ? [cfg.default] : [];
}

/**
 * Resolve a named role to an ordered list of candidate "provider/model"
 * targets, most-preferred first. The chain is:
 *
 *   [role.model, ...role.fallback, cfg.default]
 *
 * de-duplicated (preserving first occurrence). `cfg.default` is always appended
 * as a final backstop so a role can never resolve to an empty chain.
 *
 * If the role is not configured (or `cfg.roles` is absent entirely), this falls
 * back to the existing default behavior and returns `[cfg.default]`. This is a
 * pure function — it performs no availability filtering; pass the result through
 * the same machinery you'd use for a manual chain if you need that.
 *
 * @example
 *   resolveRole(config.router, "plan"); // -> ["openai/o3", "anthropic/claude", <default>]
 */
export function resolveRole(cfg: RouterConfig, role: RouterRoleName): string[] {
  const entry = cfg.roles?.[role];

  const chain = entry
    ? [entry.model, ...(entry.fallback ?? []), cfg.default]
    : [cfg.default];

  // De-duplicate while preserving order (first occurrence wins).
  const seen = new Set<string>();
  const result: string[] = [];
  for (const target of chain) {
    if (!target || seen.has(target)) continue;
    seen.add(target);
    result.push(target);
  }
  return result;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeBackoff(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  const exp = baseDelayMs * Math.pow(2, attempt - 1);
  return Math.min(maxDelayMs, exp) + FIXED_JITTER_MS;
}

/**
 * Run a call across a chain of "provider/model" targets with retry.
 *
 * For each target: split on the first "/" into providerName + model, then
 * attempt up to retry.maxAttempts times. On ProviderError, retry ONLY when
 * the status is retryable AND no stream chunk has been emitted yet
 * (firstChunkSeen() === false) — never retry once streaming produced output,
 * to avoid duplicated tokens. Otherwise move on to the next target.
 * If all targets/attempts are exhausted, throw the last error.
 */
export async function runWithRouter(
  chain: string[],
  call: (
    providerName: string,
    model: string | undefined,
    attempt: number
  ) => Promise<ChatResponse>,
  opts: {
    retry?: RouterConfig["retry"];
    firstChunkSeen: () => boolean;
    sleep?: (ms: number) => Promise<void>;
  }
): Promise<ChatResponse> {
  const sleep = opts.sleep ?? defaultSleep;
  const maxAttempts = opts.retry?.maxAttempts ?? 1;
  const baseDelayMs = opts.retry?.baseDelayMs ?? 0;
  const maxDelayMs = opts.retry?.maxDelayMs ?? 0;
  const retryOn = opts.retry?.retryOn ?? [];

  if (chain.length === 0) {
    throw new ProviderError(
      "No available provider/model in the router chain — check config.router targets and API keys."
    );
  }

  let lastError: unknown;

  for (const target of chain) {
    const slash = target.indexOf("/");
    const providerName = slash === -1 ? target : target.slice(0, slash);
    const model = slash === -1 ? undefined : target.slice(slash + 1);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await call(providerName, model, attempt);
      } catch (err) {
        lastError = err;

        const status = err instanceof ProviderError ? err.status : undefined;
        const canRetry =
          attempt < maxAttempts &&
          isRetryableStatus(status, retryOn) &&
          !opts.firstChunkSeen();

        if (!canRetry) {
          break; // move to next target
        }

        const backoff = computeBackoff(attempt, baseDelayMs, maxDelayMs);
        await sleep(backoff);
      }
    }
  }

  throw lastError;
}
