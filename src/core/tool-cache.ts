/**
 * Tool-result cache — memoize deterministic tool calls across turns.
 *
 * Re-reading the same file or re-running the same search re-pays tokens every
 * turn. This cache stores results keyed by (tool + args), with mtime invalidation
 * for file reads (so a file edited between turns isn't served stale) and a TTL
 * for everything else. Side-effecting tools (bash, git, write, memory, pr) are
 * never cached.
 *
 * Pure cache logic (no I/O) — the caller checks mtime and passes it in.
 */

export interface CacheKey {
  tool: string;
  /** JSON-stringified args (the cache key payload). */
  args: string;
}

interface CacheEntry {
  result: string;
  /** File mtime at cache time (for file:read invalidation). Undefined = no mtime check. */
  mtime?: number;
  /** When the entry was cached (for TTL expiry). */
  cachedAt: number;
}

/** Should this tool call be cached? Only deterministic reads/searches/fetches. */
export function shouldCache(tool: string, args: Record<string, unknown>): boolean {
  if (tool === "file") {
    const action = String(args.action ?? "");
    return action === "read" || action === "exists" || action === "list";
  }
  if (tool === "search") return true;
  if (tool === "web") return !!args.url; // only GET-equivalent fetches
  return false;
}

export class ToolResultCache {
  private cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;

  constructor(opts: { ttlMs?: number } = {}) {
    this.ttlMs = opts.ttlMs ?? 5 * 60 * 1000; // 5 min default
  }

  private key(k: CacheKey): string {
    return `${k.tool}::${k.args}`;
  }

  /** Get a cached result. Pass `mtime` for file reads to check staleness. */
  get(k: CacheKey, mtime?: number): string | null {
    const entry = this.cache.get(this.key(k));
    if (!entry) return null;
    // TTL expiry.
    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.cache.delete(this.key(k));
      return null;
    }
    // mtime invalidation (file reads).
    if (entry.mtime !== undefined && mtime !== undefined && entry.mtime !== mtime) {
      this.cache.delete(this.key(k));
      return null;
    }
    return entry.result;
  }

  /** Store a result. Pass `mtime` for file reads (the file's current mtime). */
  set(k: CacheKey, result: string, mtime?: number): void {
    this.cache.set(this.key(k), { result, mtime, cachedAt: Date.now() });
  }

  /** Wipe the cache. */
  clear(): void {
    this.cache.clear();
  }

  /** How many entries are cached (for diagnostics). */
  size(): number {
    return this.cache.size;
  }
}
