# Instruction v2 — Review, Decisions, and Paste-Ready Additions

Companion to *"Repository Implementation Instruction, v2"* (the control-plane brief).
This file records the review verdict, the decisions taken on the open questions, and
ready-to-paste text to fold back into the instruction. Factual claims about the current
codebase were verified against the repo and are re-verifiable via
[`instruction-v2-verification-tasks.md`](./instruction-v2-verification-tasks.md).

Status of the instruction: **strong strategy doc, accurate diagnosis.** The gaps are
operational realism, not direction. Adopt the decisions below before starting Phase 0.

---

## Verified state of the repo (baseline for the brief)

| Brief premise | Reality in repo | Verdict |
|---|---|---|
| Rich existing architecture (manifests, catalog, dispatch, audit, run store) | Present | Accurate |
| `sequential/parallel/batch/chain/subagent/task/triage` dispatch | `src/core/engine/dispatcher.ts` | Accurate |
| Orchestrator pause / error threshold / approximate budget | `src/core/engine/orchestrator.ts` (`error_threshold`, `daily_budget_credits`) | Accurate |
| **`guidelines_required` is advisory, not enforced by the runner** | `src/core/runtime/operation-runner.ts` never reads governance; each op self-checks via `governance.ts` | **Accurate — the key finding** |
| "arbitrary `slice(0,1000)` / `slice(0,2000)`" on policy text | Actual is `guidelines["icp-definition"].slice(0, 1500)` at `optimize-refine-icp.ts:155`; the literal `1000/2000` strings do not appear | Right in spirit, wrong literals |
| Missions / plans / approvals / jobs / `EntityTarget` do not exist | Confirmed — all net-new | Accurate |
| Run records lack risk / side-effect / governance / target metadata | Confirmed in `run-store.ts` | Accurate |
| README carries unsupported claims + unpublished-package install docs | Confirmed (README lines 3, 22, 92, 298, 334, 492, 498; `package.json` unpublished `0.1.0`) | Accurate |

---

## Decisions on the open questions

### D1 — Reframe scope (was §3.1: "incremental vs. rewrite")
**Decision:** keep all scope; fix the framing. The brief forbids "a large multi-agent
framework" (line 9) but Phases 2–5 build exactly one from zero. Resolve the contradiction
honestly and set month-scale expectations. Add per-phase effort tiers so no one budgets the
control plane as a week of work (which is what forces later corner-cutting and breaks the
honesty rules).

### D2 — Machine verification of claims (was §3.2)
**Decision:** claims in the brief and in this review are verified by a code-grounded backend
agent, not by prose assertion. The spec lives in `instruction-v2-verification-tasks.md`.
Re-run it at the start of Phase 0 (baseline) and again in the final conformance phase (D6).

### D3 — Run-record migration & enforcement rollout (was §3.3)
**Decisions:**
1. New run-record fields (`governance_snapshot`, `risk`, `side_effects`, `target`, `approval_ref`)
   are **additive and optional**. Never synthesize values for historical rows (Rule 12). A
   pre-enforcement run reads back as `governance_snapshot: null` — a valid state, not an error.
2. **Classify all current operations for `risk`/`side_effects`/`accepted_target_types` in the
   same PR that turns enforcement on (PR2).** Do not rely on the "default to high until classified"
   backstop as a steady state — a forgotten op silently stuck at "requires approval" is a
   degradation nobody notices.
3. **Ship enforcement in `warn` mode first.** Add `GOVERNANCE_ENFORCEMENT=warn|block` (default
   `warn` for one release). In `warn` the runner logs what it *would* block but allows it; then
   flip to `block`. This is both the safe-rollout mechanism and the kill-switch.
4. **Placeholder-blocking is live-only.** Bracketed governance blocks execution when
   `DRY_RUN=false`; in dry-run it warns and allows, so rehearsal still works.

### D4 — EntityTarget sequencing (was §3.4)
**Decision: types before behavior.** Define the `EntityTarget` interface + email/domain compat
helpers in **Phase 1** (interface only, no behavior change). Phase 2 missions reference it from
birth. The dispatcher/chain/writeback/graph migration stays in **Phase 3**. This avoids
reworking mission scope while keeping the headline mission control plane out from behind a big
invisible refactor.

### D5 — Test harness + control-assignment (was §3.5)
**Decisions:**
1. **PR1:** replace the hand-maintained test-file list in `package.json` (`test` script,
   currently 20 explicit paths) with a directory/glob run
   (`node --import tsx/esm --test 'src/**/*.test.ts'`) so new tests can't silently go unrun.
2. Adopt and name the reliability principle: **push every invariant to the hardest layer that
   can express it; a guideline is never the only thing preventing a harmful action — a code or
   harness gate always sits behind it.** Add the control-assignment table (below) to the brief.
   This *is* the general form of the `guidelines_required` bug the brief already found.

### D6 — Rule 11 referent + final conformance phase (was §3.6)
**Decisions:**
1. Name Rule 11's concrete referent: audit `optimize.*` — specifically
   `optimize-refine-icp.ts` (reads `icp-definition`, proposes refinements) — none may write a
   shared guideline/collection without a human approval step.
2. Add **Phase 7 — Final conformance check**: the verification agent re-runs all 20
   non-negotiable rules against the delivered code and emits a pass/fail report before
   Definition-of-Done is claimed.

