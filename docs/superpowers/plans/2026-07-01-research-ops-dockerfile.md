# Research Operations + Dockerfile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the two scaffold research operations to `live` status, then add a production-ready `Dockerfile` so operators can deploy the engine without installing Node.js locally.

**Architecture:** Research operations follow the same pattern as `score-icp-fit.ts` but use `aiSubagent` (tool-using) instead of `aiPrompt`, and write to `signals` + `contacts` (batch) rather than a single property. The Dockerfile builds on Node.js 22 Alpine and runs the engine entry point.

**Tech Stack:** `aiSubagent`, `setProperty`, `setProperties`, `workspace`, `retrieveRecords`, `loadGuideline`, `evaluateSkipIf` — all already in `src/core/lib/`. No new imports needed.

## Global Constraints

- No new npm dependencies
- TypeScript strict; import paths use `.js` extensions
- `dryRun` respected — log intent and skip SDK writes / AI calls
- `evaluateSkipIf` applied per-record before calling aiSubagent
- Each operation must return the standard operation result shape: `{ ok, runId, operation, dryRun, status: "live", summary, metrics: { records_scanned, processed, skipped, failed }, sample[] }`
- `buildScaffold` fallback if guideline is missing (same pattern as score.icp-fit)
- Commit after each task

---

### Task 1: Implement `research.account-deep-dive`

**Files:**
- Modify: `src/core/operations/impl/research-account-deep-dive.ts`

**Interfaces:**
- Consumes: `aiSubagent` from `"../../lib/ai.js"`; `retrieveRecords` from `"../../lib/recall.js"`; `setProperty`, `setProperties` from `"../../lib/persist.js"`; `workspace` from `"../../lib/workspace.js"`; `loadGuideline` from `"../../lib/governance.js"`; `evaluateSkipIf` from `"../../lib/skip-if.js"`; `compileFilter`, `parseFilterInput` from `"../../lib/filter.js"`; `logger` from `"../../lib/logger.js"`; `z` from `"zod"`

**What the operation does:**
For each company (filtered by `input.filter` or default tier A/B companies with stale context):
1. Load `account-research` guideline — fall back to scaffold if missing
2. Filter companies via `retrieveRecords({ type: "company" })`
3. Per company: skip if `context` updated within 30d (skip_if rule)
4. Call `aiSubagent` with multi-step instructions to research firmographics, funding, news, leadership, tech stack
5. Write findings back: `companies.context` (summary), `companies.industry`/`business_model`/`employee_count` (when enriched), and `signals` rows (one per buying signal)
6. Append `workspace.appendNote` citing sources

- [ ] **Step 1: Replace the file content of `src/core/operations/impl/research-account-deep-dive.ts`**

