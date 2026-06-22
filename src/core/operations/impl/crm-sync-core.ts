import { hubspot } from "../../../adapters/hubspot/adapter.js";
import { salesforce } from "../../../adapters/salesforce/adapter.js";
import { logger } from "../../lib/logger.js";
import { saveRecords, type SaveRecordInput } from "../../lib/persist.js";
import {
  loadCollectionManifest,
  crmRequestFields,
  crmAssociationTypes,
  associationProperty,
  mapCrmProperties,
} from "../../lib/crm-field-map.js";
import type { OperationEntry } from "../types.js";

const PAGE_SIZE = 100;
// Safety cap: bail after 50 pages (~5000 records) to avoid runaway in initial test runs.
const MAX_PAGES = 50;

const TYPE_FOR_SLUG: Record<string, string> = {
  contacts: "contact",
  companies: "company",
};

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeDomain(domain: string): string {
  return domain.toLowerCase().replace(/^www\./, "");
}

// Personal / free-mail domains never represent a company account — never link on these.
const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com", "outlook.com",
  "live.com", "msn.com", "aol.com", "icloud.com", "me.com", "mac.com", "proton.me",
  "protonmail.com", "pm.me", "gmx.com", "gmx.net", "mail.com", "yandex.com", "zoho.com",
  "hey.com", "fastmail.com", "qq.com", "163.com", "126.com",
]);

/** Extract the lowercased domain from an email address, or undefined. */
function emailDomain(email: string): string | undefined {
  const at = email.lastIndexOf("@");
  if (at < 0) return undefined;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain || undefined;
}

/** Field/rename mapping is fully manifest-driven (see crm-field-map + collection manifests). */
async function batchStore(
  collectionSlug: string,
  records: Record<string, unknown>[],
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
          ? { email: r.email as string }
          : { websiteUrl: r.domain as string }),
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

async function syncHubspotCompanies(): Promise<{
  scanned: number;
  stored: number;
  idToDomain: Map<string, string>;
}> {
  const manifest = await loadCollectionManifest("companies");
  const requestProps = uniq([...crmRequestFields(manifest, "hubspot"), "hs_object_id"]);

  let after: string | undefined;
  let pageCount = 0;
  const all: Record<string, unknown>[] = [];
  // company id -> normalized domain, so contacts can resolve company_domain from associations.
  const idToDomain = new Map<string, string>();

  while (true) {
    const page = await hubspot.companies.list({ limit: PAGE_SIZE, after, properties: requestProps });
    pageCount++;
    for (const record of page.results) {
      const mapped = mapCrmProperties(manifest, record.properties, "hubspot");
      if (typeof mapped.domain !== "string" || !mapped.domain) continue; // domain is the primary key
      mapped.domain = normalizeDomain(mapped.domain);
      mapped.crm_source = "HubSpot";
      mapped.crm_record_id = record.id;
      idToDomain.set(record.id, mapped.domain as string);
      all.push(mapped);
    }
    if (!page.paging?.next?.after) break;
    after = page.paging.next.after;
    if (pageCount >= MAX_PAGES) {
      logger.warn("HubSpot company sync hit safety cap of 50 pages", { pageCount });
      break;
    }
  }

  const stored = await batchStore("companies", all, "domain");
  return { scanned: all.length, stored, idToDomain };
}

async function syncHubspotContacts(idToDomain: Map<string, string>): Promise<{ scanned: number; stored: number }> {
  const manifest = await loadCollectionManifest("contacts");
  const requestProps = uniq([...crmRequestFields(manifest, "hubspot"), "hs_object_id"]);
  const associationTypes = crmAssociationTypes(manifest, "hubspot"); // e.g. ["companies"]
  // company_domain property + the set of known company domains, for the email fallback.
  const companyProp = associationProperty(manifest, "hubspot", "companies");
  const companyDomains = new Set(idToDomain.values());

  let after: string | undefined;
  let pageCount = 0;
  const all: Record<string, unknown>[] = [];
  let linkedByAssociation = 0;
  let linkedByEmail = 0;

  while (true) {
    const page = await hubspot.contacts.list({
      limit: PAGE_SIZE,
      after,
      properties: requestProps,
      associations: associationTypes,
    });
    pageCount++;
    for (const record of page.results) {
      const mapped = mapCrmProperties(manifest, record.properties, "hubspot");
      if (typeof mapped.email !== "string" || !mapped.email) continue; // email is the primary key
      mapped.crm_source = "HubSpot";
      mapped.crm_object_type = "contact";
      mapped.crm_record_id = record.id;

      // 1. Authoritative: resolve declared associations (e.g. company_domain from the primary company association).
      for (const objectType of associationTypes) {
        const prop = associationProperty(manifest, "hubspot", objectType);
        if (!prop) continue;
        const companyId = record.associations?.[objectType]?.results?.[0]?.id;
        const domain = companyId ? idToDomain.get(companyId) : undefined;
        if (domain) {
          mapped[prop.systemName] = domain;
          if (objectType === "companies") linkedByAssociation++;
        }
      }

      // 2. Fallback: when no company association exists, link via the email domain —
      //    but only to a company we actually synced, and never on free-mail domains.
      if (companyProp && !mapped[companyProp.systemName]) {
        const ed = emailDomain(mapped.email);
        if (ed && !FREE_EMAIL_DOMAINS.has(ed) && companyDomains.has(ed)) {
          mapped[companyProp.systemName] = ed;
          linkedByEmail++;
        }
      }
      all.push(mapped);
    }
    if (!page.paging?.next?.after) break;
    after = page.paging.next.after;
    if (pageCount >= MAX_PAGES) {
      logger.warn("HubSpot contact sync hit safety cap of 50 pages", { pageCount });
      break;
    }
  }

  logger.info("HubSpot contact sync: company links resolved", {
    byAssociation: linkedByAssociation,
    byEmailDomain: linkedByEmail,
    total: all.length,
  });
  const stored = await batchStore("contacts", all, "email");
  return { scanned: all.length, stored };
}

async function syncSalesforceContacts(): Promise<{ scanned: number; stored: number }> {
  // Single-page SOQL for now. For production, the salesforce adapter needs queryAll() that follows nextRecordsUrl.
  const manifest = await loadCollectionManifest("contacts");
  const fields = uniq(["Id", ...crmRequestFields(manifest, "salesforce")]);
  const soql = `SELECT ${fields.join(", ")} FROM Contact WHERE Email != null LIMIT 200`;
  const result = await salesforce.query<Record<string, unknown>>(soql);

  const all: Record<string, unknown>[] = [];
  for (const record of result.records) {
    const mapped = mapCrmProperties(manifest, record, "salesforce");
    if (typeof mapped.email !== "string" || !mapped.email) continue;
    mapped.crm_source = "Salesforce";
    mapped.crm_object_type = "contact";
    mapped.crm_record_id = record.Id;
    all.push(mapped);
  }
  const stored = await batchStore("contacts", all, "email");
  return { scanned: all.length, stored };
}

export const crmSyncCore: OperationEntry = {
  name: "crm.sync-core",
  mode: "operation",
  description: "Sync CRM contacts (HubSpot+Salesforce) and companies (HubSpot) into Personize via paginated pull + batch memorize. Field mapping is manifest-driven; contacts are linked to companies via CRM associations.",
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
        // Companies first so contacts can resolve company_domain from the company id->domain index.
        const companies = await syncHubspotCompanies();
        companyResult = { scanned: companies.scanned, stored: companies.stored };
        contactResult = await syncHubspotContacts(companies.idToDomain);
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
