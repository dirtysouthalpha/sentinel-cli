import type { ToolCall } from "../ai/types.js";

export class StuckDetector {
  private readonly history: string[] = [];
  private readonly threshold: number;

  constructor(threshold: number = 3) {
    this.threshold = threshold;
  }

  record(toolCall: ToolCall): void {
    this.history.push(`${toolCall.name}:${toolCall.arguments}`);
    if (this.history.length > 100) {
      this.history.splice(0, this.history.length - 100);
    }
  }

  isStuck(): boolean {
    const n = this.history.length;
    // Exact repeat: the last `threshold` calls are all identical.
    if (n >= this.threshold) {
      const tail = this.history.slice(-this.threshold);
      if (tail.every((fp) => fp === tail[0])) return true;
    }
    // Two-cycle oscillation: A, B, A, B — bouncing between two calls without
    // progress (e.g. read X, edit X, read X, edit X with the same args).
    if (n >= 4) {
      const [a, b, c, d] = this.history.slice(-4);
      if (a === c && b === d && a !== b) return true;
    }
    return false;
  }

  reset(): void {
    this.history.length = 0;
  }
}
