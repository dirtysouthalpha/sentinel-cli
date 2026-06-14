import type { CommandSpec } from "../context.js";
import { buildAbout } from "../../../core/about.js";
import { checkForUpdate } from "../../../core/update-check.js";
import { VERSION } from "../../../core/version.js";

export const metaCommands: CommandSpec[] = [
  {
    name: "help",
    aliases: ["?"],
    description: "Show commands, or details for one",
    usage: "[command]",
    group: "session",
    async run(ctx) {
      const name = ctx.args[0]?.replace(/^\//, "");
      if (name) {
        ctx.showCommandHelp(name);
      } else {
        ctx.showSlashMenu();
      }
      return;
    },
  },
  {
    name: "quit",
    aliases: ["exit", "q"],
    description: "Exit Sentinel",
    group: "session",
    async run(ctx) {
      ctx.quit();
      return;
    },
  },
  {
    name: "clear",
    description: "Clear chat history",
    group: "session",
    async run(ctx) {
      ctx.clearScreen();
      ctx.addSystem("Cleared.");
      return;
    },
  },
  {
    name: "about",
    description: "Version, runtime, and feature summary",
    group: "session",
    async run(ctx) {
      ctx.addSystem(buildAbout(VERSION));
      return;
    },
  },
  {
    name: "update",
    description: "Check npm for a newer Sentinel release",
    group: "session",
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
    description: "Set up an AI provider",
    group: "core",
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
