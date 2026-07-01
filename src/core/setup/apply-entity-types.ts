import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { client } from "../config.js";
import { logger } from "../lib/logger.js";

const MANIFEST_DIR = path.join(process.cwd(), "manifests");

const EntityTypeSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/, "name must be snake_case"),
  displayName: z.string(),
  description: z.string(),
  primaryKey: z.string(),
  icon: z.string().optional(),
});

type EntityType = z.infer<typeof EntityTypeSchema>;

export interface ApplyEntityTypesResult {
  created: number;
  updated: number;
  skipped: number;
  details: string[];
}

async function loadEntityTypes(): Promise<EntityType[]> {
  const filePath = path.join(MANIFEST_DIR, "core", "entity-types", "entity-types.json");
  const raw = JSON.parse(await readFile(filePath, "utf8"));
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map((item: unknown) => {
    const parsed = EntityTypeSchema.safeParse(item);
    if (!parsed.success) throw new Error(`Invalid entity type: ${JSON.stringify(parsed.error.issues)}`);
    return parsed.data;
  });
}

export async function applyEntityTypes(dryRun: boolean): Promise<ApplyEntityTypesResult> {
  const result: ApplyEntityTypesResult = { created: 0, updated: 0, skipped: 0, details: [] };

  const desired = await loadEntityTypes().catch(() => {
    logger.info("No entity-types manifest found; skipping");
    return [] as EntityType[];
  });
  if (desired.length === 0) return result;

  // Fetch existing entity types. SDK method TBD — using context list with type filter as fallback.
  const existingRes = await (client as any).context?.list?.({ type: "entity-type" }).catch(() => null);
  const existingByName = new Map<string, { id: string; displayName: string; description: string }>();
  for (const item of existingRes?.data ?? []) {
    if (item?.name) existingByName.set(item.name, item);
  }

  for (const et of desired) {
    const existing = existingByName.get(et.name);
    const payload = { type: "entity-type", name: et.name, displayName: et.displayName, description: et.description, primaryKey: et.primaryKey, icon: et.icon };

    if (!existing) {
      if (dryRun) { result.created++; result.details.push(`[DRY RUN] Would create entity type: ${et.name}`); continue; }
      await (client as any).context.create(payload);
      result.created++;
      result.details.push(`Created entity type: ${et.name}`);
    } else if (existing.displayName !== et.displayName || existing.description !== et.description) {
      if (dryRun) { result.updated++; result.details.push(`[DRY RUN] Would update entity type: ${et.name}`); continue; }
      await (client as any).context.update(existing.id, { displayName: et.displayName, description: et.description, icon: et.icon });
      result.updated++;
      result.details.push(`Updated entity type: ${et.name}`);
    } else {
      result.skipped++;
      result.details.push(`Entity type up-to-date: ${et.name}`);
    }
  }

  logger.info("Entity types applied", { created: result.created, updated: result.updated, skipped: result.skipped });
  return result;
}
