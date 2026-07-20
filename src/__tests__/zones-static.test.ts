import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStaticZones } from '../core/lib/zones/static.js';
import type { ZoneSchema } from '../core/lib/zones/schema.js';
import { OPERATIONS } from '../core/operations/registry.js';

const SCHEMA: ZoneSchema = {
  format_version: 1,
  output: 'plain_text',
  generation_mode: 'standard',
  zones: [
    { name: 'hero_headline', max_chars: 90, fallback: 'Built for teams like yours.', guidance: 'g' },
    { name: 'proof_paragraph', max_chars: 400, fallback: 'Fallback proof copy.', guidance: 'g2' }
  ]
};

const BODY = [
  '## hero_headline',
  'One platform, every workflow.',
  '',
  '## proof_paragraph',
  'Trusted across the industry to remove manual steps.',
  ''
].join('\n');

test('parseStaticZones reads copy from markdown headings by zone name', () => {
  const r = parseStaticZones(BODY, SCHEMA);
  assert.equal(r['hero_headline']?.text, 'One platform, every workflow.');
  assert.equal(r['proof_paragraph']?.text, 'Trusted across the industry to remove manual steps.');
  assert.equal(r['hero_headline']?.used_fallback, false);
});

test('a zone missing from the body falls back', () => {
  const r = parseStaticZones('## hero_headline\nOnly this one.', SCHEMA);
  assert.equal(r['hero_headline']?.text, 'Only this one.');
  assert.equal(r['proof_paragraph']?.text, 'Fallback proof copy.');
  assert.equal(r['proof_paragraph']?.used_fallback, true);
});

test('static copy still passes through length clamping and fallback rules', () => {
  const longSchema: ZoneSchema = { ...SCHEMA, zones: [{ name: 'hero_headline', max_chars: 20, fallback: 'Short fallback.', guidance: 'g' }] };
  const r = parseStaticZones('## hero_headline\nThis is a very long headline well beyond twenty characters with no early period', longSchema);
  assert.equal(r['hero_headline']?.text, 'Short fallback.');
  assert.equal(r['hero_headline']?.used_fallback, true);
});

test('generate.landing-zones is registered and live', () => {
  const op = OPERATIONS['generate.landing-zones'];
  assert.ok(op && op.status === 'live' && op.category === 'generate');
});

test('generate.landing-zones declares an opt-out skip_if', () => {
  const op = OPERATIONS['generate.landing-zones'];
  assert.ok(op.skip_if);
  assert.equal(op.skip_if.property, 'sequence_status');
  assert.ok(op.skip_if.in_states?.includes('Opted Out'));
});
