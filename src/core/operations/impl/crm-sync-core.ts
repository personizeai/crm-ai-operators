import { hubspot, type HubspotContact, type HubspotCompany } from "../../../adapters/hubspot/adapter.js";
import { salesforce } from "../../../adapters/salesforce/adapter.js";
import { logger } from "../../lib/logger.js";
import { saveRecords, type SaveRecordInput } from "../../lib/persist.js";
import type { OperationEntry } from "../types.js";

const PAGE_SIZE = 100;

const HUBSPOT_CONTACT_PROPS = [
  "email",
  "firstname",
  "lastname",
  "jobtitle",
  "phone",
  "lifecyclestage",
  "company",
  "hs_object_id",
];

const HUBSPOT_COMPANY_PROPS = [
  "domain",
  "name",
  "industry",
  "numberofemployees",
  "lifecyclestage",
  "hs_object_id",
];

interface MappedContact {
  email: string;
  first_name?: string;
  last_name?: string;
  job_title?: string;
  phone?: string;
  lifecycle_stage?: string;
  crm_source: "HubSpot" | "Salesforce";
  crm_object_type: "contact" | "lead";
  crm_record_id: string;
}

interface MappedCompany {
  domain: string;
  company_name?: string;
  industry?: string;
  employee_count?: number;
  lifecycle_stage?: string;
  crm_source: "HubSpot" | "Salesforce";
  crm_record_id: string;
}

function mapHubspotContact(record: HubspotContact): MappedContact | null {
  const p = record.properties;
  if (!p.email) return null;
  return {
    email: p.email,
    first_name: p.firstname || undefined,
    last_name: p.lastname || undefined,
    job_title: p.jobtitle || undefined,
    phone: p.phone || undefined,
    lifecycle_stage: p.lifecyclestage || undefined,
    crm_source: "HubSpot",
    crm_object_type: "contact",
    crm_record_id: record.id,
  };
}

function mapHubspotCompany(record: HubspotCompany): MappedCompany | null {
  const p = record.properties;
  if (!p.domain) return null;
  const employeeCount = p.numberofemployees ? Number(p.numberofemployees) : undefined;
  return {
    domain: p.domain.toLowerCase().replace(/^www\./, ""),
    company_name: p.name || undefined,
    industry: p.industry || undefined,
    employee_count: Number.isFinite(employeeCount) ? employeeCount : undefined,
    lifecycle_stage: p.lifecyclestage || undefined,
    crm_source: "HubSpot",
    crm_record_id: record.id,
  };
}

interface SalesforceContactRow {
  Id: string;
  Email: string | null;
  FirstName?: string | null;
  LastName?: string | null;
  Title?: string | null;
  Phone?: string | null;
}

function mapSalesforceContact(record: SalesforceContactRow): MappedContact | null {
  if (!record.Email) return null;
  return {
    email: record.Email,
    first_name: record.FirstName ?? undefined,
    last_name: record.LastName ?? undefined,
    job_title: record.Title ?? undefined,
    phone: record.Phone ?? undefined,
    crm_source: "Salesforce",
    crm_object_type: "contact",
    crm_record_id: record.Id,
  };
}

const TYPE_FOR_SLUG: Record<string, string> = {
  contacts: "contact",
  companies: "company",
};

