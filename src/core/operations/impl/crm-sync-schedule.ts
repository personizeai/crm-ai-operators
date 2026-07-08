import { logger } from "../../lib/logger.js";
import {
  setSyncSchedule,
  type EnsureDatasourceOptions,
  type ScheduleFrequency,
  type SyncEntityType,
  type SyncProvider,
  type SyncSchedule,
} from "../../../adapters/personize-sync.js";
import { customEntitiesByType, type CustomEntity } from "../../lib/crm-custom-entities.js";
import { buildCustomEntitySync } from "../../lib/crm-field-map.js";
import type { OperationEntry } from "../types.js";

const DEFAULT_OBJECTS: Record<string, SyncEntityType[]> = {
  hubspot: ["contact", "company"],
  salesforce: ["contact"],
  apollo: ["contact"],
};

const FREQUENCIES = new Set<ScheduleFrequency>(["hourly", "daily", "weekly", "manual-only"]);

function resolveObjects(provider: SyncProvider, requested: unknown, validCustom: Set<string>): SyncEntityType[] {
  if (Array.isArray(requested) && requested.length > 0) {
    return requested.filter(
      (o): o is SyncEntityType =>
        o === "contact" || o === "company" || (typeof o === "string" && validCustom.has(o)),
    );
  }
  return DEFAULT_OBJECTS[provider] ?? ["contact"];
}

function resolveFrequency(value: unknown): ScheduleFrequency {
  return typeof value === "string" && FREQUENCIES.has(value as ScheduleFrequency)
    ? (value as ScheduleFrequency)
    : "daily";
}

function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/connection_not_found|connection_disconnected|not.?connected/i.test(message)) {
    return `${message} — connect the CRM once at https://app.personize.ai → Integrations, then re-run.`;
  }
  return message;
}

export const crmSyncSchedule: OperationEntry = {
  name: "crm.sync-schedule",
  mode: "operation",
  description:
    "Enable or disable the Personize-managed recurring sync for a provider's objects. Personize runs the sync on the " +
    "chosen cadence (incremental) without us scheduling anything locally. Inputs: `frequency` is `hourly` | `daily` | " +
    "`weekly` | `manual-only` (default `daily`); `enabled` defaults true (set false, or frequency `manual-only`, to " +
    "turn the cron off); `objects` defaults to the provider's standard set. Connect the CRM in the Personize dashboard first.",
  category: "sync",
  status: "live",
  idempotent: true,
  cost: "low",
  run_mode: "manual",
  guidelines_required: [],
  run: async (input, context) => {
    const inputObj = (input ?? {}) as {
      crm?: string;
      provider?: string;
      objects?: unknown;
      enabled?: unknown;
      frequency?: unknown;
    };
    const provider = (inputObj.provider ?? inputObj.crm ?? context.crm ?? "hubspot") as SyncProvider;
    const customByType = await customEntitiesByType();
    const objects = resolveObjects(provider, inputObj.objects, new Set(customByType.keys()));
    const frequency = resolveFrequency(inputObj.frequency);
    // Explicit enabled:false, or frequency 'manual-only', disables the cron.
    const enabled = inputObj.enabled === false ? false : frequency !== "manual-only";
    const state = enabled ? `every ${frequency}` : "disabled";

    if (context.dryRun) {
      return {
        ok: true,
        runId: context.runId,
        operation: "crm.sync-schedule",
        dryRun: true,
        status: "live",
        summary: `[DRY RUN] Would set Personize-managed sync schedule for ${provider} ${objects.join(", ")} to ${state}.`,
        metrics: { dry_run: true, provider, objects, enabled, frequency },
      };
    }

    const perObject: Record<string, SyncSchedule> = {};
    try {
      for (const entityType of objects) {
        const custom: CustomEntity | undefined = customByType.get(entityType);
        // Scheduling ensures the datasource exists first; pass the custom entity's
        // manifest config so that create is a correct manual one.
        const ensureOpts: EnsureDatasourceOptions | undefined = custom
          ? buildCustomEntitySync(custom.manifest, provider)
          : undefined;
        const schedule = await setSyncSchedule(provider, entityType, { enabled, frequency }, ensureOpts);
        perObject[entityType] = schedule;
        logger.info("crm.sync-schedule: schedule set", { provider, entityType, ...schedule });
      }
    } catch (error) {
      const message = explain(error);
      logger.error("crm.sync-schedule failed", { provider, error: message });
      return {
        ok: false,
        runId: context.runId,
        operation: "crm.sync-schedule",
        dryRun: context.dryRun,
        status: "live",
        summary: `Schedule update failed: ${message}`,
        metrics: { provider, objects, error: message, per_object: perObject },
      };
    }

    return {
      ok: true,
      runId: context.runId,
      operation: "crm.sync-schedule",
      dryRun: context.dryRun,
      status: "live",
      summary: `Set Personize-managed sync schedule for ${provider} ${objects.join(", ")} to ${state}.`,
      metrics: { provider, objects, enabled, frequency, per_object: perObject },
    };
  },
};
