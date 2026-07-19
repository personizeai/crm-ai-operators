import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyGuards,
  coerceOutputText,
  validateGuardConfig,
  DEFAULT_GUARD_CONFIG,
  type GuardConfig
} from '../core/lib/guards.js';

const off: GuardConfig = { ...DEFAULT_GUARD_CONFIG };

test('validateGuardConfig accepts the default config', () => {
  assert.deepEqual(validateGuardConfig(DEFAULT_GUARD_CONFIG), []);
});

test('validateGuardConfig rejects bad mode and bad shapes', () => {
  assert.ok(validateGuardConfig({ format_version: 1, mode: 'on' }).length > 0);
  assert.ok(validateGuardConfig(null).length > 0);
  assert.ok(
    validateGuardConfig({ format_version: 2, mode: 'off' }).some((e) => e.includes('format_version'))
  );
  assert.ok(
    validateGuardConfig({ format_version: 1, mode: 'off', banned_phrases: ['x'] }).some((e) =>
      e.includes('banned_phrases')
    )
  );
});

test('coerceOutputText unwraps a single-string-value JSON object', () => {
  assert.equal(coerceOutputText('{"value": "Hello there."}'), 'Hello there.');
  assert.equal(coerceOutputText('{"text": "Hi."}'), 'Hi.');
});

test('coerceOutputText strips code fences', () => {
  assert.equal(coerceOutputText('```json\n{"value": "Hi."}\n```'), 'Hi.');
  assert.equal(coerceOutputText('```\nplain\n```'), 'plain');
});

test('coerceOutputText leaves normal prose alone', () => {
  const prose = 'Northwind Manufacturing opened a plant. {"not": "the whole string"} stays.';
  assert.equal(coerceOutputText(prose), prose);
});

test('applyGuards in off mode still coerces and records the coercion fire', () => {
  const r = applyGuards('{"value": "Hi."}', off);
  assert.equal(r.text, 'Hi.');
  assert.equal(r.fires.length, 1);
  assert.equal(r.fires[0]?.guard, 'coerce');
  assert.equal(r.fires[0]?.action, 'rewrite');
});

test('applyGuards off mode runs no other guards', () => {
  const cfg: GuardConfig = { ...off, banned_phrases: { seamless: 'smooth' } };
  const r = applyGuards('A seamless rollout.', cfg);
  assert.equal(r.text, 'A seamless rollout.');
  assert.deepEqual(r.fires, []);
});

test('fires carry the config source from context', () => {
  const r = applyGuards('{"value": "Hi."}', off, { configSource: 'campaign' });
  assert.equal(r.fires[0]?.source, 'campaign');
});

import { hasPositiveVendorSignal, DEFAULT_OWNERSHIP_VERBS } from '../core/lib/guards.js';

const shadow: GuardConfig = {
  format_version: 1,
  mode: 'shadow',
  banned_phrases: { 'cutting-edge': 'advanced', seamless: 'smooth' },
  ownership: {
    vendor_terms: ['Acme Backup'],
    negation_cues: ['evaluating', 'considering', 'not yet', 'no '],
    confirm_pattern: '(uses|deployed|standardized on) Acme Backup'
  }
};
const enforce: GuardConfig = { ...shadow, mode: 'enforce' };

test('banned phrases: shadow notes without changing text', () => {
  const r = applyGuards('A seamless, cutting-edge rollout.', shadow);
  assert.equal(r.text, 'A seamless, cutting-edge rollout.');
  const rules = r.fires.filter((f) => f.guard === 'banned_phrases').map((f) => f.rule).sort();
  assert.deepEqual(rules, ['cutting-edge', 'seamless']);
  assert.ok(r.fires.every((f) => f.guard !== 'banned_phrases' || f.action === 'note'));
});

test('banned phrases: enforce replaces case-insensitively, preserving leading capital', () => {
  const r = applyGuards('Seamless rollout. A CUTTING-EDGE plan.', enforce);
  assert.ok(r.text.startsWith('Smooth rollout.'));
  assert.ok(/\bAdvanced plan\b/.test(r.text));
  assert.ok(!/seamless/i.test(r.text) && !/cutting-edge/i.test(r.text));
});

