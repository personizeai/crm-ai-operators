import { z } from "zod";
import { randomUUID } from "node:crypto";
import { client } from "../../config.js";
import { aiPrompt } from "../../lib/ai.js";
import { loadGuidelines, missingGuidelines } from "../../lib/governance.js";
import { logger } from "../../lib/logger.js";
import { createTask } from "../../lib/tasks.js";
import { todayIso } from "../../lib/dates.js";
import type { OperationEntry } from "../types.js";

const REQUIRED_GUIDELINES = ["icp-definition", "account-qualification"];

const IcpRefinementSchema = z.object({
  executive_summary: z.string().min(40).max(600),
  won_patterns: z.array(z.string().max(300)).max(8),
  lost_patterns: z.array(z.string().max(300)).max(8),
  proposed_icp_changes: z.array(z.object({
    field: z.string().max(100),
    current_value: z.string().max(300),
    proposed_value: z.string().max(300),
    evidence: z.string().max(300),
    confidence: z.enum(["low", "medium", "high"]),
  })).max(8),
  draft_icp_additions: z.string().min(20).max(1000),
  draft_icp_removals: z.string().max(500),
});

interface CompanyRecord {
  domain?: string;
  company_name?: string;
  lifecycle_stage?: string;
  industry?: string;
  employee_count?: number;
  icp_fit_score?: number;
  business_model?: string;
  buying_signals?: string[];
  [key: string]: unknown;
}

async function getAccountsByStage(stages: string[]): Promise<CompanyRecord[]> {
  const memory = (client as any).memory;
  if (!memory?.filterByProperty) return [];
  const results: CompanyRecord[] = [];
  for (const stage of stages) {
    try {
      const response = await memory.filterByProperty({
        type: "company",
        conditions: [{ propertyName: "lifecycle_stage", operator: "equals", value: stage }],
        logic: "AND",
        limit: 75,
      });
      results.push(...((response?.data ?? response?.records ?? []) as CompanyRecord[]));
    } catch {
      // Skip
    }
  }
  return results;
}

async function getChampionProfile(domain: string): Promise<Record<string, unknown> | null> {
  const memory = (client as any).memory;
  if (!memory?.filterByProperty) return null;
  try {
    const response = await memory.filterByProperty({
      type: "contact",
      conditions: [
        { propertyName: "company_domain", operator: "equals", value: domain },
        { propertyName: "ai_score", operator: "gte", value: 60 },
      ],
      logic: "AND",
      limit: 3,
    });
    const contacts = (response?.data ?? response?.records ?? []) as Record<string, unknown>[];
    return contacts[0] ?? null;
  } catch {
    return null;
  }
}

async function storeRefinement(id: string, name: string, content: string): Promise<void> {
  const memory = (client as any).memory;
  const properties = {
    record_id: id,
    name,
    status: "pending-review",
    project_type: "icp-refinement",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    notes: [{ content, category: "analysis", author: "optimize.refine-icp", timestamp: new Date().toISOString() }],
  };
  try {
    if (typeof memory?.store === "function") {
      await memory.store({ collectionSlug: "projects", primaryKey: { record_id: id }, properties });
    } else if (typeof memory?.batchStore === "function") {
      await memory.batchStore({ collectionSlug: "projects", records: [{ primaryKey: { record_id: id }, properties }] });
    }
  } catch {
    logger.warn("Failed to store ICP refinement in projects collection");
  }
}

