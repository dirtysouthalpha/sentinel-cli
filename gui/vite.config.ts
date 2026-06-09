import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: { port: 5179, strictPort: false },
  build: { outDir: "dist", emptyOutDir: true },
});
