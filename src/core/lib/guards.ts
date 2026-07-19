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
  if (bp !== undefined && (typeof bp !== 'object' || bp === null || Array.isArray(bp))) {
    errors.push('banned_phrases: must be an object of phrase to replacement');
  }
  const own = c['ownership'];
  if (own !== undefined) {
    if (typeof own !== 'object' || own === null || Array.isArray(own)) {
      errors.push('ownership: must be an object');
    } else if (!Array.isArray((own as Record<string, unknown>)['vendor_terms'])) {
      errors.push('ownership.vendor_terms: must be an array');
    }
  }
  if (c['recency_months'] !== undefined && typeof c['recency_months'] !== 'number') {
    errors.push('recency_months: must be a number');
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

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/);
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
  if (original.length > 0 && replacement.length > 0 && original[0] === original[0]?.toUpperCase()) {
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
  let out = coerceOutputText(text);
  if (out !== text) fires.push({ guard: 'coerce', rule: 'wrapper', action: 'rewrite', source });
  if (config.mode === 'off') return { text: out, fires };
  // guards below are added in later tasks; each pushes fires and, in
  // enforce mode only, mutates `out`
  out = runBannedPhrases(out, config, fires, source);
  out = runOwnership(out, config, context, fires, source);
  out = runLeakGuards(out, config, context, fires, source);
  return { text: out, fires };
}

// Task 3 and Task 4 replace these stubs with real implementations.
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
  const sentences = splitSentences(text);
  const kept: string[] = [];
  let dropped = false;
  for (const sentence of sentences) {
    const term = containsTerm(sentence, own.vendor_terms);
    const lower = sentence.toLowerCase();
    const claims = term !== null && verbs.some((v) => lower.includes(v));
    if (!claims) {
      kept.push(sentence);
      continue;
    }
    const action = config.mode === 'enforce' ? 'drop_sentence' : 'note';
    fires.push({ guard: 'ownership', rule: `${term} + ownership verb`, action, source });
    if (config.mode !== 'enforce') kept.push(sentence);
    else dropped = true;
  }
  return dropped ? kept.join(' ') : text;
}
function runLeakGuards(
  text: string,
  config: GuardConfig,
  context: GuardContext,
  fires: GuardFire[],
  source: string
): string {
  let out = text;
  if (config.forbid_recipient_name && context.recipientName) {
    const name = context.recipientName.trim();
    if (name) {
      const re = new RegExp(`\\s*\\b${escapeRegExp(name)}\\b`, 'g');
      if (re.test(out)) {
        const action = config.mode === 'enforce' ? 'rewrite' : 'note';
        fires.push({ guard: 'name_leak', rule: 'recipient name', action, source });
        if (config.mode === 'enforce') {
          out = out.replace(re, '').replace(/\s{2,}/g, ' ').replace(/\s+,/g, ',').trim();
        }
      }
    }
  }
  if (PLACEHOLDER.test(out)) {
    const action = config.mode === 'enforce' ? 'drop_sentence' : 'note';
    fires.push({ guard: 'placeholder_leak', rule: 'unfilled bracket token', action, source });
    if (config.mode === 'enforce') {
      out = splitSentences(out)
        .filter((s) => !PLACEHOLDER.test(s))
        .join(' ');
    }
  }
  for (const identity of config.test_identity_denylist ?? []) {
    // audit-only detector: scan the ORIGINAL input so an earlier guard's
    // sentence drop cannot suppress the incident signal
    if (identity && text.toLowerCase().includes(identity.toLowerCase())) {
      fires.push({ guard: 'test_identity', rule: identity, action: 'note', source });
    }
  }
  return out;
}
