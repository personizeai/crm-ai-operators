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
  /** The SDK nests config fields here on list/get; identity may live top-level or under payload. */
  payload?: { name?: string; provider?: string; entityType?: string };
}

/** Read an identity field from a datasource record, top-level or nested under `payload`. */
function dsField(record: DatasourceRecord, key: "name" | "provider" | "entityType"): string | undefined {
  return record[key] ?? record.payload?.[key];
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
  /** mode='manual' — explicit field mappings (e.g. from suggestMappings). */
  propertyMappings?: unknown[];
  /** Cap the number of records imported in a run (bounded / test syncs). */
  maxRecords?: number;
  /** Datasource default direction; set only for manual-mode creates. */
  direction?: SyncDirection;
}

/** Frequencies the managed scheduler accepts. `manual-only` disables the cron. */
export type ScheduleFrequency = "hourly" | "daily" | "weekly" | "manual-only";

/** Schedule view for a datasource (mirrors the SDK `DataSourceSchedule`). */
export interface SyncSchedule {
  dataSourceId: string;
  enabled: boolean;
  frequency: string | null;
  lastSyncInAt?: string | null;
  lastSyncOutAt?: string | null;
}

/** `run()` return — dispatch envelope for a real run, or the report for `dryRun:true`. Fields are read defensively across both. */
interface RunEnvelope {
  data?: {
    eventId?: string;
    id?: string;
    dataSourceId?: string;
    note?: string;
    mappingMode?: string;
    propertyMappingsCount?: number;
    writeStrategy?: string;
    onNoMatch?: string;
    conflictPolicy?: string;
  };
  dryRun?: boolean;
}

interface DatasourcesApi {
  create(payload: DatasourceCreatePayload): Promise<{ data: DatasourceRecord }>;
  run(id: string, payload: { direction: SyncDirection; dryRun?: boolean }): Promise<RunEnvelope>;
  getRun(id: string, eventId: string): Promise<{ data: SyncRunResult[] }>;
  list(): Promise<{ data: DatasourceRecord[] }>;
  /** PATCH a datasource. Optional — older SDKs may lack it; callers must guard. */
  update?(id: string, payload: { maxRecords?: number }): Promise<{ data?: DatasourceRecord }>;
  /** PUT the recurring schedule. Optional — guard before calling. */
  setSchedule?(id: string, options: { enabled: boolean; frequency?: ScheduleFrequency }): Promise<{ data?: SyncSchedule }>;
  /** GET the schedule view. Optional — guard before calling. */
  getSchedule?(id: string): Promise<{ data?: SyncSchedule }>;
}

/** Shape returned by `suggestMappings` — `propertyMappings` may be top-level or under `data`. */
interface SuggestMappingsResponse {
  data?: { propertyMappings?: unknown[] };
  propertyMappings?: unknown[];
}

