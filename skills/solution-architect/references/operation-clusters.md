# Operation Clusters

Five named stacks that group operations into cohesive rollout units. Use these in the design phase to prescribe a path. Each stack builds on the previous — but the Quick Win and Data Quality stacks are independent starting points.

---

## Stack Overview

| Stack | Core operations | Time to first value | HubSpot | Salesforce |
|-------|----------------|---------------------|---------|------------|
| **Quick Win** | setup.apply, crm.sync-core, score.icp-fit, act.daily-digest | < 1 hour | ✓ Live | ✓ Live |
| **Pipeline Intelligence** | + score.lead-quality, analyze.buying-stage, report.pipeline-health | Day 1–2 | ✓ Live | ✓ Live |
| **Outreach Automation** | + generate.outreach-sequence, generate.meeting-brief, analyze.reply-sentiment, act.notify-rep-handoff | Day 2–5 | ✓ Live | ✓ Live |
| **Data Quality** | analyze.deduplication, sync.normalize-lifecycle, sync.push-properties, crm.sync-core | Day 1–3 | ✓ Live | ✓ Live |
| **Full RevOps** | All 26 operations + subagent pipelines | Week 1–3 | ✓ Live | ✓ Live |

---

## Stack 1: Quick Win

**Purpose:** Prove value to stakeholders in under an hour. Show AI scoring on real data without writing anything.

**Operations:**
1. `setup.apply` — provision Personize collections and guidelines
2. `crm.sync-core` — sync contacts and companies into Personize memory
3. `score.icp-fit` — score companies against ICP definition (0–100)
4. `act.daily-digest` — per-rep ranked digest of top prospects

**Prerequisites:**
- [ ] Personize account active with HubSpot connected via OAuth
- [ ] `PERSONIZE_SECRET_KEY` in `.env`
- [ ] `npm install` completed
- [ ] Run `setup.diff` first to preview what `setup.apply` will provision
- [ ] ICP definition guideline reviewed by RevOps before scoring (open `manifests/core/guidelines/icp-definition.md`)

**Rollout order:**
```
setup.apply → crm.sync-core → score.icp-fit → act.daily-digest
```
Each step gates the next. Don't run scoring before sync; don't run digest before scoring.

**Expected outputs:**
- Personize collections created (contacts, companies, tasks, operation-runs, etc.)
- All CRM contacts and companies in Personize memory
- Each company has `icp_fit_score` (0–100) and `icp_fit_reason`
- Each rep receives a ranked digest showing top 5 prospects with scores and next actions

**Salesforce note:** all four operations run live on Salesforce, at parity with HubSpot. `setup.apply` provisions `Personize_*__c` fields on Lead/Contact/Account; scores mirror back via write-back. Only the object model differs (Lead/Contact split, companies as Account).

---

## Stack 2: Pipeline Intelligence

**Purpose:** Give RevOps and AEs full pipeline visibility — which deals are moving, which are stalled, which contacts are ready to buy.

**Builds on:** Quick Win stack (must be complete first)

**Operations added:**
5. `score.lead-quality` — per-contact quality score combining persona match, ICP lift, engagement, account score
6. `analyze.buying-stage` — infer buying stage from conversations + signals; update `next_best_action`
7. `report.pipeline-health` — snapshot pipeline stage distribution, at-risk accounts, momentum signals

**Prerequisites (in addition to Quick Win):**
- [ ] `crm.sync-core` has run at least once (contacts and companies in memory)
- [ ] Conversations collection populated (via `sync.pull-engagements` or direct Personize sync)
- [ ] Signal definitions guideline reviewed (`manifests/core/guidelines/signal-definitions.md`)

**Rollout order:**
```
score.lead-quality (parallel with score.icp-fit)
analyze.buying-stage (needs conversation data)
report.pipeline-health (runs after scoring complete)
```

**Expected outputs:**
- Each contact has `lead_quality_score` (0–100) with component breakdown
- Each active deal has inferred `buying_stage` and `next_best_action`
- Weekly pipeline health report: stage distribution, at-risk accounts, momentum signals

**Salesforce note:** `score.lead-quality`, `analyze.buying-stage`, and `report.pipeline-health` all run live on Salesforce — they operate on Personize memory, which is CRM-neutral once records are synced in.

---

## Stack 3: Outreach Automation

**Purpose:** Generate governed, personalized outreach at scale. Replace manual sequence writing with AI-generated, brand-voice-compliant sequences.

**Builds on:** Pipeline Intelligence stack (scores must exist to prioritize outreach targets)

**Operations added:**
8. `generate.outreach-sequence` — 3-email sequence per contact, per outreach-playbook + brand-voice guidelines
9. `generate.meeting-brief` — pre-call AE brief: account context, contact history, signals, recommended angles
10. `analyze.reply-sentiment` — classify inbound replies (positive/neutral/negative/objection/opt-out)
11. `act.notify-rep-handoff` — alert rep when a contact crosses a handoff threshold (sentiment + score)

