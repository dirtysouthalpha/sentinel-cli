import type { ChatMessage, ContentPart } from "../ai/types.js";
import { Attachment, toImageContentPart } from "./attachments.js";

/**
 * V14 multimodal vision. Build a single OpenAI-style multimodal user message from a
 * text prompt plus zero or more image attachments. Pure + testable — no I/O here; the
 * caller loads attachments (via `loadAttachment`) and passes them in.
 */
export function buildVisionMessage(
  text: string,
  attachments: Attachment[]
): ChatMessage {
  const content: ContentPart[] = [
    { type: "text", text },
    ...attachments.map(toImageContentPart),
  ];
  return { role: "user", content };
}
