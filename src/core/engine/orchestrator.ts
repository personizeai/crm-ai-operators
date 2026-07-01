import { randomUUID } from "node:crypto";
import { client } from "../config.js";
import { logger } from "../lib/logger.js";
import { setProperties } from "../lib/persist.js";
import { isHostPrivate } from "../lib/ssrf-guard.js";

const CONFIG_RECORD_ID = "default";
const CONFIG_TYPE = "orchestrator_config";
const CONFIG_COLLECTION = "orchestrator-config";
const LOG_TYPE = "orchestrator_log";
const LOG_COLLECTION = "orchestrator-logs";

export interface OrchestratorConfig {
  config_key: string;
  status: "running" | "paused" | "error" | "setup";
  paused_reason?: string;
  paused_at?: string;
  paused_by?: string;
  error_count: number;
  error_threshold: number;
  notification_webhook_url?: string;
  notification_min_severity?: string;
  last_event_id?: string;
  last_poll_at?: string;
  webhook_registered?: boolean;
  mcp_registered?: boolean;
  updated_at?: string;
}

export interface OrchestratorLogEntry {
  log_id: string;
  run_id?: string;
  event_type: string;
  route_name?: string;
  target_name?: string;
  entity_email?: string;
  entity_type_ref?: string;
  severity: "info" | "warning" | "error" | "critical";
  summary: string;
  details_json?: string;
  error_message?: string;
  retry_count?: number;
  duration_ms?: number;
  created_at: string;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  config_key: CONFIG_RECORD_ID,
  status: "running",
  error_count: 0,
  error_threshold: 10,
};

export async function getOrchestratorConfig(): Promise<OrchestratorConfig> {
  try {
    const res = await (client as any).memory?.retrieve?.({
      collection: CONFIG_COLLECTION,
      filter: { config_key: CONFIG_RECORD_ID },
      limit: 1,
    });
    const record = res?.data?.[0];
    if (!record) return DEFAULT_CONFIG;
    return {
      ...DEFAULT_CONFIG,
      ...record,
      error_count: Number(record.error_count ?? 0),
      error_threshold: Number(record.error_threshold ?? 10),
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

async function writeConfig(updates: Partial<OrchestratorConfig>): Promise<void> {
  await setProperties(
    { type: CONFIG_TYPE, collection: CONFIG_COLLECTION, recordId: CONFIG_RECORD_ID },
    { config_key: CONFIG_RECORD_ID, updated_at: new Date().toISOString(), ...updates },
  );
}

export async function setOrchestratorStatus(
  status: OrchestratorConfig["status"],
  reason?: string,
  by = "engine",
): Promise<void> {
  const updates: Partial<OrchestratorConfig> = { status };
  if (status === "paused") {
    updates.paused_reason = reason;
    updates.paused_at = new Date().toISOString();
    updates.paused_by = by;
  }
  await writeConfig(updates);
  logger.info("Orchestrator status changed", { status, reason });
}

export async function bumpOrchestratorError(reason: string): Promise<OrchestratorConfig> {
  const config = await getOrchestratorConfig();
  const newCount = config.error_count + 1;
  await writeConfig({ error_count: newCount });
  logger.warn("Orchestrator error bumped", { count: newCount, threshold: config.error_threshold, reason });

  if (newCount >= config.error_threshold) {
    await setOrchestratorStatus("paused", `Auto-paused: error threshold reached (${newCount} errors). Last: ${reason}`, "engine");
    // Notify via outbound webhook if configured
    if (config.notification_webhook_url) {
      notifyOutbound(config.notification_webhook_url, {
        event: "engine.auto_paused",
        reason,
        error_count: newCount,
        threshold: config.error_threshold,
        timestamp: new Date().toISOString(),
      }).catch(() => undefined);
    }
  }

  return { ...config, error_count: newCount };
}

export async function resetOrchestratorErrors(): Promise<void> {
  await writeConfig({ error_count: 0 });
}

export async function writeOrchestratorLog(
  entry: Omit<OrchestratorLogEntry, "log_id" | "created_at">,
): Promise<void> {
  const log_id = `log_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const full: OrchestratorLogEntry = {
    log_id,
    created_at: new Date().toISOString(),
    ...entry,
  };
  try {
    await setProperties(
      { type: LOG_TYPE, collection: LOG_COLLECTION, recordId: log_id },
      { ...full },
    );
  } catch (err) {
    // Non-fatal — log locally only
    logger.warn("Failed to write orchestrator log", { log_id, error: String(err) });
  }
}

// Fast pre-check: block obvious private hostnames/IPs before DNS resolution
const PRIVATE_HOSTNAME_RE = /^(localhost$|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/;

async function notifyOutbound(url: string, payload: unknown): Promise<void> {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return;
    // Fast hostname pre-check (obvious cases, avoids DNS round-trip)
    if (PRIVATE_HOSTNAME_RE.test(parsed.hostname)) return;
    // DNS resolution check — catches SSRF via domains → private IPs, IPv6 ranges,
    // IPv4-mapped IPv6 (::ffff:169.254.x.x), and reduces DNS-rebinding window
    if (await isHostPrivate(parsed.hostname)) return;
    const mod = parsed.protocol === "https:" ? await import("node:https") : await import("node:http");
    const body = JSON.stringify(payload);
    return new Promise((resolve) => {
      const req = mod.request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        timeout: 5000,
      }, (res) => { res.resume(); resolve(); });
      req.on("error", () => resolve());
      req.on("timeout", () => { req.destroy(); resolve(); });
      req.end(body);
    });
  } catch {
    // Fire-and-forget: URL parse error or import failure — silently ignore
  }
}
