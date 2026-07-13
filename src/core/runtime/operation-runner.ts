import { randomUUID } from "node:crypto";
import { ensurePersonizeKey, hasCapability, PERSONIZE_MODE } from "../config.js";
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

  // Capability gate: refuse operations whose backend requirements the active
  // deployment (hosted vs Personize Private) can't meet, with a clear message
  // rather than a confusing failure deep inside an SDK/gateway call.
  if (operation.requires?.length) {
    const missing = operation.requires.filter((c) => !hasCapability(c));
    if (missing.length > 0) {
      throw new Error(
        `Operation ${name} requires capabilities not available on the ${PERSONIZE_MODE} backend: ` +
          `${missing.join(", ")}. See docs/PERSONIZE-PRIVATE.md.`,
      );
    }
  }

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
        // Acceptance vocabulary (present on operations that declare a gate):
        // completion is not success, so persist accepted/rejected distinctly
        // from records_updated. Cost per accepted unit is reconstructable from
        // durable run history rather than a live transcript.
        const attempted = typeof metrics.attempted === "number" ? metrics.attempted : undefined;
        const accepted = typeof metrics.accepted === "number" ? metrics.accepted : undefined;
        const rejected = typeof metrics.rejected === "number" ? metrics.rejected : undefined;
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
          attempted,
          accepted,
          rejected,
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
