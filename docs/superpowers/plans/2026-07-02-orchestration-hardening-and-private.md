# Orchestration Hardening + Personize Private Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Phase 1 is fully specified; Phases 2–4 are scoped and get detailed task breakdowns when execution starts.

**Goal:** Fix the dispatcher/ai() correctness gaps found in the 2026-07-02 audit, add the orchestration capabilities that make the repo a no-brainer (chains, triage, verify, budget), and make the whole stack run against Personize Private (self-hosted gateway).

**Architecture:** All Personize access already funnels through 7 lib modules — the private-mode work is a driver interface, not an operations rewrite. Capability flags gate hosted-only features (subagent, evaluate, serverOutputs) the same way per-provider branches route CRM-specific behavior (e.g. HubSpot vs Salesforce write-back).

**Tech stack:** TypeScript, node:test, @personize/sdk (hosted), @personize/gateway-sdk or REST (private).

## Global Constraints

- DRY_RUN defaults true; never change that.
- Branch `Hamed-July-2026` only. No prod writes.
- 97 tests pass + 1 skipped is the baseline; never merge below it.
- All ops keep working unchanged on hosted — private support must be additive.
- Backend facts (corrected 2026-07-02 from gateway team):
  - Gateway `/memory/retrieve mode:"filter"` DOES support crmFilter/groups/countOnly — client just nests keys under `filters: {...}`. No gateway ticket needed.
  - Gateway `/prompt` generation is fully in-process and live-verified (handbook "known gap" note was stale, now fixed).
  - `ai.subagent` + MCP on gateway: designed, NOT shipped — do not code against it; hosted-only until the contract is confirmed.
  - `serverOutputs` auto-sync + `evaluate` rubric on gateway: no roadmap commitment — treat as permanently hosted-only; client-side fallback is the durable design, not a stopgap.

---

## Phase 1 — Correctness (execute now)

### Task 1.1: Dispatcher honors `result.ok`
**Files:** Modify `src/core/engine/dispatcher.ts`
Operations report internal failures by RETURNING `ok: false` (not throwing). The dispatcher currently discards the result, so failed operations get counted as dispatched and their emails claimed.
- In `routeToOperation`: capture `runOperation(...)` result; if `!result.ok`, throw `Error("Operation <name> reported failure: <summary>")`.
- In the batch path: same check before claiming emails.
- Existing catch blocks handle the rest (no claims, errors++, bumpOrchestratorError).

### Task 1.2: Concurrency cap for parallel dispatch
**Files:** Create `src/core/lib/concurrency.ts`, `src/__tests__/concurrency.test.ts`; modify `src/core/engine/dispatcher.ts`
- `runWithConcurrency(items, limit, fn)` — worker-pool, preserves order, returns `PromiseSettledResult[]`, never rejects.
- Tests: results in order; concurrency never exceeds limit; rejections captured; empty list.
- Dispatcher: `DispatchRoute.concurrency?: number` (default 8); parallel path uses the helper instead of bare `Promise.allSettled`.

### Task 1.3: ai() wrapper fixes
**Files:** Modify `src/core/lib/ai.ts`
1. **Format-contract conflict:** when `serverOutputs` present in single-prompt mode, do NOT prepend the "Return ONLY a JSON object" boilerplate — the server's marker extraction is the format contract.
2. **maxTokens default:** governed default 1000 → 2000; `autonomous: true` sends NO default (tier default governs). Explicit caller values always win.
3. **Bounded self-repair retry:** single-prompt JSON path only — on `invalid_json`/`schema_validation`, retry ONCE with the validation error appended. Log warn on retry.

## Phase 2 — Capability

- **Task 2.1 `target_chain`:** route field `target_chain?: string[]`; per-record pipeline (no barrier between records), stop-on-`ok:false`, shared `sessionId` down the chain, all-or-per-stage claiming documented.
- **Task 2.2 subagent route target:** implement via `ai({ autonomous: true, instructions: <from route.instructions_name guideline> })`; remove the task-fallback stub.
- **Task 2.3 usage telemetry:** thread `result.usage.creditsCharged`/tokens from ai() → operation metrics → run-store (`credits_used`).

## Phase 3 — Differentiation

- **Task 3.1 verify-before-write:** `verify_with_guideline` route option → `evaluate: { criteria }` (hosted-only capability, gate + document).
- **Task 3.2 budget ceiling:** `daily_budget_usd` on orchestrator config, enforced pre-dispatch using Phase 2 telemetry.
- **Task 3.3 triage route type:** `target_type: "triage"` — bounded operation menu from registry, cheap tier, decision + reason logged; priority-last catch-all.
- **Task 3.4 docs:** `docs/DISPATCH-PATTERNS.md` (sequential/parallel/batch/chain/triage + re-run prevention + idempotence-as-resume principle).

## Phase 4 — Personize Private

- **Task 4.1 driver interface:** extract `PersonizeDriver` (~10 methods) from lib modules; hosted driver = pure refactor, zero behavior change.
- **Task 4.2 capability flags:** driver exposes `{filteredQuery, subagent, serverOutputs, evaluate, bulkMemorize, webhooks}`; `OperationEntry.requires?: Capability[]`; registry surfaces unavailable ops with clear messaging.
- **Task 4.3 serverOutputs client-side fallback (durable):** when driver lacks `serverOutputs`, ai() strips them from the request, uses the legacy JSON path, and writes properties client-side from the validated output using the same collectionId/propertyId mapping.
- **Task 4.4 gateway driver:** filter mapping (nest under `filters: {...}`), properties via `memory/save`, guidelines via `shape:'document'`, memorizeBatch via `/memory/import`, tiers→models via env (`TIER_BASIC_MODEL` etc.).
- **Task 4.5 kit:** ship `crm-ai-operators` gateway kit (entity types + 4 engine collections + 18 guidelines); `setup.apply` in private mode = kit install.
- **Task 4.6 CI:** docker-compose gateway smoke test — finally gives real integration tests.
- Research ops (`autonomous: true`) stay hosted-only until the gateway subagent contract is confirmed (they will ping us).

## Execution order

Phase 1 now (this session). Phases 2–4 in order; 4.1 (pure refactor) may land any time after Phase 1.
