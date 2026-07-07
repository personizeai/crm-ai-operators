import { z } from "zod";
import { retrieveRecords } from "../../lib/recall.js";
import { setProperty } from "../../lib/persist.js";
import { ai, type Tier } from "../../lib/ai.js";
import { compileFilter, parseFilterInput, type Filter } from "../../lib/filter.js";
import { loadGuideline } from "../../lib/governance.js";
import { logger } from "../../lib/logger.js";
import { evaluateSkipIf } from "../../lib/skip-if.js";
import { workspace } from "../../lib/workspace.js";
import type { OperationEntry } from "../types.js";
import { buildScaffold } from "../helpers.js";

const DEFAULT_FILTER: Filter = {
  collection: "contacts",
  where: { icp_fit_score: { gte: 60 } },
  limit: 30,
};

const ContactResearchSchema = z.object({
  current_title: z.string().optional().describe("Verified current job title"),
  seniority: z.enum(["ic", "manager", "director", "vp", "c-suite", "founder", "unknown"]).optional(),
  function: z.string().optional().describe("e.g. sales, marketing, engineering, operations"),
  communication_style: z.string().max(300).optional().describe("Inferred style: formal/casual, data-driven/story-driven, etc."),
  pain_points: z.array(z.string()).describe("Pain points inferred from public content, talks, posts"),
  recent_moves: z.array(z.object({
    type: z.string().describe("job_change, promotion, company_exit, public_content"),
    summary: z.string(),
    occurred_at: z.string().optional(),
  })).describe("Recent notable moves or signals"),
  source_urls: z.array(z.string()).describe("Sources cited"),
});

type ContactResearch = z.infer<typeof ContactResearchSchema>;

interface ContactRecord {
  email?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  job_title?: string;
  company_domain?: string;
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

async function persistContactResearch(email: string, output: ContactResearch): Promise<void> {
  // current_title/function/communication_style are auto-synced via serverOutputs mapping.
  // Keep manual writes for: computed timestamp, seniority "unknown" guard, pain_points array join.
  if (output.current_title) {
    await setProperty({ type: "contact", email }, "job_title_updated_at", new Date().toISOString());
  }
  if (output.seniority && output.seniority !== "unknown") {
    // Mapping would write "unknown" literally — guard here instead.
    await setProperty({ type: "contact", email }, "seniority", output.seniority);
  }
  if (output.pain_points.length > 0) {
    // pain_points is a string property; join array before writing.
    await setProperty({ type: "contact", email }, "pain_points", output.pain_points.join(" | "));
  }
}

export const researchContactBackground: OperationEntry = {
  name: "research.contact-background",
  mode: "operation",
  description: "Per-contact background research — title history, public content, recent role moves, communication style cues.",
  category: "research",
  status: "live",
  idempotent: true,
  cost: "medium",
  run_mode: "on-trigger",
  guidelines_required: ["account-research"],
  requires: ["subagent"], // autonomous web research — hosted only until gateway subagent lands
  skip_if: { property: "job_title", updated_within: "60d" },
  run: async (input, context) => {
    const filter = parseFilterInput(input) ?? DEFAULT_FILTER;

    const guideline = await loadGuideline("account-research");
    if (!guideline) {
      return buildScaffold(
        "research.contact-background",
        "Cannot research without the account-research guideline. Run setup.apply to install it.",
        context,
        {
          would_read_from: ["personize.context (account-research)", "personize.contacts"],
          would_write_to: ["contacts.job_title", "contacts.communication_style", "contacts.pain_points", "workspace.notes"],
          governance_required: ["account-research"],
          estimated_cost: "medium",
        },
        input,
        ["Run setup.apply to install the account-research guideline before researching."],
      );
    }

    const candidates = await listContacts(filter);
    logger.info("research.contact-background: candidates loaded", { count: candidates.length });

    const skipRule = researchContactBackground.skip_if!;
    let processed = 0;
    let skipped = 0;
    let failed = 0;
    const sample: Array<{ email: string; title?: string; pain_points: number }> = [];

    for (const contact of candidates) {
      const email = contact.email;
      if (!email) { skipped++; continue; }

      const decision = evaluateSkipIf(skipRule, contact as Record<string, unknown>);
      if (decision.skip) { skipped++; continue; }

      if (context.dryRun) {
        logger.info("[DRY RUN] Would research contact", { email });
        processed++;
        continue;
      }

      const displayName =
        [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
        contact.full_name ||
        email;

      try {
        const result = await ai({ autonomous: true,
          instructions: `Research ${displayName} (${email}), who works at ${contact.company_domain ?? "unknown company"} as ${contact.job_title ?? "unknown role"}.
Find their current verified job title, seniority level, job function, and communication style from any public posts or talks.
Look for pain points they have shared publicly in articles, LinkedIn posts, or conference talks.
Note any recent role changes.

Privacy rule: only use publicly available information. Do not attempt to access private profiles.

Account-Research Guideline (privacy section applies):
${guideline.slice(0, 1000)}

Return a JSON object with these exact fields:
- current_title: string (optional, verified title)
- seniority: one of "ic", "manager", "director", "vp", "c-suite", "founder", "unknown" (optional)
- function: string (optional, e.g. sales, marketing, engineering)
- communication_style: string up to 300 chars (optional)
- pain_points: array of strings (pain points from public content)
- recent_moves: array of { type, summary, occurred_at? }
- source_urls: array of strings (sources cited)`,
          outputs: ContactResearchSchema,
          // current_title and function/communication_style are auto-synced to contact properties.
          // seniority excluded: needs "unknown" guard (handled in persistContactResearch).
          // pain_points excluded: array needs join transform before writing (string property).
          serverOutputs: [
            { name: "current_title",       collectionId: "contacts", propertyId: "job_title" },
            { name: "function",            collectionId: "contacts", propertyId: "function" },
            { name: "communication_style", collectionId: "contacts", propertyId: "communication_style" },
          ],
          memorize: { email, type: "Contact" },
          context: `Contact: ${displayName}\nEmail: ${email}\nCurrent title: ${contact.job_title ?? "unknown"}\nCompany: ${contact.company_domain ?? "unknown"}`,
          tier: (context.tierOverride as Tier | undefined) ?? "pro",
          model: context.modelOverride,
          mcpTools: [{ mcpId: "tavily" }],
          metadata: { recordId: email },
        });

        await persistContactResearch(email, result.output);

        const painSummary = result.output.pain_points.slice(0, 3).join(", ");
        await workspace.appendNote(
          { email },
          {
            author: "research.contact-background",
            content: `Research complete. Style: ${result.output.communication_style?.slice(0, 100) ?? "n/a"}. Pain points: ${painSummary || "none found"}.`,
            category: "enrichment",
          },
          "contact",
        );

        if (sample.length < 5) {
          sample.push({ email, title: result.output.current_title, pain_points: result.output.pain_points.length });
        }
        processed++;
      } catch (error) {
        failed++;
        logger.warn("research.contact-background: failed for contact", {
          email,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      ok: failed === 0,
      runId: context.runId,
      operation: "research.contact-background",
      dryRun: context.dryRun,
      status: "live",
      summary: `Researched ${processed} of ${candidates.length} contacts (${skipped} skipped, ${failed} failed).`,
      metrics: { records_scanned: candidates.length, processed, skipped, failed },
      sample,
    };
  },
};
