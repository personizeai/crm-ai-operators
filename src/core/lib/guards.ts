/**
 * Deterministic output guards (RFC 0001). Pure functions, parameterized by
 * data. applyGuards is the single entry point; wiring into the operation
 * runner lands in a later PR. Customization is config-only by design: no
 * plugin registry, no user code injection.
 */

export type GuardMode = 'off' | 'shadow' | 'enforce';

export interface GuardFire {
  guard: string;
  rule: string;
  action: 'rewrite' | 'drop_sentence' | 'note';
  source: string;
}

export interface OwnershipConfig {
  vendor_terms: string[];
  ownership_verbs?: string[];
  confirm_pattern?: string;
  negation_cues?: string[];
}

export interface GuardConfig {
  format_version: 1;
  mode: GuardMode;
  banned_phrases?: Record<string, string>;
  ownership?: OwnershipConfig;
  recency_months?: number;
  forbid_recipient_name?: boolean;
  test_identity_denylist?: string[];
}

export interface GuardContext {
  recipientName?: string;
  ownershipConfirmed?: boolean;
  configSource?: string;
}

export interface GuardResult {
  text: string;
  fires: GuardFire[];
}

export const DEFAULT_GUARD_CONFIG: GuardConfig = { format_version: 1, mode: 'off' };

const MODES: readonly string[] = ['off', 'shadow', 'enforce'];

export function filterSignalRecency<T extends { date?: string }>(
  signals: T[],
  months: number,
  now: Date = new Date()
): T[] {
  // month-arithmetic clamp: stepping back N months from a day-29/30/31 date
  // must not roll over into the same month (setMonth overflow), so target the
  // month first and clamp the day to that month's length
  const cutoff = new Date(now);
  const day = cutoff.getDate();
  cutoff.setDate(1);
  cutoff.setMonth(cutoff.getMonth() - months);
  const daysInTarget = new Date(cutoff.getFullYear(), cutoff.getMonth() + 1, 0).getDate();
  cutoff.setDate(Math.min(day, daysInTarget));
  return signals
    .filter((s) => {
      if (!s.date) return false;
      const d = new Date(s.date);
      if (Number.isNaN(d.getTime())) return false;
      return d >= cutoff && d <= now;
    })
    .sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime());
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

export function validateGuardConfig(input: unknown): string[] {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return ['guard config must be a JSON object'];
  }
  const c = input as Record<string, unknown>;
  if (c['format_version'] !== 1) errors.push('format_version: must be 1');
  if (typeof c['mode'] !== 'string' || !MODES.includes(c['mode'] as string)) {
    errors.push('mode: must be off, shadow, or enforce');
  }
  const bp = c['banned_phrases'];
  if (bp !== undefined) {
    if (typeof bp !== 'object' || bp === null || Array.isArray(bp)) {
      errors.push('banned_phrases: must be an object of phrase to replacement');
    } else if (!Object.values(bp as Record<string, unknown>).every((v) => typeof v === 'string')) {
      errors.push('banned_phrases: all values must be strings');
    }
  }
  const own = c['ownership'];
  if (own !== undefined) {
    if (typeof own !== 'object' || own === null || Array.isArray(own)) {
      errors.push('ownership: must be an object');
    } else {
      const o = own as Record<string, unknown>;
      if (!isStringArray(o['vendor_terms'])) {
        errors.push('ownership.vendor_terms: must be an array of strings');
      }
      if (o['ownership_verbs'] !== undefined && !isStringArray(o['ownership_verbs'])) {
        errors.push('ownership.ownership_verbs: must be an array of strings');
      }
      if (o['negation_cues'] !== undefined && !isStringArray(o['negation_cues'])) {
        errors.push('ownership.negation_cues: must be an array of strings');
      }
      if (o['confirm_pattern'] !== undefined && typeof o['confirm_pattern'] !== 'string') {
        errors.push('ownership.confirm_pattern: must be a string');
      }
    }
  }
  if (c['test_identity_denylist'] !== undefined && !isStringArray(c['test_identity_denylist'])) {
    errors.push('test_identity_denylist: must be an array of strings');
  }
  if (c['forbid_recipient_name'] !== undefined && typeof c['forbid_recipient_name'] !== 'boolean') {
    errors.push('forbid_recipient_name: must be a boolean');
  }
  if (c['recency_months'] !== undefined) {
    const rm = c['recency_months'];
    if (typeof rm !== 'number' || !Number.isFinite(rm) || rm <= 0) {
      errors.push('recency_months: must be a positive finite number');
    }
  }
  return errors;
}

