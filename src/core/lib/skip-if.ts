import type { SkipIfRule } from "../operations/types.js";

export interface SkipDecision {
  skip: boolean;
  reason?: string;
}

/**
 * Evaluate a SkipIfRule against a record's current property values.
 * Returns { skip: true, reason: "..." } when the operation should skip this record.
 *
 * Supports two rule modes:
 *   - in_states: skip if record[property] is in the list
 *   - updated_within: skip if record[property+"_updated_at"] is recent enough
 */
export function evaluateSkipIf(
  rule: SkipIfRule,
  record: Record<string, unknown>,
): SkipDecision {
  if (rule.in_states && rule.in_states.length > 0) {
    const value = record[rule.property];
    if (typeof value === "string" && rule.in_states.includes(value)) {
      return { skip: true, reason: `${rule.property}=${value} is in skip-states` };
    }
  }

  if (rule.updated_within) {
    const candidates = [
      record[`${rule.property}_updated_at`],
      record[`${rule.property}UpdatedAt`],
      // Personize may expose a generic last-updated stamp on properties.
      record._property_updates?.[rule.property as keyof typeof record._property_updates],
    ];
    const lastUpdate = candidates.find((c) => typeof c === "string") as string | undefined;
    if (lastUpdate) {
      const ms = parseDuration(rule.updated_within);
      if (ms > 0 && Date.now() - new Date(lastUpdate).getTime() < ms) {
        return {
          skip: true,
          reason: `${rule.property} was updated within ${rule.updated_within}`,
        };
      }
    }
  }

  return { skip: false };
}

/**
 * Parse a duration string like "7d", "24h", "1w", "30m" (m = minutes here, not months).
 * Returns 0 for unknown formats.
 */
export function parseDuration(s: string): number {
  const match = s.match(/^(\d+)([smhdw])$/i);
  if (!match) return 0;
  const n = parseInt(match[1], 10);
  switch (match[2].toLowerCase()) {
    case "s":
      return n * 1000;
    case "m":
      return n * 60 * 1000;
    case "h":
      return n * 60 * 60 * 1000;
    case "d":
      return n * 24 * 60 * 60 * 1000;
    case "w":
      return n * 7 * 24 * 60 * 60 * 1000;
    default:
      return 0;
  }
}
