import { readFileSync } from "node:fs";
import { extname, basename } from "node:path";

/**
 * Image/file attachments (V14 multimodal groundwork). Loads a local image into a
 * base64 data URL suitable for an OpenAI/Anthropic vision content block. Pure +
 * dependency-free; the file reader is injectable for tests. Not yet wired into the
 * message pipeline — the TUI/`run` paths can attach via `loadAttachment` when V14 lands.
 */

export interface Attachment {
  path: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  bytes: number;
}

export const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export function isImagePath(path: string): boolean {
  return extname(path).toLowerCase() in MIME_BY_EXT;
}

export function mimeForPath(path: string): string {
  return MIME_BY_EXT[extname(path).toLowerCase()] || "application/octet-stream";
}

export interface LoadAttachmentOptions {
  maxBytes?: number;
  /** Injectable reader for tests; returns the raw bytes. */
  read?: (path: string) => Buffer;
}

/** Load a local image file into an Attachment (base64 data URL). Throws on missing
 *  file, unsupported type, or oversize input. */
export function loadAttachment(path: string, opts: LoadAttachmentOptions = {}): Attachment {
  if (!isImagePath(path)) {
    throw new Error(`Unsupported attachment type: ${extname(path) || "(none)"} — supported: ${Object.keys(MIME_BY_EXT).join(", ")}`);
  }
  const read = opts.read ?? ((p: string) => readFileSync(p));
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  let buf: Buffer;
  try {
    buf = read(path);
  } catch (e) {
    throw new Error(`Cannot read attachment ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (buf.length > maxBytes) {
    throw new Error(`Attachment ${path} is ${buf.length} bytes (> ${maxBytes} limit)`);
  }

  const mimeType = mimeForPath(path);
  const dataUrl = `data:${mimeType};base64,${buf.toString("base64")}`;
  return { path, name: basename(path), mimeType, dataUrl, bytes: buf.length };
}

/** Build an OpenAI-style image content part from an attachment. */
export function toImageContentPart(att: Attachment): { type: "image_url"; image_url: { url: string } } {
  return { type: "image_url", image_url: { url: att.dataUrl } };
}
