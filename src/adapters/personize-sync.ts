import { client } from "../core/config.js";
import { logger } from "../core/lib/logger.js";
import type { CrmId } from "../core/operations/types.js";

/**
 * Personize-managed CRM sync (sync-in / sync-out).
 *
 * This is the high-level alternative to the raw CRM passthrough. Instead of our
 * code paginating HubSpot/Salesforce REST and mapping fields, Personize owns the
 * whole pipeline: connection (OAuth), fetch, field mapping, dedupe, and the
 * memorize/write-back. We only pick a provider + object and trigger a managed
 * "datasource".
 *
 * Provider-keyed by design — callers never see Nango/connection ids, only
 * `provider` ("hubspot") and `entityType` ("contact"). The org is implied by the
 * API key. Connection setup (connect/status/disconnect) is dashboard-only and is
 * intentionally NOT modeled here.
 *
 * Backed by the SDK `client.integrations.datasources.*` namespace. Like the CRM
 * passthrough, the credential/transport plumbing lives in the SDK; scripts need
 * only a Personize API key. Requires @personize/sdk with the integrations
 * namespace; a clear error is thrown if the installed SDK predates it.
 */

export type SyncProvider = Extract<CrmId, "hubspot" | "salesforce"> | (string & {});
export type SyncEntityType = "contact" | "company" | "deal";
export type SyncDirection = "in" | "out" | "both";

/** Terminal + in-flight states a managed run can report. Normalized lowercase. */
export type SyncRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | (string & {});

export interface DatasourceRecord {
  id: string;
  name?: string;
  provider?: string;
  entityType?: string;
}

export interface SyncRunResult {
  status: SyncRunStatus;
  recordCount?: number;
  successCount?: number;
  failedCount?: number;
  eventId?: string;
  error?: string;
}

interface DatasourceCreatePayload {
  name: string;
  provider: SyncProvider;
  entityType: SyncEntityType;
  mode: "template" | "ai" | "manual";
  template?: { type: "builtin" | "custom"; id: string };
}

interface DatasourcesApi {
  create(payload: DatasourceCreatePayload): Promise<{ data: DatasourceRecord }>;
  run(id: string, payload: { direction: SyncDirection }): Promise<{ data?: { eventId?: string; id?: string } }>;
  getRun(id: string, eventId: string): Promise<{ data: SyncRunResult[] }>;
  list(): Promise<{ data: DatasourceRecord[] }>;
}

interface IntegrationsApi {
  datasources: DatasourcesApi;
  suggestMappings(payload: { provider: SyncProvider; entityType: SyncEntityType; mode: "ai" | "template" }): Promise<unknown>;
}

interface EventRecord {
  id?: string;
  eventId?: string;
  resourceId?: string;
  datasourceId?: string;
  type?: string;
  direction?: SyncDirection;
  createdAt?: string;
}

interface EventsApi {
  list(options?: { limit?: number }): Promise<{ data: EventRecord[] }>;
}

const SDK_REQUIREMENT =
  "Requires @personize/sdk with the integrations namespace (client.integrations.datasources). " +
  "Upgrade the SDK, or connect the CRM and run sync from the Personize dashboard.";

function integrationsApi(): IntegrationsApi {
  const api = (client as unknown as { integrations?: IntegrationsApi }).integrations;
  if (!api?.datasources || typeof api.datasources.run !== "function") {
    throw new Error(`Personize managed sync unavailable: client.integrations.datasources not found. ${SDK_REQUIREMENT}`);
  }
  return api;
}

/** Optional events surface — used only to resolve a run's eventId for polling. */
function eventsApi(): EventsApi | undefined {
  const api = (client as unknown as { events?: EventsApi }).events;
  return api && typeof api.list === "function" ? api : undefined;
}

const PLURAL: Record<SyncEntityType, string> = {
  contact: "contacts",
  company: "companies",
  deal: "deals",
};

function titleCase(provider: SyncProvider): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

/** Built-in template id Personize ships per provider+object, e.g. `hubspot_contacts_standard`. */
function builtinTemplateId(provider: SyncProvider, entityType: SyncEntityType): string {
  return `${provider}_${PLURAL[entityType]}_standard`;
}

function datasourceName(provider: SyncProvider, entityType: SyncEntityType): string {
  return `${titleCase(provider)} ${titleCase(PLURAL[entityType])}`;
}

