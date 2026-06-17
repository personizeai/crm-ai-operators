import { z } from "zod";
import { randomUUID } from "node:crypto";
import { client } from "../../config.js";
import { retrieveRecords } from "../../lib/recall.js";
import { aiPrompt } from "../../lib/ai.js";
import { loadGuidelines, missingGuidelines } from "../../lib/governance.js";
import { logger } from "../../lib/logger.js";
import { createTask } from "../../lib/tasks.js";
import { todayIso, addBusinessDays, isoDate } from "../../lib/dates.js";
import { workspace } from "../../lib/workspace.js";
import type { OperationEntry } from "../types.js";

const REQUIRED_GUIDELINES = ["activity-logging", "signal-definitions"];
const PROCESSOR_TAG = "analyze.call-summary";

const SummarySchema = z.object({
  summary: z.string().min(20).max(500),
  key_topics: z.array(z.string().max(100)).max(8),
  next_steps: z.array(z.string().max(200)).max(5),
  action_items: z.array(z.string().max(200)).max(5),
  buying_signals: z.array(z.string().max(200)).max(5),
  deal_stage_indicator: z.enum(["progressing", "stalled", "at_risk", "closing", "neutral"]),
  follow_up_required: z.boolean(),
});

interface ConversationRecord {
  conversation_id?: string;
  contact_email?: string;
  type?: string;
  subject?: string;
  body?: string;
  body_preview?: string;
  summary?: string;
  sent_at?: string;
  processed_by?: string[];
  [key: string]: unknown;
}

async function getUnprocessedCalls(): Promise<ConversationRecord[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [calls, meetings] = await Promise.all([
    retrieveRecords({
      type: "conversation",
      conditions: [
        { propertyName: "type", operator: "equals", value: "call" },
        { propertyName: "sent_at", operator: "gte", value: since },
      ],
      logic: "AND",
      limit: 50,
    }) as Promise<ConversationRecord[]>,
    retrieveRecords({
      type: "conversation",
      conditions: [
        { propertyName: "type", operator: "equals", value: "meeting" },
        { propertyName: "sent_at", operator: "gte", value: since },
      ],
      logic: "AND",
      limit: 50,
    }) as Promise<ConversationRecord[]>,
  ]);

  return [...calls, ...meetings].filter((c) => {
    const processed = Array.isArray(c.processed_by) ? c.processed_by : [];
    return !processed.includes(PROCESSOR_TAG);
  });
}

