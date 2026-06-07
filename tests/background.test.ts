import { describe, it, expect } from "vitest";
import { BackgroundTaskManager } from "../src/core/background.js";

/** A promise we can resolve/reject from the outside, to drive task lifecycle. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("BackgroundTaskManager", () => {
  it("starts running, then settles to done with the result", async () => {
    const mgr = new BackgroundTaskManager();
    const d = deferred<string>();
    const updates: string[] = [];
    mgr.onUpdate((t) => updates.push(t.status));

    const task = mgr.start("build", () => d.promise);
    expect(task.status).toBe("running");
    expect(mgr.runningCount()).toBe(1);

    d.resolve("compiled ok");
    await Promise.resolve(); // let the .then microtask run
    await Promise.resolve();

    const final = mgr.get(task.id);
    expect(final?.status).toBe("done");
    expect(final?.result).toBe("compiled ok");
    expect(final?.endedAt).toBeGreaterThanOrEqual(final!.startedAt);
    expect(mgr.runningCount()).toBe(0);
    expect(updates).toEqual(["running", "done"]);
  });

  it("captures errors", async () => {
    const mgr = new BackgroundTaskManager();
    const d = deferred<string>();
    const task = mgr.start("flaky", () => d.promise);
    d.reject(new Error("boom"));
    await Promise.resolve();
    await Promise.resolve();
    const t = mgr.get(task.id);
    expect(t?.status).toBe("error");
    expect(t?.error).toBe("boom");
  });

  it("cancel aborts the worker's signal and marks cancelled", async () => {
    const mgr = new BackgroundTaskManager();
    let aborted = false;
    const task = mgr.start("long", (signal) => {
      signal.addEventListener("abort", () => {
        aborted = true;
      });
      return new Promise<string>(() => {}); // never settles on its own
    });
    expect(mgr.cancel(task.id)).toBe(true);
    expect(aborted).toBe(true);
    expect(mgr.get(task.id)?.status).toBe("cancelled");
    // cancelling again is a no-op
    expect(mgr.cancel(task.id)).toBe(false);
  });

  it("a worker that resolves after cancel does not revive the task", async () => {
    const mgr = new BackgroundTaskManager();
    const d = deferred<string>();
    const task = mgr.start("race", () => d.promise);
    mgr.cancel(task.id);
    d.resolve("late");
    await Promise.resolve();
    await Promise.resolve();
    expect(mgr.get(task.id)?.status).toBe("cancelled");
  });

  it("lists tasks with stable ids", () => {
    const mgr = new BackgroundTaskManager();
    mgr.start("a", () => new Promise<string>(() => {}));
    mgr.start("b", () => new Promise<string>(() => {}));
    const ids = mgr.list().map((t) => t.id);
    expect(ids).toEqual(["1", "2"]);
  });
});
