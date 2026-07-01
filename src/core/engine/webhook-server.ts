import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { randomUUID } from "node:crypto";
import { logger } from "../lib/logger.js";
import { setProperties } from "../lib/persist.js";
import { dispatch, type IncomingEvent } from "./dispatcher.js";
import { getOrchestratorConfig, writeOrchestratorLog } from "./orchestrator.js";

const WEBHOOK_SECRET = process.env["PERSONIZE_WEBHOOK_SECRET"];
// ALLOW_UNSIGNED_WEBHOOKS=1 is the explicit dev-only opt-in to bypass HMAC.
// Without it, missing PERSONIZE_WEBHOOK_SECRET rejects all incoming webhooks.
const ALLOW_UNSIGNED = process.env["ALLOW_UNSIGNED_WEBHOOKS"] === "1";
if (!WEBHOOK_SECRET) {
  if (ALLOW_UNSIGNED) {
    logger.warn("PERSONIZE_WEBHOOK_SECRET not set — HMAC disabled via ALLOW_UNSIGNED_WEBHOOKS=1 (dev only)");
  } else {
    logger.warn("PERSONIZE_WEBHOOK_SECRET not set — all webhook requests will be rejected. Set ALLOW_UNSIGNED_WEBHOOKS=1 to bypass in dev.");
  }
}

const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB — reject before HMAC to prevent OOM

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function validateSignature(body: Buffer, signature: string | undefined): boolean {
  if (!WEBHOOK_SECRET) return ALLOW_UNSIGNED; // only if explicitly opted in
  if (!signature) return false;
  const computed = createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
  // Strip "sha256=" prefix if present (some providers send prefixed signatures)
  const sig = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  try {
    // Use "hex" encoding so both buffers are 32 raw bytes — ensures equal length for timingSafeEqual
    return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(computed, "hex"));
  } catch {
    return false;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(json);
}

async function handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: Buffer;
  try {
    body = await readBody(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "Request body too large") {
      sendJson(res, 413, { error: "request body too large" });
    } else {
      sendJson(res, 400, { error: "failed to read body" });
    }
    return;
  }
  const signature = req.headers["x-personize-signature"] as string | undefined;

  if (!validateSignature(body, signature)) {
    logger.warn("Webhook: invalid signature", { ip: req.socket.remoteAddress });
    sendJson(res, 401, { error: "invalid signature" });
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    sendJson(res, 400, { error: "invalid JSON" });
    return;
  }

  const event_id = `evt_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const received_at = new Date().toISOString();

  // Respond immediately; process async
  sendJson(res, 200, { received: true, event_id });

  const event: IncomingEvent = {
    event_id,
    event_type: (payload["event"] ?? payload["event_type"] ?? "unknown") as string,
    entity_email: (payload["entity_email"] ?? payload["email"]) as string | undefined,
    entity_type_ref: (payload["entity_type"] ?? payload["entity_type_ref"]) as string | undefined,
    payload,
    received_at,
  };

  // Write to webhook-events collection (non-blocking)
  setProperties(
    { type: "webhook_event", collection: "webhook-events", recordId: event_id },
    {
      event_id,
      event_type: event.event_type,
      entity_email: event.entity_email ?? "",
      entity_type_ref: event.entity_type_ref ?? "",
      payload_json: JSON.stringify(payload),
      status: "received",
      received_at,
    },
  ).catch((err) => logger.warn("Failed to write webhook-event", { event_id, error: String(err) }));

  // Write to orchestrator log (non-blocking)
  writeOrchestratorLog({
    event_type: "webhook.received",
    severity: "info",
    summary: `Webhook received: ${event.event_type} (${event_id})`,
    entity_email: event.entity_email,
    entity_type_ref: event.entity_type_ref,
    details_json: JSON.stringify({ event_id, event_type: event.event_type }),
  }).catch(() => undefined);

  // Dispatch async — do not await so we don't block
  dispatch(event)
    .then((result) => {
      logger.info("Dispatch cycle done", { event_id, dispatched: result.dispatched, errors: result.errors });
      // Update webhook-event status
      setProperties(
        { type: "webhook_event", collection: "webhook-events", recordId: event_id },
        { status: "processed", processed_at: new Date().toISOString() },
      ).catch(() => undefined);
    })
    .catch((err) => {
      logger.error("Dispatch cycle failed", { event_id, error: String(err) });
      setProperties(
        { type: "webhook_event", collection: "webhook-events", recordId: event_id },
        { status: "failed", error: String(err), processed_at: new Date().toISOString() },
      ).catch(() => undefined);
    });
}

async function handleHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const config = await getOrchestratorConfig().catch(() => ({ status: "unknown" }));
  sendJson(res, 200, {
    ok: true,
    engine: config.status,
    timestamp: new Date().toISOString(),
  });
}

export function createWebhookServer(): ReturnType<typeof createServer> {
  return createServer(async (req, res) => {
    try {
      const url = req.url?.split("?")[0] ?? "/";
      const method = req.method ?? "GET";

      if (method === "POST" && url === "/webhook") {
        await handleWebhook(req, res);
      } else if (method === "GET" && url === "/health") {
        await handleHealth(req, res);
      } else {
        sendJson(res, 404, { error: "not found" });
      }
    } catch (err) {
      logger.error("Webhook server error", { error: String(err) });
      if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
    }
  });
}

export function startWebhookServer(): ReturnType<typeof createServer> {
  const port = Number(process.env["ENGINE_PORT"] ?? 3000);
  const server = createWebhookServer();
  server.listen(port, () => {
    logger.info("Webhook server listening", { port });
  });
  return server;
}

export function stopWebhookServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}
