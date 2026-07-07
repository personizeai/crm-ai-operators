import "dotenv/config";
import { Personize } from "@personize/sdk";
import { logger } from "./lib/logger.js";
import { createGatewayClient } from "./lib/gateway-client.js";

export const DRY_RUN = process.env.DRY_RUN !== "false";
export const PERSONIZE_API_BASE_URL =
  process.env.PERSONIZE_API_BASE_URL ?? "https://api.personize.ai";
export const PERSONIZE_CRM_CONNECTION_ID = process.env.PERSONIZE_CRM_CONNECTION_ID;

// ---------------------------------------------------------------------------
// Backend mode + capabilities.
//
// hosted (default): the Personize Cloud SDK — full surface.
// private: the self-hosted Personize Private gateway (one Docker container,
//   your Postgres, your LLM). Selected by PERSONIZE_MODE=private, or auto when
//   PERSONIZE_GATEWAY_URL is set. Some hosted-only features (autonomous
//   subagents, server-side output→property sync, rubric eval) are not present
//   on the gateway; capability flags gate them and operations fall back or are
//   refused with a clear message.
// ---------------------------------------------------------------------------

export type PersonizeMode = "hosted" | "private";

export const PERSONIZE_MODE: PersonizeMode =
  (process.env.PERSONIZE_MODE as PersonizeMode | undefined) ??
  (process.env.PERSONIZE_GATEWAY_URL ? "private" : "hosted");

export interface Capabilities {
  /** Structured property-filter queries (retrieveRecords). Both backends. */
  filteredQuery: boolean;
  /** Autonomous subagent runs (ai({ autonomous: true })). Hosted only today. */
  subagent: boolean;
  /** Server-side <output>→property sync. Hosted only; private uses client-side fallback. */
  serverOutputs: boolean;
  /** Server-side rubric eval (ai evaluate). Hosted only today. */
  evaluate: boolean;
  /** Bulk memorize (hosted Bedrock Batch / gateway /memory/import). Both. */
  bulkMemorize: boolean;
  /** Platform emits subscribable events. Hosted yes; private uses schedules/polling. */
  webhooks: boolean;
}

const HOSTED_CAPS: Capabilities = {
  filteredQuery: true,
  subagent: true,
  serverOutputs: true,
  evaluate: true,
  bulkMemorize: true,
  webhooks: true,
};

const PRIVATE_CAPS: Capabilities = {
  filteredQuery: true,
  subagent: false,
  serverOutputs: false,
  evaluate: false,
  bulkMemorize: true,
  webhooks: false,
};

export const CAPABILITIES: Capabilities = PERSONIZE_MODE === "private" ? PRIVATE_CAPS : HOSTED_CAPS;

/** True when the active backend supports a capability. Unknown keys → false. */
export function hasCapability(cap: string): boolean {
  return Boolean((CAPABILITIES as unknown as Record<string, boolean>)[cap]);
}

const MISSING_KEY_MESSAGE =
  "PERSONIZE_SECRET_KEY is not set. Add it to .env or your shell — see .env.example. Get a key at https://app.personize.ai.";

const MISSING_GATEWAY_MESSAGE =
  "PERSONIZE_MODE=private requires PERSONIZE_GATEWAY_URL and PERSONIZE_GATEWAY_KEY. See docs/PERSONIZE-PRIVATE.md.";

// The gateway client is structurally compatible with the subset of the Personize
// SDK the lib modules use (client.retrieve / memory.* / collections.* / context.* /
// ai.*). We type the shared client as `any` so both back the same call sites.
let _client: any;

function buildClient(): any {
  if (PERSONIZE_MODE === "private") {
    const url = process.env.PERSONIZE_GATEWAY_URL;
    const key = process.env.PERSONIZE_GATEWAY_KEY;
    if (!url || !key) throw new Error(MISSING_GATEWAY_MESSAGE);
    logger.info("Personize backend: private gateway", { url });
    return createGatewayClient({ baseUrl: url, apiKey: key });
  }
  const key = process.env.PERSONIZE_SECRET_KEY;
  if (!key) throw new Error(MISSING_KEY_MESSAGE);
  return new Personize({ secretKey: key, timeout: 60_000 });
}

export const client: Personize = new Proxy({} as Personize, {
  get(_target, prop) {
    if (!_client) _client = buildClient();
    return Reflect.get(_client, prop, _client);
  },
}) as Personize;

export function ensurePersonizeKey(): void {
  if (PERSONIZE_MODE === "private") {
    if (!process.env.PERSONIZE_GATEWAY_URL || !process.env.PERSONIZE_GATEWAY_KEY) {
      throw new Error(MISSING_GATEWAY_MESSAGE);
    }
    return;
  }
  if (!process.env.PERSONIZE_SECRET_KEY) throw new Error(MISSING_KEY_MESSAGE);
}

export async function verifySetup() {
  ensurePersonizeKey();
  const me = await client.me();
  logger.info("Personize auth verified", {
    org: me.data?.organization,
    rateLimit: me.data?.plan?.limits?.maxApiCallsPerMinute,
  });
  return me.data;
}
