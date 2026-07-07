# Starter Kit Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two starter-kit deliverables: (1) example dispatch routes that operators can load into Personize via MCP or CLI, and (2) `.env.example` updated with all engine env vars added in Plan 2.

**Architecture:** Example routes live in `manifests/examples/dispatch-routes.example.json` as an array of DispatchRoute objects. The existing `setup apply` flow does NOT auto-load this file — it is documentation/seed data operators copy-paste into `route_create` MCP calls or load manually. `.env.example` is a plain file at repo root.

**Tech Stack:** JSON, plain text. No code changes to TypeScript files.

## Global Constraints

- JSON files must be valid JSON (no comments)
- Route `filter_json` values must be valid JSON strings (double-escaped)
- No new TypeScript files
- Commit message: `feat(starter-kit): example dispatch routes + env vars`

---

### Task 1: Example Dispatch Routes

**Files:**
- Create: `manifests/examples/dispatch-routes.example.json`

**Purpose:** Give operators 5 ready-to-use dispatch routes covering the most common use cases. Each route is a complete DispatchRoute object matching the schema in `manifests/core/collections/dispatch-routes.json`.

**DispatchRoute shape** (all fields):
```json
{
  "route_id": "route_<slug>",
  "name": "Human name",
  "description": "What this route does",
  "priority": 10,
  "enabled": true,
  "filter_json": "{\"collection\":\"contact\",\"conditions\":[{\"propertyName\":\"lead_status\",\"operator\":\"equals\",\"value\":\"New\"}],\"logic\":\"AND\",\"limit\":50}",
  "target_type": "operation",
  "target_name": "score.icp-fit",
  "max_per_cycle": 50,
  "created_at": "2026-07-01T00:00:00.000Z",
  "updated_at": "2026-07-01T00:00:00.000Z"
}
```

- [ ] **Step 1: Create `manifests/examples/dispatch-routes.example.json`**

```json
[
  {
    "route_id": "route_score-new-leads",
    "name": "Score New Leads",
    "description": "ICP-score contacts with lead_status=New. Runs first (priority 10) so scored leads can be re-routed by lower-priority routes in the same cycle.",
    "priority": 10,
    "enabled": true,
    "filter_json": "{\"collection\":\"contact\",\"conditions\":[{\"propertyName\":\"lead_status\",\"operator\":\"equals\",\"value\":\"New\"}],\"logic\":\"AND\",\"limit\":50}",
    "target_type": "operation",
    "target_name": "score.icp-fit",
    "max_per_cycle": 50,
    "created_at": "2026-07-01T00:00:00.000Z",
    "updated_at": "2026-07-01T00:00:00.000Z"
  },
  {
    "route_id": "route_research-hot-accounts",
    "name": "Research Hot Accounts",
    "description": "Run account research on companies with lifecycle_stage=MQL that haven't been researched yet (account_research_status is empty).",
    "priority": 20,
    "enabled": true,
    "filter_json": "{\"collection\":\"company\",\"conditions\":[{\"propertyName\":\"lifecycle_stage\",\"operator\":\"equals\",\"value\":\"MQL\"},{\"propertyName\":\"account_research_status\",\"operator\":\"is_empty\",\"value\":null}],\"logic\":\"AND\",\"limit\":25}",
    "target_type": "operation",
    "target_name": "research.account",
    "max_per_cycle": 25,
    "created_at": "2026-07-01T00:00:00.000Z",
    "updated_at": "2026-07-01T00:00:00.000Z"
  },
  {
    "route_id": "route_generate-outreach-qualified",
    "name": "Generate Outreach for Qualified Leads",
    "description": "Generate personalized outreach sequence for contacts with icp_score >= 70 that don't have outreach_status set yet.",
    "priority": 30,
    "enabled": true,
    "filter_json": "{\"collection\":\"contact\",\"conditions\":[{\"propertyName\":\"icp_score\",\"operator\":\"gte\",\"value\":70},{\"propertyName\":\"outreach_status\",\"operator\":\"is_empty\",\"value\":null}],\"logic\":\"AND\",\"limit\":20}",
    "target_type": "operation",
    "target_name": "generate.outreach-sequence",
    "max_per_cycle": 20,
    "created_at": "2026-07-01T00:00:00.000Z",
    "updated_at": "2026-07-01T00:00:00.000Z"
  },
  {
    "route_id": "route_classify-replies",
    "name": "Classify Inbound Replies",
    "description": "Analyze sentiment and intent of contacts with reply_received=true that haven't been classified yet.",
    "priority": 40,
    "enabled": true,
    "filter_json": "{\"collection\":\"contact\",\"conditions\":[{\"propertyName\":\"reply_received\",\"operator\":\"equals\",\"value\":true},{\"propertyName\":\"reply_sentiment\",\"operator\":\"is_empty\",\"value\":null}],\"logic\":\"AND\",\"limit\":50}",
    "target_type": "operation",
    "target_name": "analyze.reply-sentiment",
    "max_per_cycle": 50,
    "created_at": "2026-07-01T00:00:00.000Z",
    "updated_at": "2026-07-01T00:00:00.000Z"
  },
  {
    "route_id": "route_flag-stale-opportunities",
    "name": "Flag Stale Opportunities",
    "description": "Create a human review task for open opportunities with no activity in 14+ days. Routes to task type so a human is alerted.",
    "priority": 50,
    "enabled": false,
    "filter_json": "{\"collection\":\"contact\",\"conditions\":[{\"propertyName\":\"deal_stage\",\"operator\":\"equals\",\"value\":\"In Progress\"},{\"propertyName\":\"days_since_activity\",\"operator\":\"gte\",\"value\":14}],\"logic\":\"AND\",\"limit\":30}",
    "target_type": "task",
    "target_name": "review-stale-opportunity",
    "max_per_cycle": 30,
    "created_at": "2026-07-01T00:00:00.000Z",
    "updated_at": "2026-07-01T00:00:00.000Z"
  }
]
```

