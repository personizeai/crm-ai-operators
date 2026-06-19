import { client } from "../config.js";
import { logger } from "./logger.js";
import { retrieveRecord } from "./recall.js";

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

  const items = records.map((r) => {
    const props: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.properties)) {
      if (v === undefined || v === null) continue;
      props[k] = coerce(v);
    }
    return {
      ...(r.recordId ? { recordId: r.recordId } : {}),
      ...(r.email ? { email: r.email } : {}),
      ...(r.websiteUrl ? { websiteUrl: r.websiteUrl } : {}),
      type,
      ...collField,
      properties: props,
    };
  });

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
