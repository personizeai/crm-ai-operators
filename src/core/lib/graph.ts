import type { DeclaredRelation, RelationType } from "@personize/sdk";
import { client } from "../config.js";
import { logger } from "./logger.js";

// -----------------------------------------------------------------------------
// graph — registry-driven declared-edge (Channel A) support for the save path.
//
// Edges are NOT auto-inferred: a write must carry `relations[]` AND route
// through the v1.1 pipeline for the graph to be built (the v1 Dynamo backend
// this repo writes through has no graph support). This module fetches the org's
// relation registry once, then validates caller-declared edges against it so we
// only ever send edges the resolver will accept:
//
//   - relationType must exist in the registry and be active
//   - the writing record's entity type must be in the type's allowedFromTypes
//   - the target entity type (when known) must be in allowedToTypes
//
// Anything else is dropped (and logged), never sent. If the registry can't be
// loaded, NO edges are declared — the write falls back to the plain v1 path with
// no behavioral change. See persist.ts for the routing.
// -----------------------------------------------------------------------------

export type { DeclaredRelation };

/**
 * Reference constants for common relation type names, verified against the live
 * org registry (`graph.getConfig()`, 22 system types on the .env org). No
 * operation hardwires edges today — the assistant declares them per the save
 * protocol (AGENTS.md) — but code that DOES declare an edge should use these so
 * the name matches the registry. Every value is still re-validated at write time.
 *
 * Note on entity coverage: the registry models standard CRM entities (contact,
 * company, deal, meeting, call, ticket, memory). Repo-only types (signal,
 * conversation, project, task) are NOT modeled, so they can only appear in
 * any-type relations (`from:[]`/`to:[]`, e.g. relates_to, mentioned_in) and get
 * no Channel-B rules. Prefer contact/company/deal edges, which are first-class.
 */
export const REL = {
  /** contact → company (person employed by an org). Also auto-built by the
   *  system rule `contact.company_domain → works_at`. */
  WORKS_AT: "works_at",
  /** any → contact|company (an activity/record references an entity). from:[] any. */
  MENTIONED_IN: "mentioned_in",
  /** any → any (generic association when no stronger type fits). */
  RELATES_TO: "relates_to",
} as const;

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Process-level cache: one registry fetch per process. The registry is small and
// changes rarely; call resetRelationRegistryCache() in tests to force a reload.
let _registry: Promise<Map<string, RelationType>> | undefined;

async function fetchRegistry(): Promise<Map<string, RelationType>> {
  const byName = new Map<string, RelationType>();
  const memory = (client as any).v1_1?.memory;
  if (!memory) {
    logger.warn("graph: v1.1 memory surface unavailable; declared edges disabled");
    return byName;
  }
  try {
    let items: RelationType[] = [];
    // Prefer the full snapshot (types + rules + settings); fall back to the
    // relation-types list. Both include system built-ins ⊕ per-org types.
    if (typeof memory.graph?.getConfig === "function") {
      const res = await memory.graph.getConfig();
      items = res?.data?.relationTypes ?? [];
    } else if (typeof memory.listRelationTypes === "function") {
      const res = await memory.listRelationTypes({ includeSystem: true });
      items = res?.data?.items ?? [];
    }
    for (const t of items) {
      if (t?.typeName) byName.set(t.typeName, t);
    }
    logger.info("graph: relation registry loaded", { count: byName.size });
  } catch (error) {
    logger.warn("graph: relation registry fetch failed; declared edges disabled", { error: errMsg(error) });
  }
  return byName;
}

/** The org's relation registry keyed by `typeName`. Cached per process, fail-soft to empty. */
export function getRelationRegistry(): Promise<Map<string, RelationType>> {
  if (!_registry) _registry = fetchRegistry();
  return _registry;
}

/** Clear the cached registry (tests). */
export function resetRelationRegistryCache(): void {
  _registry = undefined;
}

export interface DroppedRelation {
  relation: DeclaredRelation;
  reason: "unknown-type" | "inactive" | "from-type-not-allowed" | "to-type-not-allowed";
}

