import { hubspot } from "../../adapters/hubspot/adapter.js";
import type { SyncEntityType, SyncProvider } from "../../adapters/personize-sync.js";
import { loadCollectionManifest } from "./crm-field-map.js";
import { logger } from "./logger.js";
import { setProperty } from "./persist.js";
import { retrieveRecords } from "./recall.js";

// -----------------------------------------------------------------------------
// crm-record-id-backfill — set `crm_record_id` on synced Personize records.
//
// crm.sync-core delegates the whole import to Personize's managed sync template,
// which maps business fields (domain, name, email, …) but NOT the CRM's native
// object id. Downstream writeback (see crm-writeback) needs that id to address
// the CRM record; without it every writeback logs "missing crm_record_id" and
// scores never reach the CRM.
//
// This closes the gap from the CRM side: page each object's native id + primary
// key, then set `crm_record_id` on the matching Personize record BY record_id.
// Matching on the stored primary-key property (not the websiteUrl identity
// filter) sidesteps the identity-normalization mismatch that also breaks
// appendToProperty lookups.
//
// hubspot-only (mirrors crm-writeback), best-effort, and idempotent: records
// that already carry a crm_record_id are left untouched, so it's safe to re-run
// after an async/dispatched sync finishes landing records.
// -----------------------------------------------------------------------------

/** Manifest slug per entity type. */
const SLUG: Partial<Record<SyncEntityType, string>> = {
  company: "companies",
  contact: "contacts",
};

/** persist/retrieve WriteTarget type per entity type. */
const PERSONIZE_TYPE: Partial<Record<SyncEntityType, "company" | "contact">> = {
  company: "company",
  contact: "contact",
};

/** Default number of Personize records to scan when the sync was unbounded. */
const DEFAULT_SCAN_LIMIT = 1000;
/** Backstop page count so a paging bug can't loop forever. */
const MAX_PAGES = 200;
const PAGE_SIZE = 100;

export interface BackfillResult {
  entityType: SyncEntityType;
  /** Native objects paged from the CRM. */
  crmObjects: number;
  /** Personize records scanned for a match. */
  personizeRecords: number;
  /** Records whose native id we resolved. */
  matched: number;
  /** Records actually patched (crm_record_id was missing). */
  updated: number;
  /** True when backfill was not attempted (unsupported provider/entity). */
  skipped: boolean;
  /** True when the Personize scan hit its limit — coverage may be partial. */
  coverageCapped?: boolean;
  note?: string;
}

/** Lowercase/trim a key; for domains, strip protocol, `www.`, and any path. */
export function normalizeKey(raw: unknown, isDomain: boolean): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  let s = String(raw).trim().toLowerCase();
  if (!s) return undefined;
  if (isDomain) {
    s = s
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "");
  }
  return s || undefined;
}

/** Page the CRM for `normalize(primaryKey) -> nativeObjectId`, bounded by maxRecords. */
async function buildCrmIdMap(
  entityType: SyncEntityType,
  hubspotField: string,
  isDomain: boolean,
  maxRecords?: number,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const hardCap = maxRecords ?? Number.POSITIVE_INFINITY;
  let after: string | undefined;
  let pulled = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const list =
      entityType === "company"
        ? await hubspot.companies.list({ limit: PAGE_SIZE, after, properties: [hubspotField] })
        : await hubspot.contacts.list({ limit: PAGE_SIZE, after, properties: [hubspotField] });

    const results = list?.results ?? [];
    for (const obj of results) {
      const key = normalizeKey(obj.properties?.[hubspotField], isDomain);
      if (key && obj.id) map.set(key, obj.id);
      if (++pulled >= hardCap) return map;
    }

    after = list?.paging?.next?.after;
    if (!after || results.length === 0) break;
  }
  return map;
}

/**
 * Backfill `crm_record_id` on synced Personize records for one entity type.
 * hubspot-only; returns a `skipped` result for anything else. Never throws —
 * failures fold into `{ skipped: true, note }`.
 */
export async function backfillCrmRecordIds(
  provider: SyncProvider,
  entityType: SyncEntityType,
  options: { maxRecords?: number } = {},
): Promise<BackfillResult> {
  const base: BackfillResult = {
    entityType,
    crmObjects: 0,
    personizeRecords: 0,
    matched: 0,
    updated: 0,
    skipped: true,
  };

  if (provider !== "hubspot") {
    return { ...base, note: `crm_record_id backfill supported for hubspot only; skipped for ${provider}.` };
  }
  const persistType = PERSONIZE_TYPE[entityType];
  const slug = SLUG[entityType];
  if (!persistType || !slug) {
    return { ...base, note: `crm_record_id backfill does not support entity type "${entityType}".` };
  }

  try {
    const manifest = await loadCollectionManifest(slug);
    const pkSystemName = manifest.primaryKeyField;
    const pkProp = manifest.properties.find((p) => p.systemName === pkSystemName);
    const hubspotField = pkProp?.crmFields?.[provider];
    if (!hubspotField) {
      return { ...base, note: `No ${provider} field mapping for primary key "${pkSystemName}"; cannot match records.` };
    }
    const isDomain = entityType === "company";

    const idMap = await buildCrmIdMap(entityType, hubspotField, isDomain, options.maxRecords);
    if (idMap.size === 0) {
      return { ...base, skipped: false, note: "No CRM objects returned; nothing to backfill." };
    }

    const scanLimit = options.maxRecords ?? DEFAULT_SCAN_LIMIT;
    const records = await retrieveRecords({ type: persistType, limit: scanLimit });
    const coverageCapped = records.length >= scanLimit;

    let matched = 0;
    let updated = 0;
    for (const rec of records) {
      const recordId = typeof rec.record_id === "string" ? rec.record_id : undefined;
      if (!recordId) continue;

      // Prefer the mapped primary-key property; fall back to the identity aliases
      // flattenRecord exposes (domain/website_url for companies, email for contacts).
      const keyRaw = rec[pkSystemName] ?? (isDomain ? (rec.domain ?? rec.website_url) : rec.email);
      const key = normalizeKey(keyRaw, isDomain);
      if (!key) continue;

      const nativeId = idMap.get(key);
      if (!nativeId) continue;
      matched++;

      const existing = rec.crm_record_id;
      if (typeof existing === "string" && existing.length > 0) continue; // already set — idempotent skip

      if (await setProperty({ type: persistType, recordId }, "crm_record_id", nativeId)) updated++;
    }

    logger.info("crm-record-id backfill complete", {
      provider,
      entityType,
      crmObjects: idMap.size,
      personizeRecords: records.length,
      matched,
      updated,
      coverageCapped,
    });
    if (coverageCapped) {
      logger.warn("crm-record-id backfill: Personize scan hit its limit; coverage may be partial", {
        entityType,
        scanLimit,
      });
    }

    return {
      entityType,
      crmObjects: idMap.size,
      personizeRecords: records.length,
      matched,
      updated,
      skipped: false,
      ...(coverageCapped ? { coverageCapped: true } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("crm-record-id backfill failed", { provider, entityType, error: message });
    return { ...base, skipped: false, note: `Backfill error: ${message}` };
  }
}