// --- coercion (always on) ---

export function coerceOutputText(text: string): string {
  let out = text.trim();
  const fence = out.match(/^```[a-z]*\r?\n([\s\S]*?)\r?\n?```$/);
  if (fence && fence[1] !== undefined) out = fence[1].trim();
  if (out.startsWith('{') && out.endsWith('}')) {
    try {
      const parsed: unknown = JSON.parse(out);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const values = Object.values(parsed as Record<string, unknown>);
        if (values.length === 1 && typeof values[0] === 'string') {
          out = (values[0] as string).trim();
        }
      }
    } catch {
      // not JSON, leave as-is
    }
  }
  return out;
}

// --- sentence utilities (shared by ownership and placeholder guards) ---

// deliberately simple sentence splitter; abbreviations like "Inc." split early,
// a known limitation accepted for v1
function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/);
}

// splits into [sentence, separator, sentence, separator, ...] keeping the
// separators, so dropping a sentence removes only its own trailing
// separator and paragraph breaks between kept sentences survive intact
function dropSentences(
  text: string,
  shouldDrop: (sentence: string) => boolean
): { result: string; droppedAny: boolean } {
  const parts = text.split(/((?<=[.!?])\s+)/);
  let result = '';
  let droppedAny = false;
  for (let i = 0; i < parts.length; i += 2) {
    const sentence = parts[i] ?? '';
    const sep = parts[i + 1] ?? '';
    if (sentence !== '' && shouldDrop(sentence)) {
      droppedAny = true;
      continue;
    }
    result += sentence + sep;
  }
  return { result: droppedAny ? result.trimEnd() : text, droppedAny };
}

function containsTerm(sentence: string, terms: string[]): string | null {
  const lower = sentence.toLowerCase();
  for (const t of terms) {
    if (t && lower.includes(t.toLowerCase())) return t;
  }
  return null;
}

export const DEFAULT_OWNERSHIP_VERBS: readonly string[] = [
  'already use',
  'already uses',
  'already using',
  'currently use',
  'currently uses',
  'currently run',
  'currently running',
  'your deployment',
  'you have deployed',
  'you rely on',
  'your existing'
];

export function hasPositiveVendorSignal(text: string, ownership: OwnershipConfig): boolean {
  const pattern = ownership.confirm_pattern?.trim();
  if (!pattern) return false;
  let re: RegExp;
  try {
    re = new RegExp(pattern, 'i');
  } catch {
    return false;
  }
  const cues = (ownership.negation_cues ?? []).map((c) => c.toLowerCase());
  for (const sentence of splitSentences(text)) {
    if (!re.test(sentence)) continue;
    const lower = sentence.toLowerCase();
    if (cues.some((cue) => cue && lower.includes(cue))) continue;
    return true;
  }
  return false;
}

