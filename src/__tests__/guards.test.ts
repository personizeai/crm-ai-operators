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
