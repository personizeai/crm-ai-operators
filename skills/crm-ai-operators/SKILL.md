---
name: crm-ai-operators
description: Use this skill when the user wants to operate inside HubSpot, Salesforce, or any connected CRM through Personize — scoring contacts/companies, syncing CRM data, generating outreach, analyzing replies, researching accounts, or any task in the categories sync/research/score/generate/analyze/act. Triggers on "score my contacts", "sync HubSpot", "draft a sequence for X", "research this account", "qualify these leads", "find tasks for me to work on", "summarize replies", or any explicit mention of CRM operations or AI revenue ops. Also triggers when the user asks to install or configure crm-ai-operators.
---

# CRM AI Operators

You have access to the **crm-ai-operators** MCP server, which exposes the CRM Agent Operating System — an open pattern library that turns leading CRMs into AI-operable systems through Personize.

## When this skill applies

Use this skill (and the crm-ai-operators tools) when the user wants to:
- Score contacts or companies against ICP
- Sync HubSpot or Salesforce data into Personize
- Generate outreach sequences, proposals, or meeting briefs
- Analyze inbound replies and route them
- Research an account or contact before outreach
- Pick up open tasks from the work queue
- Review past operation runs and propose improvements

## Available tools (from the `crm-ai-operators` MCP server)

- **`operation_list`** — discover all operations registered in this repo. Returns each operation's name, mode, category, status (`live | scaffold | idea`), cost, idempotence, run-mode, and required guidelines.
- **`operation_run`** — execute an operation by name with optional inputs. Live operations make real changes (gated by `DRY_RUN`). Scaffolds return a rehearsal envelope describing what they'd do.

## How to use

1. **At session start**, also call `personize_md()` from the Personize MCP — it tells you what collections exist in the user's org.
2. **Before any substantive action**, call `operation_list` to see what's available. Filter by `category` and `status` to narrow.
3. **Match the user's intent to a category**: sync / research / score / generate / analyze / act / optimize.
4. **Read required guidelines** for the operation via `context_retrieve(contextNames=['<guideline-name>'])` before running.
5. **Run with `operation_run`**. Default to `DRY_RUN=true`. Only set `DRY_RUN=false` after the user explicitly authorizes for this session.

## Filter shape (declarative)

When an operation accepts a `filter` input, use this exact shape:

```json
{
  "collection": "contacts",
  "where": { "lifecycle_stage": "MQL", "ai_score": { "gte": 70 } },
  "limit": 100
}
```

The same shape works across all operations. Don't invent per-operation filter formats.

## Working from the task queue

The user's org has a `tasks` collection (entityType: `task`). Pull open tasks and work through them:

```
memory_filter_by_property(
  type='task',
  conditions=[
    {propertyName: 'status', operator: 'equals', value: 'open'},
    {propertyName: 'assigned_to', operator: 'equals', value: 'agent'}
  ],
  logic='AND'
)
```

Sort by `priority` descending, `due_date` ascending. Each task's `task_type` tells you which operation should execute it (see `tasks-and-projects` guideline for the routing table).

When done with a task: update `status` to `done`/`cancelled`/`declined`, set `completed_at` and `outcome`, and append a corresponding entry to the linked entity's `workspace.updates`.

## Hard rules

1. **CRM access goes through the operation runner**, not raw fetch. The operations wrap the Personize CRM Passthrough; you should not call HubSpot or Salesforce APIs directly.
2. **Default to DRY_RUN.** Never set `DRY_RUN=false` without explicit user authorization for the current session.
3. **Read governance before writing.** Operations that generate content or write to CRM require their `guidelines_required` to be loaded first.
4. **Workspace writes are mandatory.** Every operation that touches a record appends to that record's `workspace.updates` — this is how cross-agent visibility works.
5. **Opt-outs are permanent.** Never act on a contact with `opted_out=true`, regardless of context.

## Installation reminder

If the user hasn't installed the crm-ai-operators MCP server yet, the recommended path is:

```json
{
  "mcpServers": {
    "crm-ai-operators": {
      "command": "npx",
      "args": ["-y", "crm-ai-operators"],
      "env": {
        "PERSONIZE_SECRET_KEY": "sk_live_...",
        "MCP_PROFILE": "operator"
      }
    }
  }
}
```

`MCP_PROFILE` controls what the agent can run: `planner` (read-only), `operator` (live ops, default), `admin` (incl. setup), `auditor` (audit log only).
