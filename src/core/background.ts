/**
 * Background tasks (V1 orchestration core, final piece). Fire-and-forget long
 * runs — a detached agent prompt or a shell command — that execute while the
 * user keeps working, with status tracking, cancellation, and a completion
 * callback the UI uses to notify. UI-agnostic and fully testable: `start` takes
 * a worker function so the manager never depends on the agent/tool layer.
 */

export type BackgroundStatus = "running" | "done" | "error" | "cancelled";

export interface BackgroundTask {
  id: string;
  label: string;
  status: BackgroundStatus;
  result?: string;
  error?: string;
  startedAt: number;
  endedAt?: number;
}

type Worker = (signal: AbortSignal) => Promise<string>;

export class BackgroundTaskManager {
  private tasks = new Map<string, BackgroundTask>();
  private controllers = new Map<string, AbortController>();
  private listeners: ((task: BackgroundTask) => void)[] = [];
  private seq = 0;

  /** Monotonic id; injectable clock keeps it deterministic for tests. */
  constructor(private now: () => number = () => Date.now()) {}

  onUpdate(fn: (task: BackgroundTask) => void): void {
    this.listeners.push(fn);
  }

  private emit(task: BackgroundTask): void {
    for (const l of this.listeners) l({ ...task });
  }

  start(label: string, worker: Worker): BackgroundTask {
    const id = String(++this.seq);
    const ac = new AbortController();
    const task: BackgroundTask = { id, label, status: "running", startedAt: this.now() };
    this.tasks.set(id, task);
    this.controllers.set(id, ac);
    this.emit(task);

    // Detached: do NOT await. Settle the task when the worker resolves/rejects.
    void worker(ac.signal).then(
      (result) => this.settle(id, "done", { result }),
      (err) => this.settle(id, "error", { error: err instanceof Error ? err.message : String(err) })
    );

    return { ...task };
  }

  private settle(id: string, status: BackgroundStatus, extra: { result?: string; error?: string }): void {
    const task = this.tasks.get(id);
    if (!task || task.status !== "running") return; // already cancelled/settled
    task.status = status;
    task.endedAt = this.now();
    if (extra.result !== undefined) task.result = extra.result;
    if (extra.error !== undefined) task.error = extra.error;
    this.controllers.delete(id);
    this.emit(task);
  }

  cancel(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.status !== "running") return false;
    this.controllers.get(id)?.abort();
    task.status = "cancelled";
    task.endedAt = this.now();
    this.controllers.delete(id);
    this.emit(task);
    return true;
  }

  get(id: string): BackgroundTask | undefined {
    const t = this.tasks.get(id);
    return t ? { ...t } : undefined;
  }

  list(): BackgroundTask[] {
    return [...this.tasks.values()].map((t) => ({ ...t }));
  }

  runningCount(): number {
    return [...this.tasks.values()].filter((t) => t.status === "running").length;
  }
}
