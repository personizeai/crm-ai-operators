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
