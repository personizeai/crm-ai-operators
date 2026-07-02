#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { OPERATION_NAMES, OPERATIONS } from "../core/operations/registry.js";
import { runOperation } from "../core/runtime/operation-runner.js";
import { getOrchestratorConfig, setOrchestratorStatus } from "../core/engine/orchestrator.js";
import { retrieveRecords } from "../core/lib/recall.js";
import { setProperties } from "../core/lib/persist.js";
import { isDryRun } from "../core/lib/dry-run.js";
import { getRelationCatalog, checkRelations, type DeclaredRelation } from "../core/lib/graph.js";

type McpProfile = "planner" | "operator" | "admin" | "auditor";
const PROFILE = (process.env.MCP_PROFILE as McpProfile) || "planner";

const server = new McpServer({
  name: "crm-ai-operators",
  version: "0.1.0",
});

function canRun(operation: string): boolean {
  const mode = OPERATIONS[operation]?.mode;
  if (PROFILE === "admin") return true;
  if (PROFILE === "operator") return mode === "operation" || mode === "optimization";
  if (PROFILE === "auditor") return false;
  return mode === "optimization";
}

function canWrite(): boolean {
  return PROFILE === "operator" || PROFILE === "admin";
}

server.tool(
  "operation_list",
  "List CRM Agent Operating System operations available in this repo.",
  {},
  async () => ({
    content: [{
      type: "text",
      text: JSON.stringify(
        OPERATION_NAMES.map((name) => ({
          name,
          mode: OPERATIONS[name].mode,
          description: OPERATIONS[name].description,
        })),
        null,
        2,
      ),
    }],
  }),
);

