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
): Promise<void> {
  // Validate operation exists in registry before attempting to run
  if (!OPERATIONS[targetName]) {
    logger.warn("Dispatcher: unknown operation target", { targetName });
    return;
  }
  if (dryRun) {
    logger.info("[DRY RUN] Would run operation", { operation: targetName, email });
    return;
  }
  // runOperation(name, input, options) — handles runId + dryRun internally
  await runOperation(targetName, { email });
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

    let routeDispatched = 0;
    for (const record of records) {
      if (routeDispatched >= maxPerCycle) break;
      const email = extractEmail(record);
      if (!email || claimedEmails.has(email)) continue;

      claimedEmails.add(email);
      result.leads_claimed++;

      try {
        if (route.target_type === "operation") {
          await routeToOperation(route.target_name, email, dryRun);
        } else if (route.target_type === "task") {
          await routeToTask(route.target_name, email, route.name, dryRun);
        } else {
          // subagent: stub — create a task as fallback
          logger.info("Dispatcher: subagent target type not yet implemented; creating task fallback", { route: route.name });
          await routeToTask("subagent-queued", email, route.name, dryRun);
        }
        result.dispatched++;
        routeDispatched++;
      } catch (err) {
        result.errors++;
        logger.warn("Dispatcher: dispatch error", { route: route.name, email, error: String(err) });
        await bumpOrchestratorError(`Dispatch error on route ${route.name} for ${email}: ${String(err)}`);
      }
    }
  }

  if (result.errors === 0 && result.dispatched > 0) {
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
