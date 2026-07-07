import { z } from "zod";
import { randomUUID } from "node:crypto";
import { setProperty, setProperties, appendToProperty } from "../../lib/persist.js";
import { retrieveRecords } from "../../lib/recall.js";
import { ai } from "../../lib/ai.js";
import { loadGuidelines, missingGuidelines } from "../../lib/governance.js";
import { logger } from "../../lib/logger.js";
import { createTask } from "../../lib/tasks.js";
import { workspace } from "../../lib/workspace.js";
import type { OperationEntry } from "../types.js";

const REQUIRED_GUIDELINES = ["reply-handling", "signal-definitions"];

const ReplyClass = z.enum([
  "Positive interest",
  "Question",
  "Referral",
  "Objection",
  "Soft no",
  "Hard no",
  "OOO",
  "Unsubscribe",
  "Bounce",
]);

const ClassificationSchema = z.object({
  class: ReplyClass,
  confidence: z.enum(["low", "medium", "high"]),
  summary: z.string().min(10).max(300),
  action_items: z.array(z.string().max(200)).max(5),
});

type ReplyClassValue = z.infer<typeof ReplyClass>;

interface ConversationRecord {
  conversation_id?: string;
  contact_email?: string;
  subject?: string;
  body?: string;
  body_preview?: string;
  direction?: string;
  type?: string;
  sent_at?: string;
  processed_by?: string[];
  [key: string]: unknown;
}

const SEVERITY_MAP: Record<ReplyClassValue, string> = {
  "Positive interest": "high",
  "Question": "medium",
  "Referral": "medium",
  "Objection": "medium",
  "Soft no": "low",
  "Hard no": "low",
  "OOO": "info",
  "Unsubscribe": "critical",
  "Bounce": "low",
};

const SEQUENCE_STATUS_MAP: Record<ReplyClassValue, string> = {
  "Positive interest": "Replied",
  "Question": "Replied",
  "Referral": "Replied",
  "Objection": "Replied",
  "Soft no": "Replied",
  "Hard no": "Replied",
  "OOO": "Paused",
  "Unsubscribe": "Opted Out",
  "Bounce": "Bounced",
};

// Idempotency guard: drop replies this operation already processed. Applied to
// both self-recalled and dispatcher-preloaded (batch) record sets, since a
// route filter may not express "processed_by not contains".
function excludeProcessed(records: ConversationRecord[]): ConversationRecord[] {
  return records.filter((c) => {
    const processed = Array.isArray(c.processed_by) ? c.processed_by : [];
    return !processed.includes("analyze.reply-sentiment");
  });
}

async function getUnprocessedReplies(): Promise<ConversationRecord[]> {
  const all = (await retrieveRecords({
    type: "conversation",
    conditions: [
      { propertyName: "direction", operator: "equals", value: "inbound" },
      { propertyName: "type", operator: "equals", value: "email" },
    ],
    logic: "AND",
    limit: 50,
  })) as ConversationRecord[];
  return excludeProcessed(all);
}

