import type { ZoneSchema } from './schema.js';
import type { ZoneResult } from './postprocess.js';

const PREFIX_RE = /^[a-z][a-z0-9_]*_$/;
const DEFAULT_PREFIX = 'personize_zone_';

/**
 * Zone output becomes namespaced CRM custom properties: the default
 * delivery adapter (spec Section 8). The manifest fragment matches the
 * engine's property-manifest shape so WS4-B wiring can hand it to
 * setup.apply for auto-provisioning on HubSpot and Salesforce.
 */
export function mapZonesToProperties(
  results: Record<string, ZoneResult>,
  opts: { prefix?: string } = {}
): Record<string, string> {
  const prefix = opts.prefix ?? DEFAULT_PREFIX;
  if (!PREFIX_RE.test(prefix)) throw new Error(`invalid property prefix: ${prefix} (lowercase snake, trailing underscore)`);
  const out: Record<string, string> = {};
  for (const [name, result] of Object.entries(results)) {
    out[`${prefix}${name}`] = result.text;
  }
  return out;
}

export function buildPropertyManifestFragment(
  schema: ZoneSchema,
  opts: { prefix?: string } = {}
): { name: string; label: string; type: 'text'; source: 'inferred'; writeback: true }[] {
  const prefix = opts.prefix ?? DEFAULT_PREFIX;
  if (!PREFIX_RE.test(prefix)) throw new Error(`invalid property prefix: ${prefix} (lowercase snake, trailing underscore)`);
  return schema.zones.map((z) => ({
    name: `${prefix}${z.name}`,
    label: `Zone: ${z.name}`,
    type: 'text' as const,
    source: 'inferred' as const,
    writeback: true as const
  }));
}
