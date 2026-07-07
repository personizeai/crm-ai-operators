# Running on Personize Private (self-hosted)

crm-ai-operators runs against **Personize Private** — the self-hosted Personize
gateway (one Docker container, your Postgres, your LLM). The same operations and
engine run fully inside your network: raw CRM data never leaves your
infrastructure. This is the wedge for regulated industries where the hosted cloud
isn't an option.

## How it works

All Personize access funnels through the lib modules, which talk to a single
`client`. In private mode, `client` is a **fetch-based gateway shim**
(`src/core/lib/gateway-client.ts`) that translates the SDK calls the operations
make into the gateway's REST API. Hosted mode is unchanged and the gateway path
is inert unless you turn it on.

```
Operations ─▶ lib (recall/persist/ai/governance/…) ─▶ client
                                                        ├─ hosted  → @personize/sdk → Personize Cloud
                                                        └─ private → gateway shim (REST) → your gateway
```

## Enable it

Set the mode and point at your gateway (see `docs/` "Personize Private" handbook
for standing up the container):

```bash
PERSONIZE_MODE=private            # or omit — auto-selected when GATEWAY_URL is set
PERSONIZE_GATEWAY_URL=https://your-gateway-host
PERSONIZE_GATEWAY_KEY=your-gateway-bearer   # the GATEWAY_API_KEY you configured
```

`PERSONIZE_SECRET_KEY` is not used in private mode. `DRY_RUN=true` still applies.

## What works, and what's hosted-only

Capability flags (`src/core/config.ts`) gate features by backend. Operations
declare what they need via `requires: [...]`; the runner refuses an op with a
clear message when the backend can't meet it, and the triage menu hides them.

| Capability | Hosted | Private | Notes |
|---|---|---|---|
| Filtered record queries | ✅ | ✅ | Dispatcher routing + operation recall |
| Property writes / structured save | ✅ | ✅ | `/memory/save` with authoritative properties |
| Prompt generation (governed `ai()`) | ✅ | ✅ | Gateway `/prompt` |
| Bulk memorize | ✅ | ✅ | Hosted Bedrock Batch / gateway `/memory/import` |
| Guidelines (governance) | ✅ | ✅ | `shape:'document'` + recordless retrieve |
| **serverOutputs → property sync** | ✅ server-side | ✅ **client-side fallback** | ai() writes properties from the validated output using the same collectionId/propertyId mapping — same declarative contract, run client-side |
| **Autonomous subagents** (`ai({ autonomous: true })`) | ✅ | ❌ | `research.*` ops require `subagent`; refused in private until the gateway subagent contract ships |
| **Rubric eval** (`evaluate`) | ✅ | ❌ | Use the self-check instruction pattern instead (works on both) — see `lib/instruction-patterns.ts` |
| Multi-step `instructions[]` | ✅ | ❌ | Needs server-side `<output>` extraction; use single-prompt instructions |
| Outbound platform webhooks | ✅ | ➖ | Gateway has no outbound events; drive dispatch via its `/schedules` (cron/rate) instead |

Operations unavailable in private mode today: `research.account-deep-dive`,
`research.contact-background` (autonomous web research). Everything else — scoring,
analysis, generation (incl. the self-verifying outreach sequence), sync, reports,
optimize, and all dispatch patterns (sequential/parallel/batch/chain/triage) — runs.

## Setup (schema + guidelines)

The engine needs its collections (contacts, companies, conversations, signals,
tasks, projects, plus the engine's own dispatch-routes, orchestrator-config,
orchestrator-logs, operation-runs) and the 18 guidelines. On the gateway, provision
these with its own schema tools rather than the hosted `setup.apply`:

- **Collections + entity types:** the gateway's `/collections` and `/entity-types`
  REST endpoints (or the `collection_*` / `schema_manage` MCP tools). The shapes in
  `manifests/core/` are the source of truth for what to create.
- **Guidelines:** save each `manifests/core/guidelines/*.md` as a governance
  document — `POST /memory/save` with `shape:"document"`, `docType:"guideline"`.

## Triggering work

Hosted uses webhooks. Private has no outbound events, so drive the dispatcher on a
schedule using the gateway's PG-native scheduler:

```bash
curl -X POST $GW/schedules -d '{"name":"dispatch","schedule":"rate(5 minutes)","payload":{"prompt":"run dispatch cycle"}}'
```

…or run the engine's own loop on a cron in your cluster.

## Validation status

The gateway shim's endpoint contracts follow the Personize Private handbook
v0.5.0. The pure translation logic (filter nesting, response mapping, capability
gating, client-side output fallback) is unit-tested via a stubbed fetch. The
end-to-end path against a live gateway is exercised by
`src/__tests__/gateway-integration.test.ts`, which **skips unless
`PERSONIZE_GATEWAY_URL` is set** — run it against a real gateway to validate:

```bash
PERSONIZE_MODE=private PERSONIZE_GATEWAY_URL=http://localhost:3000 \
  PERSONIZE_GATEWAY_KEY=... npm test
```

A local gateway for this is provided in `docker-compose.gateway.yml`.
