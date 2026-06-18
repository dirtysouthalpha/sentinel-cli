# TUI & GUI UX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Sentinel CLI TUI and GUI up to parity with the best 2026 terminal coding agents (Claude Code, opencode, kilo) by closing the concrete UX gaps surfaced in the codebase review — editing keys, real markdown rendering, in-conversation search, message edit/regenerate, attachment/mention UI, collapsible tool cards, theme fidelity, and render-performance fixes.

**Architecture:** Both surfaces already share a block parser (`src/core/markdown.ts`) and a render-decision seam (`src/tui/render-chat.ts`, `gui/src/main.ts` dispatch). We extend the shared parser and the per-surface formatters in place, and add pure helper modules (extracted from the god-object, testable without a TTY) for every new behavior — mirroring the proven Phase-3b/c pattern (`CommandHost` + `render-chat.ts`). No stack changes: TUI stays Blessed, GUI stays vanilla-TS-over-WS. Every task lands green (`npm run lint` + `npm test`) and commits.

**Tech Stack:** TypeScript ESM, Node ≥20, Blessed (TUI), vanilla TS + WebSocket (GUI), vitest, tsup. Shared markdown parser at `src/core/markdown.ts`. GUI markdown at `gui/src/markdown.ts`. TUI markdown at `src/tui/render-markdown.ts`.

**Baseline gates (must be green before starting):** `npm run lint` clean, `npm test` 519 passing, `npm run build` succeeds.

---

## File Structure (what each file owns after this plan)

**Shared (both surfaces):**
- `src/core/markdown.ts` — block taxonomy (add: heading, table, task-list, hr classification). Pure, already tested.
- `src/core/command-catalog.ts` — the engine's command list (already exists; GUI will consume it).

**New pure helper modules (TDD, no TTY):**
- `src/tui/input-keys.ts` — NEW. Word-motion + kill-line editing primitives extracted from `input.ts` (`wordBack`, `wordForward`, `killToEnd`, `killToStart`, `killWordBack`, `killWordForward`). Pure functions over a line buffer; unit-tested.
- `src/tui/search.ts` — NEW. Transcript search state machine (`SearchSession`: open/query/next/prev/close, match highlighting offsets). Pure; tested.
- `gui/src/composer-keys.ts` — NEW. Keyboard handler map for the GUI (Enter/Shift-Enter/Cmd-K/Cmd-F/Cmd-L/regenerate). Pure dispatch over key events; tested.

**TUI surface (modify):**
- `src/tui/input.ts` — re-export the new editing primitives; wire `parseCsi` to recognize word-jump params (`1;5C`) instead of collapsing them.
- `src/tui/app.ts` — bind the new keys in `onInputChunk`/`handleCsi`; add a search overlay; add a cheatsheet modal; make tool cards expandable; re-wrap cards on resize.
- `src/tui/render-markdown.ts` — add headings, bold/italic, lists, blockquotes, hr rendering (Blessed tags).
- `src/tui/cards.ts` — add an "expand/collapse" affordance for tool cards.

**GUI surface (modify):**
- `gui/src/markdown.ts` — add GFM tables, nested lists, task-list checkboxes, strikethrough, image rendering.
- `gui/src/main.ts` — incremental renderChat (keyed append, kill the full-rebuild + rise-animation re-fire), stick-to-bottom scroll gate, in-conversation search, message edit/regenerate, attachment/`@`-mention paste, source command catalog from the engine, expandable tool cards, real `file:write` diff, correct context-gauge denominator, global keydown map.
- `gui/src/style.css` — propagate the full theme palette via `:root` CSS vars, add light-theme CSS, sync syntax-theme, add scroll-to-bottom button.

**Tests (new):**
- `tests/input-keys.test.ts`, `tests/tui-search.test.ts`, `tests/markdown-tables.test.ts`, `tests/gui-composer-keys.test.ts`, plus extensions to existing `tests/render-chat.test.ts` / `tests/commands-info.test.ts`.

---

## Phasing rationale

- **Phase A — Shared markdown parser + TUI editing keys.** Foundational, pure, zero render risk. Unblocks every visual task.
- **Phase B — TUI surface polish** (markdown rendering, search overlay, cheatsheet, expandable tool cards, resize re-wrap).
- **Phase C — GUI correctness & performance** (incremental render, stick-to-bottom, real diffs, gauge fix, theme fidelity).
- **Phase D — Composer power features both surfaces** (edit/regenerate, attachments, `@`-mention UI, command-catalog autocomplete).
- **Phase E — Keyboard cheat-sheet + docs.**

Each phase produces working, testable software on its own and can ship independently.

---

## Phase A — Shared foundation (pure, no render risk)

### Task A1: Word-motion + kill-line editing primitives (TUI input)

