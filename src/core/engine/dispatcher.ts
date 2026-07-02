import { z } from "zod";
import { logger } from "../lib/logger.js";
import { runWithConcurrency } from "../lib/concurrency.js";
import { retrieveRecords } from "../lib/recall.js";
import { compileFilter, type CompiledFilter } from "../lib/filter.js";
import { createTask } from "../lib/tasks.js";
import { isDryRun } from "../lib/dry-run.js";
import { ai, type Tier } from "../lib/ai.js";
import { loadGuideline } from "../lib/governance.js";
import { OPERATIONS } from "../operations/registry.js";
import { runOperation } from "../runtime/operation-runner.js";
import {
  getOrchestratorConfig,
  bumpOrchestratorError,
  resetOrchestratorErrors,
  writeOrchestratorLog,
} from "./orchestrator.js";

export interface IncomingEvent {
  event_id: string;
  event_type: string;
  entity_email?: string;
  entity_type_ref?: string;
  payload?: unknown;
  received_at: string;
}

// ---------------------------------------------------------------------------
// DispatchRoute — stored in the "dispatch-routes" Personize collection.
//
// Re-run prevention strategy (filter-based, no operation-run table needed):
//   Include a staleness condition in filter_json so only records that NEED
//   processing are fetched. Example — skip contacts updated in the last 60d:
//   { "collection": "contact", "where": { "job_title_updated_at": { "lt": "now-60d" } } }
//   The skip_if rule inside each operation is a second-line defence for cases
//   where the filter cannot express the staleness logic (e.g. enum checks).
//   At scale, the filter approach is far cheaper: Personize evaluates it
//   server-side (indexed) so you only dispatch what actually needs work,
//   rather than dispatching everything and paying per-record recall to skip.
//
// Dispatch execution patterns — choose one per route:
//
//   sequential (default, dispatch_mode unset, parallel: false):
//     One operation call per record, one at a time. Errors stay isolated,
//     rate limits are respected, maxPerCycle is a hard cap.
//     Best for: writes to shared state, high-cost AI, predictable throughput.
//
//   parallel (parallel: true):
//     One operation call per record, all records run concurrently via
//     Promise.allSettled. Wall-clock = slowest record, not sum of all.
//     One failure does not cancel the rest.
//     Best for: independent per-record ops (research, enrichment, scoring).
//
//   batch (dispatch_mode: "batch"):
//     ONE operation call receives the FULL record list as input.records[].
//     Eliminates the N+1 recall problem — the dispatcher fetches records once
//     and passes them directly; the operation skips its own recall.
//     One failure = all records fail (operation is atomic in this mode).
//     parallel is ignored in batch mode (there is only one call).
//     Only works with target_type: "operation".
//     Best for: bulk AI extraction (sync.call-transcripts-bulk), aggregate
//     reports, any operation that processes all records in one shot.
//
// Tier/model override:
//   Set tier_override or model_override on a route to control cost without
//   touching operation code. The operation falls back to its own default when
//   the route provides nothing. Example: route a "quick-scan" route to
//   tier_override: "basic" and the high-priority research route to
//   tier_override: "ultra".
// ---------------------------------------------------------------------------

interface DispatchRoute {
  route_id: string;
  priority: number;
  name: string;
  enabled: boolean | string;
  filter_json: string;
  target_type: "operation" | "subagent" | "task" | "triage";
  target_name: string;
  instructions_name?: string;
  /**
   * Per-record operation chain: each record flows through these operations in order,
   * stopping at the first that reports ok:false. Overrides target_type/target_name.
   * Chains are inherently per-record — ignored (with a warning) in batch mode.
   * Example: ["research.contact-background", "score.lead-quality", "generate.outreach-sequence"]
   */
  target_chain?: string[];
  max_per_cycle?: number;
  /** When true, records within this route are dispatched concurrently. Ignored in batch mode. */
  parallel?: boolean;
  /** Max simultaneous operations in parallel mode. Default 8. Caps SDK/API pressure per route. */
  concurrency?: number;
  /**
   * How records are handed to the operation.
   * - "per_record" (default): one runOperation call per record, input = { email }.
   * - "batch": one runOperation call for all records, input = { records: [...] }.
   *            Only valid with target_type: "operation". Falls back to sequential if not.
   */
  dispatch_mode?: "per_record" | "batch";
  /** Override the AI tier for all operations dispatched by this route. */
  tier_override?: string;
  /** Override the AI model for all operations dispatched by this route (BYOK). */
  model_override?: string;
  [key: string]: unknown;
}

