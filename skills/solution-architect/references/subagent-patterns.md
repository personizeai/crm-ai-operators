# Subagent Patterns

How to design multi-agent pipelines using crm-ai-operators operations. When to use subagents, how to chain operations, how to handle errors, and how to estimate token budgets.

---

## Pattern 1: Parallel Scoring Pipeline

**Use when:** You need ICP fit and lead quality scores for a batch of records and want to minimize wall-clock time. Both operations are idempotent and read-heavy — they can run on the same batch concurrently without conflict.

**Operations:** `score.icp-fit` + `score.lead-quality` (parallel) → composite ranking

**Structure:**
```
Orchestrator
├── Subagent A: score.icp-fit on companies (filter: batch)
└── Subagent B: score.lead-quality on contacts (filter: batch)
    ↓ (both complete)
Orchestrator: composite rank = 0.6 * icp_fit_score + 0.4 * lead_score
```

**Implementation notes:**
- Launch both subagents simultaneously with the same batch filter
- Each subagent checks skip_if internally — records scored recently are skipped automatically
- After both complete, the orchestrator reads the combined scores from Personize and ranks
- Write the composite rank back via `client.memory.upsert` on each contact record
- Expected time savings vs sequential: ~40–50% (limited by whichever operation takes longer)

**Good starting filter:**
```json
{
  "collection": "contacts",
  "where": { "lifecycle_stage": ["MQL", "SQL"], "opted_out": false },
  "limit": 200
}
```

---

## Pattern 2: Research → Score → Generate Pipeline

**Use when:** You need full pre-call prep for a set of target accounts — research fills memory, scoring uses that filled memory, generation uses both.

**Operations:** `research.account-deep-dive` → `score.icp-fit` → `generate.meeting-brief`

**Structure:**
```
For each account (sequential — each step gates the next):
  Step 1: research.account-deep-dive
    → Fills company memory with: tech_stack, key_initiatives, recent_news, headcount_trend
  Step 2: score.icp-fit
    → Reads filled memory → produces icp_fit_score with explanation
    → skip_if: icp_fit_score_updated_at < 7d (bypass by clearing or using force flag)
  Step 3: generate.meeting-brief
    → Reads: score, research output, recent conversations, open tasks
    → Produces: AE-facing brief with talk tracks, risk flags, suggested agenda
```

**Why sequential:** Each step's output is the next step's input. Research must complete before scoring (scorer reads research-populated properties). Scoring must complete before brief generation (brief includes the score and score rationale).

**Best for:** Strategic accounts, QBR prep, outbound to named accounts, AE pre-call preparation

**Scale guidance:** For > 50 accounts, run in batches of 5–10 accounts at a time. `research.account-deep-dive` is the most expensive step (~5,000 tokens/account on average).

---

## Pattern 3: Daily Digest Orchestrator

**Use when:** You want a ranked daily work list delivered to each rep, automatically refreshed each morning.

**Operations:** `analyze.buying-stage` → `score.lead-quality` (changed contacts only) → `act.daily-digest`

**Structure:**
```
Morning run (scheduled, per org):
  Step 1: analyze.buying-stage
    → Filter: all active contacts with activity in last 7 days
    → Updates: buying_stage, buying_stage_updated_at, signals
  Step 2: score.lead-quality
    → Filter: contacts where buying_stage_updated_at > yesterday
    → Re-scores only the contacts whose buying stage changed
  Step 3: act.daily-digest
    → Filter: all contacts assigned to reps with open tasks or recent signal changes
    → Output: per-rep ranked digest in workspace.updates + notification task
```

**Scheduling pattern:** Run via a scheduled subagent triggered at 7am in the org's timezone. Each step passes its completion status to the orchestrator before the next step launches.

**Why this order:** Buying stage analysis happens first because it detects new signals. Lead quality rescoring is limited to only those contacts where signals changed (much smaller batch). Digest generation happens last so it includes the freshest scores.

---

## Pattern 4: Full Prospecting Pipeline

**Use when:** Activating a new market, launching an outbound campaign, or onboarding a new AE who needs a full pipeline built from scratch.

**Operations:** `crm.sync-core` → `research.account-deep-dive` (top accounts) → `score.icp-fit` + `score.lead-quality` (parallel) → `generate.outreach-sequence` (qualified contacts)

**Structure:**
```
Phase 1 — Sync (foundation)
  crm.sync-core: full database sync (or segment: new territory)
  → Populates Personize with all contacts and companies

Phase 2 — Research (top accounts only)
  research.account-deep-dive: filter = icp_fit_score > 70 OR is_named_account = true
  → Depth-first on high-value targets only; don't research every company

Phase 3 — Score (parallel)
  Subagent A: score.icp-fit on all companies
  Subagent B: score.lead-quality on all contacts
  → Both use skip_if to avoid re-scoring recently scored records

Phase 4 — Generate (qualified contacts only)
  generate.outreach-sequence: filter = lead_score > 65 AND opted_out = false
  → Generates personalized sequences; writes to workspace.updates + task queue
```

**Rollout recommendation:** Run Phase 1–3 first with `DRY_RUN=true`. Review the score distribution before running Phase 4 live — if < 10% of contacts score > 65, your ICP definition may be too narrow.

---

