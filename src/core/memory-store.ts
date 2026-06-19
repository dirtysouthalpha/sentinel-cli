/**
 * Persistent memory store — the agent's cross-session memory.
 *
 * Pure CRUD logic (addEntryPure, queryPure, capEntries) is testable without any
 * filesystem. The MemoryStore class wraps it over an injected reader/writer so
 * production wires in real file I/O and tests wire in an in-memory backend.
 *
 * This closes the "agent forgets everything between sessions" gap. Facts,
 * decisions, and preferences the agent stores here survive to the next session.
 */

export type MemoryRegion = "knowledge" | "context" | "preference" | "decision";

export interface MemoryEntry {
  id: string;
  topic: string;
  content: string;
  region: MemoryRegion;
  source: string;
  createdAt: number;
}

export interface MemoryBackend {
  read(): MemoryEntry[];
  write(data: MemoryEntry[]): void;
}

/** Append an entry to a log (pure — returns a new array). */
export function addEntryPure(log: MemoryEntry[], entry: MemoryEntry): MemoryEntry[] {
  return [...log, entry];
}

/** Keep only the most recent N entries (pure). */
export function capEntries(log: MemoryEntry[], max: number): MemoryEntry[] {
  if (log.length <= max) return log;
  return log.slice(log.length - max);
}

/**
 * Query the memory log. Matches by topic substring OR content substring, with
 * an optional region filter. Results ranked newest-first. For equal timestamps,
 * later-inserted entries (higher array index) rank first — stable.
 */
export function queryPure(
  log: MemoryEntry[],
  query: string,
  region?: MemoryRegion
): MemoryEntry[] {
  const q = query.toLowerCase().trim();
  return log
    .map((e, idx) => ({ e, idx }))
    .filter(({ e }) => {
      if (region && e.region !== region) return false;
      if (!q) return true;
      return e.topic.toLowerCase().includes(q) || e.content.toLowerCase().includes(q);
    })
    .sort((a, b) => b.e.createdAt - a.e.createdAt || b.idx - a.idx)
    .map(({ e }) => e);
}

/** Generate a unique-ish ID for a memory entry. */
function makeId(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * File-backed memory store. Wraps the pure functions over an injected backend.
 * Production wires in readFileSync/writeFileSync to `.sentinel/memory.json`;
 * tests wire in an in-memory closure.
 */
export class MemoryStore {
  constructor(
    private readonly backend: MemoryBackend,
    private readonly opts: { maxEntries?: number; source?: string } = {}
  ) {}

  /** Add a memory entry. The log is capped to maxEntries (default 500). */
  add(topic: string, content: string, region: MemoryRegion = "knowledge"): MemoryEntry {
    const entry: MemoryEntry = {
      id: makeId(),
      topic,
      content,
      region,
      source: this.opts.source ?? "agent",
      createdAt: Date.now(),
    };
    const log = capEntries(addEntryPure(this.backend.read(), entry), this.opts.maxEntries ?? 500);
    this.backend.write(log);
    return entry;
  }

  /** Query the memory log. Returns matching entries, newest-first. */
  query(query: string, region?: MemoryRegion): MemoryEntry[] {
    return queryPure(this.backend.read(), query, region);
  }

  /** List all entries (newest-first, stable for equal timestamps). */
  list(): MemoryEntry[] {
    return this.backend.read()
      .map((e, idx) => ({ e, idx }))
      .sort((a, b) => b.e.createdAt - a.e.createdAt || b.idx - a.idx)
      .map(({ e }) => e);
  }

  /** Delete an entry by ID. Returns true if it existed. */
  delete(id: string): boolean {
    const log = this.backend.read();
    const next = log.filter((e) => e.id !== id);
    if (next.length === log.length) return false;
    this.backend.write(next);
    return true;
  }
}

/** Build a file-backed MemoryBackend for a project root. */
export function fileBackend(projectRoot: string, memoryFile = ".sentinel/memory.json"): MemoryBackend {
  const path = `${projectRoot}/${memoryFile}`;
  return {
    read(): MemoryEntry[] {
      try {
        const { readFileSync } = require("node:fs");
        return JSON.parse(readFileSync(path, "utf-8")) as MemoryEntry[];
      } catch {
        return [];
      }
    },
    write(data: MemoryEntry[]): void {
      try {
        const { mkdirSync, writeFileSync } = require("node:fs");
        const { dirname } = require("node:path");
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(data, null, 2));
      } catch {
        // best-effort — never crash the agent loop on a memory write
      }
    },
  };
}
