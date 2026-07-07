# Solution Architect Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `skills/solution-architect/` — a hub-and-spoke skill that turns Claude Code into a presales advisor, solution architect, implementation guide, and optimization coach for the crm-ai-operators repo.

**Architecture:** `SKILL.md` is the always-loaded hub (triggers, vision, phase arc, diagnosis flow, hard rules). Eight reference files in `references/` are loaded on-demand per phase. No TypeScript changes — pure markdown.

**Tech Stack:** Markdown only. No build step. No npm changes. Branch: `Hamed-July-2026`.

## Global Constraints

- All files live under `skills/solution-architect/` (relative to repo root)
- SKILL.md must have YAML frontmatter: `name:` and `description:` fields, matching the format in `skills/crm-ai-operators/SKILL.md`
- All ROI figures must use verified values: $0.003/memorize, $0.001/recall, ~23x more work per dollar
- All operation names must exactly match the registry (`src/core/operations/registry.ts`) — never invent names
- Salesforce scaffold operations must always be flagged as "coming soon" — never presented as live
- Commit after each task to `Hamed-July-2026`

---

### Task 1: SKILL.md — The Hub

**Files:**
- Create: `skills/solution-architect/SKILL.md`
- Create: `skills/solution-architect/references/` (directory)

**Interfaces:**
- Produces: skill entry point loaded by Claude Code; references all 8 files in references/ by relative path

- [ ] **Step 1: Create the folder structure**

```bash
mkdir -p skills/solution-architect/references
```

- [ ] **Step 2: Write `skills/solution-architect/SKILL.md`**

```markdown
---
name: solution-architect
description: Use when a leader, RevOps manager, or engineer wants to evaluate, adopt, design, customize, or extend the crm-ai-operators repo. Triggers on "why should we use this", "where do we start", "what should we run first", "how do I customize this operation", "how do I build a new operation", "how do I design a multi-agent pipeline", "is this worth it", or any evaluation/adoption context. Also triggers when someone asks about guidelines tuning, memory architecture, or AI model selection for operations.
---

# CRM AI Operators — Solution Architect

## When This Skill Activates

Load this skill when you detect any of:
- A leader or evaluator asking "why should we use this?", "what does this do?", "is this worth it?"
- A RevOps, sales-ops, or engineering person asking "where do we start?", "what should we run first?"
- Anyone asking about customizing an existing operation
- Anyone asking about building a new operation from scratch
- Anyone asking how to design multi-agent or subagent pipelines with these operations
- Anyone asking about guidelines, memory architecture, or AI instruction tuning
- The repo is being evaluated for adoption (setup has not yet been run)

## The Vision (Always in Context)

**crm-ai-operators** is an open-source library of 26 governed CRM operations for HubSpot and Salesforce, built on Personize memory and governance.

**Three-layer architecture:**
1. **Memory** — Personize stores everything: contacts, companies, conversations, signals, operation runs. Your CRM data becomes a governed, queryable knowledge base that persists across every AI session.
2. **Governance** — 18 plain-English guidelines gate every write. ICP definition, lead scoring policy, brand voice, outreach rules — all in markdown, all editable by your team, all enforced automatically before any AI writes to your CRM.
3. **Operations** — 26 atomic AI work units. Each follows RECALL → GOVERN → ACT → STORE. Idempotent, audited, dry-run by default. You can run one or chain them into pipelines.

**The economic case:** One AI agent running 5 operations replaces 2–3 RevOps FTE per day. At ~$0.003/memorize and ~$0.001/recall, that's ~23x more work per dollar vs frontier LLM APIs alone. The AI cost for scoring 1,000 contacts is under $3; a RevOps analyst doing the same work costs $200–400 in loaded labor.

**Why not alternatives?**
- **Salesforce Einstein / HubSpot Breeze:** Locked inside one CRM ecosystem, proprietary, no governance layer you control, no cross-CRM memory, no open-source extensibility. If you migrate CRMs or add one, you start from zero.
- **Custom build:** 6–12 months of engineering. You build the ops library, the governance layer, the memory substrate, the CRM adapters, the audit trail — all from scratch, all maintained by your team forever. This repo gives you all of that on day 1, open-source.
- **Doing nothing:** Your AI-enabled competitors are scoring leads, writing sequences, and researching accounts while your reps do it manually. The gap compounds quarterly.

## Six Phases

Identify the current phase and load the indicated references. Phases are not strictly sequential — read context and enter the right one.

| Phase | Trigger | References to load |
|-------|---------|-------------------|
| **qualify** | First contact — confirm prerequisites | none (inline questions below) |
| **pitch** | Leader wants vision or business case | `references/roi-playbook.md` |
| **diagnose** | "Where do we start?" / "What should we run?" | `references/scenarios.md` |
| **design** | Prescribe stack, memory architecture, pipelines | `references/operation-clusters.md`, `references/memorization-strategy.md`, `references/subagent-patterns.md` |
| **implement** | Customize existing or build new operations | `references/customization-guide.md` or `references/new-operation-guide.md` |
| **optimize** | Tune guidelines, model tiers, scoring weights | `references/guidelines-optimization.md` |

## Qualify Phase (Inline — No Reference Load)

Before pitching or diagnosing, confirm three things:

1. **Personize account?** Required. If not: sign up at app.personize.ai, connect HubSpot via OAuth, generate a `PERSONIZE_SECRET_KEY`. Setup takes ~5 minutes.
2. **Which CRM?**
   - HubSpot → all 26 operations available today
   - Salesforce → setup + sync operations are live; generate/analyze/act/report/optimize are scaffold (coming soon). Say this clearly — do not promise Salesforce ops that don't exist yet.
   - Both / evaluating → treat as HubSpot-first, Salesforce roadmap
3. **Repo cloned and `npm install` run?** If not, start there before any diagnosis.

## Diagnosis Flow (Inline — No Reference Load)

Ask these in order. Answers map to a scenario in `references/scenarios.md`.

**Q0 — CRM Platform** (gates everything downstream)
- A) HubSpot (full operations available)
- B) Salesforce (setup + sync only today)
- C) Both / evaluating

**Q1 — Company Archetype**
- A) Startup: 1–5 AEs, founder-led sales, no dedicated RevOps
- B) Growth: 6–25 AEs, first RevOps hire, CRM exists but messy
- C) Enterprise: 25+ AEs, dedicated RevOps team, CRM mature

**Q2 — CRM Maturity**
- A) Messy: incomplete data, no hygiene, fields unused
- B) Structured: clean data, consistent lifecycle stages, no AI layer yet
- C) Advanced: clean data + some AI/automation, want to go deeper or replace patchwork

**Q3 — Primary Pain / Use Case**
- A) Pipeline visibility
- B) Outreach automation
- C) AI scoring
- D) Data quality
- E) Call intelligence
- F) Win/loss analysis

Once you have Q0–Q3, load `references/scenarios.md` and find the matching cell for the precise prescribed path.

## Hard Rules

1. **Always confirm CRM platform before any recommendation.** Salesforce scaffold operations must be flagged as "coming soon" — never presented as available today.
2. **Read `AGENTS.md` before touching any operation.** It contains the operational hard rules that govern every run.
3. **Never recommend live writes without dry-run first.** `DRY_RUN=true` is the default and must stay that way until the customer has validated dry-run output and explicitly authorized live writes.
4. **Never hallucinate operation names.** Always verify against `operation_list` (via MCP) or `CAPABILITY-MENU.md` before recommending specific operations by name.
5. **Anchor all ROI claims to the verified calc:** $0.003/memorize, $0.001/recall, ~23x more work per dollar. Never invent or inflate numbers.
6. **Never promise a specific ROI number** to a specific customer. Present the framework; let them calculate their own with their actual volume.
7. **Never modify `manifests/` files** without confirming the customer has run `setup.diff` first to preview what would change.
```

- [ ] **Step 3: Verify the file**

Check that `skills/solution-architect/SKILL.md` exists and contains all required sections:

```bash
grep -c "## When This Skill Activates\|## The Vision\|## Six Phases\|## Qualify Phase\|## Diagnosis Flow\|## Hard Rules" skills/solution-architect/SKILL.md
```

Expected output: `6`

- [ ] **Step 4: Commit**

```bash
git add skills/solution-architect/SKILL.md
git commit -m "feat(skill): add solution-architect SKILL.md hub"
```

---

### Task 2: scenarios.md — The 3D Diagnosis Matrix

**Files:**
- Create: `skills/solution-architect/references/scenarios.md`

**Interfaces:**
- Consumed by: SKILL.md (diagnose phase); tells the agent exactly what to prescribe given Q0–Q3 answers

- [ ] **Step 1: Write `skills/solution-architect/references/scenarios.md`**

```markdown
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
```

- [ ] **Step 2: Verify**

```bash
grep -c "### Startup\|### Growth\|### Enterprise\|## Use-Case Overlays\|## Quick First-Win Index" skills/solution-architect/references/scenarios.md
```

Expected output: `11`

- [ ] **Step 3: Commit**

```bash
git add skills/solution-architect/references/scenarios.md
git commit -m "feat(skill): add solution-architect scenarios matrix"
```

---

### Task 3: roi-playbook.md — Presales & Competitive Positioning

**Files:**
- Create: `skills/solution-architect/references/roi-playbook.md`

**Interfaces:**
- Consumed by: SKILL.md (pitch phase)
- Produces: stakeholder-specific pitch scripts, verified ROI framework, competitive positioning, demo script, objection handling

- [ ] **Step 1: Write `skills/solution-architect/references/roi-playbook.md`**

