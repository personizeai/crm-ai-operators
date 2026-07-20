import type { ZoneSpec } from './schema.js';

export interface ZoneResult {
  text: string;
  used_fallback: boolean;
  notes: string[];
}

/**
 * Minimal deterministic cleanup for zone output. Scope is deliberate:
 * coercion, markdown strip, single-paragraph collapse, length clamp, and
 * whole-zone fallback. Ownership, banned-phrase, and recency enforcement
 * belong to the engine guards choke point at wiring time (WS4-B) and are
 * intentionally NOT duplicated here.
 */
export function processZoneOutput(raw: string, zone: ZoneSpec): ZoneResult {
  const notes: string[] = [];
  let text = raw.trim();

  const fence = text.match(/^```[a-zA-Z0-9-]*\r?\n([\s\S]*?)\r?\n?```$/);
  if (fence && fence[1] !== undefined) {
    text = fence[1].trim();
    notes.push('coerced: stripped code fence');
  }
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const values = Object.values(parsed as Record<string, unknown>);
        if (values.length === 1 && typeof values[0] === 'string') {
          text = (values[0] as string).trim();
          notes.push('coerced: unwrapped JSON value');
        }
      }
    } catch {
      // not JSON, keep as is
    }
  }
  if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null) {
        // zone.fallback fits max_chars by schema invariant (validateZoneSchema)
        return { text: zone.fallback, used_fallback: true, notes: [...notes, 'structured output not coercible, fallback used'] };
      }
    } catch {
      // not JSON, continue as prose
    }
  }

  // plain-text contract tradeoff: paired _ or * around real content (e.g. a field_name) is stripped along with markdown emphasis; acceptable for hero/proof/CTA copy.
  let mdChanged = false;
  for (let pass = 0; pass < 5; pass++) {
    const before = text;
    text = text
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/`([^`]+)`/g, '$1');
    if (text === before) break;
    mdChanged = true;
  }
  if (mdChanged) notes.push('markdown stripped');

  text = text.replace(/\s*\r?\n\s*\r?\n\s*/g, ' ').replace(/\s*\r?\n\s*/g, ' ').replace(/[^\S ]+/g, ' ').replace(/ {2,}/g, ' ').trim();

  if (text === '') {
    // zone.fallback fits max_chars by schema invariant (validateZoneSchema)
    return { text: zone.fallback, used_fallback: true, notes: [...notes, 'empty output, fallback used'] };
  }
  if (text.length > zone.max_chars) {
    const slice = text.slice(0, zone.max_chars);
    const lastEnd = Math.max(slice.lastIndexOf('.'), slice.lastIndexOf('!'), slice.lastIndexOf('?'));
    if (lastEnd > 0) {
      text = slice.slice(0, lastEnd + 1).trim();
      notes.push(`truncated at sentence boundary to ${text.length} chars`);
    } else {
      // zone.fallback fits max_chars by schema invariant (validateZoneSchema)
      return { text: zone.fallback, used_fallback: true, notes: [...notes, 'overlong with no sentence boundary, fallback used'] };
    }
  }
  return { text, used_fallback: false, notes };
}
