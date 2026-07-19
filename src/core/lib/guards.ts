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
function runBannedPhrases(text: string, _c: GuardConfig, _f: GuardFire[], _s: string): string {
  return text;
}
function runOwnership(text: string, _c: GuardConfig, _x: GuardContext, _f: GuardFire[], _s: string): string {
  return text;
}
function runLeakGuards(text: string, _c: GuardConfig, _x: GuardContext, _f: GuardFire[], _s: string): string {
  return text;
}
