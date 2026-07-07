import { crmPassthrough, type CrmPassthroughResponse } from "../passthrough.js";

/**
 * Salesforce adapter.
 *
 * Engagement side-channel over the Personize CRM passthrough, scoped to
 * Salesforce. Mirrors the HubSpot adapter's typed surface so a calling agent can
 * pattern-match between them. Bulk record import / write-back is NOT this
 * adapter's job — that flows through the Personize-managed sync
 * (`src/adapters/personize-sync.ts`); this surface is for bounded reads, CRUD,
 * and SOQL against the REST/Tooling APIs.
 *
 * Path allowlist (enforced by Personize): /services/data/, /services/apexrest/.
 *
 * Lead vs Contact: Salesforce splits inbound prospects (Lead) from post-
 * conversion people (Contact). The Personize `contacts` collection unifies both
 * via the `crm_object_type` property. Route person reads/writes with
 * `salesforce.person(crmObjectType)` or `salesforceObjectFor(crmObjectType)`.
 */

/** Data API version. Bump in one place when Salesforce advances the pinned version. */
export const SF_API_VERSION = "v60.0";

export interface SalesforceQueryResult<T> {
  totalSize: number;
  done: boolean;
  records: T[];
  /** Present when `done` is false — a `/services/data/...` path to the next page. */
  nextRecordsUrl?: string;
}

/** Result of a create/upsert against an sObject. */
export interface SalesforceWriteResult {
  id: string;
  success: boolean;
  errors?: unknown[];
  /** upsert-only: true when the row was inserted rather than updated. */
  created?: boolean;
}

/** The two Salesforce person objects the unified `contacts` collection spans. */
export type SalesforcePersonObject = "Lead" | "Contact";

/**
 * Resolve which Salesforce object a unified contact record maps to. Pure — used
 * by both the adapter and callers routing a write. Defaults to Contact; only an
 * explicit `lead` (case-insensitive) routes to Lead.
 */
export function salesforceObjectFor(crmObjectType?: string | null): SalesforcePersonObject {
  return String(crmObjectType ?? "").toLowerCase() === "lead" ? "Lead" : "Contact";
}

async function get<T>(path: string): Promise<CrmPassthroughResponse<T>> {
  return crmPassthrough<T>({ crm: "salesforce", method: "GET", path });
}

async function post<T>(path: string, body: unknown): Promise<CrmPassthroughResponse<T>> {
  return crmPassthrough<T>({ crm: "salesforce", method: "POST", path, body });
}

async function patch<T>(path: string, body: unknown): Promise<CrmPassthroughResponse<T>> {
  return crmPassthrough<T>({ crm: "salesforce", method: "PATCH", path, body });
}

async function del<T>(path: string): Promise<CrmPassthroughResponse<T>> {
  return crmPassthrough<T>({ crm: "salesforce", method: "DELETE", path });
}

const dataPath = (suffix: string) => `/services/data/${SF_API_VERSION}${suffix}`;

/** Build a bounded SOQL string from parts. Fields default to `Id` when omitted. */
export function buildSoql(object: string, opts: { fields?: string[]; where?: string; limit?: number } = {}): string {
  const fields = opts.fields?.length ? opts.fields.join(", ") : "Id";
  const where = opts.where ? ` WHERE ${opts.where}` : "";
  const limit = opts.limit ? ` LIMIT ${opts.limit}` : "";
  return `SELECT ${fields} FROM ${object}${where}${limit}`;
}

