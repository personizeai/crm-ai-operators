import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { logger } from "../lib/logger.js";
import { retrieveRecords } from "../lib/recall.js";
import { setProperties } from "../lib/persist.js";
import { resolveOverlayFiles, type ManifestFile } from "./apply-manifests.js";

// -----------------------------------------------------------------------------
// applyDispatchRoutes — publishes manifests/core/dispatch-routes/*.json (one
// route per file, git-ignored manifests/local/ overlay wins on name collision)
// into the "dispatch-routes" Personize collection, so routing logic is repo
// content like guidelines — edit a file, run `setup apply`, done. The engine
// re-reads routes from Personize on every dispatch cycle (dispatcher.ts
// loadDispatchRoutes), so publishing here never requires an engine redeploy.
//
// `filter` is authored as a plain object (the raw Filter shape compileFilter
// expects) for readability; it is JSON-stringified into `filter_json` on write,
// matching what the dispatcher reads back.
// -----------------------------------------------------------------------------

const FilterSchema = z.object({
  collection: z.string(),
  where: z.record(z.unknown()).optional(),
  limit: z.number().optional(),
});

const DispatchRouteManifestSchema = z.object({
  route_id: z.string().regex(/^route_[a-z0-9_]+$/, "route_id must be route_<snake_case>"),
  priority: z.number(),
  name: z.string(),
  description: z.string().optional(),
  enabled: z.boolean().default(true),
  filter: FilterSchema,
  target_type: z.enum(["operation", "subagent", "task", "triage"]),
  target_name: z.string().optional(),
  instructions_name: z.string().optional(),
  target_chain: z.array(z.string()).optional(),
  max_per_cycle: z.number().optional(),
  parallel: z.boolean().optional(),
  concurrency: z.number().optional(),
  dispatch_mode: z.enum(["per_record", "batch"]).optional(),
  tier_override: z.string().optional(),
  model_override: z.string().optional(),
});

type DispatchRouteManifest = z.infer<typeof DispatchRouteManifestSchema>;

export interface ApplyDispatchRoutesResult {
  created: number;
  updated: number;
  skipped: number;
  details: string[];
}

const MANIFEST_DIR = path.join(process.cwd(), "manifests");
const CORE_DIR = path.join(MANIFEST_DIR, "core");
const LOCAL_DIR = path.join(MANIFEST_DIR, "local");

/** Coerce a value the same way persist.ts does before writing, so diffs compare like-for-like. */
function coerce(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Route fields that become the Personize record's properties (route_id is the identity key, not a property write). */
function toRecordProperties(route: DispatchRouteManifest): Record<string, unknown> {
  const { route_id, filter, ...rest } = route;
  return { ...rest, filter_json: JSON.stringify(filter) };
}

/** Stable, coerced signature of a route's properties for change detection (ignores timestamps). */
function signature(properties: Record<string, unknown>): string {
  const keys = Object.keys(properties).sort();
  return JSON.stringify(keys.map((k) => [k, coerce(properties[k])]));
}

async function loadRouteFiles(files: ManifestFile[]): Promise<DispatchRouteManifest[]> {
  const out: DispatchRouteManifest[] = [];
  for (const file of files) {
    const raw = JSON.parse(await readFile(file.fullPath, "utf8"));
    const parsed = DispatchRouteManifestSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `Invalid dispatch route manifest ${file.name}: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      );
    }
    out.push(parsed.data);
  }
  return out;
}

export async function applyDispatchRoutes(dryRun: boolean): Promise<ApplyDispatchRoutesResult> {
  const result: ApplyDispatchRoutesResult = { created: 0, updated: 0, skipped: 0, details: [] };

  const files = await resolveOverlayFiles([CORE_DIR, LOCAL_DIR], "dispatch-routes", ".json");
  if (files.length === 0) return result;

  const desired = await loadRouteFiles(files);

  const existing = await retrieveRecords({ type: "dispatch_route", limit: 200 }).catch(() => []);
  const existingByRouteId = new Map<string, Record<string, unknown>>(
    existing
      .filter((r) => typeof r.route_id === "string")
      .map((r) => [r.route_id as string, r]),
  );

  for (const route of desired) {
    const props = toRecordProperties(route);
    const existingRoute = existingByRouteId.get(route.route_id);

    if (existingRoute) {
      const existingProps = { ...existingRoute };
      delete existingProps.route_id;
      delete existingProps.created_at;
      delete existingProps.updated_at;
      delete existingProps.record_id;
      delete existingProps.entity_type;

      if (signature(props) === signature(existingProps)) {
        result.skipped++;
        result.details.push(`Route up-to-date: ${route.route_id}`);
        continue;
      }

      if (dryRun) {
        result.updated++;
        result.details.push(`[DRY RUN] Would update route: ${route.route_id}`);
        continue;
      }

      await setProperties(
        { type: "dispatch_route", collection: "dispatch-routes", recordId: route.route_id },
        { route_id: route.route_id, ...props, updated_at: new Date().toISOString() },
      );
      result.updated++;
      result.details.push(`Updated route: ${route.route_id}`);
      continue;
    }

    if (dryRun) {
      result.created++;
      result.details.push(`[DRY RUN] Would create route: ${route.route_id}`);
      continue;
    }

    const now = new Date().toISOString();
    await setProperties(
      { type: "dispatch_route", collection: "dispatch-routes", recordId: route.route_id },
      { route_id: route.route_id, ...props, created_at: now, updated_at: now },
    );
    result.created++;
    result.details.push(`Created route: ${route.route_id}`);
  }

  logger.info("Dispatch routes applied", { created: result.created, updated: result.updated, skipped: result.skipped });
  return result;
}
