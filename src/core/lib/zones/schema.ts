/**
 * Zone schema (format_version 1): the create-per-campaign definition of a
 * personalized surface delivered as CRM custom properties. Fail-safe by
 * construction: every zone carries a fallback that fits its own limit.
 */

export const ZONE_NAME_RE = /^[a-z][a-z0-9_]*$/;
const NAME_MAX = 40;

export interface ZoneSpec {
  name: string;
  max_chars: number;
  fallback: string;
  guidance: string;
  theme?: string;
}

export interface ZoneSchema {
  format_version: 1;
  output: 'plain_text';
  zones: ZoneSpec[];
}

export function validateZoneSchema(input: unknown): string[] {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return ['zone schema must be a JSON object'];
  }
  const s = input as Record<string, unknown>;
  if (s['format_version'] !== 1) errors.push('format_version: must be 1');
  if (s['output'] !== 'plain_text') errors.push('output: must be plain_text');
  const zones = s['zones'];
  if (!Array.isArray(zones) || zones.length === 0) {
    errors.push('zones: required non-empty array');
    return errors;
  }
  const seen = new Set<string>();
  zones.forEach((z, i) => {
    if (typeof z !== 'object' || z === null || Array.isArray(z)) {
      errors.push(`zones[${i}]: must be an object`);
      return;
    }
    const zone = z as Record<string, unknown>;
    const name = zone['name'];
    if (typeof name !== 'string' || !ZONE_NAME_RE.test(name) || name.length > NAME_MAX) {
      errors.push(`zones[${i}].name: lowercase snake_case, starts with a letter, max ${NAME_MAX} chars`);
    } else if (seen.has(name)) {
      errors.push(`zones[${i}].name: duplicate "${name}"`);
    } else {
      seen.add(name);
    }
    const max = zone['max_chars'];
    if (typeof max !== 'number' || !Number.isInteger(max) || max < 20 || max > 2000) {
      errors.push(`zones[${i}].max_chars: integer between 20 and 2000`);
    }
    const fallback = zone['fallback'];
    if (typeof fallback !== 'string' || fallback.trim() === '') {
      errors.push(`zones[${i}].fallback: required non-empty string`);
    } else if (typeof max === 'number' && fallback.length > max) {
      errors.push(`zones[${i}].fallback: must fit max_chars (fallback is the fail-safe)`);
    }
    if (typeof zone['guidance'] !== 'string' || (zone['guidance'] as string).trim() === '') {
      errors.push(`zones[${i}].guidance: required non-empty string`);
    }
  });
  return errors;
}
