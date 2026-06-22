import { crmPassthrough } from "../../adapters/passthrough.js";
import { logger } from "./logger.js";
import type { CrmId } from "../operations/types.js";

// -----------------------------------------------------------------------------
// crm-writeback — mirror AI properties to the CRM record's namespaced
// `personize_*` custom fields.
//
// memory.upsert (see persist.ts) only writes to Personize memory. That's the
// source of truth, but it does NOT land on the CRM record reps see — so scores
// were invisible in HubSpot. This closes the loop: after an operation writes a
// score to memory, it PATCHes the matching `personize_<systemName>` field on the
// CRM record, by native record id (`crm_record_id`, stored by crm.sync-core).
//
// This mirrors the documented pattern in the README ("The code your agents
// write": hubspot.contacts.update(id, { personize_ai_score: "87" })).
//
// Fail-soft: a writeback failure is logged and returns false; it never throws,
// so a CRM hiccup can't lose the memory write that already succeeded.
// -----------------------------------------------------------------------------

const PERSONIZE_PREFIX = "personize_";

/** Personize entity type → HubSpot object path segment. */
const HUBSPOT_OBJECT: Record<string, string> = {
  contact: "contacts",
  company: "companies",
};

export interface CrmWritebackTarget {
  /** Active CRM. Defaults to hubspot (the live wedge); salesforce is scaffold. */
  crm?: CrmId;
  /** Personize entity type — "contact" | "company". */
  type: "contact" | "company";
  /** Native CRM object id (the memory `crm_record_id`, set by crm.sync-core). */
  crmRecordId?: string;
}

/**
 * Write the given properties to the CRM record's `personize_*` fields.
 *
 * Keys are bare systemNames (e.g. "icp_fit_score"); they're prefixed to
 * "personize_icp_fit_score" to match what setup provisioned. Values are coerced
 * to strings (HubSpot custom-property writes are string-typed). null/undefined
 * values are skipped. Returns true on success (or no-op), false on skip/failure.
 */
export async function crmWriteback(
  target: CrmWritebackTarget,
  properties: Record<string, unknown>,
): Promise<boolean> {
  const crm: CrmId = target.crm ?? "hubspot";

  // Salesforce writeback is still scaffold — skip quietly rather than error.
  if (crm !== "hubspot") {
    logger.info("crmWriteback: non-hubspot CRM not yet supported; skipping", { crm, type: target.type });
    return false;
  }

  const objectType = HUBSPOT_OBJECT[target.type];
  if (!objectType) {
    logger.warn("crmWriteback: unsupported entity type; skipping", { type: target.type });
    return false;
  }

  if (!target.crmRecordId) {
    // Without the native id we can't address the record. crm.sync-core stores
    // crm_record_id; if it's missing the record likely predates a sync.
    logger.warn("crmWriteback: missing crm_record_id; skipping CRM writeback", { type: target.type });
    return false;
  }

  const payload: Record<string, string> = {};
  for (const [name, value] of Object.entries(properties)) {
    if (value === undefined || value === null) continue;
    payload[`${PERSONIZE_PREFIX}${name}`] = typeof value === "string" ? value : String(value);
  }
  if (Object.keys(payload).length === 0) return true;

  try {
    await crmPassthrough({
      crm: "hubspot",
      method: "PATCH",
      path: `/crm/v3/objects/${objectType}/${target.crmRecordId}`,
      body: { properties: payload },
    });
    logger.info("crmWriteback: wrote personize_* fields to CRM", {
      type: target.type,
      crmRecordId: target.crmRecordId,
      fields: Object.keys(payload),
    });
    return true;
  } catch (error) {
    logger.warn("crmWriteback failed", {
      type: target.type,
      crmRecordId: target.crmRecordId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