function preserveCapital(original: string, replacement: string): string {
  if (!/[A-Za-z]/.test(original[0] ?? '')) return replacement;
  if (replacement.length > 0 && original[0] === original[0]?.toUpperCase()) {
    return replacement[0]!.toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- leak guards: recipient name, placeholder tokens, test identities ---

const PLACEHOLDER = /\[[A-Z][A-Z0-9 _-]*\](?!\()/;

// --- entry point ---

export function applyGuards(text: string, config: GuardConfig, context: GuardContext = {}): GuardResult {
  const fires: GuardFire[] = [];
  const source = context.configSource ?? 'default';
  const coerced = coerceOutputText(text);
  // pure whitespace trims are not a meaningful rewrite; only record the fire
  // when coercion actually stripped a wrapper (code fence or JSON envelope)
  if (coerced !== text.trim()) {
    fires.push({ guard: 'coerce', rule: 'wrapper', action: 'rewrite', source });
  }
  let out = coerced;
  if (config.mode === 'off') return { text: out, fires };
  // each guard pushes fires and, in enforce mode only, may rewrite 'out'
  out = runBannedPhrases(out, config, fires, source);
  out = runOwnership(out, config, context, fires, source);
  out = runLeakGuards(out, config, context, fires, source, coerced);
  return { text: out, fires };
}

function runBannedPhrases(text: string, config: GuardConfig, fires: GuardFire[], source: string): string {
  const map = config.banned_phrases;
  if (!map) return text;
  let out = text;
  const phrases = Object.keys(map).filter((p) => p.trim() !== '');
  phrases.sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    // fire and replace only for phrases present in the ORIGINAL text, so a
    // replacement value that happens to contain another configured phrase
    // cannot cascade into a second, unintended substitution or a spurious fire
    if (!new RegExp(escapeRegExp(phrase), 'i').test(text)) continue;
    const action = config.mode === 'enforce' ? 'rewrite' : 'note';
    fires.push({ guard: 'banned_phrases', rule: phrase, action, source });
    if (config.mode === 'enforce') {
      out = out.replace(new RegExp(escapeRegExp(phrase), 'gi'), (m) =>
        preserveCapital(m, map[phrase] ?? '')
      );
      if (map[phrase] === '') {
        // the phrase was deleted outright, not swapped for another word;
        // collapse the doubled space that leaves behind on the same line
        out = out.replace(/[^\S\r\n]{2,}/g, ' ');
      }
    }
  }
  return out;
}
function runOwnership(
  text: string,
  config: GuardConfig,
  context: GuardContext,
  fires: GuardFire[],
  source: string
): string {
  const own = config.ownership;
  if (!own || own.vendor_terms.length === 0) return text;
  if (context.ownershipConfirmed === true) return text;
  const verbs = (own.ownership_verbs?.length ? own.ownership_verbs : [...DEFAULT_OWNERSHIP_VERBS])
    .map((v) => v.toLowerCase())
    .filter((v) => v.trim() !== '');
  const sentenceClaims = (sentence: string): boolean => {
    const term = containsTerm(sentence, own.vendor_terms);
    return term !== null && verbs.some((v) => sentence.toLowerCase().includes(v));
  };
  for (const sentence of splitSentences(text)) {
    const term = containsTerm(sentence, own.vendor_terms);
    const lower = sentence.toLowerCase();
    const claims = term !== null && verbs.some((v) => lower.includes(v));
    if (!claims) continue;
    const action = config.mode === 'enforce' ? 'drop_sentence' : 'note';
    fires.push({ guard: 'ownership', rule: `${term} + ownership verb`, action, source });
  }
  if (config.mode !== 'enforce') return text;
  const { result, droppedAny } = dropSentences(text, sentenceClaims);
  return droppedAny ? result : text;
}
function runLeakGuards(
  text: string,
  config: GuardConfig,
  context: GuardContext,
  fires: GuardFire[],
  source: string,
  original: string
): string {
  let out = text;
  if (config.forbid_recipient_name && context.recipientName) {
    const name = context.recipientName.trim();
    if (name) {
      // case-sensitive on purpose: a case-insensitive strip would delete
      // ordinary words for recipients named Will, Mark, or Grace;
      // test_identity below is case-insensitive because it only notes and
      // never rewrites
      const re = new RegExp(
        `[^\\S\\r\\n]*(?<![\\p{L}\\p{N}_])${escapeRegExp(name)}(?![\\p{L}\\p{N}_])`,
        'gu'
      );
      if (re.test(out)) {
        const action = config.mode === 'enforce' ? 'rewrite' : 'note';
        fires.push({ guard: 'name_leak', rule: 'recipient name', action, source });
        if (config.mode === 'enforce') {
          out = out
            .replace(re, '')
            .replace(/[^\S\r\n]{2,}/g, ' ')
            .replace(/\s+,/g, ',')
            .replace(/,\s*(?=[.!?])/g, '')
            .replace(/(^|[\r\n])[ \t]*,[ \t]*/g, '$1')
            .trim();
        }
      }
    }
  }
  if (PLACEHOLDER.test(out)) {
    const action = config.mode === 'enforce' ? 'drop_sentence' : 'note';
    fires.push({ guard: 'placeholder_leak', rule: 'unfilled bracket token', action, source });
    if (config.mode === 'enforce') {
      const { result, droppedAny } = dropSentences(out, (s) => PLACEHOLDER.test(s));
      out = droppedAny ? result : out;
    }
  }
  for (const identity of config.test_identity_denylist ?? []) {
    // audit-only detector: scans the post-coercion original, so no later
    // guard's sentence drop can suppress the incident signal
    if (identity && original.toLowerCase().includes(identity.toLowerCase())) {
      fires.push({ guard: 'test_identity', rule: identity, action: 'note', source });
    }
  }
  return out;
}
