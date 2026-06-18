import type { CrmPassthroughResult } from "@personize/sdk";
import { client } from "../core/config.js";
import { PERSONIZE_CRM_CONNECTION_ID } from "../core/config.js";
import type { CrmId } from "../core/operations/types.js";

export interface CrmPassthroughRequest {
  /** Active CRM. Determines which native SDK passthrough client is used. */
  crm: CrmId;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** Provider-side path (must start with `/`). See provider-specific allowlists in the CRM passthrough spec. */
  path: string;
  query?: Record<string, string | number | boolean | string[]>;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /**
   * Override the org's default connection. Forwarded as `x-personize-connection-id`.
   * Most callers omit it — the SDK uses the org's default connection.
   */
  connectionId?: string;
}

/**
 * Response shape is the SDK's CrmPassthroughResult (status / headers / body / meta).
 * Re-exported under the historical name so adapters and operations keep one type.
 */
export type CrmPassthroughResponse<T = unknown> = CrmPassthroughResult<T>;

/**
 * Calls a connected CRM through Personize's native CRM passthrough.
 *
 * Delegates to the SDK's `client.<crm>.request(...)` (added in @personize/sdk
 * 0.14.0), which the Personize app backs with OAuth, token refresh, rate
 * limiting, retry, and an audit log. Scripts only need a Personize API key.
 *
 * Previously this issued a raw `fetch` against `/api/v1/crm/<crm>/passthrough`
 * with a hand-attached Bearer header; that credential plumbing now lives in the
 * SDK.
 */
export async function crmPassthrough<T>(request: CrmPassthroughRequest): Promise<CrmPassthroughResponse<T>> {
  const crmClient = (client as unknown as Record<string, { request?: <R>(opts: unknown) => Promise<CrmPassthroughResult<R>> }>)[
    request.crm
  ];
  if (!crmClient || typeof crmClient.request !== "function") {
    throw new Error(
      `CRM passthrough unavailable for "${request.crm}": client.${request.crm}.request not found. ` +
        "Requires @personize/sdk >= 0.14.0 and a supported provider (hubspot | salesforce).",
    );
  }

  const connectionId = request.connectionId ?? PERSONIZE_CRM_CONNECTION_ID;
  const headers = connectionId
    ? { ...(request.headers ?? {}), "x-personize-connection-id": connectionId }
    : request.headers;

  return crmClient.request<T>({
    method: request.method,
    path: request.path,
    query: request.query,
    body: request.body,
    headers,
    timeoutMs: request.timeoutMs,
  });
}
