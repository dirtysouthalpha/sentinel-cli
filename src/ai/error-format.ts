import { ProviderError } from "./errors.js";
import { providerEnvVar } from "./provider.js";

/** True when an error is a fetch/stream abort (user pressed Ctrl+C to cancel). */
export function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || /\baborted\b/i.test(err.message))
  );
}

/**
 * Turn a raw chat/provider error into a short, actionable message naming the
 * provider and the concrete next step. `model` is the active "provider/model"
 * identifier. Abort errors should be filtered by the caller (see isAbortError)
 * before this is reached — they are not user-facing failures.
 */
export function formatChatError(err: unknown, model: string): string {
  const provider = model.split("/")[0] || "the provider";

  if (err instanceof ProviderError) {
    const s = err.status;
    if (s === 401 || s === 403) {
      const env = providerEnvVar(provider);
      return `Authentication failed for ${provider} (HTTP ${s}). Your API key may be invalid or expired — ${
        env ? `check ${env} or ` : ""
      }run /connect.`;
    }
    if (s === 404) {
      return `Model "${model}" wasn't found on ${provider} (HTTP 404). Check the id with /providers, or switch with /model.`;
    }
    if (s === 429) {
      return `Rate limited on ${provider}. Wait a moment, or switch models with /model.`;
    }
    if (typeof s === "number" && s >= 500) {
      return `${provider} had a server error (HTTP ${s}). Try again shortly, or switch with /model.`;
    }
  }

  const msg = err instanceof Error ? err.message : String(err);
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|getaddrinfo|fetch failed|network/i.test(msg)) {
    const hint = provider === "ollama" ? " — is Ollama running?" : "";
    return `Can't reach ${provider} (network error). Check your connection${hint}.`;
  }
  return msg;
}
