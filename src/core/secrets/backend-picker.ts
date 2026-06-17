import type { SecretStore } from "./store.js";
import { linuxKeyringAvailable, createLinuxKeyringBackend } from "./linux-backend.js";
import { macosKeychainAvailable, createMacOSKeychainBackend } from "./macos-backend.js";
import { windowsDpapiAvailable, createWindowsDpapiBackend } from "./windows-backend.js";
import { createEncryptedFileBackend } from "./file-backend.js";

/**
 * Pick the strongest secret store available on this host, in precedence order:
 *
 *   1. Linux Secret Service (secret-tool + gnome-keyring/libsecret)
 *   2. macOS Keychain (security)
 *   3. Windows DPAPI (PowerShell + sidecar file)
 *   4. Encrypted-at-rest file fallback (always available)
 *
 * Each OS backend is probed (CLI present + reachable) before use, so a Linux
 * box without a running keyring daemon transparently falls to the encrypted
 * file. The encrypted-file fallback guarantees no install is ever forced to
 * store plaintext, even on a minimal server.
 *
 * Platform checks are skipped on the wrong OS without spawning a process.
 */
export async function pickBackend(): Promise<SecretStore> {
  if (process.platform === "linux" && (await linuxKeyringAvailable())) {
    return createLinuxKeyringBackend();
  }
  if (process.platform === "darwin" && (await macosKeychainAvailable())) {
    return createMacOSKeychainBackend();
  }
  if (process.platform === "win32" && (await windowsDpapiAvailable())) {
    return createWindowsDpapiBackend();
  }
  return createEncryptedFileBackend();
}
