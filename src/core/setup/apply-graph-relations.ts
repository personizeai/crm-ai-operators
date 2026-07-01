import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { client } from "../config.js";
import { logger } from "../lib/logger.js";

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
}

function relationKey(r: GraphRelation): string {
  return `${r.fromType}::${r.relation}::${r.toType}`;
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

export async function applyGraphRelations(dryRun: boolean): Promise<ApplyGraphRelationsResult> {
  const result: ApplyGraphRelationsResult = { created: 0, skipped: 0, details: [] };

  const desired = await loadGraphRelations().catch(() => {
    logger.info("No graph-relations manifest found; skipping");
    return [] as GraphRelation[];
  });
  if (desired.length === 0) return result;

  const existingRes = await (client as any).context?.list?.({ type: "graph-relation" }).catch(() => null);
  const existingKeys = new Set<string>(
    (existingRes?.data ?? []).map((item: any) => `${item.fromType}::${item.relation}::${item.toType}`)
  );

  for (const rel of desired) {
    const key = relationKey(rel);
    if (existingKeys.has(key)) {
      result.skipped++;
      result.details.push(`Graph relation exists: ${key}`);
      continue;
    }
    if (dryRun) { result.created++; result.details.push(`[DRY RUN] Would create graph relation: ${key}`); continue; }
    await (client as any).context.create({ type: "graph-relation", ...rel });
    result.created++;
    result.details.push(`Created graph relation: ${key}`);
  }

  logger.info("Graph relations applied", { created: result.created, skipped: result.skipped });
  return result;
}