```markdown
# ROI Playbook

Reference for the pitch phase. Contains stakeholder-specific pitches, verified ROI framework, competitive positioning, demo script, and objection handling.

---

## Verified ROI Framework

**Unit economics (verified from app.personize.ai/pricing):**
- Memorize (write a record to Personize): ~$0.003 per record
- Recall (retrieve a record from Personize): ~$0.001 per record
- Result: ~23x more work per dollar vs frontier LLM APIs alone

**FTE offset model:**
- 5 operations running daily = approximately 2–3 RevOps FTE of analytical and outreach work
- Scoring 1,000 contacts: ~$3 in AI cost vs $200–400 in loaded RevOps labor (100x cost reduction per task)
- Generating 100 outreach sequences: ~$15–30 in AI cost vs 10–20 hours of SDR time

**How to help the customer calculate their own ROI:**
1. Ask: how many contacts/companies are in your CRM?
2. Ask: how many hours/week does RevOps spend on scoring, hygiene, and sequence writing?
3. Calculate: (hours × loaded hourly rate) vs (records × $0.003 per memorize + $0.001 per recall per operation)
4. Show the ratio — let the customer derive the conclusion

**Never promise a specific ROI number.** Present the framework. The customer's own calculation is always more credible than a vendor's claim.

---

## Stakeholder-Specific Pitches

### CRO

**What they care about:** Pipeline coverage, win rate, rep productivity, forecast accuracy.

**Lead with:**
> "Your top reps are spending 40% of their time on research and admin that AI can do in seconds. With crm-ai-operators running daily, every rep gets a scored, ranked digest with pre-written sequences and meeting briefs — before their first coffee. Your pipeline doesn't change; your reps just work the right part of it."

**Supporting points:**
- `act.daily-digest` surfaces the top 5 prospects per rep, ranked by composite AI score + signal weight
- `generate.meeting-brief` gives AEs a full account brief 60 seconds before a discovery call
- `analyze.buying-stage` infers deal stage from conversation data — forecast accuracy improves without reps manually updating CRM

**Avoid:** Technical details about Personize, MCP, TypeScript. The CRO doesn't care.

**Close with:**
> "Want to see it run on your actual HubSpot data in 20 minutes? Zero risk — dry-run mode shows you exactly what it would produce without writing anything to your CRM."

---

### CTO

**What they care about:** Architecture, security, data sovereignty, maintainability, not building from scratch.

**Lead with:**
> "This is MIT-licensed TypeScript you own. Personize stores your CRM data in a governed memory layer — nothing goes to a black box you don't control. Every operation is audited, dry-run by default, and namespaced so it can't corrupt your existing CRM fields. The MCP server is 200 lines. The operation runner is 150 lines. You can read the whole thing in an afternoon."

**Supporting points:**
- All CRM writes are namespaced under `personize_*` fields — never overwrites your existing CRM data
- Full audit trail in `data/audit/{date}.jsonl` — every AI action logged with input, output, and context
- DRY_RUN=true by default — the system shows you what it would do before it does anything
- MIT license — you own the code, you can fork it, you can contribute back
- No proprietary lock-in: swap the Personize SDK for a different memory layer if needed

**Avoid:** Vague AI promises. CTOs distrust "trust the AI." Show them the code.

**Close with:**
> "The security review doc is at `docs/SECURITY.md`. Happy to walk through the architecture. Or: clone the repo right now and read the source — it's 3,000 lines total."

---

### RevOps VP

**What they care about:** Pipeline health visibility, data hygiene, rep adoption, time savings for their team.

**Lead with:**
> "Right now you're the last line of defense between garbage CRM data and your CRO's forecast. crm-ai-operators runs deduplication, lifecycle normalization, and ICP scoring on your full contact and company database — automatically, every day, with a full audit trail. Your team goes from doing hygiene to reviewing AI outputs. That's a 10x leverage on every hour they spend."

**Supporting points:**
- `analyze.deduplication` finds duplicates without touching anything (dry-run first)
- `sync.normalize-lifecycle` standardizes lifecycle stages across the whole database
- `score.icp-fit` and `score.lead-quality` give every rep a consistent, explainable ranking
- All changes are logged to `workspace.updates` on each record — full history, no mystery writes

**Avoid:** Over-promising on custom workflows before they've seen the basics work.

**Close with:**
> "Setup takes 90 seconds. Your first dry run shows you exactly what it would change before it writes anything. Let's run it on your data right now."

---

### CFO

**What they care about:** ROI, cost, headcount, payback period.

**Lead with:**
> "The AI cost for scoring 1,000 contacts is under $3. A RevOps analyst doing the same work manually costs $200–400 in loaded labor. That's a 100x cost reduction per task. If your team scores 5,000 contacts per month manually, you're spending $1,000–2,000 in labor on a task that costs $15 in AI."

**Supporting points:**
- Use the verified unit economics: $0.003/memorize, $0.001/recall
- The first month of setup is the investment; ongoing cost is purely operational (AI API + Personize subscription)
- Every operation run is logged with token cost — full visibility into AI spend

**Avoid:** Overpromising headcount reduction (it's capacity expansion, not headcount cut). Don't invent customer-specific ROI numbers.

**Close with:**
> "We can run a cost estimate on your actual CRM volume right now. How many contacts and companies are in your system?"

---

## Competitive Positioning

### vs Salesforce Einstein

| Dimension | crm-ai-operators | Salesforce Einstein |
|-----------|-----------------|---------------------|
| CRM scope | HubSpot + Salesforce (multi-CRM) | Salesforce only |
| Governance | 18 org-controlled guidelines | Black box |
| Extensibility | Open-source, fork and add operations | Closed, Salesforce roadmap |
| Audit trail | Full JSONL per-day log | Limited |
| Memory persistence | Personize (cross-session, cross-CRM) | Session-scoped |
| Pricing | Personize subscription + AI API cost | Salesforce add-on pricing |
| Migration risk | Zero lock-in, MIT license | Deeply locked into Salesforce |

**Key message:** Einstein is a black box inside one vendor's walls. crm-ai-operators is code you own, governance you control, memory that persists across every AI session.

---

### vs HubSpot Breeze AI

| Dimension | crm-ai-operators | HubSpot Breeze AI |
|-----------|-----------------|-------------------|
| CRM scope | HubSpot + Salesforce | HubSpot only |
| Memory | Personize (persistent, cross-session) | None (stateless) |
| Governance | 18 customizable guidelines | None |
| Custom operations | Build any operation | Not possible |
| Audit trail | Full JSONL per-day | None |
| Extensibility | MIT open-source | Closed |

**Key message:** Breeze is a HubSpot feature. crm-ai-operators is an AI operating layer that works with HubSpot, Salesforce, or both — with persistent memory and governance Breeze doesn't have.

---

### vs Custom Build

| Dimension | crm-ai-operators | Custom build |
|-----------|-----------------|-------------|
| Time to first value | 20 minutes (dry-run) | 6–12 months |
| Operations library | 26 operations, maintained | Build from scratch |
| Governance layer | 18 guidelines, ready | Build from scratch |
| Memory substrate | Personize, production-ready | Build from scratch |
| CRM adapters | HubSpot live, Salesforce in progress | Build from scratch |
| Audit trail | Built-in | Build from scratch |
| Community | Open-source contributors | Solo maintenance |

**Key message:** A custom build takes a year and requires your team to maintain it forever. This repo gives you the full stack on day 1.

---

### vs Doing Nothing

**The compounding gap:** AI-enabled competitors are scoring leads, writing personalized sequences, and researching accounts while your reps do it manually. In a 6-month sales cycle, the gap between AI-assisted and manual prospecting is 2–3x pipeline coverage.

**The RevOps backlog:** Without AI, your RevOps team is the bottleneck for every scoring and hygiene task. Adding headcount is expensive; AI scales infinitely.

---

## Demo Script (20 Minutes, Zero Risk)

This demo runs entirely in dry-run mode. Nothing is written to the CRM.

**Step 1 — Show the catalog (2 min)**
Open `CAPABILITY-MENU.md` in the repo. Walk through the 26 operations grouped by namespace. Point out: 24 live, 2 scaffold. Show the status column.

**Step 2 — Show the governance layer (3 min)**
Open `manifests/core/guidelines/icp-definition.md`. Show that the ICP scoring criteria are plain English, editable by the RevOps team. Say: "This is what governs every AI score. Your team controls it."

**Step 3 — Run setup.diff (3 min)**
```bash
npm run setup:diff
```
Show: here's what the system would provision in your Personize account. Nothing has been written yet. This is the schema — collections, properties, guidelines.

**Step 4 — Run crm.sync-core dry-run (5 min)**
Via MCP or CLI:
```
operation_run("crm.sync-core", { dry_run: true, filter: { collection: "contacts", limit: 20 } })
```
Show: 20 contacts flowing into the memory layer. Show the Personize records. Show the workspace.updates entries.

**Step 5 — Run score.icp-fit dry-run (5 min)**
```
operation_run("score.icp-fit", { dry_run: true, filter: { collection: "companies", limit: 10 } })
```
Show: 10 companies scored against their own ICP definition. Show the scores and reasons. Point out: "The AI cited the ICP guideline in each reason — it's not a black box."

**Step 6 — Show the audit log (2 min)**
Open `data/audit/` — show the JSONL entries from the dry-run. Every action logged. "This is your audit trail. Your compliance team can read this."

---

## Objection Handling

**"We already have HubSpot Breeze / Salesforce Einstein."**
> "Does it let you customize the scoring criteria? Does it have a governance layer you control? Does it write to both Salesforce and HubSpot? Does it have a full audit trail? Does it persist memory across AI sessions?" (Answer to all: no.) "crm-ai-operators does all of these. It works alongside Breeze — or replaces it."

**"We don't trust AI in our CRM."**
> "DRY_RUN=true is the default. The system shows you exactly what it would write before it writes anything. You approve the output before a single field changes. Governance guidelines gate every write — your team defines the rules in plain English."

**"We don't have budget."**
> "The AI cost per 1,000 contacts scored is under $3. What's the cost of your RevOps team spending 10 hours a week on manual scoring? Let's calculate your current spend on tasks this replaces."

**"It's too complex for our team."**
> "Setup takes 90 seconds. The first operation runs in 5 minutes. The only technical requirement is a Personize account and a HubSpot connection. No infrastructure, no servers, no deployment."

**"We need to talk to IT / Security."**
> "Send them `docs/SECURITY.md`. All CRM writes are namespaced (personize_* fields — never overwrites your data). DRY_RUN=true by default. Full audit trail. MIT license — your legal team can read the full source. No data leaves your Personize account."

**"We're not sure this scales."**
> "The sync operation pages through your entire CRM. The scoring operations run on filters — you control batch size. Every operation is idempotent with skip_if logic, so you can safely re-run without double-writing. Enterprises with 100k+ contacts run these daily."
```

