import { retrieveRecords } from "../../lib/recall.js";
import { logger } from "../../lib/logger.js";
import { setProperty } from "../../lib/persist.js";
import { workspace } from "../../lib/workspace.js";
import type { OperationEntry } from "../types.js";

// Canonical lifecycle stages — the unified model used across all CRMs in Personize.
const CANONICAL: Record<string, string> = {
  // HubSpot default stages
  subscriber: "Subscriber",
  lead: "MQL",
  marketingqualifiedlead: "MQL",
  salesqualifiedlead: "SQL",
  opportunity: "Opportunity",
  customer: "Customer",
  evangelist: "Customer",
  other: "Unclassified",
  // Salesforce lead statuses
  "open - not contacted": "MQL",
  "working - contacted": "SQL",
  "closed - converted": "Opportunity",
  "closed - not converted": "Disqualified",
  // Salesforce opportunity stages
  prospecting: "MQL",
  qualification: "SQL",
  "needs analysis": "SQL",
  "value proposition": "Opportunity",
  "id. decision makers": "Opportunity",
  "perception analysis": "Opportunity",
  "proposal/price quote": "Opportunity",
  "negotiation/review": "Opportunity",
  "closed won": "Customer",
  "closed lost": "Disqualified",
  // Common freeform values
  mql: "MQL",
  sql: "SQL",
  churned: "Churned",
  disqualified: "Disqualified",
  lost: "Disqualified",
};

function normalize(raw: string): string | null {
  const key = raw.toLowerCase().trim();
  return CANONICAL[key] ?? null;
}

interface PersonizeRecord {
  email?: string;
  domain?: string;
  lifecycle_stage?: string;
  normalized_lifecycle_stage?: string;
  [key: string]: unknown;
}

async function loadAll(type: "contact" | "company"): Promise<PersonizeRecord[]> {
  return (await retrieveRecords({
    type,
    conditions: [{ propertyName: "lifecycle_stage", operator: "exists", value: true }],
    logic: "AND",
    limit: 1000,
  })) as PersonizeRecord[];
}

export const syncNormalizeLifecycle: OperationEntry = {
  name: "sync.normalize-lifecycle",
  mode: "operation",
  description: "Map CRM-specific lifecycle stage values to a canonical unified model in Personize. Writes normalized_lifecycle_stage to contacts and companies. Returns coverage and gap report.",
  category: "sync",
  status: "live",
  idempotent: true,
  cost: "low",
  run_mode: "on-trigger",
  guidelines_required: [],
  run: async (input, context) => {
    const [contacts, companies] = await Promise.all([loadAll("contact"), loadAll("company")]);
    logger.info("sync.normalize-lifecycle: records loaded", { contacts: contacts.length, companies: companies.length });

    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const unmapped = new Set<string>();

    // Process contacts
    for (const record of contacts) {
      if (!record.lifecycle_stage || !record.email) { skipped++; continue; }

      const canonical = normalize(record.lifecycle_stage);
      if (!canonical) { unmapped.add(record.lifecycle_stage); skipped++; continue; }

      // Skip if already normalized to the same value
      if (record.normalized_lifecycle_stage === canonical) { skipped++; continue; }

      if (context.dryRun) {
        logger.info("[DRY RUN] Would normalize", { email: record.email, from: record.lifecycle_stage, to: canonical });
        updated++;
        continue;
      }

      try {
        await setProperty({ type: "contact", email: record.email }, "normalized_lifecycle_stage", canonical);

        if (record.normalized_lifecycle_stage && record.normalized_lifecycle_stage !== canonical) {
          await workspace.appendUpdate(
            { email: record.email },
            {
              author: "sync.normalize-lifecycle",
              type: "change",
              summary: `Lifecycle normalized: ${record.normalized_lifecycle_stage} → ${canonical}`,
              details: { raw: record.lifecycle_stage, previous: record.normalized_lifecycle_stage, normalized: canonical },
            },
            "contact",
          );
        }
        updated++;
      } catch (error) {
        failed++;
        logger.warn("Failed to normalize contact lifecycle", {
          email: record.email,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Process companies
    for (const record of companies) {
      if (!record.lifecycle_stage || !record.domain) { skipped++; continue; }

      const canonical = normalize(record.lifecycle_stage);
      if (!canonical) { unmapped.add(record.lifecycle_stage); skipped++; continue; }
      if (record.normalized_lifecycle_stage === canonical) { skipped++; continue; }

      if (context.dryRun) {
        logger.info("[DRY RUN] Would normalize company", { domain: record.domain, from: record.lifecycle_stage, to: canonical });
        updated++;
        continue;
      }

      try {
        await setProperty({ type: "company", websiteUrl: record.domain }, "normalized_lifecycle_stage", canonical);
        updated++;
      } catch (error) {
        failed++;
        logger.warn("Failed to normalize company lifecycle", {
          domain: record.domain,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const unmappedList = [...unmapped];
    const total = contacts.length + companies.length;

    return {
      ok: failed === 0,
      runId: context.runId,
      operation: "sync.normalize-lifecycle",
      dryRun: context.dryRun,
      status: "live",
      summary: `Normalized ${updated} of ${total} records (${skipped} skipped, ${failed} failed). ${unmappedList.length > 0 ? `Unmapped values: ${unmappedList.join(", ")}` : "All values mapped."}`,
      metrics: {
        records_scanned: total,
        records_updated: updated,
        skipped,
        failed,
        unmapped_values: unmappedList,
        contacts_processed: contacts.length,
        companies_processed: companies.length,
      },
    };
  },
};
