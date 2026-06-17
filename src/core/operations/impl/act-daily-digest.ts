import { retrieveRecords } from "../../lib/recall.js";
import { logger } from "../../lib/logger.js";
import { createTask } from "../../lib/tasks.js";
import { todayIso } from "../../lib/dates.js";
import type { OperationEntry } from "../types.js";

interface ContactRecord {
  email: string;
  first_name?: string;
  last_name?: string;
  job_title?: string;
  company_domain?: string;
  assigned_to?: string;
  ai_score?: number;
  next_best_action?: string;
  buying_stage?: string;
  [key: string]: unknown;
}

interface SignalRecord {
  contact_email?: string;
  severity?: string;
  weight?: number;
  observed_at?: string;
  title?: string;
  [key: string]: unknown;
}

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 10,
  high: 7,
  medium: 4,
  low: 1,
  info: 0,
};

async function getAllActiveContacts(): Promise<ContactRecord[]> {
  return (await retrieveRecords({
    type: "contact",
    conditions: [{ propertyName: "ai_score", operator: "exists", value: true }],
    logic: "AND",
    limit: 500,
  })) as ContactRecord[];
}

async function getRecentSignals(): Promise<SignalRecord[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  return (await retrieveRecords({
    type: "signal",
    conditions: [{ propertyName: "observed_at", operator: "gte", value: since }],
    logic: "AND",
    limit: 1000,
  })) as SignalRecord[];
}

async function postToSlack(webhookUrl: string, text: string): Promise<boolean> {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export const actDailyDigest: OperationEntry = {
  name: "act.daily-digest",
  mode: "operation",
  description: "Surface top N highest-signal contacts for each AE every morning. Ranked by ai_score + recent signal activity. Delivered via Slack or digest task.",
  category: "act",
  status: "live",
  idempotent: false,
  cost: "medium",
  run_mode: "always",
  guidelines_required: [],
  run: async (input, context) => {
    const inputObj = (input ?? {}) as { top_n?: number; min_score?: number };
    const topN = inputObj.top_n ?? 5;
    const minScore = inputObj.min_score ?? 50;

    const [contacts, signals] = await Promise.all([
      getAllActiveContacts(),
      getRecentSignals(),
    ]);

    // Build signal weight map per contact
    const signalWeights: Record<string, number> = {};
    for (const signal of signals) {
      if (!signal.contact_email) continue;
      const weight = SEVERITY_WEIGHT[signal.severity ?? "info"] ?? 0;
      signalWeights[signal.contact_email] = (signalWeights[signal.contact_email] ?? 0) + weight;
    }

    // Score and group contacts by assigned_to
    const byRep: Record<string, Array<ContactRecord & { composite: number }>> = {};
    for (const contact of contacts) {
      if (!contact.email) continue;
      if ((contact.ai_score ?? 0) < minScore) continue;

      const rep = contact.assigned_to ?? "unassigned";
      const sigWeight = Math.min(signalWeights[contact.email] ?? 0, 50); // cap signal contribution
      const composite = (contact.ai_score ?? 0) * 0.6 + sigWeight * 0.4;

      if (!byRep[rep]) byRep[rep] = [];
      byRep[rep].push({ ...contact, composite });
    }

    if (context.dryRun) {
      const repCount = Object.keys(byRep).length;
      logger.info("[DRY RUN] Would send daily digest", { reps: repCount, total_contacts: contacts.length });
      return {
        ok: true,
        runId: context.runId,
        operation: "act.daily-digest",
        dryRun: true,
        status: "live",
        summary: `[DRY RUN] Would send digests to ${repCount} reps covering ${contacts.length} contacts.`,
        metrics: { reps: repCount, contacts_scanned: contacts.length },
      };
    }

    const slackWebhookUrl = process.env["SLACK_WEBHOOK_URL"];
    let digestsSent = 0;
    let tasksCreated = 0;
    const repsProcessed: string[] = [];

    for (const [rep, repContacts] of Object.entries(byRep)) {
      const top = repContacts.sort((a, b) => b.composite - a.composite).slice(0, topN);
      if (top.length === 0) continue;

      const lines = top.map((c, i) => {
        const signalLine = (signalWeights[c.email] ?? 0) > 0 ? ` | ${signalWeights[c.email]}pt signals` : "";
        const action = c.next_best_action ? ` → ${c.next_best_action.slice(0, 80)}` : "";
        return `${i + 1}. ${c.first_name ?? ""} ${c.last_name ?? ""} (${c.job_title ?? "unknown"} @ ${c.company_domain ?? "?"}) — score ${c.ai_score}${signalLine}${action}`;
      });

      const digestText = `*Daily Focus — ${todayIso()}*\nTop ${top.length} contacts for ${rep}:\n${lines.join("\n")}`;

      let sent = false;
      if (slackWebhookUrl) {
        sent = await postToSlack(slackWebhookUrl, digestText);
        if (sent) digestsSent++;
      }

      if (!sent) {
        await createTask({
          title: `Daily digest — ${top.length} top contacts for ${rep}`,
          task_type: "daily-digest",
          assigned_to: rep,
          priority: "medium",
          due_date: todayIso(),
          notes: digestText,
          created_by: "act.daily-digest",
        });
        tasksCreated++;
      }

      repsProcessed.push(rep);
    }

    return {
      ok: true,
      runId: context.runId,
      operation: "act.daily-digest",
      dryRun: context.dryRun,
      status: "live",
      summary: `Sent digests to ${repsProcessed.length} reps (${digestsSent} via Slack, ${tasksCreated} via task).`,
      metrics: {
        contacts_scanned: contacts.length,
        reps: repsProcessed.length,
        slack_sent: digestsSent,
        tasks_created: tasksCreated,
      },
    };
  },
};
