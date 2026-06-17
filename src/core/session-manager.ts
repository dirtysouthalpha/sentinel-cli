import { randomUUID } from "crypto";
import { events } from "./events.js";
import { SessionStorage, SessionData, SessionMessage } from "./session-storage.js";
import { ContextManager } from "../ai/context.js";
import { state } from "./state.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger({ prefix: "session-manager" });

export interface Session {
  id: string;
  title: string;
  projectRoot: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  agent: string;
  pinned: boolean;
  cost: {
    // Full cost tracker so tab switches restore token/request tallies, not
    // just dollars. Older persisted sessions may have only totalTokens +
    // estimatedCostUSD; callers default the missing fields to 0.
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    requests: number;
    estimatedCostUSD: number;
  };
  contextManager: ContextManager;
}

const MAX_SESSIONS = 20;

class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private activeSessionId: string | null = null;
  private storage: SessionStorage | null = null;
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;
  private dirtySessions: Set<string> = new Set();

  initialize(projectRoot: string): void {
    this.storage = new SessionStorage(projectRoot);
    this.storage.ensureDir();
    this.loadAllSessions();
    this.startAutoSave(30000);
  }

  createSession(options?: { title?: string; projectRoot?: string; model?: string; agent?: string }): Session {
    const id = randomUUID();
    const projectRoot = options?.projectRoot || process.cwd();
    const now = Date.now();
    const title = options?.title || `Session ${this.sessions.size + 1}`;

    const session: Session = {
      id,
      title,
      projectRoot,
      createdAt: now,
      updatedAt: now,
      model: options?.model || state.get("currentModel"),
      agent: options?.agent || state.get("currentAgent"),
      pinned: false,
      cost: { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0, estimatedCostUSD: 0 },
      contextManager: new ContextManager(id),
    };

    this.sessions.set(id, session);
    events.emit("session:created", id);
    log.info(`Session created: ${id} (${title})`);

    if (!this.activeSessionId) {
      this.setActiveSession(id);
    }

    return session;
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  setActiveSession(id: string): void {
    if (!this.sessions.has(id)) {
      log.warn(`Cannot activate unknown session: ${id}`);
      return;
    }

    if (this.activeSessionId && this.activeSessionId !== id) {
      this.saveSession(this.activeSessionId);
    }

    this.activeSessionId = id;
    state.set("activeSessionId", id);
    const session = this.sessions.get(id)!;
    state.set("sessionTitle", session.title);
    state.set("currentModel", session.model);
    state.set("currentAgent", session.agent);

    events.emit("session:switched", id);
    log.info(`Active session: ${id} (${session.title})`);
  }

  getActiveSession(): Session | undefined {
    if (!this.activeSessionId) return undefined;
    return this.sessions.get(this.activeSessionId);
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  closeSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;

    if (session.pinned) {
      log.warn(`Cannot close pinned session: ${id}`);
      return;
    }

    this.saveSession(id);

    this.sessions.delete(id);
    this.dirtySessions.delete(id);
    this.storage?.delete(id);

    if (this.activeSessionId === id) {
      const remaining = this.getAllSessions();
      if (remaining.length > 0) {
        this.setActiveSession(remaining[0].id);
      } else {
        // Never leave the app session-less — that would route messages to a
        // throwaway ContextManager("fallback"). Open a fresh session instead.
        this.activeSessionId = null;
        state.set("activeSessionId", null);
        this.createSession();
      }
    }

    events.emit("session:closed", id);
    log.info(`Session closed: ${id}`);
  }

  renameSession(id: string, title: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.title = title;
    session.updatedAt = Date.now();
    if (this.activeSessionId === id) {
      state.set("sessionTitle", title);
    }
    this.markDirty(id);
  }

  togglePin(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.pinned = !session.pinned;
    session.updatedAt = Date.now();
    this.markDirty(id);
  }

  getAllSessions(): Session[] {
    return Array.from(this.sessions.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  markDirty(id: string): void {
    this.dirtySessions.add(id);
  }

  saveSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session || !this.storage) return;

    const data: SessionData = {
      id: session.id,
      title: session.title,
      projectRoot: session.projectRoot,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      model: session.model,
      agent: session.agent,
      cost: session.cost,
      pinned: session.pinned,
      messages: session.contextManager.getMessages().map((m) => ({
        role: m.role as SessionMessage["role"],
        content: m.content,
        timestamp: m.timestamp,
        metadata: m.metadata,
      })),
      context: {
        systemPrompt: session.contextManager.getSystemPrompt(),
        messages: session.contextManager.getMessages().map((m) => ({
          role: m.role as SessionMessage["role"],
          content: m.content,
          timestamp: m.timestamp,
          metadata: m.metadata,
        })),
      },
    };

    this.storage.save(data);
    this.dirtySessions.delete(id);
  }

  saveAllDirty(): void {
    for (const id of this.dirtySessions) {
      this.saveSession(id);
    }
  }

  loadAllSessions(): Session[] {
    if (!this.storage) return [];

    const allData = this.storage.loadAll();
    const sessions: Session[] = [];

    for (const data of allData) {
      if (this.sessions.size >= MAX_SESSIONS) break;

      const contextManager = new ContextManager(data.id);
      if (data.context?.systemPrompt) {
        contextManager.setSystemPrompt(data.context.systemPrompt);
      }
      if (data.context?.messages) {
        for (const msg of data.context.messages) {
          contextManager.addMessage(msg.role as "user" | "assistant" | "tool", msg.content, msg.metadata);
        }
      }

      const session: Session = {
        id: data.id,
        title: data.title,
        projectRoot: data.projectRoot,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        model: data.model,
        agent: data.agent,
        pinned: data.pinned || false,
        // Normalize persisted cost: older sessions stored only {totalTokens,
        // estimatedCostUSD}. Default the rest to 0 so tab switches restore a
        // complete tracker instead of showing "0 tokens, 0 requests, $X".
        cost: {
          promptTokens: data.cost?.promptTokens ?? 0,
          completionTokens: data.cost?.completionTokens ?? 0,
          totalTokens: data.cost?.totalTokens ?? 0,
          requests: data.cost?.requests ?? 0,
          estimatedCostUSD: data.cost?.estimatedCostUSD ?? 0,
        },
        contextManager,
      };

      this.sessions.set(data.id, session);
      sessions.push(session);
    }

    if (sessions.length > 0 && !this.activeSessionId) {
      this.setActiveSession(sessions[0].id);
    }

    log.info(`Loaded ${sessions.length} sessions`);
    return sessions;
  }

  syncToState(): void {
    const sessionList = this.getAllSessions().map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messages: [],
    }));
    state.set("sessions", sessionList);
  }

  /**
   * Accumulate one turn's usage into the session's cost tracker. Takes the full
   * breakdown so tab switches can restore prompt/completion/request tallies,
   * not just dollars. The legacy (tokens, costUSD) shape is normalized by the
   * optional fields defaulting to 0.
   */
  updateSessionCost(
    id: string,
    usage: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    },
    costUSD: number
  ): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.cost.promptTokens += usage.promptTokens ?? 0;
    session.cost.completionTokens += usage.completionTokens ?? 0;
    session.cost.totalTokens += usage.totalTokens ?? 0;
    session.cost.requests += 1;
    session.cost.estimatedCostUSD += costUSD;
    session.updatedAt = Date.now();
    this.markDirty(id);
  }

  updateSessionModel(id: string, model: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.model = model;
    session.updatedAt = Date.now();
    this.markDirty(id);
  }

  updateSessionAgent(id: string, agent: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.agent = agent;
    session.updatedAt = Date.now();
    this.markDirty(id);
  }

  private startAutoSave(intervalMs: number): void {
    this.autoSaveTimer = setInterval(() => {
      this.saveAllDirty();
    }, intervalMs);
  }

  shutdown(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }
    this.saveAllDirty();
  }
}

export const sessionManager = new SessionManager();
