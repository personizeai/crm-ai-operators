import { randomUUID } from "node:crypto";
import { ensurePersonizeKey } from "../config.js";
import { isDryRun } from "../lib/dry-run.js";
import { logger, withRunContext } from "../lib/logger.js";
import { withUsageSink, getUsageTotals } from "../lib/usage.js";
import { safeAudit } from "./audit-log.js";
import { persistRunRecord } from "./run-store.js";
import { OPERATIONS } from "../operations/registry.js";
import type { CrmId, OperationResult } from "../operations/types.js";

export async function runOperation(
  name: string,
  input: unknown = {},
  options: { crm?: CrmId; tierOverride?: string; modelOverride?: string } = {},
): Promise<OperationResult> {
  const operation = OPERATIONS[name];
  if (!operation) {
    throw new Error(`Unknown operation: ${name}`);
  }

  // Operations always need Personize. Fail fast with a friendly error rather
  // than letting an SDK call deep inside the operation produce a confusing one.
  ensurePersonizeKey();

  const runId = randomUUID();
  const dryRun = await isDryRun();
  const crm = options.crm ?? (input as { crm?: CrmId } | undefined)?.crm;
  const startedAt = new Date().toISOString();

  // withUsageSink establishes a per-run AI-cost accumulator that ai() reports into.
  // getUsageTotals() reads it before each persist, so completed AND failed runs
  // record whatever AI cost was incurred before they ended.
  return withRunContext({ runId, operation: name }, () =>
    withUsageSink(async () => {
      logger.info("Operation started", { dryRun, mode: operation.mode, crm });
      await safeAudit({ runId, operation: name, event: "started", dryRun, meta: { input, crm } });
      await persistRunRecord({
        run_id: runId,
        mode: operation.mode,
        operation: name,
        status: "started",
        dry_run: dryRun,
        started_at: startedAt,
      });

      try {
        const result = await operation.run(input, {
          runId,
          dryRun,
          mode: operation.mode,
          crm,
          tierOverride: options.tierOverride,
          modelOverride: options.modelOverride,
        });
        const completedAt = new Date().toISOString();
        const metrics = result.metrics ?? {};
        const recordsScanned =
          typeof metrics.records_scanned === "number" ? metrics.records_scanned : undefined;
        const recordsUpdated =
          typeof metrics.records_updated === "number" ? metrics.records_updated : undefined;
        const usage = getUsageTotals();
        // Surface per-run cost on the result so callers (e.g. the dispatcher's
        // budget accounting) can read it without a separate query.
        if (usage) {
          result.metrics = {
            ...(result.metrics ?? {}),
            credits_used: usage.credits,
            tokens_used: usage.tokens,
            ai_calls: usage.aiCalls,
          };
        }

        await safeAudit({ runId, operation: name, event: "completed", dryRun, meta: result });
        await persistRunRecord({
          run_id: runId,
          mode: operation.mode,
          operation: name,
          status: "completed",
          dry_run: dryRun,
          summary: result.summary,
          records_scanned: recordsScanned,
          records_updated: recordsUpdated,
          started_at: startedAt,
          completed_at: completedAt,
          credits_used: usage?.credits,
          tokens_used: usage?.tokens,
          ai_calls: usage?.aiCalls,
        });

        logger.info("Operation completed", {
          ok: result.ok,
          summary: result.summary,
          credits_used: usage?.credits,
          ai_calls: usage?.aiCalls,
        });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const completedAt = new Date().toISOString();
        const usage = getUsageTotals();

        await safeAudit({ runId, operation: name, event: "failed", dryRun, meta: { error: message } });
        await persistRunRecord({
          run_id: runId,
          mode: operation.mode,
          operation: name,
          status: "failed",
          dry_run: dryRun,
          summary: message,
          started_at: startedAt,
          completed_at: completedAt,
          credits_used: usage?.credits,
          tokens_used: usage?.tokens,
          ai_calls: usage?.aiCalls,
        });

        logger.error("Operation failed", { error: message });
        throw error;
      }
    }),
  );
}