/**
 * Pure validation: keep only edges the resolver will accept, given a registry.
 * Separated from I/O so it's directly unit-testable. An empty registry drops
 * everything (nothing is known to be valid).
 */
export function filterRelations(
  registry: Map<string, RelationType>,
  fromEntityType: string,
  relations: DeclaredRelation[] | undefined,
): { valid: DeclaredRelation[]; dropped: DroppedRelation[] } {
  const valid: DeclaredRelation[] = [];
  const dropped: DroppedRelation[] = [];
  if (!relations?.length) return { valid, dropped };

  const from = fromEntityType?.toLowerCase();
  for (const relation of relations) {
    const def = registry.get(relation.relationType);
    if (!def) {
      dropped.push({ relation, reason: "unknown-type" });
      continue;
    }
    if (def.isActive === false) {
      dropped.push({ relation, reason: "inactive" });
      continue;
    }
    // Empty allow-lists mean "any type is allowed".
    const fromAllowed = def.allowedFromTypes ?? [];
    if (fromAllowed.length > 0 && !fromAllowed.map((t) => t.toLowerCase()).includes(from)) {
      dropped.push({ relation, reason: "from-type-not-allowed" });
      continue;
    }
    const toType = relation.toEntityType?.toLowerCase();
    const toAllowed = def.allowedToTypes ?? [];
    if (toType && toAllowed.length > 0 && !toAllowed.map((t) => t.toLowerCase()).includes(toType)) {
      dropped.push({ relation, reason: "to-type-not-allowed" });
      continue;
    }
    valid.push(relation);
  }
  return { valid, dropped };
}

/**
 * Fetch the registry and return the caller-declared edges that are valid for a
 * record of `fromEntityType`. Dropped edges are logged, never sent. Fails soft
 * to `[]` so a graph outage never blocks a property write.
 */
export async function validateRelations(
  fromEntityType: string,
  relations: DeclaredRelation[] | undefined,
): Promise<DeclaredRelation[]> {
  if (!relations?.length) return [];
  const registry = await getRelationRegistry();
  const { valid, dropped } = filterRelations(registry, fromEntityType, relations);
  if (dropped.length > 0) {
    logger.warn("graph: dropped invalid declared edges", {
      fromEntityType,
      dropped: dropped.map((d) => ({ relationType: d.relation.relationType, reason: d.reason })),
    });
  }
  return valid;
}

/**
 * Fetch the registry and split proposed edges into valid/dropped WITHOUT sending
 * anything. This is the assistant-facing "check my edges" call behind the
 * `relations_validate` MCP tool / `relations validate` CLI command — it lets the
 * AI polish its declared-edge payload before it saves.
 */
export async function checkRelations(
  fromEntityType: string,
  relations: DeclaredRelation[] | undefined,
): Promise<{ valid: DeclaredRelation[]; dropped: DroppedRelation[] }> {
  const registry = await getRelationRegistry();
  return filterRelations(registry, fromEntityType, relations);
}

/** One row of the assistant-facing relation catalog. */
export interface RelationCatalogEntry {
  relationType: string;
  /** Allowed source entity types; `[]` means any. */
  from: string[];
  /** Allowed target entity types; `[]` means any. */
  to: string[];
  symmetric: boolean;
  category: string;
  description: string | null;
}

/**
 * The org's active relation types in a compact shape for the AI to read BEFORE
 * declaring edges — behind the `relation_types` MCP tool / `relations list` CLI
 * command. This is the "fetch allowed relations" half of the save protocol.
 */
export async function getRelationCatalog(): Promise<RelationCatalogEntry[]> {
  const registry = await getRelationRegistry();
  return [...registry.values()]
    .filter((t) => t.isActive !== false)
    .map((t) => ({
      relationType: t.typeName,
      from: t.allowedFromTypes ?? [],
      to: t.allowedToTypes ?? [],
      symmetric: Boolean(t.isSymmetric),
      category: t.category,
      description: t.description ?? null,
    }))
    .sort((a, b) => a.relationType.localeCompare(b.relationType));
}
