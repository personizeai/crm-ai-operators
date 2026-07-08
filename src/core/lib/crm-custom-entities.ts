import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { logger } from "./logger.js";
import type { CollectionManifest } from "./crm-field-map.js";

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

const MANIFEST_DIR = path.join(process.cwd(), "manifests", "core", "collections");

export interface CustomEntity {
  /** Datasource entity type, e.g. "deal". */
  entityType: string;
  /** Collection slug the entity maps to, e.g. "deals". */
  slug: string;
  /** The full parsed manifest (source of property mappings + identity). */
  manifest: CollectionManifest;
}

let cache: CustomEntity[] | undefined;

/**
 * Load every custom-sync entity declared across the collection manifests.
 * Cached per process. Fails soft: an unreadable/invalid manifest is skipped with
 * a warning rather than breaking the whole registry.
 */
export async function loadCustomEntities(): Promise<CustomEntity[]> {
  if (cache) return cache;
  const out: CustomEntity[] = [];
  const entries = await readdir(MANIFEST_DIR).catch(() => [] as string[]);
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const manifest = JSON.parse(await readFile(path.join(MANIFEST_DIR, name), "utf8")) as CollectionManifest;
      const cfg = manifest.crmSync;
      if (cfg && cfg.standard !== true && typeof cfg.entityType === "string" && cfg.entityType) {
        out.push({ entityType: cfg.entityType, slug: manifest.slug, manifest });
      }
    } catch (error) {
      logger.warn("crm-custom-entities: skipped unreadable manifest", {
        file: name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  cache = out;
  return out;
}

/** entityType → CustomEntity map for the declared custom entities. */
export async function customEntitiesByType(): Promise<Map<string, CustomEntity>> {
  return new Map((await loadCustomEntities()).map((e) => [e.entityType, e]));
}
