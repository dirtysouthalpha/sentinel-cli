import { spawn } from "child_process";
import { ToolDef, ToolResult } from "./types.js";

/**
 * `open_url` — launch the user's REAL browser to a URL. This is the OAuth/login
 * affordance: when the agent needs the user to sign in (or visit a page their
 * session lives in), it opens the actual browser (xdg-open on Linux, `open` on
 * macOS, `cmd /c start` on Windows) instead of trying to drive a headless one.
 *
 * Headless browsing can't do OAuth that needs an existing session / 2FA / a
 * password manager — the user's real browser can. So "open the OAuth page, I'll
 * sign in" becomes a thing the agent can actually do.
 *
 * URL safety: only http(s) is opened (blocks file://, javascript:, etc.). The
 * spawn is detached + unref'd so the browser outlives the CLI.
 */

/** Pure: pick the (command, args) to launch a URL on the current platform. */
export function openBrowserCommand(url: string, platform: string): { cmd: string; args: string[] } {
  if (platform === "darwin") return { cmd: "open", args: [url] };
  if (platform === "win32") return { cmd: "cmd", args: ["/c", "start", "", url] };
  // Linux + everything else: xdg-open is the freedesktop standard.
  return { cmd: "xdg-open", args: [url] };
}

/** True for an http(s) URL (the only schemes we'll hand to the browser). */
function isSafeUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function createOpenUrlTool(): ToolDef {
  return {
    name: "open_url",
    description:
      "Open a URL in the user's REAL browser (their actual Chrome/Firefox/Safari, not headless). " +
      "Use this for OAuth/login flows, sign-in pages, docs the user should read, or anything that " +
      "needs their existing browser session (cookies, password manager, 2FA). http(s) only.",
    parameters: {
      url: {
        type: "string",
        description: "The http(s) URL to open in the user's browser.",
        required: true,
      },
    },
    execute: async (args): Promise<ToolResult> => {
      const url = String(args.url ?? "").trim();
      if (!url) return { success: false, output: "", error: "open_url requires a 'url'." };
      if (!isSafeUrl(url)) {
        return { success: false, output: "", error: `Refusing to open non-http(s) URL: ${url}` };
      }
      const { cmd, args: cmdArgs } = openBrowserCommand(url, process.platform);
      try {
        const child = spawn(cmd, cmdArgs, { detached: true, stdio: "ignore" });
        child.on("error", () => {
          // Spawn failures (e.g. xdg-open missing) surface async; nothing to do
          // here — the result was already returned optimistically.
        });
        child.unref();
        return {
          success: true,
          output: `Opened ${url} in the user's browser (${cmd}).`,
        };
      } catch (err) {
        return { success: false, output: "", error: String(err) };
      }
    },
  };
}