- [ ] **Step 2: Verify**

```bash
grep -c "## Verified ROI Framework\|## Stakeholder-Specific Pitches\|## Competitive Positioning\|## Demo Script\|## Objection Handling" skills/solution-architect/references/roi-playbook.md
```

Expected output: `5`

- [ ] **Step 3: Commit**

```bash
git add skills/solution-architect/references/roi-playbook.md
git commit -m "feat(skill): add solution-architect roi-playbook"
```

---

### Task 4: operation-clusters.md — The Five Stacks

**Files:**
- Create: `skills/solution-architect/references/operation-clusters.md`

**Interfaces:**
- Consumed by: SKILL.md (design phase)
- Produces: prescribed operation stacks with prerequisites, rollout order, expected outputs, HubSpot vs Salesforce availability

- [ ] **Step 1: Write `skills/solution-architect/references/operation-clusters.md`**

```markdown
# Operation Clusters

Five named stacks that group operations into cohesive rollout units. Use these in the design phase to prescribe a path. Each stack builds on the previous — but the Quick Win and Data Quality stacks are independent starting points.

---

## Stack Overview

| Stack | Core operations | Time to first value | HubSpot | Salesforce |
|-------|----------------|---------------------|---------|------------|
| **Quick Win** | setup.apply, crm.sync-core, score.icp-fit, act.daily-digest | < 1 hour | ✓ Live | Partial (setup + sync only) |
| **Pipeline Intelligence** | + score.lead-quality, analyze.buying-stage, report.pipeline-health | Day 1–2 | ✓ Live | Partial |
| **Outreach Automation** | + generate.outreach-sequence, generate.meeting-brief, analyze.reply-sentiment, act.notify-rep-handoff | Day 2–5 | ✓ Live | Scaffold (coming soon) |
| **Data Quality** | analyze.deduplication, sync.normalize-lifecycle, sync.push-properties, crm.sync-core | Day 1–3 | ✓ Live | Partial |
| **Full RevOps** | All 26 operations + subagent pipelines | Week 1–3 | ✓ Live | Future |

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

**Salesforce note:** `setup.apply` and `crm.sync-core` are live on Salesforce. `score.icp-fit` and `act.daily-digest` are scaffold — they will return a simulation envelope, not real output.

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

**Salesforce note:** `score.lead-quality` is scaffold on Salesforce. `analyze.buying-stage` and `report.pipeline-health` are scaffold.

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

**HubSpot/Salesforce:** All generate and analyze operations are HubSpot-only today. Salesforce scaffold coming soon.

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

**Salesforce:** `analyze.deduplication` and `sync.normalize-lifecycle` are scaffold on Salesforce. `crm.sync-core` and `sync.push-properties` are live.

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

**Salesforce:** Research, report, and optimize operations are scaffold on Salesforce. Full RevOps stack is HubSpot-first.
```

- [ ] **Step 2: Verify**

```bash
grep -c "## Stack 1\|## Stack 2\|## Stack 3\|## Stack 4\|## Stack 5\|## Stack Overview" skills/solution-architect/references/operation-clusters.md
```

Expected output: `6`

- [ ] **Step 3: Commit**

```bash
git add skills/solution-architect/references/operation-clusters.md
git commit -m "feat(skill): add solution-architect operation-clusters"
```

---

### Task 5: customization-guide.md — Modifying Existing Operations

**Files:**
- Create: `skills/solution-architect/references/customization-guide.md`

**Interfaces:**
- Consumed by: SKILL.md (implement phase, modify path)
- Produces: safe customization patterns, upgrade safety instructions

- [ ] **Step 1: Write `skills/solution-architect/references/customization-guide.md`**

```markdown
# Customization Guide

How to safely modify existing operations to match a customer's specific business logic, scoring criteria, or workflow requirements.

---

## Anatomy of an Operation File

Every operation in `src/core/operations/impl/` has six parts:

```typescript
// 1. IMPORTS — lib utilities and types
import { retrieveRecords } from "../../lib/recall.js";
import { setProperty } from "../../lib/persist.js";
import { aiPrompt } from "../../lib/ai.js";
import { loadGuideline } from "../../lib/governance.js";
import { evaluateSkipIf } from "../../lib/skip-if.js";
import { workspace } from "../../lib/workspace.js";
import type { OperationEntry } from "../types.js";

// 2. DEFAULT FILTER — what records to process if no filter is passed
const DEFAULT_FILTER: Filter = {
  collection: "companies",
  where: { lifecycle_stage: { neq: "Disqualified" } },
  limit: 50,
};

// 3. OUTPUT SCHEMA — Zod schema for AI output validation
const OutputSchema = z.object({
  score: z.number().min(0).max(100),
  reason: z.string(),
});

// 4. OPERATION ENTRY — the exported registration object
export const myOperation: OperationEntry = {
  name: "score.my-fit",          // namespace.verb-noun
  mode: "operation",
  description: "...",
  category: "score",
  status: "live",                 // "live" | "scaffold" | "idea"
  idempotent: true,
  cost: "medium",                 // "low" | "medium" | "high"
  run_mode: "on-trigger",         // "on-trigger" | "scheduled" | "on-demand"
  guidelines_required: ["icp-definition"],
  skip_if: { property: "my_score", updated_within: "7d" },

  // 5. RUN FUNCTION — RECALL → GOVERN → ACT → STORE
  run: async (input, context) => {
    // RECALL
    const records = await retrieveRecords(...);
    // GOVERN
    const guideline = await loadGuideline("icp-definition");
    // ACT (loop, skip, score)
    for (const record of records) {
      if (evaluateSkipIf(...).skip) continue;
      const result = await aiPrompt({ ... });
      // STORE
      await setProperty(...);
      await workspace.appendUpdate(...);
    }
    // 6. RETURN — standard result envelope
    return { ok: true, runId: context.runId, operation: "score.my-fit", ... };
  },
};
```

---

## What's Safe to Customize

### 1. Prompt language and scoring criteria

**Where:** Inside the `aiPrompt()` call's `instructions` field.
**When:** The customer's ICP or scoring logic differs from the default.
**How:** Edit the instruction string directly. The guideline content is injected as `context` — you don't need to change the guideline loading, only the instruction framing.

Example — changing score weights in `score-icp-fit.ts`:
```typescript
// Before (default weights)
instructions: `Score using: 40% firmographic fit, 30% buying signals, 20% engagement, 10% champion potential`

// After (customer with engagement-heavy model)
instructions: `Score using: 30% firmographic fit, 20% buying signals, 40% engagement, 10% champion potential`
```

---

### 2. Default filter

**Where:** The `DEFAULT_FILTER` constant at the top of the file.
**When:** The customer wants a different default scope (e.g., only score contacts in certain lifecycle stages, or limit to a specific market segment).
**How:** Update the `where` clause and `limit`.

Example:
```typescript
// Before
const DEFAULT_FILTER: Filter = {
  collection: "companies",
  where: { lifecycle_stage: { neq: "Disqualified" } },
  limit: 50,
};

// After (customer only wants to score Enterprise segment)
const DEFAULT_FILTER: Filter = {
  collection: "companies",
  where: {
    lifecycle_stage: { neq: "Disqualified" },
    company_size_band: "Enterprise",
  },
  limit: 100,
};
```

---

### 3. skip_if window

**Where:** The `skip_if` field on the OperationEntry.
**When:** The customer's scoring cadence is different (e.g., rescore weekly vs every 7 days, or monthly for research operations).
**How:** Change `updated_within` value.

Example:
```typescript
// Before (default: skip if scored in last 7 days)
skip_if: { property: "icp_fit_score", updated_within: "7d" },

// After (customer wants to rescore monthly — CRM data changes slowly)
skip_if: { property: "icp_fit_score", updated_within: "30d" },
```

---

### 4. Guidelines loaded

**Where:** The `guidelines_required` array and `loadGuideline()` calls inside `run`.
**When:** The customer wants to add additional governance (e.g., also load competitor-policy when generating sequences).
**How:** Add the guideline name to the array and a `loadGuideline()` call in the run function. The guideline must exist in Personize (added via manifests).

Example:
```typescript
// Before
guidelines_required: ["outreach-playbook", "brand-voice"],

// After (also enforce competitor policy)
guidelines_required: ["outreach-playbook", "brand-voice", "competitor-policy"],

