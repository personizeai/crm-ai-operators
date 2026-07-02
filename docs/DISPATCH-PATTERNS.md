# Dispatch Patterns

How the dispatcher turns "which records need work?" into operation runs. Every
pattern is chosen **per route, in data** — routes are records in the
`dispatch-routes` collection, so changing orchestration never requires a deploy.

## The route shape

```jsonc
{
  "route_id": "score-stale-companies",
  "priority": 10,                    // lower = evaluated first
  "name": "Score stale companies",
  "enabled": true,
  "filter_json": "{ \"collection\": \"company\", \"where\": { \"icp_fit_score_updated_at\": { \"lt\": \"now-7d\" } } }",
  "target_type": "operation",        // operation | subagent | task | triage
  "target_name": "score.icp-fit",
  "max_per_cycle": 50,               // hard cap per dispatch cycle

  // pick ONE execution pattern:
  "parallel": false,                 // sequential (default)
  // "parallel": true, "concurrency": 8,
  // "dispatch_mode": "batch",
  // "target_chain": ["research.contact-background", "score.lead-quality"],

  // optional cost controls:
  "tier_override": "basic",          // basic | pro | ultra
  "model_override": "openai/gpt-4o"  // BYOK
}
```

## Re-run prevention (the load-bearing idea)

There is **no operation-run ledger table gating re-runs.** Instead, staleness
lives in the route's `filter_json`, evaluated **server-side and indexed** by
Personize. A route fetches only records that actually need work:

```jsonc
"filter_json": "{ \"collection\": \"contact\", \"where\": { \"job_title_updated_at\": { \"lt\": \"now-60d\" } } }"
```

`skip_if` inside each operation is the second line of defence for staleness the
filter can't express (enum checks, cross-field logic).

Why this beats a ledger: at scale you dispatch only what needs doing, instead of
dispatching everything and paying per-record recall to discover you can skip it.
And because operations are **idempotent**, a crash-and-rerun is free — re-running
the same cycle re-derives the same eligible set and skips what's already fresh.
Idempotence *is* the resume mechanism.

## The five patterns

### 1. Sequential (default)
One record at a time. `parallel` unset or false.

- ✔ Errors stay isolated; `max_per_cycle` is a hard cap.
- ✔ Predictable throughput, easy to reason about.
- **Best for:** writes to shared state, high-cost AI, debugging dispatch order.
- Throughput note: even sequential handles thousands/day on a small VM — the
  heavy AI work is offloaded to Personize; the dispatcher just routes.

### 2. Parallel
`parallel: true`, bounded by `concurrency` (default 8).

- ✔ Wall-clock ≈ `ceil(n / concurrency)` batches, not the sum of all records.
- ✔ One failure does not cancel the rest (allSettled semantics).
- ✔ The concurrency cap means one route can't fire 50 simultaneous operations
  and rate-limit the whole org.
- **Best for:** independent per-record ops — research, enrichment, scoring.

### 3. Batch
`dispatch_mode: "batch"`. ONE operation call receives the full record list as
`input.records[]`.

- ✔ Eliminates the N+1 recall problem — the dispatcher fetches records once and
  passes them directly; the operation skips its own recall.
- ✔ Atomic: one failure = all records fail, nothing claimed.
- Only valid with `target_type: "operation"` (falls back to sequential otherwise).
- `parallel` is ignored (there's only one call).
- **Best for:** bulk memorize (`sync.call-transcripts-bulk`), aggregate reports,
  any operation that processes the whole set in one shot.

### 4. Chain
`target_chain: [op1, op2, op3]`. Each record flows through every operation in
order, stopping at the first `ok:false`.

- ✔ One route = a full pipeline: research → score → generate, per record.
- ✔ Re-run safe: a chain that stops midway claims nothing, so the next cycle
  retries; idempotent stages + `skip_if` make the retry cheap (already-done
  stages skip).
- A shared deterministic `sessionId` (`chain_<route>_<email>`) is passed in each
  stage's input, so operations that read `input.sessionId` get continuity.
- Per-record only — ignored (with a warning) in batch mode.

### 5. Triage (agentic catch-all)
`target_type: "triage"`. A cheap-tier agent chooses the single most appropriate
operation for each record from the **bounded menu** of live operations, or "none".

- The *decision* is agentic; the *execution and audit trail* are not — the chosen
  operation runs through the normal `runOperation` path, and the decision + reason
  is logged.
- ✔ Keeps deterministic routing as the spine: use triage as a **priority-last**
  route so hardcoded routes handle everything they match, and only the remainder
  hits the agent.
- Keep `max_per_cycle` small and `tier_override` cheap — you pay one small LLM
  call per triaged record.
- **Not** a replacement for deterministic routes: per-record LLM routing is more
  expensive, harder to audit, and breaks the stable record→operation mapping that
  makes re-run prevention checkable. Reach for it only for the long tail.

## Cost control, without touching code

`tier_override` (basic/pro/ultra) and `model_override` (BYOK) apply to every
operation a route dispatches. Route the quick-scan lane to `basic` and the
executive-facing lane to `ultra` by editing route records, not operations.

Every run records its actual AI cost (`credits_used`, `tokens_used`, `ai_calls`)
to the `operation-runs` collection — so spend is queryable per operation, per day.

### Daily budget ceiling

Set `daily_budget_credits` on the orchestrator config to cap total AI spend per
day. The dispatcher checks it before each cycle (skips entirely if exhausted) and
stops opening new work mid-cycle once the running total reaches the cap. The
counter (`spend_today` / `spend_date`) lives in the orchestrator config and rolls
over by date. Accounting is approximate — spend is recorded once per cycle, so the
cap can overshoot by at most one cycle's worth of work (bounded by `max_per_cycle`).
Budget is denominated in Personize credits, the same unit the SDK meters, so
there's no invented dollar rate. (Note: subagent routes and the triage decision
call bypass `runOperation`, so their spend is not yet metered into the counter.)

### Self-verifying operations

An operation can grade its own output before writing by appending a self-check
step to its prompt (`verificationInstruction` + `VerificationSchema` +
`assertApproved` in `lib/instruction-patterns.ts`). The model reviews its draft
against a rule set and either corrects it or rejects it; a rejection throws, so
the operation's write never happens. `generate.outreach-sequence` uses this to
enforce brand-voice and formatting rules before creating send-email tasks. It
needs no separate eval call and works on hosted or Private.

## Choosing a pattern

```
Need the whole set in one call (bulk extract, aggregate)? ...... batch
Multi-step per record (research→score→generate)? .............. chain
Independent per-record work, want it fast? .................... parallel
Writes to shared state / high-cost / want determinism? ........ sequential
Long tail no fixed route matches? ............................. triage (priority-last)
```
