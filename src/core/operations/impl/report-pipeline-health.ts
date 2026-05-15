import { z } from "zod";
import { randomUUID } from "node:crypto";
import { client } from "../../config.js";
import { aiPrompt } from "../../lib/ai.js";
import { loadGuidelines, missingGuidelines } from "../../lib/governance.js";
import { logger } from "../../lib/logger.js";
import { createTask } from "../../lib/tasks.js";
import { todayIso } from "../../lib/dates.js";
import type { OperationEntry } from "../types.js";

const REQUIRED_GUIDELINES = ["account-qualification", "signal-definitions"];

const PipelineReportSchema = z.object({
  headline: z.string().min(20).max(300),
  stage_summary: z.array(z.object({
    stage: z.string(),
    count: z.number(),
    avg_score: z.number(),
    health: z.enum(["healthy", "at_risk", "stalled"]),
    observation: z.string().max(200),
  })).max(10),
  at_risk: z.array(z.object({
    company: z.string(),
    reason: z.string().max(200),
    recommended_action: z.string().max(200),
  })).max(10),
  momentum: z.array(z.object({
    company: z.string(),
    signal: z.string().max(200),
  })).max(10),
  rep_priorities: z.array(z.string().max(200)).max(5),
  recommendations: z.array(z.string().max(300)).max(5),
});

interface ContactRecord {
  email: string;
  lifecycle_stage?: string;
  ai_score?: number;
  buying_stage?: string;
  company_domain?: string;
  assigned_to?: string;
  [key: string]: unknown;
}

const DEAL_STAGES = new Set(["MQL", "SQL", "Opportunity", "Vendor Evaluating", "Decision", "salesqualifiedlead", "opportunity"]);

async function getActiveDeals(): Promise<ContactRecord[]> {
  const memory = (client as any).memory;
  if (!memory?.filterByProperty) return [];
  try {
    const response = await memory.filterByProperty({
      type: "contact",
      conditions: [{ propertyName: "ai_score", operator: "gte", value: 40 }],
      logic: "AND",
      limit: 300,
    });
    return (response?.data ?? response?.records ?? []) as ContactRecord[];
  } catch {
    return [];
  }
}

