/**
 * Cross-platform clipboard copy. Windows is a first-class target so we never
 * assume `pbcopy`/`xclip`; we shell out to the native clip tool for the current
 * platform and fall back to writing a temp file + instructions if none exists.
 *
 * Returns true on success so callers can surface a confirmation message.
 */
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { writeFileSync } from "fs";
import { createLogger } from "./logger.js";

const log = createLogger({ prefix: "clipboard" });

export interface CopyResult {
  ok: boolean;
  /** Human-readable note for the fallback case (where the text landed in a file). */
  note?: string;
}

export function copyToClipboard(text: string): CopyResult {
  const platform = process.platform;
  try {
    if (platform === "win32") {
      // `clip` reads stdin on Windows. Avoid the shell to keep the payload
      // literal (no &/| interpolation).
      execFileSync("clip", { input: text, shell: false, stdio: ["pipe", "ignore", "ignore"] });
      return { ok: true };
    }
    if (platform === "darwin") {
      execFileSync("pbcopy", { input: text, shell: false, stdio: ["pipe", "ignore", "ignore"] });
      return { ok: true };
    }
    // Linux / WSL: prefer wl-copy (Wayland), then xclip, then xsel.
    for (const bin of ["wl-copy", "xclip", "xsel"]) {
      try {
        const args = bin === "xclip" ? ["-selection", "clipboard"] : bin === "xsel" ? ["--clipboard", "--input"] : [];
        execFileSync(bin, args, { input: text, shell: false, stdio: ["pipe", "ignore", "ignore"] });
        return { ok: true };
      } catch {
        // try the next one
      }
    }
  } catch (err) {
    log.debug(`native clipboard failed: ${(err as Error).message}`);
  }

  // Fallback: stash it in a temp file the user can grab manually.
  try {
    const file = join(tmpdir(), "sentinel-last-response.md");
    writeFileSync(file, text, "utf8");
    return {
      ok: true,
      note: `No clipboard tool found — saved to ${file}`,
    };
  } catch (err) {
    log.debug(`fallback file write failed: ${(err as Error).message}`);
    return { ok: false, note: "Could not copy or save the response." };
  }
}
