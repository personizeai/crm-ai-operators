import { z } from "zod";
import { retrieveRecord } from "../../lib/recall.js";
import { ai } from "../../lib/ai.js";
import { loadGuideline, loadGuidelines, missingGuidelines } from "../../lib/governance.js";
import { logger } from "../../lib/logger.js";
import { workspace } from "../../lib/workspace.js";
import { setProperties } from "../../lib/persist.js";
import { crmWriteback } from "../../lib/crm-writeback.js";
import { applyGuards, DEFAULT_GUARD_CONFIG } from "../../lib/guards.js";
import { validateZoneSchema, type ZoneSchema } from "../../lib/zones/schema.js";
import { generateZones } from "../../lib/zones/generate.js";
import { parseStaticZones } from "../../lib/zones/static.js";
import { mapZonesToProperties } from "../../lib/zones/properties.js";
import type { ZoneResult } from "../../lib/zones/postprocess.js";
import type { LeadContext } from "../../lib/zones/prompt.js";
import type { CrmId, OperationEntry } from "../types.js";

const REQUIRED_GUIDELINES = ["Landing Page Rules", "Brand Voice"];

// ai() always returns JSON validated against a Zod object schema (see ai.ts's
// buildPrompt, which wraps every single-prompt call with a "return this JSON
// shape" directive). buildZonePrompt already writes its own complete plain
// text contract (one paragraph, no markdown, at most max_chars), so this
// one-field wrapper is only the adapter that lets that freeform prompt travel
// through ai()'s JSON-only contract. Length clamping and fallback still belong
// to zone-core's processZoneOutput (invoked inside generateZones), not here.
const ZoneTextSchema = z.object({ value: z.string() });

interface ContactRecord {
  email?: string;
  job_title?: string;
  company_domain?: string;
  buying_stage?: string;
  last_signal?: string;
  pain_points?: string[];
  interests?: string[];
  /** CRM object id, drives the CRM writeback path (mirrorZonesToCrm). */
  crm_record_id?: string;
  [key: string]: unknown;
}

async function getContact(email: string): Promise<ContactRecord | null> {
  return (await retrieveRecord({ email, type: "contact" })) as ContactRecord | null;
}

