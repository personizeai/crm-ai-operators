import { client } from "../config.js";
import { logger } from "../lib/logger.js";

// Events the engine needs to receive from Personize.
// Adjust this list as the engine adds new event handlers.
const REQUIRED_EVENTS = [
  "memory.updated",
  "subagent.completed",
  "subagent.failed",
];

export interface RegisterWebhooksResult {
  registered: string[];
  skipped: string[];
  errors: string[];
}

export async function registerWebhooks(): Promise<RegisterWebhooksResult> {
  const result: RegisterWebhooksResult = { registered: [], skipped: [], errors: [] };

  const webhookUrl = process.env.PERSONIZE_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error("PERSONIZE_WEBHOOK_URL is required. Set it to your deployed service's /webhook endpoint URL.");
  }

  // Fetch existing webhooks to avoid duplicates.
  const existingRes = await (client as any).webhooks?.list?.().catch(() => null);
  const existingUrls = new Set<string>((existingRes?.data ?? []).map((w: any) => `${w.url}::${w.event}`));

  for (const event of REQUIRED_EVENTS) {
    const key = `${webhookUrl}::${event}`;
    if (existingUrls.has(key)) {
      result.skipped.push(event);
      logger.info("Webhook already registered; skipping", { event, webhookUrl });
      continue;
    }

    try {
      await (client as any).webhooks?.create?.({ url: webhookUrl, event });
      result.registered.push(event);
      logger.info("Registered webhook", { event, webhookUrl });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      result.errors.push(`${event}: ${msg}`);
      logger.warn("Failed to register webhook", { event, error: msg });
    }
  }

  return result;
}