test('longer banned phrases replace before their substrings', () => {
  const cfg: GuardConfig = {
    ...enforce,
    banned_phrases: { 'game-changer': 'step forward', game: 'match' }
  };
  const r = applyGuards('This is a game-changer.', cfg);
  assert.equal(r.text, 'This is a step forward.');
});

test('ownership: unconfirmed claim sentence is dropped in enforce mode', () => {
  const text = 'Northwind ships fast. Your team already uses Acme Backup daily. Worth a look.';
  const r = applyGuards(text, enforce, { ownershipConfirmed: false });
  assert.equal(r.text, 'Northwind ships fast. Worth a look.');
  const fire = r.fires.find((f) => f.guard === 'ownership');
  assert.equal(fire?.action, 'drop_sentence');
});

test('ownership: shadow mode notes but keeps the sentence', () => {
  const text = 'Your team already uses Acme Backup daily.';
  const r = applyGuards(text, shadow, { ownershipConfirmed: false });
  assert.equal(r.text, text);
  assert.equal(r.fires.find((f) => f.guard === 'ownership')?.action, 'note');
});

test('ownership: confirmed context suppresses the guard', () => {
  const text = 'Your team already uses Acme Backup daily.';
  const r = applyGuards(text, enforce, { ownershipConfirmed: true });
  assert.equal(r.text, text);
  assert.equal(r.fires.filter((f) => f.guard === 'ownership').length, 0);
});

test('ownership: vendor mention without an ownership verb is not a claim', () => {
  const text = 'Acme Backup can protect these workloads.';
  const r = applyGuards(text, enforce, { ownershipConfirmed: false });
  assert.equal(r.text, text);
});

test('hasPositiveVendorSignal: negation cue defeats the confirm pattern', () => {
  const own = shadow.ownership!;
  assert.equal(hasPositiveVendorSignal('Northwind uses Acme Backup for archives.', own), true);
  assert.equal(hasPositiveVendorSignal('Northwind is evaluating whether it uses Acme Backup.', own), false);
  assert.equal(hasPositiveVendorSignal('They said no to Acme Backup.', own), false);
});

test('hasPositiveVendorSignal: empty confirm pattern never confirms', () => {
  assert.equal(
    hasPositiveVendorSignal('Northwind uses Acme Backup.', { vendor_terms: ['Acme Backup'] }),
    false
  );
});

test('DEFAULT_OWNERSHIP_VERBS is non-empty and lowercase', () => {
  assert.ok(DEFAULT_OWNERSHIP_VERBS.length >= 5);
  assert.ok(DEFAULT_OWNERSHIP_VERBS.every((v) => v === v.toLowerCase()));
});

test('banned phrases: replacement values cannot cascade into other configured phrases', () => {
  const cfg: GuardConfig = {
    format_version: 1,
    mode: 'enforce',
    banned_phrases: { 'cutting-edge': 'innovative', innovative: 'forward-thinking' }
  };
  const r = applyGuards('A cutting-edge tool.', cfg);
  assert.equal(r.text, 'A innovative tool.');
  assert.deepEqual(
    r.fires.filter((f) => f.guard === 'banned_phrases').map((f) => f.rule),
    ['cutting-edge']
  );
});

test('ownership: multi-sentence zero-fire text returns byte-identical', () => {
  const text = 'Northwind ships fast.  Two spaces there. Acme Backup could help.\nNew line kept.';
  const r = applyGuards(text, enforce, { ownershipConfirmed: false });
  assert.equal(r.text, text);
});

test('ownership: empty-string entries in custom ownership_verbs are ignored', () => {
  const cfg: GuardConfig = {
    ...enforce,
    ownership: { vendor_terms: ['Acme Backup'], ownership_verbs: ['', 'already uses'] }
  };
  const r = applyGuards('Acme Backup could help your team.', cfg, { ownershipConfirmed: false });
  assert.equal(r.text, 'Acme Backup could help your team.');
});

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filterSignalRecency } from '../core/lib/guards.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'guard-incidents.json');