export interface DispatchResult {
  event_id: string;
  routes_evaluated: number;
  leads_claimed: number;
  dispatched: number;
  errors: number;
  skipped_paused: boolean;
  dry_run: boolean;
  duration_ms: number;
}

async function loadDispatchRoutes(): Promise<DispatchRoute[]> {
  try {
    // type = "dispatch_route" is the entity type registered in entity-types.json
    // retrieveRecords uses crmFilter.type to route to the dispatch-routes collection
    const res = await retrieveRecords({
      type: "dispatch_route",
      conditions: [{ propertyName: "enabled", operator: "equals", value: true }],
      logic: "AND",
      limit: 100,
    });
    const routes = (res as DispatchRoute[]).filter((r) => r.enabled === true || r.enabled === "true");
    return routes.sort((a, b) => Number(a.priority ?? 99) - Number(b.priority ?? 99));
  } catch {
    return [];
  }
}

function extractEmail(record: Record<string, unknown>): string | undefined {
  return (record.email ?? record.contact_email ?? record.record_id) as string | undefined;
}

async function routeToOperation(
  targetName: string,
  email: string,
  dryRun: boolean,
  tierOverride?: string,
  modelOverride?: string,
): Promise<void> {
  // Unknown operation = configuration error; throw so caller increments errors + claims nothing
  if (!OPERATIONS[targetName]) {
    throw new Error(`Unknown operation: ${targetName}`);
  }
  if (dryRun) {
    logger.info("[DRY RUN] Would run operation", { operation: targetName, email });
    return;
  }
  // runOperation(name, input, options) — handles runId + dryRun internally.
  // Operations report internal failures by RETURNING ok:false (not throwing) —
  // treat that as failure too, so the email is not claimed and errors are counted.
  const result = await runOperation(targetName, { email }, { tierOverride, modelOverride });
  if (!result.ok) {
    throw new Error(`Operation ${targetName} reported failure: ${result.summary ?? "no summary"}`);
  }
}

async function routeToTask(
  targetName: string,
  email: string,
  routeName: string,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) {
    logger.info("[DRY RUN] Would create task", { task_type: targetName, email });
    return;
  }
  await createTask({
    title: `${routeName}: ${email}`,
    task_type: targetName,
    assigned_to: "agent",
    priority: "medium",
    custom_key_name: "email",
    custom_key_value: email,
    created_by: "dispatcher",
  });
}

// Generic result envelope for a subagent-target route. The guideline named by
// instructions_name is the actual behavior; this schema just captures what it did.
const SubagentResultSchema = z.object({
  summary: z.string().describe("What was done for this record"),
  actions_taken: z.array(z.string()).optional().describe("Concrete actions the subagent took"),
});

// ---------------------------------------------------------------------------
// routeToSubagent — real implementation of target_type: "subagent".
// Loads the route's instructions_name guideline as the behavior spec and runs an
// autonomous agent (tools on) against the record. Replaces the former task stub.
// ---------------------------------------------------------------------------
async function routeToSubagent(route: DispatchRoute, email: string, dryRun: boolean): Promise<void> {
  if (dryRun) {
    logger.info("[DRY RUN] Would run subagent", { route: route.name, email });
    return;
  }
  if (!route.instructions_name) {
    throw new Error(`Subagent route ${route.name} requires instructions_name (the guideline to run).`);
  }
  const instructions = await loadGuideline(route.instructions_name);
  if (!instructions) {
    throw new Error(
      `Subagent route ${route.name}: guideline '${route.instructions_name}' not found. Run setup.apply to install it.`,
    );
  }
  await ai({
    autonomous: true,
    instructions:
      `${instructions}\n\n---\n\nApply the guidance above to the record identified by ${email}. ` +
      `Use your tools to gather what you need, then act. Summarize what you did.`,
    outputs: SubagentResultSchema,
    memorize: { email, type: "Contact" },
    tier: (route.tier_override as Tier | undefined) ?? "pro",
    model: route.model_override,
    metadata: { recordId: email },
  });
}

