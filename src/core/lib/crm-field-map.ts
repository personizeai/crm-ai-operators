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

export interface CollectionManifest {
  slug: string;
  primaryKeyField: string;
  properties: ManifestProperty[];
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
