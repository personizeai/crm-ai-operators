import { z } from "zod";
import { client } from "../../config.js";
import { aiPrompt } from "../../lib/ai.js";
import { compileFilter, parseFilterInput, type Filter } from "../../lib/filter.js";
import { loadGuidelines, missingGuidelines } from "../../lib/governance.js";
import { logger } from "../../lib/logger.js";
import { evaluateSkipIf } from "../../lib/skip-if.js";
import { workspace } from "../../lib/workspace.js";
import type { OperationEntry } from "../types.js";

const DEFAULT_FILTER: Filter = {
  collection: "contacts",
  where: { lifecycle_stage: { neq: "Customer" } },
  limit: 40,
};

const REQUIRED_GUIDELINES = ["signal-definitions"];

const StageOutputSchema = z.object({
  buying_stage: z.enum([
    "Unaware",
    "Problem Aware",
    "Solution Aware",
    "Vendor Evaluating",
    "Decision",
    "Customer",
    "Disqualified",
  ]),
  confidence: z.enum(["low", "medium", "high"]),
  evidence_summary: z.string().min(20).max(400),
  next_best_action: z.string().min(10).max(300),
});

interface ContactRecord {
  email: string;
  first_name?: string;
  buying_stage?: string;
  buying_stage_updated_at?: string;
  lifecycle_stage?: string;
  ai_score?: number;
  [key: string]: unknown;
}

async function listContacts(filter: Filter): Promise<ContactRecord[]> {
  const compiled = compileFilter(filter);
  const memory = (client as any).memory;
  if (!memory?.filterByProperty) {
    logger.warn("Personize SDK has no memory.filterByProperty; cannot list contacts");
    return [];
  }
  const response = await memory.filterByProperty({
    type: "contact",
    conditions: compiled.conditions,
    logic: compiled.logic,
    limit: compiled.limit,
  });
  return (response?.data ?? response?.records ?? []) as ContactRecord[];
}

async function getRecentActivity(email: string): Promise<{ conversations: unknown[]; signals: unknown[] }> {
  const memory = (client as any).memory;
  if (!memory?.filterByProperty) return { conversations: [], signals: [] };

  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const emailCondition = { propertyName: "contact_email", operator: "equals", value: email };
  const sinceCondition = { propertyName: "observed_at", operator: "gte", value: since };
  const sentSinceCondition = { propertyName: "sent_at", operator: "gte", value: since };

  const [convResponse, sigResponse] = await Promise.allSettled([
    memory.filterByProperty({
      type: "conversation",
      conditions: [emailCondition, sentSinceCondition],
      logic: "AND",
      limit: 20,
    }),
    memory.filterByProperty({
      type: "signal",
      conditions: [emailCondition, sinceCondition],
      logic: "AND",
      limit: 10,
    }),
  ]);

  return {
    conversations: convResponse.status === "fulfilled"
      ? ((convResponse.value?.data ?? convResponse.value?.records ?? []) as unknown[])
      : [],
    signals: sigResponse.status === "fulfilled"
      ? ((sigResponse.value?.data ?? sigResponse.value?.records ?? []) as unknown[])
      : [],
  };
}

export const analyzeBuyingStage: OperationEntry = {
  name: "analyze.buying-stage",
  mode: "operation",
  description: "Infer a contact's buying stage from recent conversations + signals. Updates buying_stage + next_best_action.",
  category: "analyze",
  status: "live",
  idempotent: true,
  cost: "medium",
  run_mode: "on-trigger",
  guidelines_required: REQUIRED_GUIDELINES,
  skip_if: { property: "buying_stage", updated_within: "14d" },
  run: async (input, context) => {
    const filter = parseFilterInput(input) ?? DEFAULT_FILTER;

    const guidelines = await loadGuidelines(REQUIRED_GUIDELINES);
    const missing = missingGuidelines(guidelines);
    if (missing.length > 0) {
      return {
        ok: false,
        runId: context.runId,
        operation: "analyze.buying-stage",
        dryRun: context.dryRun,
        summary: `Missing required guidelines: ${missing.join(", ")}. Run setup.apply first.`,
        metrics: { missing_guidelines: missing },
      };
    }

    const contacts = await listContacts(filter);
    logger.info("analyze.buying-stage: contacts loaded", { count: contacts.length });

    const skipRule = analyzeBuyingStage.skip_if!;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const contact of contacts) {
      if (!contact.email) { skipped++; continue; }

      const decision = evaluateSkipIf(skipRule, contact as Record<string, unknown>);
      if (decision.skip) { skipped++; continue; }

      const { conversations, signals } = await getRecentActivity(contact.email);

      if (conversations.length === 0 && signals.length === 0) {
        skipped++;
        continue;
      }

      const recordContext = JSON.stringify({
        contact: {
          email: contact.email,
          first_name: contact.first_name,
          current_buying_stage: contact.buying_stage ?? "Unknown",
          lifecycle_stage: contact.lifecycle_stage,
          ai_score: contact.ai_score,
        },
        recent_conversations: conversations.slice(0, 10),
        recent_signals: signals.slice(0, 5),
      }, null, 2);

      try {
        if (context.dryRun) {
          logger.info("[DRY RUN] Would infer buying stage", { email: contact.email });
          updated++;
          continue;
        }

        const result = await aiPrompt({
          instructions: `Infer the buying stage for this contact from their recent conversations and signals. Choose the single most accurate stage. Base your answer only on evidence in the data — do not guess.

Contact + engagement context:
${recordContext}`,
          context: `# Signal Definitions\n\n${guidelines["signal-definitions"]}`,
          outputs: StageOutputSchema,
          temperature: 0.2,
          maxTokens: 400,
        });

        const memory = (client as any).memory;
        if (memory?.updateProperty) {
          const now = new Date().toISOString();
          for (const [propertyName, value] of Object.entries({
            buying_stage: result.output.buying_stage,
            next_best_action: result.output.next_best_action,
            buying_stage_updated_at: now,
          })) {
            await memory.updateProperty({ email: contact.email, type: "contact", propertyName, operation: "set", value });
          }
        }

        await workspace.appendUpdate(
          { email: contact.email },
          {
            author: "analyze.buying-stage",
            type: "change",
            summary: `Buying stage: ${result.output.buying_stage} (${result.output.confidence} confidence)`,
            details: {
              previous: contact.buying_stage ?? null,
              buying_stage: result.output.buying_stage,
              confidence: result.output.confidence,
              evidence_summary: result.output.evidence_summary,
              next_best_action: result.output.next_best_action,
            },
          },
          "contact",
        );
        updated++;
      } catch (error) {
        failed++;
        logger.warn("Failed to infer buying stage", {
          email: contact.email,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      ok: failed === 0,
      runId: context.runId,
      operation: "analyze.buying-stage",
      dryRun: context.dryRun,
      status: "live",
      summary: `Updated buying stage for ${updated} of ${contacts.length} contacts (${skipped} skipped, ${failed} failed).`,
      metrics: { records_scanned: contacts.length, records_updated: updated, skipped, failed },
    };
  },
};
