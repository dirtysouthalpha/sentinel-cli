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
  external: ["blessed", "openai", "@modelcontextprotocol/sdk", "ws"],
});
