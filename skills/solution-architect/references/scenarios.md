# Scenario Matrix

Use the answers to Q0–Q3 from the diagnosis flow in SKILL.md to locate the customer's scenario. Each cell gives: current state characterization, biggest risk, recommended entry cluster, first operation to run in < 20 minutes, and a 30/60/90-day path.

---

## Archetype × Maturity Matrix

### Startup × Messy

**State:** Founder or first AE entered contacts manually. Fields are inconsistent, duplicates exist, no lifecycle stage discipline. The CRM is a spreadsheet with a UI.

**Biggest risk:** Scoring dirty data gives confident-looking but wrong prioritization. AI will happily score garbage and produce garbage rankings.

**Entry cluster:** Data Quality first, then Quick Win.

**First op in < 20 min:** `analyze.deduplication` (dry-run) — shows how much duplicate data exists before touching anything. Zero risk, instant insight.

**Path:**
- 30d: Dedup + lifecycle normalization complete. CRM is trustworthy.
- 60d: ICP scoring running on clean data. Daily digest for founder/AE.
- 90d: First outreach sequences generated. Lead quality scoring calibrated.

---

### Startup × Structured

**State:** CRM is clean, lifecycle stages are consistent, data is trustworthy — but no AI layer. Usually a technical founder or ops-minded first hire set this up right.

**Biggest risk:** Competitors with AI are moving faster. Time is the constraint, not data quality.

**Entry cluster:** Quick Win stack immediately.

**First op in < 20 min:** Run `crm.sync-core` (dry-run) then `score.icp-fit` (dry-run). See your companies ranked by ICP fit before the first coffee.

**Path:**
- 30d: ICP fit + lead quality scoring on entire database. Daily digest live.
- 60d: Outreach sequences for top ICP contacts. Meeting briefs for AE calls.
- 90d: Reply sentiment tracking. Win/loss analysis feeding ICP refinement.

---

### Startup × Advanced

**State:** Already has automation (Zapier/Make sequences, maybe Apollo or Outreach), wants to consolidate or go deeper. Usually hitting scaling limits of the patchwork.

**Biggest risk:** Adding more tools to an already-complex stack. Risk of duplication, contradictory writes, and audit nightmares.

**Entry cluster:** Audit first with `optimize.review-runs`, then selectively replace patchwork with operations.

**First op in < 20 min:** `optimize.review-runs` — understand what's currently running and what it's producing before adding anything.

**Path:**
- 30d: Map current automation stack against crm-ai-operators operations. Identify overlaps.
- 60d: Replace 1–2 patchwork workflows with governed operations. Validate equivalence via audit log.
- 90d: Full migration. Single audit trail. ICP refinement loop running.

---

### Growth × Messy

**State:** CRM grew fast with the team, nobody owned data quality, first RevOps hire is drowning in manual cleanup. Lifecycle stages are chaos, duplicates everywhere, properties filled in inconsistently.

**Biggest risk:** RevOps person spending 80% of time on hygiene instead of pipeline strategy. AI at scale on this data will make the mess worse faster.

**Entry cluster:** Data Quality stack first to unblock RevOps, then Pipeline Intelligence.

**First op in < 20 min:** `sync.normalize-lifecycle` (dry-run) — shows lifecycle stage distribution and what would be normalized. Immediate visibility into the mess.

**Path:**
- 30d: Lifecycle normalization + dedup complete. RevOps freed from manual cleanup.
- 60d: Pipeline intelligence running. Daily digest for reps. ICP scoring calibrated.
- 90d: Outreach automation for top accounts. RevOps doing strategy, not hygiene.

---

### Growth × Structured

**State:** RevOps has cleaned the CRM, lifecycle stages are solid, data is trustworthy. Now the team wants an AI intelligence layer to scale what RevOps can do.

**Biggest risk:** Moving too slowly and missing pipeline signals while the CRM is clean.

**Entry cluster:** Pipeline Intelligence → Outreach Automation.

**First op in < 20 min:** `act.daily-digest` — gives every rep a ranked daily digest with their top prospects. Reps see value on day 1.

**Path:**
- 30d: Daily digest live for all reps. ICP fit + lead quality scoring complete.
- 60d: Outreach sequences for top ICP contacts. Meeting briefs for AE calls. Reply sentiment tracking.
- 90d: Pipeline health reports weekly. Win/loss analysis feeding ICP refinement.

---

### Growth × Advanced

**State:** Has AI/automation running — likely a patchwork of Zapier, native HubSpot Breeze, and manual sequences. Works but is hard to audit, hard to debug, hard to scale.

**Biggest risk:** Technical debt in the automation stack. Hard to trust what's actually running, what's writing to the CRM, and why.

**Entry cluster:** Replace patchwork with Full RevOps stack. Use the audit log to validate equivalence.

**First op in < 20 min:** `report.pipeline-health` — baseline snapshot of current pipeline state before any migration. Gives you a before/after reference point.

**Path:**
- 30d: Audit current automation stack. Map to crm-ai-operators equivalents.
- 60d: Migrate highest-value workflows. Single audit trail replacing patchwork logs.
- 90d: Full RevOps stack running. ICP refinement loop. Optimization cadence established.

---

### Enterprise × Messy

**State:** Enterprise CRM with years of dirty data, multiple data owners, siloed teams writing conflicting values, possible compliance requirements (GDPR/CCPA).

**Biggest risk:** AI writes bad data at scale and it propagates to downstream systems (finance, CS, support). One bad run at enterprise scale = thousands of corrupted records.

**Entry cluster:** Setup + Governance review FIRST (get all 18 guidelines in front of stakeholders), then Data Quality at small scale with strict dry-run gates.

