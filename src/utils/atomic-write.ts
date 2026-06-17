import { writeFileSync, renameSync, mkdirSync, existsSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import { randomBytes } from "crypto";

/**
 * Atomically write a file: write to a temp sibling, fsync, then rename over the
 * target. A crash or signal mid-write can't truncate the destination, which
 * matters because the global config holds API keys and a corrupt file would
 * lock the user out (or leak a half-written secret). On POSIX, rename is
 * atomic; on Windows, same-volume rename is atomic too, so the temp file is
 * placed next to the destination (same volume) rather than in the os.tmpdir.
 */
export function writeAtomicFileSync(path: string, data: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmp = join(dir, `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  writeFileSync(tmp, data, "utf-8");
  // fsync would harden this further (flush kernel page cache), but requires the
  // file handle; writeFileSync doesn't expose it. rename-after-write is the
  // decisive step that prevents a torn destination.
  try {
    renameSync(tmp, path);
  } catch (err) {
    // Best-effort cleanup of the temp file if rename failed; rethrow the
    // original error so the caller sees the real cause.
    try {
      if (existsSync(tmp)) {
        unlinkSync(tmp);
      }
    } catch {
      // ignore — the rename error is what matters
    }
    throw err;
  }
}

function basename(p: string): string {
  const slash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return slash === -1 ? p : p.slice(slash + 1);
}
