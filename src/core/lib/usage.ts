import { AsyncLocalStorage } from "node:async_hooks";

// -----------------------------------------------------------------------------
// Usage telemetry — per-run accumulation of AI cost, concurrency-safe.
//
// ai() calls reportUsage() after each request. The operation runner wraps each
// run in withUsageSink() and reads getUsageTotals() to persist credits/tokens to
// the operation-runs record. AsyncLocalStorage isolates concurrent runs (parallel
// dispatch runs many operations at once in-process), so each run accumulates only
// its own AI calls — no global counter, no cross-run attribution bug.
// -----------------------------------------------------------------------------

export interface UsageTotals {
  /** Personize credits charged across all AI calls in this run. */
  credits: number;
  /** Total tokens across all AI calls in this run. */
  tokens: number;
  /** Number of ai() calls made in this run. */
  aiCalls: number;
}

const usageContext = new AsyncLocalStorage<UsageTotals>();

/** Establish a fresh usage sink for the duration of fn. Nestable; inner runs get their own sink. */
export function withUsageSink<T>(fn: () => Promise<T>): Promise<T> {
  return usageContext.run({ credits: 0, tokens: 0, aiCalls: 0 }, fn);
}

/** Add one AI call's usage to the active sink. No-op outside a sink (e.g. subagent routes). */
export function reportUsage(usage: { credits?: number; tokens?: number }): void {
  const store = usageContext.getStore();
  if (!store) return;
  store.credits += usage.credits ?? 0;
  store.tokens += usage.tokens ?? 0;
  store.aiCalls += 1;
}

/** Snapshot the active sink's totals, or undefined when called outside a sink. */
export function getUsageTotals(): UsageTotals | undefined {
  const store = usageContext.getStore();
  return store ? { ...store } : undefined;
}
