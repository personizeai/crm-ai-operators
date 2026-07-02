import { logger } from "../lib/logger.js";
import { retrieveRecords } from "../lib/recall.js";
import { compileFilter, type CompiledFilter } from "../lib/filter.js";
import { createTask } from "../lib/tasks.js";
import { isDryRun } from "../lib/dry-run.js";
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
// Dispatch execution patterns:
//   sequential (default, parallel: false):
//     Records within a route are processed one at a time. Errors stay
//     isolated, rate limits are respected, and `maxPerCycle` is a hard cap.
//     Use for operations that write back to the same record (avoid races),
//     high-cost operations, or when you want predictable throughput.
//
//   parallel (parallel: true):
//     All eligible records for a route are dispatched concurrently using
//     Promise.allSettled. Wall-clock drops from O(n × latency) to O(latency).
//     Use for independent operations — research, enrichment, scoring — where
//     each record is self-contained and there is no shared write target.
//     One failure does not block the rest.
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
  target_type: "operation" | "subagent" | "task";
  target_name: string;
  instructions_name?: string;
  max_per_cycle?: number;
  /** When true, records within this route are dispatched concurrently (Promise.allSettled). */
  parallel?: boolean;
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
  // runOperation(name, input, options) — handles runId + dryRun internally
  await runOperation(targetName, { email }, { tierOverride, modelOverride });
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

// ---------------------------------------------------------------------------
// dispatchOne — shared dispatch logic so sequential and parallel paths call
// the same code. Returns the email on success (used by parallel path to claim).
// ---------------------------------------------------------------------------
async function dispatchOne(
  route: DispatchRoute,
  email: string,
  dryRun: boolean,
): Promise<string> {
  if (route.target_type === "operation") {
    await routeToOperation(route.target_name, email, dryRun, route.tier_override, route.model_override);
  } else if (route.target_type === "task") {
    await routeToTask(route.target_name, email, route.name, dryRun);
  } else {
    // subagent: stub — create a task as fallback until subagent target is implemented
    logger.info("Dispatcher: subagent target type not yet implemented; creating task fallback", { route: route.name });
    await routeToTask("subagent-queued", email, route.name, dryRun);
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
  // Within each route, records are sequential or parallel depending on route.parallel.
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

    if (route.parallel) {
      // -----------------------------------------------------------------------
      // PARALLEL pattern: all eligible records for this route run concurrently.
      // Best for independent per-record operations (research, enrichment, scoring).
      // Wall-clock = slowest record, not sum of all records.
      //
      // Emails are pre-filtered before dispatch to avoid races on claimedEmails.
      // Promise.allSettled ensures one failure does not cancel the rest.
      // -----------------------------------------------------------------------
      const eligible = records
        .filter((r) => {
          const email = extractEmail(r);
          return email && !claimedEmails.has(email);
        })
        .slice(0, maxPerCycle);

      const outcomes = await Promise.allSettled(
        eligible.map((record) => dispatchOne(route, extractEmail(record)!, dryRun)),
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
          await dispatchOne(route, email, dryRun);
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
