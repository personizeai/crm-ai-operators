import { z } from "zod";
import { retrieveRecords } from "../../lib/recall.js";
import { ai } from "../../lib/ai.js";
import { compileFilter, parseFilterInput, type Filter } from "../../lib/filter.js";
import { loadGuideline } from "../../lib/governance.js";
import { logger } from "../../lib/logger.js";
import { evaluateSkipIf } from "../../lib/skip-if.js";
import { workspace } from "../../lib/workspace.js";
import { crmWriteback } from "../../lib/crm-writeback.js";
import type { CrmId, OperationEntry } from "../types.js";
import { buildScaffold } from "../helpers.js";

const DEFAULT_FILTER: Filter = {
  collection: "companies",
  where: { lifecycle_stage: { neq: "Disqualified" } },
  limit: 50,
};

const ScoreOutputSchema = z.object({
  icp_fit_score: z.number().min(0).max(100),
  icp_fit_reason: z.string().min(10).max(400),
});

interface CompanyRecord {
  domain?: string;
  company_name?: string;
  industry?: string;
  employee_count?: number;
  company_size_band?: string;
  business_model?: string;
  lifecycle_stage?: string;
  buying_signals?: string[];
  signal_strength?: string;
  icp_fit_score?: number;
  icp_fit_score_updated_at?: string;
  /** CRM object id — drives the CRM writeback path (mirrorScoreToCrm). */
  crm_record_id?: string;
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

// Personize sync (icp_fit_score/icp_fit_reason) is handled by serverOutputs on the
// ai() call — including the client-side fallback in private mode. This mirrors the
// scores to the CRM record's personize_* fields so reps see them in HubSpot.
async function mirrorScoreToCrm(
  score: number,
  reason: string,
  crmRecordId?: string,
  crm?: CrmId,
): Promise<void> {
  try {
    await crmWriteback(
      { crm, type: "company", crmRecordId },
      { icp_fit_score: score, icp_fit_reason: reason },
    );
  } catch (error) {
    logger.warn("Failed to mirror ICP score to CRM", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export const scoreIcpFit: OperationEntry = {
  name: "score.icp-fit",
  mode: "operation",
  description: "Score companies against the ICP guideline; write icp_fit_score + icp_fit_reason and append to workspace.",
  category: "score",
  status: "live",
  idempotent: true,
  cost: "medium",
  run_mode: "on-trigger",
  guidelines_required: ["icp-definition"],
  skip_if: { property: "icp_fit_score", updated_within: "7d" },
  run: async (input, context) => {
    const filter = parseFilterInput(input) ?? DEFAULT_FILTER;
    const skipIf = (input as { skip_if?: { updated_within?: string } } | undefined)?.skip_if;

    // 1. Load governance: the ICP definition guideline.
    const icpGuideline = await loadGuideline("icp-definition");
    if (!icpGuideline) {
      // Without the ICP guideline, scoring would be unsafe — return a scaffold-style envelope.
      return buildScaffold(
        "score.icp-fit",
        "Cannot score without the icp-definition guideline. Run setup.apply to install it.",
        context,
        {
          would_read_from: ["personize.context (icp-definition)", "personize.companies"],
          would_write_to: ["companies.icp_fit_score", "companies.icp_fit_reason", "workspace.updates"],
          governance_required: ["icp-definition"],
          estimated_cost: "low",
        },
        input,
        ["Run `crm-agent operation run setup.apply` to install the icp-definition guideline before scoring."],
      );
    }

    // 2. Pull candidate companies.
    const candidates = await listCompanies(filter);
    logger.info("Score.icp-fit: candidates loaded", { count: candidates.length, filter });

    // 3. Score each, respecting skip_if.
    const skipRule = scoreIcpFit.skip_if!;
    const effectiveSkipRule = {
      ...skipRule,
      ...(skipIf?.updated_within ? { updated_within: skipIf.updated_within } : {}),
    };

    let scored = 0;
    let skipped = 0;
    let failed = 0;
    const sample: Array<{ domain: string; score: number; reason: string }> = [];

    for (const company of candidates) {
      if (!company.domain) {
        skipped++;
        continue;
      }

      const decision = evaluateSkipIf(effectiveSkipRule, company as Record<string, unknown>);
      if (decision.skip) {
        skipped++;
        continue;
      }

      const companyContext = JSON.stringify(
        {
          domain: company.domain,
          company_name: company.company_name,
          industry: company.industry,
          employee_count: company.employee_count,
          company_size_band: company.company_size_band,
          business_model: company.business_model,
          lifecycle_stage: company.lifecycle_stage,
          buying_signals: company.buying_signals,
          signal_strength: company.signal_strength,
        },
        null,
        2,
      );

      try {
        if (context.dryRun) {
          // Dry-run: don't call AI, just log what we would do.
          logger.info("[DRY RUN] Would score company", { domain: company.domain });
          scored++;
          continue;
        }

        const result = await ai({
          instructions: `Score this company against the ICP definition. Return a JSON object with:\n- icp_fit_score: integer 0-100 (40% firmographic fit, 30% buying signals, 20% engagement, 10% champion potential)\n- icp_fit_reason: one-sentence explanation citing the strongest 1-2 factors\n\nCompany:\n${companyContext}`,
          context: `# ICP Definition\n\n${icpGuideline}`,
          outputs: ScoreOutputSchema,
          // icp_fit_score and icp_fit_reason are auto-synced to company properties by the platform.
          serverOutputs: [
            { name: "icp_fit_score", collectionId: "companies", propertyId: "icp_fit_score" },
            { name: "icp_fit_reason", collectionId: "companies", propertyId: "icp_fit_reason" },
          ],
          memorize: { websiteUrl: company.domain, type: "Company" },
          temperature: 0.2,
          maxTokens: 300,
        });

        const { icp_fit_score, icp_fit_reason } = result.output;

        // serverOutputs already synced the scores to Personize; mirror to the CRM too.
        const crmRecordId = typeof company.crm_record_id === "string" ? company.crm_record_id : undefined;
        await mirrorScoreToCrm(icp_fit_score, icp_fit_reason, crmRecordId, context.crm);

        await workspace.appendUpdate(
          { website_url: company.domain },
          {
            author: "score.icp-fit",
            type: "score",
            summary: `Scored ${icp_fit_score} — ${icp_fit_reason.slice(0, 120)}`,
            details: {
              previous_score: company.icp_fit_score ?? null,
              new_score: icp_fit_score,
              reason: icp_fit_reason,
            },
          },
          "company",
        );

        if (sample.length < 5) {
          sample.push({ domain: company.domain, score: icp_fit_score, reason: icp_fit_reason });
        }
        scored++;
      } catch (error) {
        failed++;
        logger.warn("Failed to score company", {
          domain: company.domain,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      ok: failed === 0,
      runId: context.runId,
      operation: "score.icp-fit",
      dryRun: context.dryRun,
      status: "live",
      summary: `Scored ${scored} of ${candidates.length} companies (${skipped} skipped, ${failed} failed).`,
      metrics: {
        records_scanned: candidates.length,
        records_updated: scored,
        skipped,
        failed,
        sample,
      },
    };
  },
};
