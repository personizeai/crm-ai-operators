import { z } from "zod";
import { setProperty } from "../../lib/persist.js";
import { retrieveRecords } from "../../lib/recall.js";
import { ai } from "../../lib/ai.js";
import { logger } from "../../lib/logger.js";
import { createTask } from "../../lib/tasks.js";
import { workspace } from "../../lib/workspace.js";
import type { OperationEntry } from "../types.js";

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array<number>(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1]
        ? dp[i - 1]![j - 1]!
        : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[m]![n]!;
}

function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const al = a.toLowerCase().trim(), bl = b.toLowerCase().trim();
  if (al === bl) return 1;
  const dist = levenshtein(al, bl);
  return 1 - dist / Math.max(al.length, bl.length);
}

const DedupPairSchema = z.object({
  pairs: z.array(z.object({
    email_a: z.string(),
    email_b: z.string(),
    confidence: z.number().min(0).max(1),
    reason: z.string().max(300),
    recommended_primary: z.string().max(200),
  })).max(20),
});

interface ContactRecord {
  email: string;
  first_name?: string;
  last_name?: string;
  job_title?: string;
  company_domain?: string;
  merge_candidate?: boolean;
  [key: string]: unknown;
}

interface CandidatePair {
  a: ContactRecord;
  b: ContactRecord;
  score: number;
  reason: string;
}

async function getAllContacts(): Promise<ContactRecord[]> {
  return (await retrieveRecords({
    type: "contact",
    conditions: [],
    logic: "AND",
    limit: 1000,
  })) as ContactRecord[];
}

