import { crmPassthrough, type CrmPassthroughResponse } from "../passthrough.js";

/**
 * Salesforce adapter.
 *
 * STATUS: scaffold. The shape mirrors the HubSpot adapter so a calling agent
 * can pattern-match between them. Wire SOQL, sObject CRUD, composite, and bulk
 * methods incrementally as the Salesforce wedge product is built out.
 *
 * Path allowlist (enforced by Personize): /services/data/, /services/apexrest/.
 *
 * Note on Lead vs Contact: Salesforce splits inbound prospects (Lead) from
 * post-conversion people (Contact). The Personize `contacts` collection
 * unifies both via the `crm_object_type` property. The adapter is responsible
 * for routing reads/writes to the right Salesforce object based on that flag.
 */

export interface SalesforceQueryResult<T> {
  totalSize: number;
  done: boolean;
  records: T[];
  nextRecordsUrl?: string;
}

async function get<T>(path: string): Promise<CrmPassthroughResponse<T>> {
  return crmPassthrough<T>({ crm: "salesforce", method: "GET", path });
}

async function post<T>(path: string, body: unknown): Promise<CrmPassthroughResponse<T>> {
  return crmPassthrough<T>({ crm: "salesforce", method: "POST", path, body });
}

export const salesforce = {
  /** Single-page SOQL query. Use queryAll for auto-pagination once implemented. */
  query: async <T>(soql: string): Promise<SalesforceQueryResult<T>> => {
    const path = `/services/data/v60.0/query?q=${encodeURIComponent(soql)}`;
    const res = await get<SalesforceQueryResult<T>>(path);
    return res.body;
  },
  /** Generic sObject helpers. Expand the per-object surface as needed. */
  sobject: <T extends string>(object: T) => ({
    get: async (id: string, fields?: string[]) => {
      const fieldQuery = fields?.length ? `?fields=${fields.join(",")}` : "";
      const res = await get(`/services/data/v60.0/sobjects/${object}/${id}${fieldQuery}`);
      return res.body;
    },
    create: async (fields: Record<string, unknown>) => {
      const res = await post<{ id: string; success: true }>(`/services/data/v60.0/sobjects/${object}`, fields);
      return res.body;
    },
    // update, upsert, delete: scaffold as the Salesforce wedge is built out.
  }),
};