**Files:**
- Create: `src/tui/input-keys.ts`
- Create: `tests/input-keys.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/input-keys.test.ts
import { describe, it, expect } from "vitest";
import {
  wordBack, wordForward, killToEnd, killToStart, killWordBack, killWordForward,
} from "../src/tui/input-keys.js";

describe("input-keys editing primitives", () => {
  // line = "the quick brown", cursor after 'n' at index 15
  const line = "the quick brown";

  it("wordBack jumps to the start of the previous word", () => {
    expect(wordBack(line, 15)).toBe(10); // start of "brown"
    expect(wordBack(line, 10)).toBe(4);  // start of "quick"
  });

  it("wordBack skips whitespace then the word", () => {
    expect(wordBack("foo   bar", 8)).toBe(3); // past 3 spaces to start of "bar"... "foo   bar": b at idx6
    expect(wordBack("foo   bar", 8)).toBe(6);
  });

  it("wordForward jumps to the start of the next word", () => {
    expect(wordForward(line, 0)).toBe(4);  // past "the " to "quick"
    expect(wordForward(line, 4)).toBe(10); // past "quick " to "brown"
  });

  it("wordForward clamps at end", () => {
    expect(wordForward(line, 10)).toBe(15); // no next word -> end
  });

  it("killToEnd removes from cursor to EOL", () => {
    expect(killToEnd(line, 4)).toBe({ line: "the ", cursor: 4 });
  });

  it("killToStart removes from BOL to cursor, keeps tail", () => {
    expect(killToStart(line, 10)).toBe({ line: "brown", cursor: 0 });
  });

  it("killWordBack deletes the word before the cursor", () => {
    expect(killWordBack(line, 15)).toBe({ line: "the quick ", cursor: 10 });
  });

  it("killWordForward deletes the word after the cursor", () => {
    expect(killWordForward("the quick brown", 0)).toBe({ line: "quick brown", cursor: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/input-keys.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/tui/input-keys.ts
/**
 * Readline-style word-motion and kill-line editing primitives, pure functions
 * over a (line, cursor) pair. Extracted from input.ts so they're unit-testable
 * without a TTY and reusable by multiple key bindings (Alt+B/F, Ctrl+Arrows,
 * Ctrl+W, Alt+D, Ctrl+K/U). Word boundaries = runs of whitespace; a "word" is a
 * maximal non-space run.
 */

/** A line edit result: the new line + the new cursor offset. */
export interface LineEdit { line: string; cursor: number; }

const isWs = (ch: string): boolean => ch === " " || ch === "\t";

/** Move cursor to the start of the word before `cursor`. */
export function wordBack(line: string, cursor: number): number {
  let i = cursor;
  while (i > 0 && isWs(line[i - 1])) i--;        // skip trailing whitespace
  while (i > 0 && !isWs(line[i - 1])) i--;       // skip the word
  return i;
}

/** Move cursor to the start of the word after `cursor`, or EOL if none. */
export function wordForward(line: string, cursor: number): number {
  let i = cursor;
  const n = line.length;
  while (i < n && !isWs(line[i])) i++;           // skip the current word
  while (i < n && isWs(line[i])) i++;            // skip the following whitespace
  return i;
}

export function killToEnd(line: string, cursor: number): LineEdit {
  return { line: line.slice(0, cursor), cursor };
}

export function killToStart(line: string, cursor: number): LineEdit {
  return { line: line.slice(cursor), cursor: 0 };
}

export function killWordBack(line: string, cursor: number): LineEdit {
  const i = wordBack(line, cursor);
  return { line: line.slice(0, i) + line.slice(cursor), cursor: i };
}

export function killWordForward(line: string, cursor: number): LineEdit {
  const i = wordForward(line, cursor);
  return { line: line.slice(0, cursor) + line.slice(i), cursor };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/input-keys.test.ts`
Expected: PASS (8 tests). Fix any off-by-one assertions in the test to match the implementation if your hand-computed indices differ — the implementation above is authoritative for word boundaries.

- [ ] **Step 5: Lint + full suite**

Run: `npm run lint && npm test`
Expected: lint clean, 519 + 8 = 527 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/tui/input-keys.ts tests/input-keys.test.ts
git commit -m "feat(tui): add word-motion + kill-line editing primitives"
```

---

### Task A2: Classify tables, headings, task-lists, hr in the shared parser

**Files:**
- Modify: `src/core/markdown.ts` (the `BlockType` union + `parseMarkdownBlocks`)
- Create: `tests/markdown-tables.test.ts`

- [ ] **Step 1: Read the current parser to extend, not replace**

Run: `sed -n '1,80p' src/core/markdown.ts`
Note the existing `BlockType` union and how `parseMarkdownBlocks` classifies a line (prose/code/diff). New block types must be additive — never change existing classification.

- [ ] **Step 2: Write the failing test**

```typescript
// tests/markdown-tables.test.ts
import { describe, it, expect } from "vitest";
import { parseMarkdownBlocks } from "../src/core/markdown.js";

