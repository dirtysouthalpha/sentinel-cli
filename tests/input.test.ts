import { describe, it, expect } from "vitest";
import {
  insertText,
  backspace,
  deleteForward,
  moveLeft,
  moveRight,
  moveHome,
  moveEnd,
  clampCursor,
  parseCsi,
  completeCommand,
  stepHistory,
} from "../src/tui/input.js";

describe("line editing", () => {
  it("inserts at the caret and advances it", () => {
    expect(insertText({ buffer: "ac", cursor: 1 }, "b")).toEqual({ buffer: "abc", cursor: 2 });
    expect(insertText({ buffer: "", cursor: 0 }, "x")).toEqual({ buffer: "x", cursor: 1 });
    expect(insertText({ buffer: "hi", cursor: 2 }, "!")).toEqual({ buffer: "hi!", cursor: 3 });
  });

  it("inserts multi-char runs (pasted text)", () => {
    expect(insertText({ buffer: "ad", cursor: 1 }, "bc")).toEqual({ buffer: "abcd", cursor: 3 });
  });

  it("backspaces the char before the caret, and is a no-op at column 0", () => {
    expect(backspace({ buffer: "abc", cursor: 2 })).toEqual({ buffer: "ac", cursor: 1 });
    expect(backspace({ buffer: "abc", cursor: 0 })).toEqual({ buffer: "abc", cursor: 0 });
    expect(backspace({ buffer: "abc", cursor: 3 })).toEqual({ buffer: "ab", cursor: 2 });
  });

  it("deletes the char at the caret, and is a no-op at end of line", () => {
    expect(deleteForward({ buffer: "abc", cursor: 1 })).toEqual({ buffer: "ac", cursor: 1 });
    expect(deleteForward({ buffer: "abc", cursor: 3 })).toEqual({ buffer: "abc", cursor: 3 });
    expect(deleteForward({ buffer: "abc", cursor: 0 })).toEqual({ buffer: "bc", cursor: 0 });
  });

  it("moves the caret with clamping at both ends", () => {
    expect(moveLeft({ buffer: "abc", cursor: 2 }).cursor).toBe(1);
    expect(moveLeft({ buffer: "abc", cursor: 0 }).cursor).toBe(0);
    expect(moveRight({ buffer: "abc", cursor: 2 }).cursor).toBe(3);
    expect(moveRight({ buffer: "abc", cursor: 3 }).cursor).toBe(3);
    expect(moveHome({ buffer: "abc", cursor: 2 }).cursor).toBe(0);
    expect(moveEnd({ buffer: "abc", cursor: 0 }).cursor).toBe(3);
  });

  it("clampCursor keeps the caret in range", () => {
    expect(clampCursor("abc", -5)).toBe(0);
    expect(clampCursor("abc", 99)).toBe(3);
    expect(clampCursor("abc", 2)).toBe(2);
  });
});

describe("parseCsi", () => {
  it("maps arrow/home/end final bytes", () => {
    expect(parseCsi("A")).toBe("up");
    expect(parseCsi("B")).toBe("down");
    expect(parseCsi("C")).toBe("right");
    expect(parseCsi("D")).toBe("left");
    expect(parseCsi("H")).toBe("home");
    expect(parseCsi("F")).toBe("end");
  });

  it("uses the final byte even with modifier params", () => {
    expect(parseCsi("1;5C")).toBe("right");
    expect(parseCsi("1;2D")).toBe("left");
  });

  it("maps the ~-terminated Home/End/Delete variants", () => {
    expect(parseCsi("1~")).toBe("home");
    expect(parseCsi("7~")).toBe("home");
    expect(parseCsi("4~")).toBe("end");
    expect(parseCsi("8~")).toBe("end");
    expect(parseCsi("3~")).toBe("delete");
  });

  it("returns 'none' for unknown sequences", () => {
    expect(parseCsi("Z")).toBe("none");
    expect(parseCsi("9~")).toBe("none");
    expect(parseCsi("")).toBe("none");
  });
});

describe("completeCommand", () => {
  it("returns none when not a bare /command word", () => {
    expect(completeCommand("hello", ["model"])).toEqual({ kind: "none" });
    expect(completeCommand("/model foo", ["model"])).toEqual({ kind: "none" });
    expect(completeCommand("/zzz", ["model", "mcp"])).toEqual({ kind: "none" });
  });

  it("fills the line on a single match", () => {
    expect(completeCommand("/mod", ["model", "mcp"])).toEqual({
      kind: "single",
      line: "/model ",
      cursor: 7,
    });
  });

  it("is case-insensitive but preserves the command's own casing", () => {
    expect(completeCommand("/MO", ["model"])).toEqual({
      kind: "single",
      line: "/model ",
      cursor: 7,
    });
  });

  it("extends to the longest common prefix on multiple matches", () => {
    expect(completeCommand("/con", ["config", "configure"])).toEqual({
      kind: "multi",
      line: "/config",
      cursor: 7,
      candidates: ["config", "configure"],
    });
  });

  it("lists candidates without extending when the prefix can't grow", () => {
    expect(completeCommand("/s", ["search", "sync"])).toEqual({
      kind: "multi",
      line: null,
      cursor: 0,
      candidates: ["search", "sync"],
    });
  });
});

describe("stepHistory", () => {
  const hist = ["first", "second", "third"];

  it("returns null with empty history", () => {
    expect(stepHistory({ history: [], index: -1, draft: "", buffer: "x" }, -1)).toBeNull();
  });

  it("returns null going newer while already on the fresh line", () => {
    expect(stepHistory({ history: hist, index: -1, draft: "", buffer: "x" }, 1)).toBeNull();
  });

  it("stashes the draft and jumps to the newest entry going older", () => {
    expect(stepHistory({ history: hist, index: -1, draft: "", buffer: "wip" }, -1)).toEqual({
      index: 2,
      draft: "wip",
      line: "third",
    });
  });

  it("walks older then newer through the list", () => {
    expect(stepHistory({ history: hist, index: 2, draft: "wip", buffer: "third" }, -1)).toEqual({
      index: 1,
      draft: "wip",
      line: "second",
    });
    expect(stepHistory({ history: hist, index: 1, draft: "wip", buffer: "second" }, 1)).toEqual({
      index: 2,
      draft: "wip",
      line: "third",
    });
  });

  it("clamps at the oldest entry", () => {
    expect(stepHistory({ history: hist, index: 0, draft: "wip", buffer: "first" }, -1)).toEqual({
      index: 0,
      draft: "wip",
      line: "first",
    });
  });

  it("restores the stashed draft when stepping past the newest entry", () => {
    expect(stepHistory({ history: hist, index: 2, draft: "wip", buffer: "third" }, 1)).toEqual({
      index: -1,
      draft: "wip",
      line: "wip",
    });
  });
});
