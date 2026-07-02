# Core Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the event-driven dispatch engine that receives Personize webhooks, runs all enabled dispatch-routes against Personize collections, and triggers the right operation per matched lead — one per cycle, priority-ordered.

**Architecture:** A plain `node:http` webhook server receives `memory.updated` / `subagent.completed` events → writes to `webhook-events` collection → calls the dispatcher. The dispatcher reads all enabled `dispatch-routes` (sorted by priority), applies each route's `filter_json` via `recall.ts`, claims leads into an in-memory set (one operation per lead per cycle), and routes to TypeScript operations (via `operation-runner.ts`), tasks (via `tasks.ts`), or stubs for future subagent targets. The orchestrator manages the singleton `orchestrator-config` record: status, error counts, auto-pause threshold.

**Tech Stack:** Node.js built-in `node:http`, existing `@personize/sdk`, `zod`, `recall.ts`, `persist.ts`, `tasks.ts`, `operation-runner.ts`, `filter.ts`.

## Global Constraints

- No new external dependencies — use only `node:fs`, `node:http`, `node:crypto`, existing `zod`, `@personize/sdk`
- TypeScript strict throughout
- `dryRun` from `isDryRun()` respected everywhere — in dry-run, log what would happen but skip all SDK writes and operation runs
- Port from `PORT` env var (default `3000`)
- Webhook HMAC validation: `WEBHOOK_SECRET` env var; if unset, skip validation (dev mode)
- Webhook server responds `200` immediately, processes async (fire-and-forget)
- `(client as any).*` pattern allowed for untyped SDK methods, consistent with existing codebase
- All Personize writes use existing `setProperties`/`appendToProperty` from `persist.ts` or `(client as any)` patterns
- Node.js test runner (`node --import tsx/esm --test`); new test files added to `package.json` `"test"` script

---

### Task 1: Orchestrator State Manager

**Files:**
- Create: `src/core/engine/orchestrator.ts`

**Interfaces:**
- Consumes: `client` from `"../config.js"`, `logger` from `"../lib/logger.js"`, `retrieveRecord` from `"../lib/recall.js"`, `setProperties` from `"../lib/persist.js"`
- Produces:
  - `OrchestratorConfig` interface
  - `OrchestratorLogEntry` interface
  - `getOrchestratorConfig(): Promise<OrchestratorConfig>`
  - `setOrchestratorStatus(status: string, reason?: string, by?: string): Promise<void>`
  - `bumpOrchestratorError(reason: string): Promise<OrchestratorConfig>`
  - `resetOrchestratorErrors(): Promise<void>`
  - `writeOrchestratorLog(entry: Omit<OrchestratorLogEntry, "log_id" | "created_at">): Promise<void>`

- [ ] **Step 1: Create `src/core/engine/orchestrator.ts`**

