import { z } from "zod";
import { randomUUID } from "node:crypto";
import { retrieveRecords } from "../../lib/recall.js";
import { setProperties, setProperty, appendToProperty } from "../../lib/persist.js";
import { aiPrompt } from "../../lib/ai.js";
import { loadGuidelines, missingGuidelines } from "../../lib/governance.js";
import { logger } from "../../lib/logger.js";
import { createTask } from "../../lib/tasks.js";
import { todayIso } from "../../lib/dates.js";
import { workspace } from "../../lib/workspace.js";
import type { OperationEntry } from "../types.js";

// Engagements arrive in Personize automatically via the native CRM sync and Zapier.
// This operation enriches them: extracts insights, updates contact properties,
// surfaces buying signals, and creates action tasks. No CRM API calls needed.

const REQUIRED_GUIDELINES = ["data-hygiene", "signal-definitions"];

const InsightSchema = z.object({
  key_topics: z.array(z.string().max(100)).max(8),
  sentiment: z.enum(["positive", "neutral", "negative", "mixed"]),
  buying_signals: z.array(z.string().max(200)).max(5),
  action_items: z.array(z.string().max(200)).max(5),
  next_steps: z.array(z.string().max(200)).max(3),
  action_required: z.boolean(),
  urgency: z.enum(["low", "medium", "high"]).optional(),
});

interface ConversationRecord {
  conversation_id?: string;
  contact_email?: string;
  type?: string;
  direction?: string;
  subject?: string;
  body?: string;
  body_preview?: string;
  sent_at?: string;
  summary?: string;
  processed_by?: string[];
  [key: string]: unknown;
}

const PROCESSABLE_TYPES = new Set(["email", "call", "meeting", "note"]);
const PROCESSOR_TAG = "sync.pull-engagements";

async function getUnprocessedEngagements(): Promise<ConversationRecord[]> {
  // Pull recent conversations — filter to unprocessed in-code
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const all = (await retrieveRecords({
    type: "conversation",
    conditions: [{ propertyName: "sent_at", operator: "gte", value: since }],
    logic: "AND",
    limit: 100,
  })) as ConversationRecord[];
  return all.filter((c) => {
    if (!PROCESSABLE_TYPES.has(c.type ?? "")) return false;
    const processed = Array.isArray(c.processed_by) ? c.processed_by : [];
    return !processed.includes(PROCESSOR_TAG);
  });
}