- [ ] **Step 2: Validate the JSON is parseable**

```bash
node -e "JSON.parse(require('fs').readFileSync('manifests/examples/dispatch-routes.example.json', 'utf8')); console.log('valid')"
```
Expected: `valid`

Also validate each `filter_json` value is parseable:
```bash
node -e "
const routes = JSON.parse(require('fs').readFileSync('manifests/examples/dispatch-routes.example.json', 'utf8'));
routes.forEach(r => { JSON.parse(r.filter_json); console.log(r.route_id, 'filter_json OK'); });
"
```
Expected: all 5 route IDs printed with `filter_json OK`

---

### Task 2: Update `.env.example`

**Files:**
- Modify: `.env.example`

**Current content:**
```
PERSONIZE_SECRET_KEY=sk_live_your_key_here
DRY_RUN=true
LOG_LEVEL=info
PERSONIZE_API_BASE_URL=https://agent.personize.ai
PERSONIZE_CRM_CONNECTION_ID=
MCP_PROFILE=planner
```

**Missing vars added in Plan 2:**
- `PERSONIZE_WEBHOOK_SECRET` — HMAC secret for validating Personize webhook signatures
- `ENGINE_PORT` — HTTP port for the webhook server (default: 3000)
- `PERSONIZE_WEBHOOK_URL` — the deployed engine URL (used by `setup webhooks` to register with Personize)

- [ ] **Step 1: Update `.env.example`**

Replace the file with:

```
# Personize API credentials
PERSONIZE_SECRET_KEY=sk_live_your_key_here
PERSONIZE_API_BASE_URL=https://agent.personize.ai
PERSONIZE_CRM_CONNECTION_ID=

# Engine safety — dry-run is ON by default; set to false only in production
DRY_RUN=true
LOG_LEVEL=info

# MCP profile: planner (default) | operator | admin | auditor
MCP_PROFILE=planner

# Engine webhook server
ENGINE_PORT=3000
PERSONIZE_WEBHOOK_SECRET=whsec_your_secret_here
PERSONIZE_WEBHOOK_URL=https://your-deployed-engine.example.com/webhook
```

- [ ] **Step 2: Commit both files**

```bash
git add manifests/examples/dispatch-routes.example.json .env.example
git commit -m "feat(starter-kit): example dispatch routes + env vars"
```

---

## Self-Review

### Spec Coverage
- Example routes cover: score (ICP), research (account), generate (outreach), analyze (reply), task (human review)
- All route IDs use `route_` prefix as documented in dispatch-routes.json schema
- One route is `enabled: false` (stale opportunities) — demonstrates the disable-without-delete pattern
- filter_json uses `collection` field matching entity type names used in recall.ts
- `.env.example` now documents all vars introduced across Plan 1 + Plan 2

### Placeholder Scan
- No TODO or TBD
- All operation names match registry: `score.icp-fit`, `research.account`, `generate.outreach-sequence`, `analyze.reply-sentiment`
