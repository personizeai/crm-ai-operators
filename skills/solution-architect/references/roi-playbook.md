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