**Optional additions:**
- `generate.proposal` — AI-drafted proposal from meeting notes + account context
- `generate.win-back-sequence` — re-engagement sequence for churned or stalled accounts
- `generate.mutual-action-plan` — MAP doc for late-stage deals

**Prerequisites:**
- [ ] `score.icp-fit` and `score.lead-quality` complete (need scores to filter outreach targets)
- [ ] Outreach-playbook guideline reviewed and customized (`manifests/core/guidelines/outreach-playbook.md`)
- [ ] Brand-voice guideline reviewed and customized (`manifests/core/guidelines/brand-voice.md`)
- [ ] Multichannel-rules guideline reviewed (`manifests/core/guidelines/multichannel-rules.md`)
- [ ] Reply-handling guideline reviewed (`manifests/core/guidelines/reply-handling.md`)

**Rollout order:**
```
generate.outreach-sequence (filter: top ICP contacts, icp_fit_score >= 70)
generate.meeting-brief (before each AE call, on-demand)
analyze.reply-sentiment (as replies come in)
act.notify-rep-handoff (triggered by sentiment + score threshold)
```

**Expected outputs:**
- Each qualified contact has a 3-email sequence created as tasks in CRM
- AEs have a brief ready before every discovery call
- All inbound replies classified and routed
- Reps notified instantly when a contact is ready for human handoff

**HubSpot/Salesforce:** All generate and analyze operations run on both CRMs — they read and write Personize memory, not the CRM directly, so they are provider-neutral.

---

## Stack 4: Data Quality

**Purpose:** Clean CRM data before or instead of AI scoring. Essential entry point for Messy-maturity customers.

**Independent from Quick Win** — can be run as the first stack for Messy-maturity customers.

**Operations:**
1. `analyze.deduplication` — identify duplicate contacts and companies; surface merge candidates
2. `sync.normalize-lifecycle` — standardize lifecycle stage values across the database
3. `sync.push-properties` — push Personize-computed properties back to CRM custom fields
4. `crm.sync-core` — re-sync after cleanup to refresh Personize memory

**Prerequisites:**
- [ ] `setup.apply` complete
- [ ] Data-hygiene guideline reviewed (`manifests/core/guidelines/data-hygiene.md`)
- [ ] CRM writeback policy confirmed with IT (`manifests/core/guidelines/crm-writeback-policy.md`)
- [ ] Dedup results reviewed by RevOps before any merges

**Rollout order:**
```
analyze.deduplication (dry-run first — review output before any action)
sync.normalize-lifecycle (dry-run → RevOps review → live)
crm.sync-core (re-sync after normalization)
sync.push-properties (after Personize properties are computed)
```

**Expected outputs:**
- Dedup report: list of duplicate pairs with merge confidence score
- Lifecycle stages normalized across all contacts/companies
- Personize-computed properties (scores, stages, signals) pushed back to CRM
- CRM and Personize memory in sync

**Salesforce:** all four operations run live on Salesforce. `sync.normalize-lifecycle` already carries the Salesforce lead-status / opportunity-stage canonical map; `crm.sync-core` and `sync.push-properties` are provider-generic.

---

## Stack 5: Full RevOps

**Purpose:** Full AI-operated RevOps — all 26 operations running in governed pipelines, with optimization loops.

**Builds on:** All previous stacks.

**Additional operations:**
- `research.account-deep-dive` — comprehensive account research, fills company + signals + stakeholders
- `research.contact-background` — contact professional background + social signals
- `analyze.call-summary` — summarize call recordings; extract next steps, buying signals
- `report.win-loss` — analyze won vs churned accounts; surface win/loss patterns
- `optimize.review-runs` — review all operation run history; propose playbook improvements
- `optimize.refine-icp` — propose concrete ICP definition updates from won vs lost accounts
- `sync.pull-engagements` — pull CRM engagement history into Personize conversations

**Prerequisites:**
- [ ] All previous stacks validated in dry-run
- [ ] At least 30 days of operation run history (for optimization operations to have data)
- [ ] Won and churned accounts tagged in CRM for win/loss analysis
- [ ] Call recording integration set up (for call intelligence)

**Rollout order:** Use subagent pipelines — see `references/subagent-patterns.md` for the Full Prospecting Pipeline and Optimization Loop patterns.

**Expected outputs:**
- Full AI RevOps layer: every rep's workflow supported by AI from research through close
- Weekly: pipeline health report, win/loss analysis, ICP refinement proposals
- Daily: digest per rep, call summaries, buying stage updates, handoff alerts
- Monthly: ICP definition updated, scoring weights recalibrated, playbook refined

**Salesforce:** Research, report, and optimize operations run live on Salesforce. The full RevOps stack is at parity across both CRMs.
