import { EventEmitter } from "events";

export interface StateSlice<T> {
  get(): T;
  set(value: T): void;
  subscribe(listener: (value: T, prev: T) => void): () => void;
}

export interface CompressionStats {
  originalTokens: number;
  compressedTokens: number;
  savingsPercent: number;
  lastCompressed: number;
}

export interface AppState {
  activeSession: string | null;
  activeSessionId: string | null;
  currentTheme: string;
  currentAgent: string;
  currentModel: string;
  currentProvider: string;
  sidebarOpen: boolean;
  activePanel: "chat" | "files" | "agents" | "settings";
  statusText: string;
  isProcessing: boolean;
  messages: ChatMessage[];
  sessions: Session[];
  currentWorkingDir: string;
  sessionTitle: string;
  compressionStats: CompressionStats;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  model?: string;
  agent?: string;
}

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

const initialState: AppState = {
  activeSession: null,
  activeSessionId: null,
  currentTheme: "cyberpunk",
  currentAgent: "gsd",
  currentModel: "zai/glm-4.6",
  currentProvider: "zai",
  sidebarOpen: true,
  activePanel: "chat",
  statusText: "Ready",
  isProcessing: false,
  messages: [],
  sessions: [],
  currentWorkingDir: process.cwd(),
  sessionTitle: "Session 1",
  compressionStats: {
    originalTokens: 0,
    compressedTokens: 0,
    savingsPercent: 0,
    lastCompressed: 0,
  },
};

function createSlice<T>(
  emitter: EventEmitter,
  key: string,
  initialValue: T
): StateSlice<T> {
  let value = initialValue;
  const listeners = new Set<(value: T, prev: T) => void>();

  return {
    get(): T {
      return value;
    },
    set(newValue: T): void {
      const prev = value;
      value = newValue;
      emitter.emit(`state:${key}`, value, prev);
      for (const listener of listeners) {
        listener(value, prev);
      }
    },
    subscribe(listener: (value: T, prev: T) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

class StateManager {
  private state: Map<string, unknown> = new Map();
  private emitter = new EventEmitter();
  private static instance: StateManager;

  static getInstance(): StateManager {
    if (!StateManager.instance) {
      StateManager.instance = new StateManager();
    }
    return StateManager.instance;
  }

  private constructor() {
    for (const [key, value] of Object.entries(initialState)) {
      this.state.set(key, value);
    }
  }

  get<K extends keyof AppState>(key: K): AppState[K] {
    return this.state.get(key) as AppState[K];
  }

  set<K extends keyof AppState>(key: K, value: AppState[K]): void {
    const prev = this.state.get(key);
    this.state.set(key, value);
    this.emitter.emit(`state:${key}`, value, prev);
  }

  slice<K extends keyof AppState>(key: K): StateSlice<AppState[K]> {
    return createSlice(this.emitter, key, this.state.get(key) as AppState[K]);
  }

  subscribe<K extends keyof AppState>(
    key: K,
    listener: (value: AppState[K], prev: AppState[K]) => void
  ): () => void {
    this.emitter.on(`state:${key}`, listener);
    return () => {
      this.emitter.off(`state:${key}`, listener);
    };
  }

  getAll(): AppState {
    const result = {} as Record<string, unknown>;
    for (const [key, value] of this.state.entries()) {
      result[key] = value;
    }
    return result as unknown as AppState;
  }

  reset(): void {
    for (const [key, value] of Object.entries(initialState)) {
      this.state.set(key, value);
    }
    this.emitter.emit("state:reset");
  }
}

export const state = StateManager.getInstance();
