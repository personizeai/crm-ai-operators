import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildZonePrompt, type LeadContext } from '../core/lib/zones/prompt.js';
import type { ZoneSpec } from '../core/lib/zones/schema.js';

const ZONE: ZoneSpec = { name: 'hero_headline', max_chars: 90, fallback: 'F.', guidance: 'One-line value statement.' };
const LEAD: LeadContext = {
  company: 'Northwind Manufacturing',
  industry: 'manufacturing',
  researched_facts: ['opened an Ohio plant this spring'],
  confirmed_customer: false
};
const GUIDELINES = { 'Brand Voice': 'Plain, concrete, confident.', 'Email Base Rules': 'No banned phrases.' };

test('prompt is deterministic and contains the load-bearing sections', () => {
  const a = buildZonePrompt(ZONE, GUIDELINES, LEAD);
  const b = buildZonePrompt(ZONE, GUIDELINES, LEAD);
  assert.equal(a, b);
  for (const needle of [
    'Northwind Manufacturing',
    'opened an Ohio plant this spring',
    'at most 90 characters',
    'plain text',
    'do not invent',
    'hero_headline',
    'One-line value statement.',
    'Brand Voice',
    'Plain, concrete, confident.'
  ]) {
    assert.ok(a.includes(needle), `missing: ${needle}`);
  }
});

test('guideline order is sorted by name regardless of insertion order', () => {
  const g1 = buildZonePrompt(ZONE, { B: 'two', A: 'one' }, LEAD);
  const g2 = buildZonePrompt(ZONE, { A: 'one', B: 'two' }, LEAD);
  assert.equal(g1, g2);
  assert.ok(g1.indexOf('A') < g1.indexOf('B'));
});

test('unconfirmed customers get offer framing; confirmed do not', () => {
  const un = buildZonePrompt(ZONE, {}, { ...LEAD, confirmed_customer: false });
  assert.ok(un.includes('never state or imply the company already uses the product'));
  const conf = buildZonePrompt(ZONE, {}, { ...LEAD, confirmed_customer: true });
  assert.ok(!conf.includes('never state or imply the company already uses the product'));
});

test('empty researched facts produce an explicit no-facts instruction', () => {
  const p = buildZonePrompt(ZONE, {}, { company: 'Northwind Manufacturing' });
  assert.ok(p.includes('No researched facts are available'));
});
