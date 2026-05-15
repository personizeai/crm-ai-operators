# CRM Agent Operating System

**The pattern library that gives your AI agents superpowers inside HubSpot and Salesforce.**

---

## One sentence

Personize is the memory and governance layer that turns generic AI agents into CRM-native operators — agents that know your contacts, follow your policies, and write back to your CRM automatically.

---

## The problem AI agents hit on day one

You hire an AI agent to help your revenue team. It's smart. It can write emails, score leads, draft proposals.

Then it hits HubSpot. It doesn't know which contacts are hot. It doesn't know your ICP. It doesn't know what your AE said on the last call. It writes something wrong to a field and you can't audit it. It hallucinates a deal stage.

You've built a capable AI agent with no institutional memory.

**That's the problem this repo solves.**

---

## What is this repo

A catalog of **26 operations** — patterns, prompts, workflows, and scripts — that teach AI agents how to work inside a CRM.

Organized into three capability tiers:

| Tier | What it means | Count |
|------|--------------|-------|
| `live` | Tested, production-ready | 24 |
| `scaffold` | Structure + spec, agent can fill in | 2 |
| `idea` | Description only, agent can build | 0 |

The agent reads this repo. Discovers what's possible. Extends it. Your team ships the operations that matter to your business in hours, not quarters.

---

## Getting started in 90 seconds

```
app.personize.ai/hubspot
```

1. Sign up with Google
2. Connect HubSpot (one OAuth click)
3. Done

In the background, Personize builds a **live two-way sync** between your HubSpot contacts and companies and a governed Personize memory layer — with 15 enriched AI properties pre-configured (ICP score, buying stage, next best action, win probability, and more).

When you land on your dashboard you'll see: *"1,247 contacts and 312 companies are ready for your AI agents."*

Your agents can start working on day one. No CSV exports. No prompt engineering for field names. No worrying about audit trails.

---

## The architecture in one diagram

```
Your AI Agent (Claude, Codex, Gemini, or any other)
        │
        ▼
┌───────────────────────────────────┐
│      CRM Agent Operating System   │  ← this repo
│  Operations │ Prompts │ Patterns  │
└───────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────┐
│            Personize              │
│  Memory · Governance · Audit      │
│  Collections · Guidelines         │
└───────────────────────────────────┘
        │
        ▼
┌─────────────┐    ┌──────────────┐
│   HubSpot   │    │  Salesforce  │  (+ any CRM via adapter)
└─────────────┘    └──────────────┘
```

Personize handles:
- OAuth + token refresh for every CRM
- Rate limiting and retry
- Audit log on every read and write
- Policy enforcement (dry-run mode, write-back rules, field allowlists)
- Institutional memory that persists across agent sessions

---

## What your agents can do

### Sales automation
- Score every inbound lead against your ICP in real time
- Write AI score + reason back to HubSpot/Salesforce automatically
- Surface the three highest-signal contacts for each AE every morning
- Generate personalized follow-up emails from meeting notes and CRM context
- Draft proposals from deal data, company firmographics, and past wins
- Flag cold deals and generate win-back sequences
- Auto-log call summaries and next steps to the CRM

### Marketing automation
- Segment contacts by buying stage, ICP fit, and engagement signals
- Generate monthly campaign sequences per segment
- Run A/B subject line variants and update CRM with engagement outcomes
- Score inbound form fills and route to the right sequence
- Build annual campaign calendars from CRM data patterns
- Create personalized landing pages per account (ABM)

### RevOps automation
- Sync contacts and companies bi-directionally (HubSpot ↔ Salesforce ↔ Personize)
- Normalize lifecycle stages across CRMs to a unified model
- Enforce data quality rules on every write (no blank owners, no stale stages)
- Generate pipeline health reports with AI narrative
- Detect duplicate contacts and propose merges
- Build and maintain the property schema across CRMs from manifests

### AE co-pilot
- Brief an AE before every discovery call: company context, past interactions, open items, news
- Recommend next best action based on buying stage and engagement history
- Auto-update deal stage from call notes
- Generate mutual action plan drafts from deal data

### Leadership & strategy
- Weekly pipeline narrative: where deals are stuck and why
- Win/loss pattern analysis across won and churned accounts
- ICP refinement from closed-won data
- Competitive intelligence logging from call notes and email

---

## Connecting your AI agent — three paths

This repo is **MCP-first**. Your agent talks to two MCP servers in parallel:

1. **Personize MCP** — already provided by Personize. Gives your agent memory, governance, and entity tools (`memory_save`, `context_retrieve`, `memory_filter_by_property`, etc.).
2. **crm-ai-operators MCP** — provided by this repo. Gives your agent CRM operations (`operation_list`, `operation_run`).

Both servers run side-by-side. The agent uses Personize for memory + governance, this repo for CRM operations.

### Path 1 — MCP (recommended; for Claude Code, Claude Desktop, Cursor, any MCP client)

Add to your MCP config (`claude_desktop_config.json` or `.claude/settings.json`):

