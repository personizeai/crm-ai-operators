import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { client } from "../config.js";
import { logger } from "../lib/logger.js";
import { describeApiError } from "../lib/personize-helpers.js";

const MANIFEST_DIR = path.join(process.cwd(), "manifests");

const GraphRelationSchema = z.object({
  fromType: z.string(),
  relation: z.string().regex(/^[a-z][a-z0-9_]*$/, "relation must be snake_case"),
  toType: z.string(),
  description: z.string(),
});

type GraphRelation = z.infer<typeof GraphRelationSchema>;

export interface ApplyGraphRelationsResult {
  created: number;
  skipped: number;
  details: string[];
  warnings: string[];
}

interface DesiredRelationType {
  typeName: string;
  description: string;
  allowedFromTypes: string[];
  allowedToTypes: string[];
}

async function loadGraphRelations(): Promise<GraphRelation[]> {
  const filePath = path.join(MANIFEST_DIR, "core", "graph-relations", "graph-relations.json");
  const raw = JSON.parse(await readFile(filePath, "utf8"));
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map((item: unknown) => {
    const parsed = GraphRelationSchema.safeParse(item);
    if (!parsed.success) throw new Error(`Invalid graph relation: ${JSON.stringify(parsed.error.issues)}`);
    return parsed.data;
  });
}

/**
 * The manifest lists relations as (fromType, relation, toType) triples, but the
 * API models a relation *type* keyed by name with allowedFromTypes/allowedToTypes
 * arrays. Collapse triples that share a relation name into one relation type,
 * unioning their endpoint constraints.
 */
function toRelationTypes(relations: GraphRelation[]): DesiredRelationType[] {
  const byName = new Map<string, DesiredRelationType>();
  for (const rel of relations) {
    let entry = byName.get(rel.relation);
    if (!entry) {
      entry = { typeName: rel.relation, description: rel.description, allowedFromTypes: [], allowedToTypes: [] };
      byName.set(rel.relation, entry);
    }
    if (!entry.allowedFromTypes.includes(rel.fromType)) entry.allowedFromTypes.push(rel.fromType);
    if (!entry.allowedToTypes.includes(rel.toType)) entry.allowedToTypes.push(rel.toType);
  }
  return [...byName.values()];
}

export async function applyGraphRelations(dryRun: boolean): Promise<ApplyGraphRelationsResult> {
  const result: ApplyGraphRelationsResult = { created: 0, skipped: 0, details: [], warnings: [] };

  const relations = await loadGraphRelations().catch(() => {
    logger.info("No graph-relations manifest found; skipping");
    return [] as GraphRelation[];
  });
  if (relations.length === 0) return result;

  const desired = toRelationTypes(relations);

  // Endpoint split (verified live): the flat GET /relation-types *list* route is
  // unrouted on the API and 400s with an unrelated "orgId, propertyName, and
  // query are required", but the POST create route works. So read existing
  // types from the graph *config* snapshot (GET /graph/config, which does work)
  // and write each new one via the additive per-item createRelationType. Note
  // we deliberately avoid putConfig here: a whole-bundle upsert risks dropping
  // built-in relation types, whereas per-item create can only add. Both live
  // under client.v1_1.memory.*; absent on the private gateway subset, so probe
  // and warn rather than throw.
  const mem = (client as any).v1_1?.memory;
  const graph = mem?.graph;
  if (!mem || typeof mem.createRelationType !== "function" || !graph || typeof graph.getConfig !== "function") {
    const msg = "graph relation-type API not available on this backend; skipping graph-relation registration";
    logger.warn(msg);
    result.warnings.push(msg);
    return result;
  }

  let existingNames: Set<string>;
  try {
    const res = await graph.getConfig();
    const items: Array<{ typeName?: string }> = res?.data?.relationTypes ?? [];
    existingNames = new Set(items.filter((it) => it?.typeName).map((it) => it.typeName as string));
  } catch (err) {
    const msg = `Failed to read graph config: ${describeApiError(err)}`;
    logger.warn(msg);
    result.warnings.push(msg);
    return result;
  }

  for (const rt of desired) {
    if (existingNames.has(rt.typeName)) {
      result.skipped++;
      result.details.push(`Relation type exists: ${rt.typeName}`);
      continue;
    }
    if (dryRun) {
      result.created++;
      result.details.push(`[DRY RUN] Would create relation type: ${rt.typeName}`);
      continue;
    }
    try {
      await mem.createRelationType({
        typeName: rt.typeName,
        description: rt.description,
        allowedFromTypes: rt.allowedFromTypes,
        allowedToTypes: rt.allowedToTypes,
      });
      result.created++;
      result.details.push(`Created relation type: ${rt.typeName}`);
    } catch (err) {
      const msg = `Failed to create relation type "${rt.typeName}": ${describeApiError(err)}`;
      logger.warn(msg);
      result.warnings.push(msg);
    }
  }

  logger.info("Graph relations applied", {
    created: result.created,
    skipped: result.skipped,
    warnings: result.warnings.length,
  });
  return result;
}
