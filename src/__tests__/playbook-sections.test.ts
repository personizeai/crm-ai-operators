import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYBOOK_SECTIONS, assemblePlaybook, playbookSectionSchema } from '../core/lib/playbook/sections.js';
import { validateZoneSchema } from '../core/lib/zones/schema.js';
import { OPERATIONS } from '../core/operations/registry.js';

test('exactly the five doctrine sections, in order', () => {
  assert.deepEqual(
    PLAYBOOK_SECTIONS.map((s) => s.name),
    ['account_snapshot', 'why_now', 'talk_track', 'landmines', 'next_step']
  );
  for (const s of PLAYBOOK_SECTIONS) {
    assert.ok(s.fallback.trim().length > 0 && s.fallback.length <= s.max_chars, s.name);
  }
});

test('playbookSectionSchema is a valid zone schema', () => {
  assert.deepEqual(validateZoneSchema(playbookSectionSchema()), []);
});

test('assemblePlaybook composes the full doc and a per-section property map', () => {
  const texts = {
    account_snapshot: 'Mid-market manufacturer, 900 staff, expanding in Ohio.',
    why_now: 'Opened a new plant this spring.',
    talk_track: 'Open on the Ohio expansion.',
    landmines: 'Do not assume they use any platform yet.',
    next_step: 'Book a 20-minute working session.'
  };
  const { full, properties } = assemblePlaybook(texts);
  assert.ok(full.includes('Account snapshot') && full.includes('Ohio'));
  assert.ok(full.indexOf('Account snapshot') < full.indexOf('Why now'));
  assert.equal(properties['playbook_account_snapshot'], texts.account_snapshot);
  assert.equal(properties['playbook_next_step'], texts.next_step);
  assert.equal(Object.keys(properties).length, 5);
});

test('assemblePlaybook uses section fallback when a text is missing', () => {
  const { properties } = assemblePlaybook({ account_snapshot: 'x' });
  assert.equal(properties['playbook_why_now'], PLAYBOOK_SECTIONS.find((s) => s.name === 'why_now')!.fallback);
});

test('generate.sales-playbook is registered and live', () => {
  const op = OPERATIONS['generate.sales-playbook'];
  assert.ok(op);
  assert.equal(op.status, 'live');
  assert.equal(op.category, 'generate');
});