// In run function:
const competitorPolicy = await loadGuideline("competitor-policy");
// Include in aiPrompt context
```

---

### 5. Write-back field names

**Where:** The `setProperty()` calls inside `run`.
**When:** The customer uses different custom field names in their CRM (e.g., they already have a `hubspot_icp_score` field they want to keep).
**Caution:** Changing write-back fields requires also updating the `manifests/core/collections/` schema so Personize knows about the new property name.
**How:** Update `setProperty(identity, 'new_field_name', value)` and add the new property to the relevant collection JSON.

---

## What Requires More Care

### Adding new write-back fields
1. Add the property to `manifests/core/collections/{entity}.json`
2. Run `setup.diff` to preview the schema change
3. Run `setup.apply` to register it in Personize
4. Then add the `setProperty()` call in the operation

Never add a `setProperty()` call for a field that isn't registered in the collection manifest — it will fail silently.

### Changing scoring scale (e.g., 0–10 instead of 0–100)
Update the Zod schema, the prompt instructions, and any downstream operations that read the score. `score.lead-quality` reads `icp_fit_score` from companies — if you change the scale on `score.icp-fit`, update `score.lead-quality` too.

### Removing a governance load
If you remove a `loadGuideline()` call, the operation loses the governance gate for that guideline. Document why in a comment and get RevOps sign-off. Never remove governance silently.

---

## Updating Guidelines (No Code Changes)

Most behavioral customization should happen in guidelines, not code. If the customer wants to change:
- ICP scoring criteria → edit `manifests/core/guidelines/icp-definition.md`
- Outreach tone → edit `manifests/core/guidelines/brand-voice.md`
- Lead scoring weights → edit `manifests/core/guidelines/lead-scoring-policy.md`
- Competitor handling → edit `manifests/core/guidelines/competitor-policy.md`

After editing a guideline markdown file:
1. Run `setup.apply` to push the updated guideline to Personize
2. Re-run the dependent operations in dry-run mode to verify behavior changed as expected
3. Check `workspace.updates` on a few records to confirm the new logic is reflected

---

## Testing Customizations

Always test in this order:
1. Run with `DRY_RUN=true` and a small filter (`limit: 5`)
2. Inspect `workspace.updates` on the affected records
3. Review the dry-run output for correctness
4. Run `npm run typecheck` to confirm no TypeScript errors
5. Run live on a small batch (limit: 10) and verify CRM fields
6. Then expand to full database

---

## Naming Conventions

Keep the `namespace.verb-noun` pattern for operation names:
- `score.custom-fit` — a custom scoring operation
- `generate.partner-brief` — a custom generation operation
- `analyze.contract-risk` — a custom analysis operation
- `report.territory-health` — a custom report

File names follow `namespace-verb-noun.ts`:
- `score-custom-fit.ts`
- `generate-partner-brief.ts`

Export names follow camelCase:
- `scoreCustomFit`
- `generatePartnerBrief`

---

## Upgrade Safety

When the upstream repo (personizeai/crm-ai-operators) ships new versions, customized operations need to be kept in sync.

**Recommended pattern:** Keep all customizations in a separate directory:
```
src/core/operations/impl/custom/
├── score-custom-fit.ts
├── generate-partner-brief.ts
└── README.md   ← document what each custom op does and why
```

Standard operations stay in `src/core/operations/impl/` unmodified. When upstream ships updates:
1. Run `git diff upstream/main -- src/core/operations/impl/` to see what changed
2. If a standard operation you depend on changed, update your custom version accordingly
3. Your custom operations are isolated — they won't be overwritten by upstream updates

**Tracking upstream:** Add the upstream remote:
```bash
git remote add upstream https://github.com/personizeai/crm-ai-operators.git
git fetch upstream
git log upstream/main --oneline -20  # see recent changes
```
```

- [ ] **Step 2: Verify**

```bash
grep -c "## Anatomy of an Operation\|## What.s Safe to Customize\|## What Requires More Care\|## Updating Guidelines\|## Testing Customizations\|## Naming Conventions\|## Upgrade Safety" skills/solution-architect/references/customization-guide.md
```

Expected output: `7`

- [ ] **Step 3: Commit**

```bash
git add skills/solution-architect/references/customization-guide.md
git commit -m "feat(skill): add solution-architect customization-guide"
```

---

### Task 6: new-operation-guide.md — Building Net-New Operations

**Files:**
- Create: `skills/solution-architect/references/new-operation-guide.md`

**Interfaces:**
- Consumed by: SKILL.md (implement phase, build path)
- Produces: step-by-step operation scaffold with exact TypeScript template, registry instructions, contribution-back guidance

- [ ] **Step 1: Write `skills/solution-architect/references/new-operation-guide.md`**

Before writing, read one existing operation for exact import paths:
```bash
head -15 src/core/operations/impl/score-icp-fit.ts
```

```markdown
# New Operation Guide

How to build a net-new operation from scratch — one that doesn't map to any existing operation.

---

## Build vs Customize

**Customize an existing operation when:**
- The logic is right but parameters, filters, or prompt language need tuning
- You want different scoring weights or skip_if windows
- You want to add or remove a guideline from an existing operation

**Build a new operation when:**
- The work unit doesn't map to any existing operation (new namespace, new action type)
- You need to write to properties that no existing operation touches
- You're adding a new CRM integration or data source

---

## Step-by-Step: Building a New Operation

This example builds a `score.partner-fit` operation that scores contacts for partner channel suitability.

### Step 1: Read a similar existing operation for context

```bash
cat src/core/operations/impl/score-icp-fit.ts
```

Understand: how the filter is parsed, how the guideline is loaded, how the AI prompt is structured, how write-back works, how the result envelope is shaped.

### Step 2: Create the operation file

File: `src/core/operations/impl/score-partner-fit.ts`

```typescript
import { z } from "zod";
import { retrieveRecords } from "../../lib/recall.js";
import { setProperty } from "../../lib/persist.js";
import { aiPrompt } from "../../lib/ai.js";
import { compileFilter, parseFilterInput, type Filter } from "../../lib/filter.js";
import { loadGuideline } from "../../lib/governance.js";
import { logger } from "../../lib/logger.js";
import { evaluateSkipIf } from "../../lib/skip-if.js";
import { workspace } from "../../lib/workspace.js";
import type { OperationEntry } from "../types.js";

const DEFAULT_FILTER: Filter = {
  collection: "contacts",
  where: { lifecycle_stage: { neq: "Disqualified" } },
  limit: 50,
};

const PartnerFitSchema = z.object({
  partner_fit_score: z.number().min(0).max(100),
  partner_fit_reason: z.string().min(10).max(400),
});

interface ContactRecord {
  email?: string;
  first_name?: string;
  last_name?: string;
  job_title?: string;
  company_name?: string;
  partner_fit_score?: number;
  partner_fit_score_updated_at?: string;
  [key: string]: unknown;
}

