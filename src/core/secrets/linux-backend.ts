import { execFile } from "child_process";
import { promisify } from "util";
import type { SecretStore } from "./store.js";

const execFileP = promisify(execFile);

/**
 * Linux Secret Service backend via the `secret-tool` CLI (GNOME Keyring /
 * KWallet / KeePassXC, whichever implements the Secret Service D-Bus API).
 *
 * No native node dependency — uses the CLI that ships with the desktop
 * environment. Credentials are addressed by a fixed `service` ("sentinel-cli")
 * and the logical `account` name (the secret's key). This is the same scheme
 * libsecret uses, so keys are visible in a GUI keyring manager under that
 * service label.
 */

const SERVICE = "sentinel-cli";

function env(): NodeJS.ProcessEnv {
  // secret-tool needs the session bus. It's usually already in the environment
  // for an interactive session; set the conventional path as a fallback for
  // headless runs that still have a running keyring daemon.
  const base = { ...process.env };
  if (!base.DBUS_SESSION_BUS_ADDRESS) {
    base.DBUS_SESSION_BUS_ADDRESS = `unix:path=/run/user/${process.getuid?.() ?? 1000}/bus`;
  }
  return base;
}

/** True if the `secret-tool` CLI is installed AND a Secret Service is reachable. */
export async function linuxKeyringAvailable(): Promise<boolean> {
  try {
    await execFileP("secret-tool", ["search", "--all", "service", SERVICE], {
      env: env(),
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}

export function createLinuxKeyringBackend(): SecretStore {
  return {
    kind: "linux-secret-service",

    async set(name, value) {
      try {
        // `secret-tool store` reads the secret from stdin; schema attributes
        // identify it for later lookup/clear.
        const child = execFile(
          "secret-tool",
          ["store", "--label", `Sentinel CLI: ${name}`, "service", SERVICE, "account", name],
          { env: env() }
        );
        child.stdin?.end(value);
        await new Promise<void>((resolve, reject) => {
          child.on("close", (code) =>
            code === 0 ? resolve() : reject(new Error(`secret-tool store exited ${code}`))
          );
          child.on("error", reject);
        });
        return true;
      } catch {
        return false;
      }
    },

    async get(name) {
      try {
        const { stdout } = await execFileP(
          "secret-tool",
          ["lookup", "service", SERVICE, "account", name],
          { env: env(), timeout: 5000 }
        );
        // secret-tool prints the secret with no trailing newline.
        return stdout.length > 0 ? stdout : null;
      } catch {
        return null;
      }
    },

    async delete(name) {
      try {
        // `secret-tool clear` exits 0 even if nothing matched; check by looking
        // it up first so we report accurately.
        const before = await this.get(name);
        if (before === null) return false;
        await execFileP(
          "secret-tool",
          ["clear", "service", SERVICE, "account", name],
          { env: env(), timeout: 5000 }
        );
        return true;
      } catch {
        return false;
      }
    },
  };
}
