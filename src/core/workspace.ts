import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { createLogger } from "../utils/logger.js";

const log = createLogger({ prefix: "workspace" });

/** A workspace: a set of tracked project roots plus the active one (V18 multi-repo). */
export interface Workspace {
  roots: string[];
  active?: string;
}

/** Default workspace file: `<homedir>/.config/sentinel/workspace.json`. */
export function defaultWorkspacePath(): string {
  return join(homedir(), ".config", "sentinel", "workspace.json");
}

/** Resolve/normalize a path. `~` expands to the home directory. */
function normalizeRoot(path: string): string {
  const trimmed = path.trim();
  if (trimmed.startsWith("~")) {
    return resolve(join(homedir(), trimmed.slice(1)));
  }
  return resolve(trimmed);
}

/**
 * Persisted, testable store for tracking several project roots.
 *
 * Pure aside from the injected file path: pass a tmp file in tests.
 * Reads never throw (a missing/corrupt file yields an empty workspace);
 * mutations persist immediately via `save()`.
 */
export class WorkspaceStore {
  private filePath: string;
  private ws: Workspace = { roots: [] };

  constructor(filePath?: string) {
    this.filePath = filePath || defaultWorkspacePath();
    this.load();
  }

  /** Load from disk. Tolerates a missing/invalid file → empty workspace. Never throws. */
  load(): Workspace {
    if (!existsSync(this.filePath)) {
      this.ws = { roots: [] };
      return this.ws;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf-8")) as Partial<Workspace>;
      const roots = Array.isArray(parsed.roots)
        ? this.dedupe(parsed.roots.filter((r) => typeof r === "string").map(normalizeRoot))
        : [];
      const active =
        typeof parsed.active === "string" ? normalizeRoot(parsed.active) : undefined;
      this.ws = {
        roots,
        active: active && roots.includes(active) ? active : undefined,
      };
    } catch (err) {
      log.warn(`Failed to read workspace from ${this.filePath}: ${err}`);
      this.ws = { roots: [] };
    }
    return this.ws;
  }

  /** Persist the current workspace to disk, creating the parent dir if needed. */
  save(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.ws, null, 2), "utf-8");
    } catch (err) {
      log.warn(`Failed to save workspace to ${this.filePath}: ${err}`);
      throw err;
    }
  }

  /** Add a root (normalized, deduped). Returns the resolved path. Persists. */
  addRoot(path: string): string {
    const root = normalizeRoot(path);
    if (!this.ws.roots.includes(root)) {
      this.ws.roots.push(root);
      this.save();
    }
    return root;
  }

  /** Remove a root. Clears `active` if it pointed there. Returns true if removed. Persists. */
  removeRoot(path: string): boolean {
    const root = normalizeRoot(path);
    const idx = this.ws.roots.indexOf(root);
    if (idx === -1) return false;
    this.ws.roots.splice(idx, 1);
    if (this.ws.active === root) this.ws.active = undefined;
    this.save();
    return true;
  }

  /** All tracked roots (resolved, deduped). */
  listRoots(): string[] {
    return [...this.ws.roots];
  }

  /** Mark a root active, adding it first if not already tracked. Returns the resolved path. Persists. */
  setActive(path: string): string {
    const root = normalizeRoot(path);
    if (!this.ws.roots.includes(root)) this.ws.roots.push(root);
    this.ws.active = root;
    this.save();
    return root;
  }

  /** The active root, or undefined if none is set. */
  getActive(): string | undefined {
    return this.ws.active;
  }

  /** A snapshot of the current workspace. */
  get(): Workspace {
    return { roots: [...this.ws.roots], active: this.ws.active };
  }

  private dedupe(roots: string[]): string[] {
    return Array.from(new Set(roots));
  }
}
