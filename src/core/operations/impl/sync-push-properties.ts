import { logger } from "../../lib/logger.js";
import { retrieveRecords, countRecords } from "../../lib/recall.js";
import { setProperty } from "../../lib/persist.js";
import { workspace } from "../../lib/workspace.js";
import type { OperationEntry } from "../types.js";

// Personize natively syncs AI properties back to CRM custom fields.
// This operation's job is property propagation WITHIN Personize:
// - Propagate company icp_fit_score → account_score_lift on linked contacts
// - Return a coverage report showing which AI properties still need computing
// Contacts/companies with gaps are candidates for score.icp-fit and score.lead-quality.

interface CompanyRecord {
  domain?: string;
  company_name?: string;
  icp_fit_score?: number;
  [key: string]: unknown;
}

interface ContactRecord {
  email: string;
  company_domain?: string;
  ai_score?: number;
  buying_stage?: string;
  next_best_action?: string;
  account_score_lift?: number;
  [key: string]: unknown;
}

async function getAllCompaniesWithScore(): Promise<CompanyRecord[]> {
  return (await retrieveRecords({
    type: "company",
    conditions: [{ propertyName: "icp_fit_score", operator: "exists", value: true }],
    logic: "AND",
    limit: 500,
  })) as CompanyRecord[];
}

async function getContactsByDomain(domain: string): Promise<ContactRecord[]> {
  return (await retrieveRecords({
    type: "contact",
    conditions: [{ propertyName: "company_domain", operator: "equals", value: domain }],
    logic: "AND",
    limit: 200,
  })) as ContactRecord[];
}

async function getCoverageStats(): Promise<{ total: number; with_ai_score: number; with_buying_stage: number; with_next_best_action: number }> {
  const [total, with_ai_score, with_buying_stage, with_next_best_action] = await Promise.all([
    countRecords({ type: "contact" }),
    countRecords({ type: "contact", conditions: [{ propertyName: "ai_score", operator: "exists", value: true }] }),
    countRecords({ type: "contact", conditions: [{ propertyName: "buying_stage", operator: "exists", value: true }] }),
    countRecords({ type: "contact", conditions: [{ propertyName: "next_best_action", operator: "exists", value: true }] }),
  ]);
  return { total, with_ai_score, with_buying_stage, with_next_best_action };
}

export const syncPushProperties: OperationEntry = {
  name: "sync.push-properties",
  mode: "operation",
  description: "Propagate AI properties within Personize: push company icp_fit_score as account_score_lift to linked contacts. Returns a coverage report for AI property gaps. Personize handles CRM writeback natively.",
  category: "sync",
  status: "live",
  idempotent: true,
  cost: "low",
  run_mode: "on-trigger",
  guidelines_required: [],
  run: async (input, context) => {
    const companies = await getAllCompaniesWithScore();
    logger.info("sync.push-properties: companies with icp_fit_score loaded", { count: companies.length });

    let propagated = 0;
    let contactsUpdated = 0;
    let failed = 0;

    for (const company of companies) {
      if (!company.domain || company.icp_fit_score == null) continue;

      try {
        const contacts = await getContactsByDomain(company.domain);
        if (contacts.length === 0) continue;

        for (const contact of contacts) {
          if (!contact.email) continue;

          // Skip if account_score_lift is already current (matches company score)
          if (contact.account_score_lift === company.icp_fit_score) continue;

          if (!context.dryRun) {
            await setProperty({ type: "contact", email: contact.email }, "account_score_lift", company.icp_fit_score);
            contactsUpdated++;
          } else {
            logger.info("[DRY RUN] Would propagate account_score_lift", {
              domain: company.domain,
              score: company.icp_fit_score,
              contact: contact.email,
            });
            contactsUpdated++;
          }
        }
        propagated++;
      } catch (error) {
        failed++;
        logger.warn("Failed to propagate score for company", {
          domain: company.domain,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Coverage report — helps identify which ops need to run next
    const coverage = await getCoverageStats();
    const missingAiScore = coverage.total - coverage.with_ai_score;
    const missingBuyingStage = coverage.total - coverage.with_buying_stage;
    const missingNextAction = coverage.total - coverage.with_next_best_action;

    if (!context.dryRun && contactsUpdated > 0) {
      // Log one workspace note per company batch would be noisy; log a summary on the run record only
      logger.info("sync.push-properties: propagation complete", { contactsUpdated, propagated });
    }

    const gaps: string[] = [];
    if (missingAiScore > 0) gaps.push(`${missingAiScore} contacts missing ai_score → run score.lead-quality`);
    if (missingBuyingStage > 0) gaps.push(`${missingBuyingStage} contacts missing buying_stage → run analyze.buying-stage`);
    if (missingNextAction > 0) gaps.push(`${missingNextAction} contacts missing next_best_action → run analyze.buying-stage`);

    return {
      ok: failed === 0,
      runId: context.runId,
      operation: "sync.push-properties",
      dryRun: context.dryRun,
      status: "live",
      summary: `Propagated account_score_lift to ${contactsUpdated} contacts across ${propagated} companies. ${gaps.length > 0 ? "Gaps: " + gaps.join("; ") : "All AI properties covered."}`,
      metrics: {
        companies_scanned: companies.length,
        companies_propagated: propagated,
        contacts_updated: contactsUpdated,
        failed,
        coverage,
        gaps,
      },
    };
  },
};
