import { z } from "zod";
import { retrieveRecords, retrieveRecord } from "../../lib/recall.js";
import { aiPrompt } from "../../lib/ai.js";
import { addBusinessDays, isoDate } from "../../lib/dates.js";
import { compileFilter, parseFilterInput, type Filter } from "../../lib/filter.js";
import { loadGuidelines, missingGuidelines } from "../../lib/governance.js";
import { logger } from "../../lib/logger.js";
import { evaluateSkipIf } from "../../lib/skip-if.js";
import { createTask } from "../../lib/tasks.js";
import { workspace } from "../../lib/workspace.js";
import type { OperationEntry } from "../types.js";

const DEFAULT_FILTER: Filter = {
  collection: "contacts",
  where: { lifecycle_stage: { eq: "Churned" } },
  limit: 20,
};

const REQUIRED_GUIDELINES = ["outreach-playbook", "brand-voice"];

const EmailSchema = z.object({
  subject: z.string().min(5).max(120),
  body_html: z.string().min(40).max(3000),
  angle: z.string().min(10).max(200),
});

const WinBackOutputSchema = z.object({
  email1: EmailSchema,
  email2: EmailSchema,
  email3: EmailSchema,
});

interface ContactRecord {
  email: string;
  first_name?: string;
  last_name?: string;
  job_title?: string;
  company_domain?: string;
  lifecycle_stage?: string;
  sequence_status?: string;
  buying_stage?: string;
  ai_score?: number;
  campaign_id?: string;
  [key: string]: unknown;
}

interface CompanyRecord {
  domain?: string;
  company_name?: string;
  industry?: string;
  icp_fit_score?: number;
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

async function getPastEngagement(email: string): Promise<unknown[]> {
  return (await retrieveRecords({
    type: "conversation",
    conditions: [{ propertyName: "contact_email", operator: "equals", value: email }],
    logic: "AND",
    limit: 10,
  })) as unknown[];
}

export const generateWinBackSequence: OperationEntry = {
  name: "generate.win-back-sequence",
  mode: "operation",
  description: "Win-back 3-email sequence for churned or stalled contacts. Anchored in past engagement + what's new since they left.",
  category: "generate",
  status: "live",
  idempotent: false,
  cost: "high",
  run_mode: "on-decision",
  guidelines_required: REQUIRED_GUIDELINES,
  skip_if: { property: "sequence_status", in_states: ["Active", "Replied", "Opted Out", "Bounced"] },
  run: async (input, context) => {
    const filter = parseFilterInput(input) ?? DEFAULT_FILTER;
    const inputObj = (input ?? {}) as { campaign_id?: string };
    const campaignId = inputObj.campaign_id ?? "win-back";

    const guidelines = await loadGuidelines(REQUIRED_GUIDELINES);
    const missing = missingGuidelines(guidelines);
    if (missing.length > 0) {
      return {
        ok: false,
        runId: context.runId,
        operation: "generate.win-back-sequence",
        dryRun: context.dryRun,
        summary: `Missing required guidelines: ${missing.join(", ")}. Run setup.apply first.`,
        metrics: { missing_guidelines: missing },
      };
    }

    const contacts = await listContacts(filter);
    logger.info("generate.win-back-sequence: candidates loaded", { count: contacts.length });

    const skipRule = generateWinBackSequence.skip_if!;
    let drafted = 0;
    let skipped = 0;
    let failed = 0;
    const sample: Array<{ email: string; subjects: string[] }> = [];
    const today = new Date();

    for (const contact of contacts) {
      if (!contact.email) { skipped++; continue; }

      const decision = evaluateSkipIf(skipRule, contact as Record<string, unknown>);
      if (decision.skip) { skipped++; continue; }

      const [company, pastEngagement] = await Promise.all([
        contact.company_domain ? getCompany(contact.company_domain) : Promise.resolve(null),
        getPastEngagement(contact.email),
      ]);

      const recordContext = JSON.stringify({
        contact: {
          email: contact.email,
          first_name: contact.first_name,
          last_name: contact.last_name,
          job_title: contact.job_title,
          lifecycle_stage: contact.lifecycle_stage,
          buying_stage: contact.buying_stage,
          ai_score: contact.ai_score,
        },
        company: company ? { name: company.company_name, industry: company.industry, icp_fit_score: company.icp_fit_score } : null,
        past_engagement_summary: `${pastEngagement.length} prior conversations on record`,
      }, null, 2);

      try {
        if (context.dryRun) {
          logger.info("[DRY RUN] Would draft win-back sequence", { email: contact.email });
          drafted++;
          continue;
        }

        const result = await aiPrompt({
          instructions: `Draft a 3-email win-back sequence for this churned/stalled contact. This is NOT cold outreach — they know us. The angle for each email must be distinct:
- Email 1: Acknowledge the time gap + one specific thing that's changed or improved since they left
- Email 2: New value angle — a use case or outcome they haven't seen yet
- Email 3: Final direct CTA — "worth a fresh look or should I close your file?"

Use brand-voice tone rules and outreach-playbook HTML structure. Each email:
- subject (5-120 chars, not "Re:" of anything)
- body_html (<p>, <b>, <i>, <a href>, <br> only)
- angle (one sentence describing the hook)

Contact + context:
${recordContext}`,
          context: `# Outreach Playbook\n\n${guidelines["outreach-playbook"]}\n\n---\n\n# Brand Voice\n\n${guidelines["brand-voice"]}`,
          outputs: WinBackOutputSchema,
          temperature: 0.6,
          maxTokens: 2500,
        });

        const emails = [result.output.email1, result.output.email2, result.output.email3];
        const sendDates = [today, addBusinessDays(today, 3), addBusinessDays(today, 6)];
        const taskIds: string[] = [];

        for (let i = 0; i < 3; i++) {
          const email = emails[i];
          const task = await createTask({
            title: `Win-back email ${i + 1} to ${contact.first_name ?? contact.email}: ${email.subject.slice(0, 80)}`,
            task_type: "send-email",
            assigned_to: "agent",
            priority: "medium",
            due_date: isoDate(sendDates[i]),
            notes: JSON.stringify({ step: i + 1, angle: email.angle, subject: email.subject, body_html: email.body_html }),
            custom_key_name: "email",
            custom_key_value: contact.email,
            project: campaignId,
            created_by: "generate.win-back-sequence",
          });
          if (task) taskIds.push(task.task_id);
        }

        await workspace.appendUpdate(
          { email: contact.email },
          {
            author: "generate.win-back-sequence",
            type: "outreach",
            summary: `Drafted 3-email win-back sequence for campaign '${campaignId}'`,
            details: { campaign_id: campaignId, angles: emails.map((e) => e.angle), subjects: emails.map((e) => e.subject), task_ids: taskIds },
          },
          "contact",
        );

        if (sample.length < 3) sample.push({ email: contact.email, subjects: emails.map((e) => e.subject) });
        drafted++;
      } catch (error) {
        failed++;
        logger.warn("Failed to draft win-back sequence", {
          email: contact.email,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      ok: failed === 0,
      runId: context.runId,
      operation: "generate.win-back-sequence",
      dryRun: context.dryRun,
      status: "live",
      summary: `Drafted ${drafted} of ${contacts.length} win-back sequences (${skipped} skipped, ${failed} failed). Tasks created: ${drafted * 3}.`,
      metrics: { records_scanned: contacts.length, records_updated: drafted, skipped, failed, sample, campaign_id: campaignId },
    };
  },
};
