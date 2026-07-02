# Capability Menu

> Every operation registered in `src/core/operations/registry.ts`. The agent reads this menu via `operation_list` (MCP) or `crm-agent operation list` (CLI) — both return the same metadata. This doc is the human-readable companion.

**Status legend:**

| Status | Meaning |
|--------|---------|
| `live` | Tested, real algorithm, makes real changes (gated by `DRY_RUN`). |
| `scaffold` | Registered + runnable. Returns a structured rehearsal envelope describing what it would do, what's missing, and concrete steps to make it live. |
| `idea` | Registered + runnable. Returns description-only — no execution logic yet. |

**Cost legend:** `low` (no LLM, light I/O), `medium` (some LLM or many records), `high` (heavy LLM, large fan-out).

**Run-mode legend:** `always` (cron/scheduled), `on-trigger` (event-driven), `on-decision` (agent reasons about it), `manual` (only when explicitly asked).

---

## setup

| Operation | Status | Cost | Run mode | Idempotent | What it does |
|-----------|--------|------|----------|-----------|--------------|
| `setup.apply` | live | low | manual | ✓ | Idempotent upsert of collections + guidelines from `manifests/`. |
| `setup.verify` | live | low | manual | ✓ | Auth check + diff org collections/guidelines vs local manifests. |
| `setup.diff` | live | low | manual | ✓ | What `setup.apply` would change (dry-run forced). |

## sync

| Operation | Status | Cost | Run mode | Idempotent | What it does |
|-----------|--------|------|----------|-----------|--------------|
| `crm.sync-core` | live | medium | on-trigger | ✓ | Import CRM contacts + companies into Personize via Personize-managed sync-in. Connection, pagination, field mapping, dedupe, and association linking all run inside Personize. Connect the CRM in the Personize dashboard first. |
| `crm.sync-out` | live | medium | on-decision | ✓ | Write enriched Personize properties back to the CRM via Personize-managed sync-out. Personize owns reverse mapping; AI values land on dedicated CRM AI properties, never overwriting human-entered fields. |
| `crm.sync-schedule` | live | low | manual | ✓ | Enable/disable Personize-managed recurring (incremental) sync for a provider's objects. Frequency: hourly/daily/weekly/manual-only. Personize runs the cadence — nothing scheduled locally. |
| `sync.push-properties` | live | low | on-trigger | ✓ | Propagate company icp_fit_score → account_score_lift on linked contacts. Returns AI property coverage report. Personize handles CRM writeback natively. |
| `sync.pull-engagements` | live | medium | on-trigger | ✓ | Process engagements already in Personize (synced natively from CRM/Zapier). Extracts insights, surfaces buying signals, creates action tasks. |
| `sync.normalize-lifecycle` | live | low | on-trigger | ✓ | Map CRM-specific lifecycle stage values (HubSpot + Salesforce variants) to a canonical unified model. Returns coverage + unmapped values list. |

## research

| Operation | Status | Cost | Run mode | Idempotent | What it does |
|-----------|--------|------|----------|-----------|--------------|
| `research.account-deep-dive` | scaffold | high | on-trigger | ✓ | Comprehensive account research per the account-research guideline; fills companies + signals + stakeholders. |
| `research.contact-background` | scaffold | medium | on-trigger | ✓ | Per-contact title history, public content, recent moves; infers communication style and pain points. |

## score

| Operation | Status | Cost | Run mode | Idempotent | What it does |
|-----------|--------|------|----------|-----------|--------------|
| `score.icp-fit` | live | medium | on-trigger | ✓ | Company-level ICP fit score against the icp-definition guideline. Skip if updated within 7d. |
| `score.lead-quality` | live | medium | on-trigger | ✓ | Contact-level AI score (0-100) combining persona match, ICP fit, engagement, and account lift. Skip if updated within 7d. |

## generate

