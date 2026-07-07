import { logger } from "../../lib/logger.js";
import {
  ensureDatasource,
  runSync,
  runFailed,
  validateSync,
  type MappingMode,
  type SyncEntityType,
  type SyncProvider,
  type SyncRunResult,
  type SyncValidation,
} from "../../../adapters/personize-sync.js";
import { backfillCrmRecordIds, type BackfillResult } from "../../lib/crm-record-id-backfill.js";
import type { OperationEntry } from "../types.js";

// Default objects to import per provider. Salesforce companies (Account) ship a
// template too, but we keep the conservative default until verified end-to-end.
const DEFAULT_OBJECTS: Record<string, SyncEntityType[]> = {
  hubspot: ["contact", "company"],
  salesforce: ["contact"],
  apollo: ["contact"],
};

// Providers Personize ships no builtin sync template for — their mappings must be
// resolved via AI (suggestMappings → manual datasource).
const PROVIDERS_WITHOUT_TEMPLATES = new Set(["apollo", "apollo-oauth"]);

function resolveObjects(provider: SyncProvider, requested?: unknown): SyncEntityType[] {
  if (Array.isArray(requested) && requested.length > 0) {
    return requested.filter((o): o is SyncEntityType => o === "contact" || o === "company" || o === "deal");
  }
  return DEFAULT_OBJECTS[provider] ?? ["contact"];
}

/** Coerce a record cap from input; ignore non-positive / non-integer values. */
export function resolveMaxRecords(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * Pick the mapping strategy. Honor an explicit request; otherwise default to `ai`
 * for template-less providers (Apollo) and `auto` (template-then-AI) for the rest.
 */
export function resolveMappingMode(requested: unknown, provider: SyncProvider): MappingMode {
  if (requested === "template" || requested === "ai" || requested === "auto") return requested;
  return PROVIDERS_WITHOUT_TEMPLATES.has(provider) ? "ai" : "auto";
}

/** Map a low-level "connection missing" error to actionable guidance. */
function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/connection_not_found|connection_disconnected|not.?connected/i.test(message)) {
    return `${message} — connect the CRM once at https://app.personize.ai → Integrations, then re-run.`;
  }
  return message;
}

export const crmSyncCore: OperationEntry = {
  name: "crm.sync-core",
  mode: "operation",
  description:
    "Import CRM records (HubSpot/Salesforce/Apollo contacts and companies) into Personize via Personize-managed " +
    "sync-in. Connection (OAuth), pagination, field mapping, dedupe, and association linking all run inside Personize " +
    "— this operation only selects the provider + objects and triggers/polls the managed datasource. Optional inputs: " +
    "`max_records` caps records per run (bounded/test syncs); `mapping_mode` is `template` | `ai` | `auto` (default " +
    "`auto`, or `ai` for providers like Apollo that ship no builtin template). Connect the CRM once in the Personize " +
    "dashboard (Integrations).",
  category: "sync",
  status: "live",
  idempotent: true,
  cost: "medium",
  run_mode: "on-trigger",
  guidelines_required: ["crm-writeback-policy", "data-hygiene"],
  run: async (input, context) => {
    const inputObj = (input ?? {}) as {
      crm?: string;
      provider?: string;
      objects?: unknown;
      max_records?: unknown;
      maxRecords?: unknown;
      mapping_mode?: unknown;
      mappingMode?: unknown;
    };
    const provider = (inputObj.provider ?? inputObj.crm ?? context.crm ?? "hubspot") as SyncProvider;
    const objects = resolveObjects(provider, inputObj.objects);
    const maxRecords = resolveMaxRecords(inputObj.max_records ?? inputObj.maxRecords);
    const mappingMode = resolveMappingMode(inputObj.mapping_mode ?? inputObj.mappingMode, provider);
    const capNote = maxRecords != null ? ` (max ${maxRecords})` : "";

    if (context.dryRun) {
      // Validate each object against Personize (run dryRun:true) — no writes.
      const validations: SyncValidation[] = [];
      for (const entityType of objects) {
        validations.push(await validateSync(provider, entityType, "in"));
      }
      const allValid = validations.every((v) => v.ok);
      const detail = validations.map((v) => `${v.entityType}: ${v.note}`).join(" | ");
      return {
        ok: allValid,
        runId: context.runId,
        operation: "crm.sync-core",
        dryRun: true,
        status: "live",
        summary: `[DRY RUN] Validated Personize-managed sync-in for ${provider} ${objects.join(", ")}${capNote} via ${mappingMode} mapping. ${detail}`,
        metrics: { dry_run: true, provider, objects, max_records: maxRecords, mapping_mode: mappingMode, validations },
      };
    }

    const perObject: Record<string, SyncRunResult> = {};
    let totalRecords = 0;
    let totalSuccess = 0;
    let totalFailed = 0;
    let anyFailedRun = false;

    try {
      for (const entityType of objects) {
        const ds = await ensureDatasource(provider, entityType, { maxRecords, mappingMode });
        const result = await runSync(ds.id, "in");
        perObject[entityType] = result;
        totalRecords += result.recordCount ?? 0;
        totalSuccess += result.successCount ?? 0;
        totalFailed += result.failedCount ?? 0;
        if (runFailed(result.status)) anyFailedRun = true;
        logger.info("crm.sync-core: object synced", { provider, entityType, ...result });
      }
    } catch (error) {
      const message = explain(error);
      logger.error("crm.sync-core failed", { provider, error: message });
      return {
        ok: false,
        runId: context.runId,
        operation: "crm.sync-core",
        dryRun: context.dryRun,
        status: "live",
        summary: `Sync-in failed: ${message}`,
        metrics: { provider, objects, error: message, per_object: perObject },
      };
    }

    // The managed template maps business fields but not the CRM's native object
    // id, which downstream writeback needs (see crm-record-id-backfill). Pull each
    // object's id and set crm_record_id on the matching Personize record. hubspot-
    // only, best-effort, and idempotent — a no-op for records already carrying an
    // id, so it's safe to re-run after an async sync finishes landing records.
    const backfills: BackfillResult[] = [];
    if (provider === "hubspot") {
      for (const entityType of objects) {
        backfills.push(await backfillCrmRecordIds(provider, entityType, { maxRecords }));
      }
    }
    const backfilled = backfills.reduce((sum, b) => sum + b.updated, 0);

    const dispatchedOnly = Object.values(perObject).every((r) => !r.eventId);
    const backfillNote = backfilled > 0 ? ` Backfilled crm_record_id on ${backfilled} record(s).` : "";
    const summary = dispatchedOnly
      ? `Dispatched Personize-managed sync-in for ${provider} ${objects.join(", ")}. Runs are async — check status in the Personize dashboard or via events.${backfillNote}`
      : `Synced ${totalSuccess}/${totalRecords} ${provider} records (${objects.join(", ")}) into Personize via managed sync-in.${backfillNote}`;

    return {
      ok: !anyFailedRun,
      runId: context.runId,
      operation: "crm.sync-core",
      dryRun: context.dryRun,
      status: "live",
      summary,
      metrics: {
        provider,
        objects,
        max_records: maxRecords,
        mapping_mode: mappingMode,
        records_scanned: totalRecords,
        records_updated: totalSuccess,
        records_failed: totalFailed,
        per_object: perObject,
        crm_record_id_backfill: backfills,
      },
    };
  },
};
