import type { CommandSpec } from "../context.js";
import { themeEngine } from "../../themes/engine.js";
import { state } from "../../../core/state.js";
import { events } from "../../../core/events.js";
import { sessionManager } from "../../../core/session-manager.js";
import { providerManager } from "../../../ai/provider.js";

export const configCommands: CommandSpec[] = [
  {
    name: "theme",
    description: "Switch theme",
    usage: "<name>",
    group: "core",
    async run(ctx) {
      const name = ctx.args[0];
      if (!name) {
        let list = "Themes:\n";
        for (const t of themeEngine.getAllThemes()) {
          const cur = t.name === themeEngine.getTheme().name ? "  ←" : "";
          list += `  ${t.name.padEnd(12)} ${t.display}${cur}\n`;
        }
        ctx.addSystem(list.trimEnd());
        return;
      }
      if (themeEngine.setTheme(name)) {
        state.set("currentTheme", name);
        ctx.addSystem(`Theme → ${themeEngine.getTheme().display}`);
      } else {
        ctx.addError(`Unknown theme: ${name}`);
      }
      return;
    },
  },
  {
    name: "permissions",
    aliases: ["perms"],
    description: "Guardrails: yolo | auto | gated | plan",
    usage: "<mode>",
    group: "core",
    async run(ctx) {
      const mode = ctx.args[0];
      if (!mode) {
        ctx.addSystem(`Permission mode: ${ctx.getPermissionMode()}  (yolo | auto | gated | plan)`);
        return;
      }
      if (mode === "yolo" || mode === "auto" || mode === "gated" || mode === "plan") {
        ctx.setPermissionMode(mode);
        ctx.addSystem(`Permission mode → ${mode}`);
      } else {
        ctx.addError(`Unknown mode: ${mode}. Use yolo | auto | gated | plan.`);
      }
      return;
    },
  },
  {
    name: "plan",
    description: "Read-only research mode: propose a plan, no edits",
    usage: "[off]",
    group: "core",
    async run(ctx) {
      if (ctx.args[0] === "off") {
        ctx.setPermissionMode("yolo");
        ctx.addSystem("Plan mode off → yolo. Edits/commands re-enabled.");
      } else {
        ctx.setPermissionMode("plan");
        ctx.addSystem("Plan mode on (read-only). I'll research and propose a plan; edits/commands are blocked until you `/plan off`.");
      }
      return;
    },
  },
  {
    name: "agent",
    description: "Switch agent (gsd, code, debug, plan, ask)",
    usage: "<name>",
    group: "core",
    async run(ctx) {
      const name = ctx.args[0];
      if (!name) {
        ctx.addSystem(`Agent: ${state.get("currentAgent")}`);
        return;
      }
      state.set("currentAgent", name);
      events.emit("agent:switched", name);
      const activeId = sessionManager.getActiveSessionId();
      if (activeId) sessionManager.updateSessionAgent(activeId, name);
      ctx.addSystem(`Agent → ${name}`);
      return;
    },
  },
  {
    name: "model",
    description: "Switch model",
    usage: "<name>",
    group: "core",
    async run(ctx) {
      const name = ctx.args[0];
      if (!name) {
        ctx.addSystem(`Model: ${state.get("currentModel")}`);
        return;
      }
      state.set("currentModel", name);
      events.emit("model:changed", name);
      const activeId = sessionManager.getActiveSessionId();
      if (activeId) sessionManager.updateSessionModel(activeId, name);
      ctx.addSystem(`Model → ${name}`);
      return;
    },
  },
  {
    name: "providers",
    description: "Check API status",
    group: "core",
    async run(ctx) {
      const available = providerManager.getAvailableProviderNames();
      let msg = "Providers:\n";
      for (const name of providerManager.getAllProviderNames()) {
        msg += `  ${name.padEnd(12)} ${available.includes(name) ? "ok" : "no key"}\n`;
      }
      ctx.addSystem(msg.trimEnd());
      return;
    },
  },
];
