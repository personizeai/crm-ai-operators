import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { client } from "../config.js";
import { logger } from "../lib/logger.js";

const MANIFEST_DIR = path.join(process.cwd(), "manifests");

const DocumentTagSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, "name must be lowercase-kebab-case"),
  description: z.string(),
});

type DocumentTag = z.infer<typeof DocumentTagSchema>;

export interface ApplyDocumentTagsResult {
  created: number;
  updated: number;
  skipped: number;
  details: string[];
  warnings: string[];
}

async function loadDocumentTags(): Promise<DocumentTag[]> {
  const filePath = path.join(MANIFEST_DIR, "core", "document-tags", "document-tags.json");
  const raw = JSON.parse(await readFile(filePath, "utf8"));
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map((item: unknown) => {
    const parsed = DocumentTagSchema.safeParse(item);
    if (!parsed.success) throw new Error(`Invalid document tag: ${JSON.stringify(parsed.error.issues)}`);
    return parsed.data;
  });
}

interface ExistingTag {
  canonical_tag: string;
  description?: string | null;
}

export async function applyDocumentTags(dryRun: boolean): Promise<ApplyDocumentTagsResult> {
  const result: ApplyDocumentTagsResult = { created: 0, updated: 0, skipped: 0, details: [], warnings: [] };

  const desired = await loadDocumentTags().catch(() => {
    logger.info("No document-tags manifest found; skipping");
    return [] as DocumentTag[];
  });
  if (desired.length === 0) return result;

  // Curated tag vocabulary under /api/v1.1/context/manage/tags
  // (client.v1_1.context.*). Absent on the private gateway subset — probe and
  // warn instead of throwing.
  const ctx = (client as any).v1_1?.context;
  if (!ctx || typeof ctx.listTags !== "function" || typeof ctx.createTag !== "function") {
    const msg = "context tag API not available on this backend; skipping document-tag registration";
    logger.warn(msg);
    result.warnings.push(msg);
    return result;
  }

  let existingByName: Map<string, ExistingTag>;
  try {
    const res = await ctx.listTags();
    const items: ExistingTag[] = res?.tags ?? [];
    existingByName = new Map(items.filter((it) => it?.canonical_tag).map((it) => [it.canonical_tag, it]));
  } catch (err) {
    const msg = `Failed to list document tags: ${(err as Error).message}`;
    logger.warn(msg);
    result.warnings.push(msg);
    return result;
  }

  for (const tag of desired) {
    const existing = existingByName.get(tag.name);

    try {
      if (!existing) {
        if (dryRun) {
          result.created++;
          result.details.push(`[DRY RUN] Would create document tag: ${tag.name}`);
          continue;
        }
        // canonical_tag is the stable key; label is the human-facing name.
        await ctx.createTag({ canonical_tag: tag.name, label: tag.name, description: tag.description });
        result.created++;
        result.details.push(`Created document tag: ${tag.name}`);
      } else if ((existing.description ?? "") !== tag.description) {
        if (dryRun) {
          result.updated++;
          result.details.push(`[DRY RUN] Would update document tag: ${tag.name}`);
          continue;
        }
        await ctx.updateTag(tag.name, { description: tag.description });
        result.updated++;
        result.details.push(`Updated document tag: ${tag.name}`);
      } else {
        result.skipped++;
        result.details.push(`Document tag up-to-date: ${tag.name}`);
      }
    } catch (err) {
      const msg = `Failed to apply document tag "${tag.name}": ${(err as Error).message}`;
      logger.warn(msg);
      result.warnings.push(msg);
    }
  }

  logger.info("Document tags applied", {
    created: result.created,
    updated: result.updated,
    skipped: result.skipped,
    warnings: result.warnings.length,
  });
  return result;
}
