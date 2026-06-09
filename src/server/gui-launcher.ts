import { createServer } from "http";
import { readFile, stat } from "fs/promises";
import { existsSync } from "fs";
import { join, extname, normalize } from "path";
import { spawn } from "child_process";
import type { AddressInfo } from "net";
import { runServe } from "./serve.js";

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

/**
 * Launch the desktop GUI: start the engine (WebSocket), serve the built web UI
 * from gui/dist, and open the browser pointed at it with the handshake. A
 * Rust/Tauri shell does the same thing natively; this is the zero-extra-deps path.
 */
export async function launchGui(opts: { projectRoot: string; installRoot: string }): Promise<void> {
  const guiDist = join(opts.installRoot, "gui", "dist");
  if (!existsSync(join(guiDist, "index.html"))) {
    console.error(
      `GUI is not built yet. Run:\n  cd "${join(opts.installRoot, "gui")}" && npm install && npm run build`
    );
    process.exitCode = 1;
    return;
  }

  const { port, token } = await runServe({ projectRoot: opts.projectRoot, print: false });

  const server = createServer(async (req, res) => {
    try {
      let p = normalize(decodeURIComponent((req.url || "/").split("?")[0])).replace(/^(\.\.(\/|\\|$))+/, "");
      if (p === "/" || p === "\\" || p === "") p = "index.html";
      let file = join(guiDist, p);
      if (!(await stat(file).catch(() => null))) file = join(guiDist, "index.html"); // SPA fallback
      const data = await readFile(file);
      res.setHeader("content-type", MIME[extname(file)] || "application/octet-stream");
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end("not found");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const guiPort = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${guiPort}/?port=${port}&token=${token}`;

  console.log(`\n  Sentinel GUI is running:\n  ${url}\n  (Ctrl+C to quit)\n`);
  openBrowser(url);
}

function openBrowser(url: string): void {
  try {
    if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    else if (process.platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // the URL is printed above; the user can open it manually
  }
}
