import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { client } from "../config.js";
import { logger } from "../lib/logger.js";
import { describeApiError } from "../lib/personize-helpers.js";

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
  /** Non-fatal problems (e.g. an unsupported backend, or a type that can't be created). */
  warnings: string[];
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

interface ExistingEntityType {
  id: string;
  name: string;
  description?: string;
  icon?: string;
}

export async function applyEntityTypes(dryRun: boolean): Promise<ApplyEntityTypesResult> {
  const result: ApplyEntityTypesResult = { created: 0, updated: 0, skipped: 0, details: [], warnings: [] };

  const desired = await loadEntityTypes().catch(() => {
    logger.info("No entity-types manifest found; skipping");
    return [] as EntityType[];
  });
  if (desired.length === 0) return result;

  // Entity types live under GET /api/v1/entity-types (client.entityTypes.*).
  // The API exposes list/get/update/archive but no create — entity types are
  // system-managed, so this step reconciles metadata on existing types and
  // warns (never throws) for any desired type the backend doesn't already own.
  const listFn = (client as any).entityTypes?.list;
  if (typeof listFn !== "function") {
    const msg = "entityTypes API not available on this backend; skipping entity-type registration";
    logger.warn(msg);
    result.warnings.push(msg);
    return result;
  }

  let existingByName: Map<string, ExistingEntityType>;
  try {
    const res = await client.entityTypes.list();
    const items: ExistingEntityType[] = (res as any)?.data ?? [];
    existingByName = new Map(items.filter((it) => it?.name).map((it) => [it.name, it]));
  } catch (err) {
    const msg = `Failed to list entity types: ${describeApiError(err)}`;
    logger.warn(msg);
    result.warnings.push(msg);
    return result;
  }

  for (const et of desired) {
    const existing = existingByName.get(et.name);

    if (!existing) {
      // No create endpoint exists — entity types are provisioned by Personize.
      const msg = `Entity type "${et.name}" is not registered and cannot be created via the API (system-managed); skipping`;
      logger.warn(msg);
      result.warnings.push(msg);
      result.skipped++;
      continue;
    }

    const drifted = existing.description !== et.description || (et.icon !== undefined && existing.icon !== et.icon);
    if (!drifted) {
      result.skipped++;
      result.details.push(`Entity type up-to-date: ${et.name}`);
      continue;
    }

    if (dryRun) {
      result.updated++;
      result.details.push(`[DRY RUN] Would update entity type: ${et.name}`);
      continue;
    }

    try {
      await client.entityTypes.update(existing.id, { description: et.description, icon: et.icon });
      result.updated++;
      result.details.push(`Updated entity type: ${et.name}`);
    } catch (err) {
      const msg = `Failed to update entity type "${et.name}": ${describeApiError(err)}`;
      logger.warn(msg);
      result.warnings.push(msg);
    }
  }

  logger.info("Entity types applied", {
    created: result.created,
    updated: result.updated,
    skipped: result.skipped,
    warnings: result.warnings.length,
  });
  return result;
}
