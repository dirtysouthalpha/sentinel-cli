import { redact } from "../core/redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface LoggerOptions {
  level: LogLevel;
  prefix?: string;
  colors?: boolean;
  timestamp?: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

let globalLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  globalLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[globalLevel];
}

function formatMessage(
  level: LogLevel,
  message: string,
  prefix?: string,
  timestamp?: boolean
): string {
  const parts: string[] = [];
  if (timestamp) {
    parts.push(`[${new Date().toISOString()}]`);
  }
  parts.push(`[${level.toUpperCase()}]`);
  if (prefix) {
    parts.push(`[${prefix}]`);
  }
  parts.push(message);
  return parts.join(" ");
}

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  child(options: { prefix?: string }): Logger;
}

export function createLogger(options: Partial<LoggerOptions> = {}): Logger {
  const prefix = options.prefix;
  const showTimestamp = options.timestamp ?? false;

  const log = (level: LogLevel, message: string, args: unknown[]) => {
    if (!shouldLog(level)) return;
    // V16: scrub credentials from log lines + string args before they hit stderr.
    const formatted = redact(formatMessage(level, message, prefix, showTimestamp));
    const safeArgs = args.map((a) => (typeof a === "string" ? redact(a) : a));
    // All logs go to stderr so stdout stays clean for command output (e.g.
    // `run --json` NDJSON, `config --json`, MCP stdio JSON-RPC).
    const output = level === "warn" ? console.warn : console.error;
    output(formatted, ...safeArgs);
  };

  return {
    debug: (message: string, ...args: unknown[]) => log("debug", message, args),
    info: (message: string, ...args: unknown[]) => log("info", message, args),
    warn: (message: string, ...args: unknown[]) => log("warn", message, args),
    error: (message: string, ...args: unknown[]) => log("error", message, args),
    child: (childOptions: { prefix?: string }) =>
      createLogger({
        ...options,
        prefix: prefix ? `${prefix}:${childOptions.prefix}` : childOptions.prefix,
      }),
  };
}

export const logger = createLogger();
