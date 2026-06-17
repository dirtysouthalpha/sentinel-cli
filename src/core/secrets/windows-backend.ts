import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { writeAtomicFileSync } from "../../utils/atomic-write.js";
import type { SecretStore } from "./store.js";

const execFileP = promisify(execFile);

/**
 * Windows backend: DPAPI-encrypted sidecar file, no native node dependency.
 *
 * Each secret is encrypted with PowerShell's `ConvertTo-SecureString -AsPlainText
 * -Force | ConvertFrom-SecureString`, which wraps the bytes in user-scope DPAPI.
 * The resulting blob is decryptable ONLY by the same Windows user account on the
 * same machine. Blobs are kept in a JSON sidecar (0600-ish via ACLs) so reads
 * round-trip cleanly — unlike `cmdkey`, whose CLI can't print a stored password.
 *
 * This is weaker than Credential Manager's locked vault (the file path is
 * enumerable) but the key material itself is opaque to anyone but the user, and
 * there is zero native build dependency (no node-gyp, no libsecret-dev).
 */

const FILE = join(homedir(), ".config", "sentinel", "secrets.dpapi.json");

type BlobMap = Record<string, string>;

function readAll(): BlobMap {
  if (!existsSync(FILE)) return {};
  try {
    return JSON.parse(readFileSync(FILE, "utf-8")) as BlobMap;
  } catch {
    return {};
  }
}

function writeAll(m: BlobMap): void {
  writeAtomicFileSync(FILE, JSON.stringify(m, null, 2));
}

const run = (ps: string) =>
  execFileP("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
    timeout: 8000,
    windowsHide: true,
  });

export async function windowsDpapiAvailable(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  try {
    await run("[Security.Cryptography.ProtectedData] | Out-Null; 'ok'");
    return true;
  } catch {
    return false;
  }
}

export function createWindowsDpapiBackend(): SecretStore {
  return {
    kind: "windows-dpapi",

    async set(name, value) {
      try {
        // Base64 the UTF-8 bytes first so arbitrary content (quotes, newlines,
        // unicode) survives the PowerShell string pipeline intact.
        const b64 = Buffer.from(value, "utf-8").toString("base64");
        const ps =
          `$plain = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')); ` +
          `$sec = ConvertTo-SecureString $plain -AsPlainText -Force; ` +
          `ConvertFrom-SecureString $sec`;
        const { stdout } = await run(ps);
        const all = readAll();
        all[name] = stdout.trim();
        writeAll(all);
        return true;
      } catch {
        return false;
      }
    },

    async get(name) {
      try {
        const all = readAll();
        const blob = all[name];
        if (!blob) return null;
        const ps =
          `$sec = ConvertTo-SecureString '${blob}' ; ` +
          `$b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec); ` +
          `$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto($b); ` +
          `[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($plain))`;
        const { stdout } = await run(ps);
        const b64 = stdout.trim();
        return Buffer.from(b64, "base64").toString("utf-8");
      } catch {
        return null;
      }
    },

    async delete(name) {
      try {
        const all = readAll();
        if (!(name in all)) return false;
        delete all[name];
        writeAll(all);
        return true;
      } catch {
        return false;
      }
    },
  };
}