// ---------------------------------------------------------------------------
// runChain — per-record operation pipeline. Each record flows through every
// operation in target_chain in order, stopping at the first ok:false.
//
// Re-run safety: a chain that stops midway does NOT claim the email, so the next
// cycle retries the whole chain. Earlier stages are idempotent and guarded by
// their own skip_if, so a re-run cheaply skips already-done stages rather than
// redoing work. A shared sessionId (deterministic per route+record) lets the
// backend maintain continuity across stages for operations that read input.sessionId.
// ---------------------------------------------------------------------------
async function runChain(route: DispatchRoute, email: string, dryRun: boolean): Promise<string> {
  const chain = route.target_chain ?? [];
  const sessionId = `chain_${route.route_id}_${email}`;
  for (const opName of chain) {
    if (!OPERATIONS[opName]) {
      throw new Error(`Unknown operation in chain ${route.name}: ${opName}`);
    }
    if (dryRun) {
      logger.info("[DRY RUN] Would run chain stage", { route: route.name, operation: opName, email });
      continue;
    }
    const result = await runOperation(
      opName,
      { email, sessionId },
      { tierOverride: route.tier_override, modelOverride: route.model_override },
    );
    if (!result.ok) {
      throw new Error(`Chain ${route.name} stopped at ${opName}: ${result.summary ?? "no summary"}`);
    }
  }
  return email;
}

// Triage decision: the agent picks one operation from the bounded menu, or "none".
const TriageDecisionSchema = z.object({
  operation: z.string().describe("The chosen operation name from the menu, or 'none'"),
  reason: z.string().describe("One sentence on why this operation (or why none)"),
});

// ---------------------------------------------------------------------------
// routeToTriage — agentic catch-all. Instead of a hardcoded target, a cheap-tier
// agent chooses the single most appropriate operation for THIS record from a
// bounded menu (the live operation registry), or "none". The decision + reason
// is logged, then execution proceeds through the normal deterministic runOperation
// path — so the choice is agentic but the execution and audit trail are not.
//
// Use as a priority-LAST route: deterministic routes handle everything they match;
// whatever falls through hits triage. Keep max_per_cycle small and tier cheap.
// ---------------------------------------------------------------------------
async function routeToTriage(
  route: DispatchRoute,
  record: Record<string, unknown>,
  email: string,
  dryRun: boolean,
): Promise<string> {
  const menu = Object.values(OPERATIONS)
    .filter((op) => op.mode === "operation" && op.status === "live")
    .map((op) => ({ name: op.name, description: op.description, cost: op.cost ?? "medium" }));

  if (dryRun) {
    logger.info("[DRY RUN] Would triage record", { route: route.name, email, menu_size: menu.length });
    return email;
  }

  const decision = await ai({
    instructions:
      `You are a CRM triage router. Choose the SINGLE most appropriate operation for this record ` +
      `from the menu, or "none" if no operation is warranted right now. Prefer the lowest-cost ` +
      `operation that meaningfully helps.\n\n` +
      `Record:\n${JSON.stringify(record, null, 2)}\n\n` +
      `Operation menu:\n${JSON.stringify(menu, null, 2)}`,
    outputs: TriageDecisionSchema,
    tier: (route.tier_override as Tier | undefined) ?? "basic",
    model: route.model_override,
    maxTokens: 300,
    metadata: { recordId: email },
  });

  const chosen = decision.output.operation;
  logger.info("Dispatcher: triage decision", {
    route: route.name,
    email,
    chosen,
    reason: decision.output.reason,
  });

  if (chosen === "none" || !OPERATIONS[chosen]) {
    // A logged "none" (or an unknown pick) is a valid outcome — nothing to run.
    return email;
  }

  const result = await runOperation(
    chosen,
    { email },
    { tierOverride: route.tier_override, modelOverride: route.model_override },
  );
  if (!result.ok) {
    throw new Error(`Triage-selected ${chosen} reported failure: ${result.summary ?? "no summary"}`);
  }
  return email;
}

// ---------------------------------------------------------------------------
// dispatchOne — shared dispatch logic so sequential and parallel paths call
// the same code. Returns the email on success (used by parallel path to claim).
// ---------------------------------------------------------------------------
async function dispatchOne(
  route: DispatchRoute,
  record: Record<string, unknown>,
  dryRun: boolean,
): Promise<string> {
  const email = extractEmail(record)!;
  // Triage picks the operation per record from a bounded menu (agentic catch-all).
  if (route.target_type === "triage") {
    return routeToTriage(route, record, email, dryRun);
  }
  // A chain takes precedence over a single target — it IS the per-record pipeline.
  if (route.target_chain?.length) {
    return runChain(route, email, dryRun);
  }
  if (route.target_type === "operation") {
    await routeToOperation(route.target_name, email, dryRun, route.tier_override, route.model_override);
  } else if (route.target_type === "task") {
    await routeToTask(route.target_name, email, route.name, dryRun);
  } else {
    await routeToSubagent(route, email, dryRun);
  }
  return email;
}

