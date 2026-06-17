import { isAbsolute, resolve } from "node:path";
import { buildBundle, writeBundle, readBundle, applyBundle } from "../../core/sync.js";
import type { CommandHost } from "./types.js";

/**
 * /sync — portable settings bundle. `export [path]` writes the (redacted) global
 * config + project skills/workflows to a JSON file; `import <path>` restores
 * skills + workflows from one. Secrets are stripped on export and the global
 * config is never overwritten on import.
 */
export function handleSyncCommand(host: CommandHost, args: string[]): void {
  const sub = (args[0] || "").toLowerCase();

  if (!sub || sub === "export") {
    const rawPath = args.slice(1).join(" ").trim() || "sentinel-sync.json";
    const outPath = isAbsolute(rawPath) ? rawPath : resolve(host.projectRoot, rawPath);
    try {
      const bundle = buildBundle(host.projectRoot);
      writeBundle(outPath, bundle);
      const parts: string[] = [];
      parts.push(bundle.config ? "config (secrets redacted)" : "no config");
      parts.push(`${Object.keys(bundle.skills ?? {}).length} skill(s)`);
      parts.push(`${Object.keys(bundle.workflows ?? {}).length} workflow(s)`);
      host.addSystem(`Exported sync bundle → ${outPath}\n  ${parts.join("  ·  ")}`);
    } catch (err) {
      host.addError(
        `Sync export failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return;
  }

  if (sub === "import") {
    const rawPath = args.slice(1).join(" ").trim();
    if (!rawPath) {
      host.addSystem("Usage: /sync import <path>");
      return;
    }
    const inPath = isAbsolute(rawPath) ? rawPath : resolve(host.projectRoot, rawPath);
    try {
      const bundle = readBundle(inPath);
      const applied = applyBundle(host.projectRoot, bundle);
      const summary =
        applied.length > 0
          ? `Applied ${applied.length} item(s):\n  ${applied.join("\n  ")}`
          : "Nothing to apply (bundle had no skills or workflows).";
      const note = bundle.config
        ? "\nNote: the bundle's global config was NOT applied (review it manually)."
        : "";
      host.addSystem(`Imported sync bundle ← ${inPath}\n${summary}${note}`);
    } catch (err) {
      host.addError(
        `Sync import failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return;
  }

  host.addSystem("Usage: /sync export [path]  ·  /sync import <path>");
}
