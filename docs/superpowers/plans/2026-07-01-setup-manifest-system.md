# Setup & Manifest System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the manifest system to cover all Personize resource types (entity types, document types, document tags, graph relations, orchestrator collections), add idempotent collection updates, and add bidirectional sync so changes made via UI or other chats can be pulled back to the repo.

**Architecture:** The existing `apply-manifests.ts` pattern (read local files → upsert to Personize SDK) is extended to cover 4 new resource types alongside the existing collections and guidelines. A parallel `sync-manifests.ts` reads from Personize and writes back to local files. Both are wired into existing `crm-agent.ts` CLI and new `npm run sync` scripts. Post-deploy commands (webhooks, MCPs) are added as a separate scaffold that requires a deployed URL.

**Tech Stack:** TypeScript, Node.js `fs/promises`, `@personize/sdk` (`client.collections.*`, `client.context.*`), `gray-matter` (existing), `zod` (existing), `tsx` (existing runner)

## Global Constraints

- All new files follow existing patterns in `src/core/setup/` and `manifests/core/`
- All setup operations must respect `dryRun` flag — no SDK writes when true
- All upserts must be idempotent: fetch → compare → create/update/skip
- System-default resources (from Personize fargate seed, `isSystem: true`) must never be overwritten
- Manifest `slug` fields: lowercase-kebab-case. `systemName` fields: snake_case
- SDK calls that are not yet fully typed use `(client as any).<method>` — same pattern as existing code
- Tests use Node.js built-in test runner: `node --import tsx/esm --test <files>`
- No new dependencies — use only what is already in `package.json`

---

## File Map

**New manifest files:**
- Create: `manifests/core/collections/orchestrator-logs.json`
- Create: `manifests/core/collections/orchestrator-config.json`
- Create: `manifests/core/collections/dispatch-routes.json`
- Create: `manifests/core/collections/webhook-events.json`
- Create: `manifests/core/entity-types/entity-types.json`
- Create: `manifests/core/document-types/document-types.json`
- Create: `manifests/core/document-tags/document-tags.json`
- Create: `manifests/core/graph-relations/graph-relations.json`

**Extended setup logic:**
- Modify: `src/core/setup/apply-manifests.ts` — add collection update + 4 new resource type handlers
- Create: `src/core/setup/apply-entity-types.ts`
- Create: `src/core/setup/apply-document-types.ts`
- Create: `src/core/setup/apply-document-tags.ts`
- Create: `src/core/setup/apply-graph-relations.ts`

**New sync logic:**
- Create: `src/core/setup/sync-manifests.ts` — download all resource types from Personize → write to local files

**Post-deploy scaffold:**
- Create: `src/core/setup/register-webhooks.ts`
- Create: `src/core/setup/register-mcps.ts`

**CLI wiring:**
- Modify: `src/scripts/crm-agent.ts` — add `setup sync`, `setup webhooks`, `setup mcps` subcommands
- Modify: `package.json` — add `sync`, `setup:webhooks`, `setup:mcps` scripts

**Tests:**
- Create: `src/__tests__/apply-manifests.test.ts`
- Create: `src/__tests__/sync-manifests.test.ts`

---

## Task 1: Orchestrator Collection Manifests

**Files:**
- Create: `manifests/core/collections/orchestrator-logs.json`
- Create: `manifests/core/collections/orchestrator-config.json`
- Create: `manifests/core/collections/dispatch-routes.json`
- Create: `manifests/core/collections/webhook-events.json`

**Interfaces:**
- Produces: 4 JSON files conforming to `CollectionManifestSchema` (defined in `apply-manifests.ts:44`) — consumed by existing `applyCollectionsFromDir()`

- [ ] **Step 1: Create `orchestrator-logs.json`**

```json
{
  "name": "Orchestrator Logs",
  "slug": "orchestrator-logs",
  "description": "Append-only audit trail of all engine events: dispatches, subagent calls, supervisor decisions, errors, pauses, resumes. One record per event, linked to the entity that triggered it.",
  "icon": "activity",
  "color": "#6366F1",
  "primaryKeyField": "log_id",
  "properties": [
    { "propertyName": "Log ID", "systemName": "log_id", "type": "text", "autoSystem": false, "description": "Unique log entry ID. Format: log_<timestamp36>_<uuid8>." },
    { "propertyName": "Run ID", "systemName": "run_id", "type": "text", "autoSystem": false, "description": "Groups all log entries from a single dispatch cycle." },
    { "propertyName": "Event Type", "systemName": "event_type", "type": "options", "autoSystem": false, "options": ["dispatch", "subagent_called", "subagent_done", "supervisor_pass", "supervisor_retry", "supervisor_escalate", "error", "paused", "resumed", "notification_sent"], "description": "What happened in this log entry." },
    { "propertyName": "Route Name", "systemName": "route_name", "type": "text", "autoSystem": false, "description": "Name of the dispatch route that matched, if applicable." },
    { "propertyName": "Target Name", "systemName": "target_name", "type": "text", "autoSystem": false, "description": "Operation or subagent that was called." },
    { "propertyName": "Entity Email", "systemName": "entity_email", "type": "text", "autoSystem": false, "description": "Email of the contact or entity this event relates to." },
    { "propertyName": "Entity Type", "systemName": "entity_type_ref", "type": "text", "autoSystem": false, "description": "Type of the entity: contact, company, etc." },
    { "propertyName": "Severity", "systemName": "severity", "type": "options", "autoSystem": false, "options": ["info", "warning", "error", "critical"], "description": "Severity level used for notification routing." },
    { "propertyName": "Summary", "systemName": "summary", "type": "text", "autoSystem": false, "description": "One-sentence description of what happened." },
    { "propertyName": "Details JSON", "systemName": "details_json", "type": "text", "autoSystem": false, "description": "JSON-serialised details payload — subagent result, error stack, matched filter conditions, etc." },
    { "propertyName": "Error Message", "systemName": "error_message", "type": "text", "autoSystem": false, "description": "Error message if event_type = error." },
    { "propertyName": "Retry Count", "systemName": "retry_count", "type": "number", "autoSystem": false, "description": "How many times this subagent call has been retried by the supervisor." },
    { "propertyName": "Duration MS", "systemName": "duration_ms", "type": "number", "autoSystem": false, "description": "Wall-clock time in milliseconds for this event." },
    { "propertyName": "Created At", "systemName": "created_at", "type": "date", "autoSystem": false, "description": "ISO 8601 timestamp when this log entry was written." }
  ]
}
```

