import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processZoneOutput } from '../core/lib/zones/postprocess.js';
import type { ZoneSpec } from '../core/lib/zones/schema.js';

const ZONE: ZoneSpec = { name: 'hero_headline', max_chars: 60, fallback: 'Built for teams like yours.', guidance: 'g' };

test('clean text passes through trimmed', () => {
  const r = processZoneOutput('  Northwind ships faster with less manual work.  ', ZONE);
  assert.equal(r.text, 'Northwind ships faster with less manual work.');
  assert.equal(r.used_fallback, false);
  assert.deepEqual(r.notes, []);
});

test('code fences and single-key JSON wrappers are coerced', () => {
  const fenced = processZoneOutput('```\nNorthwind ships faster.\n```', ZONE);
  assert.equal(fenced.text, 'Northwind ships faster.');
  const wrapped = processZoneOutput('{"value": "Northwind ships faster."}', ZONE);
  assert.equal(wrapped.text, 'Northwind ships faster.');
  assert.ok(wrapped.notes.some((n) => n.includes('coerced')));
});

test('markdown emphasis and headers are stripped', () => {
  const r = processZoneOutput('# Northwind\n**ships** _faster_.', ZONE);
  assert.equal(r.text, 'Northwind ships faster.');
  assert.ok(r.notes.some((n) => n.includes('markdown')));
});

test('empty and whitespace outputs fall back', () => {
  const r = processZoneOutput('   ', ZONE);
  assert.equal(r.text, ZONE.fallback);
  assert.equal(r.used_fallback, true);
});

test('overlong output truncates at a sentence boundary within the limit', () => {
  const raw = 'Northwind ships faster with this. A second sentence that pushes far beyond the sixty character limit for this zone.';
  const r = processZoneOutput(raw, ZONE);
  assert.equal(r.text, 'Northwind ships faster with this.');
  assert.ok(r.text.length <= ZONE.max_chars);
  assert.ok(r.notes.some((n) => n.includes('truncated')));
});

test('overlong output with no sentence boundary inside the limit falls back', () => {
  const raw = 'A single relentless clause that never terminates and rolls straight past sixty characters without any period';
  const r = processZoneOutput(raw, ZONE);
  assert.equal(r.text, ZONE.fallback);
  assert.equal(r.used_fallback, true);
  assert.ok(r.notes.some((n) => n.includes('no sentence boundary')));
});

test('multi-paragraph output collapses to one paragraph', () => {
  const r = processZoneOutput('Northwind ships faster.\n\nSecond thought.', ZONE);
  assert.equal(r.text, 'Northwind ships faster. Second thought.');
});

test('nested same-delimiter emphasis strips fully in both orders', () => {
  const a = processZoneOutput('**Cut costs by *30%* this quarter**', ZONE);
  assert.equal(a.text, 'Cut costs by 30% this quarter');
  const b = processZoneOutput('*Outer **inner** outer*', ZONE);
  assert.equal(b.text, 'Outer inner outer');
});

test('multi-key JSON and arrays fall back instead of shipping raw', () => {
  const multi = processZoneOutput('{"headline": "x", "reasoning": "y"}', ZONE);
  assert.equal(multi.text, ZONE.fallback);
  assert.equal(multi.used_fallback, true);
  assert.ok(multi.notes.some((n) => n.includes('structured output')));
  const arr = processZoneOutput('["a", "b"]', ZONE);
  assert.equal(arr.text, ZONE.fallback);
});

test('uppercase fence tags are stripped', () => {
  const r = processZoneOutput('```JSON\n{"value": "Northwind ships faster."}\n```', ZONE);
  assert.equal(r.text, 'Northwind ships faster.');
});
