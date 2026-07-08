import { readdir } from "node:fs/promises";
import { logger } from "./logger.js";
import { COLLECTION_DIRS, loadCollectionManifest, type CollectionManifest } from "./crm-field-map.js";

// -----------------------------------------------------------------------------
// crm-custom-entities — registry of custom CRM-sync entities, discovered from
// collection manifests.
//
// A collection manifest opts into custom sync by declaring a `crmSync` block with
// `standard !== true` and an `identity` (see crm-field-map). This registry scans
// the manifests and exposes them keyed by entityType, so `crm.sync-core` can sync
// arbitrary custom entities (deal, ticket, custom objects) with NO per-entity
// code — adding one is a manifest drop. Standard entities (contact/company) are
// not custom entities and never appear here; Personize auto-maps those.
// -----------------------------------------------------------------------------

export interface CustomEntity {
  /** Datasource entity type, e.g. "deal". */
  entityType: string;
  /** Collection slug the entity maps to, e.g. "deals". */
  slug: string;
  /** The full parsed manifest (source of property mappings + identity). */
  manifest: CollectionManifest;
}

let cache: CustomEntity[] | undefined;

/** Distinct collection slugs across core + local overlay dirs (filename minus `.json`). */
async function collectionSlugs(): Promise<string[]> {
  const slugs = new Set<string>();
  for (const dir of COLLECTION_DIRS) {
    const entries = await readdir(dir).catch(() => [] as string[]);
    for (const name of entries) {
      if (name.endsWith(".json")) slugs.add(name.slice(0, -".json".length));
    }
  }
  return [...slugs];
}

/**
 * Load every custom-sync entity declared across the collection manifests (local
 * overlay wins, via loadCollectionManifest). Cached per process. Fails soft: an
 * unreadable/invalid manifest is skipped with a warning, not fatal.
 */
export async function loadCustomEntities(): Promise<CustomEntity[]> {
  if (cache) return cache;
  const out: CustomEntity[] = [];
  for (const slug of await collectionSlugs()) {
    let manifest: CollectionManifest;
    try {
      manifest = await loadCollectionManifest(slug);
    } catch (error) {
      logger.warn("crm-custom-entities: skipped unreadable manifest", {
        slug,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const cfg = manifest.crmSync;
    if (cfg && cfg.standard !== true && typeof cfg.entityType === "string" && cfg.entityType) {
      out.push({ entityType: cfg.entityType, slug: manifest.slug, manifest });
    }
  }
  cache = out;
  return out;
}

/** entityType → CustomEntity map for the declared custom entities. */
export async function customEntitiesByType(): Promise<Map<string, CustomEntity>> {
  return new Map((await loadCustomEntities()).map((e) => [e.entityType, e]));
}
