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
  guidelines_required: ["partner-qualification"],
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

# Check the list includes the new operation
npm run operation:list
```

Run via MCP (dry-run):
```
operation_run("score.partner-fit", { dry_run: true, filter: { collection: "contacts", limit: 5 } })
```

Expected: `score.partner-fit` appears in the list with status `live`. Dry-run output shows which contacts would be scored and skipped.

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