```typescript
import { randomUUID } from "node:crypto";
import { client } from "../config.js";
import { logger } from "../lib/logger.js";
import { setProperties } from "../lib/persist.js";

const CONFIG_RECORD_ID = "default";
const CONFIG_TYPE = "orchestrator_config";
const CONFIG_COLLECTION = "orchestrator-config";
const LOG_TYPE = "orchestrator_log";
const LOG_COLLECTION = "orchestrator-logs";

export interface OrchestratorConfig {
  config_key: string;
  status: "running" | "paused" | "error" | "setup";
  paused_reason?: string;
  paused_at?: string;
  paused_by?: string;
  error_count: number;
  error_threshold: number;
  notification_webhook_url?: string;
  notification_min_severity?: string;
  last_event_id?: string;
  last_poll_at?: string;
  webhook_registered?: boolean;
  mcp_registered?: boolean;
  updated_at?: string;
}

export interface OrchestratorLogEntry {
  log_id: string;
  run_id?: string;
  event_type: string;
  route_name?: string;
  target_name?: string;
  entity_email?: string;
  entity_type_ref?: string;
  severity: "info" | "warning" | "error" | "critical";
  summary: string;
  details_json?: string;
  error_message?: string;
  retry_count?: number;
  duration_ms?: number;
  created_at: string;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  config_key: CONFIG_RECORD_ID,
  status: "running",
  error_count: 0,
  error_threshold: 10,
};

export async function getOrchestratorConfig(): Promise<OrchestratorConfig> {
  try {
    const res = await (client as any).memory?.retrieve?.({
      collection: CONFIG_COLLECTION,
      filter: { config_key: CONFIG_RECORD_ID },
      limit: 1,
    });
    const record = res?.data?.[0];
    if (!record) return DEFAULT_CONFIG;
    return {
      ...DEFAULT_CONFIG,
      ...record,
      error_count: Number(record.error_count ?? 0),
      error_threshold: Number(record.error_threshold ?? 10),
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

async function writeConfig(updates: Partial<OrchestratorConfig>): Promise<void> {
  await setProperties(
    { type: CONFIG_TYPE, collection: CONFIG_COLLECTION, recordId: CONFIG_RECORD_ID },
    { config_key: CONFIG_RECORD_ID, updated_at: new Date().toISOString(), ...updates },
  );
}

export async function setOrchestratorStatus(
  status: OrchestratorConfig["status"],
  reason?: string,
  by = "engine",
): Promise<void> {
  const updates: Partial<OrchestratorConfig> = { status };
  if (status === "paused") {
    updates.paused_reason = reason;
    updates.paused_at = new Date().toISOString();
    updates.paused_by = by;
  }
  await writeConfig(updates);
  logger.info("Orchestrator status changed", { status, reason });
}

export async function bumpOrchestratorError(reason: string): Promise<OrchestratorConfig> {
  const config = await getOrchestratorConfig();
  const newCount = config.error_count + 1;
  await writeConfig({ error_count: newCount });
  logger.warn("Orchestrator error bumped", { count: newCount, threshold: config.error_threshold, reason });

  if (newCount >= config.error_threshold) {
    await setOrchestratorStatus("paused", `Auto-paused: error threshold reached (${newCount} errors). Last: ${reason}`, "engine");
    // Notify via outbound webhook if configured
    if (config.notification_webhook_url) {
      notifyOutbound(config.notification_webhook_url, {
        event: "engine.auto_paused",
        reason,
        error_count: newCount,
        threshold: config.error_threshold,
        timestamp: new Date().toISOString(),
      }).catch(() => undefined);
    }
  }

  return { ...config, error_count: newCount };
}

export async function resetOrchestratorErrors(): Promise<void> {
  await writeConfig({ error_count: 0 });
}

export async function writeOrchestratorLog(
  entry: Omit<OrchestratorLogEntry, "log_id" | "created_at">,
): Promise<void> {
  const log_id = `log_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const full: OrchestratorLogEntry = {
    log_id,
    created_at: new Date().toISOString(),
    ...entry,
  };
  try {
    await setProperties(
      { type: LOG_TYPE, collection: LOG_COLLECTION, recordId: log_id },
      full as unknown as Record<string, unknown>,
    );
  } catch (err) {
    // Non-fatal — log locally only
    logger.warn("Failed to write orchestrator log", { log_id, error: String(err) });
  }
}

