import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapZonesToProperties, buildPropertyManifestFragment } from '../core/lib/zones/properties.js';
import type { ZoneSchema } from '../core/lib/zones/schema.js';

const SCHEMA: ZoneSchema = {
  format_version: 1,
  output: 'plain_text',
  zones: [
    { name: 'hero_headline', max_chars: 90, fallback: 'F.', guidance: 'g' },
    { name: 'proof_paragraph', max_chars: 400, fallback: 'F2.', guidance: 'g2' }
  ]
};

test('maps results to prefixed property names', () => {
  const props = mapZonesToProperties({
    hero_headline: { text: 'A', used_fallback: false, notes: [] },
    proof_paragraph: { text: 'B', used_fallback: true, notes: ['x'] }
  });
  assert.deepEqual(props, { personize_zone_hero_headline: 'A', personize_zone_proof_paragraph: 'B' });
});

test('custom prefix is honored and validated', () => {
  const props = mapZonesToProperties({ hero_headline: { text: 'A', used_fallback: false, notes: [] } }, { prefix: 'pz_' });
  assert.deepEqual(props, { pz_hero_headline: 'A' });
  assert.throws(() => mapZonesToProperties({}, { prefix: 'Bad Prefix' }), /prefix/);
});

test('manifest fragment matches the engine property shape', () => {
  const frag = buildPropertyManifestFragment(SCHEMA);
  assert.deepEqual(frag, [
    { name: 'personize_zone_hero_headline', label: 'Zone: hero_headline', type: 'text', source: 'inferred', writeback: true },
    { name: 'personize_zone_proof_paragraph', label: 'Zone: proof_paragraph', type: 'text', source: 'inferred', writeback: true }
  ]);
});
