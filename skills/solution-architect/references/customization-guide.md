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
