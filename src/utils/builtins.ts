import { existsSync } from "fs";
import { join } from "path";

/**
 * Resolve a builtin definitions directory. Published packages ship the markdown
 * under dist/builtin/<domain> (see scripts/copy-builtins.cjs); local dev reads
 * the source under src/<domain>/builtin. Prefer dist, fall back to src.
 */
export function resolveBuiltinDir(
  installRoot: string,
  domain: "skills" | "commands" | "agents"
): string {
  const shipped = join(installRoot, "dist", "builtin", domain);
  if (existsSync(shipped)) return shipped;
  return join(installRoot, "src", domain, "builtin");
}
