/**
 * Pure helpers for the chat render path (Phase 3c). Extracted from app.ts so the
 * "what do we paint, and did it actually change" decision is unit-testable
 * without a blessed screen.
 *
 * The optimization: blessed's box.setContent() re-tokenizes whatever string you
 * hand it, so during streaming the old code called setContent(transcript + tail)
 * on every token — re-tokenizing the entire transcript each time. By memoizing
 * the last rendered body and skipping setContent when the composed string is
 * unchanged, redundant paints (multiple scheduleRender() coalesced to the same
 * body, or a stream token that produced identical output) become a no-op instead
 * of a full re-tokenize.
 */

export interface ChatRenderInput {
  /** The committed transcript string (baked assistant/user/tool blocks). */
  transcript: string;
  /** The in-progress assistant text, un-escaped. Empty when not streaming. */
  streamRaw: string;
  /** True while an assistant message is streaming (a live tail is appended). */
  streaming: boolean;
  /** Renders the streaming raw text into a card. Injected so this stays pure. */
  renderAssistantCard: (raw: string) => string;
}

/**
 * Compose the full chat body string for one paint: the committed transcript plus
 * a live assistant card tail when streaming. Pure — no side effects, no blessed.
 */
export function composeChatBody(input: ChatRenderInput): string {
  const tail = input.streaming ? "\n" + input.renderAssistantCard(input.streamRaw) + "\n" : "";
  return input.transcript + tail;
}

/**
 * A memoizing renderer: returns whether the new body differs from the last one
 * painted, and updates the memo. Callers skip the (expensive) box.setContent
 * when this returns false. Encapsulated so the memo can't drift from the check.
 */
export class ChatBodyMemo {
  private last: string | null = null;

  /** True if `body` differs from the last body this returned true for. */
  changed(body: string): boolean {
    if (body === this.last) return false;
    this.last = body;
    return true;
  }

  /** Reset the memo (force the next changed() to be true). For /clear, tab switch. */
  reset(): void {
    this.last = null;
  }
}
