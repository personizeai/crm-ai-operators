# Instruction v2 — Verification Tasks (for a code-grounded backend agent)

**Purpose.** The design review makes factual claims about this repo and the Instruction v2
brief makes claims about what is/should be true. This file turns those into concrete,
re-runnable checks so a code-grounded agent (repo read access + shell) can confirm or refute
each one and report drift — instead of anyone trusting a point-in-time snapshot.

**How to run.** For each check: perform the METHOD, compare to EXPECTED, then fill ACTUAL and
set VERDICT ∈ {PASS, FAIL, CHANGED}. `CHANGED` = the repo no longer matches the claim (the
claim may have been intentionally fixed — flag it, don't assume regression). Paste findings
back with file:line evidence. Do not modify code; this is read-only verification.

**When to run.** (1) Phase 0 baseline — establishes ground truth before work starts.
(2) Phase 7 final conformance — re-checks the 20 non-negotiable rules against delivered code.

---

## Section 1 — Baseline claims about the current repo

Each check states the claim as of review time. `CHANGED` here is expected once implementation
starts; the value is knowing *when* and *whether the change is the intended one*.

### C1. Runner does not enforce `guidelines_required` (the core finding)
- METHOD: Read `src/core/runtime/operation-runner.ts` end to end. Grep it for
  `guideline`, `governance`, `guidelines_required`.
- EXPECTED (baseline): zero governance references in the runner; enforcement, if any, lives
  inside individual operation `impl/*.ts` files via `governance.ts` helpers
  (`loadGuidelines`, `missingGuidelines`).
- SIGNIFICANCE: this is the premise of Phase 1. If it ever reads governance centrally, Phase 1
  is partly done.
- ACTUAL: ___  VERDICT: ___

### C2. Governance content is sliced/truncated for policy-critical prompts
- METHOD: `grep -rn "slice(0," src/core/operations/impl/ | grep -i guidelin`; also read
  `optimize-refine-icp.ts` around the `icp-definition` usage.
- EXPECTED: at least one guideline body is truncated before use — canonical instance
  `guidelines["icp-definition"].slice(0, 1500)` in `optimize-refine-icp.ts`. NOTE: the brief's
  literal `slice(0,1000)`/`slice(0,2000)` strings are NOT expected to appear verbatim.
- ACTUAL (list every guideline-body slice with file:line and the numeric limit): ___  VERDICT: ___

### C3. Run records omit risk / side-effects / governance snapshot / target identity
- METHOD: Read `src/core/runtime/run-store.ts` and the `operation-runs` collection manifest
  (`manifests/core/collections/operation-runs.json`). List persisted fields.
- EXPECTED: fields cover status/summary/records/usage/timestamps only; NO `risk`,
  `side_effects`, `governance_snapshot`, `target`, `approval_ref`, `mission_id`, `plan_id`.
- ACTUAL (full field list): ___  VERDICT: ___

### C4. Dispatch supports the seven patterns the brief credits
- METHOD: Read `src/core/engine/dispatcher.ts`; confirm `target_type` union and mode handling.
- EXPECTED: `target_type` ∈ {`operation`,`subagent`,`task`,`triage`}; plus `parallel`,
  `dispatch_mode: "per_record"|"batch"`, and `target_chain` (per-record chains).
- ACTUAL: ___  VERDICT: ___

### C5. Orchestrator has pause / error-threshold / approximate budget
- METHOD: Read `src/core/engine/orchestrator.ts`.
- EXPECTED: `status: paused`, `error_threshold` with auto-pause, `daily_budget_credits`
  running counter (credits==spend unit, no invented USD rate).
- ACTUAL: ___  VERDICT: ___

### C6. Missions / plans / approvals / jobs / EntityTarget do NOT exist yet
- METHOD: check for `src/core/missions/`, `src/core/jobs/`, and any `EntityTarget` type
  (`grep -rn "EntityTarget" src/`), and the three collection manifests
  (`operator-missions.json`, `mission-plans.json`, `approvals.json`).
- EXPECTED (baseline): none present.
- ACTUAL: ___  VERDICT: ___

### C7. Dispatch identity is email/domain-centric
- METHOD: `grep -rn "email" src/core/engine/dispatcher.ts` and inspect `routeToTask` /
  `routeToSubagent` signatures for the record key they assume.
- EXPECTED: records keyed on email/domain; no generalized entity identity.
- ACTUAL: ___  VERDICT: ___

### C8. Usage accounting exists but is per-run, not mission-scoped
- METHOD: Read `src/core/lib/usage.ts` and how `operation-runner.ts` uses `withUsageSink` /
  `getUsageTotals`.
- EXPECTED: a per-run AI-cost sink (`credits`, `tokens`, `aiCalls`) surfaced on run records;
  NO mission/stage rollup, NO reserve→reconcile flow.
- ACTUAL: ___  VERDICT: ___

### C9. Test script is a hand-maintained explicit file list
- METHOD: Read the `test` script in `package.json`. Count enumerated files; compare to
  `ls src/__tests__/*.test.ts`.
- EXPECTED: explicit list (≈20 files), NOT a glob/dir run; a `*.test.ts` file not in the list
  would not execute.
- ACTUAL (list any test file present on disk but absent from the script): ___  VERDICT: ___

### C10. README unsupported claims + unpublished-package install docs
- METHOD: grep README for `88%`, `production-ready`, `5–10 FTE` / `5-10 FTE`,
  `customers report`, `npx -y crm-ai-operators`, `npm install -g crm-ai-operators`. Check
  `package.json` `version`/`private` and whether the package resolves on the npm registry.
- EXPECTED: all claim strings present without methodology; install commands present while the
  package is unpublished (`0.1.0`, not on registry). Also flag the internal contradiction:
  README says both "Salesforce in active build" and "production-ready for … Salesforce".
- ACTUAL: ___  VERDICT: ___

---

## Section 2 — Non-negotiable rules conformance (run in Phase 7)

One check per rule from the brief's Section 1. VERDICT PASS only if code + tests + docs + public
claims all agree (Rule 20). Cite evidence for each.

| # | Rule (abbreviated) | Verification method | ACTUAL | VERDICT |
|---|---|---|---|---|
| 1 | AGENTS.md rules followed | Spot-check changed ops against AGENTS.md hard rules | | |
| 2 | Baseline typecheck+test recorded before changes | `npm run typecheck` + `npm test` clean; baseline file exists | | |
| 3 | Work on a branch, not `main` | `git branch --show-current` ≠ `main` for the change set | | |
| 4 | Small reviewable PRs (except declared wide migrations) | PR sizes; EntityTarget migration explicitly flagged as wide | | |
| 5 | `DRY_RUN=true` default | `.env.example` + `isDryRun()` default true | | |
| 6 | No command/tool removed without migration path | Diff MCP tool list + CLI verbs vs. prior release | | |
| 7 | No roadmap item advertised as implemented | Cross-check README/docs "done" claims vs. registry status | | |
| 8 | Chat transcript not the only durable mission state | Missions persist to `operator-missions` collection | | |
| 9 | No distributed-safety claim without atomic claims+tests | ADR-003 conclusion matches code; collision tests exist or single-worker stated | | |
| 10 | `guidelines_required` is enforced, not advisory | Runner blocks on missing required guideline (`block` mode); test proves it | | |
| 11 | No silent shared-governance mutation from optimization | `optimize.*` (esp. `optimize-refine-icp.ts`) writes shared guidelines only via human approval | | |
| 12 | No invented benchmarks/savings/outcomes | Every quantitative claim has a method/source; historical runs not backfilled with fake data | | |
| 13 | Public counts/tables generated from code | `scripts/generate-operation-docs.ts` output matches README/docs; no hand-typed count drifts | | |
| 14 | Personize kept as the reference memory/governance/graph/CRM layer | No parallel store replaces it | | |
| 15 | Operations can target contacts/companies/deals/tickets/tasks/campaigns/custom | `EntityTarget` + fixtures for ≥ contact/company/deal/custom | | |
| 16 | CRM/email/doc/web treated as untrusted data | Provenance label present; adversarial fixtures exist | | |
| 17 | Every new write path has dry-run+audit+identity validation+failure behavior | Inspect each new write path | | |
| 18 | Every live external action has a risk+approval contract | External-message/delete ops carry `approval` contracts | | |
| 19 | Reliable single-worker preferred over fake distributed | Queue adapter documents its worker model honestly | | |
| 20 | Code, tests, docs, claims agree | Holistic: any disagreement = FAIL | | |

---

## Section 3 — Reusable commands

```bash
# governance enforcement in the runner (expect none at baseline)
grep -n "governance\|guideline" src/core/runtime/operation-runner.ts

# guideline-body truncation (report each numeric limit)
grep -rn "slice(0," src/core/operations/impl/ | grep -i guidelin

# run-record persisted fields
sed -n '1,200p' src/core/runtime/run-store.ts

# new subsystems present yet?
ls src/core/missions src/core/jobs 2>/dev/null; grep -rn "EntityTarget" src/

# test list vs. files on disk
node -e "const s=require('./package.json').scripts.test; console.log(s)"; ls src/__tests__/*.test.ts

# README claim + install-doc audit
grep -nE "88%|production-ready|5.10 FTE|customers report|npx -y crm-ai-operators|npm install -g crm-ai-operators" README.md
```

Report format per check: `ID | VERDICT | evidence (file:line or command output) | note`.
