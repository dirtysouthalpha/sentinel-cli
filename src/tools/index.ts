import { ToolDef } from "./types.js";
import { createFileTool } from "./file.js";
import { createBashTool, BashToolOptions } from "./bash.js";
import { createGitTool } from "./git.js";
import { createSearchTool } from "./search.js";
import { createWebTool } from "./web.js";
import { createPatchTool } from "./patch.js";
import { createBrowserTool } from "./browser.js";
import { createCreateSkillTool } from "./create-skill.js";
import { createOpenUrlTool } from "./open-url.js";
import { events } from "../core/events.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger({ prefix: "tools" });

class ToolManager {
  private tools: Map<string, ToolDef> = new Map();
  private static instance: ToolManager;

  private constructor() {}

  static getInstance(): ToolManager {
    if (!ToolManager.instance) {
      ToolManager.instance = new ToolManager();
    }
    return ToolManager.instance;
  }

  initialize(projectRoot: string, bashOpts: BashToolOptions = {}): void {
    this.tools.clear();
    this.register(createFileTool(projectRoot));
    this.register(createBashTool(projectRoot, bashOpts));
    this.register(createGitTool(projectRoot));
    this.register(createSearchTool(projectRoot));
    this.register(createWebTool());
    this.register(createPatchTool(projectRoot));
    this.register(createBrowserTool(projectRoot));
    this.register(createCreateSkillTool(projectRoot));
    this.register(createOpenUrlTool());
    log.info(`Initialized ${this.tools.size} tools${bashOpts.sandbox ? " (bash sandboxed)" : ""}`);
  }

  register(tool: ToolDef): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDef[] {
    return Array.from(this.tools.values());
  }

  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  async execute(name: string, args: Record<string, unknown>): Promise<import("./types.js").ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" not found. Available: ${this.getNames().join(", ")}`);
    }

    events.emit("tool:execute", name, args);
    const result = await tool.execute(args);
    events.emit("tool:result", name, result);
    return result;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}

export const toolManager = ToolManager.getInstance();
