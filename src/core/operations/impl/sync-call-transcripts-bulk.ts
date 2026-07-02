// -----------------------------------------------------------------------------
// sync.call-transcripts-bulk
//
// PATTERN: Bulk memorize — ~50% LLM cost saving via Bedrock Batch.
//
// Use this operation when you have a large backlog of call transcripts (100s–
// 100,000s) that need AI extraction. Instead of processing one at a time (like
// analyze.call-summary does), this operation submits ALL eligible transcripts
// in a single batch call to Personize. Personize queues them on AWS Bedrock
// Batch and fires a `memorize.batch.completed` webhook within 24 hours.
//
// Trade-off vs analyze.call-summary:
//   analyze.call-summary — results in minutes, normal cost, per-event triggered.
//   sync.call-transcripts-bulk — results in ≤24h, ~50% cost, run manually or on schedule.
//
// When to use:
//   - Initial backfill of a large call history (10k+ transcripts)
//   - Nightly batch jobs to process the previous day's calls in bulk
//   - Any time cost matters more than same-day results
//
// Requirements (enforced by Personize):
//   - Minimum 25 records (auto-falls-back to async mode if fewer)
//   - Bedrock Batch provider must be configured on the org
//   - Bulk mode requires paid plan (free-tier blocked unless flag set)
// -----------------------------------------------------------------------------

import { retrieveRecords } from "../../lib/recall.js";
import { client } from "../../config.js";
import { compileFilter, parseFilterInput, type Filter } from "../../lib/filter.js";
import { logger } from "../../lib/logger.js";
import type { OperationEntry } from "../types.js";

const BULK_MIN_RECORDS = 25;
const PROCESSOR_TAG = "sync.call-transcripts-bulk";

// Default filter: call conversations not yet summarized.
// Adjust this filter per your CRM's data shape.
// Note: `body` non-empty check is done in code (filter.ts has no `not_empty` operator).
// To prevent re-submission after bulk completion, add a `bulk_submitted_at` date property
// to the conversations collection and filter by { bulk_submitted_at: { is_empty: true } }.
const DEFAULT_FILTER: Filter = {
  collection: "conversations",
  where: {
    type: "call",
    summary: { is_empty: true },
  },
  limit: 1000,
};

interface ConversationRow {
  contact_email?: string;
  company_domain?: string;
  body?: string;
  sent_at?: string;
  conversation_id?: string;
  type?: string;
  [key: string]: unknown;
}