interface IntegrationsApi {
  datasources: DatasourcesApi;
  suggestMappings(payload: { provider: SyncProvider; entityType: SyncEntityType; mode: "ai" | "template" }): Promise<SuggestMappingsResponse>;
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

/** How field mappings are resolved when creating a datasource. */
export type MappingMode = "template" | "ai" | "auto";

export interface EnsureDatasourceOptions {
  /** Cap records imported per run. Applied on create, or patched onto an existing datasource. */
  maxRecords?: number;
  /**
   * Field-mapping strategy:
   * - `template` (default): use the builtin `{provider}_{plural}_standard` template.
   * - `ai`: pull AI-suggested mappings and create a manual datasource.
   * - `auto`: try the template, fall back to AI mappings when no builtin template exists.
   */
  mappingMode?: MappingMode;
}

function isTemplateNotFound(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /template not found/i.test(message);
}

function suggestedMappings(response: SuggestMappingsResponse): unknown[] {
  const payload = (response?.data ?? response) as { propertyMappings?: unknown[] } | undefined;
  return Array.isArray(payload?.propertyMappings) ? payload.propertyMappings : [];
}

/**
 * Create a datasource. `template`/`auto` start from the builtin template; `ai` (and
 * `auto`'s fallback) fetch AI-suggested mappings and create a manual datasource — the
 * path providers without a builtin template (e.g. Apollo) must take.
 */
async function createDatasource(
  api: IntegrationsApi,
  provider: SyncProvider,
  entityType: SyncEntityType,
  name: string,
  mappingMode: MappingMode,
  maxRecords?: number,
): Promise<DatasourceRecord> {
  const cap = maxRecords != null ? { maxRecords } : {};

  const createFromAi = async (): Promise<DatasourceRecord> => {
    const suggestion = await api.suggestMappings({ provider, entityType, mode: "ai" });
    const propertyMappings = suggestedMappings(suggestion);
    if (propertyMappings.length === 0) {
      throw new Error(
        `No AI-suggested mappings for ${provider} ${entityType}; cannot build a manual datasource.`,
      );
    }
    const created = await api.datasources.create({
      name,
      provider,
      entityType,
      mode: "manual",
      propertyMappings,
      direction: "in",
      ...cap,
    });
    return created.data;
  };

  if (mappingMode === "ai") return createFromAi();

  try {
    const created = await api.datasources.create({
      name,
      provider,
      entityType,
      mode: "template",
      template: { type: "builtin", id: builtinTemplateId(provider, entityType) },
      ...cap,
    });
    return created.data;
  } catch (error) {
    if (mappingMode === "auto" && isTemplateNotFound(error)) {
      logger.info("personize-sync: no builtin template; falling back to AI-suggested mappings", {
        provider,
        entityType,
      });
      return createFromAi();
    }
    throw error;
  }
}

/**
 * Find the org's existing datasource for this provider+object, or create one.
 * `mappingMode` picks template vs AI mappings; `maxRecords` caps the import.
 * Idempotent — safe to call before every sync.
 */
async function listDatasources(api: IntegrationsApi): Promise<DatasourceRecord[]> {
  const res = await api.datasources.list().catch((error) => {
    logger.warn("personize-sync: datasource list failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { data: [] as DatasourceRecord[] };
  });
  return res.data;
}

function matchDatasource(
  list: DatasourceRecord[],
  provider: SyncProvider,
  entityType: SyncEntityType,
): DatasourceRecord | undefined {
  const name = datasourceName(provider, entityType);
  return list.find(
    (d) => (dsField(d, "provider") === provider && dsField(d, "entityType") === entityType) || dsField(d, "name") === name,
  );
}

/** Find the org's datasource for this provider+object WITHOUT creating one. */
export async function findDatasource(
  provider: SyncProvider,
  entityType: SyncEntityType,
): Promise<DatasourceRecord | undefined> {
  const api = integrationsApi();
  return matchDatasource(await listDatasources(api), provider, entityType);
}

export async function ensureDatasource(
  provider: SyncProvider,
  entityType: SyncEntityType,
  options: EnsureDatasourceOptions = {},
): Promise<DatasourceRecord> {
  const api = integrationsApi();
  const { maxRecords, mappingMode = "template" } = options;

  const match = matchDatasource(await listDatasources(api), provider, entityType);
  if (match) {
    // Re-apply the cap on reuse so a bounded run can't inherit an unbounded config.
    if (maxRecords != null && typeof api.datasources.update === "function") {
      await api.datasources.update(match.id, { maxRecords }).catch((error) => {
        logger.warn("personize-sync: could not patch maxRecords on existing datasource", {
          provider,
          entityType,
          id: match.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    return match;
  }

  const created = await createDatasource(
    api,
    provider,
    entityType,
    datasourceName(provider, entityType),
    mappingMode,
    maxRecords,
  );
  logger.info("personize-sync: created datasource", { provider, entityType, id: created.id, mappingMode });
  return created;
}

// `partial` = some records succeeded, some failed — terminal, but not a hard failure.
const TERMINAL_OK = new Set(["succeeded", "success", "completed", "complete", "done", "partial"]);
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

export interface SyncValidation {
  ok: boolean;
  provider: SyncProvider;
  entityType: SyncEntityType;
  direction: SyncDirection;
  /** True when no datasource exists yet — a live run would create one first. */
  willCreateDatasource: boolean;
  dataSourceId?: string;
  mappingMode?: string;
  propertyMappingsCount?: number;
  note: string;
}

/**
 * Validate a sync without writing anything — the dry-run path.
 *
 * If a datasource exists, calls `run({ dryRun: true })`, which validates config
 * and reports what the run would do without touching the provider. If none
 * exists, reports that a live run would create one first (no datasource is
 * created here — dry runs never write). Never throws: any failure is folded into
 * `{ ok: false, note }` so the dry-run path can't crash an operation.
 */
export async function validateSync(
  provider: SyncProvider,
  entityType: SyncEntityType,
  direction: SyncDirection,
): Promise<SyncValidation> {
  const base = { provider, entityType, direction } as const;
  try {
    const api = integrationsApi();
    const existing = matchDatasource(await listDatasources(api), provider, entityType);
    if (!existing) {
      return {
        ...base,
        ok: true,
        willCreateDatasource: true,
        note: `No datasource yet — a live run would create "${datasourceName(provider, entityType)}" (template ${builtinTemplateId(provider, entityType)}) then sync ${direction}.`,
      };
    }

    const res = await api.datasources.run(existing.id, { direction, dryRun: true });
    const report = res.data ?? {};
    return {
      ...base,
      ok: true,
      willCreateDatasource: false,
      dataSourceId: existing.id,
      mappingMode: report.mappingMode,
      propertyMappingsCount: report.propertyMappingsCount,
      note: report.note ?? `Validated ${provider} ${entityType} ${direction} against existing datasource.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...base, ok: false, willCreateDatasource: false, note: `Validation skipped: ${message}` };
  }
}

/**
 * Enable/disable the managed recurring schedule for one datasource. Ensures the
 * datasource exists first (scheduling requires one). Returns the resulting
 * schedule view.
 */
export async function setSyncSchedule(
  provider: SyncProvider,
  entityType: SyncEntityType,
  options: { enabled: boolean; frequency?: ScheduleFrequency },
  ensureOptions: EnsureDatasourceOptions = {},
): Promise<SyncSchedule> {
  const api = integrationsApi();
  if (typeof api.datasources.setSchedule !== "function") {
    throw new Error(`Managed scheduling unavailable: client.integrations.datasources.setSchedule not found. ${SDK_REQUIREMENT}`);
  }
  const ds = await ensureDatasource(provider, entityType, ensureOptions);
  const res = await api.datasources.setSchedule(ds.id, options);
  return res.data ?? { dataSourceId: ds.id, enabled: options.enabled, frequency: options.frequency ?? null };
}

/** Read the current schedule for a provider+object, or undefined if none exists. */
export async function getSyncSchedule(
  provider: SyncProvider,
  entityType: SyncEntityType,
): Promise<SyncSchedule | undefined> {
  const api = integrationsApi();
  const ds = await findDatasource(provider, entityType);
  if (!ds || typeof api.datasources.getSchedule !== "function") return undefined;
  const res = await api.datasources.getSchedule(ds.id);
  return res.data;
}

/** Preview AI/template field mappings for a provider+object without committing. */
export async function previewMappings(
  provider: SyncProvider,
  entityType: SyncEntityType,
  mode: "ai" | "template" = "ai",
): Promise<unknown> {
  return integrationsApi().suggestMappings({ provider, entityType, mode });
}
