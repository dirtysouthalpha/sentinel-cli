import type { CommandSpec } from "../context.js";
import { buildAbout } from "../../../core/about.js";
import { checkForUpdate } from "../../../core/update-check.js";
import { VERSION } from "../../../core/version.js";

export const metaCommands: CommandSpec[] = [
  {
    name: "help",
    aliases: ["?"],
    async run(ctx) {
      ctx.showSlashMenu();
      return;
    },
  },
  {
    name: "quit",
    aliases: ["exit", "q"],
    async run(ctx) {
      ctx.quit();
      return;
    },
  },
  {
    name: "clear",
    async run(ctx) {
      ctx.clearScreen();
      ctx.addSystem("Cleared.");
      return;
    },
  },
  {
    name: "about",
    async run(ctx) {
      ctx.addSystem(buildAbout(VERSION));
      return;
    },
  },
  {
    name: "update",
    async run(ctx) {
      ctx.addSystem("Checking for updates …");
      const r = await checkForUpdate(VERSION);
      if (r.latest === null) {
        ctx.addSystem("Could not check for updates (offline?).");
      } else if (r.updateAvailable) {
        ctx.addSystem(
          `v${r.latest} available (you have v${r.current}). Update: npm i -g sentinel-cli`
        );
      } else {
        ctx.addSystem(`Sentinel is up to date (v${r.current}).`);
      }
      return;
    },
  },
  {
    name: "connect",
    aliases: ["setup"],
    async run(ctx) {
      ctx.addSystem(
        [
          "Connect an AI provider:",
          "  Wizard:  run  node dist/cli.js setup  in a terminal",
          "  Env var: set ZAI_API_KEY=your-key  (or ANTHROPIC_API_KEY / OPENAI_API_KEY)",
          "  Config:  add a provider block to sentinel.json",
          "  Then switch with:  /model zai/glm-4.6",
        ].join("\n")
      );
      return;
    },
  },
];
