import type { SyncEntityType, SyncProvider } from "../../adapters/personize-sync.js";

// -----------------------------------------------------------------------------
// sync-objects — the per-provider set of standard entities a managed sync can
// import/export, and the default selection when a caller doesn't name objects.
//
// Shared by crm.sync-core (in), crm.sync-out (out), and crm.sync-schedule so the
// three can't drift. HubSpot unifies all people under `contact`; Salesforce
// splits them into Contact (post-conversion) and Lead (pre-conversion) — both
// feed Personize's unified `contacts` collection via `crm_object_type`, and each
// has its own builtin template (salesforce_contacts_standard /
// salesforce_leads_standard). `company` is the Account sObject on Salesforce.
// -----------------------------------------------------------------------------

/** Standard entities recognized per provider (valid `objects` inputs). */
export const STANDARD_OBJECTS: Record<string, ReadonlyArray<SyncEntityType>> = {
  hubspot: ["contact", "company"],
  salesforce: ["contact", "lead", "company"],
  apollo: ["contact"],
};

/**
 * Default objects imported/exported when a caller doesn't name any. Salesforce is
 * at parity with HubSpot: contacts (Contact), leads (Lead), and companies
 * (Account) all have builtin templates, field provisioning, mappings, and
 * writeback. Leads are included so pre-conversion prospects aren't silently
 * missed — HubSpot's single `contact` object already covers them.
 */
export const DEFAULT_SYNC_OBJECTS: Record<string, SyncEntityType[]> = {
  hubspot: ["contact", "company"],
  salesforce: ["contact", "lead", "company"],
  apollo: ["contact"],
};

/** The standard entities a provider supports, defaulting to contact+company. */
export function standardObjects(provider: SyncProvider): ReadonlyArray<SyncEntityType> {
  return STANDARD_OBJECTS[provider] ?? ["contact", "company"];
}

/**
 * Resolve the objects to sync. The provider's standard entities plus any
 * registered custom entity (deal/ticket/… — discovered from manifests) are valid;
 * unknown requests are dropped. Defaults to the provider's standard objects.
 */
export function resolveSyncObjects(
  provider: SyncProvider,
  requested: unknown,
  validCustom: Set<string>,
): SyncEntityType[] {
  const standard = standardObjects(provider);
  if (Array.isArray(requested) && requested.length > 0) {
    return requested.filter(
      (o): o is SyncEntityType =>
        typeof o === "string" && (standard.includes(o as SyncEntityType) || validCustom.has(o)),
    );
  }
  return DEFAULT_SYNC_OBJECTS[provider] ?? ["contact"];
}
