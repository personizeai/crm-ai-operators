import { crmPassthrough } from "../../adapters/passthrough.js";
import { salesforce, salesforceObjectFor } from "../../adapters/salesforce/adapter.js";
import { salesforceApiName } from "../setup/apply-crm-properties.js";
import { logger } from "./logger.js";
import type { CrmId } from "../operations/types.js";

// -----------------------------------------------------------------------------
// crm-writeback — mirror AI properties to the CRM record's namespaced custom
// fields, on whichever provider the record lives on.
//
// memory.upsert (see persist.ts) only writes to Personize memory. That's the
// source of truth, but it does NOT land on the CRM record reps see — so scores
// were invisible in the CRM. This closes the loop: after an operation writes a
// score to memory, it PATCHes the matching namespaced field on the native CRM
// record, by native record id (`crm_record_id`, stored by crm.sync-core).
//
// Field naming and payload shape differ per provider:
//   - HubSpot:    `personize_<systemName>` on /crm/v3/objects/{obj}/{id},
//                 wrapped in `{ properties: {...} }`, values string-coerced.
//   - Salesforce: `Personize_<Pascal>__c` on the sObject (Account for company;
//                 Lead/Contact for people, routed by crm_object_type), values
//                 passed with native types so Number/Checkbox fields validate.
//
// Fail-soft: a writeback failure is logged and returns false; it never throws,
// so a CRM hiccup can't lose the memory write that already succeeded.
// -----------------------------------------------------------------------------

const HUBSPOT_PREFIX = "personize_";

/** Personize entity type → HubSpot object path segment. */
const HUBSPOT_OBJECT: Record<string, string> = {
  contact: "contacts",
  company: "companies",
};

export interface CrmWritebackTarget {
  /** Active CRM. Defaults to hubspot (the original wedge); salesforce is supported. */
  crm?: CrmId;
  /** Personize entity type — "contact" | "company". */
  type: "contact" | "company";
  /** Native CRM object id (the memory `crm_record_id`, set by crm.sync-core). */
  crmRecordId?: string;
  /**
   * Salesforce only: which person object a contact lives on ("Lead" pre-
   * conversion, "Contact" after). Ignored for companies (always Account) and for
   * HubSpot. Defaults to Contact when omitted.
   */
  crmObjectType?: string | null;
}

/** Coerce HubSpot property values to strings (HubSpot custom-property writes are string-typed). */
function hubspotValue(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}

/**
 * Write the given properties to the CRM record's namespaced custom fields.
 *
 * Keys are bare systemNames (e.g. "icp_fit_score"); each provider namespaces them
 * to match what setup provisioned. null/undefined values are skipped. Returns
 * true on success (or no-op), false on skip/failure.
 */
export async function crmWriteback(
  target: CrmWritebackTarget,
  properties: Record<string, unknown>,
): Promise<boolean> {
  const crm: CrmId = target.crm ?? "hubspot";

  if (!target.crmRecordId) {
    // Without the native id we can't address the record. crm.sync-core stores
    // crm_record_id; if it's missing the record likely predates a sync.
    logger.warn("crmWriteback: missing crm_record_id; skipping CRM writeback", { crm, type: target.type });
    return false;
  }

  // Drop null/undefined before we hit the provider — nothing to write is a no-op success.
  const clean = Object.entries(properties).filter(([, value]) => value !== undefined && value !== null);
  if (clean.length === 0) return true;

  if (crm === "hubspot") return hubspotWriteback(target, clean);
  if (crm === "salesforce") return salesforceWriteback(target, clean);

  logger.info("crmWriteback: unsupported CRM; skipping", { crm, type: target.type });
  return false;
}

async function hubspotWriteback(
  target: CrmWritebackTarget,
  clean: [string, unknown][],
): Promise<boolean> {
  const objectType = HUBSPOT_OBJECT[target.type];
  if (!objectType) {
    logger.warn("crmWriteback: unsupported entity type; skipping", { crm: "hubspot", type: target.type });
    return false;
  }

  const payload: Record<string, string> = {};
  for (const [name, value] of clean) payload[`${HUBSPOT_PREFIX}${name}`] = hubspotValue(value);

  try {
    await crmPassthrough({
      crm: "hubspot",
      method: "PATCH",
      path: `/crm/v3/objects/${objectType}/${target.crmRecordId}`,
      body: { properties: payload },
    });
    logger.info("crmWriteback: wrote personize_* fields to HubSpot", {
      type: target.type,
      crmRecordId: target.crmRecordId,
      fields: Object.keys(payload),
    });
    return true;
  } catch (error) {
    logger.warn("crmWriteback failed", {
      crm: "hubspot",
      type: target.type,
      crmRecordId: target.crmRecordId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function salesforceWriteback(
  target: CrmWritebackTarget,
  clean: [string, unknown][],
): Promise<boolean> {
  // company → Account; contact → Lead/Contact routed by crm_object_type (default Contact).
  const object = target.type === "company" ? "Account" : salesforceObjectFor(target.crmObjectType);

  // Salesforce custom fields are strongly typed — pass native values (Number,
  // Checkbox, Text) through as-is rather than string-coercing like HubSpot.
  const fields: Record<string, unknown> = {};
  for (const [name, value] of clean) fields[salesforceApiName(name)] = value;

  try {
    await salesforce.sobject(object).update(target.crmRecordId!, fields);
    logger.info("crmWriteback: wrote Personize_*__c fields to Salesforce", {
      type: target.type,
      object,
      crmRecordId: target.crmRecordId,
      fields: Object.keys(fields),
    });
    return true;
  } catch (error) {
    logger.warn("crmWriteback failed", {
      crm: "salesforce",
      type: target.type,
      object,
      crmRecordId: target.crmRecordId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