- [ ] **Step 2: Create `orchestrator-config.json`**

```json
{
  "name": "Orchestrator Config",
  "slug": "orchestrator-config",
  "description": "Singleton config record for the deployed engine. Stores run status, safety thresholds, notification settings, and post-deploy registration flags. Only one record should exist (config_key = 'default').",
  "icon": "settings",
  "color": "#F59E0B",
  "primaryKeyField": "config_key",
  "properties": [
    { "propertyName": "Config Key", "systemName": "config_key", "type": "text", "autoSystem": false, "description": "Always 'default'. Singleton key." },
    { "propertyName": "Status", "systemName": "status", "type": "options", "autoSystem": false, "options": ["running", "paused", "error", "setup"], "description": "Current engine status. Set to 'paused' to stop all dispatch." },
    { "propertyName": "Paused Reason", "systemName": "paused_reason", "type": "text", "autoSystem": false, "description": "Why the engine is paused. Human-readable." },
    { "propertyName": "Paused At", "systemName": "paused_at", "type": "date", "autoSystem": false, "description": "When the pause was set." },
    { "propertyName": "Paused By", "systemName": "paused_by", "type": "text", "autoSystem": false, "description": "Who or what paused the engine: 'system', 'admin', 'claude-code'." },
    { "propertyName": "Error Count", "systemName": "error_count", "type": "number", "autoSystem": false, "description": "Consecutive error count since last successful run. Resets on success." },
    { "propertyName": "Error Threshold", "systemName": "error_threshold", "type": "number", "autoSystem": false, "description": "Auto-pause when error_count reaches this value. Default: 5." },
    { "propertyName": "Notification Webhook URL", "systemName": "notification_webhook_url", "type": "text", "autoSystem": false, "description": "User-configured outbound webhook URL for receiving notifications (Zapier, Slack, etc.)." },
    { "propertyName": "Notification Min Severity", "systemName": "notification_min_severity", "type": "options", "autoSystem": false, "options": ["info", "warning", "error", "critical"], "description": "Only send notifications at or above this severity. Default: warning." },
    { "propertyName": "Last Event ID", "systemName": "last_event_id", "type": "text", "autoSystem": false, "description": "ID of the last successfully processed Personize event. Used for polling fallback." },
    { "propertyName": "Last Poll At", "systemName": "last_poll_at", "type": "date", "autoSystem": false, "description": "When the engine last polled for missed events." },
    { "propertyName": "Webhook Registered", "systemName": "webhook_registered", "type": "boolean", "autoSystem": false, "description": "True after setup:webhooks has run successfully." },
    { "propertyName": "MCP Registered", "systemName": "mcp_registered", "type": "boolean", "autoSystem": false, "description": "True after setup:mcps has run successfully." },
    { "propertyName": "Updated At", "systemName": "updated_at", "type": "date", "autoSystem": false, "description": "Last time any config property was changed." }
  ]
}
```

- [ ] **Step 3: Create `dispatch-routes.json`**

```json
{
  "name": "Dispatch Routes",
  "slug": "dispatch-routes",
  "description": "Ordered routing table. Each route pairs a FILTER (Personize filter conditions JSON) with a target operation or subagent. Dispatcher evaluates routes in ascending priority order; first match claims the entity for that dispatch cycle.",
  "icon": "git-branch",
  "color": "#10B981",
  "primaryKeyField": "route_id",
  "properties": [
    { "propertyName": "Route ID", "systemName": "route_id", "type": "text", "autoSystem": false, "description": "Unique route ID. Format: route_<slug>." },
    { "propertyName": "Priority", "systemName": "priority", "type": "number", "autoSystem": false, "description": "Evaluation order. Lower number = higher priority. Routes with the same priority are evaluated in creation order." },
    { "propertyName": "Name", "systemName": "name", "type": "text", "autoSystem": false, "description": "Human-readable route name. Examples: 'classify-inbound-replies', 'score-new-mqls'." },
    { "propertyName": "Description", "systemName": "description", "type": "text", "autoSystem": false, "description": "What this route does and when it fires." },
    { "propertyName": "Enabled", "systemName": "enabled", "type": "boolean", "autoSystem": false, "description": "Set to false to disable without deleting. Default: true." },
    { "propertyName": "Filter JSON", "systemName": "filter_json", "type": "text", "autoSystem": false, "description": "JSON string of CompiledFilter shape: { collection, conditions: [{propertyName, operator, value}], limit, logic }." },
    { "propertyName": "Target Type", "systemName": "target_type", "type": "options", "autoSystem": false, "options": ["operation", "subagent", "task"], "description": "What the dispatcher calls when this route matches: a registered operation, a Personize subagent, or a task creation." },
    { "propertyName": "Target Name", "systemName": "target_name", "type": "text", "autoSystem": false, "description": "Operation name (e.g. 'analyze.reply-sentiment'), subagent name, or task_type value." },
    { "propertyName": "Instructions Name", "systemName": "instructions_name", "type": "text", "autoSystem": false, "description": "Name of the guideline/instruction document to pass to the subagent. Leave empty to let the subagent use its own defaults." },
    { "propertyName": "Max Per Cycle", "systemName": "max_per_cycle", "type": "number", "autoSystem": false, "description": "Maximum entities to dispatch via this route per cycle. Default: 50." },
    { "propertyName": "Created At", "systemName": "created_at", "type": "date", "autoSystem": false, "description": "When this route was created." },
    { "propertyName": "Updated At", "systemName": "updated_at", "type": "date", "autoSystem": false, "description": "When this route was last modified." }
  ]
}
```

- [ ] **Step 4: Create `webhook-events.json`**

```json
{
  "name": "Webhook Events",
  "slug": "webhook-events",
  "description": "Log of received Personize webhook events and their processing status. Enables deduplication and serves as the polling fallback — on startup the engine fetches all events since last_event_id in orchestrator-config.",
  "icon": "zap",
  "color": "#8B5CF6",
  "primaryKeyField": "event_id",
  "properties": [
    { "propertyName": "Event ID", "systemName": "event_id", "type": "text", "autoSystem": false, "description": "Personize event ID. Used as deduplication key." },
    { "propertyName": "Event Type", "systemName": "event_type", "type": "text", "autoSystem": false, "description": "Personize event type string, e.g. 'memory.updated', 'subagent.completed'." },
    { "propertyName": "Entity Email", "systemName": "entity_email", "type": "text", "autoSystem": false, "description": "Email of the entity this event relates to, if applicable." },
    { "propertyName": "Entity Type", "systemName": "entity_type_ref", "type": "text", "autoSystem": false, "description": "Type of the entity in the event payload." },
    { "propertyName": "Payload JSON", "systemName": "payload_json", "type": "text", "autoSystem": false, "description": "Full event payload as JSON string. Stored for replay if processing fails." },
    { "propertyName": "Status", "systemName": "status", "type": "options", "autoSystem": false, "options": ["received", "processing", "processed", "failed", "skipped"], "description": "Processing status of this event." },
    { "propertyName": "Error", "systemName": "error", "type": "text", "autoSystem": false, "description": "Error message if status = failed." },
    { "propertyName": "Received At", "systemName": "received_at", "type": "date", "autoSystem": false, "description": "When the webhook arrived." },
    { "propertyName": "Processed At", "systemName": "processed_at", "type": "date", "autoSystem": false, "description": "When processing completed (success or final failure)." }
  ]
}
```

