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

export interface RouterConfig {
  default: string;
  rules?: RouterRule[];
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

  if (filtered.length === 0) {
    return [cfg.default];
  }

  return filtered;
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