async function appendSignal(contactEmail: string, classification: z.infer<typeof ClassificationSchema>): Promise<void> {
  const signalId = `sig_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const properties = {
    record_id: signalId,
    signal_type: "email-reply",
    severity: SEVERITY_MAP[classification.class],
    source: "analyze.reply-sentiment",
    contact_email: contactEmail,
    observed_at: new Date().toISOString(),
    title: `${classification.class} reply from ${contactEmail}`,
    description: classification.summary,
  };
  await setProperties({ type: "signal", collection: "signals", recordId: signalId }, properties);
}

async function markProcessed(conversationId: string): Promise<void> {
  await appendToProperty({ type: "conversation", recordId: conversationId }, "processed_by", "analyze.reply-sentiment");
}

export const analyzeReplySentiment: OperationEntry = {
  name: "analyze.reply-sentiment",
  mode: "operation",
  description: "Classify inbound email replies (9 classes per reply-handling guideline). Updates sequence_status, appends signal, creates follow-up task.",
  category: "analyze",
  status: "live",
  idempotent: true,
  cost: "low",
  run_mode: "on-trigger",
  guidelines_required: REQUIRED_GUIDELINES,
  run: async (input, context) => {
    const guidelines = await loadGuidelines(REQUIRED_GUIDELINES);
    const missing = missingGuidelines(guidelines);
    if (missing.length > 0) {
      return {
        ok: false,
        runId: context.runId,
        operation: "analyze.reply-sentiment",
        dryRun: context.dryRun,
        summary: `Missing required guidelines: ${missing.join(", ")}. Run setup.apply first.`,
        metrics: { missing_guidelines: missing },
      };
    }

    // Batch dispatch preloads the route's records; otherwise self-recall. Either
    // way, excludeProcessed enforces idempotency.
    const preloaded = (input as { records?: ConversationRecord[] } | undefined)?.records;
    const replies = Array.isArray(preloaded) ? excludeProcessed(preloaded) : await getUnprocessedReplies();
    logger.info("analyze.reply-sentiment: unprocessed replies loaded", { count: replies.length });

    if (replies.length === 0) {
      return {
        ok: true,
        runId: context.runId,
        operation: "analyze.reply-sentiment",
        dryRun: context.dryRun,
        status: "live",
        summary: "No unprocessed inbound replies found.",
        metrics: { records_scanned: 0, records_updated: 0 },
      };
    }

    let processed = 0;
    let failed = 0;
    const breakdown: Record<string, number> = {};

    for (const reply of replies) {
      if (!reply.contact_email || !reply.conversation_id) { failed++; continue; }

      const replyText = reply.body ?? reply.body_preview ?? "(no body)";

      try {
        if (context.dryRun) {
          logger.info("[DRY RUN] Would classify reply", { email: reply.contact_email });
          processed++;
          continue;
        }

        const result = await ai({
          instructions: `Classify this email reply into one of the 9 reply classes. Use the reply-handling and signal-definitions guidelines to calibrate your classification.

Email subject: ${reply.subject ?? "(none)"}
Email body:
${replyText.slice(0, 2000)}`,
          context: `# Reply Handling\n\n${guidelines["reply-handling"]}\n\n---\n\n# Signal Definitions\n\n${guidelines["signal-definitions"]}`,
          outputs: ClassificationSchema,
          temperature: 0.1,
          maxTokens: 400,
        });

        const cls = result.output;

        // Update conversation with classification
        for (const [prop, val] of Object.entries({
          sentiment: cls.class,
          summary: cls.summary,
          action_items: cls.action_items,
        })) {
          await setProperty({ type: "conversation", recordId: reply.conversation_id }, prop, val);
        }

        // Update contact sequence_status
        const newStatus = SEQUENCE_STATUS_MAP[cls.class];
        await setProperty({ type: "contact", email: reply.contact_email }, "sequence_status", newStatus);

        // Append signal
        await appendSignal(reply.contact_email, cls);

        // Create follow-up task for actionable classes
        if (["Positive interest", "Question", "Objection", "Referral"].includes(cls.class)) {
          const taskTitleMap: Record<string, string> = {
            "Positive interest": `Rep action: positive reply from ${reply.contact_email}`,
            "Question": `Answer question from ${reply.contact_email}`,
            "Objection": `Address objection from ${reply.contact_email}`,
            "Referral": `Follow up on referral from ${reply.contact_email}`,
          };
          await createTask({
            title: taskTitleMap[cls.class] ?? `Follow up with ${reply.contact_email}`,
            task_type: cls.class === "Positive interest" ? "rep-handoff" : "follow-up",
            assigned_to: cls.class === "Positive interest" ? "rep" : "agent",
            priority: cls.class === "Positive interest" ? "urgent" : "high",
            notes: JSON.stringify({ class: cls.class, summary: cls.summary, action_items: cls.action_items }),
            custom_key_name: "email",
            custom_key_value: reply.contact_email,
            created_by: "analyze.reply-sentiment",
          });
        }

        await workspace.appendUpdate(
          { email: reply.contact_email },
          {
            author: "analyze.reply-sentiment",
            type: "engagement",
            summary: `Reply classified: ${cls.class} (${cls.confidence} confidence)`,
            details: { class: cls.class, confidence: cls.confidence, summary: cls.summary },
          },
          "contact",
        );

        await markProcessed(reply.conversation_id);
        breakdown[cls.class] = (breakdown[cls.class] ?? 0) + 1;
        processed++;
      } catch (error) {
        failed++;
        logger.warn("Failed to classify reply", {
          email: reply.contact_email,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      ok: failed === 0,
      runId: context.runId,
      operation: "analyze.reply-sentiment",
      dryRun: context.dryRun,
      status: "live",
      summary: `Classified ${processed} of ${replies.length} replies (${failed} failed). Breakdown: ${JSON.stringify(breakdown)}.`,
      metrics: { records_scanned: replies.length, records_updated: processed, failed, breakdown },
    };
  },
};
