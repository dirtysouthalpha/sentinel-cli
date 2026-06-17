import {
  existsSync,
  readFileSync,
  mkdirSync,
  chmodSync,
} from "fs";
import { homedir, hostname, userInfo } from "os";
import { join } from "path";
import {
  scryptSync,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "crypto";
import { writeAtomicFileSync } from "../../utils/atomic-write.js";
import type { SecretStore } from "./store.js";

/**
 * Encrypted-at-rest fallback store for machines without an OS keyring CLI.
 *
 * Design: a master key is derived once via scrypt from a machine+user binding
 * (hostname + username + a persisted random salt). Each secret is sealed with
 * AES-256-GCM using a fresh random IV and that master key. The vault is a JSON
 * map of name -> { iv, ct } written atomically with restrictive perms.
 *
 * Threat model: this stops plaintext-on-disk and a casual copy of the vault to
 * another machine (the salt + binding make the key non-portable). It does NOT
 * stop an attacker who controls the user account on this host — only an OS
 * keyring (or a hardware token) can. The OS keyring backends are strictly
 * stronger; this exists so no install is ever forced to store plaintext.
 */

const DIR = join(homedir(), ".config", "sentinel");
const SALT_FILE = join(DIR, "master.salt");
const VAULT_FILE = join(DIR, "secrets.enc.json");

interface Sealed {
  iv: string; // base64
  ct: string; // base64 (ciphertext + GCM auth tag)
}
type Vault = Record<string, Sealed>;

let cachedKey: Buffer | null = null;

function machineBinding(): string {
  const user = (() => {
    try {
      return userInfo().username;
    } catch {
      return "unknown";
    }
  })();
  return `${hostname()}|${user}`;
}

function getSalt(): string {
  if (existsSync(SALT_FILE)) return readFileSync(SALT_FILE, "utf-8").trim();
  mkdirSync(DIR, { recursive: true });
  const salt = randomBytes(32).toString("hex");
  writeAtomicFileSync(SALT_FILE, salt + "\n");
  try {
    chmodSync(SALT_FILE, 0o600);
  } catch {
    /* best-effort */
  }
  return salt;
}

function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey;
  // Static salt string for the KDF (the per-install random salt is the file);
  // machineBinding() + getSalt() together make the derived key host+user bound.
  cachedKey = scryptSync(machineBinding(), getSalt(), 32);
  return cachedKey;
}

function seal(plaintext: string): Sealed {
  const key = getMasterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    ct: Buffer.concat([body, tag]).toString("base64"),
  };
}

function unseal(entry: Sealed): string {
  const key = getMasterKey();
  const raw = Buffer.from(entry.ct, "base64");
  if (raw.length < 16) throw new Error("ciphertext too short");
  const tag = raw.subarray(raw.length - 16);
  const body = raw.subarray(0, raw.length - 16);
  const iv = Buffer.from(entry.iv, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf-8");
}

function readVault(): Vault {
  if (!existsSync(VAULT_FILE)) return {};
  try {
    return JSON.parse(readFileSync(VAULT_FILE, "utf-8")) as Vault;
  } catch {
    return {};
  }
}

/** Always available — this is the fallback when no OS keyring is present. */
export async function encryptedFileAvailable(): Promise<boolean> {
  return true;
}

export function createEncryptedFileBackend(): SecretStore {
  return {
    kind: "encrypted-file",

    async set(name, value) {
      try {
        const vault = readVault();
        vault[name] = seal(value);
        writeAtomicFileSync(VAULT_FILE, JSON.stringify(vault, null, 2));
        try {
          chmodSync(VAULT_FILE, 0o600);
        } catch {
          /* best-effort */
        }
        return true;
      } catch {
        return false;
      }
    },

    async get(name) {
      try {
        const vault = readVault();
        const entry = vault[name];
        if (!entry) return null;
        return unseal(entry);
      } catch {
        return null;
      }
    },

    async delete(name) {
      try {
        const vault = readVault();
        if (!(name in vault)) return false;
        delete vault[name];
        writeAtomicFileSync(VAULT_FILE, JSON.stringify(vault, null, 2));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Test hook: clear the cached master key (so a test can rotate the binding). */
export function _clearMasterKeyCache(): void {
  cachedKey = null;
}
