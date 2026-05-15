import { z } from "zod";
import { client } from "../../config.js";
import { aiPrompt } from "../../lib/ai.js";
import { loadGuidelines, missingGuidelines } from "../../lib/governance.js";
import { logger } from "../../lib/logger.js";
import { createTask } from "../../lib/tasks.js";
import { todayIso } from "../../lib/dates.js";
import { workspace } from "../../lib/workspace.js";
import type { OperationEntry } from "../types.js";

// Deal data arrives in Personize via native CRM sync or Zapier.
// This operation reads everything from Personize — no CRM passthrough needed.

const REQUIRED_GUIDELINES = ["brand-voice", "competitor-policy"];

const ProposalOutputSchema = z.object({
  exec_summary: z.string().min(40).max(600),
  situation: z.string().min(40).max(600),
  proposed_solution: z.string().min(40).max(800),
  scope: z.string().min(20).max(500),
  pricing_narrative: z.string().min(20).max(400),
  timeline: z.string().min(20).max(300),
  risks: z.array(z.string().max(200)).max(5),
  next_steps: z.array(z.string().max(200)).min(1).max(5),
});

interface DealInput {
  contact_email?: string;
  company_domain?: string;
  deal?: {
    amount?: number;
    currency?: string;
    products?: string[];
    close_date?: string;
    stage?: string;
    deal_name?: string;
    notes?: string;
  };
}