export async function dispatch(event: IncomingEvent): Promise<DispatchResult> {
  const start = Date.now();
  const dryRun = await isDryRun();
  const result: DispatchResult = {
    event_id: event.event_id,
    routes_evaluated: 0,
    leads_claimed: 0,
    dispatched: 0,
    errors: 0,
    skipped_paused: false,
    dry_run: dryRun,
    duration_ms: 0,
  };

  const config = await getOrchestratorConfig();
  if (config.status === "paused" || config.status === "error") {
    logger.info("Dispatcher: orchestrator paused, skipping dispatch", { status: config.status });
    result.skipped_paused = true;
    result.duration_ms = Date.now() - start;
    return result;
  }

  const routes = await loadDispatchRoutes();
  if (routes.length === 0) {
    logger.info("Dispatcher: no enabled routes found");
    result.duration_ms = Date.now() - start;
    return result;
  }

  // Routes are always processed sequentially (priority order).
  // Within each route, records are sequential, parallel, or batch depending on route config.
  const claimedEmails = new Set<string>();

  for (const route of routes) {
    result.routes_evaluated++;
    const maxPerCycle = Number(route.max_per_cycle ?? 50);

    let filter: CompiledFilter;
    try {
      const raw = JSON.parse(route.filter_json);
      filter = compileFilter(raw);
    } catch (err) {
      logger.warn("Dispatcher: invalid filter_json in route", { route: route.name, error: String(err) });
      continue;
    }

    let records: Record<string, unknown>[];
    try {
      // compileFilter returns { collection, conditions, logic, limit }
      // retrieveRecords takes { type, conditions, logic, limit } — map collection → type
      // NOTE: filter.collection must match the registered entity type name (e.g. "contact"),
      // not the collection slug (e.g. "contacts"). Mismatches silently return [].
      records = await retrieveRecords({
        type: filter.collection,
        conditions: filter.conditions,
        logic: filter.logic,
        limit: Math.min(filter.limit, maxPerCycle * 2),
      });
    } catch (err) {
      logger.warn("Dispatcher: recall failed for route", { route: route.name, error: String(err) });
      result.errors++;
      await bumpOrchestratorError(`Route recall failed: ${route.name} — ${String(err)}`);
      continue;
    }

    // A chain is per-record and incompatible with batch's single-call model.
    if (route.dispatch_mode === "batch" && route.target_chain?.length) {
      logger.warn(
        "Dispatcher: target_chain is ignored when dispatch_mode=batch (chains are per-record)",
        { route: route.name },
      );
    }

    if (route.dispatch_mode === "batch" && !route.target_chain?.length) {
      // -----------------------------------------------------------------------
      // BATCH pattern: one operation call receives the full record list.
      // The operation receives { records: [...] } and skips its own recall.
      // Eliminates the N+1 recall problem for bulk operations.
      //
      // Constraints:
      //   - Only works with target_type: "operation" (tasks have no batch input).
      //   - One failure = all records in the batch fail (atomic).
      //   - parallel is ignored (there is only one operation call).
      //   - All emails in the batch are claimed together after success.
      // -----------------------------------------------------------------------
      if (route.target_type !== "operation") {
        logger.warn(
          "Dispatcher: dispatch_mode=batch requires target_type=operation; falling back to sequential",
          { route: route.name, target_type: route.target_type },
        );
        // Fall through to sequential path below
      } else {
        if (route.parallel) {
          logger.warn("Dispatcher: parallel=true is ignored when dispatch_mode=batch", { route: route.name });
        }
        if (!OPERATIONS[route.target_name]) {
          logger.warn("Dispatcher: unknown operation in batch route", {
            route: route.name,
            operation: route.target_name,
          });
          result.errors++;
          await bumpOrchestratorError(`Unknown operation: ${route.target_name} on route ${route.name}`);
          continue;
        }

        // Pre-filter: exclude records with already-claimed emails, cap at maxPerCycle
        const eligible = records
          .filter((r) => {
            const email = extractEmail(r);
            return !email || !claimedEmails.has(email);
          })
          .slice(0, maxPerCycle);

        const emailsInBatch = eligible
          .map((r) => extractEmail(r))
          .filter((e): e is string => Boolean(e));

        if (eligible.length === 0) {
          logger.info("Dispatcher: no eligible records for batch route", { route: route.name });
          continue;
        }

        if (dryRun) {
          logger.info("[DRY RUN] Would batch-dispatch records", {
            route: route.name,
            operation: route.target_name,
            count: eligible.length,
          });
          for (const email of emailsInBatch) { claimedEmails.add(email); }
          result.leads_claimed += emailsInBatch.length;
          result.dispatched++;
          continue;
        }

        try {
          // Pass the full record list as input.records — operation uses this directly
          // and skips its own recall. The operation still validates and filters the list
          // (e.g. empty transcripts, missing identifiers) before doing its work.
          const batchOpResult = await runOperation(
            route.target_name,
            { records: eligible },
            { tierOverride: route.tier_override, modelOverride: route.model_override },
          );
          // ok:false without throwing is still a failure — atomic semantics: claim nothing.
          if (!batchOpResult.ok) {
            throw new Error(
              `Operation ${route.target_name} reported failure: ${batchOpResult.summary ?? "no summary"}`,
            );
          }
          // Claim all emails from this batch after successful operation
          for (const email of emailsInBatch) { claimedEmails.add(email); }
          result.leads_claimed += emailsInBatch.length;
          result.dispatched++;
        } catch (err) {
          result.errors++;
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.warn("Dispatcher: batch dispatch error", {
            route: route.name,
            count: eligible.length,
            error: errMsg,
          });
          await bumpOrchestratorError(`Batch dispatch error on route ${route.name} (${eligible.length} records): ${errMsg}`);
        }
        continue; // Do not fall through to per-record paths
      }
    }

    if (route.parallel) {
      // -----------------------------------------------------------------------
      // PARALLEL pattern: eligible records for this route run concurrently,
      // bounded by route.concurrency (default 8) so one route config cannot
      // rate-limit the whole org. Wall-clock ≈ ceil(n / concurrency) batches.
      // Best for independent per-record operations (research, enrichment, scoring).
      //
      // Emails are pre-filtered before dispatch to avoid races on claimedEmails.
      // One failure does not cancel the rest (allSettled semantics).
      // -----------------------------------------------------------------------
      const eligible = records
        .filter((r) => {
          const email = extractEmail(r);
          return email && !claimedEmails.has(email);
        })
        .slice(0, maxPerCycle);

      const concurrency = Number(route.concurrency ?? 8);
      const outcomes = await runWithConcurrency(eligible, concurrency, (record) =>
        dispatchOne(route, record, dryRun),
      );

      for (const outcome of outcomes) {
        if (outcome.status === "fulfilled") {
          claimedEmails.add(outcome.value);
          result.leads_claimed++;
          result.dispatched++;
        } else {
          result.errors++;
          const errMsg = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
          logger.warn("Dispatcher: dispatch error (parallel)", { route: route.name, error: errMsg });
          await bumpOrchestratorError(`Dispatch error on route ${route.name}: ${errMsg}`);
        }
      }
    } else {
      // -----------------------------------------------------------------------
      // SEQUENTIAL pattern (default): one record at a time.
      // Best for operations that write back to shared state, high-cost AI calls
      // where you want predictable throughput, or when debugging dispatch order.
      //
      // Stops at maxPerCycle regardless of how many records the filter returned.
      // -----------------------------------------------------------------------
      let routeDispatched = 0;
      for (const record of records) {
        if (routeDispatched >= maxPerCycle) break;
        const email = extractEmail(record);
        if (!email || claimedEmails.has(email)) continue;

        try {
          await dispatchOne(route, record, dryRun);
          // Only claim after successful dispatch so errors don't silently blacklist the email
          claimedEmails.add(email);
          result.leads_claimed++;
          result.dispatched++;
          routeDispatched++;
        } catch (err) {
          result.errors++;
          logger.warn("Dispatcher: dispatch error (sequential)", { route: route.name, email, error: String(err) });
          await bumpOrchestratorError(`Dispatch error on route ${route.name} for ${email}: ${String(err)}`);
        }
      }
    }
  }

  if (result.errors === 0) {
    await resetOrchestratorErrors();
  }

  result.duration_ms = Date.now() - start;

  await writeOrchestratorLog({
    event_type: "dispatch.cycle",
    severity: result.errors > 0 ? "warning" : "info",
    summary: `Dispatched ${result.dispatched} leads across ${result.routes_evaluated} routes (${result.errors} errors) in ${result.duration_ms}ms`,
    details_json: JSON.stringify({ ...result }),
    duration_ms: result.duration_ms,
  });

  logger.info("Dispatch cycle complete", { ...result });
  return result;
}
