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
    if (this.history.length < this.threshold) return false;
    const tail = this.history.slice(-this.threshold);
    return tail.every((fp) => fp === tail[0]);
  }

  reset(): void {
    this.history.length = 0;
  }
}