async function getContact(email: string): Promise<Record<string, unknown> | null> {
  const memory = (client as any).memory;
  if (!memory?.retrieve) return null;
  try {
    const result = await memory.retrieve({ email, type: "contact" });
    return (result?.data ?? null) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

async function getCompany(domain: string): Promise<Record<string, unknown> | null> {
  const memory = (client as any).memory;
  if (!memory?.retrieve) return null;
  try {
    const result = await memory.retrieve({ website_url: domain, type: "company" });
    return (result?.data ?? null) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

async function getStakeholders(domain: string): Promise<unknown[]> {
  const memory = (client as any).memory;
  if (!memory?.filterByProperty) return [];
  try {
    const response = await memory.filterByProperty({
      type: "contact",
      conditions: [{ propertyName: "company_domain", operator: "equals", value: domain }],
      logic: "AND",
      limit: 10,
    });
    return (response?.data ?? response?.records ?? []) as unknown[];
  } catch {
    return [];
  }
}

async function getRecentConversations(email: string): Promise<unknown[]> {
  const memory = (client as any).memory;
  if (!memory?.filterByProperty) return [];
  try {
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const response = await memory.filterByProperty({
      type: "conversation",
      conditions: [
        { propertyName: "contact_email", operator: "equals", value: email },
        { propertyName: "sent_at", operator: "gte", value: since },
      ],
      logic: "AND",
      limit: 10,
    });
    return (response?.data ?? response?.records ?? []) as unknown[];
  } catch {
    return [];
  }
}

export const generateProposal: OperationEntry = {
  name: "generate.proposal",
  mode: "operation",
  description: "Draft a proposal from deal data + Personize memory. Reads everything from Personize (deal data synced natively from CRM). Always returns a Markdown draft for human review.",
  category: "generate",
  status: "live",
  idempotent: false,
  cost: "high",
  run_mode: "manual",
  guidelines_required: REQUIRED_GUIDELINES,
  run: async (input, context) => {
    const inputObj = (input ?? {}) as DealInput;
    const contactEmail = inputObj.contact_email;
    const companyDomain = inputObj.company_domain;
    const deal = inputObj.deal ?? {};

    if (!contactEmail && !companyDomain) {
      return {
        ok: false,
        runId: context.runId,
        operation: "generate.proposal",
        dryRun: context.dryRun,
        summary: "Provide at least one of: contact_email (the champion) or company_domain. Optionally include deal: { amount, products, close_date, stage }.",
      };
    }

    const guidelines = await loadGuidelines(REQUIRED_GUIDELINES);
    const missing = missingGuidelines(guidelines);
    if (missing.length > 0) {
      return {
        ok: false,
        runId: context.runId,
        operation: "generate.proposal",
        dryRun: context.dryRun,
        summary: `Missing required guidelines: ${missing.join(", ")}. Run setup.apply first.`,
        metrics: { missing_guidelines: missing },
      };
    }

    // Load all context from Personize
    const [contact, conversations] = await Promise.all([
      contactEmail ? getContact(contactEmail) : Promise.resolve(null),
      contactEmail ? getRecentConversations(contactEmail) : Promise.resolve([]),
    ]);

    const domain = companyDomain ?? (contact?.company_domain as string | undefined);
    const [company, stakeholders] = await Promise.all([
      domain ? getCompany(domain) : Promise.resolve(null),
      domain ? getStakeholders(domain) : Promise.resolve([]),
    ]);

    if (!company && !contact) {
      return {
        ok: false,
        runId: context.runId,
        operation: "generate.proposal",
        dryRun: context.dryRun,
        summary: "No contact or company found in Personize. Run crm.sync-core first.",
      };
    }

    if (context.dryRun) {
      logger.info("[DRY RUN] Would generate proposal", { contactEmail, domain });
      return {
        ok: true,
        runId: context.runId,
        operation: "generate.proposal",
        dryRun: true,
        status: "live",
        summary: `[DRY RUN] Would generate proposal for ${domain ?? contactEmail} with ${conversations.length} conversations and ${stakeholders.length} stakeholders as context.`,
      };
    }

    const proposalContext = JSON.stringify({
      deal: {
        name: deal.deal_name,
        amount: deal.amount,
        currency: deal.currency ?? "USD",
        products: deal.products,
        close_date: deal.close_date,
        stage: deal.stage,
        notes: deal.notes,
      },
      champion: contact,
      company,
      stakeholders: stakeholders.slice(0, 5),
      recent_conversations: conversations.slice(0, 8),
    }, null, 2);

    const result = await aiPrompt({
      instructions: `Draft a professional proposal for this deal. Use only facts from the provided context — do not invent case studies, statistics, or testimonials. This is always a DRAFT for human review.

Required output:
- exec_summary: 2-3 sentences — the essential "why us, why now"
- situation: what's happening at their company that makes this relevant
- proposed_solution: what we're offering and why it fits their situation specifically
- scope: what's included (and what's explicitly out of scope)
- pricing_narrative: how pricing works in plain language (not a table — that's for the human to add)
- timeline: proposed milestones and realistic delivery
- risks: 1-5 risks to flag for the human reviewer
- next_steps: 1-5 concrete actions after they receive this

Deal + company + contact context:
${proposalContext}`,
      context: `# Brand Voice\n\n${guidelines["brand-voice"]}\n\n---\n\n# Competitor Policy\n\n${guidelines["competitor-policy"]}`,
      outputs: ProposalOutputSchema,
      temperature: 0.4,
      maxTokens: 2000,
    });

    const p = result.output;
    const companyName = (company?.company_name as string | undefined) ?? domain ?? "the account";

    const proposalMarkdown = [
      `# Proposal — ${deal.deal_name ?? companyName}`,
      `**Stage:** ${deal.stage ?? "TBD"}  |  **Close Date:** ${deal.close_date ?? "TBD"}  |  **Draft Generated:** ${todayIso()}`,
      `> ⚠️ This is an AI-generated DRAFT. Review and edit before sending.`,
      "",
      `## Executive Summary`,
      p.exec_summary,
      "",
      `## Situation`,
      p.situation,
      "",
      `## Proposed Solution`,
      p.proposed_solution,
      "",
      `## Scope`,
      p.scope,
      "",
      `## Pricing`,
      p.pricing_narrative,
      "",
      `## Timeline`,
      p.timeline,
      "",
      ...(p.risks.length > 0 ? [`## Risks (for reviewer)`, ...p.risks.map((r) => `- ⚠️ ${r}`), ""] : []),
      `## Next Steps`,
      ...p.next_steps.map((s, i) => `${i + 1}. ${s}`),
    ].join("\n");

    // Create a review task for the deal owner
    await createTask({
      title: `Review proposal draft — ${companyName}`,
      task_type: "review",
      assigned_to: "rep",
      priority: "high",
      due_date: todayIso(),
      notes: proposalMarkdown,
      ...(domain ? { custom_key_name: "website_url" as const, custom_key_value: domain } : {}),
      ...(contactEmail && !domain ? { custom_key_name: "email" as const, custom_key_value: contactEmail } : {}),
      created_by: "generate.proposal",
    });

    const identifier = domain ? { website_url: domain } : { email: contactEmail! };
    const entityType = domain ? "company" : "contact";

    await workspace.appendUpdate(
      identifier,
      {
        author: "generate.proposal",
        type: "action",
        summary: `Proposal draft generated — ${deal.stage ?? "stage TBD"}`,
        details: { deal_name: deal.deal_name, stage: deal.stage, amount: deal.amount, close_date: deal.close_date },
      },
      entityType,
    );

    return {
      ok: true,
      runId: context.runId,
      operation: "generate.proposal",
      dryRun: context.dryRun,
      status: "live",
      summary: `Proposal draft generated for ${companyName} using ${conversations.length} conversations and ${stakeholders.length} stakeholders. Review task created.`,
      metrics: {
        company: companyName,
        conversations_used: conversations.length,
        stakeholders_used: stakeholders.length,
        proposal: proposalMarkdown,
      },
    };
  },
};
