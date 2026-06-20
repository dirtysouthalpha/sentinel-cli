import { state } from "../core/state.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createLogger } from "../utils/logger.js";

const log = createLogger({ prefix: "compression" });

interface CompressionMessage {
  role: string;
  content: string;
}

const compressionCache = new Map<string, string>();

/**
 * Is Headroom actually available? It's an optional cloud compression service —
 * if the user hasn't authenticated it (no ~/.headroom token dir) or hasn't
 * enabled it, we skip straight to the local fallback instead of spamming WARN
 * with 405s on every tool call. Headroom is an accelerator, not a hard dep.
 *
 * Result is cached for the process lifetime — the token dir won't appear mid-run.
 */
let headroomAvailable: boolean | null = null;
function isHeadroomAvailable(): boolean {
  if (headroomAvailable !== null) return headroomAvailable;
  // Headroom stores its auth token under ~/.headroom/. If that dir doesn't
  // exist, the client has no credentials and every compress() call will 405.
  const tokenDir = process.env.HEADROOM_CONFIG_DIR || join(homedir(), ".headroom");
  headroomAvailable = existsSync(tokenDir);
  if (!headroomAvailable) {
    log.debug("Headroom not authenticated (no ~/.headroom dir) — using local fallback compression");
  }
  return headroomAvailable;
}

function getCacheKey(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

async function doCompress(messages: CompressionMessage[]): Promise<CompressionMessage[]> {
  // Skip the Headroom cloud call entirely when it isn't authenticated — avoids
  // a 405 on every tool call and the WARN spam that comes with it.
  if (!isHeadroomAvailable()) {
    return fallbackCompress(messages);
  }
  try {
    const { compress } = await import("headroom-ai");
    const result = await compress(messages as any);
    return result.messages as CompressionMessage[];
  } catch (err) {
    // A real failure (network, quota) — fall back, but log once at debug so it
    // doesn't spam. The fallback is lossy but always works.
    log.debug(`Headroom compression failed, using fallback: ${err}`);
    return fallbackCompress(messages);
  }
}

function fallbackCompress(messages: CompressionMessage[]): CompressionMessage[] {
  if (messages.length === 0) return messages;

  const originalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);

  const compressed: CompressionMessage[] = [];
  let currentRole = "";
  let currentContent = "";

  for (const msg of messages) {
    if (msg.role === currentRole) {
      currentContent += " " + msg.content.slice(0, Math.ceil(msg.content.length * 0.6));
    } else {
      if (currentContent) {
        compressed.push({ role: currentRole, content: currentContent.trim() });
      }
      currentRole = msg.role;
      currentContent = msg.content.slice(0, Math.ceil(msg.content.length * 0.7));
    }
  }
  if (currentContent) {
    compressed.push({ role: currentRole, content: currentContent.trim() });
  }

  const compressedTokens = compressed.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  updateStats(originalTokens, compressedTokens);

  return compressed;
}

export async function compressToolOutput(output: string, toolName: string): Promise<string> {
  const cacheEnabled = true;
  const cacheKey = getCacheKey(output);

  if (cacheEnabled && compressionCache.has(cacheKey)) {
    return compressionCache.get(cacheKey)!;
  }

  const originalTokens = estimateTokens(output);

  try {
    const messages: CompressionMessage[] = [
      { role: "system", content: `[${toolName} output]\n${output}` },
    ];
    const compressed = await doCompress(messages);
    const result = compressed[0]?.content || output;

    if (cacheEnabled) {
      compressionCache.set(cacheKey, result);
    }

    const compressedTokens = estimateTokens(result);
    updateStats(originalTokens, compressedTokens);

    return result;
  } catch (err) {
    log.warn(`Tool output compression failed for ${toolName}: ${err}`);
    return output;
  }
}

export async function compressMessages(messages: CompressionMessage[]): Promise<CompressionMessage[]> {
  if (messages.length === 0) return messages;

  try {
    const result = await doCompress(messages);
    const originalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    const compressedTokens = result.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    updateStats(originalTokens, compressedTokens);
    return result;
  } catch (err) {
    log.warn(`Message compression failed: ${err}`);
    return messages;
  }
}

function updateStats(originalTokens: number, compressedTokens: number): void {
  const stats = state.get("compressionStats");
  const totalOriginal = stats.originalTokens + originalTokens;
  const totalCompressed = stats.compressedTokens + compressedTokens;
  const savingsPercent = totalOriginal > 0 ? Math.round((1 - totalCompressed / totalOriginal) * 100) : 0;

  state.set("compressionStats", {
    originalTokens: totalOriginal,
    compressedTokens: totalCompressed,
    savingsPercent,
    lastCompressed: Date.now(),
  });
}

export function clearCompressionCache(): void {
  compressionCache.clear();
}

export function getCompressionStats(): { originalTokens: number; compressedTokens: number; savingsPercent: number; lastCompressed: number } {
  return state.get("compressionStats");
}
