import { z } from "zod";
import { retrieveRecords, retrieveRecord } from "../../lib/recall.js";
import { ai } from "../../lib/ai.js";
import { addBusinessDays, isoDate } from "../../lib/dates.js";
import { compileFilter, parseFilterInput, type Filter } from "../../lib/filter.js";
import { loadGuidelines, missingGuidelines } from "../../lib/governance.js";
import { logger } from "../../lib/logger.js";
import { evaluateSkipIf } from "../../lib/skip-if.js";
import { VerificationSchema, verificationInstruction, assertApproved } from "../../lib/instruction-patterns.js";
import { createTask } from "../../lib/tasks.js";
import { workspace } from "../../lib/workspace.js";
import type { OperationEntry } from "../types.js";
import { buildScaffold } from "../helpers.js";

const DEFAULT_FILTER: Filter = {
  collection: "contacts",
  where: { ai_score: { gte: 60 } },
  limit: 25,
};

const REQUIRED_GUIDELINES = ["outreach-playbook", "brand-voice", "multichannel-rules"];

const EmailSchema = z.object({
  subject: z.string().min(5).max(120),
  body_html: z.string().min(40).max(3000),
  angle: z.string().min(10).max(200),
});

const SequenceOutputSchema = z.object({
  email1: EmailSchema,
  email2: EmailSchema,
  email3: EmailSchema,
  // The model's self-check verdict on its own draft (see verificationInstruction below).
  verification: VerificationSchema,
});

interface ContactRecord {
  email: string;
  first_name?: string;
  last_name?: string;
  job_title?: string;
  function?: string;
  seniority?: string;
  company_domain?: string;
  ai_score?: number;
  buying_stage?: string;
  pain_points?: string[];
  interests?: string[];
  communication_style?: string;
  sequence_status?: string;
  emails_sent?: number;
  campaign_id?: string;
  [key: string]: unknown;
}

