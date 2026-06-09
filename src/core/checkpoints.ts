import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join, resolve, isAbsolute, dirname } from "path";

/**
 * Lightweight, file-content checkpoints. Before a mutating file/patch tool runs,
 * we snapshot the target's prior content (or record that it did not exist). That
 * lets the user `undo` the last edit or `restore` any checkpoint — a safety net
 * for an auto-executing agent.
 *
 * R2 scope: file-level snapshots for the `file`/`patch` tools. Arbitrary `bash`
 * side effects are NOT captured (noted in the roadmap as a git-snapshot follow-up).
 */

export interface Checkpoint {
  id: string;
  timestamp: number;
  path: string; // path as given to the tool (relative to project root)
  existed: boolean; // false => the file was newly created (undo = delete)
  tool: string;
  label?: string;
}

export class CheckpointManager {
  private readonly storeDir: string;
  private readonly manifestPath: string;
  private manifest: Checkpoint[] = [];
  private seq = 0;

  constructor(private readonly projectRoot: string) {
    this.storeDir = join(projectRoot, ".sentinel", "checkpoints");
    this.manifestPath = join(this.storeDir, "manifest.json");
    this.load();
  }

  private load(): void {
    if (existsSync(this.manifestPath)) {
      try {
        this.manifest = JSON.parse(readFileSync(this.manifestPath, "utf-8"));
      } catch {
        this.manifest = [];
      }
    }
  }

  private persist(): void {
    if (!existsSync(this.storeDir)) mkdirSync(this.storeDir, { recursive: true });
    writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2), "utf-8");
  }

  private abs(path: string): string {
    return isAbsolute(path) ? path : resolve(this.projectRoot, path);
  }

  private snapPath(id: string): string {
    return join(this.storeDir, `${id}.snap`);
  }

  /** Snapshot a file's current content before it is mutated. */
  snapshot(path: string, tool: string, label?: string): Checkpoint {
    const id = `cp_${Date.now()}_${this.seq++}`;
    const abs = this.abs(path);
    const existed = existsSync(abs);

    if (!existsSync(this.storeDir)) mkdirSync(this.storeDir, { recursive: true });
    if (existed) {
      writeFileSync(this.snapPath(id), readFileSync(abs));
    }

    const cp: Checkpoint = { id, timestamp: Date.now(), path, existed, tool, label };
    this.manifest.push(cp);
    this.persist();
    return cp;
  }

  list(): Checkpoint[] {
    return [...this.manifest];
  }

  get(id: string): Checkpoint | undefined {
    return this.manifest.find((c) => c.id === id);
  }

  /** Restore a checkpoint's file to its snapshotted state. Does not pop the manifest. */
  restore(id: string): boolean {
    const cp = this.get(id);
    if (!cp) return false;
    const abs = this.abs(cp.path);
    if (cp.existed) {
      const snap = this.snapPath(id);
      if (!existsSync(snap)) return false;
      const dir = dirname(abs);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(abs, readFileSync(snap));
    } else if (existsSync(abs)) {
      // File was newly created by the agent — undo means remove it.
      rmSync(abs);
    }
    return true;
  }

  /** Restore the most recent checkpoint and drop it from the manifest. */
  undoLast(): Checkpoint | null {
    const cp = this.manifest[this.manifest.length - 1];
    if (!cp) return null;
    this.restore(cp.id);
    this.manifest.pop();
    if (cp.existed) rmSync(this.snapPath(cp.id), { force: true });
    this.persist();
    return cp;
  }

  clear(): void {
    if (existsSync(this.storeDir)) rmSync(this.storeDir, { recursive: true, force: true });
    this.manifest = [];
  }
}