async function getRecentSignals(): Promise<unknown[]> {
  const memory = (client as any).memory;
  if (!memory?.filterByProperty) return [];
  try {
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const response = await memory.filterByProperty({
      type: "signal",
      conditions: [{ propertyName: "observed_at", operator: "gte", value: since }],
      logic: "AND",
      limit: 200,
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
    project_type: "pipeline-report",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    notes: [{ content, category: "analysis", author: "report.pipeline-health", timestamp: new Date().toISOString() }],
  };
  try {
    if (typeof memory?.store === "function") {
      await memory.store({ collectionSlug: "projects", primaryKey: { record_id: reportId }, properties });
    } else if (typeof memory?.batchStore === "function") {
      await memory.batchStore({ collectionSlug: "projects", records: [{ primaryKey: { record_id: reportId }, properties }] });
    }
  } catch {
    logger.warn("Failed to store pipeline report in projects collection");
  }
}

export const reportPipelineHealth: OperationEntry = {
  name: "report.pipeline-health",
  mode: "operation",
  description: "Weekly AI pipeline narrative: deal stage distribution, at-risk accounts, momentum signals, and rep priorities. Stored in projects collection + delivered as task.",
  category: "report",
  status: "live",
  idempotent: true,
  cost: "high",
  run_mode: "always",
  guidelines_required: REQUIRED_GUIDELINES,
  run: async (input, context) => {
    const guidelines = await loadGuidelines(REQUIRED_GUIDELINES);
    const missing = missingGuidelines(guidelines);
    if (missing.length > 0) {
      return {
        ok: false,
        runId: context.runId,
        operation: "report.pipeline-health",
        dryRun: context.dryRun,
        summary: `Missing required guidelines: ${missing.join(", ")}. Run setup.apply first.`,
        metrics: { missing_guidelines: missing },
      };
    }

    const [contacts, signals] = await Promise.all([getActiveDeals(), getRecentSignals()]);
    logger.info("report.pipeline-health: data loaded", { contacts: contacts.length, signals: signals.length });

    // Aggregate by lifecycle/buying stage
    const stageMap: Record<string, { contacts: ContactRecord[]; scores: number[] }> = {};
    for (const c of contacts) {
      const stage = c.buying_stage ?? c.lifecycle_stage ?? "Unknown";
      if (!stageMap[stage]) stageMap[stage] = { contacts: [], scores: [] };
      stageMap[stage].contacts.push(c);
      if (c.ai_score != null) stageMap[stage].scores.push(c.ai_score);
    }

    const stageSummary = Object.entries(stageMap).map(([stage, data]) => ({
      stage,
      count: data.contacts.length,
      avg_score: data.scores.length > 0 ? Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length) : 0,
    }));

    const pipelineContext = JSON.stringify({
      as_of: todayIso(),
      total_active_contacts: contacts.length,
      stage_distribution: stageSummary,
      recent_signal_count: signals.length,
      sample_contacts: contacts.slice(0, 20).map((c) => ({
        email: c.email, company: c.company_domain, score: c.ai_score, stage: c.buying_stage ?? c.lifecycle_stage,
      })),
    }, null, 2);

    if (context.dryRun) {
      logger.info("[DRY RUN] Would generate pipeline health report", { contacts: contacts.length });
      return {
        ok: true,
        runId: context.runId,
        operation: "report.pipeline-health",
        dryRun: true,
        status: "live",
        summary: `[DRY RUN] Would generate pipeline report for ${contacts.length} active contacts across ${Object.keys(stageMap).length} stages.`,
      };
    }

    const result = await aiPrompt({
      instructions: `Generate a pipeline health narrative for this week. Be specific — cite stage counts, score distributions, and signal patterns from the data. Flag real risks and real momentum. Do not invent data.

Pipeline data:
${pipelineContext}`,
      context: `# Account Qualification\n\n${guidelines["account-qualification"]}\n\n---\n\n# Signal Definitions\n\n${guidelines["signal-definitions"]}`,
      outputs: PipelineReportSchema,
      temperature: 0.3,
      maxTokens: 1500,
    });

    const r = result.output;
    const weekId = `pipeline-${todayIso()}`;
    const reportId = `rpt_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;

    const reportMarkdown = [
      `# Pipeline Health — ${todayIso()}`,
      "",
      r.headline,
      "",
      `## Stage Distribution`,
      ...r.stage_summary.map((s) => `- **${s.stage}** (${s.count} deals, avg score ${s.avg_score}) — ${s.health}: ${s.observation}`),
      "",
      ...(r.at_risk.length > 0 ? [
        `## At Risk`,
        ...r.at_risk.map((a) => `- **${a.company}**: ${a.reason} → ${a.recommended_action}`),
        "",
      ] : []),
      ...(r.momentum.length > 0 ? [
        `## Momentum`,
        ...r.momentum.map((m) => `- **${m.company}**: ${m.signal}`),
        "",
      ] : []),
      `## Rep Priorities`,
      ...r.rep_priorities.map((p) => `- ${p}`),
      "",
      `## Recommendations`,
      ...r.recommendations.map((rec) => `- ${rec}`),
    ].join("\n");

    await storeReport(reportId, `Pipeline Health — ${weekId}`, reportMarkdown);

    await createTask({
      title: `Review pipeline health report — ${todayIso()}`,
      task_type: "review",
      assigned_to: "rep",
      priority: r.at_risk.length > 3 ? "high" : "medium",
      due_date: todayIso(),
      notes: reportMarkdown,
      created_by: "report.pipeline-health",
    });

    return {
      ok: true,
      runId: context.runId,
      operation: "report.pipeline-health",
      dryRun: context.dryRun,
      status: "live",
      summary: `Pipeline report generated for ${contacts.length} contacts across ${stageSummary.length} stages. At risk: ${r.at_risk.length}. Momentum: ${r.momentum.length}.`,
      metrics: {
        contacts_scanned: contacts.length,
        stages: stageSummary.length,
        at_risk_count: r.at_risk.length,
        momentum_count: r.momentum.length,
        report_id: reportId,
        report: reportMarkdown,
      },
    };
  },
};