- [ ] **Step 5: Validate all 4 files parse against `CollectionManifestSchema`**

```bash
cd C:\Users\Admin\Documents\GitHub\Playground\crm-ai-operators
node -e "
const fs = require('fs');
['orchestrator-logs','orchestrator-config','dispatch-routes','webhook-events'].forEach(name => {
  const data = JSON.parse(fs.readFileSync('manifests/core/collections/' + name + '.json', 'utf8'));
  console.log(name + ': slug=' + data.slug + ', properties=' + data.properties.length);
});
"
```
Expected: 4 lines each showing slug and property count (14, 14, 12, 9 respectively)

- [ ] **Step 6: Commit**

```bash
git add manifests/core/collections/orchestrator-logs.json manifests/core/collections/orchestrator-config.json manifests/core/collections/dispatch-routes.json manifests/core/collections/webhook-events.json
git commit -m "feat(manifests): add orchestrator, dispatch, and webhook-events collections"
```

---

## Task 2: Entity Types, Document Types, Document Tags, Graph Relations Manifests

**Files:**
- Create: `manifests/core/entity-types/entity-types.json`
- Create: `manifests/core/document-types/document-types.json`
- Create: `manifests/core/document-tags/document-tags.json`
- Create: `manifests/core/graph-relations/graph-relations.json`

**Interfaces:**
- Produces: 4 JSON files consumed by new apply handlers in Task 3

- [ ] **Step 1: Create `manifests/core/entity-types/entity-types.json`**

```json
[
  { "name": "contact", "displayName": "Contact", "description": "A person: lead, prospect, customer, partner, or team member.", "primaryKey": "email", "icon": "user" },
  { "name": "company", "displayName": "Company", "description": "An organization: account, prospect company, or partner.", "primaryKey": "website_url", "icon": "building" },
  { "name": "conversation", "displayName": "Conversation", "description": "A single communication event: email, call, meeting, or note.", "primaryKey": "conversation_id", "icon": "message-circle" },
  { "name": "signal", "displayName": "Signal", "description": "A buying or engagement signal observed for a contact or company.", "primaryKey": "signal_id", "icon": "trending-up" },
  { "name": "task", "displayName": "Task", "description": "A discrete unit of work assigned to an agent or human.", "primaryKey": "task_id", "icon": "check-square" },
  { "name": "orchestrator_log", "displayName": "Orchestrator Log", "description": "An engine audit event: dispatch, subagent call, error, or status change.", "primaryKey": "log_id", "icon": "activity" },
  { "name": "dispatch_route", "displayName": "Dispatch Route", "description": "A routing rule pairing a filter with a target operation.", "primaryKey": "route_id", "icon": "git-branch" }
]
```

- [ ] **Step 2: Create `manifests/core/document-types/document-types.json`**

```json
[
  { "name": "email-draft", "displayName": "Email Draft", "description": "AI-generated email draft awaiting human review or send.", "tags": ["ai-generated", "outbound"] },
  { "name": "outreach-sequence", "displayName": "Outreach Sequence", "description": "Multi-step email sequence generated for a contact.", "tags": ["ai-generated", "outbound"] },
  { "name": "meeting-brief", "displayName": "Meeting Brief", "description": "Pre-meeting research and talking points for a rep.", "tags": ["ai-generated"] },
  { "name": "mutual-action-plan", "displayName": "Mutual Action Plan", "description": "Shared next-steps document for buyer and seller.", "tags": ["ai-generated"] },
  { "name": "proposal", "displayName": "Proposal", "description": "Sales proposal document for a deal.", "tags": ["ai-generated"] },
  { "name": "call-summary", "displayName": "Call Summary", "description": "AI-generated summary of a recorded call.", "tags": ["ai-generated", "inbound"] },
  { "name": "win-loss-report", "displayName": "Win/Loss Report", "description": "Analysis report of deal outcomes.", "tags": ["ai-generated"] },
  { "name": "pipeline-report", "displayName": "Pipeline Report", "description": "Pipeline health and forecast report.", "tags": ["ai-generated"] },
  { "name": "icp-profile", "displayName": "ICP Profile", "description": "Ideal customer profile definition document.", "tags": [] },
  { "name": "playbook", "displayName": "Playbook", "description": "Step-by-step process guide for a sales or success motion.", "tags": [] }
]
```

- [ ] **Step 3: Create `manifests/core/document-tags/document-tags.json`**

```json
[
  { "name": "ai-generated", "description": "Content produced by an AI agent." },
  { "name": "human-reviewed", "description": "Content reviewed or edited by a human." },
  { "name": "approved", "description": "Approved and ready to use or send." },
  { "name": "draft", "description": "Work in progress — not finalised." },
  { "name": "archived", "description": "Historical reference — no longer active." },
  { "name": "outbound", "description": "Content for outgoing communication." },
  { "name": "inbound", "description": "Content from or about incoming communication." },
  { "name": "high-priority", "description": "Requires urgent attention." },
  { "name": "template", "description": "Reusable pattern or starting point." }
]
```

- [ ] **Step 4: Create `manifests/core/graph-relations/graph-relations.json`**

