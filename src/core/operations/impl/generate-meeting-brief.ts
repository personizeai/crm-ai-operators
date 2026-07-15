import { z } from "zod";
import { retrieveRecords, retrieveRecord } from "../../lib/recall.js";
import { ai } from "../../lib/ai.js";
import { loadGuidelines, missingGuidelines } from "../../lib/governance.js";
import { logger } from "../../lib/logger.js";
import { createTask } from "../../lib/tasks.js";
import { todayIso } from "../../lib/dates.js";
import { workspace } from "../../lib/workspace.js";
import type { OperationEntry } from "../types.js";

const REQUIRED_GUIDELINES = ["brand-voice", "account-research", "competitor-policy"];

const BriefOutputSchema = z.object({
  account_summary: z.string().min(40).max(600),
  contact_summary: z.string().min(20).max(400),
  recent_engagement: z.string().min(20).max(400),
  recommended_angles: z.array(z.string().min(10).max(200)).min(1).max(5),
  open_issues: z.array(z.string().min(5).max(200)).max(5),
  suggested_questions: z.array(z.string().min(10).max(200)).min(1).max(5),
  competitive_watchouts: z.array(z.string().max(200)).max(3),
});

async function getContact(email: string): Promise<Record<string, unknown> | null> {
  return (await retrieveRecord({ email, type: "contact" })) as Record<string, unknown> | null;
}

async function getCompany(domain: string): Promise<Record<string, unknown> | null> {
  return (await retrieveRecord({ websiteUrl: domain, type: "company" })) as Record<string, unknown> | null;
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
    limit: 15,
  })) as unknown[];
}

async function getRecentSignals(email: string): Promise<unknown[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return (await retrieveRecords({
    type: "signal",
    conditions: [
      { propertyName: "contact_email", operator: "equals", value: email },
      { propertyName: "observed_at", operator: "gte", value: since },
    ],
    logic: "AND",
    limit: 8,
  })) as unknown[];
}

export const generateMeetingBrief: OperationEntry = {
  name: "generate.meeting-brief",
  mode: "operation",
  description: "Pre-call AE brief: account context, contact background, recent engagement, recommended angles, open issues, and suggested questions.",
  category: "generate",
  status: "live",
  idempotent: true,
  cost: "high",
  run_mode: "on-decision",
  guidelines_required: REQUIRED_GUIDELINES,
  run: async (input, context) => {
    const inputObj = (input ?? {}) as { contact_email?: string; email?: string; meeting_at?: string };
    // Dispatcher per-record/chain routes send `email`; standalone/CLI callers may pass `contact_email`.
    const contactEmail = inputObj.email ?? inputObj.contact_email;

    if (!contactEmail) {
      return {
        ok: false,
        runId: context.runId,
        operation: "generate.meeting-brief",
        dryRun: context.dryRun,
        summary: "contact_email is required. Pass it as input: { contact_email: 'name@company.com' }",
      };
    }

    const guidelines = await loadGuidelines(REQUIRED_GUIDELINES);
    const missing = missingGuidelines(guidelines);
    if (missing.length > 0) {
      return {
        ok: false,
        runId: context.runId,
        operation: "generate.meeting-brief",
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
        operation: "generate.meeting-brief",
        dryRun: context.dryRun,
        summary: `Contact not found in Personize: ${contactEmail}. Run crm.sync-core first.`,
      };
    }

    const [company, conversations, signals] = await Promise.all([
      contact.company_domain ? getCompany(contact.company_domain as string) : Promise.resolve(null),
      getRecentConversations(contactEmail),
      getRecentSignals(contactEmail),
    ]);

    if (context.dryRun) {
      logger.info("[DRY RUN] Would generate meeting brief", { email: contactEmail });
      return {
        ok: true,
        runId: context.runId,
        operation: "generate.meeting-brief",
        dryRun: true,
        status: "live",
        summary: `[DRY RUN] Would generate brief for ${contactEmail}. Found ${conversations.length} conversations and ${signals.length} signals.`,
      };
    }

    const recordContext = JSON.stringify({
      contact,
      company,
      meeting_at: inputObj.meeting_at ?? "unspecified",
      recent_conversations: conversations.slice(0, 10),
      recent_signals: signals.slice(0, 5),
    }, null, 2);

    const result = await ai({
      instructions: `Generate a pre-call brief for an AE meeting this contact. Be specific — cite actual facts from the conversations and signals. Do not invent data.

Required output:
- account_summary: 2-3 sentences on the company's situation, tier, signals
- contact_summary: 1-2 sentences on who this person is and why they matter
- recent_engagement: what's happened in the last 90 days — what was said, what stage we're at
- recommended_angles: 1-5 specific talking points for this call, ordered by relevance
- open_issues: any unresolved items from past interactions (objections, follow-ups promised, open questions)
- suggested_questions: 1-5 discovery questions tailored to their situation
- competitive_watchouts: competitors mentioned or likely in play

Contact + company + engagement context:
${recordContext}`,
      context: `# Account Research\n\n${guidelines["account-research"]}\n\n---\n\n# Brand Voice\n\n${guidelines["brand-voice"]}\n\n---\n\n# Competitor Policy\n\n${guidelines["competitor-policy"]}`,
      outputs: BriefOutputSchema,
      temperature: 0.3,
      maxTokens: 1500,
    });

    const brief = result.output;

    const briefMarkdown = [
      `# Meeting Brief — ${(contact.first_name as string | undefined) ?? contactEmail}`,
      `**Meeting:** ${inputObj.meeting_at ?? "TBD"}  |  **Generated:** ${todayIso()}`,
      "",
      `## Account`,
      brief.account_summary,
      "",
      `## Contact`,
      brief.contact_summary,
      "",
      `## Recent Engagement`,
      brief.recent_engagement,
      "",
      `## Recommended Angles`,
      ...brief.recommended_angles.map((a, i) => `${i + 1}. ${a}`),
      "",
      ...(brief.open_issues.length > 0 ? [`## Open Issues`, ...brief.open_issues.map((o) => `- ${o}`), ""] : []),
      `## Suggested Questions`,
      ...brief.suggested_questions.map((q) => `- ${q}`),
      "",
      ...(brief.competitive_watchouts.length > 0
        ? [`## Competitive Watchouts`, ...brief.competitive_watchouts.map((c) => `- ${c}`), ""]
        : []),
    ].join("\n");

    await createTask({
      title: `Review meeting brief before call with ${(contact.first_name as string | undefined) ?? contactEmail}`,
      task_type: "review",
      assigned_to: "rep",
      priority: "high",
      due_date: todayIso(),
      notes: briefMarkdown,
      custom_key_name: "email",
      custom_key_value: contactEmail,
      created_by: "generate.meeting-brief",
    });

    await workspace.appendUpdate(
      { email: contactEmail },
      {
        author: "generate.meeting-brief",
        type: "action",
        summary: `Meeting brief generated for ${inputObj.meeting_at ?? "upcoming call"}`,
        details: {
          recommended_angles: brief.recommended_angles,
          open_issues: brief.open_issues,
          meeting_at: inputObj.meeting_at,
        },
      },
      "contact",
    );

    return {
      ok: true,
      runId: context.runId,
      operation: "generate.meeting-brief",
      dryRun: context.dryRun,
      status: "live",
      summary: `Brief generated for ${contactEmail} with ${conversations.length} conversations and ${signals.length} signals as context.`,
      metrics: {
        contact_email: contactEmail,
        conversations_used: conversations.length,
        signals_used: signals.length,
        brief: briefMarkdown,
      },
    };
  },
};
