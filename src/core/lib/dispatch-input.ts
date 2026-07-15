import { compileFilter, parseFilterInput, type Filter } from "./filter.js";
import { retrieveRecords, retrieveRecord } from "./recall.js";

// -----------------------------------------------------------------------------
// dispatch-input — reconcile the dispatcher's operation input contract with an
// operation's own filter recall.
//
// The dispatcher hands an operation one of three input shapes:
//   1. batch      (dispatch_mode: "batch")   → { records: [...] }  — the full,
//                                               already-filtered set, preloaded.
//   2. per-record (parallel/sequential/chain) → { email }          — one entity
//                                               identity (extractEmail returns
//                                               email | contact_email | record_id).
//   3. standalone (CLI / cron / direct call)  → { filter } | {}     — a
//                                               declarative filter, or nothing.
//
// A self-recall operation that only read { filter } silently dropped the route's
// filter under shapes 1 and 2 and ran its own DEFAULT_FILTER instead — scoring
// the wrong set (see docs/DISPATCH-ROUTES.md). resolveOperationRecords is the
// `preloaded ?? recalled` reconciliation sync.call-transcripts-bulk pioneered,
// generalized so batch AND per-record dispatch both reach the operation.
// -----------------------------------------------------------------------------

interface OperationInput {
  records?: Record<string, unknown>[];
  email?: string;
  filter?: Filter;
}

export interface ResolveRecordsOptions {
  /** The raw `input` the operation's run() received. */
  input: unknown;
  /** Registered entity type to recall (e.g. "contact", "company", "conversation"). */
  type: string;
  /** The operation's own filter — used only in standalone mode when no dispatcher input is present. */
  defaultFilter: Filter;
  /**
   * Recall key the single per-record identity maps to for this entity:
   *   "email"    — contact/conversation ops (the dispatcher sends the contact email)
   *   "recordId" — company ops (extractEmail returns the company's record_id, not an email)
   *   "websiteUrl" — ops keyed by domain
   * Omit to disable the per-record path (batch + standalone only) — correct for
   * ops whose per-record identity selects child records rather than the record
   * itself (e.g. analyze.* over a contact's conversations).
   */
  singleKey?: "email" | "recordId" | "websiteUrl";
}

/**
 * Resolve the record set an operation should process, honoring the dispatcher's
 * input contract before falling back to the operation's own filter recall:
 *
 *   1. batch      → input.records                    (preloaded; skip recall)
 *   2. per-record → input.email (when singleKey set) (recall exactly that record)
 *   3. standalone → input.filter ?? defaultFilter    (own recall)
 *
 * Fails soft to [] (each underlying recall does too).
 */
export async function resolveOperationRecords(
  opts: ResolveRecordsOptions,
): Promise<Record<string, unknown>[]> {
  const input = (opts.input ?? {}) as OperationInput;

  // 1. Batch: the dispatcher already recalled the route's filtered set — use it
  //    verbatim and skip our own recall (the N+1 elimination).
  if (Array.isArray(input.records)) return input.records;

  // 2. Per-record: recall exactly the one record the route selected, so the op
  //    acts on it — not on its own default set. Skipped when singleKey is unset.
  if (opts.singleKey && typeof input.email === "string" && input.email.length > 0) {
    const rec = await retrieveRecord({ [opts.singleKey]: input.email, type: opts.type });
    return rec ? [rec] : [];
  }

  // 3. Standalone: the operation's own filter recall (CLI / cron / default).
  const filter = parseFilterInput(input) ?? opts.defaultFilter;
  const compiled = compileFilter(filter);
  return retrieveRecords({
    type: opts.type,
    conditions: compiled.conditions,
    logic: compiled.logic,
    limit: compiled.limit,
  });
}
