import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateZoneSchema, ZONE_NAME_RE, type ZoneSchema } from '../core/lib/zones/schema.js';

const GOOD: ZoneSchema = {
  format_version: 1,
  output: 'plain_text',
  zones: [
    { name: 'hero_headline', max_chars: 90, fallback: 'Purpose-built for teams like yours.', guidance: 'One-line value statement anchored on the company.' },
    { name: 'proof_paragraph', max_chars: 400, fallback: 'Teams in your industry use this to cut manual work.', guidance: 'Tie one researched fact to the offer.', theme: 'capability-proof' }
  ]
};

test('accepts a valid schema', () => {
  assert.deepEqual(validateZoneSchema(GOOD), []);
});

test('rejects wrong version, output, empty zones', () => {
  assert.ok(validateZoneSchema({ ...GOOD, format_version: 2 }).some((e) => e.includes('format_version')));
  assert.ok(validateZoneSchema({ ...GOOD, output: 'html' }).some((e) => e.includes('output')));
  assert.ok(validateZoneSchema({ ...GOOD, zones: [] }).some((e) => e.includes('zones')));
});

test('zone name charset and uniqueness enforced', () => {
  assert.ok(ZONE_NAME_RE.test('hero_headline') && !ZONE_NAME_RE.test('Hero') && !ZONE_NAME_RE.test('2fast') && !ZONE_NAME_RE.test('has-dash'));
  const dupe = { ...GOOD, zones: [GOOD.zones[0]!, { ...GOOD.zones[0]! }] };
  assert.ok(validateZoneSchema(dupe).some((e) => e.includes('duplicate')));
  const bad = { ...GOOD, zones: [{ ...GOOD.zones[0]!, name: 'Bad-Name' }] };
  assert.ok(validateZoneSchema(bad).some((e) => e.includes('name')));
});

test('fallback must be nonempty and fit max_chars; max_chars sane', () => {
  const noFallback = { ...GOOD, zones: [{ ...GOOD.zones[0]!, fallback: '  ' }] };
  assert.ok(validateZoneSchema(noFallback).some((e) => e.includes('fallback')));
  const tooLong = { ...GOOD, zones: [{ ...GOOD.zones[0]!, max_chars: 10 }] };
  assert.ok(validateZoneSchema(tooLong).some((e) => e.includes('fit')));
  const badMax = { ...GOOD, zones: [{ ...GOOD.zones[0]!, max_chars: 0 }] };
  assert.ok(validateZoneSchema(badMax).some((e) => e.includes('max_chars')));
});

test('a zone named status is rejected (reserved)', () => {
  const bad = { format_version: 1, output: 'plain_text', zones: [{ name: 'status', max_chars: 90, fallback: 'F.', guidance: 'g' }] };
  assert.ok(validateZoneSchema(bad).some((e) => e.includes('reserved')));
});