### D7 — README / publish honesty (was §3.7)
**Decisions:**
1. **Install docs (10-min fix):** change README `npx -y crm-ai-operators` /
   `npm i -g crm-ai-operators` to the from-clone / `github:` forms now, labeling the `npx`
   forms "after `npm publish`." Publish deliberately when Phase 0/1 lands. Docs and reality
   must agree this week regardless of which way you go.
2. **Claims (real work):** `production-ready`, `customers report 5–10 FTE`, `up to 88%` get the
   Phase 0 evidence/maturity treatment — not a quick edit. Do not let the easy bin fix stand in
   for fixing these.

---

## Paste-ready additions to the instruction

### A) Replacement for the intro scope paragraph (line ~9)

> This instruction adds a **new control-plane layer on top of the existing runtime**, delivered
> incrementally through small PRs. It is **not** a rewrite of the existing runtime, and **not**
> an unconstrained autonomous-agent framework: a chat agent may *propose* structured plans, but
> the runtime only ever executes validated, registered operations. Expect the full sequence
> (Phases 0–7) to be **month-scale**, not week-scale. Each phase below carries an effort tier so
> scope is not mistaken for a quick overlay — under-budgeting this work is what pressures a team
> into the dishonest claims the non-negotiable rules forbid.

Add an effort tier to each phase header, e.g. `Phase 4: Durable jobs — **L (largest; gated by D3/atomic-claim spike)**`.

### B) New Phase 0 deliverable — atomic-claim spike (de-risks Phase 4)

> - **Atomic-claim spike.** Before committing to Phase 4's job semantics, prove whether the
>   Personize SDK/collections can express an atomic claim (compare-and-set on a job's
>   `lease_owner`/`status`). Deliver a throwaway two-worker test that races a claim. **Record the
>   result in ADR-003:** if atomic claims exist, Phase 4 may pursue multi-worker; if not, Phase 4
>   is **single-worker by decision**, documented, with no distributed-safety claim (Rule 9). This
>   moves the honest/dishonest fork out of Phase 4 and into Phase 0 where it belongs.

### C) New Phase 1 deliverable — EntityTarget type (per D4)

> - Define the `EntityTarget` interface and email/domain compatibility helpers **as types only**,
>   with no dispatcher/writeback behavior change. Phase 2 mission schemas consume it directly; the
>   runtime migration to honor it everywhere lands in Phase 3.

### D) Governance-enforcement rollout note in Phase 1 §3.2 (per D3)

> Enforcement ships behind `GOVERNANCE_ENFORCEMENT=warn|block` (default `warn` for one release):
> in `warn` the runner logs what a missing/placeholder guideline *would* have blocked but allows
> execution; flip to `block` once the warn-mode logs are clean. Placeholder-blocking applies only
> when `DRY_RUN=false`. New run-record governance/risk/target fields are additive and optional;
> historical runs are never backfilled with synthesized values (Rule 12) and read back as
> `null` snapshots. All current operations are classified for `risk`/`side_effects`/
> `accepted_target_types` in the same PR that enables the gate.

### E) New section 9.x — Control assignment (defense in depth) (per D5)

> **Principle: push every invariant to the hardest layer that can express it. A guideline is
> never the only thing preventing a harmful action — a code or harness gate always sits behind
> it.** (The advisory-`guidelines_required` gap this brief fixes is the general failure this
> principle prevents.)
>
> | Risk class | Authoritative (hard) control | Advisory (soft) control |
> |---|---|---|
> | Overwrite human-entered CRM value | Code: writeback allowlist + `personize_*` namespacing | `crm-writeback-policy` guideline |
> | Send external message | Harness: approval contract (first-activation) + acceptance gate | `outreach-playbook`, brand voice |
> | Delete / merge records | Harness: always-approve contract; irreversible ops not auto-retried | `data-hygiene` guideline |
> | Budget / call overrun | Harness: reserve→dispatch→reconcile ledger; per-stage ceilings | run-mode cadence guidance |
> | Prompt injection via CRM/web/email | Code: provenance label; data-not-authority separation | skill / playbook framing |
> | Missing / placeholder governance | Code: runner enforcement (`block` mode) | — |
> | Silent policy mutation from optimization | Harness: human approval step on any shared-guideline write | Rule 11 |

### F) New Phase 7 — Final conformance check (per D6)

> **Phase 7: Final conformance check.** Before claiming Definition-of-Done, run the verification
> agent (`docs/review/instruction-v2-verification-tasks.md`) against the delivered code. It
> re-checks all 20 non-negotiable rules and produces a pass/fail conformance report. Any FAIL
> blocks the done claim. Rule 11 check is explicit: no `optimize.*` operation writes a shared
> guideline or collection without a human approval step (referent: `optimize-refine-icp.ts`).

---

## Residual risks to watch

- **Cost-per-accepted-unit is process-quality, not outcome-proven,** while acceptance is
  LLM-judged and examples are synthetic. Label it as such until real pilots produce business
  outcomes.
- **§3.2 step 4 "identify conflicts where possible"** (guideline-vs-guideline) is genuinely hard;
  keep it best-effort and out of acceptance criteria (it already is — keep it that way).
- **EntityTarget migration cannot be a "small PR"** without a compat shim; plan it as one wide,
  well-tested, atomic change and say so, rather than pretending Rule 4 applies unmodified.