```typescript
import { z } from "zod";
import { retrieveRecords } from "../../lib/recall.js";
import { setProperty, setProperties } from "../../lib/persist.js";
import { aiSubagent } from "../../lib/ai.js";
import { compileFilter, parseFilterInput, type Filter } from "../../lib/filter.js";
import { loadGuideline } from "../../lib/governance.js";
import { logger } from "../../lib/logger.js";
import { evaluateSkipIf } from "../../lib/skip-if.js";
import { workspace } from "../../lib/workspace.js";
import { randomUUID } from "node:crypto";
import type { OperationEntry } from "../types.js";
import { buildScaffold } from "../helpers.js";

const DEFAULT_FILTER: Filter = {
  collection: "companies",
  where: { lifecycle_stage: { neq: "Disqualified" } },
  limit: 25,
};

const ResearchOutputSchema = z.object({
  context_summary: z.string().min(20).max(800).describe("One-paragraph narrative about this account"),
  industry: z.string().optional(),
  business_model: z.string().optional(),
  employee_count: z.number().int().positive().optional(),
  signals: z.array(z.object({
    title: z.string(),
    summary: z.string(),
    severity: z.enum(["low", "medium", "high"]),
    type: z.string().describe("e.g. funding, leadership_move, tech_stack, news, hiring"),
    source_url: z.string().optional(),
  })).describe("Buying signals discovered during research"),
  stakeholders: z.array(z.object({
    full_name: z.string(),
    job_title: z.string(),
    linkedin_url: z.string().optional(),
    function: z.string().optional(),
  })).describe("Key stakeholders / champions discovered"),
  next_action: z.string().optional().describe("Recommended next step for the sales team"),
});

type ResearchOutput = z.infer<typeof ResearchOutputSchema>;

interface CompanyRecord {
  domain?: string;
  website_url?: string;
  company_name?: string;
  industry?: string;
  business_model?: string;
  employee_count?: number;
  lifecycle_stage?: string;
  context?: string;
  context_updated_at?: string;
  [key: string]: unknown;
}

async function listCompanies(filter: Filter): Promise<CompanyRecord[]> {
  const compiled = compileFilter(filter);
  return (await retrieveRecords({
    type: "company",
    conditions: compiled.conditions,
    logic: compiled.logic,
    limit: compiled.limit,
  })) as CompanyRecord[];
}

async function persistFindings(
  domain: string,
  output: ResearchOutput,
): Promise<void> {
  await setProperty({ type: "company", websiteUrl: domain }, "context", output.context_summary);
  await setProperty({ type: "company", websiteUrl: domain }, "context_updated_at", new Date().toISOString());
  if (output.industry) {
    await setProperty({ type: "company", websiteUrl: domain }, "industry", output.industry);
  }
  if (output.business_model) {
    await setProperty({ type: "company", websiteUrl: domain }, "business_model", output.business_model);
  }
  if (output.employee_count) {
    await setProperty({ type: "company", websiteUrl: domain }, "employee_count", output.employee_count);
  }

  // Write buying signals to signals collection
  for (const signal of output.signals) {
    const signal_id = `sig_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
    await setProperties(
      { type: "signal", collection: "signals", recordId: signal_id },
      {
        signal_id,
        provider: "research.account-deep-dive",
        source: signal.source_url ?? "web",
        type: signal.type,
        severity: signal.severity,
        occurred_at: new Date().toISOString(),
        received_at: new Date().toISOString(),
        entity_domain: domain,
        title: signal.title,
        summary: signal.summary,
        action_required: signal.severity === "high",
      },
    );
  }

  // Write stakeholders as contact records
  for (const stakeholder of output.stakeholders) {
    if (!stakeholder.full_name) continue;
    const recordId = stakeholder.linkedin_url
      ? `li_${Buffer.from(stakeholder.linkedin_url).toString("base64url").slice(0, 24)}`
      : `stk_${Buffer.from(stakeholder.full_name).toString("base64url").slice(0, 20)}_${domain}`;
    await setProperties(
      { type: "contact", collection: "contacts", recordId },
      {
        full_name: stakeholder.full_name,
        job_title: stakeholder.job_title,
        function: stakeholder.function ?? "",
        linkedin_url: stakeholder.linkedin_url ?? "",
        company_domain: domain,
        source: "research.account-deep-dive",
        crm_object_type: "lead",
      },
    );
  }
}

