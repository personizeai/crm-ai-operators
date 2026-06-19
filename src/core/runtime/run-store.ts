import { logger } from "../lib/logger.js";
import { setProperties } from "../lib/persist.js";
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
    await setProperties(
      { type: "operation-run", collection: "operation-runs", recordId: record.run_id },
      record as unknown as Record<string, unknown>,
    );
  } catch (error) {
    logger.warn("Failed to persist operation run to Personize", {
      runId: record.run_id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