async function appendBuyingSignal(contactEmail: string, signal: string, conversationId: string): Promise<void> {
  const signalId = `sig_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const properties = {
    record_id: signalId,
    signal_type: "engagement-signal",
    severity: "medium",
    source: PROCESSOR_TAG,
    contact_email: contactEmail,
    observed_at: new Date().toISOString(),
    title: signal.slice(0, 120),
    description: signal,
    raw_data: JSON.stringify({ conversation_id: conversationId }),
  };
  try {
    await setProperties({ type: "signal", collection: "signals", recordId: signalId }, properties);
  } catch {
    // Non-fatal
  }
}

async function markProcessed(conversationId: string, summary: string): Promise<void> {
  try {
    await setProperty({ type: "conversation", recordId: conversationId }, "summary", summary);
    await appendToProperty({ type: "conversation", recordId: conversationId }, "processed_by", PROCESSOR_TAG);
  } catch {
    // Non-fatal
  }
}

export const syncPullEngagements: OperationEntry = {
  name: "sync.pull-engagements",
  mode: "operation",
  description: "Process engagements already in Personize (synced natively from CRM or via Zapier). Extracts insights, surfaces buying signals, creates action tasks, updates contact workspace.",
  category: "sync",
  status: "live",
  idempotent: true,
  cost: "medium",
  run_mode: "on-trigger",
  guidelines_required: REQUIRED_GUIDELINES,
  run: async (input, context) => {
    const guidelines = await loadGuidelines(REQUIRED_GUIDELINES);
    const missing = missingGuidelines(guidelines);
    if (missing.length > 0) {
      return {
        ok: false,
        runId: context.runId,
        operation: "sync.pull-engagements",
        dryRun: context.dryRun,
        summary: `Missing required guidelines: ${missing.join(", ")}. Run setup.apply first.`,
        metrics: { missing_guidelines: missing },
      };
    }

    const engagements = await getUnprocessedEngagements();
    logger.info("sync.pull-engagements: unprocessed engagements loaded", { count: engagements.length });

    if (engagements.length === 0) {
      return {
        ok: true,
        runId: context.runId,
        operation: "sync.pull-engagements",
        dryRun: context.dryRun,
        status: "live",
        summary: "No unprocessed engagements found in the last 30 days.",
        metrics: { records_scanned: 0, records_updated: 0 },
      };
    }

    let processed = 0;
    let failed = 0;
    let signalsCreated = 0;
    let tasksCreated = 0;

    for (const engagement of engagements) {
      if (!engagement.contact_email || !engagement.conversation_id) { failed++; continue; }

      const content = engagement.body ?? engagement.body_preview ?? engagement.summary ?? "(no content)";

      try {
        if (context.dryRun) {
          logger.info("[DRY RUN] Would process engagement", { email: engagement.contact_email, type: engagement.type });
          processed++;
          continue;
        }

        const result = await aiPrompt({
          instructions: `Extract structured insights from this ${engagement.type ?? "conversation"} engagement.

Subject: ${engagement.subject ?? "(none)"}
Type: ${engagement.type}
Direction: ${engagement.direction ?? "unknown"}
Date: ${engagement.sent_at ?? "unknown"}

Content:
${content.slice(0, 3000)}`,
          context: `# Data Hygiene\n\n${guidelines["data-hygiene"]}\n\n---\n\n# Signal Definitions\n\n${guidelines["signal-definitions"]}`,
          outputs: InsightSchema,
          temperature: 0.2,
          maxTokens: 600,
        });

        const insight = result.output;

        // Append buying signals to signals collection
        for (const signal of insight.buying_signals) {
          await appendBuyingSignal(engagement.contact_email, signal, engagement.conversation_id);
          signalsCreated++;
        }

        // Create task if action required
        if (insight.action_required && insight.next_steps.length > 0) {
          await createTask({
            title: `Follow up: ${engagement.contact_email} — ${insight.next_steps[0]!.slice(0, 120)}`,
            task_type: "follow-up",
            assigned_to: "agent",
            priority: insight.urgency === "high" ? "high" : "medium",
            due_date: todayIso(),
            notes: JSON.stringify({ key_topics: insight.key_topics, next_steps: insight.next_steps, action_items: insight.action_items }),
            custom_key_name: "email",
            custom_key_value: engagement.contact_email,
            created_by: PROCESSOR_TAG,
          });
          tasksCreated++;
        }

        await workspace.appendUpdate(
          { email: engagement.contact_email },
          {
            author: PROCESSOR_TAG,
            type: "engagement",
            summary: `${engagement.type} processed — sentiment: ${insight.sentiment}, ${insight.buying_signals.length} buying signals`,
            details: {
              conversation_id: engagement.conversation_id,
              type: engagement.type,
              key_topics: insight.key_topics,
              sentiment: insight.sentiment,
              buying_signals: insight.buying_signals,
              action_items: insight.action_items,
            },
          },
          "contact",
        );

        await markProcessed(engagement.conversation_id, insight.key_topics.join("; ") || insight.sentiment);
        processed++;
      } catch (error) {
        failed++;
        logger.warn("Failed to process engagement", {
          email: engagement.contact_email,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      ok: failed === 0,
      runId: context.runId,
      operation: "sync.pull-engagements",
      dryRun: context.dryRun,
      status: "live",
      summary: `Processed ${processed} of ${engagements.length} engagements (${failed} failed). Signals created: ${signalsCreated}. Tasks created: ${tasksCreated}.`,
      metrics: { records_scanned: engagements.length, records_updated: processed, failed, signals_created: signalsCreated, tasks_created: tasksCreated },
    };
  },
};