async function appendSignal(contactEmail: string, signal: string): Promise<void> {
  const memory = (client as any).memory;
  const signalId = `sig_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const properties = {
    record_id: signalId,
    signal_type: "call-signal",
    severity: "medium",
    source: PROCESSOR_TAG,
    contact_email: contactEmail,
    observed_at: new Date().toISOString(),
    title: signal.slice(0, 120),
    description: signal,
  };
  try {
    if (typeof memory?.store === "function") {
      await memory.store({ collectionSlug: "signals", primaryKey: { record_id: signalId }, properties });
    } else if (typeof memory?.batchStore === "function") {
      await memory.batchStore({ collectionSlug: "signals", records: [{ primaryKey: { record_id: signalId }, properties }] });
    }
  } catch {
    // Non-fatal
  }
}

export const analyzeCallSummary: OperationEntry = {
  name: "analyze.call-summary",
  mode: "operation",
  description: "Extract structured summaries from call and meeting transcripts in Personize. Updates conversation + contact workspace + creates follow-up tasks for action items.",
  category: "analyze",
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
        operation: PROCESSOR_TAG,
        dryRun: context.dryRun,
        summary: `Missing required guidelines: ${missing.join(", ")}. Run setup.apply first.`,
        metrics: { missing_guidelines: missing },
      };
    }

    const calls = await getUnprocessedCalls();
    logger.info("analyze.call-summary: unprocessed calls/meetings loaded", { count: calls.length });

    if (calls.length === 0) {
      return {
        ok: true,
        runId: context.runId,
        operation: PROCESSOR_TAG,
        dryRun: context.dryRun,
        status: "live",
        summary: "No unprocessed calls or meetings found in the last 30 days.",
        metrics: { records_scanned: 0, records_updated: 0 },
      };
    }

    let processed = 0;
    let failed = 0;
    let tasksCreated = 0;
    let signalsCreated = 0;

    for (const call of calls) {
      if (!call.contact_email || !call.conversation_id) { failed++; continue; }

      const content = call.body ?? call.body_preview ?? call.summary ?? "(no transcript available)";

      try {
        if (context.dryRun) {
          logger.info("[DRY RUN] Would summarize call", { email: call.contact_email, type: call.type });
          processed++;
          continue;
        }

        const result = await aiPrompt({
          instructions: `Extract a structured summary from this ${call.type ?? "call"} engagement.

Subject/Title: ${call.subject ?? "(none)"}
Date: ${call.sent_at ?? "unknown"}

Content/Transcript:
${content.slice(0, 4000)}`,
          context: `# Activity Logging\n\n${guidelines["activity-logging"]}\n\n---\n\n# Signal Definitions\n\n${guidelines["signal-definitions"]}`,
          outputs: SummarySchema,
          temperature: 0.2,
          maxTokens: 700,
        });

        const s = result.output;
        const memory = (client as any).memory;

        // Update conversation record
        if (memory?.updateProperty) {
          for (const [prop, val] of Object.entries({ summary: s.summary, key_topics: s.key_topics, action_items: s.action_items })) {
            await memory.updateProperty({ record_id: call.conversation_id, type: "conversation", propertyName: prop, operation: "set", value: val });
          }
          await memory.updateProperty({ record_id: call.conversation_id, type: "conversation", propertyName: "processed_by", operation: "push", value: PROCESSOR_TAG });
        }

        // Create follow-up tasks for each action item
        for (const item of s.action_items) {
          await createTask({
            title: `${call.type === "meeting" ? "Meeting" : "Call"} follow-up: ${item.slice(0, 120)}`,
            task_type: "follow-up",
            assigned_to: "agent",
            priority: s.deal_stage_indicator === "at_risk" ? "high" : "medium",
            due_date: isoDate(addBusinessDays(new Date(), 1)),
            notes: JSON.stringify({ source_conversation: call.conversation_id, item, summary: s.summary }),
            custom_key_name: "email",
            custom_key_value: call.contact_email,
            created_by: PROCESSOR_TAG,
          });
          tasksCreated++;
        }

        // Append buying signals
        for (const signal of s.buying_signals) {
          await appendSignal(call.contact_email, signal);
          signalsCreated++;
        }

        await workspace.appendUpdate(
          { email: call.contact_email },
          {
            author: PROCESSOR_TAG,
            type: "engagement",
            summary: `${call.type === "meeting" ? "Meeting" : "Call"} summarized — ${s.deal_stage_indicator}, ${s.buying_signals.length} buying signals`,
            details: {
              conversation_id: call.conversation_id,
              summary: s.summary,
              key_topics: s.key_topics,
              next_steps: s.next_steps,
              deal_stage_indicator: s.deal_stage_indicator,
            },
          },
          "contact",
        );

        processed++;
      } catch (error) {
        failed++;
        logger.warn("Failed to summarize call", {
          email: call.contact_email,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      ok: failed === 0,
      runId: context.runId,
      operation: PROCESSOR_TAG,
      dryRun: context.dryRun,
      status: "live",
      summary: `Summarized ${processed} of ${calls.length} calls/meetings (${failed} failed). Tasks: ${tasksCreated}. Signals: ${signalsCreated}.`,
      metrics: { records_scanned: calls.length, records_updated: processed, failed, tasks_created: tasksCreated, signals_created: signalsCreated },
    };
  },
};
