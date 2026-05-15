import { PERSONIZE_API_BASE_URL, PERSONIZE_CRM_CONNECTION_ID } from "../core/config.js";
import type { CrmId } from "../core/operations/types.js";

export interface CrmPassthroughRequest {
  /** Active CRM. Determines which Personize endpoint is used. */
  crm: CrmId;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** Provider-side path (must start with `/`). See provider-specific allowlists in the CRM passthrough spec. */
  path: string;
  query?: Record<string, string | number | boolean | string[]>;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Override the org's default connection. Most callers can omit. */
  connectionId?: string;
}

export interface CrmPassthroughResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  body: T;
  meta: {
    provider: CrmId;
    upstreamRequestId: string | null;
    durationMs: number;
    rateLimit?: { remaining: number; resetAt?: string };
  };
}

/**
 * Calls a connected CRM through the Personize CRM Passthrough API.
 *
 * The Personize app handles OAuth, token refresh, rate limiting, and audit.
 * Customers connect their CRM once in the Personize dashboard; scripts here
 * only need a Personize API key (PERSONIZE_SECRET_KEY).
 *
 * See docs/crm-passthrough-api.md for the full provider contract.
 */
export async function crmPassthrough<T>(request: CrmPassthroughRequest): Promise<CrmPassthroughResponse<T>> {
  const connectionId = request.connectionId ?? PERSONIZE_CRM_CONNECTION_ID;

  const endpoint = `${PERSONIZE_API_BASE_URL}/api/v1/crm/${request.crm}/passthrough`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.PERSONIZE_SECRET_KEY}`,
      ...(connectionId ? { "x-personize-connection-id": connectionId } : {}),
    },
    body: JSON.stringify({
      method: request.method,
      path: request.path,
      query: request.query,
      body: request.body,
      headers: request.headers,
      timeoutMs: request.timeoutMs,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`CRM passthrough failed [${request.crm}]: ${response.status} ${errorText}`);
  }

  return (await response.json()) as CrmPassthroughResponse<T>;
}