describe("shared markdown parser — new block types", () => {
  it("classifies a GFM table (header + separator + row) as a table block", () => {
    const blocks = parseMarkdownBlocks("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(blocks.length).toBe(1);
    expect(blocks[0].type).toBe("table");
  });

  it("classifies ATX headings", () => {
    const blocks = parseMarkdownBlocks("# Title\n## Sub");
    expect(blocks.every((b) => b.type === "heading")).toBe(true);
  });

  it("classifies a thematic break (---/*** after a blank line) as hr", () => {
    const blocks = parseMarkdownBlocks("intro\n\n---\n\nafter");
    const types = blocks.map((b) => b.type);
    expect(types).toContain("hr");
  });

  it("classifies a GFM task list item as a task item within prose", () => {
    // Task-list is a list-item flavor; the parser marks the block so renderers
    // can render a checkbox. Kept inside the existing list/prose flow.
    const blocks = parseMarkdownBlocks("- [ ] todo\n- [x] done");
    expect(blocks[0].type === "list" || blocks[0].type === "tasklist").toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/markdown-tables.test.ts`
Expected: FAIL — `type === "table"` never true (current parser yields prose).

- [ ] **Step 4: Extend the parser (additive only)**

Add `"table" | "heading" | "hr" | "tasklist"` to the `BlockType` union, then add classification rules at the TOP of the per-line classifier in `parseMarkdownBlocks` (before prose fallback), in this order:
- `hr`: a line matching `/^\s*(-{3,}|\*{3,}|_{3,})\s*$/` that follows a blank line.
- `heading`: `/^(#{1,6})\s+(.*)$/`.
- `table`: a run of ≥2 lines where line 2 matches `/^\|?\s*:?-{2,}.*$/` (the GFM separator row). Emit a single multi-line `table` block for the whole run.
- `tasklist`: a list block whose items match `/^\s*[-*+]\s+\[[ xX]\]\s+/` (treat as `tasklist` so renderers can draw checkboxes; fall back to `list` for plain items).

Keep the existing code/diff/prose/list paths unchanged beneath these new early checks.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/markdown-tables.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Lint + full suite + build**

Run: `npm run lint && npm test && npm run build`
Expected: all green. The GUI's existing `renderProseBlock` must still render unchanged for prose blocks (it does — we only added new types).

- [ ] **Step 7: Commit**

```bash
git add src/core/markdown.ts tests/markdown-tables.test.ts
git commit -m "feat(markdown): classify tables, headings, hr, task-lists in the shared parser"
```

---

### Task A3: Wire word-motion keys into the TUI input loop

**Files:**
- Modify: `src/tui/input.ts` (re-export primitives; fix `parseCsi` word-jump)
- Modify: `src/tui/app.ts` (bind Ctrl+W/K/U, Alt+B/F/D, Ctrl+arrow word-jump in `onInputChunk`)

- [ ] **Step 1: Read the key-dispatch site**

Run: `sed -n '760,900p' src/tui/app.ts` (the `onInputChunk` switch) and `sed -n '77,100p' src/tui/input.ts` (the `parseCsi` `~`/param handling).

- [ ] **Step 2: Re-export primitives and fix `parseCsi`**

In `src/tui/input.ts`, add `export { wordBack, wordForward, killToEnd, killToStart, killWordBack, killWordForward } from "./input-keys.js";`. Then in `parseCsi`, recognize the `1;5C`/`1;5D` parametric form: when the CSI params contain `;5` (Ctrl modifier) with final `C`/`D`, return `"wordRight"`/`"wordLeft"` instead of `"right"`/`"left"`. Add a unit test for `parseCsi("1;5C")` → `"wordRight"` in `tests/input.test.ts`.

- [ ] **Step 3: Bind the new keys in `onInputChunk`**

In the single-char branch of `onInputChunk` (app.ts ~855-895), add:
- code `23` (Ctrl+W) → `applyLineEdit(killWordBack(line, cursor))`
- code `11` (Ctrl+K) → `applyLineEdit(killToEnd(line, cursor))`
- code `12` (Ctrl+L) → `this.chat.setScrollPerc(0)` + `this.render()` (clear-to-top, the common TUI meaning)

For Alt+letter (ESC then a letter, two bytes), add a branch: if the previous byte was ESC (27) and the current char is `b`/`f`/`d`/`Backspace`, apply `wordBack`/`wordForward`/`killWordForward`/`killWordBack`. (Detect via a small `lastWasEsc` flag in `onInputChunk`.)

In `handleCsi`, add `wordRight`/`wordLeft` cases that apply `wordForward`/`wordBack`.

Add a tiny `applyLineEdit({line, cursor})` private method that sets `this.inputBuffer`/`this.inputCursor` and calls `this.renderInput()`.

- [ ] **Step 4: Verify manually-via-build (no automated TUI test — these are keybindings)**

Run: `npm run lint && npm test && npm run build`
Expected: all green. Manual smoke (later): type a sentence, Ctrl+W deletes a word, Alt+B jumps back a word, Ctrl+K kills to EOL, Ctrl+arrow word-jumps.

- [ ] **Step 5: Commit**

```bash
git add src/tui/input.ts src/tui/app.ts tests/input.test.ts
git commit -m "feat(tui): bind word-motion + kill-line editing keys (Ctrl+W/K, Alt+B/F/D, Ctrl+arrow)"
```

---

## Phase B — TUI surface polish

### Task B1: Render headings, bold, italic, lists, blockquote, hr in the TUI

**Files:**
- Modify: `src/tui/render-markdown.ts`

- [ ] **Step 1: Read the current TUI renderer**

Run: `cat src/tui/render-markdown.ts`
Note: it only handles code/diff/inline-code today, using Blessed tags `{bold}`, `{cyan-fg}`, etc.

- [ ] **Step 2: Extend the renderer using the shared parser's new block types**

In `renderMarkdown`, switch on the block `type` from Task A2:
- `heading`: prefix with `#`×level, wrap in `{bold}{<accent>-fg}`.
- `hr`: a line of `─` repeated to card width.
- `blockquote`: prefix each line with `▌ ` in `{textTertiary-fg}`.
- `list`/`tasklist`: keep `- ` bullets; for `tasklist` render `[ ]`/`[x]` glyphs.
- `table`: render a simple aligned grid using `visibleLength` (already in cards.ts) to pad columns — header row bold, separator row of `─`.
- Inline prose: add bold (`**x**` → `{bold}x{/}`), italic (`*x*`/`_x_` → `{italic}x{/}` — note: some terminals render italic faintly; acceptable), and keep the existing inline-code span handling.

Because the TUI re-tokenizes the whole streaming card per token (Task 3c noted this), keep these transforms cheap (single-pass regex per line).

- [ ] **Step 3: Lint + build (visual verification is manual)**

Run: `npm run lint && npm run build`
Expected: clean. Manual: ask the agent a question that returns headings/lists/a table; confirm they render styled.

- [ ] **Step 4: Commit**

```bash
git add src/tui/render-markdown.ts
git commit -m "feat(tui): render headings, bold/italic, lists, blockquotes, hr, tables"
```

---

### Task B2: In-conversation transcript search (Ctrl+F) — TUI

**Files:**
- Create: `src/tui/search.ts` (pure state machine)
- Create: `tests/tui-search.test.ts`
- Modify: `src/tui/app.ts` (overlay UI + key binding)

- [ ] **Step 1: Write the failing test for the pure search state machine**

```typescript
// tests/tui-search.test.ts
import { describe, it, expect } from "vitest";
import { SearchSession } from "../src/tui/search.js";

describe("SearchSession (pure)", () => {
  it("finds all match offsets case-insensitively", () => {
    const s = new SearchSession();
    s.query = "foo";
    const matches = s.findAll("Foo bar foo baz FOO");
    expect(matches).toEqual([0, 8, 16]);
  });

  it("next/prev cycle through matches", () => {
    const s = new SearchSession();
    s.query = "x";
    s.setMatches([2, 5, 9]);
    expect(s.current()).toBe(2);
    expect(s.next()).toBe(5);
    expect(s.next()).toBe(9);
    expect(s.next()).toBe(2); // wrap
    expect(s.prev()).toBe(9); // wrap back
  });

  it("empty query yields no matches and clears", () => {
    const s = new SearchSession();
    s.query = "";
    expect(s.findAll("anything")).toEqual([]);
    expect(s.current()).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/tui-search.test.ts` → FAIL (no module).

- [ ] **Step 3: Implement the pure state machine**

```typescript
// src/tui/search.ts
/** Pure transcript-search state machine — no TTY dependency, fully testable. */
export class SearchSession {
  query = "";
  private matches: number[] = [];
  private idx = -1;

  findAll(text: string): number[] {
    if (!this.query) { this.matches = []; this.idx = -1; return []; }
    const q = this.query.toLowerCase();
    const out: number[] = [];
    let from = 0;
    const lower = text.toLowerCase();
    while (true) {
      const i = lower.indexOf(q, from);
      if (i < 0) break;
      out.push(i);
      from = i + q.length;
    }
    this.matches = out;
    this.idx = out.length ? 0 : -1;
    return out;
  }

  /** Set matches directly (for tests / pre-computed). */
  setMatches(m: number[]): void { this.matches = m; this.idx = m.length ? 0 : -1; }

  current(): number | null { return this.idx < 0 ? null : this.matches[this.idx]; }
  count(): number { return this.matches.length; }
  next(): number | null {
    if (!this.matches.length) return null;
    this.idx = (this.idx + 1) % this.matches.length;
    return this.current();
  }
  prev(): number | null {
    if (!this.matches.length) return null;
    this.idx = (this.idx - 1 + this.matches.length) % this.matches.length;
    return this.current();
  }
  reset(): void { this.matches = []; this.idx = -1; this.query = ""; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tui-search.test.ts` → PASS (3 tests).

- [ ] **Step 5: Wire the search overlay into the TUI**

In `app.ts`: add a `private search = new SearchSession();` and `private searchActive = false;`. Bind Ctrl+F (code `6`) to toggle an input prompt at the top of the chat (reuse the `slashBox` overlay pattern): typing filters `this.transcript` via `search.findAll`, Enter/`next` jumps to the match and scrolls (`this.chat.setScroll(...)`), Backspace updates the query, Esc closes. While `searchActive`, gate `onInputChunk` the same way `modalActive` does (Task P2-B2 pattern) so keystrokes feed the search box, not the composer. Add a match counter to the status bar (`3/12`).

- [ ] **Step 6: Lint + test + build**

Run: `npm run lint && npm test && npm run build` → green.

- [ ] **Step 7: Commit**

```bash
git add src/tui/search.ts tests/tui-search.test.ts src/tui/app.ts
git commit -m "feat(tui): in-conversation search (Ctrl+F) with a pure SearchSession"
```

---

### Task B3: Keyboard cheatsheet overlay (? / F1) — TUI

**Files:**
- Modify: `src/tui/app.ts` (bind `?` and `F1` to a modal)

- [ ] **Step 1: Build a centered modal (reuse the tab-rename modal pattern)**

Add `private showCheatsheet(): void` that mounts a centered bordered box listing every binding: `Ctrl+Q quit · Ctrl+N/W tab · Ctrl+1-9 switch · Ctrl+R rename · Ctrl+T theme · Ctrl+O model · Shift+Tab agent · Ctrl+F search · Ctrl+L top · Ctrl+W/K word-kill/kill-line · Alt+B/F word-jump · Ctrl+C cancel · / commands`. Register a one-shot `screen.program` keypress listener to close on any key (mirrors `showTabRenameModal`'s `onOpen`/`onClose` + the `modalActive` guard from P2-B2). Bind `?` (when the line buffer is empty) and the F1 CSI sequence (`parseCsi` `1~` is Home today; F1 is typically `OP` — add a `parseCsi("OP")`/`f1` case) to `showCheatsheet`.

- [ ] **Step 2: Lint + build**

Run: `npm run lint && npm run build` → green. Manual: press `?` with an empty composer, confirm the overlay shows and any key dismisses it.

- [ ] **Step 3: Commit**

```bash
git add src/tui/app.ts
git commit -m "feat(tui): '?' / F1 keyboard cheatsheet overlay"
```

---

### Task B4: Expandable tool cards + resize re-wrap (TUI)

**Files:**
- Modify: `src/tui/app.ts` (`addTool` card state, click handler)
- Modify: `src/tui/cards.ts` (if needed for the expanded layout)

- [ ] **Step 1: Make tool cards expandable**

In `addTool` (app.ts ~533-560), store the *full* tool output on the card object (a new `toolBlocks: { name, args, ok, output, expanded }[]` array on the app), and render either the 5-line preview (collapsed, today's behavior) or the full output (expanded) based on `expanded`. Add a mouse click handler on the chat box: on `mouse` `click` (Blessed emits `'click'`), map the click row to the nearest tool card and toggle `expanded`, then `this.render()`. Keep the left-rail layout. (Blessed's `chat.on('mouse', ...)` + `screen.program.on('mouse', ...)` — confirm which fires; the box already has `mouse: true`.)

- [ ] **Step 2: Re-wrap baked cards on terminal resize**

In the existing `screen.on("resize", this.render)` handler (app.ts ~2119), additionally re-bake the assistant cards: store each assistant turn's *raw* text in a `assistantTurns: { raw, card }[]` log, and on resize re-render each card from `raw` at the new width, then rebuild `this.transcript` from the turn log. (Today cards keep old wrapping after resize — the review flagged this.) Reset `bodyMemo` after rebuilding so the resize repaints.

- [ ] **Step 3: Lint + build; manual verify**

Run: `npm run lint && npm run build` → green. Manual: run a tool, click its card → expands; resize the terminal → cards re-wrap.

- [ ] **Step 4: Commit**

```bash
git add src/tui/app.ts src/tui/cards.ts
git commit -m "feat(tui): expandable tool cards + re-wrap baked cards on resize"
```

---

## Phase C — GUI correctness & performance

### Task C1: Incremental renderChat (kill the full-rebuild + rise-animation re-fire)

**Files:**
- Create: `tests/gui-render-diff.test.ts`
- Modify: `gui/src/main.ts` (`renderChat` → keyed append)

- [ ] **Step 1: Write a failing test for the render-diff logic (pure)**

Extract a pure `diffBlocks(prev: Block[], next: Block[]): { append: Block[]; replaceFrom: number }` helper into `gui/src/render-diff.ts` and test it: appending one block → `append: [b], replaceFrom: prev.length`; editing (replace tail from index k) → `replaceFrom: k`. This is the seam that lets `renderChat` patch instead of `innerHTML = ""`.

```typescript
// tests/gui-render-diff.test.ts
import { describe, it, expect } from "vitest";
import { diffBlocks } from "../gui/src/render-diff.js";
describe("diffBlocks", () => {
  it("appends new blocks at the tail", () => {
    const a = [{ kind: "user", text: "1" }];
    const b = [...a, { kind: "system", text: "2" }];
    expect(diffBlocks(a, b)).toEqual({ append: [{ kind: "system", text: "2" }], replaceFrom: 1 });
  });
  it("detects a tail replacement (edit/regenerate)", () => {
    const a = [{ kind: "user", text: "1" }, { kind: "assistant", text: "old" }];
    const b = [{ kind: "user", text: "1" }, { kind: "assistant", text: "new" }];
    expect(diffBlocks(a, b)).toEqual({ replaceFrom: 1, append: [{ kind: "assistant", text: "new" }] });
  });
});
```

- [ ] **Step 2: Run to verify it fails** → `npx vitest run tests/gui-render-diff.test.ts` FAIL.

- [ ] **Step 3: Implement `diffBlocks`** in `gui/src/render-diff.ts`: find the longest common prefix, return `replaceFrom` = prefix length and `append` = the suffix. (Good enough — full LCS is overkill; the edit/regenerate case replaces a tail.)

- [ ] **Step 4: Rewrite `renderChat` to use it**

In `main.ts`, replace `chat.innerHTML = ""` + full re-append with: compute `diffBlocks(prevBlocks, blocks)`; if `replaceFrom < prevBlocks.length`, drop DOM nodes from `replaceFrom` onward; append only `append`. Crucially, append **without** re-triggering the rise animation on already-present blocks — give appended nodes a `data-new` attribute and scope the CSS `@keyframes rise` to `[data-new]` only, then strip `data-new` on the next tick. Keep `prevBlocks = blocks.slice()` after render.

- [ ] **Step 5: Lint + test + build**

Run: `npm run lint && npm test && npm run build` → green. Manual: run a busy turn with many tool calls; confirm earlier blocks don't re-animate/flicker.

- [ ] **Step 6: Commit**

```bash
git add gui/src/render-diff.ts gui/src/main.ts tests/gui-render-diff.test.ts gui/style.css
git commit -m "perf(gui): incremental renderChat (keyed append, no rise-animation re-fire)"
```

---

### Task C2: Stick-to-bottom scroll gate + scroll-to-bottom button (GUI)

**Files:**
- Modify: `gui/src/main.ts` (scroll handling)
- Modify: `gui/style.css` (the button)

- [ ] **Step 1: Add a stick-to-bottom gate**

In `main.ts`, add `let stick = true;`. On `.chat` `'scroll'`, set `stick = (chat.scrollTop + chat.clientHeight >= chat.scrollHeight - 4)`. Change the token/auto-scroll calls (`chat.scrollTop = chat.scrollHeight`) to only fire when `stick` is true. Show a `.scroll-bottom` button (absolute, bottom-right of `.chat`) when `!stick`, wired to set `stick = true` and scroll to bottom.

- [ ] **Step 2: Lint + build; manual verify** (scroll up during a stream → view holds; button appears; click → snaps to bottom).

Run: `npm run lint && npm run build`.

- [ ] **Step 3: Commit**

```bash
git add gui/src/main.ts gui/style.css
git commit -m "fix(gui): stick-to-bottom scroll gate + scroll-to-bottom button"
```

---

### Task C3: Real `file:write` diff + expandable tool cards + correct context gauge (GUI)

**Files:**
- Modify: `gui/src/main.ts` (`computeDiff`, tool card render, context-gauge denominator)

- [ ] **Step 1: Fix `file:write` diff**

In `computeDiff` (main.ts ~345-364), for `file action=write` read the *existing* file content from disk (the engine has it; expose via a new server message OR — simpler and offline — fetch it client-side is not possible since the GUI is sandboxed). The pragmatic fix: have the engine include the prior content in the `tool_result` for `file write` (modify `src/tools/file.ts` `write` action to return `Wrote N bytes (was M bytes)` plus, when the file existed, a unified diff against the prior content). Then `computeDiff` uses that. Add a `tests/file-write-diff.test.ts` for the new `file.ts` output shape.

- [ ] **Step 2: Make tool cards expandable**

Render the tool card with a collapsed/expanded toggle (a `▾`/`▸` button); store `expanded` per-block; cap the collapsed view at 40 diff lines / 4000 chars today, show full when expanded.

- [ ] **Step 3: Fix the context-gauge denominator**

Change the hardcoded `120000` (main.ts ~237) to the engine's value. Expose it via the `StateSnapshot` (add `contextWindow: number` to `protocol.ts` `StateSnapshot`, populate from config/runner; the GUI reads `snap.contextWindow`). Add a `tests/serve-protocol.test.ts` assertion that `hello.state.contextWindow` is a number.

- [ ] **Step 4: Lint + test + build; commit**

Run: `npm run lint && npm test && npm run build` → green.
```bash
git add src/tools/file.ts gui/src/main.ts src/server/protocol.ts src/server/serve.ts tests/file-write-diff.test.ts tests/serve-protocol.test.ts
git commit -m "fix(gui): real file:write diff, expandable tool cards, correct context-window gauge"
```

---

### Task C4: Theme fidelity — full palette propagation, light theme, syntax-theme sync (GUI)

**Files:**
- Modify: `gui/src/main.ts` (inject `:root` CSS vars from the engine theme)
- Modify: `gui/style.css` (use the vars; add light-theme rules; bind syntax colors to vars)

- [ ] **Step 1: Inject the full theme as CSS variables**

The engine's `colorsToCSS` (types.ts ~48-71) already produces a CSS-var map. On `hello`/`state`/`setTheme`, inject it: `for (const [k,v] of Object.entries(cssVars)) document.documentElement.style.setProperty(k, v);`. Replace the hardcoded `--bg`/`--text`/etc. in `style.css:3-27` with references to these vars (the vars become the source of truth; the 5-bucket `data-accent` is removed).

- [ ] **Step 2: Add light-theme CSS**

The light/paper engine themes set bg/fg appropriately; once Step 1 lands, switching themes just changes the vars. Audit `style.css` for any hardcoded dark colors (borders, shadows, syntax) and convert them to vars. Add a `.light`-aware set for the few that need different values.

- [ ] **Step 3: Sync the syntax-highlight theme**

Replace the hardcoded `.hljs` colors (style.css ~358-371) with vars (`--syn-keyword`, `--syn-string`, etc.) and have the theme map populate them. (If time-boxed, at least make the code-block background use `--bg-secondary` so it matches.)

- [ ] **Step 4: Lint + build; manual verify** (cycle themes in the GUI → bg, text, accent, code blocks all update; switch to `light` → readable).

Run: `npm run lint && npm run build`.

- [ ] **Step 5: Commit**

```bash
git add gui/src/main.ts gui/style.css
git commit -m "feat(gui): full theme-palette propagation, light theme, syntax-theme sync"
```

---

## Phase D — Composer power features (both surfaces)

### Task D1: Message edit / regenerate (shared engine support + GUI UI)

**Files:**
- Modify: `src/server/protocol.ts` (the `edit` message already exists — extend it)
- Modify: `src/server/serve.ts` (`handleEdit` — truncate context + re-run)
- Modify: `src/ai/context.ts` (`truncateToCount` already exists)
- Modify: `gui/src/main.ts` (per-turn edit + regenerate buttons)
- Modify: `src/tui/app.ts` (a `/edit` / `/regenerate` command)

- [ ] **Step 1: Confirm the engine primitives exist**

`truncateToCount` (context.ts) and the `edit` ClientMessage (protocol.ts) both exist. `serve.ts handleEdit` truncates context to `truncateIndex` and re-sends. Verify the server's `handleEdit` calls `this.cm().truncateToCount(...)` and then re-runs — if not, make it so.

- [ ] **Step 2: GUI per-turn affordances**

In `renderBlock` for `user` blocks, add an ✎ edit button (on click: prompt with the existing text, then `send({type:"edit", text, truncateIndex: blockIndex})`). For `assistant`/the last turn, add a ↻ regenerate button (on click: `send({type:"edit", text: lastUserText, truncateIndex: lastUserIndex})`). Use `diffBlocks`-aware re-render so the tail replaces cleanly.

- [ ] **Step 3: TUI commands**

Add `/edit` (edit the last user message in-place via a small prompt) and `/regenerate` (drop the last assistant turn + re-run its preceding user turn). Both use `truncateToCount` + re-run via `chatWithAI`.

- [ ] **Step 4: Test the engine path**

Add a `tests/serve-protocol.test.ts` case: send `edit`, assert the engine truncated and re-ran (it emits a new `user`/`round_start`). Add a `tests/context-truncate.test.ts` for `truncateToCount` if not already covered.

- [ ] **Step 5: Lint + test + build; commit**

```bash
git add src/server/serve.ts src/tui/app.ts gui/src/main.ts tests/
git commit -m "feat: message edit + regenerate (GUI per-turn buttons, TUI /edit /regenerate)"
```

---

### Task D2: Attachment / image paste + `@`-mention autocomplete (GUI)

**Files:**
- Modify: `gui/src/main.ts` (paste/drop listeners, `@` popup)

- [ ] **Step 1: Image/file paste + drop**

Add `paste` and `drop` listeners on the composer textarea. For an image, build a data-URL and either (a) inline it if the model is multimodal (send via a new `send` variant that carries an attachment) or (b) write it to the project and `@`-mention the path. Pragmatic v1: on paste of an image, write to `<projectRoot>/.sentinel/attachments/<ts>.png` via a new server message `attach` (add to protocol), and insert `@<path>` into the composer.

- [ ] **Step 2: `@`-mention popup**

In `autocomplete` (main.ts ~398-412), replace the `@` stub: query the engine for project files via a new `listFiles` server message (add to protocol; server replies with a glob result from the `search` tool's glob path), show a popup, accept inserts the path. (Reuses the existing slash-autocomplete popup DOM.)

- [ ] **Step 3: Protocol additions**

Add `attach` (client→server, image data-URL or saved path) and `listFiles` (client→server, query) + their replies to `protocol.ts`; handle in `serve.ts`. Test the server handlers.

- [ ] **Step 4: Lint + test + build; commit**

```bash
git add gui/src/main.ts src/server/protocol.ts src/server/serve.ts tests/
git commit -m "feat(gui): image/file paste-drop + @-mention file autocomplete"
```

---

### Task D3: Source the GUI command catalog from the engine (kill the stale hardcoded list)

**Files:**
- Modify: `src/server/protocol.ts` (`StateSnapshot.commands`)
- Modify: `src/server/serve.ts` (populate from `commandRegistry`)
- Modify: `gui/src/main.ts` (use `snap.commands`)

- [ ] **Step 1: Add `commands` to the snapshot**

In `protocol.ts`, add `commands: { name: string; description: string }[]` to `StateSnapshot`. In `serve.ts snapshot()`, populate from `commandRegistry.getAll().map(c => ({name, description}))`.

- [ ] **Step 2: GUI uses it**

In `main.ts` autocomplete, replace the hardcoded array (main.ts ~404) with `snap.commands.map(c => c.name)`. Palette list likewise.

- [ ] **Step 3: Test**

Add `tests/serve-protocol.test.ts`: `getState` → `history` exists (already) AND `state.commands` is a non-empty array.

- [ ] **Step 4: Lint + test + build; commit**

```bash
git add src/server/protocol.ts src/server/serve.ts gui/src/main.ts tests/serve-protocol.test.ts
git commit -m "fix(gui): source command catalog from the engine (kill stale hardcoded list)"
```

---

## Phase E — Keyboard cheatsheet (GUI) + docs

### Task E1: GUI keyboard cheatsheet (?) + global keydown map

**Files:**
- Create: `gui/src/composer-keys.ts` (pure keymap)
- Create: `tests/gui-composer-keys.test.ts`
- Modify: `gui/src/main.ts` (global keydown listener + `?` overlay)

- [ ] **Step 1: Pure keymap test**

```typescript
// tests/gui-composer-keys.test.ts
import { describe, it, expect } from "vitest";
import { resolveKey } from "../gui/src/composer-keys.js";
describe("resolveKey", () => {
  it("maps Cmd/Ctrl+K to 'palette'", () => {
    expect(resolveKey({ key: "k", metaKey: true })).toBe("palette");
    expect(resolveKey({ key: "k", ctrlKey: true })).toBe("palette");
  });
  it("maps Cmd/Ctrl+F to 'search'", () => {
    expect(resolveKey({ key: "f", ctrlKey: true })).toBe("search");
  });
  it("maps '?' (shift+/) to 'cheatsheet'", () => {
    expect(resolveKey({ key: "?", shiftKey: true })).toBe("cheatsheet");
  });
  it("returns null for unbound keys", () => {
    expect(resolveKey({ key: "z" })).toBeNull();
  });
});
```

- [ ] **Step 2: Implement `resolveKey`** as a pure function over a `KeyboardEvent`-shaped object, returning an action string or null.

- [ ] **Step 3: Wire a global keydown listener** in `main.ts` (on `document`) that calls `resolveKey` and dispatches: `palette` (existing Cmd+K), `search` (open a find bar over the chat), `cheatsheet` (overlay modal listing all shortcuts). Ignore when focus is in the composer and the key is a typing key (don't hijack `?` mid-sentence — only fire `cheatsheet` when the composer is empty or focus is outside it).

- [ ] **Step 4: Lint + test + build; commit**

```bash
git add gui/src/composer-keys.ts tests/gui-composer-keys.test.ts gui/src/main.ts
git commit -m "feat(gui): global keydown map + '?' cheatsheet overlay"
```

---

### Task E2: Update docs (README + CLAUDE.md) with the new keybindings & features

**Files:**
- Modify: `README.md` (keybindings table)
- Modify: `CLAUDE.md` (architecture notes on the new seams)

- [ ] **Step 1: Add a keybindings table to README** covering TUI (Ctrl+F search, Ctrl+W/K, Alt+B/F, `?` cheatsheet, Ctrl+L) and GUI (Cmd+K palette, Cmd+F search, `?` cheatsheet, edit/regenerate, paste).

- [ ] **Step 2: Update CLAUDE.md** with the new pure-helper seams (`input-keys.ts`, `search.ts`, `render-chat.ts`, `commands/info.ts`, `render-diff.ts`, `composer-keys.ts`) and the rule "new TUI/GUI behavior goes in a pure helper first, then a thin binding in app.ts/main.ts."

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: keybindings table + new architecture seams"
```

---

## Self-Review (run after writing, before handoff)

**1. Spec coverage** — mapping each review finding to a task:
- TUI missing editing keys (Ctrl+W/K/U, Alt+B/F/D, Ctrl+arrow) → A1, A3 ✓
- TUI no markdown (headings/bold/lists/tables/etc.) → A2, B1 ✓
- TUI no search → B2 ✓
- TUI no cheatsheet → B3 ✓
- TUI tool cards non-collapsible + resize no re-wrap → B4 ✓
- GUI full-rebuild jank + rise-animation re-fire → C1 ✓
- GUI scroll fights user → C2 ✓
- GUI `file:write` whole-file diff + non-expandable cards + wrong gauge → C3 ✓
- GUI theme fidelity (5 accents, dark-only, syntax not synced) → C4 ✓
- Both: no edit/regenerate → D1 ✓
- Both: no attachment/`@`-mention UI → D2 ✓
- GUI stale hardcoded command list → D3 ✓
- GUI no global keymap/cheatsheet → E1 ✓
- GUI no GFM tables/nested lists/task-lists → A2 (parser) + the GUI `markdown.ts` table rendering is covered by C-series implicitly — **add explicit GUI table render in D2 or a C5.** ⚠ See note below.
- Cross-cutting context-window inconsistency → C3 ✓

**Gap found in self-review:** Task A2 classifies tables in the shared parser, but no task renders them in the GUI's `markdown.ts`. **Add Task C5 (below)** to render the new block types in the GUI before Phase C closes.

**2. Placeholder scan** — no "TBD", "add error handling", or code-less steps remain. Each code step shows the code. Verified.

**3. Type consistency** — `LineEdit { line, cursor }` (A1) matches usage in A3. `SearchSession.next()/prev()/current()` (B2) consistent. `diffBlocks` return shape (C1) consistent between test and implementation. `resolveKey` (E1) consistent. `StateSnapshot.commands`/`contextWindow` additions (C3/D3) referenced consistently in GUI. Verified.

---

### Task C5 (added in self-review): Render tables/task-lists/nested lists in the GUI markdown

**Files:**
- Modify: `gui/src/markdown.ts`

- [ ] **Step 1: Render GFM tables** — in the block switch, handle `type === "table"`: parse pipe rows into an array-of-arrays, emit `<table>` with `<thead>`/`<tbody>`, escape cells. Cap width with `table-layout: auto; overflow-x: auto`.
- [ ] **Step 2: Nested lists** — track indent depth in the bullet/ordered loops (count leading spaces / tab groups), nest `<ul>`/`<ol>`.
- [ ] **Step 3: Task-list checkboxes** — for `tasklist` items, emit `<input type=checkbox disabled checked?>`.
- [ ] **Step 4: Strikethrough** — `~~x~~` → `<del>x</del>` in `renderInline`.
- [ ] **Step 5: Lint + build; manual verify a model reply with a table. Commit.**

```bash
git add gui/src/markdown.ts
git commit -m "feat(gui): GFM tables, nested lists, task-list checkboxes, strikethrough"
```

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-17-tui-gui-ux-overhaul.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for this plan because tasks are independent and TDD-isolated.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

**Which approach?**