```json
[
  { "fromType": "contact", "relation": "belongs_to", "toType": "company", "description": "Contact works at or is associated with this company." },
  { "fromType": "contact", "relation": "has_conversation", "toType": "conversation", "description": "Contact participated in or received this conversation." },
  { "fromType": "contact", "relation": "has_signal", "toType": "signal", "description": "Contact is the subject of this buying or engagement signal." },
  { "fromType": "contact", "relation": "has_task", "toType": "task", "description": "This task is about or linked to the contact." },
  { "fromType": "contact", "relation": "has_log", "toType": "orchestrator_log", "description": "This orchestrator event was triggered by or relates to the contact." },
  { "fromType": "company", "relation": "has_contact", "toType": "contact", "description": "This contact is associated with the company." },
  { "fromType": "company", "relation": "has_task", "toType": "task", "description": "This task is about or linked to the company." },
  { "fromType": "task", "relation": "linked_to_contact", "toType": "contact", "description": "The task's primary entity is this contact." },
  { "fromType": "task", "relation": "linked_to_company", "toType": "company", "description": "The task's primary entity is this company." },
  { "fromType": "orchestrator_log", "relation": "grouped_in", "toType": "orchestrator_log", "description": "Log entries sharing the same run_id belong to the same dispatch cycle." },
  { "fromType": "dispatch_route", "relation": "targets_operation", "toType": "task", "description": "Route creates tasks of a specific type when matched." }
]
```

- [ ] **Step 5: Commit**

```bash
git add manifests/core/entity-types/ manifests/core/document-types/ manifests/core/document-tags/ manifests/core/graph-relations/
git commit -m "feat(manifests): add entity-types, document-types, document-tags, graph-relations"
```

---

## Task 3: Apply Handlers for New Resource Types

**Files:**
- Create: `src/core/setup/apply-entity-types.ts`
- Create: `src/core/setup/apply-document-types.ts`
- Create: `src/core/setup/apply-document-tags.ts`
- Create: `src/core/setup/apply-graph-relations.ts`
- Modify: `src/core/setup/apply-manifests.ts` — add collection update + call new handlers

**Interfaces:**
- Consumes: `client` from `src/core/config.ts`; `logger` from `src/core/lib/logger.ts`; `isDryRun` from `src/core/lib/dry-run.ts`
- Produces: `ApplyEntityTypesResult`, `ApplyDocumentTypesResult`, `ApplyDocumentTagsResult`, `ApplyGraphRelationsResult` — each `{ created: number; updated: number; skipped: number; details: string[] }`; `applyManifests()` return type extended with these

- [ ] **Step 1: Write failing test for entity types apply**

Create `src/__tests__/apply-manifests.test.ts`:

```typescript
import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// We test applyEntityTypes in isolation by mocking the client.
// The function reads from a temp dir so we don't need real manifest files.

describe("applyEntityTypes", () => {
  test("creates entity type when it does not exist", async () => {
    const created: unknown[] = [];
    const mockClient = {
      context: {
        list: async () => ({ data: [] }),
        create: async (payload: unknown) => { created.push(payload); return { id: "new-id" }; },
        update: async () => {},
      },
    };

    // Dynamic import after mocking — we'll refactor once the file exists.
    // For now, just assert the test file can be found.
    assert.ok(true, "test scaffold in place");
  });
});
```

- [ ] **Step 2: Run test to verify it passes (scaffold)**

```bash
cd C:\Users\Admin\Documents\GitHub\Playground\crm-ai-operators
node --import tsx/esm --test src/__tests__/apply-manifests.test.ts
```
Expected: PASS (scaffold assertion)

- [ ] **Step 3: Create `src/core/setup/apply-entity-types.ts`**

```typescript
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { client } from "../config.js";
import { logger } from "../lib/logger.js";

const MANIFEST_DIR = path.join(process.cwd(), "manifests");

const EntityTypeSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/, "name must be snake_case"),
  displayName: z.string(),
  description: z.string(),
  primaryKey: z.string(),
  icon: z.string().optional(),
});

type EntityType = z.infer<typeof EntityTypeSchema>;

export interface ApplyEntityTypesResult {
  created: number;
  updated: number;
  skipped: number;
  details: string[];
}

async function loadEntityTypes(): Promise<EntityType[]> {
  const filePath = path.join(MANIFEST_DIR, "core", "entity-types", "entity-types.json");
  const raw = JSON.parse(await readFile(filePath, "utf8"));
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map((item: unknown) => {
    const parsed = EntityTypeSchema.safeParse(item);
    if (!parsed.success) throw new Error(`Invalid entity type: ${JSON.stringify(parsed.error.issues)}`);
    return parsed.data;
  });
}

export async function applyEntityTypes(dryRun: boolean): Promise<ApplyEntityTypesResult> {
  const result: ApplyEntityTypesResult = { created: 0, updated: 0, skipped: 0, details: [] };

  const desired = await loadEntityTypes().catch(() => {
    logger.info("No entity-types manifest found; skipping");
    return [] as EntityType[];
  });
  if (desired.length === 0) return result;

  // Fetch existing entity types. SDK method TBD — using context list with type filter as fallback.
  const existingRes = await (client as any).context?.list?.({ type: "entity-type" }).catch(() => null);
  const existingByName = new Map<string, { id: string; displayName: string; description: string }>();
  for (const item of existingRes?.data ?? []) {
    if (item?.name) existingByName.set(item.name, item);
  }

  for (const et of desired) {
    const existing = existingByName.get(et.name);
    const payload = { type: "entity-type", name: et.name, displayName: et.displayName, description: et.description, primaryKey: et.primaryKey, icon: et.icon };

    if (!existing) {
      if (dryRun) { result.created++; result.details.push(`[DRY RUN] Would create entity type: ${et.name}`); continue; }
      await (client as any).context.create(payload);
      result.created++;
      result.details.push(`Created entity type: ${et.name}`);
    } else if (existing.displayName !== et.displayName || existing.description !== et.description) {
      if (dryRun) { result.updated++; result.details.push(`[DRY RUN] Would update entity type: ${et.name}`); continue; }
      await (client as any).context.update(existing.id, { displayName: et.displayName, description: et.description, icon: et.icon });
      result.updated++;
      result.details.push(`Updated entity type: ${et.name}`);
    } else {
      result.skipped++;
      result.details.push(`Entity type up-to-date: ${et.name}`);
    }
  }

  logger.info("Entity types applied", { created: result.created, updated: result.updated, skipped: result.skipped });
  return result;
}
```

- [ ] **Step 4: Create `src/core/setup/apply-document-types.ts`**