server.tool(
  "operation_run",
  "Run an approved operation by name. DRY_RUN defaults to true unless explicitly disabled in the environment.",
  {
    name: z.string().describe("Operation name, for example setup.apply or crm.sync-core"),
    input: z.record(z.unknown()).optional().describe("JSON input passed to the operation"),
  },
  async ({ name, input }: { name: string; input?: Record<string, unknown> }) => {
    if (!OPERATIONS[name]) {
      return { content: [{ type: "text", text: `Unknown operation: ${name}` }] };
    }
    if (!canRun(name)) {
      return { content: [{ type: "text", text: `MCP profile ${PROFILE} is not allowed to run ${name}` }] };
    }
    const result = await runOperation(name, input ?? {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "engine_status",
  "Return the current orchestrator config: status (running/paused/error/setup), error_count, error_threshold, last event.",
  {},
  async () => {
    const config = await getOrchestratorConfig();
    return { content: [{ type: "text", text: JSON.stringify(config, null, 2) }] };
  },
);

server.tool(
  "engine_pause",
  "Pause the dispatch engine. Operator or admin profile required. In dry-run mode, logs intent without writing.",
  {
    reason: z.string().describe("Human-readable reason for pausing the engine"),
  },
  async ({ reason }: { reason: string }) => {
    if (!canWrite()) {
      return { content: [{ type: "text", text: `Profile ${PROFILE} cannot pause the engine` }] };
    }
    const dryRun = await isDryRun();
    if (dryRun) {
      return { content: [{ type: "text", text: `[DRY RUN] Would pause engine: ${reason}` }] };
    }
    await setOrchestratorStatus("paused", reason, "mcp");
    return { content: [{ type: "text", text: `Engine paused: ${reason}` }] };
  },
);

server.tool(
  "engine_resume",
  "Resume the dispatch engine from paused or error state. Operator or admin profile required.",
  {},
  async () => {
    if (!canWrite()) {
      return { content: [{ type: "text", text: `Profile ${PROFILE} cannot resume the engine` }] };
    }
    const dryRun = await isDryRun();
    if (dryRun) {
      return { content: [{ type: "text", text: "[DRY RUN] Would resume engine" }] };
    }
    await setOrchestratorStatus("running", undefined, "mcp");
    return { content: [{ type: "text", text: "Engine resumed" }] };
  },
);

server.tool(
  "route_list",
  "List all dispatch routes from Personize, sorted by priority. Returns route_id, name, priority, enabled, target_type, target_name, max_per_cycle.",
  {
    enabled_only: z.boolean().optional().describe("If true, return only enabled routes. Default: false (return all)."),
  },
  async ({ enabled_only }: { enabled_only?: boolean }) => {
    const records = await retrieveRecords({
      type: "dispatch_route",
      conditions: enabled_only ? [{ propertyName: "enabled", operator: "equals", value: true }] : [],
      logic: "AND",
      limit: 100,
    });
    const sorted = (records as Array<Record<string, unknown>>).sort(
      (a, b) => Number(a.priority ?? 99) - Number(b.priority ?? 99),
    );
    return { content: [{ type: "text", text: JSON.stringify(sorted, null, 2) }] };
  },
);

server.tool(
  "route_create",
  "Create a new dispatch route in Personize. Operator or admin profile required. route_id must be unique (format: route_<slug>).",
  {
    route_id: z.string().min(1).regex(/^route_[\w-]+$/).describe("Unique route ID. Format: route_<slug>, e.g. route_score-new-mqls"),
    name: z.string().describe("Human-readable route name"),
    description: z.string().optional().describe("What this route does and when it fires"),
    priority: z.number().int().describe("Evaluation order. Lower number = higher priority."),
    filter_json: z.string().describe('JSON string matching CompiledFilter shape: { "collection": "contact", "conditions": [{"propertyName": "lead_status", "operator": "equals", "value": "New"}], "logic": "AND", "limit": 50 }'),
    target_type: z.enum(["operation", "task", "subagent"]).describe("What to call when this route matches"),
    target_name: z.string().describe("Operation name (e.g. score.icp-fit), task_type, or subagent name"),
    max_per_cycle: z.number().int().optional().describe("Max leads per dispatch cycle. Default: 50"),
    enabled: z.boolean().optional().describe("Whether the route is active. Default: true"),
  },
  async (args: {
    route_id: string; name: string; description?: string; priority: number;
    filter_json: string; target_type: "operation" | "task" | "subagent";
    target_name: string; max_per_cycle?: number; enabled?: boolean;
  }) => {
    if (!canWrite()) {
      return { content: [{ type: "text", text: `Profile ${PROFILE} cannot create routes` }] };
    }
    const dryRun = await isDryRun();
    if (dryRun) {
      return { content: [{ type: "text", text: `[DRY RUN] Would create route: ${JSON.stringify(args, null, 2)}` }] };
    }
    try {
      JSON.parse(args.filter_json);
    } catch {
      return { content: [{ type: "text", text: "Invalid filter_json: must be valid JSON" }] };
    }
    await setProperties(
      { type: "dispatch_route", collection: "dispatch-routes", recordId: args.route_id },
      {
        route_id: args.route_id,
        name: args.name,
        description: args.description ?? "",
        priority: args.priority,
        filter_json: args.filter_json,
        target_type: args.target_type,
        target_name: args.target_name,
        max_per_cycle: args.max_per_cycle ?? 50,
        enabled: args.enabled ?? true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    );
    return { content: [{ type: "text", text: `Route created: ${args.route_id}` }] };
  },
);

server.tool(
  "route_update",
  "Update fields on an existing dispatch route. Operator or admin profile required. Only provided fields are updated.",
  {
    route_id: z.string().describe("Route ID to update"),
    name: z.string().optional(),
    description: z.string().optional(),
    priority: z.number().int().optional(),
    filter_json: z.string().optional().describe("Full replacement filter_json — must be valid JSON"),
    target_type: z.enum(["operation", "task", "subagent"]).optional(),
    target_name: z.string().optional(),
    max_per_cycle: z.number().int().optional(),
    enabled: z.boolean().optional(),
  },
  async (args: {
    route_id: string; name?: string; description?: string; priority?: number;
    filter_json?: string; target_type?: "operation" | "task" | "subagent";
    target_name?: string; max_per_cycle?: number; enabled?: boolean;
  }) => {
    if (!canWrite()) {
      return { content: [{ type: "text", text: `Profile ${PROFILE} cannot update routes` }] };
    }
    const dryRun = await isDryRun();
    if (dryRun) {
      return { content: [{ type: "text", text: `[DRY RUN] Would update route ${args.route_id}: ${JSON.stringify(args, null, 2)}` }] };
    }
    if (args.filter_json) {
      try { JSON.parse(args.filter_json); } catch {
        return { content: [{ type: "text", text: "Invalid filter_json: must be valid JSON" }] };
      }
    }
    const { route_id, ...updates } = args;
    await setProperties(
      { type: "dispatch_route", collection: "dispatch-routes", recordId: route_id },
      { ...updates, updated_at: new Date().toISOString() },
    );
    return { content: [{ type: "text", text: `Route updated: ${route_id}` }] };
  },
);

server.tool(
  "log_list",
  "List recent orchestrator log entries (dispatch cycles, errors, status changes). Returns up to `limit` entries.",
  {
    limit: z.number().int().optional().describe("Max entries to return. Default: 20, max: 100."),
    severity: z.enum(["info", "warning", "error", "critical"]).optional().describe("Filter by minimum severity"),
  },
  async ({ limit, severity }: { limit?: number; severity?: "info" | "warning" | "error" | "critical" }) => {
    const conditions: Array<{ propertyName: string; operator: string; value: unknown }> = [];
    if (severity) {
      const levels = ["info", "warning", "error", "critical"];
      const minIdx = levels.indexOf(severity);
      const allowed = levels.slice(minIdx);
      conditions.push({ propertyName: "severity", operator: "in", value: allowed });
    }
    const records = await retrieveRecords({
      type: "orchestrator_log",
      conditions,
      logic: "AND",
      limit: Math.min(limit ?? 20, 100),
    });
    return { content: [{ type: "text", text: JSON.stringify(records, null, 2) }] };
  },
);

server.tool(
  "webhook_event_list",
  "List recent webhook events received by the engine. Returns up to `limit` entries.",
  {
    limit: z.number().int().optional().describe("Max entries to return. Default: 20, max: 100."),
    status: z.enum(["received", "processed", "failed"]).optional().describe("Filter by event status"),
  },
  async ({ limit, status }: { limit?: number; status?: "received" | "processed" | "failed" }) => {
    const conditions: Array<{ propertyName: string; operator: string; value: unknown }> = [];
    if (status) {
      conditions.push({ propertyName: "status", operator: "equals", value: status });
    }
    const records = await retrieveRecords({
      type: "webhook_event",
      conditions,
      logic: "AND",
      limit: Math.min(limit ?? 20, 100),
    });
    return { content: [{ type: "text", text: JSON.stringify(records, null, 2) }] };
  },
);

// --- Graph relations: the two tools the assistant uses to build correct edges ---
// The mandatory save protocol (AGENTS.md → "Building graph edges on every save"):
// before declaring edges on a memory save, call `relation_types` to see what's
// allowed, then `relations_validate` to polish the payload down to valid edges.

server.tool(
  "relation_types",
  "List the org's allowed graph relation types (the relation registry). Call this BEFORE declaring any edges on a memory save — each entry gives the relationType and its allowed from/to entity types ([] means any).",
  {},
  async () => ({
    content: [{ type: "text", text: JSON.stringify(await getRelationCatalog(), null, 2) }],
  }),
);

const DeclaredRelationSchema = z.object({
  relationType: z.string().describe("Relation type name from relation_types, e.g. works_at"),
  toRecordId: z.string().optional().describe("Target by record id (use this OR toIdentity)"),
  toIdentity: z
    .object({
      kind: z.enum(["email", "websiteUrl", "domain", "phoneNumber", "name"]),
      value: z.string(),
    })
    .optional()
    .describe("Target by strong identity; resolved or stubbed at write time"),
  toEntityType: z.string().optional().describe("Target entity type, e.g. company (required with toIdentity)"),
  confidence: z.number().min(0).max(1).optional(),
});

server.tool(
  "relations_validate",
  "Validate proposed graph edges against the org registry WITHOUT saving. Returns { valid, dropped } so you can polish a declared-edge payload before saving. `dropped` explains why each edge failed (unknown-type | inactive | from-type-not-allowed | to-type-not-allowed).",
  {
    fromEntityType: z.string().describe("Entity type of the record you're saving, e.g. contact"),
    relations: z.array(DeclaredRelationSchema).describe("The edges you intend to declare on the save"),
  },
  async ({ fromEntityType, relations }: { fromEntityType: string; relations: z.infer<typeof DeclaredRelationSchema>[] }) => {
    // NOTE (pre-existing, graph owner): the local schema allows kind:"domain" but the
    // SDK's DeclaredRelation.kind does not. Cast to unblock compilation without changing
    // runtime behavior — resolve by aligning the schema to the SDK (or updating the SDK).
    const { valid, dropped } = await checkRelations(fromEntityType, relations as DeclaredRelation[]);
    return { content: [{ type: "text", text: JSON.stringify({ valid, dropped }, null, 2) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
