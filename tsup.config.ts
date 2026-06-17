import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: { entry: "src/index.ts" },
  // puppeteer is a lazy runtime import (tools/browser.ts) and an optional
  // dependency (~300MB Chromium). It MUST stay external so tsup doesn't inline
  // it into the bundle — otherwise every install ships the browser code and
  // the "optional" dep isn't really optional.
  external: ["blessed", "openai", "@modelcontextprotocol/sdk", "ws", "puppeteer"],
});
