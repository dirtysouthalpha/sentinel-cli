import { execFile } from "child_process";
import { promisify } from "util";
import { resolve, isAbsolute } from "path";
import { existsSync } from "fs";

const execFileP = promisify(execFile);

/**
 * Bubblewrap-based OS sandbox for the bash tool. When enabled, commands run in
 * a fresh mount + network namespace: the project root is the only writable FS
 * path, /tmp is private, network is fully blocked (this closes the curl-exfil
 * hole that bypasses the web SSRF guard), and the sandbox dies with the parent.
 *
 * Design goals:
 *  - Filesystem confined to the project tree (no ~/.ssh, /etc, /proc secrets).
 *  - Network off by default (set allowNetwork to permit installs/fetches).
 *  - Process dies with the parent (--die-with-parent) so a killed run can't
 *    leave a sandboxed child running.
 *
 * It is opt-in (config.sandbox.enabled or --sandbox) because it breaks any
 * command that needs files outside the project or a network connection. The
 * recommended posture is sandboxed autopilot, unscoped interactive runs.
 *
 * Linux-only: Windows/macOS detect-and-fallback (no OS sandbox -> runs the
 * command unsandboxed and logs once), documented. bubblewrap is the chosen
 * mechanism because it uses unprivileged user namespaces (no setuid, the
 * Flatpak/GNOME approach).
 */

export interface SandboxOptions {
  projectRoot: string;
  /** Bind-mount these extra host paths read-only (e.g. node_modules caches). */
  extraRoBind?: string[];
  /** Allow network inside the sandbox (default false). */
  allowNetwork?: boolean;
  /** Working directory inside the sandbox (default: projectRoot). */
  cwd?: string;
}

export interface SandboxResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/** True if bubblewrap is installed and we're on Linux. */
export function sandboxAvailable(): boolean {
  if (process.platform !== "linux") return false;
  try {
    return existsSync("/usr/bin/bwrap") || existsSync("/bin/bwrap") || !!require("child_process").spawnSync("which", ["bwrap"]).stdout.toString().trim();
  } catch {
    return false;
  }
}

/**
 * Build the bubblewrap argv prefix that sets up the sandbox, ending in `--`
 * (the caller appends the real command + args). Pure + testable.
 */
export function buildBwrapArgs(opts: SandboxOptions): string[] {
  const root = resolve(isAbsolute(opts.cwd ?? opts.projectRoot) ? (opts.cwd ?? opts.projectRoot) : opts.projectRoot);
  const args: string[] = [
    "--die-with-parent",
    // New namespaces: a fresh mount tree we populate explicitly, isolated PID
    // and IPC. Network is unshared by default (the no-exfil posture); the
    // networked branch below omits --unshare-net.
    "--unshare-user-try",
    "--unshare-pid",
    "--unshare-ipc",
    "--dev", "/dev",
    "--proc", "/proc",
    "--ro-bind", "/usr", "/usr",
    "--ro-bind-try", "/lib", "/lib",
    "--ro-bind-try", "/lib64", "/lib64",
    "--ro-bind", "/bin", "/bin",
    "--ro-bind", "/sbin", "/sbin",
    "--dir", "/tmp",
    "--ro-bind-try", "/etc/resolv.conf", "/etc/resolv.conf",
  ];

  if (!opts.allowNetwork) {
    // The no-network posture: a fresh net namespace with only loopback, so a
    // prompt-injected command can't curl an exfil/metadata endpoint (this is
    // the hole that bypasses the web tool's SSRF guard).
    args.unshift("--unshare-net");
  }

  // The project root, writable so the agent can edit/build.
  args.push("--bind", root, root);

  for (const extra of opts.extraRoBind ?? []) {
    const abs = resolve(extra);
    args.push("--ro-bind-try", abs, abs);
  }

  args.push("--chdir", opts.cwd ?? opts.projectRoot, "--");
  return args;
}

/**
 * Run a command inside the bubblewrap sandbox. Throws if bwrap is unavailable.
 * The command array is passed without a shell (argv), so there's no injection
 * surface from the command itself.
 */
export async function runSandboxed(
  command: string[],
  opts: SandboxOptions,
  timeoutMs = 120000
): Promise<SandboxResult> {
  if (!sandboxAvailable()) {
    throw new Error(
      "Sandbox requested but bubblewrap (bwrap) is unavailable. Install it or run without --sandbox."
    );
  }
  const bwrapArgs = [...buildBwrapArgs(opts), ...command];
  try {
    const { stdout, stderr } = await execFileP("bwrap", bwrapArgs, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      cwd: opts.cwd ?? opts.projectRoot,
    });
    return { ok: true, stdout, stderr, exitCode: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number | string; signal?: string };
    return {
      ok: false,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      exitCode: typeof err.code === "number" ? err.code : null,
    };
  }
}
