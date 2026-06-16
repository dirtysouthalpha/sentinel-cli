/**
 * Search in Chat - fuzzy search transcript with jump navigation
 */

import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";

export interface SearchResult {
  line: number;
  match: string;
  context: string;
  timestamp?: number;
}

export class ChatSearch {
  private overlay?: blessed.Widgets.BoxElement;
  private input?: blessed.Widgets.TextElement;
  private resultsList?: blessed.Widgets.ListElement;
  private query = "";
  private results: SearchResult[] = [];
  private selectedIndex = 0;
  private transcript = "";

  constructor(private parent: blessed.Widgets.Screen) {}

  search(transcript: string) {
    this.transcript = transcript;
    this.query = "";
    this.results = [];
    this.selectedIndex = 0;
    this.createUI();
    this.update();
    this.overlay!.show();
    this.overlay!.setFront();
    this.input!.focus();
    this.parent.render();
  }

  hideSearch() {
    if (this.overlay) {
      this.overlay.hide();
      this.parent.render();
    }
  }

  private createUI() {
    if (this.overlay) return;

    const c = themeEngine.getBlessedColors();

    this.overlay = blessed.box({
      parent: this.parent,
      left: "center",
      top: "10%",
      width: "60%",
      height: "40%",
      hidden: true,
      border: { type: "line" },
      style: {
        bg: c.bgPrimary,
        fg: c.textPrimary,
        border: { fg: c.accent || c.cyan },
      },
    });

    const title = blessed.text({
      parent: this.overlay,
      top: 0,
      left: 1,
      width: "100%-2",
      height: 1,
      content: `{${c.cyan}-fg}{bold}Search Chat{/} {${c.textTertiary}-fg}(Esc: close · Enter: jump){/}`,
      tags: true,
    });

    this.input = blessed.text({
      parent: this.overlay,
      top: 2,
      left: 1,
      width: "100%-2",
      height: 1,
      content: `{${c.cyan}-fg}❯{/} `,
      tags: true,
      style: { fg: c.textPrimary },
    });

    this.resultsList = blessed.list({
      parent: this.overlay,
      top: 4,
      left: 1,
      width: "100%-2",
      height: "100%-6",
      keys: true,
      vi: true,
      mouse: true,
      scrollable: true,
      style: {
        fg: c.textPrimary,
        bg: c.bgPrimary,
        selected: {
          fg: c.textPrimary,
          bg: c.accent || c.bgSecondary,
          bold: true,
        },
      },
    });

    this.resultsList.on("select", () => this.jumpToResult());
    this.overlay.key(["escape"], () => this.hideSearch());
    this.overlay.key(["C-n"], () => this.nextResult());
    this.overlay.key(["C-p"], () => this.prevResult());
  }

  private update() {
    const c = themeEngine.getBlessedColors();
    this.input!.setContent(`{${c.cyan}-fg}❯{/} ${this.query || "{grey}Search...{/}"}`);

    if (this.query) {
      this.results = this.fuzzySearch(this.transcript, this.query);
      this.selectedIndex = 0;
    } else {
      this.results = [];
    }

    const listItems = this.results.map((result, i) => {
      const match = this.highlightMatch(result.match, this.query);
      return `{${c.textSecondary}-fg}L${result.line}:{/} ${match.slice(0, 60)}${result.match.length > 60 ? "…" : ""}`;
    });

    this.resultsList!.setItems(listItems);
    if (this.results.length > 0) {
      this.resultsList!.select(0);
    }

    this.parent.render();
  }

  private fuzzySearch(transcript: string, query: string): SearchResult[] {
    if (!query) return [];

    const q = query.toLowerCase();
    const lines = transcript.split("\n");
    const results: SearchResult[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const score = this.fuzzyScore(line.toLowerCase(), q);

      if (score > 0) {
        results.push({
          line: i,
          match: line.trim(),
          context: lines[Math.max(0, i - 1)].trim(),
        });
      }
    }

    // Sort by score and limit to 50 results
    return results
      .sort((a, b) => this.fuzzyScore(b.match.toLowerCase(), q) - this.fuzzyScore(a.match.toLowerCase(), q))
      .slice(0, 50);
  }

  private fuzzyScore(text: string, query: string): number {
    if (!query) return 0;
    if (text.startsWith(query)) return 100;
    if (text.includes(query)) return 50;

    let score = 0;
    let queryIdx = 0;
    let textIdx = 0;

    while (queryIdx < query.length && textIdx < text.length) {
      if (text[textIdx] === query[queryIdx]) {
        score += 10;
        queryIdx++;
      } else {
        score -= 1;
      }
      textIdx++;
    }

    if (queryIdx === query.length) {
      score += query.length * 5;
    }

    return Math.max(0, score);
  }

  private highlightMatch(text: string, query: string): string {
    if (!query) return text;
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    let result = "";
    let i = 0;
    let j = 0;

    while (i < text.length && j < q.length) {
      if (t[i] === q[j]) {
        result += `{${themeEngine.getBlessedColors().cyan}-fg}${text[i]}{/}`;
        j++;
      } else {
        result += text[i];
      }
      i++;
    }

    if (i < text.length) {
      result += text.slice(i);
    }

    return result;
  }

  private jumpToResult() {
    if (this.results.length === 0) return;
    const result = this.results[this.selectedIndex];
    this.hideSearch();
    this.parent.emit("search-jump", result);
  }

  private nextResult() {
    if (this.results.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.results.length;
    this.resultsList!.select(this.selectedIndex);
    this.parent.render();
  }

  private prevResult() {
    if (this.results.length === 0) return;
    this.selectedIndex = (this.selectedIndex - 1 + this.results.length) % this.results.length;
    this.resultsList!.select(this.selectedIndex);
    this.parent.render();
  }
}