test('name leak: enforce strips the recipient name with punctuation repair', () => {
  const cfg: GuardConfig = { format_version: 1, mode: 'enforce', forbid_recipient_name: true };
  const r = applyGuards('Hi Jordan, quick thought on Northwind.', cfg, { recipientName: 'Jordan' });
  assert.equal(r.text, 'Hi, quick thought on Northwind.');
  assert.equal(r.fires.find((f) => f.guard === 'name_leak')?.action, 'rewrite');
});

test('name leak: no context name means no guard', () => {
  const cfg: GuardConfig = { format_version: 1, mode: 'enforce', forbid_recipient_name: true };
  const r = applyGuards('Hi Jordan, quick thought.', cfg, {});
  assert.equal(r.text, 'Hi Jordan, quick thought.');
});

test('placeholder leak: enforce drops the sentence containing the token', () => {
  const cfg: GuardConfig = { format_version: 1, mode: 'enforce' };
  const r = applyGuards('Solid quarter. Our [CAPABILITY_1] fits. Talk soon.', cfg);
  assert.equal(r.text, 'Solid quarter. Talk soon.');
  assert.equal(r.fires.find((f) => f.guard === 'placeholder_leak')?.action, 'drop_sentence');
});

test('test identity: noted in both shadow and enforce, never rewritten', () => {
  for (const mode of ['shadow', 'enforce'] as const) {
    const cfg: GuardConfig = { format_version: 1, mode, test_identity_denylist: ['Sarah Chen'] };
    const r = applyGuards('Ping Sarah Chen for access.', cfg);
    assert.equal(r.text, 'Ping Sarah Chen for access.');
    assert.equal(r.fires.find((f) => f.guard === 'test_identity')?.action, 'note');
  }
});

test('filterSignalRecency drops undated, future-dated, and stale; sorts newest first', () => {
  const now = new Date('2026-07-19T00:00:00Z');
  const signals = [
    { text: 'stale', date: '2024-01-10' },
    { text: 'fresh', date: '2026-06-01' },
    { text: 'future', date: '2027-01-01' },
    { text: 'undated' },
    { text: 'edge', date: '2025-09-15' }
  ];
  const kept = filterSignalRecency(signals, 12, now);
  assert.deepEqual(kept.map((s) => s.text), ['fresh', 'edge']);
});

test('incident fixtures replay through applyGuards', () => {
  const fx = JSON.parse(readFileSync(FIXTURES, 'utf8')) as {
    config: GuardConfig;
    cases: {
      name: string;
      input: string;
      context: Record<string, unknown>;
      expect_text?: string;
      expect_guards: string[];
    }[];
  };
  for (const c of fx.cases) {
    const r = applyGuards(c.input, fx.config, c.context as never);
    if (c.expect_text !== undefined) {
      assert.equal(r.text, c.expect_text, `${c.name}: text`);
    }
    for (const g of c.expect_guards) {
      assert.ok(r.fires.some((f) => f.guard === g), `${c.name}: expected fire ${g}`);
    }
  }
});

test('filterSignalRecency: month-end now does not roll the cutoff forward', () => {
  const now = new Date('2026-03-31T12:00:00Z');
  const kept = filterSignalRecency([{ text: 'early-march', date: '2026-03-02' }], 1, now);
  assert.equal(kept.length, 1);
});

test('test identity fire survives a placeholder sentence drop', () => {
  const cfg: GuardConfig = {
    format_version: 1,
    mode: 'enforce',
    test_identity_denylist: ['Sarah Chen']
  };
  const r = applyGuards('Reach out to Sarah Chen about our [CAPABILITY_1] rollout. Talk soon.', cfg);
  assert.equal(r.text, 'Talk soon.');
  assert.ok(r.fires.some((f) => f.guard === 'placeholder_leak'));
  assert.ok(r.fires.some((f) => f.guard === 'test_identity'));
});
