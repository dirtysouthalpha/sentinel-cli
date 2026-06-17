// Copy builtin markdown (skills/commands/agents) into dist/builtin so they ship
// in the published package. The loaders read dist/builtin/<domain> when present
// (installed), falling back to src/<domain>/builtin for local dev.
const { cpSync, existsSync, mkdirSync } = require("fs");
const { join } = require("path");

const domains = ["skills", "commands", "agents"];
for (const domain of domains) {
  const src = join("src", domain, "builtin");
  const dest = join("dist", "builtin", domain);
  if (!existsSync(src)) continue;
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`Copied ${src} -> ${dest}`);
}