async function batchStore<T extends { email?: string; domain?: string }>(
  collectionSlug: string,
  records: T[],
  primaryKeyField: "email" | "domain",
): Promise<number> {
  if (records.length === 0) return 0;
  const type = TYPE_FOR_SLUG[collectionSlug] ?? collectionSlug;
  let stored = 0;
  for (let i = 0; i < records.length; i += PAGE_SIZE) {
    const chunk = records.slice(i, i + PAGE_SIZE);
    try {
      const items: SaveRecordInput[] = chunk.map((r) => ({
        ...(primaryKeyField === "email"
          ? { email: r.email }
          : { websiteUrl: r.domain }),
        properties: r,
      }));
      await saveRecords(type, collectionSlug, items);
      stored += chunk.length;
    } catch (error) {
      logger.warn("batchStore chunk failed", {
        collection: collectionSlug,
        offset: i,
        size: chunk.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return stored;
}

async function syncHubspotContacts(): Promise<{ scanned: number; stored: number }> {
  let after: string | undefined;
  const all: MappedContact[] = [];
  let pageCount = 0;
  while (true) {
    const page = await hubspot.contacts.list({
      limit: PAGE_SIZE,
      after,
      properties: HUBSPOT_CONTACT_PROPS,
    });
    pageCount++;
    for (const record of page.results) {
      const mapped = mapHubspotContact(record);
      if (mapped) all.push(mapped);
    }
    if (!page.paging?.next?.after) break;
    after = page.paging.next.after;
    // Safety cap: bail after 50 pages (5000 contacts) to avoid runaway in initial test runs.
    if (pageCount >= 50) {
      logger.warn("HubSpot contact sync hit safety cap of 50 pages", { pageCount });
      break;
    }
  }
  const stored = await batchStore("contacts", all, "email");
  return { scanned: all.length, stored };
}

async function syncHubspotCompanies(): Promise<{ scanned: number; stored: number }> {
  let after: string | undefined;
  const all: MappedCompany[] = [];
  let pageCount = 0;
  while (true) {
    const page = await hubspot.companies.list({
      limit: PAGE_SIZE,
      after,
      properties: HUBSPOT_COMPANY_PROPS,
    });
    pageCount++;
    for (const record of page.results) {
      const mapped = mapHubspotCompany(record);
      if (mapped) all.push(mapped);
    }
    if (!page.paging?.next?.after) break;
    after = page.paging.next.after;
    if (pageCount >= 50) {
      logger.warn("HubSpot company sync hit safety cap of 50 pages", { pageCount });
      break;
    }
  }
  const stored = await batchStore("companies", all, "domain");
  return { scanned: all.length, stored };
}

async function syncSalesforceContacts(): Promise<{ scanned: number; stored: number }> {
  // Single-page SOQL for now. For production, the salesforce adapter needs queryAll() that follows nextRecordsUrl.
  const soql = `SELECT Id, Email, FirstName, LastName, Title, Phone FROM Contact WHERE Email != null LIMIT 200`;
  const result = await salesforce.query<SalesforceContactRow>(soql);
  const mapped = result.records
    .map(mapSalesforceContact)
    .filter((c): c is MappedContact => c !== null);
  const stored = await batchStore("contacts", mapped, "email");
  return { scanned: mapped.length, stored };
}

export const crmSyncCore: OperationEntry = {
  name: "crm.sync-core",
  mode: "operation",
  description: "Sync CRM contacts (HubSpot+Salesforce) and companies (HubSpot) into Personize via paginated pull + batch memorize.",
  category: "sync",
  status: "live",
  idempotent: true,
  cost: "medium",
  run_mode: "on-trigger",
  guidelines_required: ["crm-writeback-policy", "data-hygiene"],
  run: async (input, context) => {
    const inputObj = (input ?? {}) as { crm?: string };
    const crm = inputObj.crm ?? context.crm ?? "hubspot";

    if (context.dryRun) {
      return {
        ok: true,
        runId: context.runId,
        operation: "crm.sync-core",
        dryRun: true,
        status: "live",
        summary: `[DRY RUN] Would pull ${crm} contacts ${crm === "hubspot" ? "and companies " : ""}and batch-store into Personize.`,
        metrics: { dry_run: true, crm },
      };
    }

    try {
      let contactResult: { scanned: number; stored: number };
      let companyResult: { scanned: number; stored: number } = { scanned: 0, stored: 0 };

      if (crm === "salesforce") {
        contactResult = await syncSalesforceContacts();
        // Salesforce companies sync is scaffolded — adapter needs sObject('Account') support and Website-extraction logic.
      } else {
        contactResult = await syncHubspotContacts();
        companyResult = await syncHubspotCompanies();
      }

      const totalStored = contactResult.stored + companyResult.stored;
      return {
        ok: true,
        runId: context.runId,
        operation: "crm.sync-core",
        dryRun: context.dryRun,
        status: "live",
        summary: `Synced ${contactResult.stored}/${contactResult.scanned} ${crm} contacts${
          crm === "hubspot" ? ` and ${companyResult.stored}/${companyResult.scanned} companies` : ""
        } into Personize.`,
        metrics: {
          crm,
          contacts_scanned: contactResult.scanned,
          contacts_stored: contactResult.stored,
          companies_scanned: companyResult.scanned,
          companies_stored: companyResult.stored,
          records_scanned: contactResult.scanned + companyResult.scanned,
          records_updated: totalStored,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("crm.sync-core failed", { crm, error: message });
      return {
        ok: false,
        runId: context.runId,
        operation: "crm.sync-core",
        dryRun: context.dryRun,
        status: "live",
        summary: `Sync failed: ${message}`,
        metrics: { crm, error: message },
      };
    }
  },
};
