# Solution Architect Skill — Design Spec
**Date:** 2026-06-30
**Status:** Approved

---

## Purpose

A hub-and-spoke skill that turns Claude Code (running inside the customer's cloned crm-ai-operators repo) into a trusted advisor across the full customer journey: presales vision → situation diagnosis → solution design → implementation guidance → ongoing optimization.

This skill is the "salesperson + architect + coach" — it sells leaders on the vision, prescribes the right operation stack for each customer's specific situation, guides customization and new operation creation, and teaches multi-agent design patterns.

---

## File Structure

```
skills/solution-architect/
├── SKILL.md                        ← hub: triggers, vision, diagnosis, phase arc, hard rules
└── references/
    ├── scenarios.md                ← 3D matrix: archetype × maturity × use-case → prescribed path
    ├── roi-playbook.md             ← presales: stakeholder pitches, ROI calc, competitive positioning
    ├── operation-clusters.md       ← 5 named stacks, prerequisites, HubSpot vs Salesforce availability
    ├── customization-guide.md      ← modify existing operations safely, upgrade safety
    ├── new-operation-guide.md      ← build net-new operations, contribution-back
    ├── guidelines-optimization.md  ← tune governance per customer, model-tier mapping, prompt caching
    ├── memorization-strategy.md    ← memory architecture, privacy/retention, GDPR/CCPA
    └── subagent-patterns.md        ← 5 pipeline patterns, error recovery, token budget
```

---

## SKILL.md — Hub Design

### Triggers
The skill loads when the agent detects any of:
- A leader or evaluator asking "why should we use this?", "what does this do?", "is this worth it?"
- A RevOps, sales-ops, or engineering person asking "where do we start?", "what should we run first?"
- Anyone asking about customizing an existing operation
- Anyone asking about building a new operation from scratch
- Anyone asking how to design multi-agent or subagent pipelines with these operations
- Anyone asking about guidelines, memory architecture, or AI instruction tuning
- The repo is being evaluated for adoption (setup not yet run)

### Phase Arc
Six phases the conversation moves through. The agent identifies the current phase and loads references accordingly:

| Phase | What happens | References loaded |
|-------|-------------|-------------------|
| **qualify** | Confirm prerequisites: Personize account? Which CRM? Plan tier? | none (inline questions) |
| **pitch** | Vision narrative, economic case, vs-alternatives | `roi-playbook.md` |
| **diagnose** | 3-question triage → scenario identification | `scenarios.md` |
| **design** | Prescribe operation stack, memory architecture, subagent patterns | `operation-clusters.md`, `memorization-strategy.md`, `subagent-patterns.md` |
| **implement** | Guide customization or new operation creation | `customization-guide.md` or `new-operation-guide.md` |
| **optimize** | Tune guidelines, model tiers, scoring weights | `guidelines-optimization.md` |

Phases are not strictly sequential — a conversation can jump. The agent reads context and enters the right phase.

### Vision Narrative (inline in SKILL.md, ~200 words)
Embedded directly so it's always in context without a reference load. Covers:
- What the repo is: 26 governed CRM operations (24 live) for HubSpot/Salesforce, built on Personize memory + governance
- The architecture: Memory (Personize stores everything) → Governance (org guidelines gate every write) → Operations (atomic AI work units)
- The economic case: one AI agent running 5 operations replaces 2–3 RevOps FTE per day; ~23x more work per dollar vs frontier LLM APIs alone
- The "vs alternatives" thread: Salesforce Einstein and HubSpot Breeze are locked inside their own ecosystems; custom builds require months of infra; this repo is open-source, CRM-agnostic, governed, auditable, and extensible in days not months

### Diagnosis Flow (inline in SKILL.md)
Three structured questions, asked in order. Answers map to a scenario in `scenarios.md`.

**Q0 — CRM Platform** (informs object-model specifics, not availability)
- HubSpot (all 26 operations available today)
- Salesforce (all 26 operations available today — at parity with HubSpot)
- Both / evaluating

**Q1 — Company Archetype**
- Startup: 1–5 AEs, founder-led sales, no dedicated RevOps
- Growth: 6–25 AEs, first RevOps hire, CRM exists but messy
- Enterprise: 25+ AEs, dedicated RevOps team, CRM mature

**Q2 — CRM Maturity**
- Messy: incomplete data, no hygiene standards, fields unused
- Structured: clean data, consistent lifecycle stages, no AI layer yet
- Advanced: clean data + some AI/automation, want to go deeper or replace patchwork

**Q3 — Primary Pain / Use Case**
- Pipeline visibility (what's actually in my pipeline, what's at risk)
- Outreach automation (sequences, briefs, proposals at scale)
- AI scoring (which leads/accounts to prioritize)
- Data quality (dedup, lifecycle normalization, hygiene)
- Call intelligence (call summaries, buying stage inference)
- Win/loss analysis (why we win, why we lose, ICP refinement)

### Hard Rules (inline in SKILL.md)
1. Always confirm CRM platform before any recommendation — for object-model specifics (Lead/Contact/Account), not availability; HubSpot and Salesforce are at parity and Salesforce must never be flagged "coming soon"
2. Always read `AGENTS.md` before touching any operation
3. Never recommend live writes without dry-run first (`DRY_RUN=true` is the default)
4. Never hallucinate operation names — always verify against `operation_list` (via MCP) before recommending specific operations
5. Anchor all ROI claims to the verified calc: $0.003/memorize, $0.001/recall, ~23x more work per dollar. Never invent numbers.
6. Never promise a specific ROI number to a specific customer — present the framework, let them calculate their own
7. Never modify `manifests/` files without confirming the customer has run `setup.diff` first to see what would change

---

## references/ — File Designs

### scenarios.md
**Purpose:** The 3D lookup table. Given archetype + maturity + use-case, returns a prescribed path.

**Structure:**
- Archetype × maturity matrix introduction (9 cells)
- For each cell: current state characterization, biggest risk, recommended entry point, first operation to run in < 20 minutes
- Use-case overlay: for each of 6 use cases, which archetype/maturity combinations benefit most and what the 30/60/90-day path looks like
- "First win" index: a lookup table mapping any scenario to one specific operation the agent can recommend immediately as a quick confidence-builder

---

### roi-playbook.md
**Purpose:** Everything the agent needs to pitch to a specific stakeholder and handle objections.

**Structure:**
- Stakeholder-specific pitches (CRO, CTO, RevOps VP, CFO) — what each cares about, what to lead with, what to avoid
- Verified ROI framework: $0.003/memorize, $0.001/recall, ~23x more work per dollar; FTE offset model (5 operations = 2–3 RevOps FTE/day); how to help the customer run their own calc
- Competitive positioning:
  - vs Salesforce Einstein: Einstein is locked to Salesforce, proprietary, no governance layer, no cross-CRM, no open-source extensibility
  - vs HubSpot Breeze AI: Breeze is native but shallow, no memory persistence, no governance, no custom operations
  - vs custom build: 6–12 months of eng time, no community, no maintained operations library, no Personize memory substrate
  - vs doing nothing: RevOps backlog grows, AI competitors outpace, signals get missed
- Demo script: what to show and in what order for a 20-minute evaluation
- Objection handling: "we already have Breeze", "we don't trust AI in our CRM", "we don't have budget", "it's too complex", "we need to talk to IT/security"

---

### operation-clusters.md
**Purpose:** Group the 26 operations into named stacks with rollout order, dependencies, and expected outputs.

**Five stacks:**

| Stack | Operations | Time to first value | HubSpot | Salesforce |
|-------|-----------|---------------------|---------|------------|
| **Quick Win** | setup.apply, crm.sync-core, score.icp-fit, act.daily-digest | < 1 hour | ✓ | Partial |
| **Pipeline Intelligence** | + score.lead-quality, analyze.buying-stage, report.pipeline-health | Day 1–2 | ✓ | Partial |
| **Outreach Automation** | + generate.outreach-sequence, generate.meeting-brief, analyze.reply-sentiment | Day 2–5 | ✓ | Scaffold |
| **Data Quality** | + analyze.deduplication, sync.normalize-lifecycle, sync.push-properties | Day 1–3 | ✓ | Partial |
| **Full RevOps** | All 26 operations, full subagent pipelines | Week 1–3 | ✓ | Future |

**Per stack:** prerequisite checklist (what must be true before this stack is safe to run), dependency graph (which operations must run before others), expected outputs (what the customer sees in their CRM/Personize after), HubSpot vs Salesforce availability clearly flagged.

---

### customization-guide.md
**Purpose:** Teach the agent how to guide a customer who wants to modify an existing operation.

**Structure:**
- Anatomy of an operation file (the 6 parts: filter, governance load, recall, AI prompt, write-back, audit)
- What's safe to customize: prompt language, filter defaults, skip_if windows, write-back field names, which guidelines are loaded
- What requires more care: adding new write-back fields (requires manifest update), changing scoring scale (requires downstream re-score), removing governance load (requires explicit justification)
- How to update manifests/collections after adding a new property
- How to update guidelines to change AI behavior without touching code
- Testing protocol: always run with DRY_RUN=true first, inspect workspace.updates, then compare with a small live batch
- Naming conventions: keep namespace.verb-noun pattern (e.g., `score.custom-fit`)
- **Upgrade safety:** if the customer has customized an operation, how to stay in sync with upstream repo updates — recommended pattern is to keep customizations in a separate `src/core/operations/impl/custom/` folder and maintain a diff log

---

### new-operation-guide.md
**Purpose:** Step-by-step guide for building a net-new operation from scratch.

**Structure:**
- When to build vs customize: build new when the work unit doesn't map to any existing operation; customize when the logic is right but parameters need tuning
- Step-by-step scaffold:
  1. Create `src/core/operations/impl/<namespace>-<verb>-<noun>.ts`
  2. Implement the RECALL → GOVERN → ACT → STORE pattern using lib utilities
  3. Register in `src/core/operations/registry.ts`
  4. Add to `manifests/core/collections/` if new properties are needed
  5. Add a guideline to `manifests/core/guidelines/` if new governance is needed
  6. Run `setup.diff` to preview manifest changes, then `setup.apply`
  7. Test with `DRY_RUN=true`
- Operation anatomy deep-dive: required fields in OperationEntry, optional fields, how the runner wraps audit/governance
- RECALL → GOVERN → ACT → STORE template with inline comments
- Integration checklist: workspace.updates mandatory, audit log automatic via runner, skip_if pattern for idempotence
- Testing checklist: dry-run passes, workspace.updates correct, audit log entry created, properties written correctly
- **Contribution back:** if the operation is general-purpose and not customer-specific, open a PR to `personizeai/crm-ai-operators`. Include: operation file, registry entry, manifest changes, a CAPABILITY-MENU.md row update, and a brief description in the PR

---

### guidelines-optimization.md
**Purpose:** Teach the agent how to tune the governance layer to match the customer's specific business.

**Structure:**
- What each guideline controls and which operations load it (the dependency map: 18 guidelines × their operation consumers)
- How to update a guideline: edit the markdown in `manifests/core/guidelines/`, run `setup.apply`, re-run dependent operations with `DRY_RUN=true` to verify behavior changed
- Calibration loop: `report.win-loss` → `optimize.refine-icp` → update `icp-definition.md` → re-run `score.icp-fit` on full database → validate distribution shift
- Creating net-new guidelines: when a customer has a policy that no existing guideline covers (e.g., "never contact accounts in legal review"), add a new markdown file and load it in relevant operations via `loadGuideline()`
- **AI instruction tuning per model tier:**
  - Haiku (fast, cheap): bulk operations — `crm.sync-core`, `score.icp-fit` on large batches, `sync.normalize-lifecycle`. Use for: classification, field normalization, simple scoring
  - Sonnet (balanced): most generation and analysis — `generate.outreach-sequence`, `analyze.buying-stage`, `analyze.call-summary`, `act.daily-digest`. Default for most operations.
  - Opus (highest reasoning): strategic operations — `optimize.refine-icp`, `report.win-loss`, `generate.mutual-action-plan`. Use when output quality directly affects revenue decisions.
- **Prompt caching:** for operations that load the same guidelines repeatedly (e.g., scoring 10,000 contacts all loading `icp-definition.md`), enable prompt caching on the guideline content to reduce cost ~90% on repeated loads. How to structure prompts for cache hit maximization.
- Scoring weight calibration: how to adjust ICP fit weights, lead quality component weights, signal weights without code changes

---

### memorization-strategy.md
**Purpose:** Help the agent design the right memory architecture for the customer's use case and scale.

**Structure:**
- What gets memorized by default: contacts (22 properties), companies (18 properties), conversations, signals, operation-runs, tasks, projects, alerts
- Property selection by use case: which properties matter for scoring vs outreach vs pipeline vs call intelligence — don't memorize everything, memorize what operations read
- Memory freshness: skip_if patterns (score.icp-fit skips if updated < 7d; research.account-deep-dive skips if < 30d) — how to tune these windows per customer cadence
- Bulk sync strategy: `crm.sync-core` with pagination — recommended batch sizes, parallelism, rate limit handling; for large CRMs (50k+ contacts) use the staged sync pattern
- What NOT to memorize: raw email bodies, call recordings, binary attachments, PII that doesn't serve a scoring or generation purpose
- **Data privacy and retention:**
  - GDPR/CCPA: when a contact requests deletion, use `delete_resource` on their Personize record; this cascades to removing their properties from downstream operation outputs
  - Opt-out handling: contacts with `do_not_contact: true` must be filtered at the filter layer — the `agent-playbook.md` guideline enforces this; never bypass with raw CRM API calls
  - Data residency: Personize stores data in the region configured at account setup; confirm with customer before syncing PII
  - Retention windows: recommended practice is to set `skip_if` windows that align with customer's data retention policy
  - Reference: `docs/PRIVACY.md` in this repo for full policy

---

### subagent-patterns.md
**Purpose:** Teach the agent how to design multi-agent pipelines using these operations.

**Five named patterns:**

**1. Parallel Scoring Pipeline**
Run `score.icp-fit` and `score.lead-quality` concurrently on the same contact/company batch. Both are read-heavy, idempotent, skip-if-recent. Combine scores into a composite rank. Use for: daily prioritization, list refresh.

**2. Research → Score → Generate Pipeline**
Sequential: `research.account-deep-dive` (fills memory) → `score.icp-fit` (uses filled memory) → `generate.meeting-brief` (uses score + research). Each step gates the next. Use for: account-based pre-call prep.

**3. Daily Digest Orchestrator**
`analyze.buying-stage` (all active contacts) → `score.lead-quality` (rescore changed contacts) → `act.daily-digest` (per-rep ranked digest). Runs on schedule. Use for: daily rep workflow.

**4. Full Prospecting Pipeline**
`crm.sync-core` → `research.account-deep-dive` (top accounts) → `score.icp-fit` + `score.lead-quality` (parallel) → `generate.outreach-sequence` (qualified contacts) → task creation. Use for: new market entry, list activation.

**5. Optimization Loop**
`report.win-loss` → `optimize.refine-icp` → update `icp-definition.md` guideline → `setup.apply` → `score.icp-fit` (re-score all). Runs monthly. Use for: continuous ICP calibration.

**When to use subagents vs single agent:**
- Single agent: < 5 operations, sequential, < 500 records, interactive session
- Subagents: parallel operations, > 500 records per operation, scheduled/unattended runs, pipeline has independent branches

**Error handling and recovery:**
- Each operation is independently audited in `data/audit/`. If a pipeline step fails, the audit log shows exactly where.
- Recovery pattern: re-run from the failed step using the same filter. Operations are idempotent by design — re-running a completed step skips already-processed records (via skip_if).
- Never re-run setup operations in a recovery context without running `setup.diff` first.
- If a subagent fails mid-pipeline: log the failure to workspace.updates, surface to the orchestrating agent, do not cascade writes from partial results.

**Token budget management:**
- For large batches (> 1,000 records), use Haiku for bulk classification operations and reserve Sonnet/Opus for generation/strategy operations
- Estimate token usage before running: ~500 tokens per contact for scoring, ~2,000 per contact for generation, ~5,000 per account for deep research
- Use `limit` in the filter shape to test with a small batch before running full-scale
- Monitor cost per operation run via the audit log's token tracking

---

## What This Skill Is NOT

- It does not replace `skills/crm-ai-operators/SKILL.md` — that skill teaches agents how to *run* operations; this skill teaches agents how to *design and architect* the system
- It does not replace `AGENTS.md` — operational hard rules live there
- It is not a support/troubleshooting guide — it covers design decisions, not incident response

---

## Success Criteria

A customer's Claude Code agent, after loading this skill, should be able to:
1. Give a 5-minute vision pitch to a CRO or CTO tailored to their company size and CRM
2. Diagnose the customer's situation and prescribe a specific operation stack with rollout order
3. Guide a RevOps person through customizing any existing operation safely
4. Walk an engineer through building a net-new operation end-to-end
5. Design a multi-agent pipeline for any of the 5 named use cases
6. Tune guidelines and model tiers for a customer's specific quality/cost tradeoffs
7. Answer data privacy questions with confidence and refer to the right policies