/**
 * Find the org's existing datasource for this provider+object, or create one
 * with the built-in standard template (zero field mapping required).
 * Idempotent — safe to call before every sync.
 */
export async function ensureDatasource(provider: SyncProvider, entityType: SyncEntityType): Promise<DatasourceRecord> {
  const api = integrationsApi();

  const existing = await api.datasources.list().catch((error) => {
    logger.warn("personize-sync: datasource list failed; will attempt create", {
      provider,
      entityType,
      error: error instanceof Error ? error.message : String(error),
    });
    return { data: [] as DatasourceRecord[] };
  });

  const name = datasourceName(provider, entityType);
  const match = existing.data.find(
    (d) => (d.provider === provider && d.entityType === entityType) || d.name === name,
  );
  if (match) return match;

  const created = await api.datasources.create({
    name,
    provider,
    entityType,
    mode: "template",
    template: { type: "builtin", id: builtinTemplateId(provider, entityType) },
  });
  logger.info("personize-sync: created datasource", { provider, entityType, id: created.data.id });
  return created.data;
}

const TERMINAL_OK = new Set(["succeeded", "success", "completed", "complete", "done"]);
const TERMINAL_FAIL = new Set(["failed", "failure", "error", "errored", "cancelled", "canceled"]);

function isTerminal(status: SyncRunStatus): boolean {
  const s = status.toLowerCase();
  return TERMINAL_OK.has(s) || TERMINAL_FAIL.has(s);
}

export function runFailed(status: SyncRunStatus): boolean {
  return TERMINAL_FAIL.has(status.toLowerCase());
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Best-effort resolution of the eventId a `run()` dispatched. The run call is
 * async and (per Personize) does not yet echo the eventId back, so we fall back
 * to the most recent matching event from the events feed.
 */
async function resolveEventId(
  datasourceId: string,
  direction: SyncDirection,
  runResponse: { data?: { eventId?: string; id?: string } },
): Promise<string | undefined> {
  const echoed = runResponse.data?.eventId ?? runResponse.data?.id;
  if (echoed) return echoed;

  const events = eventsApi();
  if (!events) return undefined;

  try {
    const recent = await events.list({ limit: 25 });
    const candidates = recent.data.filter(
      (e) =>
        (e.datasourceId === datasourceId || e.resourceId === datasourceId) &&
        (e.direction === undefined || e.direction === direction),
    );
    const latest = candidates[candidates.length - 1] ?? candidates[0];
    return latest?.eventId ?? latest?.id;
  } catch (error) {
    logger.warn("personize-sync: event resolution failed", {
      datasourceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

export interface RunSyncOptions {
  /** Poll until the run reaches a terminal state. Default true. */
  poll?: boolean;
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
}

/**
 * Trigger a managed sync for one datasource and (by default) poll to completion.
 *
 * When the eventId can't be resolved (async dispatch, no events surface), returns
 * `{ status: "running", eventId: undefined }` so the caller can report
 * "dispatched" rather than fail — the run still proceeds inside Personize.
 */
export async function runSync(
  datasourceId: string,
  direction: SyncDirection,
  options: RunSyncOptions = {},
): Promise<SyncRunResult> {
  const api = integrationsApi();
  const { poll = true, pollTimeoutMs = 120_000, pollIntervalMs = 3_000 } = options;

  const runResponse = await api.datasources.run(datasourceId, { direction });
  const eventId = await resolveEventId(datasourceId, direction, runResponse);

  if (!poll || !eventId) {
    return { status: eventId ? "running" : "queued", eventId };
  }

  const deadline = Date.now() + pollTimeoutMs;
  let last: SyncRunResult = { status: "running", eventId };
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    const res = await api.datasources.getRun(datasourceId, eventId);
    const record = res.data?.[0];
    if (record) {
      last = { ...record, eventId };
      if (isTerminal(record.status)) return last;
    }
  }
  logger.warn("personize-sync: poll timed out; run still in flight", { datasourceId, eventId, pollTimeoutMs });
  return last;
}

/** Preview AI/template field mappings for a provider+object without committing. */
export async function previewMappings(
  provider: SyncProvider,
  entityType: SyncEntityType,
  mode: "ai" | "template" = "ai",
): Promise<unknown> {
  return integrationsApi().suggestMappings({ provider, entityType, mode });
}
