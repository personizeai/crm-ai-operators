import { z } from "zod";
import { randomUUID } from "node:crypto";
import { retrieveRecords, retrieveRecord } from "../../lib/recall.js";
import { setProperties } from "../../lib/persist.js";
import { ai } from "../../lib/ai.js";
import { loadGuidelines, missingGuidelines } from "../../lib/governance.js";
import { logger } from "../../lib/logger.js";
import { createTask } from "../../lib/tasks.js";
import { todayIso, isoDate, addBusinessDays } from "../../lib/dates.js";
import { workspace } from "../../lib/workspace.js";
import type { OperationEntry } from "../types.js";

const REQUIRED_GUIDELINES = ["brand-voice", "account-qualification"];

const MilestoneSchema = z.object({
  title: z.string().min(5).max(200),
  description: z.string().min(10).max(400),
  owner: z.enum(["buyer", "seller", "both"]),
  due_days_from_now: z.number().int().min(1).max(365),
});

const MAPSchema = z.object({
  exec_summary: z.string().min(40).max(500),
  success_criteria: z.array(z.string().max(200)).min(1).max(6),
  milestones: z.array(MilestoneSchema).min(2).max(10),
  decision_criteria: z.array(z.string().max(200)).min(1).max(6),
  risks: z.array(z.string().max(200)).max(5),
  open_questions: z.array(z.string().max(200)).max(5),
});

async function getContact(email: string): Promise<Record<string, unknown> | null> {
  return (await retrieveRecord({ email, type: "contact" })) as Record<string, unknown> | null;
}

async function getCompany(domain: string): Promise<Record<string, unknown> | null> {
  return (await retrieveRecord({ websiteUrl: domain, type: "company" })) as Record<string, unknown> | null;
}

async function getStakeholders(domain: string): Promise<unknown[]> {
  return (await retrieveRecords({
    type: "contact",
    conditions: [{ propertyName: "company_domain", operator: "equals", value: domain }],
    logic: "AND",
    limit: 10,
  })) as unknown[];
}

async function getRecentConversations(email: string): Promise<unknown[]> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  return (await retrieveRecords({
    type: "conversation",
    conditions: [
      { propertyName: "contact_email", operator: "equals", value: email },
      { propertyName: "sent_at", operator: "gte", value: since },
    ],
    logic: "AND",
    limit: 10,
  })) as unknown[];
}

async function storeMap(mapId: string, name: string, content: string, domain?: string): Promise<void> {
  const properties = {
    record_id: mapId,
    name,
    status: "active",
    project_type: "mutual-action-plan",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...(domain ? { website_url: domain } : {}),
    notes: [{ content, category: "reference", author: "generate.mutual-action-plan", timestamp: new Date().toISOString() }],
  };
  try {
    await setProperties({ type: "project", collection: "projects", recordId: mapId }, properties);
  } catch {
    logger.warn("Failed to store MAP in projects collection");
  }
}