interface CompanyRecord {
  domain?: string;
  company_name?: string;
  industry?: string;
  business_model?: string;
  buying_signals?: string[];
  signal_strength?: string;
  context?: string;
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

export const generateOutreachSequence: OperationEntry = {
  name: "generate.outreach-sequence",
  mode: "operation",
  description: "Per-contact 3-email sequence using outreach-playbook + brand-voice + multichannel-rules. Creates send-email tasks scheduled 3 business days apart; appends to contact workspace.",
  category: "generate",
  status: "live",
  idempotent: false,
  cost: "high",
  run_mode: "on-decision",
  guidelines_required: REQUIRED_GUIDELINES,
  skip_if: { property: "sequence_status", in_states: ["Replied", "Bounced", "Opted Out", "Complete", "Active"] },
  run: async (input, context) => {
    const filter = parseFilterInput(input) ?? DEFAULT_FILTER;
    const inputObj = (input ?? {}) as { campaign_id?: string };
    const campaignId = inputObj.campaign_id ?? "default";

    // 1. Load all required guidelines.
    const guidelines = await loadGuidelines(REQUIRED_GUIDELINES);
    const missing = missingGuidelines(guidelines);
    if (missing.length > 0) {
      return buildScaffold(
        "generate.outreach-sequence",
        `Cannot generate outreach without governance. Missing: ${missing.join(", ")}.`,
        context,
        {
          would_read_from: ["personize.context (guidelines)"],
          would_write_to: [],
          governance_required: REQUIRED_GUIDELINES,
          estimated_cost: "low",
        },
        input,
        [`Run setup.apply to install guidelines: ${missing.join(", ")}`],
      );
    }

    // 2. Pull candidate contacts.
    const candidates = await listContacts(filter);
    logger.info("generate.outreach-sequence: candidates loaded", { count: candidates.length });

    const skipRule = generateOutreachSequence.skip_if!;
    let drafted = 0;
    let skipped = 0;
    let failed = 0;
    const sample: Array<{ email: string; subjects: string[] }> = [];

    const today = new Date();

    for (const contact of candidates) {
      if (!contact.email) {
        skipped++;
        continue;
      }
      const decision = evaluateSkipIf(skipRule, contact as Record<string, unknown>);
      if (decision.skip) {
        skipped++;
        continue;
      }

      const company = contact.company_domain ? await getCompany(contact.company_domain) : null;

      const recordContext = JSON.stringify(
        {
          contact: {
            email: contact.email,
            first_name: contact.first_name,
            last_name: contact.last_name,
            job_title: contact.job_title,
            seniority: contact.seniority,
            function: contact.function,
            buying_stage: contact.buying_stage,
            pain_points: contact.pain_points,
            interests: contact.interests,
            communication_style: contact.communication_style,
            ai_score: contact.ai_score,
          },
          company: company
            ? {
                domain: company.domain,
                name: company.company_name,
                industry: company.industry,
                business_model: company.business_model,
                buying_signals: company.buying_signals,
                signal_strength: company.signal_strength,
                context: company.context,
              }
            : null,
        },
        null,
        2,
      );

      try {
        if (context.dryRun) {
          logger.info("[DRY RUN] Would draft sequence for contact", { email: contact.email });
          drafted++;
          continue;
        }

        const result = await ai({
          instructions: `Draft a 3-email outreach sequence for this contact. Follow the outreach-playbook example sequences exactly: Email 1 = cold open with specific observation; Email 2 = new angle (different from Email 1); Email 3 = brief binary CTA. Use brand-voice tone rules and the HTML structure from the outreach-playbook. Each email needs:
- subject (5-120 chars, no ALL CAPS, no excessive punctuation)
- body_html (using only <p>, <b>/<strong>, <i>/<em>, <a href>, <br> — see outreach-playbook)
- angle (one sentence describing the hook for that email)

Contact + company context:
${recordContext}` +
            verificationInstruction(
              "Every subject 5-120 chars, no ALL CAPS, no excessive punctuation (!!!, ???). " +
                "body_html uses ONLY <p>, <b>/<strong>, <i>/<em>, <a href>, <br> tags. " +
                "Tone matches the brand-voice rules above. Email 2's angle is distinct from Email 1's. " +
                "No unverifiable claims, no placeholder tokens like [FIRST_NAME] left unfilled.",
            ),
          context: `# Outreach Playbook\n\n${guidelines["outreach-playbook"]}\n\n---\n\n# Brand Voice\n\n${guidelines["brand-voice"]}\n\n---\n\n# Multichannel Rules\n\n${guidelines["multichannel-rules"]}`,
          outputs: SequenceOutputSchema,
          temperature: 0.6,
          maxTokens: 2500,
        });

        const sequence = result.output;

        // Gate the write on the model's self-check: a rejection throws → caught
        // below → failed++, and no send-email tasks are created for this contact.
        assertApproved(sequence.verification);

        // 3. Schedule the 3 emails as send-email tasks (today, +3 business days, +6).
        const sendDates = [today, addBusinessDays(today, 3), addBusinessDays(today, 6)];
        const emails = [sequence.email1, sequence.email2, sequence.email3];
        const taskIds: string[] = [];

        for (let i = 0; i < 3; i++) {
          const email = emails[i];
          const task = await createTask({
            title: `Send email ${i + 1} to ${contact.first_name ?? contact.email}: ${email.subject.slice(0, 80)}`,
            task_type: "send-email",
            assigned_to: "agent",
            priority: "medium",
            due_date: isoDate(sendDates[i]),
            notes: JSON.stringify({
              step: i + 1,
              angle: email.angle,
              subject: email.subject,
              body_html: email.body_html,
            }),
            custom_key_name: "email",
            custom_key_value: contact.email,
            project: campaignId,
            created_by: "generate.outreach-sequence",
          });
          if (task) taskIds.push(task.task_id);
        }

        // 4. Append a workspace update summarizing the drafted angles.
        await workspace.appendUpdate(
          { email: contact.email },
          {
            author: "generate.outreach-sequence",
            type: "outreach",
            summary: `Drafted 3-email sequence for campaign '${campaignId}'`,
            details: {
              campaign_id: campaignId,
              angles: emails.map((e) => e.angle),
              subjects: emails.map((e) => e.subject),
              task_ids: taskIds,
            },
          },
          "contact",
        );

        if (sample.length < 3) {
          sample.push({
            email: contact.email,
            subjects: emails.map((e) => e.subject),
          });
        }
        drafted++;
      } catch (error) {
        failed++;
        logger.warn("Failed to draft sequence for contact", {
          email: contact.email,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      ok: failed === 0,
      runId: context.runId,
      operation: "generate.outreach-sequence",
      dryRun: context.dryRun,
      status: "live",
      summary: `Drafted ${drafted} of ${candidates.length} sequences (${skipped} skipped, ${failed} failed). Tasks created: ${drafted * 3}.`,
      metrics: {
        records_scanned: candidates.length,
        records_updated: drafted,
        skipped,
        failed,
        sample,
        campaign_id: campaignId,
      },
    };
  },
};
