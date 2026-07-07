import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import { client } from "../config.js";
import { logger } from "../lib/logger.js";
import type { CrmId } from "../operations/types.js";
import { applyCrmProperties, type ApplyCrmPropertiesResult } from "./apply-crm-properties.js";
import { applyEntityTypes, type ApplyEntityTypesResult } from "./apply-entity-types.js";
import { applyDocumentTypes, type ApplyDocumentTypesResult } from "./apply-document-types.js";
import { applyDocumentTags, type ApplyDocumentTagsResult } from "./apply-document-tags.js";
import { applyGraphRelations, type ApplyGraphRelationsResult } from "./apply-graph-relations.js";
import { applyDispatchRoutes, type ApplyDispatchRoutesResult } from "./apply-dispatch-routes.js";

const MANIFEST_DIR = path.join(process.cwd(), "manifests");
const CORE_DIR = path.join(MANIFEST_DIR, "core");
/**
 * Org-specific overlay. Git-ignored, never shipped. A file here overrides the
 * same-named file under manifests/core/ — so an org can customize a guideline or
 * collection (e.g. icp-definition.md) without editing the shared template, which
 * a later `setup` would otherwise reset. Core files with no local counterpart
 * still apply; this is a per-file merge, not a wholesale replace.
 */
const LOCAL_DIR = path.join(MANIFEST_DIR, "local");

interface ApplyOptions {
  dryRun: boolean;
  /**
   * If provided, also applies CRM-specific manifests under manifests/<crm>/.
   * Core (CRM-independent) manifests under manifests/core/ are always applied.
   */
  crm?: CrmId;
}

const CollectionPropertySchema = z.object({
  propertyName: z.string(),
  systemName: z.string().regex(/^[a-z][a-z0-9_]*$/, "systemName must be snake_case"),
  type: z.enum(["text", "number", "boolean", "date", "options", "array"]),
  autoSystem: z.boolean(),
  options: z.array(z.string()).optional(),
  description: z.string().optional(),
  updateSemantics: z.enum(["replace", "append"]).optional(),
  /**
   * Provenance of the value — how Personize populates it. Orthogonal to writeback.
   *   inferred  → LLM-derived (scores, stages, sentiment, next best action)
   *   extracted → structured data from public sources / normalization (industry, seniority, headcount)
   *   crm       → originated in the connected CRM (email, domain, record id) — never written back
   */
  source: z.enum(["inferred", "extracted", "crm"]).optional(),
  /**
   * When true, `setup` provisions a matching `personize_<systemName>` custom
   * property on the connected CRM object. This — not `autoSystem` — gates CRM
   * writeback, so structured `extracted` fields (e.g. employee_count) sync too.
   */
  writeback: z.boolean().optional(),
  /**
   * Per-CRM source field that feeds this property during crm.sync-core. Maps the
   * native CRM field name to this systemName (e.g. { hubspot: "jobtitle" }).
   * Sync derives both the request list and the rename map from these — no
   * hardcoded mapping. setup ignores this field.
   */
  crmFields: z.record(z.string()).optional(),
  /**
   * Per-CRM association object type that resolves this property (e.g.
   * { hubspot: "companies" } for company_domain). Resolved from the CRM
   * record's associations, not its flat properties.
   */
  crmAssociation: z.record(z.string()).optional(),
});

/**
 * Opt-in CRM-sync config for a collection (see crm-custom-entities). Standard
 * entities omit it or set `standard: true`; custom entities declare an `identity`
 * so crm.sync-core builds a manual datasource keyed on a custom field.
 */
const CrmSyncConfigSchema = z.object({
  entityType: z.string(),
  standard: z.boolean().optional(),
  crmObject: z.record(z.string()).optional(),
  identity: z
    .object({
      keyName: z.string(),
      crmFields: z.record(z.string()),
    })
    .optional(),
});

const CollectionManifestSchema = z.object({
  name: z.string(),
  slug: z.string().regex(/^[a-z][a-z0-9-]*$/, "slug must be lowercase-kebab-case"),
  description: z.string(),
  icon: z.string().optional(),
  color: z.string().optional(),
  primaryKeyField: z.string(),
  properties: z.array(CollectionPropertySchema),
  crmSync: CrmSyncConfigSchema.optional(),
});

