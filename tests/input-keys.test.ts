import { describe, it, expect } from "vitest";
import {
  wordBack,
  wordForward,
  killToEnd,
  killToStart,
  killWordBack,
  killWordForward,
} from "../src/tui/input-keys.js";

describe("input-keys editing primitives", () => {
  const line = "the quick brown"; // indices: t0 h1 e2 '3 q4..k9 '10 b11..n14

  it("wordBack jumps to the start of the previous word", () => {
    expect(wordBack(line, 15)).toBe(10); // start of "brown"
    expect(wordBack(line, 10)).toBe(4); // start of "quick"
    expect(wordBack(line, 4)).toBe(0); // start of "the"
  });

  it("wordBack skips trailing whitespace then the word", () => {
    // "foo   bar" : f0 o1 o2 '3 '4 '5 b6 a7 r8 — cursor 8 → start of "bar" = 6
    expect(wordBack("foo   bar", 8)).toBe(6);
  });

  it("wordBack stays at 0 at BOL", () => {
    expect(wordBack(line, 0)).toBe(0);
  });

  it("wordForward jumps to the start of the next word", () => {
    expect(wordForward(line, 0)).toBe(4); // past "the " to "quick"
    expect(wordForward(line, 4)).toBe(10); // past "quick " to "brown"
  });

  it("wordForward clamps at end when no next word", () => {
    expect(wordForward(line, 10)).toBe(15); // "brown" then EOL
  });

  it("killToEnd removes from cursor to EOL", () => {
    expect(killToEnd(line, 4)).toEqual({ line: "the ", cursor: 4 });
  });

  it("killToStart removes from BOL to cursor, keeps tail", () => {
    expect(killToStart(line, 10)).toEqual({ line: "brown", cursor: 0 });
  });

  it("killWordBack deletes the word before the cursor", () => {
    expect(killWordBack(line, 15)).toEqual({ line: "the quick ", cursor: 10 });
  });

  it("killWordBack at BOL is a no-op", () => {
    expect(killWordBack(line, 0)).toEqual({ line, cursor: 0 });
  });

  it("killWordForward deletes the word after the cursor", () => {
    expect(killWordForward(line, 0)).toEqual({ line: "quick brown", cursor: 0 });
  });

  it("killWordForward skips a following word plus its trailing space", () => {
    // cursor at start of "quick" (4) -> removes "quick " leaving "the brown"
    expect(killWordForward(line, 4)).toEqual({ line: "the brown", cursor: 4 });
  });
});
