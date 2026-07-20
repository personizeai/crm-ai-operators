import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateZones } from '../core/lib/zones/generate.js';
import { mapZonesToProperties, buildPropertyManifestFragment } from '../core/lib/zones/properties.js';
import type { ZoneSchema } from '../core/lib/zones/schema.js';

const SCHEMA: ZoneSchema = {
  format_version: 1,
  output: 'plain_text',
  zones: [
    { name: 'hero_headline', max_chars: 90, fallback: 'Fallback hero.', guidance: 'g1' },
    { name: 'proof_paragraph', max_chars: 200, fallback: 'Fallback proof.', guidance: 'g2' }
  ]
};
const LEAD = { company: 'Northwind Manufacturing' };

test('generates every zone through postprocessing', async () => {
  const prompts: string[] = [];
  const r = await generateZones(SCHEMA, { Voice: 'Plain.' }, LEAD, {
    generate: async (p) => {
      prompts.push(p);
      return p.includes('hero_headline') ? '  Northwind ships faster.  ' : '{"value": "Proof text here."}';
    }
  });
  assert.equal(prompts.length, 2);
  assert.equal(r.results['hero_headline']?.text, 'Northwind ships faster.');
  assert.equal(r.results['proof_paragraph']?.text, 'Proof text here.');
  assert.equal(r.fallbacks, 0);
});

test('a rejecting generate isolates to that zone and uses its fallback', async () => {
  const r = await generateZones(SCHEMA, {}, LEAD, {
    generate: async (p) => {
      if (p.includes('hero_headline')) throw new Error('provider blip');
      return 'Proof text here.';
    }
  });
  assert.equal(r.results['hero_headline']?.text, 'Fallback hero.');
  assert.equal(r.results['hero_headline']?.used_fallback, true);
  assert.equal(r.results['proof_paragraph']?.text, 'Proof text here.');
  assert.equal(r.fallbacks, 1);
  assert.ok(r.notes.some((n) => n.includes('hero_headline') && n.includes('generation failed')));
});

test('invalid schema rejects before any generation call', async () => {
  const calls: string[] = [];
  await assert.rejects(
    () => generateZones({ ...SCHEMA, zones: [] }, {}, LEAD, { generate: async (p) => { calls.push(p); return 'x'; } }),
    /zones/
  );
  assert.equal(calls.length, 0);
});

test('generateZones results feed mapZonesToProperties with matching keys', async () => {
  const r = await generateZones(SCHEMA, { Voice: 'Plain.' }, LEAD, {
    generate: async (p) => (p.includes('hero_headline') ? 'Northwind ships faster.' : 'Proof text here.')
  });
  const props = mapZonesToProperties(r.results);
  const manifestNames = buildPropertyManifestFragment(SCHEMA).map((m) => m.name).sort();
  assert.deepEqual(Object.keys(props).sort(), manifestNames);
  assert.equal(props['personize_zone_hero_headline'], 'Northwind ships faster.');
});

test('a postprocess-driven fallback (empty output) counts without a generation-failed note', async () => {
  const r = await generateZones(SCHEMA, {}, LEAD, {
    generate: async (p) => (p.includes('hero_headline') ? '   ' : 'Proof text here.')
  });
  assert.equal(r.results['hero_headline']?.used_fallback, true);
  assert.equal(r.results['hero_headline']?.text, 'Fallback hero.');
  assert.equal(r.fallbacks, 1);
  assert.ok(!r.notes.some((n) => n.includes('generation failed')));
  assert.ok(r.notes.some((n) => n.includes('hero_headline') && n.includes('fallback')));
});
