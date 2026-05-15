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

const WinLossSchema = z.object({
  win_patterns: z.array(z.string().max(300)).max(8),
  loss_patterns: z.array(z.string().max(300)).max(8),
  icp_refinement_signals: z.array(z.string().max(300)).max(6),
  common_objections: z.array(z.object({
    objection: z.string().max(200),
    frequency: z.enum(["rare", "common", "very_common"]),
    recommended_response: z.string().max(300),
  })).max(8),
  title_patterns: z.string().max(400),
  firmographic_patterns: z.string().max(400),
  executive_summary: z.string().min(40).max(600),
});

interface CompanyRecord {
  domain?: string;
  company_name?: string;
  lifecycle_stage?: string;
  industry?: string;
  employee_count?: number;
  icp_fit_score?: number;
  business_model?: string;
  [key: string]: unknown;
}

async function getAccountsByOutcome(stages: string[]): Promise<CompanyRecord[]> {
  const memory = (client as any).memory;
  if (!memory?.filterByProperty) return [];
  const results: CompanyRecord[] = [];
  for (const stage of stages) {
    try {
      const response = await memory.filterByProperty({
        type: "company",
        conditions: [{ propertyName: "lifecycle_stage", operator: "equals", value: stage }],
        logic: "AND",
        limit: 100,
      });
      results.push(...((response?.data ?? response?.records ?? []) as CompanyRecord[]));
    } catch {
      // Skip missing stages
    }
  }
  return results;
}

async function getChampionsForDomain(domain: string): Promise<unknown[]> {
  const memory = (client as any).memory;
  if (!memory?.filterByProperty) return [];
  try {
    const response = await memory.filterByProperty({
      type: "contact",
      conditions: [{ propertyName: "company_domain", operator: "equals", value: domain }],
      logic: "AND",
      limit: 5,
    });
    return (response?.data ?? response?.records ?? []) as unknown[];
  } catch {
    return [];
  }
}

async function storeReport(reportId: string, name: string, content: string): Promise<void> {
  const memory = (client as any).memory;
  const properties = {
    record_id: reportId,
    name,
    status: "published",
    project_type: "win-loss-analysis",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    notes: [{ content, category: "analysis", author: "report.win-loss", timestamp: new Date().toISOString() }],
  };
  try {
    if (typeof memory?.store === "function") {
      await memory.store({ collectionSlug: "projects", primaryKey: { record_id: reportId }, properties });
    } else if (typeof memory?.batchStore === "function") {
      await memory.batchStore({ collectionSlug: "projects", records: [{ primaryKey: { record_id: reportId }, properties }] });
    }
  } catch {
    logger.warn("Failed to store win-loss report in projects collection");
  }
}

