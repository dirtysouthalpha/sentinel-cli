import { execFile } from "child_process";
import { promisify } from "util";
import type { SecretStore } from "./store.js";

const execFileP = promisify(execFile);

/**
 * macOS Keychain backend via the `security` CLI (ships with macOS). Stores a
 * generic password under the "sentinel-cli" service with the secret's logical
 * name as the account. No native dependency.
 */

const SERVICE = "sentinel-cli";

export async function macosKeychainAvailable(): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  try {
    await execFileP("security", ["find-generic-password", "-s", SERVICE], { timeout: 3000 });
    return true;
  } catch (e) {
    // find-generic-password exits non-zero when no matching item exists, but
    // that still means the CLI works. Distinguish "CLI missing/broken" from
    // "no such item" by code: the former is ENOENT-ish.
    const code = (e as { code?: number | string }).code;
    if (code === "ENOENT") return false;
    return true;
  }
}

export function createMacOSKeychainBackend(): SecretStore {
  return {
    kind: "macos-keychain",

    async set(name, value) {
      try {
        // -U updates if the item exists; -T '' denies GUI tool access so the
        // secret is only retrievable via `security` (no app prompt on read).
        await execFileP(
          "security",
          ["add-generic-password", "-U", "-s", SERVICE, "-a", name, "-w", value, "-T", ""],
          { timeout: 5000 }
        );
        return true;
      } catch {
        return false;
      }
    },

    async get(name) {
      try {
        const { stdout } = await execFileP(
          "security",
          ["find-generic-password", "-s", SERVICE, "-a", name, "-w"],
          { timeout: 5000 }
        );
        const v = stdout.replace(/\n$/, "");
        return v.length > 0 ? v : null;
      } catch {
        return null;
      }
    },

    async delete(name) {
      try {
        await execFileP(
          "security",
          ["delete-generic-password", "-s", SERVICE, "-a", name],
          { timeout: 5000 }
        );
        return true;
      } catch {
        return false;
      }
    },
  };
}
