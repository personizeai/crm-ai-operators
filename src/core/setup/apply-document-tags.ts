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

export async function applyDocumentTags(dryRun: boolean): Promise<ApplyDocumentTagsResult> {
  const result: ApplyDocumentTagsResult = { created: 0, updated: 0, skipped: 0, details: [] };

  const desired = await loadDocumentTags().catch(() => {
    logger.info("No document-tags manifest found; skipping");
    return [] as DocumentTag[];
  });
  if (desired.length === 0) return result;

  const existingRes = await (client as any).context?.list?.({ type: "document-tag" }).catch(() => null);
  const existingByName = new Map<string, { id: string; description: string }>();
  for (const item of existingRes?.data ?? []) {
    if (item?.name) existingByName.set(item.name, item);
  }

  for (const tag of desired) {
    const existing = existingByName.get(tag.name);

    if (!existing) {
      if (dryRun) { result.created++; result.details.push(`[DRY RUN] Would create document tag: ${tag.name}`); continue; }
      await (client as any).context.create({ type: "document-tag", name: tag.name, description: tag.description });
      result.created++;
      result.details.push(`Created document tag: ${tag.name}`);
    } else if (existing.description !== tag.description) {
      if (dryRun) { result.updated++; result.details.push(`[DRY RUN] Would update document tag: ${tag.name}`); continue; }
      await (client as any).context.update(existing.id, { description: tag.description });
      result.updated++;
      result.details.push(`Updated document tag: ${tag.name}`);
    } else {
      result.skipped++;
      result.details.push(`Document tag up-to-date: ${tag.name}`);
    }
  }

  logger.info("Document tags applied", { created: result.created, updated: result.updated, skipped: result.skipped });
  return result;
}
