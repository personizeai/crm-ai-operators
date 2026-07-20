import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hubspotFieldType, salesforceFieldMetadata } from '../core/setup/apply-crm-properties.js';

test('longtext maps to a HubSpot long-text property', () => {
  const ft = hubspotFieldType({ propertyName: 'Zone Body', systemName: 'zone_body', type: 'longtext' } as never);
  assert.equal(ft.type, 'string');
  assert.equal(ft.fieldType, 'textarea');
});

test('longtext maps to a Salesforce LongTextArea with a large length', () => {
  const md = salesforceFieldMetadata({ propertyName: 'Zone Body', systemName: 'zone_body', type: 'longtext' } as never);
  assert.equal(md.type, 'LongTextArea');
  assert.ok(typeof md.length === 'number' && md.length >= 32768);
  assert.ok(typeof md.visibleLines === 'number');
});

test('text still maps to a 255 Salesforce Text (unchanged)', () => {
  const md = salesforceFieldMetadata({ propertyName: 'Score', systemName: 'score', type: 'text' } as never);
  assert.equal(md.type, 'Text');
  assert.equal(md.length, 255);
});
