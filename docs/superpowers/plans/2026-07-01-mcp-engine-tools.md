# MCP Engine Management Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 engine-management MCP tools to `src/mcp/server.ts` so Claude Code (and other agents) can inspect and control the dispatch engine without touching the database directly.

**Architecture:** All new tools follow the existing `server.tool(name, desc, zodSchema, handler)` pattern. Engine tools read/write via `getOrchestratorConfig`, `setOrchestratorStatus`, `retrieveRecords`, and `setProperties`. Access-control is profile-gated: auditor/planner get read-only; operator/admin get write access.

**Tech Stack:** `@modelcontextprotocol/sdk`, `zod`, existing engine exports.

## Global Constraints

- No new npm dependencies
- TypeScript strict; import paths use `.js` extensions (ESM)
- All tools return `{ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }`
- Profile gate: `PROFILE` is `"planner" | "operator" | "admin" | "auditor"` — admin > operator > planner > auditor
- `(client as any)` pattern is project-wide intentional — do not flag
- Dry-run: engine_pause and engine_resume check `isDryRun()` — log and return without writing in dry-run
- Commit message: `feat(mcp): add engine management tools — status, pause/resume, routes, logs`

---

### Task 1: Add Engine Management Tools to MCP Server

**Files:**
- Modify: `src/mcp/server.ts`

**Interfaces:**
- Consumes:
  - `getOrchestratorConfig, setOrchestratorStatus` from `"../core/engine/orchestrator.js"`
  - `retrieveRecords` from `"../core/lib/recall.js"`
  - `setProperties` from `"../core/lib/persist.js"`
  - `isDryRun` from `"../core/lib/dry-run.js"`

- [ ] **Step 1: Read existing `src/mcp/server.ts`** to understand the current import block and tool list before making any changes.

- [ ] **Step 2: Add imports** at the top of the file, after existing imports:

```typescript
import { getOrchestratorConfig, setOrchestratorStatus } from "../core/engine/orchestrator.js";
import { retrieveRecords } from "../core/lib/recall.js";
import { setProperties } from "../core/lib/persist.js";
import { isDryRun } from "../core/lib/dry-run.js";
```

- [ ] **Step 3: Add access-control helpers** after the existing `canRun` function:

```typescript
function canWrite(): boolean {
  return PROFILE === "operator" || PROFILE === "admin";
}

function canRead(): boolean {
  return PROFILE !== "auditor" || PROFILE === "auditor"; // auditor gets read
}
```

Wait — auditor IS allowed to read. Simplify:

```typescript
function canWrite(): boolean {
  return PROFILE === "operator" || PROFILE === "admin";
}
```

(All profiles can read; only operator/admin can write.)

- [ ] **Step 4: Add `engine_status` tool** after the existing `operation_run` tool:

```typescript
server.tool(
  "engine_status",
  "Return the current orchestrator config: status (running/paused/error/setup), error_count, error_threshold, last event.",
  {},
  async () => {
    const config = await getOrchestratorConfig();
    return { content: [{ type: "text", text: JSON.stringify(config, null, 2) }] };
  },
);
```

- [ ] **Step 5: Add `engine_pause` tool**:

```typescript
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
```

- [ ] **Step 6: Add `engine_resume` tool**:

```typescript
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
```

- [ ] **Step 7: Add `route_list` tool**:

```typescript
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
```

- [ ] **Step 8: Add `route_create` tool**:

```typescript
server.tool(
  "route_create",
  "Create a new dispatch route in Personize. Operator or admin profile required. route_id must be unique (format: route_<slug>).",
  {
    route_id: z.string().describe("Unique route ID. Format: route_<slug>, e.g. route_score-new-mqls"),
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
```

- [ ] **Step 9: Add `route_update` tool**:

```typescript
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
```

- [ ] **Step 10: Add `log_list` tool**:

```typescript
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
```

- [ ] **Step 11: Add `webhook_event_list` tool**:

```typescript
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
```

- [ ] **Step 12: Run typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 13: Run tests**

```bash
npm test
```
Expected: all 43 pass (1 skipped)

- [ ] **Step 14: Commit**

```bash
git add src/mcp/server.ts
git commit -m "feat(mcp): add engine management tools — status, pause/resume, routes, logs"
```

---

## Self-Review

### Spec Coverage

| Tool | Profile gate | Reads/Writes |
|---|---|---|
| `engine_status` | all | reads orchestrator-config |
| `engine_pause` | operator/admin | writes orchestrator-config |
| `engine_resume` | operator/admin | writes orchestrator-config |
| `route_list` | all | reads dispatch-routes |
| `route_create` | operator/admin | writes dispatch-routes |
| `route_update` | operator/admin | writes dispatch-routes |
| `log_list` | all | reads orchestrator-logs |
| `webhook_event_list` | all | reads webhook-events |

### Placeholder Scan
- All `setProperties` calls include `collection` field matching the manifest slug
- `filter_json` is validated as valid JSON before writing in create/update
- `isDryRun()` checked in all write tools
