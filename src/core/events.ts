import { EventEmitter } from "events";

export interface SentinelEvents {
  "config:loaded": [path: string];
  "config:changed": [key: string, value: unknown];
  "theme:changed": [themeName: string];
  "agent:switched": [agentName: string];
  "model:changed": [modelName: string];
  "chat:message": [role: string, content: string];
  "chat:stream": [chunk: string];
  "tool:execute": [toolName: string, args: unknown];
  "tool:result": [toolName: string, result: unknown];
  "skill:loaded": [skillName: string];
  "command:executed": [commandName: string, args: string[]];
  "session:created": [sessionId: string];
  "session:switched": [sessionId: string];
  "session:closed": [sessionId: string];
  "session:renamed": [sessionId: string, title: string];
  "tab:created": [sessionId: string];
  "tab:activated": [sessionId: string];
  "tab:closed": [sessionId: string];
  "app:ready": [];
  "app:quit": [];
  "error": [error: Error];
}

class SentinelEventBus extends EventEmitter {
  private static instance: SentinelEventBus;

  static getInstance(): SentinelEventBus {
    if (!SentinelEventBus.instance) {
      SentinelEventBus.instance = new SentinelEventBus();
    }
    return SentinelEventBus.instance;
  }

  removeAll(): void {
    this.removeAllListeners();
  }
}

export const events = SentinelEventBus.getInstance();
