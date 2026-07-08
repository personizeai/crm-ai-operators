import { readFile } from "node:fs/promises";
import path from "node:path";

// -----------------------------------------------------------------------------
// crm-field-map — manifest-driven CRM<->Personize field mapping.
//
// Replaces the hardcoded request lists + rename maps that used to live in
// crm.sync-core. The collection manifests declare, per property:
//   - crmFields:      { hubspot: "<field>", salesforce: "<field>" }  — flat-property source
//   - crmAssociation: { hubspot: "<objectType>" }                    — resolved from associations
//
// Sync derives everything from these: which native fields to request, and how to
// rename them into normalized snake_case systemNames. Adding a synced field is
// now a one-line manifest edit — no code change.
// -----------------------------------------------------------------------------

const MANIFEST_DIR = path.join(process.cwd(), "manifests", "core", "collections");

export type PropertyType = "text" | "number" | "boolean" | "date" | "options" | "array";

export interface ManifestProperty {
  systemName: string;
  type: PropertyType;
  crmFields?: Record<string, string>;
  crmAssociation?: Record<string, string>;
}

/** Identity key for a custom-sync entity: the Personize key + its per-CRM source field. */
export interface CrmEntityIdentity {
  /** Personize custom key name — must match a property systemName mapped from `crmFields[crm]`. */
  keyName: string;
  /** Per-CRM source field that supplies the key value (e.g. { hubspot: "dealname" }). */
  crmFields: Record<string, string>;
}

/**
 * How a collection participates in `crm.sync-core`. Absent for collections that
 * aren't CRM-synced. Standard entities (contact/company) either omit this or set
 * `standard: true` — Personize auto-maps and auto-resolves their identity. Custom
 * entities (deal/ticket/custom objects) set `standard: false` and declare an
 * `identity`, so sync creates a manual datasource with mappings + a custom key.
 */
export interface CrmSyncConfig {
  /** Datasource entity type, e.g. "deal". */
  entityType: string;
  /** true = Personize-auto-mapped standard entity; false/absent = custom (manual) entity. */
  standard?: boolean;
  /** Per-CRM native object segment, e.g. { hubspot: "deals" } — used for writeback/reference. */
  crmObject?: Record<string, string>;
  /** Required for custom entities: the record-identity key. */
  identity?: CrmEntityIdentity;
}

export interface CollectionManifest {
  slug: string;
  primaryKeyField: string;
  properties: ManifestProperty[];
  crmSync?: CrmSyncConfig;
}

/** The manual-datasource inputs derived from a custom entity's manifest for one CRM. */
export interface CustomEntitySync {
  propertyMappings: Array<{ source: string; target: string; direction: "in" }>;
  identityFields: { customKeyName: string; customKeySource: string };
}

const cache = new Map<string, CollectionManifest>();

/** Load and cache a collection manifest by slug (e.g. "contacts", "companies"). */
export async function loadCollectionManifest(slug: string): Promise<CollectionManifest> {
  const cached = cache.get(slug);
  if (cached) return cached;
  const raw = await readFile(path.join(MANIFEST_DIR, `${slug}.json`), "utf8");
  const manifest = JSON.parse(raw) as CollectionManifest;
  cache.set(slug, manifest);
  return manifest;
}

/** Native CRM field names to request for `crm` (deduped). Sync should also add any always-on keys (e.g. hs_object_id). */
export function crmRequestFields(manifest: CollectionManifest, crm: string): string[] {
  const fields = new Set<string>();
  for (const p of manifest.properties) {
    const field = p.crmFields?.[crm];
    if (field) fields.add(field);
  }
  return [...fields];
}

/** Association object types to request for `crm` (e.g. ["companies"]). */
export function crmAssociationTypes(manifest: CollectionManifest, crm: string): string[] {
  const types = new Set<string>();
  for (const p of manifest.properties) {
    const t = p.crmAssociation?.[crm];
    if (t) types.add(t);
  }
  return [...types];
}

/** The property resolved from a given association object type, if any (e.g. "companies" -> company_domain). */
export function associationProperty(
  manifest: CollectionManifest,
  crm: string,
  objectType: string,
): ManifestProperty | undefined {
  return manifest.properties.find((p) => p.crmAssociation?.[crm] === objectType);
}

/** Coerce a raw CRM value to the manifest property type. Returns undefined for empty/invalid. */
export function coerceValue(raw: unknown, type: PropertyType): unknown {
  if (raw === null || raw === undefined || raw === "") return undefined;
  if (type === "number") {
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  return typeof raw === "string" ? raw : String(raw);
}

/**
 * Map a native CRM property bag to normalized Personize systemNames using the
 * manifest's crmFields. Only non-null mapped fields are returned. Association-
 * derived and runtime-derived fields (crm_source, crm_record_id, …) are set by
 * the caller.
 */
export function mapCrmProperties(
  manifest: CollectionManifest,
  crmProps: Record<string, unknown>,
  crm: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of manifest.properties) {
    const field = p.crmFields?.[crm];
    if (!field) continue;
    const value = coerceValue(crmProps[field], p.type);
    if (value !== undefined) out[p.systemName] = value;
  }
  return out;
}

/**
 * Build the manual-datasource inputs for a custom-sync entity from its manifest,
 * for one CRM: `propertyMappings` from each property's `crmFields[crm]`, and
 * `identityFields` (customKeyName/customKeySource) from the `crmSync.identity`
 * block. Throws with an actionable message if the manifest can't support sync for
 * this CRM (not a custom entity, missing identity, or no mapped fields).
 */
export function buildCustomEntitySync(manifest: CollectionManifest, crm: string): CustomEntitySync {
  const cfg = manifest.crmSync;
  if (!cfg || cfg.standard === true) {
    throw new Error(`Collection "${manifest.slug}" is not a custom-sync entity (no crmSync, or standard).`);
  }
  if (!cfg.identity) {
    throw new Error(`Collection "${manifest.slug}" crmSync.identity is required for a custom entity.`);
  }
  const customKeySource = cfg.identity.crmFields[crm];
  if (!customKeySource) {
    throw new Error(`Collection "${manifest.slug}" has no ${crm} identity source field (crmSync.identity.crmFields.${crm}).`);
  }

  const propertyMappings: CustomEntitySync["propertyMappings"] = [];
  for (const p of manifest.properties) {
    const field = p.crmFields?.[crm];
    if (field) propertyMappings.push({ source: field, target: p.systemName, direction: "in" });
  }
  if (propertyMappings.length === 0) {
    throw new Error(`Collection "${manifest.slug}" has no ${crm} property mappings (property crmFields.${crm}).`);
  }
  // The identity key must itself be one of the mapped targets, or Personize can't populate it.
  if (!propertyMappings.some((m) => m.target === cfg.identity!.keyName)) {
    throw new Error(
      `Collection "${manifest.slug}" identity keyName "${cfg.identity.keyName}" is not a ${crm}-mapped property.`,
    );
  }

  return {
    propertyMappings,
    identityFields: { customKeyName: cfg.identity.keyName, customKeySource },
  };
}
