import { z } from "zod";
import { retrieveRecords } from "../../lib/recall.js";
import { aiPrompt } from "../../lib/ai.js";
import { logger } from "../../lib/logger.js";
import type { OperationEntry } from "../types.js";

const ReviewOutputSchema = z.object({
  overall_health: z.enum(["healthy", "concerning", "critical"]),
  highlights: z.array(z.string()).max(5),
  failure_clusters: z
    .array(
      z.object({
        pattern: z.string().min(5).max(200),
        affected_operations: z.array(z.string()),
        occurrence_count: z.number(),
        likely_cause: z.string().min(5).max(300),
        suggested_action: z.string().min(5).max(300),
      }),
    )
    .max(10),
  proposed_actions: z
    .array(
      z.object({
        title: z.string().min(5).max(120),
        rationale: z.string().min(10).max(400),
        target: z.enum(["guideline", "operation", "schema", "config"]),
        target_name: z.string(),
      }),
    )
    .max(10),
});

interface RunRecord {
  run_id?: string;
  operation?: string;
  status?: string;
  dry_run?: boolean;
  summary?: string;
  started_at?: string;
  completed_at?: string;
  records_scanned?: number;
  records_updated?: number;
}

interface OperationStats {
  operation: string;
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  failure_examples: string[];
}

async function loadRecentRuns(daysBack: number): Promise<RunRecord[]> {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  return (await retrieveRecords({
    type: "operation_runs",
    conditions: [{ propertyName: "started_at", operator: "gte", value: since }],
    limit: 200,
  })) as RunRecord[];
}

function computeStats(runs: RunRecord[]): OperationStats[] {
  const byOp = new Map<string, OperationStats>();
  for (const run of runs) {
    const op = run.operation ?? "unknown";
    if (!byOp.has(op)) {
      byOp.set(op, {
        operation: op,
        total: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        failure_examples: [],
      });
    }
    const stats = byOp.get(op)!;
    stats.total++;
    if (run.status === "completed") stats.completed++;
    else if (run.status === "failed") {
      stats.failed++;
      if (stats.failure_examples.length < 3 && run.summary) {
        stats.failure_examples.push(run.summary);
      }
    } else if (run.status === "cancelled") stats.cancelled++;
  }
  return Array.from(byOp.values()).sort((a, b) => b.total - a.total);
}

export const optimizeReviewRuns: OperationEntry = {
  name: "optimize.review-runs",
  mode: "optimization",
  description: "Review recent operation runs from Personize, surface failures, and propose schema/guideline improvements.",
  category: "optimize",
  status: "live",
  idempotent: true,
  cost: "medium",
  run_mode: "on-decision",
  run: async (input, context) => {
    const inputObj = (input ?? {}) as { days_back?: number };
    const daysBack = typeof inputObj.days_back === "number" && inputObj.days_back > 0 ? inputObj.days_back : 7;

    const runs = await loadRecentRuns(daysBack);
    if (runs.length === 0) {
      return {
        ok: true,
        runId: context.runId,
        operation: "optimize.review-runs",
        dryRun: context.dryRun,
        status: "live",
        summary: `No operation runs found in the last ${daysBack} days.`,
        metrics: { runs_count: 0, days_back: daysBack },
      };
    }

    const stats = computeStats(runs);

    if (context.dryRun) {
      return {
        ok: true,
        runId: context.runId,
        operation: "optimize.review-runs",
        dryRun: true,
        status: "live",
        summary: `[DRY RUN] Found ${runs.length} runs across ${stats.length} operations. AI review skipped in dry-run.`,
        metrics: { runs_count: runs.length, operations_count: stats.length, stats_per_operation: stats },
      };
    }

    try {
      const result = await aiPrompt({
        instructions: `Review the following ${runs.length} operation runs from the last ${daysBack} days. Identify failure clusters, assess overall health, and propose concrete improvements (guideline edits, operation logic fixes, schema changes, or config adjustments).

Stats per operation (sorted by run count):
${JSON.stringify(stats, null, 2)}

Return a JSON object with:
- overall_health: "healthy" | "concerning" | "critical"
- highlights: ≤5 short bullet strings (key wins or worries)
- failure_clusters: ≤10 entries with { pattern, affected_operations, occurrence_count, likely_cause, suggested_action }
- proposed_actions: ≤10 entries with { title, rationale, target ("guideline"|"operation"|"schema"|"config"), target_name }

If there are no failures, return empty arrays for failure_clusters and minimal proposed_actions. Don't invent problems that aren't in the data.`,
        outputs: ReviewOutputSchema,
        temperature: 0.3,
        maxTokens: 2500,
      });

      const review = result.output;

      return {
        ok: true,
        runId: context.runId,
        operation: "optimize.review-runs",
        dryRun: context.dryRun,
        status: "live",
        summary: `Reviewed ${runs.length} runs across ${stats.length} operations. Health: ${review.overall_health}. ${review.failure_clusters.length} failure cluster(s), ${review.proposed_actions.length} proposed action(s).`,
        metrics: {
          runs_count: runs.length,
          days_back: daysBack,
          operations_count: stats.length,
          stats_per_operation: stats,
          review,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("AI review failed; returning raw stats only", { error: message });
      return {
        ok: false,
        runId: context.runId,
        operation: "optimize.review-runs",
        dryRun: context.dryRun,
        status: "live",
        summary: `AI review failed: ${message}. Raw stats returned for manual review.`,
        metrics: {
          runs_count: runs.length,
          days_back: daysBack,
          operations_count: stats.length,
          stats_per_operation: stats,
          ai_error: message,
        },
      };
    }
  },
};