export const scorePartnerFit: OperationEntry = {
  name: "score.partner-fit",
  mode: "operation",
  description: "Score contacts for partner channel suitability; write partner_fit_score + partner_fit_reason and append to workspace.",
  category: "score",
  status: "live",
  idempotent: true,
  cost: "medium",
  run_mode: "on-trigger",
  guidelines_required: ["partner-qualification"],  // must exist in manifests
  skip_if: { property: "partner_fit_score", updated_within: "14d" },

  run: async (input, context) => {
    const filter = parseFilterInput(input) ?? DEFAULT_FILTER;

    // GOVERN — load partner qualification guideline
    const partnerGuideline = await loadGuideline("partner-qualification");
    if (!partnerGuideline) {
      return {
        ok: false,
        runId: context.runId,
        operation: "score.partner-fit",
        dryRun: context.dryRun,
        status: "live",
        summary: "Cannot score without the partner-qualification guideline. Run setup.apply to install it.",
        metrics: { records_scanned: 0, records_updated: 0, skipped: 0, failed: 0 },
      };
    }

    // RECALL — fetch candidate contacts
    const compiled = compileFilter(filter);
    const candidates = (await retrieveRecords({
      type: "contact",
      conditions: compiled.conditions,
      logic: compiled.logic,
      limit: compiled.limit,
    })) as ContactRecord[];

    logger.info("score.partner-fit: candidates loaded", { count: candidates.length });

    let scored = 0;
    let skipped = 0;
    let failed = 0;
    const sample: Array<{ email: string; score: number; reason: string }> = [];

    // ACT — score each contact
    for (const contact of candidates) {
      if (!contact.email) { skipped++; continue; }

      const decision = evaluateSkipIf(scorePartnerFit.skip_if!, contact as Record<string, unknown>);
      if (decision.skip) { skipped++; continue; }

      const contactContext = JSON.stringify({
        email: contact.email,
        first_name: contact.first_name,
        last_name: contact.last_name,
        job_title: contact.job_title,
        company_name: contact.company_name,
      }, null, 2);

      try {
        if (context.dryRun) {
          logger.info("[DRY RUN] Would score contact for partner fit", { email: contact.email });
          scored++;
          continue;
        }

        const result = await aiPrompt({
          instructions: `Score this contact for partner channel suitability against the partner qualification criteria below. Return:\n- partner_fit_score: integer 0-100\n- partner_fit_reason: one sentence citing the strongest 1-2 factors\n\nContact:\n${contactContext}`,
          context: `# Partner Qualification Criteria\n\n${partnerGuideline}`,
          outputs: PartnerFitSchema,
          temperature: 0.2,
          maxTokens: 300,
        });

        const { partner_fit_score, partner_fit_reason } = result.output;

        // STORE — write back to Personize
        await setProperty({ type: "contact", email: contact.email }, "partner_fit_score", partner_fit_score);
        await setProperty({ type: "contact", email: contact.email }, "partner_fit_reason", partner_fit_reason);

        await workspace.appendUpdate(
          { email: contact.email },
          {
            author: "score.partner-fit",
            type: "score",
            summary: `Partner fit scored ${partner_fit_score} — ${partner_fit_reason.slice(0, 120)}`,
            details: { previous_score: contact.partner_fit_score ?? null, new_score: partner_fit_score, reason: partner_fit_reason },
          },
          "contact",
        );

        if (sample.length < 5) {
          sample.push({ email: contact.email, score: partner_fit_score, reason: partner_fit_reason });
        }
        scored++;
      } catch (error) {
        failed++;
        logger.warn("Failed to score contact for partner fit", {
          email: contact.email,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      ok: failed === 0,
      runId: context.runId,
      operation: "score.partner-fit",
      dryRun: context.dryRun,
      status: "live",
      summary: `Scored ${scored} of ${candidates.length} contacts for partner fit (${skipped} skipped, ${failed} failed).`,
      metrics: { records_scanned: candidates.length, records_updated: scored, skipped, failed, sample },
    };
  },
};
```

### Step 3: Register in the operation registry

File: `src/core/operations/registry.ts`

Add the import at the top (with the other score imports):
```typescript
import { scorePartnerFit } from "./impl/score-partner-fit.js";
```

Add to the `ALL` array (in the `// score` section):
```typescript
// score
scoreIcpFit,
scoreLeadQuality,
scorePartnerFit,   // ← add here
```

### Step 4: Add manifest properties (if new write-back fields)

The new operation writes `partner_fit_score` and `partner_fit_reason`. These must be registered in the contacts collection.

File: `manifests/core/collections/contacts.json`

Add to the `properties` array:
```json
{
  "name": "partner_fit_score",
  "type": "number",
  "description": "AI-computed partner channel suitability score (0–100)",
  "aiWritable": true
},
{
  "name": "partner_fit_reason",
  "type": "string",
  "description": "One-sentence explanation of partner fit score",
  "aiWritable": true
}
```

### Step 5: Add a guideline (if new governance needed)

Create `manifests/core/guidelines/partner-qualification.md`:
```markdown
# Partner Qualification Criteria

A contact is a strong partner fit (score 70–100) if they meet 3+ of:
- Job title includes: Partner, Alliances, Channel, Business Development, VP Sales
- Company size: 50–5,000 employees (too small = no sales org; too large = competitor risk)
- Industry: SaaS, Professional Services, Consulting, Technology
- Geography: North America or Western Europe (current partner program scope)
- No direct competitor relationship (see competitor-policy guideline)

A contact scores 40–69 if they meet 1–2 criteria or if data is incomplete.
A contact scores 0–39 if they are in a disqualified industry or are a direct competitor.
```

### Step 6: Apply the manifest changes

```bash
# Preview what will change in Personize
npm run setup:diff

# Apply the changes
npm run setup:apply
```

### Step 7: Test the new operation

```bash
# Type check
npm run typecheck

# Dry-run with small filter
# Via MCP:
# operation_run("score.partner-fit", { dry_run: true, filter: { collection: "contacts", limit: 5 } })

# Check the list includes the new operation
npm run operation:list
```

Expected: `score.partner-fit` appears in the list with status `live`.

---

## Integration Checklist

- [ ] Operation file created in `src/core/operations/impl/`
- [ ] Exported name follows camelCase convention (`scorePartnerFit`)
- [ ] `name` field follows `namespace.verb-noun` pattern (`score.partner-fit`)
- [ ] `guidelines_required` array lists all guidelines the run function loads
- [ ] `skip_if` set if the operation is idempotent and costly to re-run
- [ ] All write-back properties registered in the collection manifest
- [ ] New guideline created (if needed) and added to manifests
- [ ] Import added to `registry.ts`
- [ ] Export added to `ALL` array in `registry.ts`
- [ ] `setup.diff` run to verify manifest changes
- [ ] `setup.apply` run to register new properties and guidelines
- [ ] `npm run typecheck` passes
- [ ] Dry-run tested with limit: 5
- [ ] `operation_list` shows the new operation

---

## Contributing Back

If the operation is general-purpose (not specific to one customer's business logic), consider opening a PR to the upstream repo at `github.com/personizeai/crm-ai-operators`.

**What to include in the PR:**
1. Operation file: `src/core/operations/impl/namespace-verb-noun.ts`
2. Registry entry: import + `ALL` array addition in `src/core/operations/registry.ts`
3. Manifest changes: new properties in `manifests/core/collections/*.json`
4. Guideline (if new): `manifests/core/guidelines/guideline-name.md`
5. CAPABILITY-MENU.md row: add the operation to the catalog table with correct status/cost/idempotence/run-mode columns

**PR description should include:**
- What the operation does and why it's generally useful
- Which CRMs it works on today
- What guidelines it requires
- A sample dry-run output

The upstream team reviews for governance patterns (RECALL → GOVERN → ACT → STORE), idempotence, and dry-run correctness.
```

- [ ] **Step 2: Verify**

```bash
grep -c "## Build vs Customize\|## Step-by-Step\|## Integration Checklist\|## Contributing Back" skills/solution-architect/references/new-operation-guide.md
```

Expected output: `4`

- [ ] **Step 3: Commit**

```bash
git add skills/solution-architect/references/new-operation-guide.md
git commit -m "feat(skill): add solution-architect new-operation-guide"
```

---

### Task 7: guidelines-optimization.md — Tuning the Governance Layer

**Files:**
- Create: `skills/solution-architect/references/guidelines-optimization.md`

**Interfaces:**
- Consumed by: SKILL.md (optimize phase)
- Produces: guideline × operation dependency map, calibration loop, model-tier mapping, prompt caching instructions

- [ ] **Step 1: Write `skills/solution-architect/references/guidelines-optimization.md`**

```markdown
# Guidelines Optimization

How to tune the governance layer to match a customer's specific business logic, industry, and AI cost/quality tradeoffs.

---

## The 18 Guidelines and What They Control

| Guideline | Controls | Operations that load it |
|-----------|---------|------------------------|
| `agent-playbook` | RECALL→GOVERN→ACT→STORE loop, opt-out rules, task routing | All operations (meta-governance) |
| `icp-definition` | ICP scoring criteria, firmographic weights, signal weights | `score.icp-fit`, `optimize.refine-icp`, `report.win-loss` |
| `lead-scoring-policy` | Lead quality score components and weights | `score.lead-quality` |
| `account-qualification` | Account qualification thresholds and criteria | `research.account-deep-dive`, `score.icp-fit` |
| `contact-qualification` | Contact qualification criteria and persona mapping | `research.contact-background`, `score.lead-quality` |
| `account-research` | What to research and how deep to go per account tier | `research.account-deep-dive` |
| `outreach-playbook` | Sequence structure, channel mix, timing rules, follow-up cadence | `generate.outreach-sequence`, `generate.win-back-sequence` |
| `brand-voice` | Tone, style, language rules, what to avoid | `generate.outreach-sequence`, `generate.meeting-brief`, `generate.proposal`, `generate.mutual-action-plan` |
| `activity-logging` | What to log, how to format workspace.updates | All operations (via workspace.appendUpdate) |
| `data-hygiene` | Duplicate detection rules, normalization standards | `analyze.deduplication`, `sync.normalize-lifecycle` |
| `signal-definitions` | Buying signal taxonomy and strength thresholds | `analyze.buying-stage`, `score.lead-quality`, `act.daily-digest` |
| `competitor-policy` | How to handle competitor mentions, what to never say | `generate.outreach-sequence`, `generate.meeting-brief`, `analyze.reply-sentiment` |
| `multichannel-rules` | Channel eligibility, contact limits per channel, opt-out enforcement | `generate.outreach-sequence`, `act.notify-rep-handoff` |
| `reply-handling` | Reply classification rules, routing logic, escalation thresholds | `analyze.reply-sentiment`, `act.notify-rep-handoff` |
| `meeting-handoff` | What qualifies a contact for AE handoff, what context to pass | `act.notify-rep-handoff`, `generate.meeting-brief` |
| `crm-writeback-policy` | Which fields are AI-writable, writeback frequency limits | All operations that call setProperty |
| `monitors-and-alerts` | Alert thresholds, notification routing, severity levels | `act.notify-rep-handoff`, monitoring operations |
| `tasks-and-projects` | Task type taxonomy, task routing, priority rules | All operations that create tasks |

---

## How to Update a Guideline

1. Edit the markdown file in `manifests/core/guidelines/<guideline-name>.md`
2. Run `setup.apply` to push the updated guideline to Personize:
   ```bash
   npm run setup:apply
   ```
3. Re-run dependent operations in dry-run mode with a small filter to verify behavior changed:
   ```
   operation_run("score.icp-fit", { dry_run: true, filter: { limit: 5 } })
   ```
4. Review `workspace.updates` on a few records to confirm the new logic is reflected in AI outputs

---

## Calibration Loop

The most valuable optimization cycle: win/loss data → ICP refinement → score recalibration.

**Monthly cycle:**

```
Step 1: report.win-loss
  → Generates pattern analysis of won vs churned accounts
  → Surfaces: which industries, company sizes, personas win; which lose

Step 2: optimize.refine-icp
  → Reads win/loss patterns from Step 1
  → Proposes concrete changes to icp-definition.md (specific criteria, weight adjustments)
  → Output: a diff of proposed ICP changes, not yet applied

Step 3: RevOps review
  → RevOps reviews the proposed changes in a PR or direct edit
  → Approves, rejects, or adjusts each proposed change

Step 4: Apply the updated guideline
  → Edit manifests/core/guidelines/icp-definition.md
  → npm run setup:apply

Step 5: Rescore
  → score.icp-fit on full company database (skip_if bypassed by clearing icp_fit_score_updated_at)
  → score.lead-quality on full contact database

Step 6: Measure
  → Compare score distribution before and after
  → Check: did previously-unscored winning companies now score higher?
  → Track: qualified pipeline % in the next 30-day window
```

---

## Creating a Net-New Guideline

When a customer has a policy no existing guideline covers:

1. Create `manifests/core/guidelines/your-policy-name.md` with plain-English rules
2. Add a `loadGuideline("your-policy-name")` call in the relevant operation's `run` function
3. Add `"your-policy-name"` to the operation's `guidelines_required` array
4. Run `setup.apply` to register the guideline in Personize

**Example: "no-contact-during-renewal" guideline**
```markdown
# No-Contact During Renewal

Do not initiate outreach to any account that has:
- An open renewal opportunity (opportunity_stage includes "Renewal")
- A renewal date within the next 30 days

These accounts are owned by Customer Success. Any outreach from Sales must be
coordinated with the CS owner. Flag these accounts in the daily digest with
status: "CS-owned renewal — do not contact."
```

---

## AI Model Tier Mapping

Not all operations need the same model quality. Match model tier to task complexity to optimize cost without sacrificing quality.

### Haiku (claude-haiku-4-5-20251001) — Fast, cheapest

**Use for:** Classification, normalization, simple field extraction, bulk operations where speed matters more than prose quality.

**Operations:**
- `crm.sync-core` — record normalization and field mapping
- `sync.normalize-lifecycle` — lifecycle stage classification
- `analyze.deduplication` — duplicate detection (classification task)
- `analyze.reply-sentiment` — reply classification (positive/negative/neutral/opt-out)
- `score.icp-fit` at large scale (> 5,000 companies) — scoring is structured, not prose

**How to set model in aiPrompt:**
```typescript
const result = await aiPrompt({
  instructions: "...",
  context: "...",
  outputs: Schema,
  model: "claude-haiku-4-5-20251001",  // explicit override
  temperature: 0.1,
  maxTokens: 200,
});
```

---

### Sonnet (claude-sonnet-4-6) — Balanced (default for most operations)

**Use for:** Generation, analysis, scoring with explanation, operations where output quality directly reaches prospects or reps.

**Operations:**
- `generate.outreach-sequence` — sequence emails that prospects read
- `generate.meeting-brief` — briefs that AEs use in real calls
- `analyze.buying-stage` — nuanced inference from conversation data
- `analyze.call-summary` — call summary with action items
- `score.lead-quality` — multi-factor scoring with explanation
- `act.daily-digest` — rep-facing ranked digest

**Sonnet is the default.** Only override to Haiku (cost savings) or Opus (quality ceiling) when there's a specific reason.

---

### Opus (claude-opus-4-8) — Highest reasoning

**Use for:** Strategic operations where output quality directly affects revenue decisions, complex multi-factor analysis, ICP refinement.

**Operations:**
- `optimize.refine-icp` — proposes changes to ICP definition based on win/loss patterns; wrong output here propagates to all scoring
- `report.win-loss` — strategic pattern analysis with nuanced causal reasoning
- `generate.mutual-action-plan` — late-stage deal document that closes business
- `generate.proposal` — high-value proposal where quality determines whether a deal closes

**Cost tradeoff:** Opus costs ~3–5x Sonnet per token. Reserve for operations where the output is high-stakes, low-frequency.

---

## Prompt Caching for Cost Optimization

Operations that load the same guidelines repeatedly — e.g., scoring 10,000 contacts all loading `icp-definition.md` — benefit massively from prompt caching.

**How it works:** The guideline content (which is stable) goes in the `context` field of `aiPrompt()`. When the same context block appears in multiple calls within a short window, the Personize SDK caches the prompt prefix, reducing token cost by ~80–90% on the repeated portion.

**Maximize cache hits by:**
1. Always passing the guideline as `context` (not inside `instructions`) — the SDK caches the `context` field separately
2. Keeping the `instructions` field variable (per-record content) and `context` field stable (guideline content)
3. Running bulk scoring in a tight loop rather than spread across hours — the cache TTL is 5 minutes on Anthropic's API

**Example pattern (cache-friendly):**
```typescript
const guideline = await loadGuideline("icp-definition"); // loaded once outside the loop

for (const company of candidates) {
  const result = await aiPrompt({
    instructions: `Score this company:\n${JSON.stringify(company)}`,  // changes per record
    context: `# ICP Definition\n\n${guideline}`,                      // stable — cache hit
    outputs: ScoreOutputSchema,
    temperature: 0.2,
    maxTokens: 300,
  });
}
```

**Anti-pattern (cache misses):**
```typescript
for (const company of candidates) {
  const guideline = await loadGuideline("icp-definition"); // reloaded every iteration — no cache benefit
  // ...
}
```

---

## Scoring Weight Calibration Without Code Changes

Many scoring behaviors can be tuned entirely through guideline edits:

**To adjust ICP fit weights** — edit `manifests/core/guidelines/icp-definition.md`:
```markdown
## Scoring Weights
- Firmographic fit: 50% (increased from 40% — our best customers match on industry + size)
- Buying signals: 20%
- Engagement level: 20%
- Champion potential: 10%
```

**To adjust lead quality components** — edit `manifests/core/guidelines/lead-scoring-policy.md`:
```markdown
## Component Weights
- Persona match: 35% (our champion is always VP or above)
- ICP company fit: 25%
- Engagement recency: 25%
- Account lift: 15%
```

After editing, run `setup.apply` and then re-run the scoring operation to see the updated distribution.
```

- [ ] **Step 2: Verify**

```bash
grep -c "## The 18 Guidelines\|## How to Update a Guideline\|## Calibration Loop\|## Creating a Net-New Guideline\|## AI Model Tier Mapping\|## Prompt Caching\|## Scoring Weight Calibration" skills/solution-architect/references/guidelines-optimization.md
```

Expected output: `7`

- [ ] **Step 3: Commit**

```bash
git add skills/solution-architect/references/guidelines-optimization.md
git commit -m "feat(skill): add solution-architect guidelines-optimization"
```

---

### Task 8: memorization-strategy.md — Memory Architecture

**Files:**
- Create: `skills/solution-architect/references/memorization-strategy.md`

**Interfaces:**
- Consumed by: SKILL.md (design and optimize phases)

- [ ] **Step 1: Write `skills/solution-architect/references/memorization-strategy.md`**

```markdown
# Memorization Strategy

How to design the right memory architecture for a customer's use case, scale, and compliance requirements.

---

## What Gets Memorized by Default

The `setup.apply` operation provisions 8 collections in Personize:

| Collection | Purpose | Key properties |
|------------|---------|----------------|
| `contacts` | CRM contacts with AI-computed properties | email, lifecycle_stage, lead_quality_score, ai_score, buying_stage, next_best_action, opted_out |
| `companies` | CRM companies with scoring | domain, icp_fit_score, icp_fit_reason, company_size_band, industry, buying_signals |
| `conversations` | Emails, calls, meetings | contact_email, direction, channel, body_summary, sentiment, timestamp |
| `signals` | Buying signal events | company_domain, signal_type, signal_strength, source, detected_at |
| `tasks` | AI-created work items for reps | task_type, assigned_to, status, priority, due_date, linked_entity |
| `projects` | Multi-step initiatives | name, status, owner, milestones |
| `alerts` | Monitoring alerts | severity, category, message, created_at, resolved |
| `operation-runs` | Audit trail of every operation | operation_name, run_id, started_at, status, metrics |

---

## Property Selection by Use Case

Don't memorize every CRM field — memorize what operations read. This keeps sync fast and storage lean.

### For AI Scoring (score.icp-fit, score.lead-quality)
**Companies must have:** `domain`, `industry`, `employee_count`, `company_size_band`, `business_model`, `lifecycle_stage`, `buying_signals`, `signal_strength`
**Contacts must have:** `email`, `first_name`, `last_name`, `job_title`, `seniority_level`, `lifecycle_stage`, `engagement_score`

### For Outreach Generation (generate.outreach-sequence, generate.meeting-brief)
**Contacts additionally need:** `pain_points`, `recent_activity_summary`, `last_contacted_at`, `sequence_status`
**Companies additionally need:** `tech_stack`, `recent_news`, `champion_name`

### For Pipeline Intelligence (analyze.buying-stage, report.pipeline-health)
**Conversations must have:** `contact_email`, `company_domain`, `channel`, `direction`, `body_summary`, `sentiment`, `timestamp`
**Signals must have:** `signal_type`, `signal_strength`, `detected_at`

### For Call Intelligence (analyze.call-summary)
**Conversations additionally need:** `call_recording_url` or `call_transcript`, `duration_minutes`, `participants`

### For Data Quality (analyze.deduplication, sync.normalize-lifecycle)
**Contacts must have:** `email`, `phone`, `first_name`, `last_name`, `company_name`, `lifecycle_stage`
**Companies must have:** `domain`, `company_name`, `lifecycle_stage`, `employee_count`

**Rule:** Only sync properties that at least one operation reads. Unused properties bloat sync time and Personize storage with no benefit.

---

## Memory Freshness

Operations use `skip_if` to avoid re-processing recently-updated records. Tune these windows to match the customer's data change cadence.

| Operation | Default skip_if window | Tune down when | Tune up when |
|-----------|----------------------|----------------|--------------|
| `score.icp-fit` | 7 days | Company data changes weekly (fast-moving market) | CRM data changes slowly (enterprise, stable accounts) → 30d |
| `score.lead-quality` | 7 days | High engagement velocity (SDR team active daily) | Low-touch, long-cycle sales → 14d |
| `research.account-deep-dive` | 30 days | Target accounts in active deal stages | Research is expensive; stable accounts → 60d |
| `research.contact-background` | 30 days | Contacts change jobs frequently (startup market) | Enterprise contacts are stable → 60d |
| `analyze.buying-stage` | 3 days | High conversation volume, signals change fast | Low-touch, infrequent contact → 7d |

**How to bypass skip_if for a forced rescore:**
Pass `skip_if: { updated_within: "0d" }` in the operation input to force all records to be processed regardless of last update time.

---

## Bulk Sync Strategy

For large CRMs (10,000+ contacts), use these patterns with `crm.sync-core`:

**Staged sync (recommended for > 50k contacts):**
1. Run `crm.sync-core` with filter `{ lifecycle_stage: "MQL" }` first — highest-value contacts
2. Then `{ lifecycle_stage: "SQL" }` — in-pipeline contacts
3. Then remaining stages in priority order
4. Each stage syncs independently; if one fails, others are unaffected

**Filter by recent activity:**
```json
{ "collection": "contacts", "where": { "last_activity_date": { "gte": "90d" } }, "limit": 5000 }
```
Start with active contacts; don't spend time memorizing contacts who haven't engaged in years.

**Batch size recommendation:**
- `limit: 100` for initial testing (verify field mapping)
- `limit: 1000` for daily incremental sync
- `limit: 5000` for initial full-database load (run multiple times with offset pagination)

---

## What NOT to Memorize

**Skip these — they bloat storage and slow sync without benefiting any operation:**
- Raw email bodies (memorize `body_summary` instead — operations use the summary, not the raw text)
- Call recordings or audio files (memorize `call_transcript` or `call_summary`)
- Binary attachments (contracts, PDFs — these belong in your document system)
- Internal notes not relevant to AI scoring or outreach (e.g., billing notes, support tickets unless connected to signal detection)
- Contacts with `opted_out: true` who will never be contacted — they must exist in memory for the opt-out check, but don't need rich properties
- CRM system fields (HubSpot internal IDs, audit timestamps, field history) — these are CRM metadata, not AI-relevant context

---

## Data Privacy and Retention

### GDPR / CCPA — Right to Deletion

When a contact requests deletion of their data:

1. **In CRM:** Follow your standard CRM deletion/anonymization process
2. **In Personize:** Delete the record using the Personize SDK:
   ```typescript
   await client.memory.delete({ type: "contact", email: contact.email });
   ```
   This removes all properties and workspace.updates for that contact.
3. **In audit log:** The audit entries in `data/audit/*.jsonl` reference the contact by email. Scrub or anonymize these entries from the log files.
4. **In tasks:** Cancel any open tasks linked to that contact.

The system does not automatically cascade deletions — each step must be performed explicitly.

### Opt-Out Enforcement

Contacts with `opted_out: true` are blocked at the governance layer by the `agent-playbook` guideline: no outreach operations will act on them. This is enforced by the `multichannel-rules` guideline in all generate and act operations.

**Never bypass opt-outs.** Even if a contact appears in a filter result, the operation's governance check will skip them. If you see an opted-out contact being processed, it means the governance guideline failed to load — check `loadGuideline("multichannel-rules")` returns a non-null value.

### Data Residency

Personize stores data in the region configured at account setup. Before syncing PII (contact names, emails, phone numbers):
1. Confirm with the customer which region their Personize account uses (EU, US, etc.)
2. Confirm this matches their data residency requirements
3. Document the confirmation in `docs/PRIVACY.md` or a customer-specific compliance doc

### Retention Windows

Recommended practice: align `skip_if` windows with the customer's data retention policy.

Example — if the customer retains contact engagement data for 180 days:
- `analyze.buying-stage` skip_if: `7d` (re-infer frequently from recent data)
- `research.contact-background` skip_if: `180d` (don't re-research beyond retention window)
- `analyze.call-summary` skip_if: `30d` (re-summarize if new calls, but cap at retention window)

Full privacy policy reference: `docs/PRIVACY.md` in this repo.
```

- [ ] **Step 2: Verify**

```bash
grep -c "## What Gets Memorized\|## Property Selection\|## Memory Freshness\|## Bulk Sync Strategy\|## What NOT to Memorize\|## Data Privacy" skills/solution-architect/references/memorization-strategy.md
```

Expected output: `6`

- [ ] **Step 3: Commit**

```bash
git add skills/solution-architect/references/memorization-strategy.md
git commit -m "feat(skill): add solution-architect memorization-strategy"
```

---

### Task 9: subagent-patterns.md — Multi-Agent Pipeline Designs

**Files:**
- Create: `skills/solution-architect/references/subagent-patterns.md`

**Interfaces:**
- Consumed by: SKILL.md (design and implement phases)
- Produces: 5 named pipeline patterns, when-to-use guidance, error handling, token budget management

- [ ] **Step 1: Write `skills/solution-architect/references/subagent-patterns.md`**

```markdown
# Subagent Patterns

Five named multi-agent pipeline designs for crm-ai-operators. Use these in the design phase to prescribe the right orchestration pattern for a customer's use case.

---

## When to Use Subagents vs Single Agent

| Signal | Single agent | Subagents |
|--------|-------------|-----------|
| Number of operations | 1–4 | 5+ |
| Records per operation | < 500 | > 500 |
| Session type | Interactive (user present) | Scheduled / unattended |
| Pipeline branches | Sequential, no parallelism | Independent branches that can run in parallel |
| Token budget | One session's worth | Distributed across agents |

**Single agent** is fine for: "score these 50 contacts", "run the daily digest", "research this account". Interactive, bounded, one or two operations.

**Subagents** are right for: "run the full prospecting pipeline on our entire database", "run the weekly optimization loop", "run scoring and outreach generation in parallel across 10,000 contacts".

---

## Pattern 1: Parallel Scoring Pipeline

**Use case:** Score all contacts and companies simultaneously to maximize throughput.

**Why parallel:** `score.icp-fit` (companies) and `score.lead-quality` (contacts) are independent — neither reads the other's output. Running them in parallel cuts wall-clock time in half.

**Setup:**
```
Orchestrator agent
├── Subagent A: score.icp-fit (all companies, batch of 500)
└── Subagent B: score.lead-quality (all contacts, batch of 500)
    (both run in parallel)
```

**Orchestrator prompt:**
```
Run ICP fit scoring and lead quality scoring in parallel.

Subagent A: operation_run("score.icp-fit", { filter: { collection: "companies", limit: 500 } })
Subagent B: operation_run("score.lead-quality", { filter: { collection: "contacts", limit: 500 } })

Wait for both to complete. Report total scored, skipped, failed from each.
If either fails, report the error and the partial results — do not abort the other agent.
```

**When to use:** Daily score refresh, initial database scoring, weekly rescore after ICP update.

**Token budget:** ~$3 per 1,000 companies (scoring) + ~$4 per 1,000 contacts (lead quality). Budget $7–10 per 1,000 records at standard Sonnet pricing.

---

## Pattern 2: Research → Score → Generate Pipeline

**Use case:** Full account-based pre-call prep — research the account, score the contacts, generate the meeting brief.

**Why sequential:** Each step depends on the previous. Research fills memory; scoring uses the filled memory; generation uses the score and research.

**Setup:**
```
Step 1: research.account-deep-dive (fill company + signals + stakeholders)
    ↓ (wait for completion)
Step 2: score.icp-fit (rescore company with fresh research data)
         score.lead-quality (rescore key contacts)
    ↓ (wait for both)
Step 3: generate.meeting-brief (uses score + research for AE brief)
```

**Orchestrator prompt:**
```
Prepare a full account brief for domain: {company_domain}

Step 1: operation_run("research.account-deep-dive", { filter: { collection: "companies", where: { domain: "{company_domain}" } } })

Step 2 (after Step 1 completes): Run in parallel:
- operation_run("score.icp-fit", { filter: { collection: "companies", where: { domain: "{company_domain}" }, skip_if: { updated_within: "0d" } } })
- operation_run("score.lead-quality", { filter: { collection: "contacts", where: { company_domain: "{company_domain}" } } })

Step 3 (after Step 2 completes): operation_run("generate.meeting-brief", { filter: { collection: "contacts", where: { company_domain: "{company_domain}" } } })

Return the meeting brief from Step 3.
```

**When to use:** Pre-call prep for high-priority accounts (icp_fit_score > 80), triggered by a rep before a discovery call.

**Token budget:** Research is the expensive step (~$5–15 per account at Sonnet/Opus). Scoring is ~$0.01 per company. Brief generation is ~$0.50 per contact. Total: $6–20 per account.

---

## Pattern 3: Daily Digest Orchestrator

**Use case:** Every morning, update buying stages, rescore changed contacts, and deliver a ranked digest to each rep.

**Setup:**
```
Step 1: analyze.buying-stage (all active contacts with recent activity — run first to get fresh stages)
    ↓
Step 2: score.lead-quality (contacts whose buying_stage changed — rescore with fresh stage data)
    ↓
Step 3: act.daily-digest (per rep — uses updated scores and stages for ranking)
```

**Orchestrator prompt (scheduled, runs at 7am):**
```
Run the daily digest pipeline.

Step 1: operation_run("analyze.buying-stage", { filter: { collection: "contacts", where: { lifecycle_stage: { in: ["MQL", "SQL", "Opportunity"] }, last_activity_date: { gte: "3d" } }, limit: 1000 } })

Step 2 (after Step 1): operation_run("score.lead-quality", { filter: { collection: "contacts", where: { buying_stage_updated_at: { gte: "1d" } }, limit: 500 } })

Step 3 (after Step 2): operation_run("act.daily-digest", { filter: { collection: "contacts", where: { lifecycle_stage: { in: ["MQL", "SQL"] } } } })

Log each step's metrics. If Step 1 fails, skip Steps 2 and 3 and report the error.
```

**When to use:** Scheduled daily run (6–7am in rep's timezone). Set up as a Claude Code hook or cron task.

**Token budget:** ~$5–15 per run depending on active contact count and rep count.

---

## Pattern 4: Full Prospecting Pipeline

**Use case:** Activate a new market segment or reactivate a dormant list. Research, score, and generate outreach for a full batch of accounts.

**Setup:**
```
Step 1: crm.sync-core (sync new segment contacts and companies into Personize)
    ↓
Step 2 (parallel): research.account-deep-dive (top 20 accounts by employee count)
                   score.icp-fit (all companies in segment)
    ↓ (wait for both)
Step 3: score.lead-quality (all contacts in segment — uses fresh ICP scores from Step 2)
    ↓
Step 4: generate.outreach-sequence (contacts where lead_quality_score >= 60 and icp_fit_score >= 70)
```

**Orchestrator prompt:**
```
Run the full prospecting pipeline for filter: {segment_filter}

Step 1: operation_run("crm.sync-core", { filter: {segment_filter} })

Step 2 (parallel, after Step 1):
- operation_run("research.account-deep-dive", { filter: { collection: "companies", where: {segment_where}, limit: 20 } })
- operation_run("score.icp-fit", { filter: { collection: "companies", where: {segment_where} } })

Step 3 (after Step 2): operation_run("score.lead-quality", { filter: { collection: "contacts", where: {segment_where} } })

Step 4 (after Step 3): operation_run("generate.outreach-sequence", { filter: { collection: "contacts", where: { ...{segment_where}, lead_quality_score: { gte: 60 }, icp_fit_score: { gte: 70 } } } })

Report sequences generated count. Log any contacts that scored below threshold.
```

**When to use:** New market entry, event follow-up, list activation, account-based campaigns.

**Token budget:** $20–100+ depending on segment size. Research is the expensive step. Cap Step 2 research at top 20 accounts; score the rest without research.

---

## Pattern 5: Optimization Loop

**Use case:** Monthly ICP calibration — analyze win/loss patterns, propose ICP changes, apply them, rescore the database.

**Setup:**
```
Step 1: report.win-loss (analyze won vs churned accounts — needs 30+ days of data)
    ↓
Step 2: optimize.refine-icp (propose ICP definition changes from win/loss patterns)
    ↓
Step 3: [Human review gate] RevOps reviews and approves ICP changes
    ↓
Step 4: setup.apply (push updated icp-definition.md to Personize)
    ↓
Step 5: score.icp-fit (rescore all companies with skip_if bypassed)
```

**Orchestrator prompt (first 2 steps — human gate before Step 4):**
```
Run the monthly ICP optimization pipeline.

Step 1: operation_run("report.win-loss", { filter: { collection: "companies", where: { lifecycle_stage: { in: ["Customer", "Churned"] } } } })

Step 2 (after Step 1): operation_run("optimize.refine-icp", {})

Output the proposed ICP changes from Step 2 for RevOps review.
Do not proceed to setup.apply until RevOps explicitly approves the changes.
```

**After RevOps approves:**
```
The ICP changes have been applied to manifests/core/guidelines/icp-definition.md.

Step 4: npm run setup:apply (to push the updated guideline to Personize)

Step 5: operation_run("score.icp-fit", { filter: { collection: "companies" }, skip_if: { updated_within: "0d" } })

Report the score distribution before and after (compare audit log from this run vs previous month's run).
```

**When to use:** Monthly, after at least 30 days of operation run history and at least 10 won + 5 churned accounts to analyze.

---

## Error Handling and Recovery

### When a pipeline step fails mid-run

1. **Check the audit log** — every run is logged to `data/audit/{date}.jsonl`. Find the failed run by `operation` name and `status: "failed"`.
2. **Identify which records were processed** — the audit log's `metrics.records_updated` shows how many completed before failure.
3. **Re-run from the failed step** with the same filter. Operations are idempotent — records already processed have `skip_if` protection and will be skipped automatically.
4. **Never cascade writes from partial results** — if Step 2 (scoring) failed halfway, don't run Step 3 (generation) on partially-scored contacts. Wait for Step 2 to complete cleanly.

### When a subagent times out

Large operations (research on 100 accounts, scoring 10,000 contacts) can exceed a single agent session's time limit.

**Pattern:** Use `limit` to batch. Instead of one run of 10,000, run 10 batches of 1,000 with offset pagination:
```
operation_run("score.icp-fit", { filter: { collection: "companies", limit: 1000, offset: 0 } })
operation_run("score.icp-fit", { filter: { collection: "companies", limit: 1000, offset: 1000 } })
// etc.
```
Each batch is independent and idempotent. Resume from where the timeout occurred.

### When governance fails (guideline not found)

If `loadGuideline()` returns null, the operation returns a scaffold-style envelope (no writes). Check:
1. Has `setup.apply` been run? (`npm run setup:diff` shows what's missing)
2. Is the guideline name spelled correctly in `guidelines_required`?
3. Does the guideline markdown file exist in `manifests/core/guidelines/`?

Re-run `setup.apply` to push missing guidelines, then retry the operation.

---

## Token Budget Management

### Estimate before running large pipelines

| Operation | Approx tokens per record | Approx cost per 1,000 records (Sonnet) |
|-----------|-------------------------|----------------------------------------|
| `crm.sync-core` (sync) | ~100 | ~$0.15 |
| `score.icp-fit` | ~500 | ~$0.75 |
| `score.lead-quality` | ~800 | ~$1.20 |
| `analyze.buying-stage` | ~1,500 | ~$2.25 |
| `analyze.call-summary` | ~3,000 | ~$4.50 |
| `generate.outreach-sequence` | ~4,000 | ~$6.00 |
| `research.account-deep-dive` | ~8,000 | ~$12.00 |
| `generate.mutual-action-plan` | ~10,000 | ~$15.00 |

**Test with small batches first.** Run `limit: 5` before committing to a full-database run. Verify output quality and cost per record, then scale up.

### Use Haiku for bulk classification

For operations that run on > 1,000 records and are primarily classification tasks (scoring, sentiment, lifecycle normalization), switch to Haiku to reduce cost by ~75%:
```typescript
model: "claude-haiku-4-5-20251001"
```

Reserve Sonnet/Opus for generation, strategic analysis, and operations where output quality reaches customers or affects significant revenue decisions.
```

- [ ] **Step 2: Verify**

```bash
grep -c "## When to Use Subagents\|## Pattern 1\|## Pattern 2\|## Pattern 3\|## Pattern 4\|## Pattern 5\|## Error Handling\|## Token Budget" skills/solution-architect/references/subagent-patterns.md
```

Expected output: `8`

- [ ] **Step 3: Commit**

```bash
git add skills/solution-architect/references/subagent-patterns.md
git commit -m "feat(skill): add solution-architect subagent-patterns"
```

---

### Task 10: Final Verification and Push

**Files:** No new files. Verify all 9 files exist and are correct, then push the branch.

- [ ] **Step 1: Verify all files exist**

```bash
find skills/solution-architect -type f | sort
```

Expected output (9 files):
```
skills/solution-architect/SKILL.md
skills/solution-architect/references/customization-guide.md
skills/solution-architect/references/guidelines-optimization.md
skills/solution-architect/references/memorization-strategy.md
skills/solution-architect/references/new-operation-guide.md
skills/solution-architect/references/operation-clusters.md
skills/solution-architect/references/roi-playbook.md
skills/solution-architect/references/scenarios.md
skills/solution-architect/references/subagent-patterns.md
```

- [ ] **Step 2: Verify SKILL.md frontmatter is valid**

```bash
head -5 skills/solution-architect/SKILL.md
```

Expected:
```
---
name: solution-architect
description: Use when a leader, RevOps manager, or engineer wants to...
---
```

- [ ] **Step 3: Verify all 8 references are pointed to in SKILL.md**

```bash
grep -c "references/" skills/solution-architect/SKILL.md
```

Expected output: `8` (one reference path per file in the phase arc table)

- [ ] **Step 4: Verify no Salesforce operations are claimed as live in any file**

```bash
grep -ri "salesforce.*live\|salesforce.*available" skills/solution-architect/ | grep -v "HubSpot.*live\|setup.*live\|sync.*live"
```

Expected: no output (or only lines that correctly flag non-generate/analyze ops as live on Salesforce)

- [ ] **Step 5: Verify ROI figures are correct throughout**

```bash
grep -r "0\.003\|0\.001\|23x" skills/solution-architect/
```

Expected: matches in `roi-playbook.md` and `SKILL.md`. If any other number appears (e.g., `0.03` or `20x`), fix it.

- [ ] **Step 6: Push to remote**

```bash
git push origin Hamed-July-2026
```

---

## Self-Review Against Spec

Spec section → task that implements it:

| Spec requirement | Implemented in |
|-----------------|---------------|
| SKILL.md with triggers | Task 1 |
| Vision narrative (inline, ~200 words) | Task 1 |
| Qualify phase with CRM platform gate | Task 1 |
| Diagnosis flow Q0–Q3 | Task 1 |
| Six-phase arc with reference routing | Task 1 |
| Seven hard rules | Task 1 |
| 3D scenario matrix (archetype × maturity × use-case) | Task 2 |
| First-win index (op in < 20 min per scenario) | Task 2 |
| 30/60/90-day paths per use case | Task 2 |
| Stakeholder-specific pitches (CRO, CTO, RevOps VP, CFO) | Task 3 |
| Verified ROI framework with unit economics | Task 3 |
| Competitive positioning (Einstein, Breeze, custom, doing nothing) | Task 3 |
| Demo script (20 min, zero risk) | Task 3 |
| Objection handling (6 objections) | Task 3 |
| Five named stacks with prerequisites | Task 4 |
| HubSpot vs Salesforce availability per stack | Task 4 |
| Dependency graph per stack | Task 4 |
| Operation anatomy (6 parts) | Task 5 |
| What's safe to customize (5 dimensions) | Task 5 |
| What requires more care | Task 5 |
| Guideline update workflow | Task 5 |
| Testing protocol | Task 5 |
| Upgrade safety pattern | Task 5 |
| Build vs customize decision | Task 6 |
| Step-by-step scaffold with exact TypeScript | Task 6 |
| Integration checklist | Task 6 |
| Contribution-back guidance | Task 6 |
| 18 guidelines × operation dependency map | Task 7 |
| Calibration loop (win/loss → ICP → rescore) | Task 7 |
| AI model tier mapping (Haiku/Sonnet/Opus per operation) | Task 7 |
| Prompt caching strategy | Task 7 |
| Scoring weight calibration via guidelines | Task 7 |
| Collections and property coverage | Task 8 |
| Property selection by use case | Task 8 |
| Memory freshness tuning | Task 8 |
| Bulk sync strategy for large CRMs | Task 8 |
| What NOT to memorize | Task 8 |
| GDPR/CCPA deletion flow | Task 8 |
| Opt-out enforcement documentation | Task 8 |
| Data residency guidance | Task 8 |
| Five named subagent patterns | Task 9 |
| Single agent vs subagents decision guide | Task 9 |
| Error handling and recovery | Task 9 |
| Token budget estimation table | Task 9 |
| Haiku vs Sonnet vs Opus for pipelines | Task 9 |