| Operation | Status | Cost | Run mode | Idempotent | What it does |
|-----------|--------|------|----------|-----------|--------------|
| `generate.outreach-sequence` | live | high | on-decision | ✗ | Per-contact 3-email sequence using outreach-playbook + brand-voice. Creates send-email tasks scheduled 3 business days apart. |
| `generate.meeting-brief` | live | high | on-decision | ✓ | Pre-call AE brief: account context, contact history, signals, recommended angles, suggested questions. Returns Markdown + creates a review task. |
| `generate.proposal` | live | high | manual | ✗ | Markdown proposal draft from Personize memory (deal data synced from CRM). Always for human review — creates a review task. |
| `generate.win-back-sequence` | live | high | on-decision | ✗ | 3-email win-back for churned contacts. Anchored in past engagement + what's new since they left. |
| `generate.mutual-action-plan` | live | high | on-decision | ✗ | Draft a Mutual Action Plan from deal data and Personize memory. Creates one milestone task per MAP step. Stored in projects for human review. |

## analyze

| Operation | Status | Cost | Run mode | Idempotent | What it does |
|-----------|--------|------|----------|-----------|--------------|
| `analyze.reply-sentiment` | live | low | on-trigger | ✓ | Classify inbound email replies (9 classes). Updates sequence_status, appends signal, creates follow-up task per class. |
| `analyze.buying-stage` | live | medium | on-trigger | ✓ | Infer buying_stage from recent conversations + signals. Updates buying_stage + next_best_action. Skip if updated within 14d. |
| `analyze.call-summary` | live | medium | on-trigger | ✓ | Summarize call/meeting conversations in Personize. Extracts key topics, next steps, action items, buying signals, deal stage indicator. Creates follow-up tasks. |
| `analyze.deduplication` | live | medium | on-decision | ✓ | Detect duplicate contacts via name similarity + company domain clustering. Flags merge candidates, creates dedup-review tasks. Never auto-merges. |

## act

| Operation | Status | Cost | Run mode | Idempotent | What it does |
|-----------|--------|------|----------|-----------|--------------|
| `act.notify-rep-handoff` | live | low | on-trigger | ✗ | Build structured handoff payload and route to Slack webhook (if configured) or rep task. Always creates an ack task. |
| `act.daily-digest` | live | low | always | ✓ | Compile per-rep daily digest: top prospects ranked by composite AI score + signal weight. Delivers to Slack or creates a daily-digest task. |

## report

| Operation | Status | Cost | Run mode | Idempotent | What it does |
|-----------|--------|------|----------|-----------|--------------|
| `report.pipeline-health` | live | high | on-decision | ✓ | Snapshot pipeline health: stage distribution, at-risk accounts, momentum signals, rep priorities. Stored in projects. |
| `report.win-loss` | live | high | on-decision | ✓ | Analyze won vs churned/lost accounts. Surfaces win/loss patterns, ICP refinement signals, objection playbook. Stored in projects. |

## optimize

| Operation | Status | Cost | Run mode | Idempotent | What it does |
|-----------|--------|------|----------|-----------|--------------|
| `optimize.review-runs` | live | medium | on-decision | ✓ | Review recent operation runs, cluster failures, propose schema/guideline improvements. |
| `optimize.refine-icp` | live | high | on-decision | ✓ | Analyze won vs lost accounts to propose concrete ICP definition updates. Stores draft in projects for leadership review — never auto-publishes. |

---

## Status summary

| Status | Count |
|--------|-------|
| live | 24 |
| scaffold | 2 |
| idea | 0 |
| **Total** | **26** |

---

## How to extend

Adding a new operation = adding one file in `src/core/operations/impl/<category-name>.ts` and one import line in `registry.ts`. The agent discovers it via `operation_list` automatically — no doc changes needed.

For scaffolds: return a `buildScaffold(...)` result with rich `would_read_from`, `would_write_to`, `governance_required`, `next_steps_to_make_live`. The agent reads these and knows what to implement (or skip).

For LIVE conversions: the scaffold's `next_steps_to_make_live` array is your implementation checklist. Replace the `buildScaffold` call with the real algorithm; keep the metadata.
