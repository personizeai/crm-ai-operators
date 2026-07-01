import { z } from "zod";
import { randomUUID } from "node:crypto";
import { retrieveRecords } from "../../lib/recall.js";
import { setProperty, setProperties } from "../../lib/persist.js";
import { aiSubagent } from "../../lib/ai.js";
import { compileFilter, parseFilterInput, type Filter } from "../../lib/filter.js";
import { loadGuideline } from "../../lib/governance.js";
import { logger } from "../../lib/logger.js";
import { evaluateSkipIf } from "../../lib/skip-if.js";
import { workspace } from "../../lib/workspace.js";
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
  })).describe("Key stakeholders discovered"),
  next_action: z.string().optional().describe("Recommended next step for the sales team"),
});

type ResearchOutput = z.infer<typeof ResearchOutputSchema>;

interface CompanyRecord {
  domain?: string;
  website_url?: string;
  company_name?: string;
  industry?: string;
  lifecycle_stage?: string;
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

async function persistFindings(domain: string, output: ResearchOutput): Promise<void> {
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
  skip_if: { property: "context", updated_within: "30d" },
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
        ["Run setup.apply to install the account-research guideline before researching."],
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
          instructions: `Research the company at domain "${domain}" (${company.company_name ?? "unknown name"}).
Gather: firmographics (size, industry, business model), recent funding or news (last 90 days),
leadership moves, tech stack signals from job postings, key stakeholders in VP Sales, CTO, Head of Revenue, CRO functions.
Use web search to find this information. Only use publicly available information.
Verify facts before including them. Cite sources.

Account-Research Guideline:
${guideline.slice(0, 2000)}

Return a JSON object with these exact fields:
- context_summary: one-paragraph narrative (20-800 chars)
- industry: string (optional)
- business_model: string (optional)
- employee_count: integer (optional)
- signals: array of { title, summary, severity (low|medium|high), type, source_url? }
- stakeholders: array of { full_name, job_title, linkedin_url?, function? }
- next_action: string (optional)`,
          outputs: ResearchOutputSchema,
          context: `Company domain: ${domain}\nCurrent industry: ${company.industry ?? "unknown"}\nLifecycle: ${company.lifecycle_stage ?? "unknown"}`,
          tier: "pro",
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