export const syncCallTranscriptsBulk: OperationEntry = {
  name: "sync.call-transcripts-bulk",
  mode: "operation",
  description:
    "Bulk AI extraction from call/meeting transcripts via Bedrock Batch. ~50% LLM cost saving. " +
    "Results arrive via webhook within 24h — not immediate. Use for large backlogs or nightly batch jobs.",
  category: "sync",
  status: "live",
  idempotent: true,
  cost: "low",       // Dispatcher cost = one HTTP call. AI cost is ~50% cheaper via Bedrock Batch.
  run_mode: "manual", // Not triggered per-event. Run on schedule or manually for batch jobs.

  run: async (input, context) => {
    const filter = parseFilterInput(input) ?? DEFAULT_FILTER;
    const compiledFilter = compileFilter(filter);

    // Fetch eligible conversations
    let records: ConversationRow[];
    try {
      records = (await retrieveRecords({
        type: compiledFilter.collection,
        conditions: compiledFilter.conditions,
        logic: compiledFilter.logic,
        limit: compiledFilter.limit,
      })) as ConversationRow[];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("sync.call-transcripts-bulk: recall failed", { error: msg });
      return {
        ok: false,
        runId: context.runId,
        operation: PROCESSOR_TAG,
        dryRun: context.dryRun,
        summary: `Recall failed: ${msg}`,
      };
    }

    // Filter rows: must have at least one entity identifier + non-empty transcript
    const rows = records
      .filter((r) => (r.contact_email || r.company_domain) && r.body && r.body.trim().length > 50)
      .map((r) => ({
        contact_email: r.contact_email ?? "",
        company_domain: r.company_domain ?? "",
        transcript: r.body ?? "",
        sent_at: r.sent_at ?? "",
        conversation_id: r.conversation_id ?? "",
      }));

    logger.info("sync.call-transcripts-bulk: eligible rows", { total: records.length, eligible: rows.length });

    if (rows.length === 0) {
      return {
        ok: true,
        runId: context.runId,
        operation: PROCESSOR_TAG,
        dryRun: context.dryRun,
        summary: "No eligible call transcripts found. Nothing submitted.",
        metrics: { records_scanned: records.length, records_submitted: 0 },
      };
    }

    // Choose execution mode: bulk requires >= 25 records.
    const executionMode = rows.length >= BULK_MIN_RECORDS ? "bulk" : "async";
    if (rows.length < BULK_MIN_RECORDS) {
      logger.info(
        `sync.call-transcripts-bulk: only ${rows.length} records — falling back to async mode (bulk requires >= ${BULK_MIN_RECORDS})`,
      );
    }

    if (context.dryRun) {
      logger.info("[DRY RUN] Would submit batch memorize", {
        rows: rows.length,
        executionMode,
      });
      return {
        ok: true,
        runId: context.runId,
        operation: PROCESSOR_TAG,
        dryRun: true,
        summary: `[DRY RUN] Would submit ${rows.length} transcripts (${executionMode} mode). No API calls made.`,
        metrics: { records_scanned: records.length, records_submitted: 0, execution_mode: executionMode },
      };
    }

    // Submit the batch to Personize.
    // client.memory.memorizeBatch() hits POST /api/v1/batch-memorize and returns 202 immediately.
    // The `mapping` tells Personize which field is the entity identifier and which fields to
    // extract AI memories from (extractMemories: true) vs write as structured properties (false).
    let batchResult: any;
    try {
      batchResult = await (client as any).memory.memorizeBatch({
        source: "crm-ai-operators",
        tier: "pro",
        // extractionPrompt guides what the AI focuses on when reading each transcript.
        extractionPrompt:
          "Extract from this sales call or meeting: pain points, objections raised, buying signals, " +
          "competitor mentions, next steps agreed, timeline indicators, and overall deal sentiment. " +
          "Max 500 chars.",
        mapping: {
          entityType: "contact",
          // "contact_email" is the field name in each row that holds the contact email.
          // Personize uses this to anchor extracted memories to the right contact record.
          email: "contact_email",
          properties: {
            // transcript → AI extraction: memories are extracted and stored per contact.
            transcript: {
              sourceField: "transcript",
              extractMemories: true,
              collectionName: "Conversations",
            },
            // sent_at → structured write only: no AI, just set the date field.
            call_date: {
              sourceField: "sent_at",
              extractMemories: false,
            },
          },
        },
        rows,
        dryRun: false,  // already guarded above
        chunkSize: 50,  // Personize processes rows in chunks of this size
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("sync.call-transcripts-bulk: memorizeBatch failed", { error: msg });
      return {
        ok: false,
        runId: context.runId,
        operation: PROCESSOR_TAG,
        dryRun: context.dryRun,
        summary: `Batch submission failed: ${msg}`,
        metrics: { records_scanned: records.length, records_submitted: 0 },
      };
    }

    const eventId = batchResult?.data?.eventId ?? batchResult?.eventId ?? "unknown";
    const trackingId = batchResult?.data?.trackingId ?? batchResult?.trackingId ?? "unknown";

    logger.info("sync.call-transcripts-bulk: batch submitted", {
      rows: rows.length,
      executionMode,
      eventId,
      trackingId,
    });

    // The webhook `memorize.batch.completed` fires when extraction finishes (≤24h for bulk).
    // Job details are captured in metrics below and persisted to operation-runs automatically.

    const eta = executionMode === "bulk" ? "within 24 hours" : "within minutes";
    return {
      ok: true,
      runId: context.runId,
      operation: PROCESSOR_TAG,
      dryRun: context.dryRun,
      summary:
        `Submitted ${rows.length} transcripts for AI extraction (${executionMode} mode). ` +
        `Results ${eta} via webhook. eventId=${eventId}.`,
      metrics: {
        records_scanned: records.length,
        records_submitted: rows.length,
        execution_mode: executionMode,
        batch_event_id: eventId,
        batch_tracking_id: trackingId,
      },
    };
  },
};
