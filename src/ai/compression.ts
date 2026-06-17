import { state } from "../core/state.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger({ prefix: "compression" });

interface CompressionMessage {
  role: string;
  content: string;
}

const compressionCache = new Map<string, string>();

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
  try {
    const { compress } = await import("headroom-ai");
    const result = await compress(messages as any);
    return result.messages as CompressionMessage[];
  } catch (err) {
    log.warn(`Headroom compression failed, using fallback: ${err}`);
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

export function getCompressionStats() {
  return state.get("compressionStats");
}