export const optimizeRefineIcp: OperationEntry = {
  name: "optimize.refine-icp",
  mode: "optimization",
  description: "Analyze won vs lost accounts to propose concrete ICP definition updates. Stores a draft refinement in projects for human review — never auto-updates the live guideline.",
  category: "optimize",
  status: "live",
  idempotent: true,
  cost: "high",
  run_mode: "on-decision",
  guidelines_required: REQUIRED_GUIDELINES,
  run: async (input, context) => {
    const guidelines = await loadGuidelines(REQUIRED_GUIDELINES);
    const missing = missingGuidelines(guidelines);
    if (missing.length > 0) {
      return {
        ok: false,
        runId: context.runId,
        operation: "optimize.refine-icp",
        dryRun: context.dryRun,
        summary: `Missing required guidelines: ${missing.join(", ")}. Run setup.apply first.`,
        metrics: { missing_guidelines: missing },
      };
    }

    const [won, lost] = await Promise.all([
      getAccountsByStage(["Customer", "customer"]),
      getAccountsByStage(["Churned", "Closed Lost", "churned", "closed_lost", "Disqualified"]),
    ]);

    logger.info("optimize.refine-icp: accounts loaded", { won: won.length, lost: lost.length });

    if (won.length < 3) {
      return {
        ok: false,
        runId: context.runId,
        operation: "optimize.refine-icp",
        dryRun: context.dryRun,
        summary: `Not enough won accounts to produce meaningful ICP refinement (found ${won.length}, need at least 3). Run crm.sync-core first.`,
      };
    }

    if (context.dryRun) {
      logger.info("[DRY RUN] Would analyze ICP refinement", { won: won.length, lost: lost.length });
      return {
        ok: true,
        runId: context.runId,
        operation: "optimize.refine-icp",
        dryRun: true,
        status: "live",
        summary: `[DRY RUN] Would analyze ${won.length} won and ${lost.length} lost accounts against current ICP definition.`,
      };
    }

    // Enrich top accounts with champion profiles
    const enriched = async (accounts: CompanyRecord[]) =>
      Promise.all(
        accounts.slice(0, 20).map(async (c) => ({
          domain: c.domain,
          name: c.company_name,
          industry: c.industry,
          employee_count: c.employee_count,
          icp_fit_score: c.icp_fit_score,
          business_model: c.business_model,
          buying_signals: c.buying_signals,
          champion: c.domain ? await getChampionProfile(c.domain) : null,
        })),
      );

    const [wonEnriched, lostEnriched] = await Promise.all([enriched(won), enriched(lost)]);

    const analysisContext = JSON.stringify({
      current_icp_summary: guidelines["icp-definition"].slice(0, 1500),
      won_accounts: wonEnriched,
      lost_accounts: lostEnriched,
      totals: { won: won.length, lost: lost.length },
    }, null, 2);

    const result = await aiPrompt({
      instructions: `Analyze the patterns across won and lost accounts relative to the current ICP definition. Propose specific, evidence-backed changes. Be concrete — name exact fields and values to add, modify, or remove from the ICP.

Analysis context:
${analysisContext}`,
      context: `# Current ICP Definition\n\n${guidelines["icp-definition"]}\n\n---\n\n# Account Qualification\n\n${guidelines["account-qualification"]}`,
      outputs: IcpRefinementSchema,
      temperature: 0.2,
      maxTokens: 1500,
    });

    const r = result.output;
    const refinementId = `icp_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;

    const refinementMarkdown = [
      `# ICP Refinement Proposal — ${todayIso()}`,
      `**Based on:** ${won.length} won accounts vs ${lost.length} lost/churned accounts`,
      `> ⚠️ DRAFT — requires leadership approval before updating the live icp-definition guideline.`,
      "",
      `## Executive Summary`,
      r.executive_summary,
      "",
      `## Won Account Patterns`,
      ...r.won_patterns.map((p) => `- ✓ ${p}`),
      "",
      `## Lost Account Patterns`,
      ...r.lost_patterns.map((p) => `- ✗ ${p}`),
      "",
      `## Proposed Changes`,
      ...r.proposed_icp_changes.map((c) => [
        `### ${c.field} (${c.confidence} confidence)`,
        `**Current:** ${c.current_value}`,
        `**Proposed:** ${c.proposed_value}`,
        `**Evidence:** ${c.evidence}`,
      ].join("\n")),
      "",
      `## Suggested ICP Additions`,
      r.draft_icp_additions,
      "",
      ...(r.draft_icp_removals ? [`## Suggested ICP Removals`, r.draft_icp_removals, ""] : []),
      `---`,
      `To apply: update \`manifests/core/guidelines/icp-definition.md\` and run \`setup.apply\`.`,
    ].join("\n");

    await storeRefinement(refinementId, `ICP Refinement — ${todayIso()}`, refinementMarkdown);

    await createTask({
      title: `Review ICP refinement proposal — ${r.proposed_icp_changes.length} proposed changes`,
      task_type: "guideline-review",
      assigned_to: "rep",
      priority: "high",
      notes: refinementMarkdown,
      created_by: "optimize.refine-icp",
    });

    return {
      ok: true,
      runId: context.runId,
      operation: "optimize.refine-icp",
      dryRun: context.dryRun,
      status: "live",
      summary: `ICP refinement proposal generated from ${won.length} won and ${lost.length} lost accounts. ${r.proposed_icp_changes.length} specific changes proposed. Stored as draft for review.`,
      metrics: {
        won_count: won.length,
        lost_count: lost.length,
        proposed_changes: r.proposed_icp_changes.length,
        refinement_id: refinementId,
        report: refinementMarkdown,
      },
    };
  },
};
