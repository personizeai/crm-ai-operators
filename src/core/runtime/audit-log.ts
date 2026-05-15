import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { logger } from "../lib/logger.js";

export interface AuditEvent {
  runId: string;
  operation: string;
  event: string;
  dryRun: boolean;
  timestamp?: string;
  meta?: unknown;
}

const AUDIT_DIR = path.join(process.cwd(), "data", "audit");
let auditDirEnsured = false;

async function ensureAuditDir(): Promise<void> {
  if (auditDirEnsured) return;
  await mkdir(AUDIT_DIR, { recursive: true });
  auditDirEnsured = true;
}

export async function writeAuditEvent(event: AuditEvent): Promise<void> {
  await ensureAuditDir();
  const dated = new Date().toISOString().slice(0, 10);
  const file = path.join(AUDIT_DIR, `${dated}.jsonl`);
  await appendFile(
    file,
    `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`,
    "utf8",
  );
}

export async function safeAudit(event: AuditEvent): Promise<void> {
  try {
    await writeAuditEvent(event);
  } catch (error) {
    logger.warn("Failed to write audit event", {
      runId: event.runId,
      operation: event.operation,
      event: event.event,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
