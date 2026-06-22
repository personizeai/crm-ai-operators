import { crmPassthrough, type CrmPassthroughResponse } from "../passthrough.js";

/**
 * HubSpot adapter.
 *
 * Thin wrapper over the Personize CRM passthrough that scopes calls to HubSpot.
 * Customers connect HubSpot once in the Personize dashboard; this adapter then
 * issues bounded reads/writes against the HubSpot REST API through Personize.
 *
 * Path allowlist (enforced by Personize): /crm/, /marketing/, /cms/, /automation/,
 * /files/, /communication-preferences/, /properties/, /owners/, /oauth/.
 */

export interface HubspotPaging {
  next?: { after: string };
}

export interface HubspotPage<T> {
  results: T[];
  paging?: HubspotPaging;
}

export interface HubspotContact {
  id: string;
  properties: Record<string, string>;
  /** Present when `list`/`get` is called with `associations`. Keyed by object type, e.g. "companies". */
  associations?: Record<string, { results: Array<{ id: string; type?: string }> }>;
  createdAt: string;
  updatedAt: string;
}

export interface HubspotCompany {
  id: string;
  properties: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

async function get<T>(path: string, query?: Record<string, string | number | boolean | string[]>): Promise<CrmPassthroughResponse<T>> {
  return crmPassthrough<T>({ crm: "hubspot", method: "GET", path, query });
}

async function post<T>(path: string, body: unknown): Promise<CrmPassthroughResponse<T>> {
  return crmPassthrough<T>({ crm: "hubspot", method: "POST", path, body });
}

async function patch<T>(path: string, body: unknown): Promise<CrmPassthroughResponse<T>> {
  return crmPassthrough<T>({ crm: "hubspot", method: "PATCH", path, body });
}

export const hubspot = {
  contacts: {
    list: async (opts: { limit?: number; after?: string; properties?: string[]; associations?: string[] } = {}) => {
      const query: Record<string, string | number> = { limit: opts.limit ?? 100 };
      if (opts.after) query.after = opts.after;
      if (opts.properties?.length) query.properties = opts.properties.join(",");
      // `associations=companies` makes HubSpot include each contact's associated
      // company ids under associations.companies.results[].id — used to resolve company_domain.
      if (opts.associations?.length) query.associations = opts.associations.join(",");
      const res = await get<HubspotPage<HubspotContact>>("/crm/v3/objects/contacts", query);
      return res.body;
    },
    get: async (id: string, properties?: string[]) => {
      const query = properties?.length ? { properties: properties.join(",") } : undefined;
      const res = await get<HubspotContact>(`/crm/v3/objects/contacts/${id}`, query);
      return res.body;
    },
    create: async (props: Record<string, string>) => {
      const res = await post<HubspotContact>("/crm/v3/objects/contacts", { properties: props });
      return res.body;
    },
    update: async (id: string, props: Record<string, string>) => {
      const res = await patch<HubspotContact>(`/crm/v3/objects/contacts/${id}`, { properties: props });
      return res.body;
    },
  },
  companies: {
    list: async (opts: { limit?: number; after?: string; properties?: string[] } = {}) => {
      const query: Record<string, string | number> = { limit: opts.limit ?? 100 };
      if (opts.after) query.after = opts.after;
      if (opts.properties?.length) query.properties = opts.properties.join(",");
      const res = await get<HubspotPage<HubspotCompany>>("/crm/v3/objects/companies", query);
      return res.body;
    },
    get: async (id: string, properties?: string[]) => {
      const query = properties?.length ? { properties: properties.join(",") } : undefined;
      const res = await get<HubspotCompany>(`/crm/v3/objects/companies/${id}`, query);
      return res.body;
    },
  },
  // deals, tasks, notes, engagements, associations: scaffold these as needed.
};
