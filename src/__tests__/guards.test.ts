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
