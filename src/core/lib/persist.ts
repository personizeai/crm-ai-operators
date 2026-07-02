import type { DeclaredRelation } from "@personize/sdk";
import { client } from "../config.js";
import { logger } from "./logger.js";
import { retrieveRecord } from "./recall.js";
import { validateRelations } from "./graph.js";

// -----------------------------------------------------------------------------
// persist — unified-Save write helpers (built on memory.upsert, SDK 0.16.0).
//
// `client.memory.upsert` is the dedicated structured-entity write: no-AI,
// verbatim, create-or-merge keyed by identity (recordId | email | websiteUrl |
// customKey). It supersedes the pre-0.14 memory.store / batchStore /
// updateProperty surface (and the deprecated memorizeBatch). Verified live:
//   - keyed by email/recordId/websiteUrl; merges into existing records
//   - requires a collectionId or collectionName per write (won't infer)
//   - property values must be strings (or { value, collectionName } envelopes)
//   - ASYNC — returns a jobId and is eventually consistent (no read-after-write)
//
// The target collection + its properties must already exist (created by setup).
//
// upsert is verbatim SET/merge, so array-append (the old operation:"push") is
// NOT an upsert — it routes to memory.update({ arrayPush }), which needs a
// recordId (resolved here via retrieveRecord). All helpers fail soft.
//
// Graph edges (Channel A): a write may carry `relations` — caller-declared edges
// (contact works_at company, signal mentions contact, …). The v1 upsert above
// runs on the Dynamo backend, which has NO graph support, so a relation-bearing
// write is routed through `client.v1_1.memory.upsert` instead (the only path
// that persists declared edges). Edges are validated against the org relation
// registry first (see graph.ts); if none survive validation — or v1.1 is
// unavailable — the write falls back to the plain v1 path with no change in
// behavior. Properties are written identically either way.
// -----------------------------------------------------------------------------

/** Map an entity `type` to its default collection slug (matches the manifests). */
const SLUG_FOR_TYPE: Record<string, string> = {
  contact: "contacts",
  company: "companies",
  conversation: "conversations",
  signal: "signals",
  project: "projects",
  task: "tasks",
};

