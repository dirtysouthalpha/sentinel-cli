import { describe, it, expect } from "vitest";
import { diffBlocks } from "../gui/src/render-diff.js";

// Minimal block shape — diffBlocks keys on identity of a `kind`+`text`/`name`
// proxy; it only needs an array of objects with a stable identity comparison.
type B = { kind: string; text?: string; name?: string; id: number };

describe("diffBlocks (GUI incremental render seam)", () => {
  it("no change → nothing to append, nothing to replace", () => {
    const a: B[] = [{ kind: "user", text: "1", id: 1 }];
    expect(diffBlocks(a, a)).toEqual({ append: [], replaceFrom: a.length });
  });

  it("appends new blocks at the tail", () => {
    const a: B[] = [{ kind: "user", text: "1", id: 1 }];
    const b: B[] = [...a, { kind: "system", text: "2", id: 2 }];
    const d = diffBlocks(a, b);
    expect(d.replaceFrom).toBe(1);
    expect(d.append).toEqual([{ kind: "system", text: "2", id: 2 }]);
  });

  it("detects a tail replacement (edit/regenerate) — common prefix kept", () => {
    // The GUI keeps stable references for unchanged history; the shared user
    // block is the SAME object in both arrays (only the replaced tail is new).
    const user = { kind: "user", text: "1", id: 1 } as B;
    const a: B[] = [user, { kind: "assistant", text: "old", id: 2 }];
    const b: B[] = [user, { kind: "assistant", text: "new", id: 3 }];
    const d = diffBlocks(a, b);
    expect(d.replaceFrom).toBe(1); // user block kept; assistant replaced
    expect(d.append.length).toBe(1);
    expect((d.append[0] as { text: string }).text).toBe("new");
  });

  it("full replace (no common prefix) replaces everything", () => {
    const a: B[] = [{ kind: "user", text: "x", id: 1 }];
    const b: B[] = [{ kind: "system", text: "y", id: 2 }];
    const d = diffBlocks(a, b);
    expect(d.replaceFrom).toBe(0);
    expect(d.append).toEqual([{ kind: "system", text: "y", id: 2 }]);
  });

  it("empty previous → append everything", () => {
    const b: B[] = [{ kind: "user", text: "1", id: 1 }];
    expect(diffBlocks([], b)).toEqual({ append: b, replaceFrom: 0 });
  });
});
