import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { createLogger } from "../utils/logger.js";

const log = createLogger({ prefix: "session-storage" });

export interface SessionData {
  id: string;
  title: string;
  projectRoot: string;
  createdAt: number;
  updatedAt: number;
  messages: SessionMessage[];
  model: string;
  agent: string;
  cost: {
    totalTokens: number;
    estimatedCostUSD: number;
  };
  context: SerializedContext | null;
  pinned: boolean;
}

export interface SessionMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface SerializedContext {
  systemPrompt: string;
  messages: SessionMessage[];
}

export class SessionStorage {
  private sessionsDir: string;

  constructor(projectRoot: string) {
    this.sessionsDir = join(projectRoot, ".sentinel", "sessions");
  }

  ensureDir(): void {
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  save(session: SessionData): void {
    this.ensureDir();
    const filePath = this.getFilePath(session.id);
    try {
      writeFileSync(filePath, JSON.stringify(session, null, 2), "utf-8");
    } catch (err) {
      log.error(`Failed to save session ${session.id}: ${err}`);
    }
  }

  load(id: string): SessionData | null {
    const filePath = this.getFilePath(id);
    if (!existsSync(filePath)) return null;
    try {
      const content = readFileSync(filePath, "utf-8");
      return JSON.parse(content) as SessionData;
    } catch (err) {
      log.error(`Failed to load session ${id}: ${err}`);
      return null;
    }
  }

  loadAll(): SessionData[] {
    this.ensureDir();
    const sessions: SessionData[] = [];
    try {
      const files = readdirSync(this.sessionsDir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        const id = file.replace(".json", "");
        const data = this.load(id);
        if (data) sessions.push(data);
      }
      sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (err) {
      log.error(`Failed to load sessions: ${err}`);
    }
    return sessions;
  }

  delete(id: string): void {
    const filePath = this.getFilePath(id);
    try {
      if (existsSync(filePath)) unlinkSync(filePath);
    } catch (err) {
      log.error(`Failed to delete session ${id}: ${err}`);
    }
  }

  exists(id: string): boolean {
    return existsSync(this.getFilePath(id));
  }

  getSessionsDir(): string {
    return this.sessionsDir;
  }

  private getFilePath(id: string): string {
    return join(this.sessionsDir, `${id}.json`);
  }
}
