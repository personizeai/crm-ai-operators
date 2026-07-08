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
  warnings: string[];
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

interface ExistingDocType {
  name: string;
  description?: string;
}

export async function applyDocumentTypes(dryRun: boolean): Promise<ApplyDocumentTypesResult> {
  const result: ApplyDocumentTypesResult = { created: 0, updated: 0, skipped: 0, details: [], warnings: [] };

  const desired = await loadDocumentTypes().catch(() => {
    logger.info("No document-types manifest found; skipping");
    return [] as DocumentType[];
  });
  if (desired.length === 0) return result;

  // Doc-types are managed under /api/v1.1/context/manage/doc-types
  // (client.v1_1.context.*). Not present on the private gateway subset, so
  // probe for the namespace and warn rather than throw when it's absent.
  const ctx = (client as any).v1_1?.context;
  if (!ctx || typeof ctx.listDocTypes !== "function" || typeof ctx.createDocType !== "function") {
    const msg = "context doc-type API not available on this backend; skipping document-type registration";
    logger.warn(msg);
    result.warnings.push(msg);
    return result;
  }

  let existingByName: Map<string, ExistingDocType>;
  try {
    const res = await ctx.listDocTypes();
    const items: ExistingDocType[] = res?.types ?? [];
    existingByName = new Map(items.filter((it) => it?.name).map((it) => [it.name, it]));
  } catch (err) {
    const msg = `Failed to list document types: ${(err as Error).message}`;
    logger.warn(msg);
    result.warnings.push(msg);
    return result;
  }

  for (const dt of desired) {
    const existing = existingByName.get(dt.name);

    try {
      if (!existing) {
        if (dryRun) {
          result.created++;
          result.details.push(`[DRY RUN] Would create document type: ${dt.name}`);
          continue;
        }
        await ctx.createDocType({ name: dt.name, displayName: dt.displayName, description: dt.description, tags: dt.tags });
        result.created++;
        result.details.push(`Created document type: ${dt.name}`);
      } else if (existing.description !== dt.description) {
        if (dryRun) {
          result.updated++;
          result.details.push(`[DRY RUN] Would update document type: ${dt.name}`);
          continue;
        }
        await ctx.updateDocType(dt.name, { displayName: dt.displayName, description: dt.description, tags: dt.tags });
        result.updated++;
        result.details.push(`Updated document type: ${dt.name}`);
      } else {
        result.skipped++;
        result.details.push(`Document type up-to-date: ${dt.name}`);
      }
    } catch (err) {
      const msg = `Failed to apply document type "${dt.name}": ${(err as Error).message}`;
      logger.warn(msg);
      result.warnings.push(msg);
    }
  }

  logger.info("Document types applied", {
    created: result.created,
    updated: result.updated,
    skipped: result.skipped,
    warnings: result.warnings.length,
  });
  return result;
}
