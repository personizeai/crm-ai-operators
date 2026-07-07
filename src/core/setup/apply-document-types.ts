import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { client } from "../config.js";
import { logger } from "../lib/logger.js";

const MANIFEST_DIR = path.join(process.cwd(), "manifests");

const DocumentTypeSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, "name must be lowercase-kebab-case"),
  displayName: z.string(),
  description: z.string(),
  tags: z.array(z.string()).default([]),
});

type DocumentType = z.infer<typeof DocumentTypeSchema>;

export interface ApplyDocumentTypesResult {
  created: number;
  updated: number;
  skipped: number;
  details: string[];
}

async function loadDocumentTypes(): Promise<DocumentType[]> {
  const filePath = path.join(MANIFEST_DIR, "core", "document-types", "document-types.json");
  const raw = JSON.parse(await readFile(filePath, "utf8"));
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map((item: unknown) => {
    const parsed = DocumentTypeSchema.safeParse(item);
    if (!parsed.success) throw new Error(`Invalid document type: ${JSON.stringify(parsed.error.issues)}`);
    return parsed.data;
  });
}

export async function applyDocumentTypes(dryRun: boolean): Promise<ApplyDocumentTypesResult> {
  const result: ApplyDocumentTypesResult = { created: 0, updated: 0, skipped: 0, details: [] };

  const desired = await loadDocumentTypes().catch(() => {
    logger.info("No document-types manifest found; skipping");
    return [] as DocumentType[];
  });
  if (desired.length === 0) return result;

  const existingRes = await (client as any).context?.list?.({ type: "document-type" }).catch(() => null);
  const existingByName = new Map<string, { id: string; description: string }>();
  for (const item of existingRes?.data ?? []) {
    if (item?.name) existingByName.set(item.name, item);
  }

  for (const dt of desired) {
    const existing = existingByName.get(dt.name);

    try {
      if (!existing) {
        if (dryRun) { result.created++; result.details.push(`[DRY RUN] Would create document type: ${dt.name}`); continue; }
        await (client as any).context.create({ type: "document-type", name: dt.name, displayName: dt.displayName, description: dt.description, tags: dt.tags });
        result.created++;
        result.details.push(`Created document type: ${dt.name}`);
      } else if (existing.description !== dt.description) {
        if (dryRun) { result.updated++; result.details.push(`[DRY RUN] Would update document type: ${dt.name}`); continue; }
        await (client as any).context.update(existing.id, { displayName: dt.displayName, description: dt.description, tags: dt.tags });
        result.updated++;
        result.details.push(`Updated document type: ${dt.name}`);
      } else {
        result.skipped++;
        result.details.push(`Document type up-to-date: ${dt.name}`);
      }
    } catch (error) {
      const body = (error as any)?.cause?.response?.data;
      const msg = body?.error?.message ?? body?.message ?? (error instanceof Error ? error.message : String(error));
      logger.warn("Failed to apply document type — org's Personize API may not support this manifest type yet", { name: dt.name, error: msg });
      result.skipped++;
      result.details.push(`Document type FAILED (skipped): ${dt.name} — ${msg}`);
    }
  }

  logger.info("Document types applied", { created: result.created, updated: result.updated, skipped: result.skipped });
  return result;
}
