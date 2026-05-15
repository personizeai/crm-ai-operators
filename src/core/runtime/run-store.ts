import { client } from "../config.js";
import { logger } from "../lib/logger.js";
import type { OperationMode } from "../operations/types.js";

export interface OperationRunRecord {
  run_id: string;
  mode: OperationMode;
  operation: string;
  status: "started" | "completed" | "failed" | "cancelled";
  dry_run: boolean;
  records_scanned?: number;
  records_updated?: number;
  summary?: string;
  started_at?: string;
  completed_at?: string;
}

/**
 * Persist an operation run to the Personize `operation-runs` collection so
 * later operations (e.g. optimize.review-runs) can query history via
 * memory_search instead of parsing local JSONL.
 *
 * Run-record persistence is a side concern. Failures are logged and swallowed
 * — never let a Personize hiccup crash a working operation.
 */
export async function persistRunRecord(record: OperationRunRecord): Promise<void> {
  try {
    const memory = (client as any).memory;
    if (!memory) {
      logger.warn("Personize SDK has no memory interface; skipping run persistence", {
        runId: record.run_id,
      });
      return;
    }
    if (typeof memory.store === "function") {
      await memory.store({
        collectionSlug: "operation-runs",
        primaryKey: { run_id: record.run_id },
        properties: record,
      });
    } else if (typeof memory.batchStore === "function") {
      await memory.batchStore({
        collectionSlug: "operation-runs",
        records: [{ primaryKey: { run_id: record.run_id }, properties: record }],
      });
    } else {
      logger.warn("Personize memory.store / batchStore not found; skipping run persistence", {
        runId: record.run_id,
      });
    }
  } catch (error) {
    logger.warn("Failed to persist operation run to Personize", {
      runId: record.run_id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