function sobjectApi(object: string) {
  return {
    get: async <T>(id: string, fields?: string[]): Promise<T> => {
      const fieldQuery = fields?.length ? `?fields=${encodeURIComponent(fields.join(","))}` : "";
      const res = await get<T>(dataPath(`/sobjects/${object}/${id}${fieldQuery}`));
      return res.body;
    },
    create: async (fields: Record<string, unknown>): Promise<SalesforceWriteResult> => {
      const res = await post<SalesforceWriteResult>(dataPath(`/sobjects/${object}`), fields);
      return res.body;
    },
    /** PATCH a record by id. Salesforce returns 204 No Content on success. */
    update: async (id: string, fields: Record<string, unknown>): Promise<void> => {
      await patch<void>(dataPath(`/sobjects/${object}/${id}`), fields);
    },
    /**
     * Upsert by an external-id field (`externalField`/`externalValue`). Inserts
     * when no row matches, updates when one does — the idempotent write the sync
     * and scoring paths want.
     */
    upsert: async (
      externalField: string,
      externalValue: string,
      fields: Record<string, unknown>,
    ): Promise<SalesforceWriteResult> => {
      const res = await patch<SalesforceWriteResult>(
        dataPath(`/sobjects/${object}/${externalField}/${encodeURIComponent(externalValue)}`),
        fields,
      );
      // 204 (update, no body) → synthesize a result; 200/201 (insert) carries one.
      return res.body ?? { id: "", success: true, created: false };
    },
    delete: async (id: string): Promise<void> => {
      await del<void>(dataPath(`/sobjects/${object}/${id}`));
    },
  };
}

export const salesforce = {
  /** Single-page SOQL query. Use `queryAll` to auto-follow pagination. */
  query: async <T>(soql: string): Promise<SalesforceQueryResult<T>> => {
    const res = await get<SalesforceQueryResult<T>>(dataPath(`/query?q=${encodeURIComponent(soql)}`));
    return res.body;
  },

  /**
   * Run a SOQL query and follow `nextRecordsUrl` until the result set is
   * exhausted, returning every record. `maxRecords` caps the walk so an
   * unbounded query can't run away.
   */
  queryAll: async <T>(soql: string, opts: { maxRecords?: number } = {}): Promise<T[]> => {
    const cap = opts.maxRecords ?? 10_000;
    const first = await get<SalesforceQueryResult<T>>(dataPath(`/query?q=${encodeURIComponent(soql)}`));
    const records = [...first.body.records];
    let next = first.body.nextRecordsUrl;
    while (next && records.length < cap) {
      // nextRecordsUrl is already a `/services/data/...` path — pass it through as-is.
      const page = await get<SalesforceQueryResult<T>>(next);
      records.push(...page.body.records);
      next = page.body.nextRecordsUrl;
    }
    return records.slice(0, cap);
  },

  /** Generic sObject CRUD. `object` is the API name, e.g. "Contact", "Account". */
  sobject: (object: string) => sobjectApi(object),

  /**
   * Person surface that routes to Lead or Contact from the unified
   * `crm_object_type`. Use for writing `Personize_*__c` scores/enrichment back
   * to whichever object the record actually lives on.
   */
  person: (crmObjectType?: string | null) => sobjectApi(salesforceObjectFor(crmObjectType)),

  /** Contacts convenience surface (post-conversion people). */
  contacts: {
    list: async <T = Record<string, unknown>>(
      opts: { fields?: string[]; where?: string; limit?: number } = {},
    ): Promise<SalesforceQueryResult<T>> => {
      const fields = opts.fields ?? ["Id", "FirstName", "LastName", "Email", "Title"];
      return salesforce.query<T>(buildSoql("Contact", { ...opts, fields }));
    },
    ...sobjectApi("Contact"),
  },

  /** Leads convenience surface (inbound prospects, pre-conversion). */
  leads: {
    list: async <T = Record<string, unknown>>(
      opts: { fields?: string[]; where?: string; limit?: number } = {},
    ): Promise<SalesforceQueryResult<T>> => {
      const fields = opts.fields ?? ["Id", "FirstName", "LastName", "Email", "Title", "Company", "Status"];
      return salesforce.query<T>(buildSoql("Lead", { ...opts, fields }));
    },
    ...sobjectApi("Lead"),
  },

  /** Accounts convenience surface (companies). */
  companies: {
    list: async <T = Record<string, unknown>>(
      opts: { fields?: string[]; where?: string; limit?: number } = {},
    ): Promise<SalesforceQueryResult<T>> => {
      const fields = opts.fields ?? ["Id", "Name", "Website", "Industry", "NumberOfEmployees"];
      return salesforce.query<T>(buildSoql("Account", { ...opts, fields }));
    },
    ...sobjectApi("Account"),
  },
};
