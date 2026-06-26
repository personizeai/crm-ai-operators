# AGENTS.md — Operating instructions for AI agents in this repo

> This file is the entry point for any AI agent (Claude Code, Codex, Cursor,
> custom MCP-connected agents) opening this repo. Read it once at session
> start; it tells you what this repo is, how it's organized, and how to act.

---

## What this repo is

The **CRM Agent Operating System** — an open pattern library that turns
HubSpot, Salesforce, and other CRMs into AI-operable systems through
Personize. The repo's primary reader is **you**, the AI agent. It exists to
teach you what's possible with Personize + a connected CRM, and to give you
working starting points (operations) you can extend.

Three layers of capability:

1. **Memory layer** — every contact, company, deal, signal, conversation lives
   in Personize as a schema-enforced record. Define new properties via
   `manifests/core/collections/*.json`.
2. **Governance layer** — guidelines, ICP, brand voice, compliance live as
   plain-English markdown in `manifests/core/guidelines/*.md`. Every operation
   reads these before acting.
3. **Operations layer** — atomic units of work registered in
   `src/core/operations/registry.ts`. Each operation declares what it reads,
   what it writes, what governance it requires, and what its cost class is.
   You discover them via `operation_list`, run them via `operation_run`.

---

## Session startup — required reads

Run these on your first turn before responding:

1. **Load the agent operating playbook**:
   `context_retrieve(message='agent operating playbook', contextNames=['agent-playbook'])`
   This is the canonical RECALL → GOVERN → ACT → STORE loop. Every substantive
   turn follows it.

2. **Discover available operations**:
   - Via MCP: call the `operation_list` tool
   - Via CLI: read `src/core/operations/registry.ts`
   The returned metadata (`category`, `status`, `cost`, `idempotent`,
   `run_mode`, `guidelines_required`) tells you what each operation does and
   whether to run it.

3. **Load any guidelines relevant to the user's intent**:
   `context_retrieve(message=<user's first message>, types=['guideline'])`

4. **Surface state to the user** — what's set up, what operations are
   available, what you'll do this session.

---

## How to use the operations registry

Every operation has a `status`:

| Status | What `run()` does | What you do as the agent |
|--------|------------------|--------------------------|
| `live` | Executes the real algorithm, makes real Personize/CRM changes (gated by `DRY_RUN`). | Run it when its filter/inputs match the task. |
| `scaffold` | Returns a **rehearsal envelope** — `intent`, `inputs_received`, `would_read_from`, `would_write_to`, `governance_required`, `next_steps_to_make_live`. No real changes. | Read the rehearsal. If the user wants this done, follow `next_steps_to_make_live` to upgrade it to `live`. |
| `idea` | Returns a description-only response. No execution logic. | Treat as a spec. Implement only when the user asks for it. |

**Filter shape** (declarative JSON, not arbitrary code):

```json
{
  "collection": "contacts",
  "where": { "lifecycle_stage": "MQL", "ai_score": { "gte": 70 } },
  "limit": 100
}
```

Use this shape when calling operations. Operations declare what filter shape
they accept in their schema. Don't invent filter formats per operation.

**Run mode tells you when to run an operation:**

- `always` — schedule or trigger this on its natural cadence (e.g. nightly
  sync). Don't ask the user every time.
- `on-trigger` — run when an event fires (a webhook, a CRM change, a new
  signal). The trigger comes from outside.
- `on-decision` — run only when reasoning concludes it's needed. Don't run
  speculatively.
- `manual` — only when the user explicitly asks.

---

## How to add a new operation

When the user asks for new behavior that doesn't fit an existing operation:

1. **Pick a category**: `setup`, `sync`, `research`, `score`, `generate`,
   `analyze`, `act`, `optimize`. Each operation does one thing in one
   category.
2. **Declare the contract**: what records it reads, what governance it needs,
   what properties it writes, what its cost class is.
3. **Start as `scaffold`**: return the rehearsal envelope first. Confirm with
   the user that the intent and contract are right.
4. **Promote to `live`**: implement the algorithm, write tests, update the
   `status` field.
5. **Always write to workspace**: append to `workspace.updates` on every
   record you touch. This is how teammate agents see what you did.

---

## Hard rules

These rules apply to every operation in this repo, every agent that runs them.