function findCandidatePairs(contacts: ContactRecord[], threshold = 0.75): CandidatePair[] {
  const byDomain: Record<string, ContactRecord[]> = {};
  for (const c of contacts) {
    const d = c.company_domain ?? "__no_domain__";
    if (!byDomain[d]) byDomain[d] = [];
    byDomain[d].push(c);
  }

  const pairs: CandidatePair[] = [];

  for (const domainContacts of Object.values(byDomain)) {
    if (domainContacts.length < 2) continue;
    for (let i = 0; i < domainContacts.length; i++) {
      for (let j = i + 1; j < domainContacts.length; j++) {
        const a = domainContacts[i]!;
        const b = domainContacts[j]!;

        const nameA = `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim();
        const nameB = `${b.first_name ?? ""} ${b.last_name ?? ""}`.trim();
        const nameSim = nameSimilarity(nameA, nameB);

        const sameTitle = a.job_title && b.job_title &&
          nameSimilarity(a.job_title, b.job_title) > 0.8;

        let score = 0;
        let reason = "";

        if (a.email === b.email) { score = 1.0; reason = "Exact email match"; }
        else if (nameSim >= 0.9) { score = 0.9; reason = `Near-identical name (${Math.round(nameSim * 100)}% match) at same company`; }
        else if (nameSim >= 0.75 && sameTitle) { score = 0.85; reason = `Similar name + identical job title at same company`; }
        else if (nameSim >= 0.75) { score = 0.75; reason = `Similar name (${Math.round(nameSim * 100)}% match) at same company`; }

        if (score >= threshold) {
          pairs.push({ a, b, score, reason });
        }
      }
    }
  }

  return pairs.sort((x, y) => y.score - x.score).slice(0, 50);
}

export const analyzeDeduplication: OperationEntry = {
  name: "analyze.deduplication",
  mode: "operation",
  description: "Detect duplicate contacts in Personize using name similarity + company domain clustering. Flags candidates and creates merge-proposal tasks for human review. Never auto-merges.",
  category: "analyze",
  status: "live",
  idempotent: true,
  cost: "medium",
  run_mode: "on-decision",
  guidelines_required: [],
  run: async (input, context) => {
    const contacts = await getAllContacts();
    logger.info("analyze.deduplication: contacts loaded", { count: contacts.length });

    if (contacts.length < 2) {
      return {
        ok: true,
        runId: context.runId,
        operation: "analyze.deduplication",
        dryRun: context.dryRun,
        status: "live",
        summary: "Not enough contacts to deduplicate.",
        metrics: { records_scanned: contacts.length, pairs_found: 0 },
      };
    }

    const candidates = findCandidatePairs(contacts);
    logger.info("analyze.deduplication: candidate pairs found", { count: candidates.length });

    if (candidates.length === 0) {
      return {
        ok: true,
        runId: context.runId,
        operation: "analyze.deduplication",
        dryRun: context.dryRun,
        status: "live",
        summary: `No duplicate candidates found across ${contacts.length} contacts.`,
        metrics: { records_scanned: contacts.length, pairs_found: 0 },
      };
    }

    if (context.dryRun) {
      logger.info("[DRY RUN] Would flag duplicate pairs", { count: candidates.length });
      return {
        ok: true,
        runId: context.runId,
        operation: "analyze.deduplication",
        dryRun: true,
        status: "live",
        summary: `[DRY RUN] Found ${candidates.length} candidate pairs across ${contacts.length} contacts.`,
        metrics: { records_scanned: contacts.length, pairs_found: candidates.length },
      };
    }

    // Use AI to assess the top candidates
    const pairContext = JSON.stringify(
      candidates.slice(0, 15).map((p) => ({
        email_a: p.a.email,
        name_a: `${p.a.first_name ?? ""} ${p.a.last_name ?? ""}`.trim(),
        title_a: p.a.job_title,
        email_b: p.b.email,
        name_b: `${p.b.first_name ?? ""} ${p.b.last_name ?? ""}`.trim(),
        title_b: p.b.job_title,
        company: p.a.company_domain,
        score: p.score,
        initial_reason: p.reason,
      })),
      null, 2,
    );

    const result = await ai({
      instructions: `Review these candidate duplicate pairs and confirm which are genuine duplicates. For confirmed duplicates, recommend which record to keep as primary (prefer the one with more complete data).

Candidate pairs:
${pairContext}`,
      outputs: DedupPairSchema,
      temperature: 0.1,
      maxTokens: 800,
    });

    const confirmed = result.output.pairs.filter((p) => p.confidence >= 0.75);

    // Flag contacts and create tasks
    let tasksCreated = 0;
    let flagged = 0;

    for (const pair of confirmed) {
      // Flag both contacts
      for (const email of [pair.email_a, pair.email_b]) {
        await setProperty({ type: "contact", email }, "merge_candidate", true);
        flagged++;
      }

      // Append note to each contact
      for (const email of [pair.email_a, pair.email_b]) {
        await workspace.appendNote(
          { email },
          {
            author: "analyze.deduplication",
            content: `Potential duplicate: ${email === pair.email_a ? pair.email_b : pair.email_a} (confidence ${Math.round(pair.confidence * 100)}%). Reason: ${pair.reason}`,
            category: "observation",
          },
          "contact",
        );
      }

      // One merge-proposal task per pair
      await createTask({
        title: `Dedup review: ${pair.email_a} ↔ ${pair.email_b} (${Math.round(pair.confidence * 100)}% confidence)`,
        task_type: "dedup-review",
        assigned_to: "rep",
        priority: "low",
        notes: JSON.stringify({ pair, recommended_primary: pair.recommended_primary }),
        custom_key_name: "email",
        custom_key_value: pair.email_a,
        created_by: "analyze.deduplication",
      });
      tasksCreated++;
    }

    return {
      ok: true,
      runId: context.runId,
      operation: "analyze.deduplication",
      dryRun: context.dryRun,
      status: "live",
      summary: `Found ${candidates.length} candidate pairs, confirmed ${confirmed.length} duplicates. Flagged ${flagged} contacts. ${tasksCreated} review tasks created.`,
      metrics: {
        records_scanned: contacts.length,
        pairs_found: candidates.length,
        pairs_confirmed: confirmed.length,
        contacts_flagged: flagged,
        tasks_created: tasksCreated,
      },
    };
  },
};