export const reportWinLoss: OperationEntry = {
  name: "report.win-loss",
  mode: "operation",
  description: "Analyze won vs churned/lost accounts to surface ICP refinement signals, win/loss patterns, and objection playbook. Produces a structured report stored in projects.",
  category: "report",
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
        operation: "report.win-loss",
        dryRun: context.dryRun,
        summary: `Missing required guidelines: ${missing.join(", ")}. Run setup.apply first.`,
        metrics: { missing_guidelines: missing },
      };
    }

    const [won, lost] = await Promise.all([
      getAccountsByOutcome(["Customer", "customer"]),
      getAccountsByOutcome(["Churned", "Closed Lost", "churned", "closed_lost"]),
    ]);

    logger.info("report.win-loss: accounts loaded", { won: won.length, lost: lost.length });

    if (won.length === 0 && lost.length === 0) {
      return {
        ok: false,
        runId: context.runId,
        operation: "report.win-loss",
        dryRun: context.dryRun,
        summary: "No Customer or Churned/Closed Lost accounts found. Run crm.sync-core and score.icp-fit first.",
      };
    }

    if (context.dryRun) {
      logger.info("[DRY RUN] Would generate win-loss report", { won: won.length, lost: lost.length });
      return {
        ok: true,
        runId: context.runId,
        operation: "report.win-loss",
        dryRun: true,
        status: "live",
        summary: `[DRY RUN] Would analyze ${won.length} won and ${lost.length} lost accounts.`,
      };
    }

    // Enrich a sample with champion data
    const wonSample = await Promise.all(
      won.slice(0, 15).map(async (c) => ({
        ...c,
        champions: c.domain ? await getChampionsForDomain(c.domain) : [],
      })),
    );
    const lostSample = await Promise.all(
      lost.slice(0, 15).map(async (c) => ({
        ...c,
        champions: c.domain ? await getChampionsForDomain(c.domain) : [],
      })),
    );

    const analysisContext = JSON.stringify({
      won_accounts: wonSample.map((c) => ({
        domain: c.domain, name: c.company_name, industry: c.industry,
        employee_count: c.employee_count, icp_fit_score: c.icp_fit_score, business_model: c.business_model,
        champions: (c.champions as any[]).slice(0, 2).map((ch: any) => ({ title: ch.job_title, seniority: ch.seniority, function: ch.function })),
      })),
      lost_accounts: lostSample.map((c) => ({
        domain: c.domain, name: c.company_name, industry: c.industry,
        employee_count: c.employee_count, icp_fit_score: c.icp_fit_score, business_model: c.business_model,
        champions: (c.champions as any[]).slice(0, 2).map((ch: any) => ({ title: ch.job_title, seniority: ch.seniority, function: ch.function })),
      })),
      totals: { won: won.length, lost: lost.length },
    }, null, 2);

    const result = await aiPrompt({
      instructions: `Analyze the patterns across won and lost accounts. Focus on statistically meaningful differences — what distinguishes won accounts from lost ones in terms of firmographics, champion profiles, and signals. Do not invent patterns not supported by the data.

Won vs Lost account data:
${analysisContext}`,
      context: `# ICP Definition\n\n${guidelines["icp-definition"]}\n\n---\n\n# Account Qualification\n\n${guidelines["account-qualification"]}`,
      outputs: WinLossSchema,
      temperature: 0.2,
      maxTokens: 1500,
    });

    const r = result.output;
    const reportId = `rpt_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;

    const reportMarkdown = [
      `# Win/Loss Analysis — ${todayIso()}`,
      `**Won accounts analyzed:** ${won.length}  |  **Lost/Churned analyzed:** ${lost.length}`,
      "",
      `## Executive Summary`,
      r.executive_summary,
      "",
      `## Win Patterns`,
      ...r.win_patterns.map((p) => `- ✓ ${p}`),
      "",
      `## Loss Patterns`,
      ...r.loss_patterns.map((p) => `- ✗ ${p}`),
      "",
      `## Firmographic Patterns`,
      r.firmographic_patterns,
      "",
      `## Champion Title Patterns`,
      r.title_patterns,
      "",
      `## Common Objections`,
      ...r.common_objections.map((o) => `**${o.objection}** (${o.frequency})\n  → ${o.recommended_response}`),
      "",
      `## ICP Refinement Signals`,
      ...r.icp_refinement_signals.map((s) => `- 💡 ${s}`),
    ].join("\n");

    await storeReport(reportId, `Win/Loss Analysis — ${todayIso()}`, reportMarkdown);

    await createTask({
      title: `Review win/loss analysis — ${won.length} won, ${lost.length} lost accounts`,
      task_type: "review",
      assigned_to: "rep",
      priority: "high",
      due_date: todayIso(),
      notes: reportMarkdown,
      created_by: "report.win-loss",
    });

    return {
      ok: true,
      runId: context.runId,
      operation: "report.win-loss",
      dryRun: context.dryRun,
      status: "live",
      summary: `Win/loss analysis complete: ${won.length} won, ${lost.length} lost. ${r.icp_refinement_signals.length} ICP refinement signals surfaced.`,
      metrics: { won_count: won.length, lost_count: lost.length, icp_signals: r.icp_refinement_signals.length, report_id: reportId, report: reportMarkdown },
    };
  },
};