export interface WriteTarget {
  /** Entity type: "contact" | "company" | "conversation" | "signal" | "project" | "task". */
  type: string;
  recordId?: string;
  email?: string;
  websiteUrl?: string;
  /** Collection slug or name. Defaults to the collection for `type`. */
  collection?: string;
  /**
   * Caller-declared graph edges (Channel A) to write from this record. When any
   * survive registry validation, the write routes through v1.1 so the edges are
   * persisted; otherwise it uses the plain v1 path unchanged.
   */
  relations?: DeclaredRelation[];
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function coerce(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

// Memoized collection slug/name -> id resolution (one collections.list per process).
let _collIndex: Map<string, string> | undefined;
async function collectionIndex(): Promise<Map<string, string>> {
  if (_collIndex) return _collIndex;
  const idx = new Map<string, string>();
  try {
    const res = await (client as any).collections?.list?.();
    for (const c of res?.data ?? []) {
      if (c?.id && typeof c.slug === "string") idx.set(c.slug.toLowerCase(), c.id);
      if (c?.id && typeof c.name === "string") idx.set(c.name.toLowerCase(), c.id);
    }
  } catch {
    /* fail soft — fall back to collectionName on the upsert payload */
  }
  _collIndex = idx;
  return idx;
}

/** Resolve `{ collectionId?, collectionName }` for a target. collectionName is always set as a fallback. */
async function resolveCollection(target: WriteTarget): Promise<{ collectionId?: string; collectionName: string }> {
  const collectionName = target.collection ?? SLUG_FOR_TYPE[target.type] ?? target.type;
  const collectionId = (await collectionIndex()).get(collectionName.toLowerCase());
  return { collectionId, collectionName };
}

function identityFields(target: WriteTarget): Record<string, string> {
  const id: Record<string, string> = {};
  if (target.recordId) id.recordId = target.recordId;
  if (target.email) id.email = target.email;
  if (target.websiteUrl) id.websiteUrl = target.websiteUrl;
  return id;
}

/** Identity → v1.1 `matchKeys`. Same fields the v1 path keys on. */
function matchKeysFor(id: { recordId?: string; email?: string; websiteUrl?: string }): Record<string, string> {
  const keys: Record<string, string> = {};
  if (id.recordId) keys.recordId = id.recordId;
  if (id.email) keys.email = id.email;
  if (id.websiteUrl) keys.websiteUrl = id.websiteUrl;
  return keys;
}

/** Wrap verbatim string props as v1.1 `{ value, collectionName }` envelopes (collection-steering). */
function toEnvelopes(props: Record<string, string>, collectionName: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) out[k] = { value: v, collectionName };
  return out;
}

/**
 * Route a single relation-bearing write through v1.1 so declared edges persist.
 * Returns `true`/`false` when it handled the write, or `null` when the caller
 * should fall back to the v1 path (v1.1 unavailable, or no edge survived
 * registry validation — so there's no reason to leave the fast v1 path).
 */
async function upsertWithRelations(
  target: WriteTarget,
  props: Record<string, string>,
  collectionName: string,
): Promise<boolean | null> {
  if (!target.relations?.length) return null;
  const v11 = (client as any).v1_1?.memory;
  if (typeof v11?.upsert !== "function") return null;

  const relations = await validateRelations(target.type, target.relations);
  if (relations.length === 0) return null;

  try {
    await v11.upsert({
      type: target.type,
      matchKeys: matchKeysFor(target),
      properties: toEnvelopes(props, collectionName),
      relations,
      source: "crm-ai-operators",
    });
    logger.info("persist: wrote record + declared edges via v1.1", {
      type: target.type,
      edges: relations.map((r) => r.relationType),
    });
    return true;
  } catch (error) {
    logger.warn("persist.upsertWithRelations failed", { type: target.type, error: errMsg(error) });
    return false;
  }
}

/**
 * Set one or more properties on a record (verbatim, no AI) — create-or-merge by
 * identity. Replaces `memory.store(...)` and `memory.updateProperty({ operation: "set" })`.
 */
export async function setProperties(target: WriteTarget, properties: Record<string, unknown>): Promise<boolean> {
  const memory = (client as any).memory;
  if (typeof memory?.upsert !== "function") {
    logger.warn("persist.setProperties: memory.upsert unavailable; skipping", { type: target.type });
    return false;
  }
  const props: Record<string, string> = {};
  for (const [k, v] of Object.entries(properties)) {
    if (v === undefined || v === null) continue;
    props[k] = coerce(v);
  }
  if (Object.keys(props).length === 0) return true;

  const { collectionId, collectionName } = await resolveCollection(target);

  // Relation-bearing writes route through v1.1 so declared edges persist; a
  // null result means "fall back to the v1 path" (no valid edges / v1.1 absent).
  const routed = await upsertWithRelations(target, props, collectionName);
  if (routed !== null) return routed;

  try {
    await memory.upsert({
      ...identityFields(target),
      type: target.type,
      ...(collectionId ? { collectionId } : { collectionName }),
      properties: props,
    });
    return true;
  } catch (error) {
    logger.warn("persist.setProperties failed", { type: target.type, error: errMsg(error) });
    return false;
  }
}

/** Set a single property (verbatim). Replaces `memory.updateProperty({ operation: "set" })`. */
export async function setProperty(target: WriteTarget, propertyName: string, value: unknown): Promise<boolean> {
  return setProperties(target, { [propertyName]: value });
}

export interface SaveRecordInput {
  recordId?: string;
  email?: string;
  websiteUrl?: string;
  properties: Record<string, unknown>;
  /** Per-record caller-declared graph edges (Channel A). See WriteTarget.relations. */
  relations?: DeclaredRelation[];
}

/**
 * Batch create/merge records with structured properties in one call.
 * Replaces `memory.batchStore({ collectionSlug, records })`.
 */
export async function saveRecords(type: string, collection: string, records: SaveRecordInput[]): Promise<number> {
  const memory = (client as any).memory;
  if (records.length === 0) return 0;
  if (typeof memory?.upsert !== "function") {
    logger.warn("persist.saveRecords: memory.upsert unavailable; skipping", { collection });
    return 0;
  }
  const { collectionId, collectionName } = await resolveCollection({ type, collection });
  const collField = collectionId ? { collectionId } : { collectionName };

  const coerced = records.map((r) => {
    const props: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.properties)) {
      if (v === undefined || v === null) continue;
      props[k] = coerce(v);
    }
    return { input: r, props };
  });

  // If any record declares edges, route the whole batch through v1.1 so those
  // edges persist; edges are validated per-record and non-declaring records ride
  // along unchanged. With no declared edges we stay on the plain v1 batch path.
  if (records.some((r) => r.relations?.length)) {
    const v11 = (client as any).v1_1?.memory;
    if (typeof v11?.upsert === "function") {
      const items = await Promise.all(
        coerced.map(async ({ input, props }) => ({
          matchKeys: matchKeysFor(input),
          properties: toEnvelopes(props, collectionName),
          relations: await validateRelations(type, input.relations),
        })),
      );
      try {
        await v11.upsert({ type, items, source: "crm-ai-operators" });
        logger.info("persist: wrote batch + declared edges via v1.1", { type, count: items.length });
        return records.length;
      } catch (error) {
        logger.warn("persist.saveRecords (v1.1) failed", { collection, count: records.length, error: errMsg(error) });
        return 0;
      }
    }
  }

  const items = coerced.map(({ input, props }) => ({
    ...(input.recordId ? { recordId: input.recordId } : {}),
    ...(input.email ? { email: input.email } : {}),
    ...(input.websiteUrl ? { websiteUrl: input.websiteUrl } : {}),
    type,
    ...collField,
    properties: props,
  }));

  try {
    await memory.upsert({ items });
    return records.length;
  } catch (error) {
    logger.warn("persist.saveRecords failed", { collection, count: records.length, error: errMsg(error) });
    return 0;
  }
}

/**
 * Append a value to an array property. Replaces `memory.updateProperty({ operation: "push" })`.
 * upsert is verbatim-set, so this uses `memory.update({ arrayPush })`, which needs a recordId —
 * resolved from email/websiteUrl when not supplied.
 */
export async function appendToProperty(target: WriteTarget, propertyName: string, value: unknown): Promise<boolean> {
  const memory = (client as any).memory;
  if (typeof memory?.update !== "function") return false;
  let recordId = target.recordId;
  if (!recordId) {
    const rec = await retrieveRecord({ email: target.email, websiteUrl: target.websiteUrl, type: target.type });
    const id = rec?.record_id;
    if (typeof id === "string") recordId = id;
  }
  if (!recordId) {
    logger.warn("persist.appendToProperty: record not found; skipping", { type: target.type, propertyName });
    return false;
  }
  try {
    await memory.update({ recordId, type: target.type, propertyName, arrayPush: { items: [value], unique: true } });
    return true;
  } catch (error) {
    logger.warn("persist.appendToProperty failed", { type: target.type, propertyName, error: errMsg(error) });
    return false;
  }
}