## Pattern 5: Optimization Loop

**Use when:** Monthly ICP calibration cycle. Win/loss data feeds back into ICP definition, which improves all downstream scoring.

**Operations:** `report.win-loss` → `optimize.refine-icp` → guideline update → `setup.apply` → `score.icp-fit` (re-score all)

**Structure:**
```
Monthly (last business day of month):
  Step 1: report.win-loss
    → Analyzes won opportunities vs churned accounts
    → Output: pattern analysis (which companies win, which lose, why)

  Step 2: optimize.refine-icp (reads Step 1 output)
    → Proposes specific changes to icp-definition.md
    → Output: a proposed diff of guideline changes — NOT applied yet

  Step 3: RevOps review (human step)
    → RevOps reviews proposed changes, approves or modifies
    → Edit manifests/core/guidelines/icp-definition.md

  Step 4: setup.apply
    → Pushes updated guideline to Personize

  Step 5: score.icp-fit (re-score all)
    → Filter: all companies (clear icp_fit_score_updated_at or use force flag)
    → Recalibrated ICP now propagates to all scores

  Step 6: Validate
    → Compare score distribution: did high-fit companies move up?
    → Check: what % of your closed-won accounts now score > 70?
```

**Why this matters:** Without this loop, your ICP definition drifts from reality as your market and product evolve. Monthly calibration keeps the scoring layer grounded in what actually converts.

---

## Single Agent vs Subagents

| Signal | Use single agent | Use subagents |
|--------|-----------------|---------------|
| Operation count | ≤ 4 operations | 5+ operations |
| Record volume | ≤ 500 records per operation | > 500 records per operation |
| Parallelism needed | Sequential only | Independent branches (Pattern 1) |
| Session type | Interactive / live | Scheduled / unattended |
| Error tolerance | Can retry manually | Must log + recover automatically |
| Pipeline duration | < 5 minutes | > 5 minutes or overnight |

**Rule of thumb:** If you'd be comfortable running it in a single Claude Code session while watching, use a single agent. If you'd want it to run overnight unattended, use subagents.

---

## Error Handling and Recovery

### Principles

1. **Operations are idempotent.** Re-running a step after failure is always safe — skip_if windows ensure already-processed records are skipped.
2. **Audit log is the source of truth.** Every operation run is logged in `data/audit/`. If a pipeline fails mid-run, the audit log shows exactly which records were processed.
3. **Never cascade writes from partial results.** If Step 3 fails (generation), do not use Step 3's partial output. Re-run Step 3 on its full input.

### Recovery pattern

```
If a pipeline step fails:
  1. Read audit log: data/audit/<run-id>.json
     → Find: which records were processed before failure
  2. Re-run the failed step with the same filter
     → skip_if handles already-processed records automatically
  3. If the failure was a rate limit: add a delay and retry
  4. If the failure was a data error: inspect workspace.updates on the failing record
  5. Log the failure to workspace.updates on the orchestrator task
```

### Do not re-run setup operations in recovery

Never re-run `setup.apply` in a recovery context without first running `setup.diff` to preview what would change. Setup operations modify your Personize collections — re-running them without review can cause unintended schema changes.

### Subagent failure isolation

If a subagent fails mid-pipeline, the orchestrating agent should:
1. Log the failure to `workspace.updates` on the pipeline's task record
2. Surface the error to the rep or RevOps owner via `act.notify-rep-handoff`
3. Continue with other independent branches (if any) — don't abort the whole pipeline for one branch failure
4. Mark the failed step for manual review, not automatic retry

---

## Token Budget Estimation

Use these estimates to plan batch sizes and model selection before running large pipelines.

| Operation | Avg tokens per record | Notes |
|-----------|----------------------|-------|
| `crm.sync-core` | ~100 | Haiku-eligible; mostly structured field mapping |
| `score.icp-fit` | ~500 | Scoring with structured output; Haiku for large batches |
| `score.lead-quality` | ~700 | Multi-factor scoring; Haiku or Sonnet |
| `analyze.buying-stage` | ~800 | Signal inference; Sonnet recommended |
| `analyze.deduplication` | ~300 | Classification; Haiku-eligible |
| `research.account-deep-dive` | ~5,000 | Subagent with web/CRM lookups; Sonnet minimum |
| `generate.outreach-sequence` | ~2,000 | Multi-email generation; Sonnet recommended |
| `generate.meeting-brief` | ~1,500 | Structured brief; Sonnet recommended |
| `analyze.call-summary` | ~2,500 | Long-context; Sonnet minimum |
| `report.win-loss` | ~8,000 | Deep analysis; Opus recommended |
| `optimize.refine-icp` | ~6,000 | Strategic reasoning; Opus recommended |

**Planning formula:**
```
Total tokens ≈ (records × tokens_per_record) × 1.3 (overhead buffer)
Cost estimate ≈ total_tokens / 1,000,000 × model_price_per_million
```

**Example:** Score 1,000 contacts for lead quality with Haiku (claude-haiku-4-5-20251001 at ~$0.25/M input):
```
1,000 × 700 tokens × 1.3 = 910,000 tokens ≈ $0.23
```

**Always test with `limit: 10` before running full scale.** The actual per-record cost can vary significantly based on property richness.
