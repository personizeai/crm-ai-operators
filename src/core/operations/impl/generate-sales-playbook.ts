import { z } from "zod";
import { retrieveRecord } from "../../lib/recall.js";
import { ai } from "../../lib/ai.js";
import { loadGuidelines, missingGuidelines } from "../../lib/governance.js";
import { logger } from "../../lib/logger.js";
import { workspace } from "../../lib/workspace.js";
import { crmWriteback } from "../../lib/crm-writeback.js";
import { applyGuards, DEFAULT_GUARD_CONFIG } from "../../lib/guards.js";
import { PLAYBOOK_SECTIONS, assemblePlaybook } from "../../lib/playbook/sections.js";
import type { CrmId, OperationEntry } from "../types.js";

const REQUIRED_GUIDELINES = ["Sales Playbook Rules", "Brand Voice"];

// One string field per doctrine section, each length-capped to its section's
// max_chars so an overlong model response fails schema validation and gets one
// self-repair retry (see ai.ts finalizeJsonOutput) instead of silently shipping
// an oversized section.
const PlaybookSchema = z.object(
  PLAYBOOK_SECTIONS.reduce<Record<string, z.ZodString>>((shape, s) => {
    shape[s.name] = z.string().max(s.max_chars);
    return shape;
  }, {}),
);

interface ContactRecord {
  email?: string;
  job_title?: string;
  company_domain?: string;
  buying_stage?: string;
  last_signal?: string;
  next_best_action?: string;
  pain_points?: string[];
  interests?: string[];
  context?: string;
  /** CRM object id — drives the CRM writeback path (mirrorPlaybookToCrm). */
  crm_record_id?: string;
  [key: string]: unknown;
}

async function getContact(email: string): Promise<ContactRecord | null> {
  return (await retrieveRecord({ email, type: "contact" })) as ContactRecord | null;
}

// Mirrors score-icp-fit.ts's mirrorScoreToCrm: writeback failures are logged and
// swallowed so a CRM hiccup can't fail an otherwise-successful playbook generation.
// playbook_full carries the composed body (longtext); playbook_status is the only
// short (text) field — per-section bodies also land in their own longtext fields.
async function mirrorPlaybookToCrm(
  full: string,
  properties: Record<string, string>,
  crmRecordId?: string,
  crm?: CrmId,
): Promise<boolean> {
  try {
    return await crmWriteback(
      { crm, type: "contact", crmRecordId },
      { playbook_status: "generated", playbook_full: full, ...properties },
    );
  } catch (error) {
    logger.warn("Failed to mirror sales playbook to CRM", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export const generateSalesPlaybook: OperationEntry = {
  name: "generate.sales-playbook",
  mode: "operation",
  description: "Generate a rep-facing pre-call sales playbook (five doctrine sections) for a contact; write the composed body and per-section properties to CRM.",
  category: "generate",
  status: "live",
  idempotent: false,
  cost: "medium",
  run_mode: "on-decision",
  guidelines_required: REQUIRED_GUIDELINES,
  run: async (input, context) => {
    const email = (input as { email?: string } | undefined)?.email;
    if (!email) {
      return {
        ok: false,
        runId: context.runId,
        operation: "generate.sales-playbook",
        dryRun: context.dryRun,
        summary: "email is required. Pass it as input: { email: 'name@company.com' }",
      };
    }

    const contact = await getContact(email);
    if (!contact) {
      return {
        ok: false,
        runId: context.runId,
        operation: "generate.sales-playbook",
        dryRun: context.dryRun,
        summary: `Contact not found in Personize: ${email}. Run crm.sync-core first.`,
      };
    }

    const guidelines = await loadGuidelines(REQUIRED_GUIDELINES);
    const missing = missingGuidelines(guidelines);
    if (missing.length > 0) {
      return {
        ok: false,
        runId: context.runId,
        operation: "generate.sales-playbook",
        dryRun: context.dryRun,
        summary: `Missing required guidelines: ${missing.join(", ")}. Run setup.apply first.`,
        metrics: { missing_guidelines: missing },
      };
    }

    if (context.dryRun) {
      logger.info("[DRY RUN] Would generate sales playbook", { email });
      return {
        ok: true,
        runId: context.runId,
        operation: "generate.sales-playbook",
        dryRun: true,
        status: "live",
        summary: `[DRY RUN] Would generate sales playbook for ${email}.`,
      };
    }

    // Contact-level grounding only — this operation resolves a single contact by
    // email (no secondary company/signal fetch). Fields are the real flattened
    // contacts-collection properties (see manifests/core/collections/contacts.json):
    // there is no `company` (name) or `industry` field on contacts — those live on
    // the companies collection, keyed by `company_domain`, which this operation
    // does not join. `recent_news` does not exist anywhere; the nearest real
    // signal-bearing fields are used instead.
    const contactContext = JSON.stringify(
      {
        company_domain: contact.company_domain,
        job_title: contact.job_title,
        buying_stage: contact.buying_stage,
        last_signal: contact.last_signal,
        next_best_action: contact.next_best_action,
        pain_points: contact.pain_points,
        interests: contact.interests,
        context: contact.context,
      },
      null,
      2,
    );

    const guidanceLines = PLAYBOOK_SECTIONS.map(
      (s) => `${s.name} (max ${s.max_chars} chars): ${s.guidance}`,
    ).join("\n");

    const result = await ai({
      instructions: `Write each sales playbook section for a rep preparing to call ${contact.company_domain ?? email}. Return one string per section key, grounded only in the facts below — no invention. Sections:\n${guidanceLines}`,
      context: `${Object.values(guidelines).join("\n\n")}\n\n---\n\nContact + account facts:\n${contactContext}`,
      outputs: PlaybookSchema,
      temperature: 0.3,
      maxTokens: 1200,
    });

    const guardCfg = { ...DEFAULT_GUARD_CONFIG, mode: "enforce" as const };
    const guarded: Record<string, string> = {};
    let fires = 0;
    for (const s of PLAYBOOK_SECTIONS) {
      const g = applyGuards((result.output as Record<string, string>)[s.name] ?? "", guardCfg, {
        ownershipConfirmed: false,
      });
      guarded[s.name] = g.text;
      fires += g.fires.length;
    }
    const { full, properties } = assemblePlaybook(guarded);

    await workspace.appendUpdate(
      { email },
      {
        author: "generate.sales-playbook",
        type: "action",
        summary: "Generated sales playbook",
        details: { full },
      },
      "contact",
    );

    const wrote = await mirrorPlaybookToCrm(full, properties, contact.crm_record_id, context.crm);

    return {
      ok: true,
      runId: context.runId,
      operation: "generate.sales-playbook",
      dryRun: context.dryRun,
      status: "live",
      summary: `Sales playbook generated for ${email}${wrote ? ", written to CRM" : ""}.`,
      metrics: { guard_fires: fires, crm_written: wrote },
    };
  },
};