**First op in < 20 min:** `setup.verify` (confirms auth) then `setup.diff` (previews schema changes) — zero writes, full visibility. Show stakeholders what the system would provision before they authorize anything.

**Path:**
- 30d: Governance guidelines reviewed and customized with RevOps + Legal. Setup applied to pilot team only.
- 60d: Data Quality stack running on pilot team's records. Validate outputs with RevOps.
- 90d: Pilot validated. Roll out to one additional team. Compliance review complete.

---

### Enterprise × Structured

**State:** Enterprise CRM is clean, IT/security has been involved, RevOps team is ready and asking for AI capabilities. Usually triggered by competitive pressure or a CRO directive.

**Biggest risk:** Governance and change management. Who approves guideline changes? Who gets the daily digest? Which rep teams are in scope first?

**Entry cluster:** Full RevOps stack, phased by team. Start with one team as pilot.

**First op in < 20 min:** `setup.diff` → review all 18 guidelines with RevOps → `act.daily-digest` for pilot team of 2–3 reps.

**Path:**
- 30d: Pilot team (3–5 reps) live with full Pipeline Intelligence + Daily Digest. Governance sign-off documented.
- 60d: Expand to 2–3 more teams. Outreach automation enabled for pilot team. CRM writeback policy confirmed with IT.
- 90d: Full org rollout. Win/loss analysis running. ICP refinement loop established.

---

### Enterprise × Advanced

**State:** Already has AI capabilities (Einstein, Breeze, custom models) and is evaluating crm-ai-operators as a replacement, supplement, or standard for custom operations.

**Biggest risk:** Duplicated scoring/writing — two systems writing `ai_score` to the same field with different logic. Stakeholder confusion about which AI is authoritative.

**Entry cluster:** Optimization Loop + custom operations for unique use cases. Map existing AI outputs to crm-ai-operators properties to avoid conflicts.

**First op in < 20 min:** `optimize.refine-icp` — compare the AI's ICP recommendation against the current definition. Shows stakeholders what the system would change and why, without writing anything.

**Path:**
- 30d: Existing AI capabilities mapped to crm-ai-operators namespaces. Conflict analysis complete.
- 60d: crm-ai-operators running in parallel with existing AI. Output comparison logged.
- 90d: Migration decision made (replace or supplement). Custom operations built for unique enterprise use cases.

---

## Use-Case Overlays

### Pipeline Visibility

**Best fit:** Growth/Enterprise × Structured or Advanced
**Operations:** `report.pipeline-health`, `analyze.buying-stage`, `act.daily-digest`, `score.lead-quality`
**30d:** Pipeline health snapshot running weekly. Buying stage inferred on all active deals.
**60d:** Daily digest for all reps with top prospects ranked. Lead quality scoring calibrated.
**90d:** Win/loss pattern analysis. ICP refinement from lost deals.

### Outreach Automation

**Best fit:** Startup/Growth × Structured or Advanced (HubSpot only for generate ops)
**Operations:** `generate.outreach-sequence`, `generate.meeting-brief`, `analyze.reply-sentiment`, `act.notify-rep-handoff`
**30d:** First sequences generated and queued for top ICP contacts (dry-run validated).
**60d:** Reply sentiment tracking live. Handoff alerts for hot replies. Meeting briefs for AE calls.
**90d:** Sequence performance tracked. Outreach-playbook guideline updated from reply analysis.

### AI Scoring

**Best fit:** Any archetype × Structured or Advanced
**Operations:** `score.icp-fit`, `score.lead-quality`, `optimize.refine-icp`
**30d:** ICP fit score on all companies. Lead quality on all contacts. Scores visible in CRM.
**60d:** Scoring calibrated against recently won deals.
**90d:** ICP definition updated from win/loss analysis. Full database rescored. Measurable improvement in qualified pipeline %.

### Data Quality

**Best fit:** Growth/Enterprise × Messy
**Operations:** `analyze.deduplication`, `sync.normalize-lifecycle`, `sync.push-properties`, `crm.sync-core`
**30d:** Dedup report generated (dry-run). Lifecycle normalization proposal reviewed by RevOps.
**60d:** Normalization applied. Properties synced back to CRM. Hygiene maintained automatically.
**90d:** Data quality score tracked via audit log. First AI scoring run on clean data.

### Call Intelligence

**Best fit:** Growth/Enterprise × any maturity
**Operations:** `analyze.call-summary`, `analyze.buying-stage` (from call data), `research.contact-background`
**30d:** Call summaries automated for all recorded calls.
**60d:** Buying stage inferred from call conversations. `next_best_action` populated.
**90d:** Call intelligence feeding meeting briefs. Rep prep time reduced measurably.

### Win/Loss Analysis

**Best fit:** Growth/Enterprise × Structured or Advanced
**Operations:** `report.win-loss`, `optimize.refine-icp`, `optimize.review-runs`
**30d:** First win/loss report generated. Pattern analysis shared with RevOps + AEs.
**60d:** ICP refinement proposed from win/loss patterns. Scoring weights updated.
**90d:** Refined ICP propagated to all scoring operations. Win rate tracking established.

---

## Quick First-Win Index

| Scenario | First operation | Time to insight |
|----------|----------------|-----------------|
| Any × Messy | `analyze.deduplication` (dry-run) | 10 minutes |
| Startup × Structured | `score.icp-fit` (dry-run) | 15 minutes |
| Growth × Structured | `act.daily-digest` (dry-run) | 10 minutes |
| Enterprise × any | `setup.diff` | 5 minutes |
| Any × Advanced | `report.pipeline-health` | 10 minutes |
| Any (call intelligence) | `analyze.call-summary` (dry-run) | 15 minutes |
