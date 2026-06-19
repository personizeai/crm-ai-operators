# Plan — Unified SDK Migration + `personize_*` Property Provisioning

**Status:** Proposed · **Target SDK:** `@personize/sdk@^0.14.0` · **Target CLI:** `@personize/cli@^0.7.0`
**Repo:** crm-ai-operators · **Author:** generated from migration assessment, 2026-06-17

---

## Why we are doing this (the objective)

This repo exists to **save companies thousands of dollars and automate hundreds of hours of CRM work**.
The customer journey we are optimizing:

1. Company connects **HubSpot / Salesforce → Personize** (one OAuth click).
2. Based on what they need, this repo **provisions `personize_*` custom properties** on their CRM
   **contacts** and **companies** (e.g. `personize_ai_score`, `personize_buying_stage`,
   `personize_next_best_action`).
3. **Setup** seeds Personize collections + guidelines and wires governance.
4. **Operate**: AI subagents score, enrich, generate, and write back — every action governed and audited.

Every change below is justified against that objective: fewer moving parts (cheaper to run and maintain),
a typed/governed write path (fewer bad writes = less CRM debt), and a setup flow that actually creates
the CRM fields customers see on day one.

The SDK just shipped **unified Save** and **unified Retrieve** and a named **`subagent`** verb. Adopting
them lets us delete the brittle compatibility layer this repo carries and speak the platform's vocabulary
directly.

### What counts as a "Personize property" (provenance ≠ writeback)

A property Personize populates can have one of several **provenances**:

- **`inferred`** — derived by the LLM from internal context (buying stage, ICP fit score, sentiment, next best action).
- **`extracted`** — *structured* data pulled/normalized from public sources or external tools (website, LinkedIn, signatures, transcripts; and yes, things like headcount, industry, seniority). This is structured data, not LLM prose.
- **`crm`** — originated in the connected CRM (email, domain, record id). Not written back.

**Provenance is orthogonal to whether we sync the value to the CRM**, and writeback is NOT limited to
LLM-inferred fields — structured **`extracted`** data is just as writeback-worthy. Example: `employee_count`
is `autoSystem:false` today yet is exactly the kind of field a customer wants in HubSpot. The plan fixes
this (see Phase 6 + D3).

> **Scope note:** this repo adds **no enrichment vendors / external data APIs** (Apollo, Clearbit, etc.).
> Where extracted/structured values come from is Personize's concern; this repo only decides which
> Personize-populated properties to write back. `extracted` is a provenance *label*, not an integration.

---

## Current state (verified)

| Area | Today | Problem |
|---|---|---|
| SDK pin | `^0.9.3` (installed 0.9.3) | 5 minor releases behind `0.14.0`; pre-unification API generation |
| AI calls | `aiPrompt()` wrapper in `src/core/lib/ai.ts` (~470 lines) with legacy `generate`/`complete` fallbacks | Half the file guards SDK shapes that no longer exist |
| Reads | `(client as any).memory.filterByProperty(...)`, repeated coverage scans | Untyped, deprecated, N calls where 1 `retrieve` suffices |
| Writes | `(client as any).memory.updateProperty(...)` | Untyped, deprecated; no graph/relations |
| Guidelines | `(client as any).context.list/create/update` | Untyped `any` casts |
| CRM calls | hand-rolled `crmPassthrough()` raw `fetch` in `src/adapters/passthrough.ts` | Reimplements what the SDK now ships natively + typed |
| CRM property creation | **none** — `apply-manifests.ts` only creates Personize collections/guidelines | The `personize_*` CRM fields are assumed pre-existing; setup never provisions them |
| README | "26 operations / 15 AI properties", HubSpot-first, feature-led | Not framed around $ saved / hours automated; writeback examples use bare field names (`ai_score`) not `personize_*` |

**Non-breaking guarantee:** the full exported type surface diff `0.9.3 → 0.13.0 → 0.14.0` removed **zero**
exports. v1.1 (`client.v1_1.*`) and unified `client.retrieve()` live in *new* namespaces beside v1. The
methods this repo uses still exist (now `@deprecated`-aliased), so the bump itself cannot break the build.

---

## The consolidation we are adopting

```
DEPRECATED (this repo's era)            UNIFIED SUCCESSOR (0.14.0)
─────────────────────────────────      ─────────────────────────────────────────────
client.memorize                    →    client.memory.save({ shape:'shortform', content })
client.memorizeBatch               →    client.memory.saveBatch(...)
document write + extraction         →    client.memory.save({ shape:'document', properties, options:{enrich} })
memory.updateProperty              →    client.memory.save({ shape:'document', properties, options:{upsert} })
memory.filterByProperty            →    client.retrieve({ mode:'filter', filters })
recall / smartRecall / smartDigest →    client.retrieve({ mode:'brief'|'expand'|'scout' })
client.search                      →    client.retrieve({ mode:'fetch' })
context.list/create/update (any)   →    client.context.* (typed)
ai.prompt (autonomous use)         →    ai.subagent(...)   ← same endpoint, agentTools on
hand-rolled crmPassthrough()       →    client CRM passthrough + typed Hubspot*/Salesforce* models
```