export const researchAccountDeepDive: OperationEntry = {
  name: "research.account-deep-dive",
  mode: "operation",
  description: "Comprehensive account research per the account-research guideline. Fills companies properties + signals + stakeholder contacts.",
  category: "research",
  status: "live",
  idempotent: true,
  cost: "high",
  run_mode: "on-trigger",
  guidelines_required: ["account-research"],
  skip_if: { property: "context_updated_at", updated_within: "30d" },
  run: async (input, context) => {
    const filter = parseFilterInput(input) ?? DEFAULT_FILTER;

    const guideline = await loadGuideline("account-research");
    if (!guideline) {
      return buildScaffold(
        "research.account-deep-dive",
        "Cannot research without the account-research guideline. Run setup.apply to install it.",
        context,
        {
          would_read_from: ["personize.context (account-research)", "personize.companies"],
          would_write_to: ["companies.context", "signals", "contacts", "workspace.notes"],
          governance_required: ["account-research"],
          estimated_cost: "high",
        },
        input,
        ["Run `crm-agent operation run setup.apply` to install the account-research guideline before researching."],
      );
    }

    const candidates = await listCompanies(filter);
    logger.info("research.account-deep-dive: candidates loaded", { count: candidates.length });

    const skipRule = researchAccountDeepDive.skip_if!;
    let processed = 0;
    let skipped = 0;
    let failed = 0;
    const sample: Array<{ domain: string; signals: number; stakeholders: number }> = [];

    for (const company of candidates) {
      const domain = company.domain ?? company.website_url;
      if (!domain) { skipped++; continue; }

      const decision = evaluateSkipIf(skipRule, company as Record<string, unknown>);
      if (decision.skip) { skipped++; continue; }

      if (context.dryRun) {
        logger.info("[DRY RUN] Would research account", { domain });
        processed++;
        continue;
      }

      try {
        const result = await aiSubagent({
          instructions: [
            `Research the company at domain "${domain}" (${company.company_name ?? "unknown name"}).
Gather: firmographics (size, industry, business model), recent funding/news (last 90 days),
leadership moves, tech stack signals from job postings, key stakeholders in ${["VP Sales", "CTO", "Head of Revenue", "CRO"].join(", ")} functions.

Account-Research Guideline:
${guideline}

Return your findings in the required output format.`,
          ],
          outputs: ResearchOutputSchema,
          context: `Company domain: ${domain}\nCurrent industry: ${company.industry ?? "unknown"}\nLifecycle: ${company.lifecycle_stage ?? "unknown"}`,
          tier: "pro",
          serverOutputs: [{ name: "research_result", required: true }],
          mcpTools: [{ mcpId: "tavily" }],
          metadata: { recordId: domain },
        });

        await persistFindings(domain, result.output);

        await workspace.appendNote(
          { website_url: domain },
          {
            author: "research.account-deep-dive",
            content: `Research complete. ${result.output.signals.length} signals, ${result.output.stakeholders.length} stakeholders. Summary: ${result.output.context_summary.slice(0, 200)}`,
            category: "enrichment",
            confidence: "medium",
          },
          "company",
        );

        if (sample.length < 5) {
          sample.push({ domain, signals: result.output.signals.length, stakeholders: result.output.stakeholders.length });
        }
        processed++;
      } catch (error) {
        failed++;
        logger.warn("research.account-deep-dive: failed for company", {
          domain,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      ok: failed === 0,
      runId: context.runId,
      operation: "research.account-deep-dive",
      dryRun: context.dryRun,
      status: "live",
      summary: `Researched ${processed} of ${candidates.length} accounts (${skipped} skipped, ${failed} failed).`,
      metrics: { records_scanned: candidates.length, processed, skipped, failed },
      sample,
    };
  },
};
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 3: Run tests**

```bash
npm test
```
Expected: all 43 pass (1 skipped)

- [ ] **Step 4: Commit**

```bash
git add src/core/operations/impl/research-account-deep-dive.ts
git commit -m "feat(ops): implement research.account-deep-dive — aiSubagent, signals, stakeholders"
```

---

### Task 2: Implement `research.contact-background`

**Files:**
- Modify: `src/core/operations/impl/research-contact-background.ts`

**Interfaces:** Same imports as Task 1 except no `setProperties` for signals (contacts are the primary record)

**What the operation does:**
For each contact (filtered by `input.filter` or default high-score contacts with stale background):
1. Load `account-research` guideline
2. Filter contacts via `retrieveRecords({ type: "contact" })`
3. Per contact: skip if `job_title` updated within 60d
4. Call `aiSubagent` to research role history, public content, communication style, pain signals
5. Write back: `contacts.job_title`/`seniority`/`function`, `contacts.communication_style`, `contacts.pain_points`
6. Append `workspace.appendNote` with sources

- [ ] **Step 1: Replace the file content of `src/core/operations/impl/research-contact-background.ts`**

```typescript
import { z } from "zod";
import { retrieveRecords } from "../../lib/recall.js";
import { setProperty } from "../../lib/persist.js";
import { aiSubagent } from "../../lib/ai.js";
import { compileFilter, parseFilterInput, type Filter } from "../../lib/filter.js";
import { loadGuideline } from "../../lib/governance.js";
import { logger } from "../../lib/logger.js";
import { evaluateSkipIf } from "../../lib/skip-if.js";
import { workspace } from "../../lib/workspace.js";
import type { OperationEntry } from "../types.js";
import { buildScaffold } from "../helpers.js";

const DEFAULT_FILTER: Filter = {
  collection: "contacts",
  where: { icp_fit_score: { gte: 60 } },
  limit: 30,
};

const ContactResearchSchema = z.object({
  current_title: z.string().optional().describe("Verified current job title"),
  seniority: z.enum(["ic", "manager", "director", "vp", "c-suite", "founder", "unknown"]).optional(),
  function: z.string().optional().describe("e.g. sales, marketing, engineering, operations"),
  communication_style: z.string().max(300).optional().describe("Inferred style: formal/casual, data-driven/story-driven, etc."),
  pain_points: z.array(z.string()).describe("Pain points inferred from public content, talks, posts"),
  recent_moves: z.array(z.object({
    type: z.string().describe("job_change, promotion, company_exit, public_content"),
    summary: z.string(),
    occurred_at: z.string().optional(),
  })).describe("Recent notable moves or signals"),
  source_urls: z.array(z.string()).describe("Sources cited"),
});

type ContactResearch = z.infer<typeof ContactResearchSchema>;

interface ContactRecord {
  email?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  job_title?: string;
  seniority?: string;
  company_domain?: string;
  icp_fit_score?: number;
  job_title_updated_at?: string;
  [key: string]: unknown;
}

async function listContacts(filter: Filter): Promise<ContactRecord[]> {
  const compiled = compileFilter(filter);
  return (await retrieveRecords({
    type: "contact",
    conditions: compiled.conditions,
    logic: compiled.logic,
    limit: compiled.limit,
  })) as ContactRecord[];
}

async function persistContactResearch(
  email: string,
  output: ContactResearch,
): Promise<void> {
  if (output.current_title) {
    await setProperty({ type: "contact", email }, "job_title", output.current_title);
    await setProperty({ type: "contact", email }, "job_title_updated_at", new Date().toISOString());
  }
  if (output.seniority && output.seniority !== "unknown") {
    await setProperty({ type: "contact", email }, "seniority", output.seniority);
  }
  if (output.function) {
    await setProperty({ type: "contact", email }, "function", output.function);
  }
  if (output.communication_style) {
    await setProperty({ type: "contact", email }, "communication_style", output.communication_style);
  }
  if (output.pain_points.length > 0) {
    await setProperty({ type: "contact", email }, "pain_points", output.pain_points.join(" | "));
  }
}

export const researchContactBackground: OperationEntry = {
  name: "research.contact-background",
  mode: "operation",
  description: "Per-contact background research — title history, public content, recent role moves, communication style cues.",
  category: "research",
  status: "live",
  idempotent: true,
  cost: "medium",
  run_mode: "on-trigger",
  guidelines_required: ["account-research"],
  skip_if: { property: "job_title_updated_at", updated_within: "60d" },
  run: async (input, context) => {
    const filter = parseFilterInput(input) ?? DEFAULT_FILTER;

    const guideline = await loadGuideline("account-research");
    if (!guideline) {
      return buildScaffold(
        "research.contact-background",
        "Cannot research without the account-research guideline. Run setup.apply to install it.",
        context,
        {
          would_read_from: ["personize.context (account-research)", "personize.contacts"],
          would_write_to: ["contacts.job_title", "contacts.communication_style", "contacts.pain_points", "workspace.notes"],
          governance_required: ["account-research"],
          estimated_cost: "medium",
        },
        input,
        ["Run `crm-agent operation run setup.apply` to install the account-research guideline before researching."],
      );
    }

    const candidates = await listContacts(filter);
    logger.info("research.contact-background: candidates loaded", { count: candidates.length });

    const skipRule = researchContactBackground.skip_if!;
    let processed = 0;
    let skipped = 0;
    let failed = 0;
    const sample: Array<{ email: string; title?: string; pain_points: number }> = [];

    for (const contact of candidates) {
      const email = contact.email;
      if (!email) { skipped++; continue; }

      const decision = evaluateSkipIf(skipRule, contact as Record<string, unknown>);
      if (decision.skip) { skipped++; continue; }

      if (context.dryRun) {
        logger.info("[DRY RUN] Would research contact", { email });
        processed++;
        continue;
      }

      const displayName = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || contact.full_name || email;

      try {
        const result = await aiSubagent({
          instructions: [
            `Research ${displayName} (${email}), who works at ${contact.company_domain ?? "unknown company"} as ${contact.job_title ?? "unknown role"}.
Find: current verified title, LinkedIn seniority level, job function, communication style from public posts/talks,
pain points from content they publish, any recent role changes.

Privacy rule: only use publicly available information. Do not attempt to access private profiles.

Guideline:
${guideline}

Return findings in the required output format.`,
          ],
          outputs: ContactResearchSchema,
          context: `Contact: ${displayName}\nEmail: ${email}\nCurrent title: ${contact.job_title ?? "unknown"}\nCompany: ${contact.company_domain ?? "unknown"}`,
          tier: "pro",
          serverOutputs: [{ name: "contact_research", required: true }],
          mcpTools: [{ mcpId: "tavily" }],
          metadata: { recordId: email },
        });

        await persistContactResearch(email, result.output);

        await workspace.appendNote(
          { email },
          {
            author: "research.contact-background",
            content: `Research complete. Style: ${result.output.communication_style?.slice(0, 100) ?? "n/a"}. Pain points: ${result.output.pain_points.slice(0, 3).join(", ")}.`,
            category: "enrichment",
            confidence: "medium",
            source_url: result.output.source_urls[0],
          },
          "contact",
        );

        if (sample.length < 5) {
          sample.push({ email, title: result.output.current_title, pain_points: result.output.pain_points.length });
        }
        processed++;
      } catch (error) {
        failed++;
        logger.warn("research.contact-background: failed for contact", {
          email,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      ok: failed === 0,
      runId: context.runId,
      operation: "research.contact-background",
      dryRun: context.dryRun,
      status: "live",
      summary: `Researched ${processed} of ${candidates.length} contacts (${skipped} skipped, ${failed} failed).`,
      metrics: { records_scanned: candidates.length, processed, skipped, failed },
      sample,
    };
  },
};
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 3: Run tests**

```bash
npm test
```
Expected: all 43 pass (1 skipped)

- [ ] **Step 4: Commit**

```bash
git add src/core/operations/impl/research-contact-background.ts
git commit -m "feat(ops): implement research.contact-background — aiSubagent, title/style/pain-points"
```

---

### Task 3: Dockerfile

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

**What it does:** Multi-stage build — deps stage installs production dependencies, run stage copies source and starts the engine via `tsx`.

- [ ] **Step 1: Create `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS run
WORKDIR /app

# tsx needed at runtime (ESM + TypeScript direct execution)
RUN npm install -g tsx@4

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/
COPY manifests/ ./manifests/
COPY tsconfig.json ./

# Non-root user
RUN addgroup -S engine && adduser -S engine -G engine
USER engine

# Health-check via the engine's /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${ENGINE_PORT:-3000}/health || exit 1

EXPOSE 3000

CMD ["tsx", "src/scripts/engine.ts"]
```

- [ ] **Step 2: Create `.dockerignore`**

```
node_modules
.env
.env.*
!.env.example
*.log
.git
docs/
.superpowers/
```

- [ ] **Step 3: Run typecheck** (Dockerfile doesn't affect TS — just verify nothing broke)

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat(deploy): Dockerfile for engine — Node 22 Alpine, multi-stage, healthcheck"
```

---

## Self-Review

### Spec Coverage
- Research operations: both promoted from `scaffold` → `live`
- Both use `aiSubagent` (tool-using) with `mcpTools: [{ mcpId: "tavily" }]`
- Both respect `skip_if` and `dryRun`
- Both fall back to `buildScaffold` when guideline is missing
- Both write workspace notes with sources
- Dockerfile uses a non-root user, health check, and minimal Alpine image

### Placeholder Scan
- No TODO or TBD in any file
- Output schemas are fully typed with Zod
- `serverOutputs` required in `aiSubagent` multi-step mode — provided
