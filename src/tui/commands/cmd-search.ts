import { state } from "../../core/state.js";
import { providerManager } from "../../ai/provider.js";
import { suggestCommand } from "../../core/command-search.js";
import type { CommandHost } from "./types.js";

/** /cmd <natural language> — AI command-search: NL → one shell command. */
export async function handleCmdSearch(host: CommandHost, nl: string): Promise<void> {
  const query = nl.trim();
  if (!query) {
    host.addSystem("Usage: /cmd <natural language>  e.g. /cmd list the 5 largest files");
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

  host.addSystem(`Searching for a command for: ${query}`);
  try {
    const { command, explanation } = await suggestCommand(provider, query, {
      model: modelName,
    });
    if (!command) {
      host.addSystem(
        explanation
          ? `No command produced. ${explanation}`
          : "No command produced."
      );
      return;
    }
    let msg = `Suggested command:\n  ${command}`;
    if (explanation) msg += `\n\n${explanation}`;
    msg += `\n\nRun it with /bg ${command}  — or copy/paste it into your shell.`;
    host.addSystem(msg);
  } catch (err) {
    host.addError(
      `Command search failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