```json
{
  "mcpServers": {
    "personize": {
      "command": "npx",
      "args": ["-y", "@personize/mcp"],
      "env": { "PERSONIZE_SECRET_KEY": "sk_live_..." }
    },
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

Your agent now has the full Personize tool surface plus this repo's `operation_list` and `operation_run`.

MCP profiles for crm-ai-operators:

| Profile | Can do |
|---------|--------|
| `planner` | Read-only + optimizations |
| `operator` | Run operations (dry-run by default) |
| `admin` | All operations including `setup.apply` |
| `auditor` | Audit log only |

### Path 2 — Personize Skill (recommended; teaches your agent when to use this repo)

Install the `crm-ai-operators` Personize skill so your agent knows the trigger conditions, the filter shape, and the task-queue workflow without you spelling them out each session:

```bash
personize skill install crm-ai-operators
```

The skill autoloads in any Claude / Cursor / agent session that's connected to your Personize org. It lives in [`skills/crm-ai-operators/SKILL.md`](skills/crm-ai-operators/SKILL.md).

### Path 3 — CLI (for scripts, CI/CD, cron jobs)

For batch jobs, scheduled runs, or local development:

```bash
npm install -g crm-ai-operators
export PERSONIZE_SECRET_KEY=sk_live_...

# Apply the base Personize schema (collections + guidelines)
crm-agent setup apply --crm hubspot

# List all available operations
crm-agent operation list

# Run an operation
crm-agent operation run score.icp-fit --crm hubspot
```

### Optional: Claude Code hooks for safety + observability

[`examples/claude-code-hooks.json`](examples/claude-code-hooks.json) ships with three opt-in hooks:
- **PreToolUse safety gate** — block live writes (`DRY_RUN=false`) unless a session token file is present
- **PostToolUse activity log** — append every `operation_run` call to a daily log
- **Notification → Slack forwarder** — surface critical handoffs to a webhook in <1 minute

Drop the relevant block into `.claude/settings.local.json`.

---

## The code your agents write

Every CRM call goes through the Personize passthrough — one API key, zero credential management:

```typescript
import { hubspot } from "./src/adapters/hubspot/adapter.js";

// List contacts
const page = await hubspot.contacts.list({ limit: 100, properties: ["email", "lifecyclestage"] });

// Update a contact
await hubspot.contacts.update(id, {
  ai_score: "87",
  ai_score_reason: "VP title, 500+ employees, recent pricing page visit",
  buying_stage: "evaluation",
});
```

For Salesforce:

```typescript
import { salesforce } from "./src/adapters/salesforce/adapter.js";

// SOQL query
const leads = await salesforce.query<Lead>(
  "SELECT Id, Name, Email, LeadScore__c FROM Lead WHERE Status = 'Open' LIMIT 200"
);

// Create sObject
await salesforce.sobject("Contact").create({ LastName: "Smith", Email: "smith@acme.com" });
```

Adding a new CRM: implement the `CrmAdapter` interface in `src/adapters/` — the core runtime, audit log, and governance layer are CRM-agnostic.

---

## What Personize adds (vs. calling the CRM directly)

| Without Personize | With Personize |
|-------------------|---------------|
| Credentials in every script | One API key, Personize handles OAuth |
| No memory across sessions | Every contact/company stored with AI properties |
| No audit trail | Every read and write logged with agent ID, timestamp, diff |
| No governance | Guidelines enforced before every write |
| Manual rate limiting | Personize handles retry, backoff, burst |
| CRM schema varies by customer | Personize normalizes to a standard model |
| Agent forgets context | Memory persists across agents, sessions, and CRMs |

---

## Naming and product tiers

| Layer | Name | What it is |
|-------|------|------------|
| Category | CRM Agent Operating System | The pattern library + runtime (this repo) |
| Platform | Personize for CRM Agents | Memory + governance + passthrough |
| First wedge | HubSpot AI Operator | Full-stack HubSpot automation |
| Second wedge | Salesforce AI Operator | Full-stack Salesforce automation |

---

## Pricing signal

Personize charges per seat. One Personize workspace gives your AI agents access to every operation in this repo, across every connected CRM, with a full audit trail.

The economic case: one AI agent running five operations from this repo replaces the manual work of two to three RevOps hours per day. At scale, customers report replacing 5–10 FTE-equivalent capacity across sales ops, marketing ops, and AE support — while improving data quality and reducing CRM debt.

---

## Status and roadmap

This repo is production-ready for HubSpot. Salesforce is in active scaffold. All `live` operations are in use by Personize customers today.

Planned:
- Pipedrive adapter
- Native Slack notifications from operation outcomes
- Webhook trigger support (CRM event → operation)
- Visual operation builder in the Personize dashboard

---

## Contributing

This is a public pattern library. If your AI agent builds a new operation that works, open a PR. Tag it with the right status (`scaffold` or `live`) and include the frontmatter spec. The community grows the library; Personize governs it.

---

## Links

- [Personize dashboard](https://app.personize.ai)
- [HubSpot AI Operator quickstart](https://app.personize.ai/hubspot)
- [Salesforce AI Operator quickstart](https://app.personize.ai/salesforce)
- [CRM Passthrough API docs](https://docs.personize.ai/crm-passthrough)
- [SDK reference](https://docs.personize.ai/sdk)