// Mirrors score-icp-fit.ts's mirrorScoreToCrm and generate-sales-playbook.ts's
// mirrorPlaybookToCrm: writeback failures are logged and swallowed so a CRM
// hiccup can't fail an otherwise-successful zone generation. Called only after
// a successful memory write (see run()), so the CRM record can never be ahead
// of Personize memory, the source of truth, for a landing zone.
async function mirrorZonesToCrm(
  properties: Record<string, string>,
  crmRecordId?: string,
  crm?: CrmId,
): Promise<boolean> {
  try {
    return await crmWriteback(
      { crm, type: "contact", crmRecordId },
      { ...properties, zone_status: "generated" },
    );
  } catch (error) {
    logger.warn("Failed to mirror landing zones to CRM", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

// Personize memory is the source of truth, per crm-writeback.ts's own header
// comment. Unlike generate-sales-playbook.ts's writePlaybookToMemory (whose
// CRM mirror still runs even when this write fails), a failure here
// short-circuits run() before mirrorZonesToCrm is ever called, per the Task 5
// plan: the CRM must never receive zone content that Personize memory itself
// failed to keep.
async function writeZonesToMemory(
  email: string,
  properties: Record<string, string>,
): Promise<boolean> {
  try {
    return await setProperties(
      { email, type: "contact" },
      { ...properties, zone_status: "generated" },
    );
  } catch (error) {
    logger.warn("Failed to write landing zones to Personize memory", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export const generateLandingZones: OperationEntry = {
  name: "generate.landing-zones",
  mode: "operation",
  description: "Generate personalized or standardized landing-page zones for a contact from a campaign zone schema; write zone_status and per-zone properties to CRM.",
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
        operation: "generate.landing-zones",
        dryRun: context.dryRun,
        summary: "email is required. Pass it as input: { email: 'name@company.com' }",
      };
    }

    const contact = await getContact(email);
    if (!contact) {
      return {
        ok: false,
        runId: context.runId,
        operation: "generate.landing-zones",
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
        operation: "generate.landing-zones",
        dryRun: context.dryRun,
        summary: `Missing required guidelines: ${missing.join(", ")}. Run setup.apply first.`,
        metrics: { missing_guidelines: missing },
      };
    }

    // The campaign's zone schema is its own guideline (a JSON body), loaded and
    // validated separately from guidelines_required above so a parse or shape
    // failure gets a specific error instead of a generic "missing" one.
    const schemaBody = await loadGuideline("Landing Zone Schema");
    let schema: ZoneSchema;
    try {
      schema = JSON.parse(schemaBody) as ZoneSchema;
    } catch {
      return {
        ok: false,
        runId: context.runId,
        operation: "generate.landing-zones",
        dryRun: context.dryRun,
        summary: "Landing Zone Schema guideline is missing or not valid JSON. Run setup.apply first.",
      };
    }
    const schemaErrors = validateZoneSchema(schema);
    if (schemaErrors.length > 0) {
      return {
        ok: false,
        runId: context.runId,
        operation: "generate.landing-zones",
        dryRun: context.dryRun,
        summary: `Invalid Landing Zone Schema guideline: ${schemaErrors.join("; ")}`,
        metrics: { schema_errors: schemaErrors },
      };
    }

    if (context.dryRun) {
      logger.info("[DRY RUN] Would generate landing zones", { email, zones: schema.zones.length });
      return {
        ok: true,
        runId: context.runId,
        operation: "generate.landing-zones",
        dryRun: true,
        status: "live",
        summary: `[DRY RUN] Would generate ${schema.zones.length} landing zones for ${email}.`,
      };
    }

    // Contact-level grounding only, the same scope as generate-sales-playbook.ts:
    // a single retrieveRecord by email, no secondary company join. There is no
    // `company` (name) or `industry` field on contacts; those live on the
    // companies collection, keyed by company_domain, which this operation does
    // not join. There is no `recent_news` field anywhere either, so the nearest
    // real signal-bearing fields (pain_points, interests, last_signal) stand in
    // for researched_facts.
    const lead: LeadContext = {
      company: contact.company_domain ?? email,
      title: contact.job_title,
      researched_facts: [
        ...(Array.isArray(contact.pain_points) ? contact.pain_points : []),
        ...(Array.isArray(contact.interests) ? contact.interests : []),
        ...(contact.last_signal ? [contact.last_signal] : []),
      ],
      // buying_stage is a real contacts.json enum whose values include
      // "Customer", the grounded signal buildZonePrompt reads through
      // confirmed_customer. Every other stage (including unknown) defaults to
      // false, the safe "not a confirmed customer" framing.
      confirmed_customer: contact.buying_stage === "Customer",
    };

    // schema.generation_mode selects the zone-core path: "standard" reads
    // dashboard-editable copy from a guideline with no AI call (static.ts);
    // anything else, including unset, generates with AI (generate.ts).
    let zoneResults: Record<string, ZoneResult>;
    if (schema.generation_mode === "standard") {
      const copyBody = await loadGuideline("Landing Zone Copy");
      zoneResults = parseStaticZones(copyBody, schema);
    } else {
      const out = await generateZones(schema, guidelines, lead, {
        // buildZonePrompt (called inside generateZones) already composes a
        // complete prompt from the guidelines, lead facts, zone guidance, and
        // hard constraints, so no separate `context` is passed here; adding
        // one would just duplicate the same guideline text a second time.
        generate: async (prompt: string) => {
          const result = await ai({ instructions: prompt, outputs: ZoneTextSchema, temperature: 0.3 });
          return result.output.value;
        },
      });
      zoneResults = out.results;
    }

    const guardCfg = { ...DEFAULT_GUARD_CONFIG, mode: "enforce" as const };
    let fires = 0;
    for (const [name, result] of Object.entries(zoneResults)) {
      const g = applyGuards(result.text, guardCfg, { ownershipConfirmed: lead.confirmed_customer === true });
      zoneResults[name] = { ...result, text: g.text };
      fires += g.fires.length;
    }
    const properties = mapZonesToProperties(zoneResults, { prefix: "zone_" });

    // Memory first (source of truth), then CRM mirror. A memory-write failure
    // short-circuits here, before workspace.appendUpdate or mirrorZonesToCrm
    // run; see writeZonesToMemory's own comment for why this differs from
    // generate-sales-playbook.ts.
    const memoryWritten = await writeZonesToMemory(email, properties);
    if (!memoryWritten) {
      return {
        ok: false,
        runId: context.runId,
        operation: "generate.landing-zones",
        dryRun: context.dryRun,
        summary: `Landing zones generated for ${email}, but failed to write to Personize memory.`,
      };
    }

    await workspace.appendUpdate(
      { email },
      {
        author: "generate.landing-zones",
        type: "action",
        summary: `Generated ${Object.keys(properties).length} landing zones`,
        details: { properties },
      },
      "contact",
    );

    const wrote = await mirrorZonesToCrm(properties, contact.crm_record_id, context.crm);

    return {
      ok: true,
      runId: context.runId,
      operation: "generate.landing-zones",
      dryRun: context.dryRun,
      status: "live",
      summary: `Landing zones generated for ${email}${wrote ? ", written to CRM" : ""}.`,
      metrics: { zones: Object.keys(properties).length, guard_fires: fires, crm_written: wrote },
    };
  },
};
