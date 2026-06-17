import { resolve } from "node:path";
import { state } from "../../core/state.js";
import { providerManager } from "../../ai/provider.js";
import { loadAttachment } from "../../core/attachments.js";
import { buildVisionMessage } from "../../core/vision.js";
import type { CommandHost } from "./types.js";

/** /ask-prime <question> — one-shot query to the Sentinel Prime (Hermes) provider. */
export async function handleAskPrime(host: CommandHost, args: string[]): Promise<void> {
  const question = args.join(" ").trim();
  if (!question) {
    host.addSystem("Usage: /ask-prime <question>");
    return;
  }
  const prime = providerManager.getProvider("sentinel-prime");
  if (!prime || !prime.isAvailable()) {
    host.addError(
      "Sentinel Prime not configured — add a `sentinel-prime` provider in config."
    );
    return;
  }
  try {
    const res = await prime.chat([{ role: "user", content: question }], {
      model: "hermes-agent",
    });
    host.addSystem(res.content || "(no answer)");
  } catch (err) {
    host.addError(`Sentinel Prime error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** /describe <imagePath> [prompt] — one-shot vision description of a local image. */
export async function handleDescribe(host: CommandHost, args: string[]): Promise<void> {
  const imagePath = args[0];
  if (!imagePath) {
    host.addSystem("Usage: /describe <imagePath> [prompt]");
    return;
  }
  const prompt = args.slice(1).join(" ").trim() || "Describe this image in detail.";

  let att;
  try {
    att = loadAttachment(resolve(host.projectRoot, imagePath));
  } catch (err) {
    host.addError(err instanceof Error ? err.message : String(err));
    return;
  }

  const [providerName, ...modelParts] = state.get("currentModel").split("/");
  const modelName = modelParts.join("/") || undefined;
  const provider = providerManager.getProvider(providerName);
  if (!provider) {
    host.addError(`No provider "${providerName}". Try /providers`);
    return;
  }
  if (!provider.isAvailable()) {
    host.addError(`No API key for "${providerName}". Type /connect`);
    return;
  }

  host.addSystem(`Describing ${att.name} with ${state.get("currentModel")}...`);
  try {
    const res = await provider.chat([buildVisionMessage(prompt, [att])], {
      model: modelName,
    });
    host.addSystem(res.content || "(no description)");
  } catch (err) {
    host.addError(`Vision error: ${err instanceof Error ? err.message : String(err)}`);
  }
}