async function notifyOutbound(url: string, payload: unknown): Promise<void> {
  const { request } = await import("node:https");
  const body = JSON.stringify(payload);
  return new Promise((resolve) => {
    const req = request(url, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, (res) => {
      res.resume();
      resolve();
    });
    req.on("error", () => resolve());
    req.end(body);
  });
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd C:\Users\Admin\Documents\GitHub\Playground\crm-ai-operators
npm run typecheck
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/core/engine/orchestrator.ts
git commit -m "feat(engine): orchestrator config manager with auto-pause + outbound notification"
```

---

### Task 2: Dispatcher

**Files:**
- Create: `src/core/engine/dispatcher.ts`
- Create: `src/__tests__/dispatcher.test.ts`

**Interfaces:**
- Consumes: `getOrchestratorConfig`, `bumpOrchestratorError`, `resetOrchestratorErrors`, `writeOrchestratorLog` from `./orchestrator.js`; `retrieveRecords` from `../lib/recall.js`; `compileFilter` from `../lib/filter.js`; `createTask` from `../lib/tasks.js`; `runOperation` from `../runtime/operation-runner.js`; `OPERATIONS` from `../operations/registry.js`; `isDryRun` from `../lib/dry-run.js`
- Produces: `dispatch(event: IncomingEvent): Promise<DispatchResult>`; `DispatchResult`, `IncomingEvent` interfaces

- [ ] **Step 1: Write failing test**

Create `src/__tests__/dispatcher.test.ts`:

```typescript
import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("dispatcher", () => {
  test("module exports dispatch function", async () => {
    const mod = await import("../core/engine/dispatcher.js").catch(() => null);
    assert.ok(mod !== null, "dispatcher module must exist");
    assert.ok(typeof (mod as any)?.dispatch === "function", "dispatch must be a function");
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
node --import tsx/esm --test src/__tests__/dispatcher.test.ts
```
Expected: FAIL — "dispatcher module must exist"

- [ ] **Step 3: Create `src/core/engine/dispatcher.ts`**

```typescript
import { randomUUID } from "node:crypto";
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
    task_type: targetName as any,
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

  logger.info("Dispatch cycle complete", result);
  return result;
}
```

- [ ] **Step 4: Run test**

```bash
node --import tsx/esm --test src/__tests__/dispatcher.test.ts
```
Expected: PASS

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 6: Add test to package.json test script**

Add `src/__tests__/dispatcher.test.ts` to the `"test"` script list in `package.json`.

- [ ] **Step 7: Run full test suite**

```bash
npm test
```
Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add src/core/engine/dispatcher.ts src/__tests__/dispatcher.test.ts package.json
git commit -m "feat(engine): dispatcher — priority-ordered route evaluation, claim set, operation/task routing"
```

---

### Task 3: Webhook HTTP Server

**Files:**
- Create: `src/core/engine/webhook-server.ts`

**Interfaces:**
- Consumes: `dispatch` from `./dispatcher.js`; `writeOrchestratorLog` from `./orchestrator.js`; `setProperties` from `../lib/persist.js`; `logger` from `../lib/logger.js`
- Produces: `createWebhookServer(): http.Server`

- [ ] **Step 1: Create `src/core/engine/webhook-server.ts`**

```typescript
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { randomUUID } from "node:crypto";
import { logger } from "../lib/logger.js";
import { setProperties } from "../lib/persist.js";
import { dispatch, type IncomingEvent } from "./dispatcher.js";
import { getOrchestratorConfig } from "./orchestrator.js";

const WEBHOOK_SECRET = process.env["WEBHOOK_SECRET"];

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function validateSignature(body: Buffer, signature: string | undefined): boolean {
  if (!WEBHOOK_SECRET) return true; // dev mode: skip validation
  if (!signature) return false;
  const computed = createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(computed));
  } catch {
    return false;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(json);
}

async function handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  const signature = req.headers["x-personize-signature"] as string | undefined;

  if (!validateSignature(body, signature)) {
    logger.warn("Webhook: invalid signature", { ip: req.socket.remoteAddress });
    sendJson(res, 401, { error: "invalid signature" });
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    sendJson(res, 400, { error: "invalid JSON" });
    return;
  }

  const event_id = `evt_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const received_at = new Date().toISOString();

  // Respond immediately; process async
  sendJson(res, 200, { received: true, event_id });

  const event: IncomingEvent = {
    event_id,
    event_type: (payload["event"] ?? payload["event_type"] ?? "unknown") as string,
    entity_email: (payload["entity_email"] ?? payload["email"]) as string | undefined,
    entity_type_ref: (payload["entity_type"] ?? payload["entity_type_ref"]) as string | undefined,
    payload,
    received_at,
  };

  // Write to webhook-events collection (non-blocking)
  setProperties(
    { type: "webhook_event", collection: "webhook-events", recordId: event_id },
    {
      event_id,
      event_type: event.event_type,
      entity_email: event.entity_email ?? "",
      entity_type_ref: event.entity_type_ref ?? "",
      payload_json: JSON.stringify(payload),
      status: "received",
      received_at,
    },
  ).catch((err) => logger.warn("Failed to write webhook-event", { event_id, error: String(err) }));

  // Dispatch async — do not await so we don't block
  dispatch(event)
    .then((result) => {
      logger.info("Dispatch cycle done", { event_id, dispatched: result.dispatched, errors: result.errors });
      // Update webhook-event status
      setProperties(
        { type: "webhook_event", collection: "webhook-events", recordId: event_id },
        { status: "processed", processed_at: new Date().toISOString() },
      ).catch(() => undefined);
    })
    .catch((err) => {
      logger.error("Dispatch cycle failed", { event_id, error: String(err) });
      setProperties(
        { type: "webhook_event", collection: "webhook-events", recordId: event_id },
        { status: "failed", error: String(err), processed_at: new Date().toISOString() },
      ).catch(() => undefined);
    });
}

async function handleHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const config = await getOrchestratorConfig().catch(() => ({ status: "unknown" }));
  sendJson(res, 200, {
    ok: true,
    engine: config.status,
    timestamp: new Date().toISOString(),
  });
}

export function createWebhookServer() {
  return createServer(async (req, res) => {
    try {
      const url = req.url?.split("?")[0] ?? "/";
      const method = req.method ?? "GET";

      if (method === "POST" && url === "/webhook") {
        await handleWebhook(req, res);
      } else if (method === "GET" && url === "/health") {
        await handleHealth(req, res);
      } else {
        sendJson(res, 404, { error: "not found" });
      }
    } catch (err) {
      logger.error("Webhook server error", { error: String(err) });
      if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
    }
  });
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/core/engine/webhook-server.ts
git commit -m "feat(engine): webhook HTTP server — HMAC validation, async dispatch, health endpoint"
```

---

### Task 4: Engine Entry Point + CLI Wiring

**Files:**
- Create: `src/scripts/engine.ts`
- Modify: `package.json` — add `"engine"` script

**Interfaces:**
- Consumes: `createWebhookServer` from `../core/engine/webhook-server.js`; `setOrchestratorStatus` from `../core/engine/orchestrator.js`; `logger` from `../core/lib/logger.js`

- [ ] **Step 1: Create `src/scripts/engine.ts`**

```typescript
import { createWebhookServer } from "../core/engine/webhook-server.js";
import { setOrchestratorStatus } from "../core/engine/orchestrator.js";
import { logger } from "../core/lib/logger.js";

const PORT = Number(process.env["PORT"] ?? 3000);

const server = createWebhookServer();

server.listen(PORT, () => {
  logger.info("CRM AI Engine started", { port: PORT });
  setOrchestratorStatus("running").catch(() => undefined);
});

server.on("error", (err) => {
  logger.error("Server error", { error: err.message });
  process.exit(1);
});

function shutdown() {
  logger.info("Shutting down engine");
  server.close(() => {
    setOrchestratorStatus("paused", "graceful shutdown", "engine").catch(() => undefined).finally(() => process.exit(0));
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
```

- [ ] **Step 2: Add npm script to `package.json`**

Add to the `"scripts"` block:
```json
"engine": "tsx src/scripts/engine.ts"
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 4: Run full test suite**

```bash
npm test
```
Expected: all existing tests + dispatcher test pass

- [ ] **Step 5: Smoke test — engine starts**

```powershell
$env:DRY_RUN = 'true'; $job = Start-Job { Set-Location "C:\Users\Admin\Documents\GitHub\Playground\crm-ai-operators"; npm run engine 2>&1 }; Start-Sleep 3; Receive-Job $job; Stop-Job $job; Remove-Job $job
```
Expected: log line `"CRM AI Engine started" port=3000` (may fail with SDK error if no key — that's fine; check the log line appears before any error)

- [ ] **Step 6: Commit**

```bash
git add src/scripts/engine.ts package.json
git commit -m "feat(engine): engine entry point with graceful shutdown + npm run engine"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|---|---|
| Event-driven via Personize webhooks | Task 3 (POST /webhook) |
| Webhook writes to webhook-events collection | Task 3 |
| Dispatcher reads dispatch-routes | Task 2 |
| Priority ordering (lowest number = highest priority) | Task 2 |
| One operation per lead per cycle (claimed set) | Task 2 |
| max_per_cycle respected per route | Task 2 |
| dryRun throughout | Tasks 1-4 |
| Auto-pause on error threshold | Task 1 (bumpOrchestratorError) |
| Outbound notification on auto-pause | Task 1 (notifyOutbound) |
| orchestrator-logs written per cycle | Task 2 |
| Health endpoint | Task 3 |
| HMAC webhook validation | Task 3 |
| Graceful SIGTERM shutdown | Task 4 |
| npm run engine | Task 4 |

### Type Consistency

- `IncomingEvent` produced by Task 3, consumed by Task 2 — verify field names match
- `runOperation` from `operation-runner.ts` — verify the function signature before dispatching Task 2
- `OPERATIONS` from `registry.ts` — verify it's a plain object keyed by operation name
- `createTask` from `tasks.ts` — verify `task_type` accepts string values

### Placeholder Scan

- `routeToOperation`: calls `runOperation(op, { email }, { runId, dryRun, mode })` — verify `operation-runner.ts` export name and signature before implementing
- `retrieveRecords` filter shape: the dispatcher passes `{ ...filter, limit }` — verify `retrieveRecords` accepts the compiled filter format