const GuidelineFrontmatterSchema = z.object({
  name: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

type CollectionManifest = z.infer<typeof CollectionManifestSchema>;

export interface ManifestFile {
  name: string;
  fullPath: string;
}

/**
 * List `<category>` files for one or more overlay roots, in precedence order
 * (later roots win). A file present in a later root replaces the same-named file
 * from an earlier root; files unique to any root are kept. Missing dirs are
 * skipped silently, so an absent manifests/local/ is a no-op.
 */
export async function resolveOverlayFiles(
  roots: string[],
  category: string,
  ext: string,
): Promise<ManifestFile[]> {
  const byName = new Map<string, string>();
  for (const root of roots) {
    const dir = path.join(root, category);
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(ext)) {
        byName.set(entry.name, path.join(dir, entry.name));
      }
    }
  }
  return [...byName.entries()].map(([name, fullPath]) => ({ name, fullPath }));
}

async function readJsonFiles(files: ManifestFile[]): Promise<Array<{ name: string; data: CollectionManifest }>> {
  const out: Array<{ name: string; data: CollectionManifest }> = [];
  for (const file of files) {
    const raw = JSON.parse(await readFile(file.fullPath, "utf8"));
    const parsed = CollectionManifestSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `Invalid collection manifest ${file.name}: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      );
    }
    out.push({ name: file.name, data: parsed.data });
  }
  return out;
}

async function applyCollections(files: ManifestFile[], dryRun: boolean): Promise<number> {
  const desired = await readJsonFiles(files);
  if (desired.length === 0) return 0;

  const existing = await client.collections.list();
  const existingSlugs = new Set<string>(
    (existing.data ?? [])
      .map((collection) => collection.slug)
      .filter((slug): slug is string => typeof slug === "string"),
  );
  let changed = 0;

  for (const manifest of desired) {
    const slug = manifest.data.slug;

    if (existingSlugs.has(slug)) {
      // Update: push new properties the local manifest has that aren't in the remote yet.
      // Full schema replace is not safe; we only add net-new properties.
      const existingCollection = (existing.data ?? []).find((c: any) => c.slug === slug);
      const existingSystemNames = new Set<string>(
        ((existingCollection?.properties ?? []) as any[]).map((p: any) => p.systemName).filter(Boolean)
      );
      const netNewProps = manifest.data.properties.filter(
        (p) => !existingSystemNames.has(p.systemName)
      );

      if (netNewProps.length === 0) {
        logger.info("Collection up-to-date; skipping update", { slug });
        continue;
      }

      // Guard: can't update without an ID (e.g. malformed API response)
      if (!existingCollection?.id) {
        logger.warn("Collection missing id; skipping update", { slug });
        continue;
      }

      changed++;
      if (dryRun) {
        logger.info("[DRY RUN] Would update collection (add new properties)", { slug, file: manifest.name, netNew: netNewProps.length });
        continue;
      }

      // Send existing props + net-new props so the update is safe regardless of
      // whether the SDK treats `update` as a replace or a merge.
      const existingProps = (existingCollection.properties ?? []) as typeof netNewProps;
      await client.collections.update(existingCollection.id, {
        ...manifest.data,
        properties: [...existingProps, ...netNewProps],
      });
      logger.info("Updated collection", { slug, netNew: netNewProps.length });
      continue;
    }

    changed++;
    if (dryRun) {
      logger.info("[DRY RUN] Would create collection", { slug, file: manifest.name });
      continue;
    }

    await client.collections.create(manifest.data);
    logger.info("Created collection", { slug });
  }

  return changed;
}

async function applyGuidelines(files: ManifestFile[], dryRun: boolean): Promise<number> {
  if (files.length === 0) return 0;

  // Idempotent upsert: fetch existing guidelines once, compare by name + value.
  const existingResponse = await (client as any).context?.list?.({ type: "guideline" }).catch(() => null);
  const existingByName = new Map<string, { id?: string; value?: string }>();
  for (const item of existingResponse?.data ?? []) {
    if (item?.name) existingByName.set(item.name, { id: item.id, value: item.value });
  }

  let changed = 0;
  for (const file of files) {
    const parsed = matter(await readFile(file.fullPath, "utf8"));
    const fm = GuidelineFrontmatterSchema.safeParse(parsed.data);
    if (!fm.success) {
      throw new Error(
        `Invalid guideline frontmatter in ${file.name}: ${fm.error.issues
          .map((i) => i.message)
          .join("; ")}`,
      );
    }

    const name = fm.data.name ?? file.name.replace(/\.md$/, "");
    const tags = fm.data.tags ?? [];
    const value = parsed.content.trim();
    const existing = existingByName.get(name);

    if (existing && existing.value === value) {
      logger.info("Guideline up-to-date; skipping", { name });
      continue;
    }

    changed++;
    const action = existing ? "update" : "create";

    if (dryRun) {
      logger.info(`[DRY RUN] Would ${action} guideline`, { name, tags });
      continue;
    }

    if (existing && existing.id) {
      await (client as any).context.update(existing.id, { value, tags });
      logger.info("Updated guideline", { name });
    } else {
      await (client as any).context.create({ type: "guideline", name, value, tags });
      logger.info("Created guideline", { name });
    }
  }

  return changed;
}

export interface ApplyManifestsResult {
  [key: string]: unknown;
  collections: number;
  guidelines: number;
  entityTypes: ApplyEntityTypesResult;
  documentTypes: ApplyDocumentTypesResult;
  documentTags: ApplyDocumentTagsResult;
  graphRelations: ApplyGraphRelationsResult;
  dispatchRoutes: ApplyDispatchRoutesResult;
  crmProperties?: ApplyCrmPropertiesResult;
}

export async function applyManifests(options: ApplyOptions): Promise<ApplyManifestsResult> {
  const { dryRun, crm } = options;

  // Core templates with the git-ignored local overlay layered on top (local wins).
  let collections = await applyCollections(
    await resolveOverlayFiles([CORE_DIR, LOCAL_DIR], "collections", ".json"),
    dryRun,
  );
  let guidelines = await applyGuidelines(
    await resolveOverlayFiles([CORE_DIR, LOCAL_DIR], "guidelines", ".md"),
    dryRun,
  );

  let crmProperties: ApplyCrmPropertiesResult | undefined;

  if (crm) {
    collections += await applyCollections(
      await resolveOverlayFiles([path.join(MANIFEST_DIR, crm)], "collections", ".json"),
      dryRun,
    );
    guidelines += await applyGuidelines(
      await resolveOverlayFiles([path.join(MANIFEST_DIR, crm)], "guidelines", ".md"),
      dryRun,
    );

    // Provision the personize_* custom properties on the connected CRM. Driven
    // by the writeback:true flags in the contacts/companies manifests.
    crmProperties = await applyCrmProperties({ crm, dryRun });
  }

  // Entity/doc/tag/relation/dispatch-route registration is independent of the
  // collections, guidelines and CRM-property provisioning above. Keep each step
  // non-fatal so an API/backend mismatch here can't abort a run whose core work
  // already succeeded. Each apply* already handles its own errors; this is a backstop.
  const entityTypes = await applyEntityTypes(dryRun).catch(nonFatal("entity-types", emptyEntityTypes));
  const documentTypes = await applyDocumentTypes(dryRun).catch(nonFatal("document-types", emptyDocumentTypes));
  const documentTags = await applyDocumentTags(dryRun).catch(nonFatal("document-tags", emptyDocumentTags));
  const graphRelations = await applyGraphRelations(dryRun).catch(nonFatal("graph-relations", emptyGraphRelations));
  const dispatchRoutes = await applyDispatchRoutes(dryRun);

  return { collections, guidelines, entityTypes, documentTypes, documentTags, graphRelations, dispatchRoutes, crmProperties };
}

/**
 * Wraps a registration step so an unexpected throw degrades to a warning-bearing
 * empty result instead of aborting the whole apply run.
 */
function nonFatal<T extends { warnings: string[] }>(step: string, empty: () => T): (err: unknown) => T {
  return (err: unknown) => {
    const msg = `${step} registration failed: ${(err as Error)?.message ?? String(err)}`;
    logger.warn(msg);
    const result = empty();
    result.warnings.push(msg);
    return result;
  };
}

function emptyEntityTypes(): ApplyEntityTypesResult {
  return { created: 0, updated: 0, skipped: 0, details: [], warnings: [] };
}
function emptyDocumentTypes(): ApplyDocumentTypesResult {
  return { created: 0, updated: 0, skipped: 0, details: [], warnings: [] };
}
function emptyDocumentTags(): ApplyDocumentTagsResult {
  return { created: 0, updated: 0, skipped: 0, details: [], warnings: [] };
}
function emptyGraphRelations(): ApplyGraphRelationsResult {
  return { created: 0, skipped: 0, details: [], warnings: [] };
}
