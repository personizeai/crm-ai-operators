import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateZones } from '../core/lib/zones/generate.js';
import type { ZoneSchema } from '../core/lib/zones/schema.js';

const LEAD = { company: 'Northwind Manufacturing' };

test('hide_if_empty writes empty string when a zone falls back', async () => {
  const schema: ZoneSchema = {
    format_version: 1,
    output: 'plain_text',
    zones: [
      { name: 'optional_band', max_chars: 90, fallback: 'Unused fallback.', guidance: 'g', fallback_strategy: 'hide_if_empty' },
      { name: 'always_band', max_chars: 90, fallback: 'Always here.', guidance: 'g' }
    ]
  };
  const r = await generateZones(schema, {}, LEAD, {
    generate: async (p) => (p.includes('optional_band') ? '   ' : 'Real copy.')
  });
  assert.equal(r.results['optional_band']?.text, '');
  assert.equal(r.results['optional_band']?.used_fallback, true);
  assert.equal(r.results['always_band']?.text, 'Real copy.');
});

test('fallback_copy (default) writes the fallback text', async () => {
  const schema: ZoneSchema = {
    format_version: 1,
    output: 'plain_text',
    zones: [{ name: 'band', max_chars: 90, fallback: 'The fallback copy.', guidance: 'g' }]
  };
  const r = await generateZones(schema, {}, LEAD, { generate: async () => '   ' });
  assert.equal(r.results['band']?.text, 'The fallback copy.');
  assert.equal(r.results['band']?.used_fallback, true);
});

test('hide_if_empty on the exception path still writes empty string, not the fallback text', async () => {
  const schema: ZoneSchema = {
    format_version: 1,
    output: 'plain_text',
    zones: [
      { name: 'optional_band', max_chars: 90, fallback: 'Unused fallback.', guidance: 'g', fallback_strategy: 'hide_if_empty' }
    ]
  };
  const r = await generateZones(schema, {}, LEAD, {
    generate: async () => { throw new Error('provider blip'); }
  });
  assert.equal(r.results['optional_band']?.text, '');
  assert.equal(r.results['optional_band']?.used_fallback, true);
  assert.ok(r.notes.some((n) => n.includes('optional_band') && n.includes('generation failed')));
});
