import { z } from "zod";
import { client } from "../../config.js";
import { retrieveRecords, retrieveRecord } from "../../lib/recall.js";
import { aiPrompt } from "../../lib/ai.js";
import { compileFilter, parseFilterInput, type Filter } from "../../lib/filter.js";
import { loadGuidelines, missingGuidelines } from "../../lib/governance.js";
import { logger } from "../../lib/logger.js";
import { evaluateSkipIf } from "../../lib/skip-if.js";
import { workspace } from "../../lib/workspace.js";
import type { OperationEntry } from "../types.js";

const DEFAULT_FILTER: Filter = {
  collection: "contacts",
  where: { sequence_status: { neq: "Opted Out" } },
  limit: 50,
};

const REQUIRED_GUIDELINES = ["icp-definition", "contact-qualification", "lead-scoring-policy"];

const ScoreOutputSchema = z.object({
  ai_score: z.number().int().min(0).max(100),
  ai_score_reason: z.string().min(20).max(500),
});

interface ContactRecord {
  email: string;
  first_name?: string;
  last_name?: string;
  job_title?: string;
  function?: string;
  seniority?: string;
  company_domain?: string;
  lifecycle_stage?: string;
  sequence_status?: string;
  ai_score?: number;
  ai_score_updated_at?: string;
  buying_stage?: string;
  pain_points?: string[];
  interests?: string[];
  [key: string]: unknown;
}

interface CompanyRecord {
  domain?: string;
  company_name?: string;
  industry?: string;
  icp_fit_score?: number;
  employee_count?: number;
  business_model?: string;
  buying_signals?: string[];
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

async function getCompany(domain: string): Promise<CompanyRecord | null> {
  return (await retrieveRecord({ websiteUrl: domain, type: "company" })) as CompanyRecord | null;
}

async function writeScoreBack(email: string, score: number, reason: string): Promise<void> {
  const memory = (client as any).memory;
  if (!memory?.updateProperty) {
    logger.warn("memory.updateProperty unavailable; score not persisted", { email });
    return;
  }
  const now = new Date().toISOString();
  for (const [propertyName, value] of Object.entries({
    ai_score: score,
    ai_score_reason: reason,
    ai_score_updated_at: now,
  })) {
    await memory.updateProperty({ email, type: "contact", propertyName, operation: "set", value });
  }
}

export const scoreLeadQuality: OperationEntry = {
  name: "score.lead-quality",
  mode: "operation",
  description: "Per-contact AI score (0-100) combining persona match, ICP fit, recent engagement, and account lift. Contact-level companion to score.icp-fit.",
  category: "score",
  status: "live",
  idempotent: true,
  cost: "medium",
  run_mode: "on-trigger",
  guidelines_required: REQUIRED_GUIDELINES,
  skip_if: { property: "ai_score", updated_within: "7d" },
  run: async (input, context) => {
    const filter = parseFilterInput(input) ?? DEFAULT_FILTER;

    const guidelines = await loadGuidelines(REQUIRED_GUIDELINES);
    const missing = missingGuidelines(guidelines);
    if (missing.length > 0) {
      return {
        ok: false,
        runId: context.runId,
        operation: "score.lead-quality",
        dryRun: context.dryRun,
        summary: `Missing required guidelines: ${missing.join(", ")}. Run setup.apply first.`,
        metrics: { missing_guidelines: missing },
      };
    }

    const contacts = await listContacts(filter);
    logger.info("score.lead-quality: contacts loaded", { count: contacts.length });

    const skipRule = scoreLeadQuality.skip_if!;
    let scored = 0;
    let skipped = 0;
    let failed = 0;
    const sample: Array<{ email: string; score: number; reason: string }> = [];

    for (const contact of contacts) {
      if (!contact.email) { skipped++; continue; }

      const decision = evaluateSkipIf(skipRule, contact as Record<string, unknown>);
      if (decision.skip) { skipped++; continue; }

      const company = contact.company_domain ? await getCompany(contact.company_domain) : null;

      const recordContext = JSON.stringify({
        contact: {
          email: contact.email,
          first_name: contact.first_name,
          last_name: contact.last_name,
          job_title: contact.job_title,
          function: contact.function,
          seniority: contact.seniority,
          lifecycle_stage: contact.lifecycle_stage,
          buying_stage: contact.buying_stage,
          pain_points: contact.pain_points,
          interests: contact.interests,
        },
        company: company ? {
          name: company.company_name,
          industry: company.industry,
          icp_fit_score: company.icp_fit_score,
          employee_count: company.employee_count,
          business_model: company.business_model,
          buying_signals: company.buying_signals,
        } : null,
      }, null, 2);

      try {
        if (context.dryRun) {
          logger.info("[DRY RUN] Would score contact", { email: contact.email });
          scored++;
          continue;
        }

        const result = await aiPrompt({
          instructions: `Score this contact 0-100 for lead quality using these weights:
- Persona match (title/function vs target buyer): 35%
- Seniority (decision-maker vs influencer vs IC): 20%
- Function alignment: 15%
- Engagement quality (buying_stage + pain_points richness): 20%
- Account lift (parent company icp_fit_score / 10): 10%

Apply hard-disqualifier gates from contact-qualification first — score = 0 if any gate fails.
Apply thresholds from lead-scoring-policy.

Contact + company:
${recordContext}`,
          context: `# ICP Definition\n\n${guidelines["icp-definition"]}\n\n---\n\n# Contact Qualification\n\n${guidelines["contact-qualification"]}\n\n---\n\n# Lead Scoring Policy\n\n${guidelines["lead-scoring-policy"]}`,
          outputs: ScoreOutputSchema,
          temperature: 0.2,
          maxTokens: 300,
        });

        await writeScoreBack(contact.email, result.output.ai_score, result.output.ai_score_reason);

        await workspace.appendUpdate(
          { email: contact.email },
          {
            author: "score.lead-quality",
            type: "score",
            summary: `Lead quality scored: ${result.output.ai_score}/100`,
            details: {
              previous_score: contact.ai_score ?? null,
              ai_score: result.output.ai_score,
              ai_score_reason: result.output.ai_score_reason,
            },
          },
          "contact",
        );

        if (sample.length < 5) {
          sample.push({ email: contact.email, score: result.output.ai_score, reason: result.output.ai_score_reason });
        }
        scored++;
      } catch (error) {
        failed++;
        logger.warn("Failed to score contact", {
          email: contact.email,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      ok: failed === 0,
      runId: context.runId,
      operation: "score.lead-quality",
      dryRun: context.dryRun,
      status: "live",
      summary: `Scored ${scored} of ${contacts.length} contacts (${skipped} skipped, ${failed} failed).`,
      metrics: { records_scanned: contacts.length, records_updated: scored, skipped, failed, sample },
    };
  },
};
