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
  /** The API keys doc-types by `type_name` (snake_case), not `name`. */
  type_name: string;
  label?: string;
  description?: string;
  /** System built-ins (e.g. "playbook") are listable but not patchable. */
  is_builtin?: boolean;
}

/**
 * The API's `type_name` must be snake_case — kebab-case is rejected as
 * "Invalid". Manifest names are kebab (e.g. "email-draft"), so derive a valid
 * snake_case key ("email_draft") for every API call (create/update/list match).
 */
function toTypeName(name: string): string {
  return name.replace(/-/g, "_");
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
    existingByName = new Map(items.filter((it) => it?.type_name).map((it) => [it.type_name, it]));
  } catch (err) {
    const msg = `Failed to list document types: ${(err as Error).message}`;
    logger.warn(msg);
    result.warnings.push(msg);
    return result;
  }

  for (const dt of desired) {
    // Wire contract (verified live): snake_case `type_name` + required `label`.
    // `description` is stored; the manifest's `tags` are not modeled by this
    // endpoint (doc-types carry no tags), so they're intentionally not sent.
    const typeName = toTypeName(dt.name);
    const existing = existingByName.get(typeName);

    try {
      if (!existing) {
        if (dryRun) {
          result.created++;
          result.details.push(`[DRY RUN] Would create document type: ${typeName}`);
          continue;
        }
        await ctx.createDocType({ type_name: typeName, label: dt.displayName, description: dt.description });
        result.created++;
        result.details.push(`Created document type: ${typeName}`);
      } else if (existing.is_builtin) {
        // System built-in (e.g. "playbook"): listable but PATCH 404s. Leave it.
        result.skipped++;
        result.details.push(`Document type is a system built-in; leaving as-is: ${typeName}`);
      } else if (existing.description !== dt.description || existing.label !== dt.displayName) {
        if (dryRun) {
          result.updated++;
          result.details.push(`[DRY RUN] Would update document type: ${typeName}`);
          continue;
        }
        await ctx.updateDocType(typeName, { label: dt.displayName, description: dt.description });
        result.updated++;
        result.details.push(`Updated document type: ${typeName}`);
      } else {
        result.skipped++;
        result.details.push(`Document type up-to-date: ${typeName}`);
      }
    } catch (err) {
      const msg = `Failed to apply document type "${typeName}": ${(err as Error).message}`;
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