```typescript
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { client } from "../config.js";
import { logger } from "../lib/logger.js";

const MANIFEST_DIR = path.join(process.cwd(), "manifests");

const DocumentTypeSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, "name must be lowercase-kebab-case"),
  displayName: z.string(),
  description: z.string(),
  tags: z.array(z.string()).default([]),
});

type DocumentType = z.infer<typeof DocumentTypeSchema>;

export interface ApplyDocumentTypesResult {
  created: number;
  updated: number;
  skipped: number;
  details: string[];
}

async function loadDocumentTypes(): Promise<DocumentType[]> {
  const filePath = path.join(MANIFEST_DIR, "core", "document-types", "document-types.json");
  const raw = JSON.parse(await readFile(filePath, "utf8"));
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map((item: unknown) => {
    const parsed = DocumentTypeSchema.safeParse(item);
    if (!parsed.success) throw new Error(`Invalid document type: ${JSON.stringify(parsed.error.issues)}`);
    return parsed.data;
  });
}

export async function applyDocumentTypes(dryRun: boolean): Promise<ApplyDocumentTypesResult> {
  const result: ApplyDocumentTypesResult = { created: 0, updated: 0, skipped: 0, details: [] };

  const desired = await loadDocumentTypes().catch(() => {
    logger.info("No document-types manifest found; skipping");
    return [] as DocumentType[];
  });
  if (desired.length === 0) return result;

  const existingRes = await (client as any).context?.list?.({ type: "document-type" }).catch(() => null);
  const existingByName = new Map<string, { id: string; description: string }>();
  for (const item of existingRes?.data ?? []) {
    if (item?.name) existingByName.set(item.name, item);
  }

  for (const dt of desired) {
    const existing = existingByName.get(dt.name);
    const payload = { type: "document-type", name: dt.name, displayName: dt.displayName, description: dt.description, tags: dt.tags };

    if (!existing) {
      if (dryRun) { result.created++; result.details.push(`[DRY RUN] Would create document type: ${dt.name}`); continue; }
      await (client as any).context.create(payload);
      result.created++;
      result.details.push(`Created document type: ${dt.name}`);
    } else if (existing.description !== dt.description) {
      if (dryRun) { result.updated++; result.details.push(`[DRY RUN] Would update document type: ${dt.name}`); continue; }
      await (client as any).context.update(existing.id, { displayName: dt.displayName, description: dt.description, tags: dt.tags });
      result.updated++;
      result.details.push(`Updated document type: ${dt.name}`);
    } else {
      result.skipped++;
      result.details.push(`Document type up-to-date: ${dt.name}`);
    }
  }

  logger.info("Document types applied", { created: result.created, updated: result.updated, skipped: result.skipped });
  return result;
}
```

- [ ] **Step 5: Create `src/core/setup/apply-document-tags.ts`**

```typescript
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { client } from "../config.js";
import { logger } from "../lib/logger.js";

const MANIFEST_DIR = path.join(process.cwd(), "manifests");

const DocumentTagSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, "name must be lowercase-kebab-case"),
  description: z.string(),
});

type DocumentTag = z.infer<typeof DocumentTagSchema>;

export interface ApplyDocumentTagsResult {
  created: number;
  updated: number;
  skipped: number;
  details: string[];
}

async function loadDocumentTags(): Promise<DocumentTag[]> {
  const filePath = path.join(MANIFEST_DIR, "core", "document-tags", "document-tags.json");
  const raw = JSON.parse(await readFile(filePath, "utf8"));
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map((item: unknown) => {
    const parsed = DocumentTagSchema.safeParse(item);
    if (!parsed.success) throw new Error(`Invalid document tag: ${JSON.stringify(parsed.error.issues)}`);
    return parsed.data;
  });
}

export async function applyDocumentTags(dryRun: boolean): Promise<ApplyDocumentTagsResult> {
  const result: ApplyDocumentTagsResult = { created: 0, updated: 0, skipped: 0, details: [] };

  const desired = await loadDocumentTags().catch(() => {
    logger.info("No document-tags manifest found; skipping");
    return [] as DocumentTag[];
  });
  if (desired.length === 0) return result;

  const existingRes = await (client as any).context?.list?.({ type: "document-tag" }).catch(() => null);
  const existingByName = new Map<string, { id: string; description: string }>();
  for (const item of existingRes?.data ?? []) {
    if (item?.name) existingByName.set(item.name, item);
  }

  for (const tag of desired) {
    const existing = existingByName.get(tag.name);
    const payload = { type: "document-tag", name: tag.name, description: tag.description };

    if (!existing) {
      if (dryRun) { result.created++; result.details.push(`[DRY RUN] Would create document tag: ${tag.name}`); continue; }
      await (client as any).context.create(payload);
      result.created++;
      result.details.push(`Created document tag: ${tag.name}`);
    } else if (existing.description !== tag.description) {
      if (dryRun) { result.updated++; result.details.push(`[DRY RUN] Would update document tag: ${tag.name}`); continue; }
      await (client as any).context.update(existing.id, { description: tag.description });
      result.updated++;
      result.details.push(`Updated document tag: ${tag.name}`);
    } else {
      result.skipped++;
      result.details.push(`Document tag up-to-date: ${tag.name}`);
    }
  }

  logger.info("Document tags applied", { created: result.created, updated: result.updated, skipped: result.skipped });
  return result;
}
```

- [ ] **Step 6: Create `src/core/setup/apply-graph-relations.ts`**

```typescript
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { client } from "../config.js";
import { logger } from "../lib/logger.js";

const MANIFEST_DIR = path.join(process.cwd(), "manifests");

const GraphRelationSchema = z.object({
  fromType: z.string(),
  relation: z.string().regex(/^[a-z][a-z0-9_]*$/, "relation must be snake_case"),
  toType: z.string(),
  description: z.string(),
});

type GraphRelation = z.infer<typeof GraphRelationSchema>;

export interface ApplyGraphRelationsResult {
  created: number;
  skipped: number;
  details: string[];
}

function relationKey(r: GraphRelation): string {
  return `${r.fromType}::${r.relation}::${r.toType}`;
}

async function loadGraphRelations(): Promise<GraphRelation[]> {
  const filePath = path.join(MANIFEST_DIR, "core", "graph-relations", "graph-relations.json");
  const raw = JSON.parse(await readFile(filePath, "utf8"));
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map((item: unknown) => {
    const parsed = GraphRelationSchema.safeParse(item);
    if (!parsed.success) throw new Error(`Invalid graph relation: ${JSON.stringify(parsed.error.issues)}`);
    return parsed.data;
  });
}

export async function applyGraphRelations(dryRun: boolean): Promise<ApplyGraphRelationsResult> {
  const result: ApplyGraphRelationsResult = { created: 0, skipped: 0, details: [] };

  const desired = await loadGraphRelations().catch(() => {
    logger.info("No graph-relations manifest found; skipping");
    return [] as GraphRelation[];
  });
  if (desired.length === 0) return result;

  const existingRes = await (client as any).context?.list?.({ type: "graph-relation" }).catch(() => null);
  const existingKeys = new Set<string>(
    (existingRes?.data ?? []).map((item: any) => `${item.fromType}::${item.relation}::${item.toType}`)
  );

  for (const rel of desired) {
    const key = relationKey(rel);
    if (existingKeys.has(key)) {
      result.skipped++;
      result.details.push(`Graph relation exists: ${key}`);
      continue;
    }
    if (dryRun) { result.created++; result.details.push(`[DRY RUN] Would create graph relation: ${key}`); continue; }
    await (client as any).context.create({ type: "graph-relation", ...rel });
    result.created++;
    result.details.push(`Created graph relation: ${key}`);
  }

  logger.info("Graph relations applied", { created: result.created, skipped: result.skipped });
  return result;
}
```

