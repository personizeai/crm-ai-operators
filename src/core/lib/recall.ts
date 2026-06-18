import type { RetrieveFilterCondition, RetrieveFilterOperator } from "@personize/sdk";
import { client } from "../config.js";

// -----------------------------------------------------------------------------
// recall — unified-Retrieve read helpers.
//
// Replaces the pre-0.14 `client.memory.filterByProperty(...)` and
// `client.memory.retrieve({ email, type })` calls scattered across operations
// with the canonical top-level `client.retrieve()` (API v1, mode 'filter').
//
// We deliberately use the TOP-LEVEL `client.retrieve` (v1) rather than
// `client.memory.retrieve` (v1.1) — the latter is org-gated by
// UNIFIED_RETRIEVE_V1_ORG_ALLOWLIST, while top-level retrieve is not.
//
// All helpers fail soft (return empty/null) when the SDK surface is missing or
// the call throws — preserving the defensive behavior operations relied on.
// -----------------------------------------------------------------------------

/** The legacy `{ propertyName, operator, value }` condition shape used across operations. */
export interface LegacyCondition {
  propertyName: string;
  operator: string;
  value?: unknown;
}

/** Maps the old lowercase operator strings to the unified `RetrieveFilterOperator` enum. */
const OPERATOR_MAP: Record<string, RetrieveFilterOperator> = {
  exists: "EXISTS",
  not_exists: "NOT_EXISTS",
  equals: "EQ",
  eq: "EQ",
  not_equals: "NEQ",
  neq: "NEQ",
  contains: "CONTAINS",
  not_contains: "NOT_CONTAINS",
  starts_with: "STARTS_WITH",
  ends_with: "ENDS_WITH",
  gt: "GT",
  gte: "GTE",
  lt: "LT",
  lte: "LTE",
  between: "BETWEEN",
  in: "IN",
  not_in: "NOT_IN",
};

function toCondition(c: LegacyCondition): RetrieveFilterCondition {
  const key = typeof c.operator === "string" ? c.operator.toLowerCase() : "";
  return { property: c.propertyName, operator: OPERATOR_MAP[key] ?? "EQ", value: c.value };
}

// -----------------------------------------------------------------------------
// flattenRecord — collapse a unified-retrieve record into the flat property map
// the operations expect.
//
// client.retrieve returns records shaped as:
//   { record_id, entity_type, properties: { <name>: { Result, UpdatedAt, ... } | { History:[{Value}] } }, crm_keys: { email | websiteUrl | ... } }
// The pre-0.14 filterByProperty path returned a flat { email, domain, ai_score, ... }
// object, so we reproduce that here: scalar props → `.Result`, array props →
// flattened `.History[].Value`, plus the clean crm_keys (websiteUrl aliased to
// both `domain` and `website_url`, which operations read interchangeably).
// Verified against the live test org (record envelope uses capital-R `Result`).
// -----------------------------------------------------------------------------
function flattenRecord(rec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const props = (rec?.properties ?? {}) as Record<string, any>;
  for (const [k, v] of Object.entries(props)) {
    if (v && typeof v === "object") {
      if ("Result" in v) out[k] = v.Result;
      else if (Array.isArray((v as any).History)) {
        out[k] = (v as any).History.flatMap((h: any) => (h?.Value ?? []));
      } else out[k] = v;
    } else {
      out[k] = v;
    }
  }
  const ck = (rec?.crm_keys ?? {}) as Record<string, unknown>;
  if (ck.email != null && out.email === undefined) out.email = ck.email;
  if (ck.websiteUrl != null) {
    if (out.domain === undefined) out.domain = ck.websiteUrl;
    if (out.website_url === undefined) out.website_url = ck.websiteUrl;
  }
  if (rec?.record_id != null) out.record_id = rec.record_id;
  if (rec?.entity_type != null && out.entity_type === undefined) out.entity_type = rec.entity_type;
  return out;
}

export interface RetrieveRecordsOptions {
  /** Entity type: "contact" | "company" | "conversation" | "signal" | workspace type, etc. */
  type: string;
  conditions?: LegacyCondition[];
  logic?: "AND" | "OR";
  /** Page size cap. Defaults to 200. */
  limit?: number;
}

function buildFilters(opts: RetrieveRecordsOptions, countOnly: boolean): Record<string, unknown> {
  const conditions = (opts.conditions ?? []).map(toCondition);
  const filters: Record<string, unknown> = {
    crmFilter: { type: opts.type },
    pageSize: opts.limit ?? 200,
    returnRecords: !countOnly,
    countOnly,
  };
  if (conditions.length > 0) {
    filters.groups = [{ logic: opts.logic ?? "AND", conditions }];
  }
  return filters;
}

/**
 * Replacement for `memory.filterByProperty(...)`. Returns the matched records.
 * Fails soft to `[]`.
 */
export async function retrieveRecords(
  opts: RetrieveRecordsOptions,
): Promise<Record<string, unknown>[]> {
  const retrieve = (client as any).retrieve;
  if (typeof retrieve !== "function") return [];
  try {
    const res = await retrieve.call(client, { mode: "filter", filters: buildFilters(opts, false) });
    return ((res?.records ?? []) as Record<string, unknown>[]).map(flattenRecord);
  } catch {
    return [];
  }
}

/**
 * Count-only variant — replaces the coverage-scan pattern that ran
 * `filterByProperty(..., limit: 1)` purely to read a total. Returns the total
 * number of matched records without transferring them. Fails soft to `0`.
 */
export async function countRecords(opts: RetrieveRecordsOptions): Promise<number> {
  const retrieve = (client as any).retrieve;
  if (typeof retrieve !== "function") return 0;
  try {
    const res = await retrieve.call(client, { mode: "filter", filters: buildFilters(opts, true) });
    return (res?.pagination?.totalMatched ?? res?.records?.length ?? 0) as number;
  } catch {
    return 0;
  }
}

export interface RecordTarget {
  email?: string;
  websiteUrl?: string;
  recordId?: string;
  type?: string;
}

/**
 * Replacement for `memory.retrieve({ email | website_url, type })` single-record
 * fetch. Resolves one record's properties via `crmFilter`. Fails soft to `null`.
 */
export async function retrieveRecord(target: RecordTarget): Promise<Record<string, unknown> | null> {
  const retrieve = (client as any).retrieve;
  if (typeof retrieve !== "function") return null;
  const crmFilter: Record<string, unknown> = {};
  if (target.email) crmFilter.email = target.email;
  if (target.websiteUrl) crmFilter.websiteUrl = target.websiteUrl;
  if (target.recordId) crmFilter.recordId = target.recordId;
  if (target.type) crmFilter.type = target.type;
  try {
    const res = await retrieve.call(client, {
      mode: "filter",
      filters: { crmFilter, pageSize: 1, returnRecords: true },
    });
    const rec = res?.records?.[0] as Record<string, unknown> | undefined;
    return rec ? flattenRecord(rec) : null;
  } catch {
    return null;
  }
}
