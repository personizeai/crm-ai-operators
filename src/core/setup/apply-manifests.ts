import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import { client } from "../config.js";
import { logger } from "../lib/logger.js";
import type { CrmId } from "../operations/types.js";
import { applyCrmProperties, type ApplyCrmPropertiesResult } from "./apply-crm-properties.js";

const MANIFEST_DIR = path.join(process.cwd(), "manifests");

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
});

const CollectionManifestSchema = z.object({
  name: z.string(),
  slug: z.string().regex(/^[a-z][a-z0-9-]*$/, "slug must be lowercase-kebab-case"),
  description: z.string(),
  icon: z.string().optional(),
  color: z.string().optional(),
  primaryKeyField: z.string(),
  properties: z.array(CollectionPropertySchema),
});

const GuidelineFrontmatterSchema = z.object({
  name: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

type CollectionManifest = z.infer<typeof CollectionManifestSchema>;

async function readJsonFiles(dir: string): Promise<Array<{ name: string; data: CollectionManifest }>> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
  const out: Array<{ name: string; data: CollectionManifest }> = [];
  for (const file of files) {
    const fullPath = path.join(dir, file.name);
    const raw = JSON.parse(await readFile(fullPath, "utf8"));
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

async function applyCollectionsFromDir(dir: string, dryRun: boolean): Promise<number> {
  const desired = await readJsonFiles(dir);
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
      logger.info("Collection already exists; skipping create (update path TBD)", { slug });
      continue;
    }

    changed++;
    if (dryRun) {
      logger.info("[DRY RUN] Would create collection", { slug, file: manifest.name, dir });
      continue;
    }

    await client.collections.create(manifest.data);
    logger.info("Created collection", { slug });
  }

  return changed;
}

async function applyGuidelinesFromDir(dir: string, dryRun: boolean): Promise<number> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md"));
  if (files.length === 0) return 0;

  // Idempotent upsert: fetch existing guidelines once, compare by name + value.
  const existingResponse = await (client as any).context?.list?.({ type: "guideline" }).catch(() => null);
  const existingByName = new Map<string, { id?: string; value?: string }>();
  for (const item of existingResponse?.data ?? []) {
    if (item?.name) existingByName.set(item.name, { id: item.id, value: item.value });
  }

  let changed = 0;
  for (const file of files) {
    const parsed = matter(await readFile(path.join(dir, file.name), "utf8"));
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

export async function applyManifests(options: ApplyOptions) {
  const { dryRun, crm } = options;

  let collections = await applyCollectionsFromDir(
    path.join(MANIFEST_DIR, "core", "collections"),
    dryRun,
  );
  let guidelines = await applyGuidelinesFromDir(
    path.join(MANIFEST_DIR, "core", "guidelines"),
    dryRun,
  );

  let crmProperties: ApplyCrmPropertiesResult | undefined;

  if (crm) {
    collections += await applyCollectionsFromDir(
      path.join(MANIFEST_DIR, crm, "collections"),
      dryRun,
    );
    guidelines += await applyGuidelinesFromDir(
      path.join(MANIFEST_DIR, crm, "guidelines"),
      dryRun,
    );

    // Provision the personize_* custom properties on the connected CRM. Driven
    // by the writeback:true flags in the contacts/companies manifests.
    crmProperties = await applyCrmProperties({ crm, dryRun });
  }

  return { collections, guidelines, crmProperties };
}
