import "dotenv/config";
import { Personize } from "@personize/sdk";
import { logger } from "./lib/logger.js";

export const DRY_RUN = process.env.DRY_RUN !== "false";
export const PERSONIZE_API_BASE_URL =
  process.env.PERSONIZE_API_BASE_URL ?? "https://api.personize.ai";
export const PERSONIZE_CRM_CONNECTION_ID = process.env.PERSONIZE_CRM_CONNECTION_ID;

const MISSING_KEY_MESSAGE =
  "PERSONIZE_SECRET_KEY is not set. Add it to .env or your shell — see .env.example. Get a key at https://app.personize.ai.";

let _client: Personize | undefined;

function buildClient(): Personize {
  const key = process.env.PERSONIZE_SECRET_KEY;
  if (!key) throw new Error(MISSING_KEY_MESSAGE);
  return new Personize({ secretKey: key, timeout: 60_000 });
}

export const client: Personize = new Proxy({} as Personize, {
  get(_target, prop) {
    if (!_client) _client = buildClient();
    return Reflect.get(_client, prop, _client);
  },
});

export function ensurePersonizeKey(): void {
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
