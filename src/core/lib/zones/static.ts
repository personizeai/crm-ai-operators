import type { ZoneSchema } from './schema.js';
import { processZoneOutput, type ZoneResult } from './postprocess.js';

/**
 * Standard (no-AI) zone mode: copy comes from a dashboard-editable guideline
 * body written as `## <zone_name>` markdown sections, so a customer can change
 * standardized landing copy without a per-lead generation call or a deploy.
 * Ported from the production reference deployment's static-zone pattern. Each
 * section still runs through processZoneOutput, so the fail-safe fallback and
 * length rules apply identically to the personalized path.
 */
export function parseStaticZones(guidelineBody: string, schema: ZoneSchema): Record<string, ZoneResult> {
  const sections = extractSections(guidelineBody);
  const results: Record<string, ZoneResult> = {};
  for (const zone of schema.zones) {
    const raw = sections[zone.name];
    results[zone.name] = raw === undefined || raw.trim() === ''
      ? { text: zone.fallback, used_fallback: true, notes: ['standard mode: no copy for this zone, fallback used'] }
      : processZoneOutput(raw, zone);
  }
  return results;
}

function extractSections(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = body.split(/\r?\n/);
  let current: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (current !== null) out[current] = buf.join('\n').trim();
    buf = [];
  };
  for (const line of lines) {
    const h = line.match(/^##\s+([a-z][a-z0-9_]*)\s*$/);
    if (h && h[1] !== undefined) {
      flush();
      current = h[1];
    } else if (current !== null) {
      buf.push(line);
    }
  }
  flush();
  return out;
}