1. **CRM access goes through Personize, never raw fetch.** Two surfaces, by job:
   - **Bulk record import / write-back** (contacts, companies, deals) →
     Personize-managed sync via `src/adapters/personize-sync.ts`
     (`crm.sync-core` for sync-in, `crm.sync-out` for write-back). Personize
     owns the connection, pagination, field mapping, dedupe, and association
     linking — our code only picks a provider + objects and triggers/polls.
   - **Engagement side-channel** (emails, tasks, notes, lifecycle reads) →
     `src/adapters/{hubspot,salesforce}/adapter.ts`, which wraps the Personize
     CRM Passthrough (OAuth, rate limiting, audit handled for you).

   Never call HubSpot or Salesforce APIs directly, and never paginate/field-map
   bulk records by hand — that's the managed sync's job.

2. **Default to `DRY_RUN=true`.** Live writes (Personize or CRM) require
   `DRY_RUN=false` in the environment. Show what you would do before doing it.

3. **Read governance before writing.** Before any `act.*` or `generate.*`
   operation runs, load the relevant guideline via `context_retrieve`. Apply
   the rules. Do not improvise.

4. **Workspace writes are mandatory.** Every operation that touches a record
   appends to that record's `workspace.updates` array. Cross-agent visibility
   is a feature, not a side effect.

5. **Never overwrite human-entered CRM values** unless the operation's mapping
   explicitly allows it. Low-confidence AI values write to dedicated AI custom
   properties on the CRM, not to native fields.

6. **Idempotence first.** An operation should be safe to re-run on the same
   record. Use `skip_if` to avoid re-doing work that's already fresh.

---

## Where things live

```
crm-ai-operators/
├── README.md                      ← marketing pitch
├── AGENTS.md                      ← this file
├── docs/
│   └── RUNTIME.md                 ← Setup / Operation / Optimization modes
├── manifests/
│   ├── core/                      ← CRM-independent (always applied)
│   │   ├── collections/*.json     ← Personize schema definitions
│   │   └── guidelines/*.md        ← governance, applied via setup.apply
│   ├── hubspot/                   ← HubSpot-specific manifests
│   └── salesforce/                ← Salesforce-specific manifests
├── src/
│   ├── core/
│   │   ├── config.ts              ← Personize SDK client (lazy)
│   │   ├── operations/
│   │   │   ├── registry.ts        ← all operations registered here
│   │   │   └── types.ts           ← OperationEntry, ScaffoldResult, etc.
│   │   ├── runtime/
│   │   │   ├── operation-runner.ts  ← runs operations + audit + run-store
│   │   │   ├── audit-log.ts       ← JSONL append per day
│   │   │   └── run-store.ts       ← persists to Personize operation-runs
│   │   ├── setup/
│   │   │   └── apply-manifests.ts ← idempotent collection + guideline upsert
│   │   └── lib/                   ← logger, dry-run, helpers
│   ├── adapters/
│   │   ├── passthrough.ts         ← Personize CRM Passthrough wrapper
│   │   ├── hubspot/adapter.ts     ← HubSpot typed surface
│   │   └── salesforce/adapter.ts  ← Salesforce typed surface
│   ├── mcp/server.ts              ← MCP server (operation_list, operation_run)
│   └── scripts/crm-agent.ts       ← CLI
└── data/
    └── audit/*.jsonl              ← per-day audit log
```

---

## Common patterns to follow

**When the user mentions a contact or company by email/domain:**
Recall first via `memory_retrieve(email=...)`. Don't act on conversational
context alone.

**When the user asks "how do we handle X":**
Search guidelines via `context_retrieve(message=...)`. Don't make up a policy.

**When the user wants something done at scale (5+ records):**
Use `operation_run` with a filter, not a loop of individual API calls.
Operations are designed to batch.

**When you complete an action:**
Append to the entity's `workspace.updates` array AND store an atomic fact
via `memory_save(email=..., content=...)`. The audit trail is not optional.

**When to use the `tasks` collection vs acting directly:**
Create a task when the work is queued, deferred, requires approval, or needs
cross-agent visibility before execution. Just act when the work is the
immediate execution of the current operation. See `tasks-and-projects` guideline.

---

## Anti-patterns

- **Reading raw CRM data inside a script.** Scripts read from Personize.
  CRM is a side-channel for engagement context (emails, tasks, notes), not a
  primary source. The exception is `sync.*` operations whose entire job is
  CRM ↔ Personize movement.

- **Inventing a filter shape per operation.** All filters are declarative
  JSON in the standard shape. Don't write per-operation filter parsers.

- **Skipping the rehearsal envelope.** When you write a new scaffold, return
  the full envelope (`intent`, `would_read_from`, `would_write_to`,
  `next_steps_to_make_live`). One-line summaries are not useful.

- **Overwriting a human-entered CRM value.** Always check whether the field
  was set by a human before writing. Use the CRM-side AI custom properties
  for AI-generated values.

- **Writing direct CRM API calls.** Always go through the adapter so the
  passthrough handles OAuth, rate limits, and audit.