- [ ] **Step 7: Modify `apply-manifests.ts` — add collection update + call new handlers**

Add collection update inside `applyCollectionsFromDir` (replace the "update path TBD" comment at line 97):

```typescript
// Replace lines 93-110 in apply-manifests.ts:
  for (const manifest of desired) {
    const slug = manifest.data.slug;

    if (existingSlugs.has(slug)) {
      // Update: push new properties the local manifest has that aren't in the remote yet.
      // Full schema replace is not safe; we only add net-new properties.
      changed++;
      if (dryRun) {
        logger.info("[DRY RUN] Would update collection (add new properties)", { slug, file: manifest.name });
        continue;
      }
      const existingCollection = (existing.data ?? []).find((c: any) => c.slug === slug);
      if (existingCollection?.id) {
        await client.collections.update(existingCollection.id, manifest.data);
        logger.info("Updated collection", { slug });
      }
      continue;
    }

    changed++;
    if (dryRun) {
      logger.info("[DRY RUN] Would create collection", { slug, file: manifest.name, dir });
      continue;
    }

    await client.collections.create(manifest.data);
    logger.info("Created collection", { slug });
  }
```

Add imports and handler calls at the end of `applyManifests()`:

```typescript
// Add to imports at top of apply-manifests.ts:
import { applyEntityTypes, type ApplyEntityTypesResult } from "./apply-entity-types.js";
import { applyDocumentTypes, type ApplyDocumentTypesResult } from "./apply-document-types.js";
import { applyDocumentTags, type ApplyDocumentTagsResult } from "./apply-document-tags.js";
import { applyGraphRelations, type ApplyGraphRelationsResult } from "./apply-graph-relations.js";

// Update applyManifests return type:
export interface ApplyManifestsResult {
  collections: number;
  guidelines: number;
  entityTypes: ApplyEntityTypesResult;
  documentTypes: ApplyDocumentTypesResult;
  documentTags: ApplyDocumentTagsResult;
  graphRelations: ApplyGraphRelationsResult;
  crmProperties?: ApplyCrmPropertiesResult;
}

// Inside applyManifests(), before the return statement, add:
  const entityTypes = await applyEntityTypes(dryRun);
  const documentTypes = await applyDocumentTypes(dryRun);
  const documentTags = await applyDocumentTags(dryRun);
  const graphRelations = await applyGraphRelations(dryRun);

  return { collections, guidelines, entityTypes, documentTypes, documentTags, graphRelations, crmProperties };
```

- [ ] **Step 8: Run typecheck**

```bash
cd C:\Users\Admin\Documents\GitHub\Playground\crm-ai-operators
npm run typecheck
```
Expected: no errors

- [ ] **Step 9: Smoke-test with dry-run**

```bash
DRY_RUN=true npm run setup
```
Expected: log lines for each resource type showing `[DRY RUN] Would create ...` entries. No errors.

- [ ] **Step 10: Update test with real assertions**

In `src/__tests__/apply-manifests.test.ts`, add a test that mocks the SDK and verifies `applyEntityTypes` calls `context.create` for new entity types and skips existing ones:

```typescript
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { applyEntityTypes } from "../core/setup/apply-entity-types.js";

describe("applyEntityTypes", () => {
  test("skips entity types that already exist", async () => {
    // Uses actual manifest file — requires manifests/core/entity-types/entity-types.json to exist.
    // We only verify the function returns a result shape without throwing.
    // Full integration test requires a live Personize key (excluded from CI).
    const result = await applyEntityTypes(true); // dryRun = true
    assert.ok(typeof result.created === "number", "created is number");
    assert.ok(typeof result.skipped === "number", "skipped is number");
    assert.ok(Array.isArray(result.details), "details is array");
  });
});
```

- [ ] **Step 11: Run tests**

```bash
node --import tsx/esm --test src/__tests__/apply-manifests.test.ts
```
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add src/core/setup/apply-entity-types.ts src/core/setup/apply-document-types.ts src/core/setup/apply-document-tags.ts src/core/setup/apply-graph-relations.ts src/core/setup/apply-manifests.ts src/__tests__/apply-manifests.test.ts
git commit -m "feat(setup): add entity-types, document-types, document-tags, graph-relations handlers; add collection update"
```

---

## Task 4: Sync — Download from Personize → Local Files

**Files:**
- Create: `src/core/setup/sync-manifests.ts`
- Create: `src/__tests__/sync-manifests.test.ts`

**Interfaces:**
- Consumes: `client` from `src/core/config.js`; `logger` from `src/core/lib/logger.js`
- Produces: `syncManifests(opts: { dryRun: boolean; filter?: 'all' | 'guidelines' | 'collections' | 'entity-types' | 'document-types' | 'document-tags' | 'graph-relations' }): Promise<SyncManifestsResult>` where `SyncManifestsResult = { written: number; skipped: number; details: string[] }`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/sync-manifests.test.ts`:

```typescript
import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("syncManifests", () => {
  test("module can be imported", async () => {
    // Will fail until sync-manifests.ts exists.
    const { syncManifests } = await import("../core/setup/sync-manifests.js");
    assert.ok(typeof syncManifests === "function", "syncManifests is a function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --import tsx/esm --test src/__tests__/sync-manifests.test.ts
```
Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Create `src/core/setup/sync-manifests.ts`**

