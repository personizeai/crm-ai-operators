# Maturity

`crm-ai-operators` is a **0.x evolving reference implementation** — an
environment for pressure-testing an architecture, not a finished product or a
universal multi-agent framework. It is promoted as something you can inspect,
run in dry-run, modify, extend, and challenge with your own context.

"Production-ready" is not claimed as an unqualified property of the whole system.
Individual `live` operations are tested and run against real backends, but the
durable AI-management layer (missions, plans, durable distributed jobs,
centralized governance enforcement, full acceptance/evaluation) is still being
built. Publication language must not collapse the two lists below.

## Implemented in the audited main branch

- 29 registered operations across setup, sync, research, score, generate,
  analyze, act, report, and optimize — see
  [OPERATIONS.generated.md](./OPERATIONS.generated.md) (generated from the
  registry).
- Operation metadata: status, cost, idempotence, run mode, required guidelines,
  backend capability requirements, and freshness (`skip_if`) rules.
- Governed collection and guideline manifests, with org-specific local overlays
  that never modify the shared core.
- HubSpot and Salesforce integration patterns.
- Dry-run by default; audit log and durable run records.
- Per-run tokens, credits, and AI-call metrics **for work flowing through the
  operation runner** (direct `ai()` paths are not yet metered into one ledger).
- Sequential, bounded-parallel, batch, operation-chain, task, subagent, and
  AI-triage dispatch patterns; route-level model and tier overrides.
- Pause, resume, error-threshold, and approximate daily-budget controls.
- HMAC-signed webhook handling; MCP profiles (planner, operator, admin, auditor).
- Graph relation registration and validation.
- An optimization operation that reviews run history and proposes improvements.
- A **minimal reference acceptance gate**: operations that declare one report
  `attempted`/`accepted`/`rejected` and persist those on run records
  (`score.icp-fit` is the reference; `src/core/lib/acceptance.ts`). This makes
  completion-vs-acceptance visible; it is deterministic checks only.

## Proposed or incomplete (future tense in all public copy)

- Durable operator missions and versioned plans.
- Plan and action approvals; human-readable executive mission reports.
- Centralized governance **enforcement** in the runner (today `guidelines_required`
  is enforced per-operation, not centrally).
- Risk and side-effect contracts; entity targets beyond contact email.
- Durable distributed jobs, atomic claims, leases, retries, and restart recovery.
- One complete cost ledger with reserve → dispatch → reconcile.
- Acceptance gates and outcome evaluation as shared infrastructure (the current
  gate is a single-operation reference, not a framework).
- Adversarial prompt-injection fixtures proving governance is not overridden.

See the implementation brief and
[docs/review/instruction-v2-review-and-decisions.md](./review/instruction-v2-review-and-decisions.md)
for how these are sequenced.

## Why it matters before it is complete

A reference implementation lets executives and builders inspect operation
contracts, see where governance is loaded, examine writeback rules, run dry-run
experiments, add an operation, deploy privately, and challenge the architecture
with their own data — which is more useful than a prediction. The repository is
not "the answer"; it is where the proposition gets pressure-tested.