`client.retrieve()` modes: `scout | brief | expand | filter | fetch` (session-continuable via `continueFrom`).
`client.memory.save()` `SaveRequest`: `{ shape, type?, recordId?, content?, properties?, options?, relations?, collectionGraph?, smartGraph? }`.

---

## `ai.prompt` vs `ai.subagent` — naming decision (CONFIRMED by product)

Both hit `POST /api/v1/prompt` with the same response shape. `subagent` defaults `agentTools:true`,
`governedMemory:false`. We will **expose two verbs in our wrapper** that mirror the SDK:

- `aiPrompt()` — deterministic, single/multi-step extraction with governed memory. Used by `score.*`,
  `analyze.*`, `report.*` (structured outputs).
- `aiSubagent()` — autonomous, tool-using runs ("research this account, enrich the record, draft outreach").
  Used by `research.*`, `act.*`, multi-tool `generate.*`.

Rationale: `subagent` is the marketing-legible word for "an agent that plans and acts," and it matches
the platform vocabulary, at zero behavioral cost.

---

## Phases

### Phase 1 — Bump + green baseline (no behavior change)
- `@personize/sdk` `^0.9.3 → ^0.14.0`; note CLI `^0.7.0` in docs (repo doesn't depend on CLI directly).
- `npm install`, regenerate `package-lock.json`.
- `npm run typecheck && npm test` — establish a passing baseline before any rewrite.
- **Exit:** typecheck + tests green on 0.14.0 with zero code changes.

### Phase 2 — Wrapper: `aiPrompt()` + `aiSubagent()`
- In `src/core/lib/ai.ts`: delete `runLegacySinglePrompt` and the `generate`/`complete` branches.
- Keep the multi-step + single-prompt paths; add `aiSubagent()` that sets the autonomous defaults.
- Update the handful of call sites (`grep client.ai.prompt`) to the correct verb per operation category.
- **Exit:** `ai.ts` shrinks ~40%; typecheck green; tests green.

### Phase 3 — Reads → unified Retrieve
- Replace `(client as any).memory.filterByProperty(...)` with typed `client.retrieve({ mode:'filter', filters })`.
- Collapse `getCoverageStats()`'s 4 calls into fewer `retrieve` calls where possible.
- Touch: `sync-push-properties.ts`, `crm-sync-core.ts`, `sync-normalize-lifecycle.ts`, `score-*`, `analyze-deduplication.ts`, governance reads in `src/core/lib/governance.ts`.
- **Exit:** no `filterByProperty` references remain; typecheck/tests green.

### Phase 4 — Writes → unified Save
- Replace `(client as any).memory.updateProperty(...)` with `client.memory.save({ shape:'document', recordId/email, properties, options:{ upsert:true, aiGenerated:true } })`.
- Where we persist entity relationships (contact↔company↔deal), pass declared `relations[]`.
- **Exit:** no `updateProperty`/`memorize` references; writes typed; tests green.

### Phase 5 — Native CRM passthrough
- Replace `src/adapters/passthrough.ts` raw `fetch` with the SDK's CRM passthrough; adopt typed
  `HubspotContact/Company/Deal`, `SalesforceQueryResult/CreateResult/UpsertResult`.
- Keep the `CrmAdapter` interface so "add a CRM" stays a one-file job.
- **Exit:** passthrough boilerplate deleted; adapters compile against SDK types; tests green.

### Phase 6 — Setup provisions `personize_*` CRM properties  ← NEW capability
- **Manifest schema change (decouple writeback from provenance):** add two fields to
  `CollectionPropertySchema` in `apply-manifests.ts`:
  - `source: "inferred" | "extracted" | "crm"` — provenance label (see definition above).
  - `writeback: boolean` — whether setup provisions this on the CRM. **This — not `autoSystem` — is the
    gate.** Backfill the manifests: mark inferred + extracted *value* fields `writeback:true`
    (including currently-`autoSystem:false` structured fields like `employee_count`); keep `crm`-origin and
    structural/append-log fields (`updates`, `notes`, `decisions`, `context`) `writeback:false`.
- Extend setup (`apply-manifests.ts` + a new `apply-crm-properties.ts`) so that, after Personize
  collections exist, setup **creates the matching custom properties on the CRM** via passthrough:
  - HubSpot: `crm/objects/contacts/properties`, `crm/objects/companies/properties` (group `personize`).
  - Salesforce: custom fields `Personize_Ai_Score__c`, etc. (or documented manual step where the API can't).
- Drive the property list from the manifests, prefixed `personize_` (D1), gated by `writeback:true` (D3) —
  regardless of provenance, so structured `extracted` fields (e.g. headcount) and LLM-`inferred` scores both sync.
- Honor `DRY_RUN` and the existing diff/verify modes (`setup-diff.ts`, `setup-verify.ts` gain a CRM-props section).
- **Exit:** `crm-agent setup apply --crm hubspot` (dry-run) lists the `personize_*` fields it would create
  (grouped by provenance); verify mode reports drift.

### Phase 7 — README + docs + SKILL.md
- **README.md** rewrite around the objective (see structure below).
- Update `docs/DISPATCHING-SUBAGENTS-ON-CRM-RECORDS.md` (formerly `AI-INSTRUCTION-PATTERNS.md`), `docs/AI-INSTRUCTIONS.md`, `docs/CAPABILITY-MENU.md` to the unified `save`/`retrieve`/`subagent` vocabulary; fix writeback examples to `personize_*` fields.
- `skills/crm-ai-operators/SKILL.md`: add a short, RFC-2119-framed note teaching when to invoke the
  autonomous **subagent** path vs deterministic prompt (the skill is otherwise insulated — it routes to
  repo operations, not raw SDK methods).
- **Exit:** no deprecated-vocab references in docs; README leads with $/hours.

### Phase 8 — Final verification
- `npm run typecheck && npm test`; `crm-agent setup diff --crm hubspot` and `operation run score.icp-fit --crm hubspot` in **dry-run**; spot-check one autonomous op via `aiSubagent`.
- **Exit:** all green; dry-run output shows the unified calls and `personize_*` provisioning.

---

## README.md — proposed new structure (objective-led)

1. **Headline:** "Save your revenue team hundreds of hours and thousands of dollars — automated, inside your CRM."
2. **The economic case up front:** the 5–10 FTE-equivalent / RevOps-hours-per-day framing currently buried at the bottom moves to the top, with a concrete before/after.
3. **The 90-second flow:** connect HubSpot/Salesforce → Personize provisions `personize_*` properties on your contacts & companies → agents start working day one.
4. **What gets created in your CRM:** a table of the `personize_*` properties (score, reason, buying stage, next best action, …) so buyers see exactly what lands in HubSpot/Salesforce.
5. **What your agents do** (keep the sales/marketing/revops/AE/leadership lists — they're strong).
6. **Architecture diagram** (keep, minor edit: show `personize_*` writeback).
7. **Three connection paths** (keep MCP/skill/CLI; correct CLI to `setup apply` provisioning properties).
8. **subagent vs prompt** (new short section: when the system plans-and-acts vs. deterministic scoring).
9. **What Personize adds** table (keep).
10. **Pricing / status / contributing / links** (keep; refresh SDK version references).

---

## Decisions — CONFIRMED 2026-06-17

- **D1 — CRM property prefix & casing. ✅ CONFIRMED: `personize_` prefix.**
  HubSpot internal name `personize_ai_score`; Salesforce `Personize_Ai_Score__c`. Gives provenance and
  avoids collisions with existing customer fields.
- **D2 — Who creates the CRM fields. ✅ CONFIRMED: `setup` provisions them.**
  Phase 6 makes this repo's `setup` explicitly create the `personize_*` fields via passthrough
  (auditable, reproducible, dry-run-able) rather than relying on native sync.
- **D3 — Property scope. ✅ REVISED: explicit `writeback:true`, any non-CRM provenance.**
  Supersedes the original "`autoSystem:true` only". The writeback gate is a new explicit `writeback` flag,
  decoupled from `autoSystem`/provenance — so **inferred, extracted, AND enrichment (Apollo) properties all
  sync** when marked, while CRM-origin and structural/log fields stay Personize-side. Reason: enrichment
  data (e.g. `employee_count`) is writeback-worthy but was `autoSystem:false` under the old rule.
- **D5 — Enrichment vendors. ✅ RESOLVED: none.** Apollo was illustrative only. This repo adds no external
  data APIs/vendors. `extracted` stays a provenance *label* on Personize-populated properties; we only
  decide writeback. No enrichment operation, hook, or interface is built.
- **D4 — Unified-retrieve org gate. ⏳ VERIFY DURING EXECUTION.** `client.memory.retrieve` (v1.1) is
  org-gated by `UNIFIED_RETRIEVE_V1_ORG_ALLOWLIST`; top-level `client.retrieve()` (v1) is not. Plan uses
  top-level `client.retrieve()` to avoid the gate; confirm allowlist status when wiring Phase 3.

---

## Risk & blast radius

- **Build break risk: low.** Bump is additive-only; rewrites are gated behind a green baseline and run
  phase-by-phase with typecheck/test at each exit.
- **Runtime risk: medium, contained by `DRY_RUN`.** All write/provision paths honor dry-run; Phase 6 ships
  dry-run-first so we see the exact CRM mutations before enabling them.
- **Reversibility:** each phase is an independent commit; Phase 1 alone is a safe, shippable improvement.
```