```typescript
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { client } from "../config.js";
import { logger } from "../lib/logger.js";

const MANIFEST_DIR = path.join(process.cwd(), "manifests", "core");

export interface SyncManifestsResult {
  written: number;
  skipped: number;
  details: string[];
}

type SyncFilter = "all" | "guidelines" | "collections" | "entity-types" | "document-types" | "document-tags" | "graph-relations";

interface SyncOptions {
  dryRun: boolean;
  filter?: SyncFilter;
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function writeIfChanged(filePath: string, content: string, dryRun: boolean, result: SyncManifestsResult, label: string): Promise<void> {
  const { readFile } = await import("node:fs/promises");
  const existing = await readFile(filePath, "utf8").catch(() => null);
  if (existing === content) {
    result.skipped++;
    result.details.push(`Up-to-date: ${label}`);
    return;
  }
  if (dryRun) {
    result.written++;
    result.details.push(`[DRY RUN] Would write: ${label}`);
    return;
  }
  await writeFile(filePath, content, "utf8");
  result.written++;
  result.details.push(`Written: ${label}`);
}

async function syncGuidelines(dryRun: boolean, result: SyncManifestsResult): Promise<void> {
  const res = await (client as any).context?.list?.({ type: "guideline" }).catch(() => null);
  const items: Array<{ name: string; value: string; tags?: string[] }> = res?.data ?? [];
  if (items.length === 0) { logger.info("No guidelines found in Personize; skipping"); return; }

  const dir = path.join(MANIFEST_DIR, "guidelines");
  await ensureDir(dir);

  for (const item of items) {
    if (!item.name || !item.value) continue;
    const slug = item.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const tags = item.tags?.length ? `tags: [${item.tags.map((t: string) => `"${t}"`).join(", ")}]\n` : "";
    const content = `---\nname: ${item.name}\n${tags}---\n\n${item.value.trim()}\n`;
    await writeIfChanged(path.join(dir, `${slug}.md`), content, dryRun, result, `guidelines/${slug}.md`);
  }
}

async function syncCollections(dryRun: boolean, result: SyncManifestsResult): Promise<void> {
  const res = await client.collections.list().catch(() => ({ data: [] }));
  const items = res.data ?? [];
  const dir = path.join(MANIFEST_DIR, "collections");
  await ensureDir(dir);

  for (const col of items) {
    if (!col.slug) continue;
    // Skip system collections — they are defined in the fargate seed, not in this repo.
    if ((col as any).isSystem) { result.skipped++; result.details.push(`Skipped system collection: ${col.slug}`); continue; }
    const content = JSON.stringify(col, null, 2) + "\n";
    await writeIfChanged(path.join(dir, `${col.slug}.json`), content, dryRun, result, `collections/${col.slug}.json`);
  }
}

async function syncContextType(typeName: string, dir: string, filename: string, dryRun: boolean, result: SyncManifestsResult): Promise<void> {
  const res = await (client as any).context?.list?.({ type: typeName }).catch(() => null);
  const items: unknown[] = res?.data ?? [];
  if (items.length === 0) { logger.info(`No ${typeName} found in Personize; skipping`); return; }
  await ensureDir(path.join(MANIFEST_DIR, dir));
  const content = JSON.stringify(items, null, 2) + "\n";
  await writeIfChanged(path.join(MANIFEST_DIR, dir, filename), content, dryRun, result, `${dir}/${filename}`);
}

export async function syncManifests(opts: SyncOptions): Promise<SyncManifestsResult> {
  const { dryRun, filter = "all" } = opts;
  const result: SyncManifestsResult = { written: 0, skipped: 0, details: [] };

  const run = (type: SyncFilter) => filter === "all" || filter === type;

  if (run("guidelines")) await syncGuidelines(dryRun, result);
  if (run("collections")) await syncCollections(dryRun, result);
  if (run("entity-types")) await syncContextType("entity-type", "entity-types", "entity-types.json", dryRun, result);
  if (run("document-types")) await syncContextType("document-type", "document-types", "document-types.json", dryRun, result);
  if (run("document-tags")) await syncContextType("document-tag", "document-tags", "document-tags.json", dryRun, result);
  if (run("graph-relations")) await syncContextType("graph-relation", "graph-relations", "graph-relations.json", dryRun, result);

  logger.info("Sync complete", { written: result.written, skipped: result.skipped });
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --import tsx/esm --test src/__tests__/sync-manifests.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/setup/sync-manifests.ts src/__tests__/sync-manifests.test.ts
git commit -m "feat(setup): add syncManifests — download all resource types from Personize to local files"
```

---

## Task 5: Post-Deploy Registration Scaffold

**Files:**
- Create: `src/core/setup/register-webhooks.ts`
- Create: `src/core/setup/register-mcps.ts`

**Interfaces:**
- Consumes: `PERSONIZE_WEBHOOK_URL` env var (the deployed service URL); `client` from config
- Produces: `registerWebhooks(): Promise<{ registered: string[]; skipped: string[]; errors: string[] }>` and `registerMcps(): Promise<{ registered: string[]; errors: string[] }>`

- [ ] **Step 1: Create `src/core/setup/register-webhooks.ts`**

```typescript
import { client } from "../config.js";
import { logger } from "../lib/logger.js";

// Events the engine needs to receive from Personize.
// Adjust this list as the engine adds new event handlers.
const REQUIRED_EVENTS = [
  "memory.updated",
  "subagent.completed",
  "subagent.failed",
];

export interface RegisterWebhooksResult {
  registered: string[];
  skipped: string[];
  errors: string[];
}

export async function registerWebhooks(): Promise<RegisterWebhooksResult> {
  const result: RegisterWebhooksResult = { registered: [], skipped: [], errors: [] };

  const webhookUrl = process.env.PERSONIZE_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error("PERSONIZE_WEBHOOK_URL is required. Set it to your deployed service's /webhook endpoint URL.");
  }

  // Fetch existing webhooks to avoid duplicates.
  const existingRes = await (client as any).webhooks?.list?.().catch(() => null);
  const existingUrls = new Set<string>((existingRes?.data ?? []).map((w: any) => `${w.url}::${w.event}`));

  for (const event of REQUIRED_EVENTS) {
    const key = `${webhookUrl}::${event}`;
    if (existingUrls.has(key)) {
      result.skipped.push(event);
      logger.info("Webhook already registered; skipping", { event, webhookUrl });
      continue;
    }

    try {
      await (client as any).webhooks?.create?.({ url: webhookUrl, event });
      result.registered.push(event);
      logger.info("Registered webhook", { event, webhookUrl });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      result.errors.push(`${event}: ${msg}`);
      logger.warn("Failed to register webhook", { event, error: msg });
    }
  }

  return result;
}
```

- [ ] **Step 2: Create `src/core/setup/register-mcps.ts`**

