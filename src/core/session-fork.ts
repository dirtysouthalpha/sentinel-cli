/**
 * forkMessages — pure session branching.
 *
 * Copy a conversation up to a turn index, producing a new divergent branch.
 * The original session is untouched — explore alternatives without losing the
 * trunk. Deep-copies messages so edits to the fork don't leak back.
 *
 * Pure: no session-manager dependency, no I/O. Fully tested.
 */

export interface ForkableMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * Fork a conversation: return a deep copy of all messages up to and including
 * `upToIndex`. The caller creates a new session from the forked messages.
 * Index is clamped to [0, length-1].
 */
export function forkMessages(messages: ForkableMessage[], upToIndex: number): ForkableMessage[] {
  if (messages.length === 0) return [];
  const idx = Math.max(-1, Math.min(upToIndex, messages.length - 1));
  if (idx < 0) return [];
  // Deep copy via JSON round-trip — messages are plain data (string + metadata),
  // so this is safe and isolates the fork from the original.
  return JSON.parse(JSON.stringify(messages.slice(0, idx + 1))) as ForkableMessage[];
}
