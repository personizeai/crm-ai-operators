# Salesforce Integration

> Salesforce shipped major agentic capabilities at TDX 2026 (April 15-29). This doc covers what we adopted, what we passed on, and why.

## TL;DR

`crm-ai-operators` integrates with Salesforce via the **Personize Passthrough** — a single transport that works on every Salesforce edition (Pro / Enterprise / Unlimited). Personize handles auth, rate limit, audit, governance, and memory.

We've evaluated and **passed on** Salesforce Hosted MCP. We're separately pursuing **AgentExchange listing** as a distribution channel — see [`agentexchange-plan.md`](agentexchange-plan.md).

## Why we passed on Hosted MCP

Salesforce Hosted MCP (GA Apr 15, 2026) is genuinely well-designed: per-user CRUD/FLS/sharing enforcement, Salesforce-managed auth + rate limit + audit, Enterprise+ free.

But:

- **Enterprise Edition+ only.** Pro Edition customers — a meaningful slice of the SMB market — can't use it.
- The Personize Passthrough already provides auth + rate limit + audit, **uniformly across HubSpot and Salesforce, on every edition**.
- Adding a second SF transport doubles the surface area we maintain and test, for benefit only to the Enterprise+ slice.

Re-evaluate if concrete Enterprise customer demand justifies the build cost.

## What Salesforce released at TDX 2026

### Salesforce Hosted MCP Servers — GA April 15, 2026

- Read **and** write — full record CRUD
- OAuth 2.0 + PKCE via External Client App
- New scopes: `mcp_api` + `refresh_token` (distinct from REST scopes)
- Enforces **per-user CRUD/FLS/sharing rules** at the Salesforce layer
- Free with Enterprise Edition+

### Headless 360

Salesforce's positioning shift: "everything as API, MCP tool, or CLI." Aligns with our framing.

### AgentExchange

Marketplace for partner agents and MCP servers. $50M Builders Initiative. We're pursuing a listing — see [`agentexchange-plan.md`](agentexchange-plan.md).

### Things we don't use

| Release | Why not |
|---------|---------|
| **Agentforce Vibes Skills** (30+ coding skills) | These are *coding skills* for Claude Code / Cursor / Codex during Salesforce **development** (Apex, LWC, Flow). Not a registry for runtime operation libraries. |
| **Agentforce subagents** | For building agents **inside** Agentforce. We're external agents operating Salesforce. |
| **Agentforce Python SDK** | For building Agentforce agents. We use REST/MCP from external. |
| **AgentScript** | Schema-driven orchestration DSL for in-Agentforce. |

## Where Personize stays load-bearing

Personize is the source of truth for:

1. **Memory across sessions and CRMs** — what the org knows about a contact survives across SF, HubSpot, and any connected system.
2. **Governance** — guidelines (`icp-definition`, `brand-voice`, `outreach-playbook`, etc.) apply uniformly.
3. **Cross-entity workspace** — `tasks`, `signals`, `conversations`, `monitors`, `alerts` collections aggregate state across CRMs.
4. **Operation orchestration** — `crm.sync-core`, `score.icp-fit`, `generate.outreach-sequence` are CRM-agnostic.