export const generateMutualActionPlan: OperationEntry = {
  name: "generate.mutual-action-plan",
  mode: "operation",
  description: "Draft a Mutual Action Plan from deal data and Personize memory. Creates one task per milestone. Stored in projects collection. Always a draft for human review.",
  category: "generate",
  status: "live",
  idempotent: false,
  cost: "high",
  run_mode: "on-decision",
  guidelines_required: REQUIRED_GUIDELINES,
  run: async (input, context) => {
    const inputObj = (input ?? {}) as {
      contact_email?: string;
      deal?: { close_date?: string; stage?: string; products?: string[]; amount?: number };
    };
    const contactEmail = inputObj.contact_email;

    if (!contactEmail) {
      return {
        ok: false,
        runId: context.runId,
        operation: "generate.mutual-action-plan",
        dryRun: context.dryRun,
        summary: "contact_email is required (the champion contact). Optionally include deal: { close_date, stage, products, amount }.",
      };
    }

    const guidelines = await loadGuidelines(REQUIRED_GUIDELINES);
    const missing = missingGuidelines(guidelines);
    if (missing.length > 0) {
      return {
        ok: false,
        runId: context.runId,
        operation: "generate.mutual-action-plan",
        dryRun: context.dryRun,
        summary: `Missing required guidelines: ${missing.join(", ")}. Run setup.apply first.`,
        metrics: { missing_guidelines: missing },
      };
    }

    const contact = await getContact(contactEmail);
    if (!contact) {
      return {
        ok: false,
        runId: context.runId,
        operation: "generate.mutual-action-plan",
        dryRun: context.dryRun,
        summary: `Contact not found in Personize: ${contactEmail}. Run crm.sync-core first.`,
      };
    }

    const domain = contact.company_domain as string | undefined;
    const [company, stakeholders, conversations] = await Promise.all([
      domain ? getCompany(domain) : Promise.resolve(null),
      domain ? getStakeholders(domain) : Promise.resolve([]),
      getRecentConversations(contactEmail),
    ]);

    if (context.dryRun) {
      logger.info("[DRY RUN] Would generate MAP", { email: contactEmail, domain });
      return {
        ok: true,
        runId: context.runId,
        operation: "generate.mutual-action-plan",
        dryRun: true,
        status: "live",
        summary: `[DRY RUN] Would generate MAP for ${contactEmail} with ${stakeholders.length} stakeholders and ${conversations.length} conversations.`,
      };
    }

    const mapContext = JSON.stringify({
      champion: contact,
      company,
      stakeholders: stakeholders.slice(0, 6),
      deal: inputObj.deal ?? {},
      recent_conversations: conversations.slice(0, 8),
    }, null, 2);

    const result = await ai({
      instructions: `Draft a Mutual Action Plan for this deal. Focus on concrete, time-bound milestones with clear owner assignments (buyer side, seller side, or both). Base milestones on what's been discussed in conversations and what the deal stage requires.

Context:
${mapContext}`,
      context: `# Account Qualification\n\n${guidelines["account-qualification"]}\n\n---\n\n# Brand Voice\n\n${guidelines["brand-voice"]}`,
      outputs: MAPSchema,
      temperature: 0.3,
      maxTokens: 1500,
    });

    const map = result.output;
    const mapId = `map_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
    const companyName = (company?.company_name as string | undefined) ?? domain ?? "the account";
    const today = new Date();

    // Create one task per milestone
    const taskIds: string[] = [];
    for (const milestone of map.milestones) {
      const dueDate = isoDate(addBusinessDays(today, milestone.due_days_from_now));
      const task = await createTask({
        title: `[MAP] ${milestone.title}`,
        task_type: "milestone",
        assigned_to: milestone.owner === "buyer" ? "rep" : "agent",
        priority: milestone.due_days_from_now <= 7 ? "high" : "medium",
        due_date: dueDate,
        notes: milestone.description,
        custom_key_name: "email",
        custom_key_value: contactEmail,
        created_by: "generate.mutual-action-plan",
      });
      if (task) taskIds.push(task.task_id);
    }

    const mapMarkdown = [
      `# Mutual Action Plan — ${companyName}`,
      `**Stage:** ${inputObj.deal?.stage ?? "TBD"}  |  **Target Close:** ${inputObj.deal?.close_date ?? "TBD"}  |  **Draft:** ${todayIso()}`,
      `> ⚠️ Draft for review — share with buyer only after internal approval.`,
      "",
      `## Executive Summary`,
      map.exec_summary,
      "",
      `## Success Criteria`,
      ...map.success_criteria.map((c) => `- ✓ ${c}`),
      "",
      `## Milestones`,
      ...map.milestones.map((m, i) => [
        `### ${i + 1}. ${m.title}`,
        `**Owner:** ${m.owner}  |  **Target:** +${m.due_days_from_now} days`,
        m.description,
      ].join("\n")),
      "",
      `## Decision Criteria`,
      ...map.decision_criteria.map((c) => `- ${c}`),
      "",
      ...(map.risks.length > 0 ? [`## Risks`, ...map.risks.map((r) => `- ⚠️ ${r}`), ""] : []),
      ...(map.open_questions.length > 0 ? [`## Open Questions`, ...map.open_questions.map((q) => `- ? ${q}`), ""] : []),
    ].join("\n");

    await storeMap(mapId, `MAP — ${companyName} — ${todayIso()}`, mapMarkdown, domain);

    if (domain) {
      await workspace.appendUpdate(
        { website_url: domain },
        {
          author: "generate.mutual-action-plan",
          type: "milestone",
          summary: `MAP drafted with ${map.milestones.length} milestones. ${taskIds.length} tasks created.`,
          details: { map_id: mapId, milestones: map.milestones.map((m) => m.title), task_ids: taskIds },
        },
        "company",
      );
    }

    return {
      ok: true,
      runId: context.runId,
      operation: "generate.mutual-action-plan",
      dryRun: context.dryRun,
      status: "live",
      summary: `MAP drafted for ${companyName} with ${map.milestones.length} milestones. ${taskIds.length} milestone tasks created.`,
      metrics: { company: companyName, milestones: map.milestones.length, tasks_created: taskIds.length, map_id: mapId, map: mapMarkdown },
    };
  },
};
