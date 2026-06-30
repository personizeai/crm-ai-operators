import { logger } from "../../lib/logger.js";
import {
  ensureDatasource,
  runSync,
  runFailed,
  validateSync,
  type SyncEntityType,
  type SyncProvider,
  type SyncRunResult,
  type SyncValidation,
} from "../../../adapters/personize-sync.js";
import type { OperationEntry } from "../types.js";

// Which objects to write back by default. Same default set as sync-in.
const DEFAULT_OBJECTS: Record<string, SyncEntityType[]> = {
  hubspot: ["contact", "company"],
  salesforce: ["contact"],
};

function resolveObjects(provider: SyncProvider, requested?: unknown): SyncEntityType[] {
  if (Array.isArray(requested) && requested.length > 0) {
    return requested.filter((o): o is SyncEntityType => o === "contact" || o === "company" || o === "deal");
  }
  return DEFAULT_OBJECTS[provider] ?? ["contact"];
}

function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/connection_not_found|connection_disconnected|not.?connected/i.test(message)) {
    return `${message} — connect the CRM once at https://app.personize.ai → Integrations, then re-run.`;
  }
  return message;
}

export const crmSyncOut: OperationEntry = {
  name: "crm.sync-out",
  mode: "operation",
  description:
    "Write enriched Personize properties back to the connected CRM via Personize-managed sync-out (direction:'out'). " +
    "Personize owns the reverse field mapping; AI-generated values land on dedicated CRM AI properties and never " +
    "overwrite human-entered native fields. Selects provider + objects and triggers/polls the managed datasource. " +
    "Connect the CRM once in the Personize dashboard (Integrations).",
  category: "sync",
  status: "live",
  idempotent: true,
  cost: "medium",
  run_mode: "on-decision",
  guidelines_required: ["crm-writeback-policy"],
  run: async (input, context) => {
    const inputObj = (input ?? {}) as { crm?: string; provider?: string; objects?: unknown };
    const provider = (inputObj.provider ?? inputObj.crm ?? context.crm ?? "hubspot") as SyncProvider;
    const objects = resolveObjects(provider, inputObj.objects);

    if (context.dryRun) {
      // Validate each object against Personize (run dryRun:true) — no writes.
      const validations: SyncValidation[] = [];
      for (const entityType of objects) {
        validations.push(await validateSync(provider, entityType, "out"));
      }
      const allValid = validations.every((v) => v.ok);
      const detail = validations.map((v) => `${v.entityType}: ${v.note}`).join(" | ");
      return {
        ok: allValid,
        runId: context.runId,
        operation: "crm.sync-out",
        dryRun: true,
        status: "live",
        summary: `[DRY RUN] Validated Personize-managed sync-out (write-back) for ${provider} ${objects.join(", ")}. ${detail}`,
        metrics: { dry_run: true, provider, objects, validations },
      };
    }

    const perObject: Record<string, SyncRunResult> = {};
    let totalRecords = 0;
    let totalSuccess = 0;
    let totalFailed = 0;
    let anyFailedRun = false;

    try {
      for (const entityType of objects) {
        const ds = await ensureDatasource(provider, entityType);
        const result = await runSync(ds.id, "out");
        perObject[entityType] = result;
        totalRecords += result.recordCount ?? 0;
        totalSuccess += result.successCount ?? 0;
        totalFailed += result.failedCount ?? 0;
        if (runFailed(result.status)) anyFailedRun = true;
        logger.info("crm.sync-out: object written back", { provider, entityType, ...result });
      }
    } catch (error) {
      const message = explain(error);
      logger.error("crm.sync-out failed", { provider, error: message });
      return {
        ok: false,
        runId: context.runId,
        operation: "crm.sync-out",
        dryRun: context.dryRun,
        status: "live",
        summary: `Sync-out failed: ${message}`,
        metrics: { provider, objects, error: message, per_object: perObject },
      };
    }

    const dispatchedOnly = Object.values(perObject).every((r) => !r.eventId);
    const summary = dispatchedOnly
      ? `Dispatched Personize-managed sync-out for ${provider} ${objects.join(", ")}. Runs are async — check status in the Personize dashboard or via events.`
      : `Wrote ${totalSuccess}/${totalRecords} ${provider} records (${objects.join(", ")}) back to the CRM via managed sync-out.`;

    return {
      ok: !anyFailedRun,
      runId: context.runId,
      operation: "crm.sync-out",
      dryRun: context.dryRun,
      status: "live",
      summary,
      metrics: {
        provider,
        objects,
        records_scanned: totalRecords,
        records_updated: totalSuccess,
        records_failed: totalFailed,
        per_object: perObject,
      },
    };
  },
};