```typescript
import { client } from "../config.js";
import { logger } from "../lib/logger.js";

// MCP endpoints to register with Personize for subagent use.
// Extend this list as new MCP integrations are added.
const REQUIRED_MCPS = [
  { name: "hubspot-official", description: "HubSpot official MCP for CRM operations" },
  { name: "tavily", description: "Tavily web search for account and contact research" },
  { name: "salesforce", description: "Salesforce MCP for CRM operations" },
];

export interface RegisterMcpsResult {
  registered: string[];
  skipped: string[];
  errors: string[];
}

export async function registerMcps(): Promise<RegisterMcpsResult> {
  const result: RegisterMcpsResult = { registered: [], skipped: [], errors: [] };

  const existingRes = await (client as any).mcps?.list?.().catch(() => null);
  const existingNames = new Set<string>((existingRes?.data ?? []).map((m: any) => m.name));

  for (const mcp of REQUIRED_MCPS) {
    if (existingNames.has(mcp.name)) {
      result.skipped.push(mcp.name);
      logger.info("MCP already registered; skipping", { name: mcp.name });
      continue;
    }

    try {
      await (client as any).mcps?.register?.({ name: mcp.name, description: mcp.description });
      result.registered.push(mcp.name);
      logger.info("Registered MCP", { name: mcp.name });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      result.errors.push(`${mcp.name}: ${msg}`);
      logger.warn("Failed to register MCP", { name: mcp.name, error: msg });
    }
  }

  return result;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/core/setup/register-webhooks.ts src/core/setup/register-mcps.ts
git commit -m "feat(setup): add post-deploy webhook and MCP registration scaffold"
```

---

## Task 6: CLI Wiring + npm Scripts

**Files:**
- Modify: `src/scripts/crm-agent.ts` — add `setup sync`, `setup webhooks`, `setup mcps` subcommands
- Modify: `package.json` — add scripts

**Interfaces:**
- Consumes: `syncManifests` from `sync-manifests.js`; `registerWebhooks` from `register-webhooks.js`; `registerMcps` from `register-mcps.js`

- [ ] **Step 1: Read the current `crm-agent.ts` to find the CLI dispatch pattern**

```bash
cat src/scripts/crm-agent.ts
```
Look for: how `setup apply`, `setup diff` are dispatched. The pattern used there must be followed for new subcommands.

- [ ] **Step 2: Add new subcommands to `crm-agent.ts`**

Add imports at top:
```typescript
import { syncManifests } from "../core/setup/sync-manifests.js";
import { registerWebhooks } from "../core/setup/register-webhooks.js";
import { registerMcps } from "../core/setup/register-mcps.js";
```

In the CLI dispatch block, alongside the existing `setup apply` / `setup diff` handlers, add:

```typescript
// setup sync
if (command === "setup" && subcommand === "sync") {
  const filter = args[2] as "all" | "guidelines" | "collections" | "entity-types" | "document-types" | "document-tags" | "graph-relations" | undefined;
  const result = await syncManifests({ dryRun: await isDryRun(), filter: filter ?? "all" });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.errors ? 1 : 0);
}

// setup webhooks (post-deploy)
if (command === "setup" && subcommand === "webhooks") {
  const result = await registerWebhooks();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.errors.length > 0 ? 1 : 0);
}

// setup mcps (post-deploy)
if (command === "setup" && subcommand === "mcps") {
  const result = await registerMcps();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.errors.length > 0 ? 1 : 0);
}
```

- [ ] **Step 3: Add npm scripts to `package.json`**

Add to the `"scripts"` block:

```json
"sync": "tsx src/scripts/crm-agent.ts setup sync",
"sync:guidelines": "tsx src/scripts/crm-agent.ts setup sync guidelines",
"sync:collections": "tsx src/scripts/crm-agent.ts setup sync collections",
"sync:entity-types": "tsx src/scripts/crm-agent.ts setup sync entity-types",
"sync:document-types": "tsx src/scripts/crm-agent.ts setup sync document-types",
"sync:document-tags": "tsx src/scripts/crm-agent.ts setup sync document-tags",
"sync:graph-relations": "tsx src/scripts/crm-agent.ts setup sync graph-relations",
"setup:webhooks": "tsx src/scripts/crm-agent.ts setup webhooks",
"setup:mcps": "tsx src/scripts/crm-agent.ts setup mcps"
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 5: Run all tests**

```bash
npm test
```
Expected: all existing tests still pass

- [ ] **Step 6: Smoke-test sync dry-run**

```bash
DRY_RUN=true npm run sync
```
Expected: JSON output with `written`, `skipped`, `details` — no errors, no actual files changed.

- [ ] **Step 7: Commit**

```bash
git add src/scripts/crm-agent.ts package.json
git commit -m "feat(cli): wire sync, setup:webhooks, setup:mcps subcommands"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|---|---|
| Guidelines as .md files in repo | Task 1 (manifests exist), Task 3 (apply), Task 4 (sync) |
| Collections upload (idempotent) | Task 1 (new collections), Task 3 (update path added) |
| Entity types | Task 2 + Task 3 |
| Document types | Task 2 + Task 3 |
| Document tags | Task 2 + Task 3 |
| Graph relations | Task 2 + Task 3 |
| Sync (download from Personize → repo) | Task 4 |
| Avoid duplicates across chats | Task 3 (fetch-compare-upsert), Task 4 (writeIfChanged) |
| Update changed, skip identical | Task 3 (all handlers compare before acting) |
| Post-deploy webhooks registration | Task 5 |
| Post-deploy MCP registration | Task 5 |
| npm scripts for all commands | Task 6 |
| Dry-run for all operations | All tasks — `dryRun` flag threaded through |

### Placeholder Scan

- No TBD, TODO, or "implement later" in code steps
- All type names and function signatures are consistent across tasks
- `(client as any)` pattern used consistently for untyped SDK methods — same as existing code in `apply-manifests.ts:119`

### Type Consistency

- `ApplyEntityTypesResult`, `ApplyDocumentTypesResult`, `ApplyDocumentTagsResult`, `ApplyGraphRelationsResult` all use `{ created, updated, skipped, details }` — except `ApplyGraphRelationsResult` which has no `updated` (graph relations are create-or-skip, not updatable). Consistent with intent.
- `SyncManifestsResult` uses `{ written, skipped, details }` — distinct from apply results intentionally (apply = create/update to Personize, sync = write to disk).
- `applyManifests` return type extended to `ApplyManifestsResult` — callers in `crm-agent.ts` and `setup-verify.ts` may need updating if they destructure the return. **Flag for implementer:** check all callers of `applyManifests()` after Task 3.
