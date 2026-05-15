import { AsyncLocalStorage } from "node:async_hooks";

type LogLevel = "debug" | "info" | "warn" | "error";

interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(defaultMeta: Record<string, unknown>): Logger;
}

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const asyncContext = new AsyncLocalStorage<{ runId: string; operation: string }>();

function currentThreshold(): number {
  const level = (process.env.LOG_LEVEL ?? "info").toLowerCase() as LogLevel;
  return LEVELS[level] ?? LEVELS.info;
}

function write(level: LogLevel, message: string, meta: Record<string, unknown>): void {
  if (LEVELS[level] < currentThreshold()) return;
  const ctx = asyncContext.getStore();
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(ctx ?? {}),
    ...meta,
  };
  const line = `${JSON.stringify(entry)}\n`;
  if (level === "warn" || level === "error") process.stderr.write(line);
  else process.stdout.write(line);
}

function createLogger(defaultMeta: Record<string, unknown> = {}): Logger {
  return {
    debug: (message, meta) => write("debug", message, { ...defaultMeta, ...meta }),
    info: (message, meta) => write("info", message, { ...defaultMeta, ...meta }),
    warn: (message, meta) => write("warn", message, { ...defaultMeta, ...meta }),
    error: (message, meta) => write("error", message, { ...defaultMeta, ...meta }),
    child: (meta) => createLogger({ ...defaultMeta, ...meta }),
  };
}

export const logger = createLogger();

export function withRunContext<T>(
  meta: { runId: string; operation: string },
  fn: () => Promise<T>,
): Promise<T> {
  return asyncContext.run(meta, fn);
}
