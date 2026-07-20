# Sales Playbook and Landing Zones Operations (public engine)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two dedicated, first-class engine operations, `generate.sales-playbook` and `generate.landing-zones`, that generate personalized content and deliver it to HubSpot and Salesforce as namespaced custom properties, so a customer renders it in their own marketing emails, CMS, and rep views. Neither repurposes an existing operation.

**Architecture:** The zone generation core is already ported into `src/core/lib/zones/` (pure, tested). This plan adds: a `longtext` property type so real content fits on both CRMs; zone-schema customization (personalized vs standard no-AI mode, per-zone fallback strategy, signal recency) ported from the production reference deployment's best practices; a pure playbook section engine; the two operation `run()` wrappers modeled exactly on `src/core/operations/impl/score-icp-fit.ts`; manifest properties for provisioning; a registry binding; and authoring guidelines. Operations call the guards library (present on this branch's base) on generated output before writeback.

**Tech Stack:** TypeScript strict, ESM, `node --test` via tsx, Zod (already a dependency). Branch `feat/playbook-and-zones` is based on `feat/output-guards-lib` (head c41ef02) so `src/core/lib/guards.ts` is available; the zone-core port is committed as the branch's first commit.

## Global Constraints

- Repo: `c:\Users\Admin\Documents\GitHub\crm-ai-operators`, branch `feat/playbook-and-zones`.
- No em dashes; commit messages `feat(...)` / `test(...)` ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Use EXACTLY that trailer; do not substitute any other author name.
- **New test files MUST be appended to the `"test"` script in package.json** (the engine has no test glob; an unlisted test file never runs). The verification steps prove tests ran via `npm test`.
- Operation `run()` wrappers cannot be unit-tested end to end (the engine has no dependency-injection seam; `ai()`, `client`, `crmWriteback` are module singletons). Follow the engine's own convention: put all real logic in pure exported helpers and test those; keep `run()` a thin orchestrator mirroring `score-icp-fit.ts`. This is how every existing operation is structured.
- **Salesforce Text length is 255.** Full playbook or zone bodies exceed it. Rule: write only SHORT values (a URL, a status, a short summary) to `text` writeback fields; write full bodies to `longtext` fields (Task 1) and to Personize memory/workspace. Never write a multi-hundred-character body to a `text` field.
- Guards: call `applyGuards(text, config, context)` from `src/core/lib/guards.js` on generated text before writeback; act on `result.text` and record `result.fires`.
- Property namespacing is automatic: pass bare snake_case keys to `crmWriteback`; HubSpot prefixes `personize_`, Salesforce makes `Personize_<Pascal>__c`.

## File Structure (end state, additive)

```
src/core/lib/zones/schema.ts        # extended: fallback_strategy, generation_mode, static parsing
src/core/lib/zones/static.ts        # NEW: parse standard-mode zones from a guideline body
src/core/lib/zones/generate.ts      # extended: fallback strategy + recency wiring
src/core/lib/playbook/sections.ts   # NEW: playbook section schema + assembly (pure)
src/core/setup/apply-crm-properties.ts  # extended: longtext type mapping
src/core/operations/impl/apply-manifests-types (CollectionPropertySchema)  # extended: 'longtext'
src/core/operations/impl/generate-sales-playbook.ts   # NEW operation
src/core/operations/impl/generate-landing-zones.ts    # NEW operation
src/core/operations/registry.ts     # + 2 imports and array entries
manifests/core/collections/contacts.json  # + playbook_* and zone_* properties
manifests/core/guidelines/sales-playbook-authoring.md   # NEW
manifests/core/guidelines/landing-zone-authoring.md     # NEW
src/__tests__/longtext-property.test.ts
src/__tests__/zones-static.test.ts
src/__tests__/zones-fallback-strategy.test.ts
src/__tests__/playbook-sections.test.ts
package.json                        # + new test files
README.md / CHANGELOG.md            # doc lines
```

---

### Task 1: `longtext` property type across the schema and both CRMs

**Files:**
- Modify: the `CollectionPropertySchema` type enum (find it: `grep -rn "options\".*array" src/core` points to the property `type` union used by `apply-manifests.ts` and `apply-crm-properties.ts`)
- Modify: `src/core/setup/apply-crm-properties.ts` (`hubspotFieldType`, `salesforceFieldMetadata`)
- Test: `src/__tests__/longtext-property.test.ts`

**Interfaces:**
- Produces: `type` accepts `"longtext"`; HubSpot maps it to a long-text property, Salesforce to `LongTextArea` (length 32768). Existing `text` behavior unchanged.

- [ ] **Step 1: Locate the type union and the two mapping functions**

Run: `grep -rn "\"array\"\|'array'\|LongTextArea\|hubspotFieldType\|salesforceFieldMetadata\|type: \"text\"" src/core/setup/apply-crm-properties.ts src/core/operations/impl/apply-manifests.ts`
Record the exact line of the `type:` union (e.g. `"text"|"number"|"boolean"|"date"|"options"|"array"`) and the two functions' bodies in your report.

- [ ] **Step 2: Write the failing test**

Create `src/__tests__/longtext-property.test.ts`:

```ts
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
```

IMPORTANT: if `hubspotFieldType` / `salesforceFieldMetadata` are not currently exported, export them (add `export`) as part of this task so the test can import them; they are pure functions and exporting them is safe.

- [ ] **Step 3: Run to verify failure**

Run: `node --import tsx/esm --test src/__tests__/longtext-property.test.ts`
Expected: FAIL (either missing export or `longtext` unhandled).

- [ ] **Step 4: Implement**

1. Add `"longtext"` to the property `type` union wherever it is declared (the `CollectionPropertySchema` `type` field and any `ManifestProperty` view). Search-and-add; do not remove existing members.
2. In `hubspotFieldType`, add a case: `longtext` returns `{ type: 'string', fieldType: 'textarea' }` (mirror the existing `text` case's shape).
3. In `salesforceFieldMetadata`, add a case: `longtext` returns `{ type: 'LongTextArea', length: 32768, visibleLines: 5 }` (mirror how the existing cases return their metadata objects; `visibleLines` is required by the Tooling API for LongTextArea).
4. Export `hubspotFieldType` and `salesforceFieldMetadata` if not already exported.

- [ ] **Step 5: Run tests and typecheck**

Run: `node --import tsx/esm --test src/__tests__/longtext-property.test.ts` then `npm run typecheck`.
Expected: 3/3 pass, clean.

- [ ] **Step 6: Add to test script and commit**

Append ` src/__tests__/longtext-property.test.ts` to the `"test"` script in package.json.

```powershell
git add src/core/setup/apply-crm-properties.ts src/core/operations/impl/apply-manifests.ts src/__tests__/longtext-property.test.ts package.json
git commit -m "feat(setup): longtext property type maps to HubSpot textarea and Salesforce LongTextArea

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Only add apply-manifests.ts to the commit if the type union lived there; include whichever file you edited for the union.)

---

### Task 2: Zone customization, standard mode and per-zone fallback strategy

**Files:**
- Modify: `src/core/lib/zones/schema.ts` (add optional `fallback_strategy` per zone; add optional `generation_mode` on the schema)
- Create: `src/core/lib/zones/static.ts`
- Modify: `src/core/lib/zones/generate.ts` (apply fallback strategy; support standard mode)
- Test: `src/__tests__/zones-static.test.ts`, `src/__tests__/zones-fallback-strategy.test.ts`

**Interfaces:**
- Produces: `ZoneSpec.fallback_strategy?: 'fallback_copy' | 'hide_if_empty'` (default `'fallback_copy'`); `ZoneSchema.generation_mode?: 'personalized' | 'standard'` (default `'personalized'`); `parseStaticZones(guidelineBody: string, schema: ZoneSchema): Record<string, ZoneResult>` (reads `## <zone_name>` markdown headings, best practice from the reference deployment's dashboard-editable standard zones); `generateZones` honors both.

- [ ] **Step 1: Extend the schema (add fields + validation)**

In `src/core/lib/zones/schema.ts`:
- Add to `ZoneSpec`: `fallback_strategy?: 'fallback_copy' | 'hide_if_empty';`
- Add to `ZoneSchema`: `generation_mode?: 'personalized' | 'standard';`
- In `validateZoneSchema`, after the existing per-zone checks add: if `z.fallback_strategy` is present and not one of the two literals, push `zones[${i}].fallback_strategy: must be fallback_copy or hide_if_empty`. And if `s.generation_mode` is present and not one of the two literals, push `generation_mode: must be personalized or standard`.

- [ ] **Step 2: Write the failing static-mode test**

Create `src/__tests__/zones-static.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStaticZones } from '../core/lib/zones/static.js';
import type { ZoneSchema } from '../core/lib/zones/schema.js';

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
```

- [ ] **Step 3: Verify failure, implement static.ts**

Run the test (FAIL, module missing). Create `src/core/lib/zones/static.ts`:

```ts
import type { ZoneSchema } from './schema.js';
import { processZoneOutput, type ZoneResult } from './postprocess.js';

/**
 * Standard (no-AI) zone mode: copy comes from a dashboard-editable guideline
 * body written as `## <zone_name>` markdown sections, so a customer can change
 * standardized landing copy without a per-lead generation call or a deploy.
 * Ported from the production reference deployment's static-zone pattern. Each
 * section still runs through processZoneOutput, so the fail-safe fallback and
 * length rules apply identically to the personalized path.
 */
export function parseStaticZones(guidelineBody: string, schema: ZoneSchema): Record<string, ZoneResult> {
  const sections = extractSections(guidelineBody);
  const results: Record<string, ZoneResult> = {};
  for (const zone of schema.zones) {
    const raw = sections[zone.name];
    results[zone.name] = raw === undefined || raw.trim() === ''
      ? { text: zone.fallback, used_fallback: true, notes: ['standard mode: no copy for this zone, fallback used'] }
      : processZoneOutput(raw, zone);
  }
  return results;
}

function extractSections(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = body.split(/\r?\n/);
  let current: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (current !== null) out[current] = buf.join('\n').trim();
    buf = [];
  };
  for (const line of lines) {
    const h = line.match(/^##\s+([a-z][a-z0-9_]*)\s*$/);
    if (h && h[1] !== undefined) {
      flush();
      current = h[1];
    } else if (current !== null) {
      buf.push(line);
    }
  }
  flush();
  return out;
}
```

- [ ] **Step 4: Write the failing fallback-strategy test**

Create `src/__tests__/zones-fallback-strategy.test.ts`:

```ts
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
```

- [ ] **Step 5: Verify failure, extend generate.ts**

Run the test (FAIL: hide_if_empty not honored). In `src/core/lib/zones/generate.ts`, after `processZoneOutput` yields a `result`, if `result.used_fallback === true` and the zone's `fallback_strategy === 'hide_if_empty'`, replace the result's `text` with `''` (keep `used_fallback: true`, append a note `'hide_if_empty: wrote empty for template auto-hide'`). Apply this in both the success path and, for consistency, leave the exception path as-is (a thrown generation still uses fallback text unless the zone is hide_if_empty, in which case also blank it). Keep everything else identical.

Concretely, replace the per-zone result assignment with a helper applied to every `result` before `results[zone.name] = result`:

```ts
function applyFallbackStrategy(result: ZoneResult, zone: ZoneSpec): ZoneResult {
  if (result.used_fallback && zone.fallback_strategy === 'hide_if_empty') {
    return { text: '', used_fallback: true, notes: [...result.notes, 'hide_if_empty: wrote empty for template auto-hide'] };
  }
  return result;
}
```

Import `ZoneSpec` type and thread this through. (Do not change the `fallbacks` counter semantics: a hidden zone is still a fallback.)

- [ ] **Step 6: Run all zone tests + typecheck**

Run: `node --import tsx/esm --test src/__tests__/zones-static.test.ts src/__tests__/zones-fallback-strategy.test.ts src/__tests__/zones-schema.test.ts src/__tests__/zones-generate.test.ts` then `npm run typecheck`.
Expected: all pass (existing zone tests still green, new ones green).

- [ ] **Step 7: Add test files to the script and commit**

Append both new test files to package.json `"test"`.

```powershell
git add src/core/lib/zones/schema.ts src/core/lib/zones/static.ts src/core/lib/zones/generate.ts src/__tests__/zones-static.test.ts src/__tests__/zones-fallback-strategy.test.ts package.json
git commit -m "feat(zones): standard no-AI mode and per-zone hide-if-empty fallback strategy

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Playbook section engine (pure)

**Files:**
- Create: `src/core/lib/playbook/sections.ts`
- Test: `src/__tests__/playbook-sections.test.ts`

**Interfaces:**
- Produces: `PLAYBOOK_SECTIONS: readonly PlaybookSectionSpec[]` (the five fixed sections), `interface PlaybookSectionSpec { name: string; label: string; max_chars: number; fallback: string; guidance: string }`, `assemblePlaybook(sectionTexts: Record<string, string>): { full: string; properties: Record<string, string> }` (composes a rep-facing document and the per-section property map), `playbookSectionSchema(): ZoneSchema` (adapts the sections to a zone schema so the shared zone generator produces them).

The five sections, ported from the reference deployment's playbook doctrine: `account_snapshot`, `why_now`, `talk_track`, `landmines`, `next_step`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/playbook-sections.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYBOOK_SECTIONS, assemblePlaybook, playbookSectionSchema } from '../core/lib/playbook/sections.js';
import { validateZoneSchema } from '../core/lib/zones/schema.js';

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
```

- [ ] **Step 2: Verify failure, implement**

Create `src/core/lib/playbook/sections.ts`:

```ts
import type { ZoneSchema } from '../zones/schema.js';

/**
 * Sales playbook: a dedicated rep-facing pre-call structure, not the meeting
 * brief. Five fixed sections ported from the production reference deployment's
 * playbook doctrine. The shared zone generator produces the section text (each
 * section is a zone); this module owns the section set, the property mapping,
 * and the composed rep-facing document.
 */
export interface PlaybookSectionSpec {
  name: string;
  label: string;
  max_chars: number;
  fallback: string;
  guidance: string;
}

export const PLAYBOOK_SECTIONS: readonly PlaybookSectionSpec[] = [
  {
    name: 'account_snapshot',
    label: 'Account snapshot',
    max_chars: 400,
    fallback: 'Review the account record before the call: industry, size, and recent activity.',
    guidance: 'Three concrete facts about the company from research and CRM fields. No invention.'
  },
  {
    name: 'why_now',
    label: 'Why now',
    max_chars: 300,
    fallback: 'No timely trigger on file; open on a relevant business priority.',
    guidance: 'One or two dated signals within the recency window that make this a good moment. Never undated or future-dated.'
  },
  {
    name: 'talk_track',
    label: 'Talk track',
    max_chars: 500,
    fallback: 'Lead with the account facts above and ask an open question about their current priorities.',
    guidance: 'Three openers tied to the account facts. Offer framing, never assume product ownership.'
  },
  {
    name: 'landmines',
    label: 'Landmines',
    max_chars: 300,
    fallback: 'Do not assume the account already uses the product; confirm before claiming it.',
    guidance: 'What not to say, including any unconfirmed ownership claim.'
  },
  {
    name: 'next_step',
    label: 'Next step',
    max_chars: 200,
    fallback: 'Propose a short follow-up working session.',
    guidance: 'One concrete, low-friction next action.'
  }
];

export function playbookSectionSchema(): ZoneSchema {
  return {
    format_version: 1,
    output: 'plain_text',
    zones: PLAYBOOK_SECTIONS.map((s) => ({
      name: s.name,
      max_chars: s.max_chars,
      fallback: s.fallback,
      guidance: s.guidance
    }))
  };
}

export function assemblePlaybook(sectionTexts: Record<string, string>): {
  full: string;
  properties: Record<string, string>;
} {
  const properties: Record<string, string> = {};
  const blocks: string[] = [];
  for (const s of PLAYBOOK_SECTIONS) {
    const text = sectionTexts[s.name]?.trim() ? sectionTexts[s.name]!.trim() : s.fallback;
    properties[`playbook_${s.name}`] = text;
    blocks.push(`${s.label}\n${text}`);
  }
  return { full: blocks.join('\n\n'), properties };
}
```

- [ ] **Step 3: Run test + typecheck**

Run: `node --import tsx/esm --test src/__tests__/playbook-sections.test.ts` then `npm run typecheck`.
Expected: 4/4 pass, clean.

- [ ] **Step 4: Add to script and commit**

```powershell
git add src/core/lib/playbook/sections.ts src/__tests__/playbook-sections.test.ts package.json
git commit -m "feat(playbook): dedicated five-section playbook engine (pure)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `generate.sales-playbook` operation + manifest + registry

**Files:**
- Create: `src/core/operations/impl/generate-sales-playbook.ts`
- Modify: `manifests/core/collections/contacts.json` (add playbook properties)
- Modify: `src/core/operations/registry.ts`

**Interfaces:**
- Consumes: `playbookSectionSchema`, `assemblePlaybook` (Task 3); `generateZones` (zone core); `applyGuards` (guards lib); the engine libs `retrieveRecord` (recall), `loadGuidelines`/`missingGuidelines` (governance), `ai` (ai runtime), `crmWriteback` (writeback), `workspace.appendUpdate`.
- Produces: `OperationEntry` named `generate.sales-playbook`.

This task's `run()` cannot be unit-tested (singleton backend). Model it EXACTLY on `src/core/operations/impl/score-icp-fit.ts`: read that file first. The reviewer verifies structural fidelity to that pattern plus the writeback-short-values rule.

- [ ] **Step 1: Add manifest properties to contacts.json**

Add these property objects to the `properties` array of `manifests/core/collections/contacts.json` (match the file's existing property object shape exactly; `autoSystem: true`, `source: "inferred"`, `writeback: true`). Short values are `text`; the composed body is `longtext`:

- `{ propertyName: "Playbook Status", systemName: "playbook_status", type: "text", autoSystem: true, source: "inferred", writeback: true, description: "Latest sales-playbook generation status" }`
- `{ propertyName: "Playbook Full", systemName: "playbook_full", type: "longtext", autoSystem: true, source: "inferred", writeback: true, description: "Composed rep-facing sales playbook" }`
- One per section, all `longtext`: `playbook_account_snapshot`, `playbook_why_now`, `playbook_talk_track`, `playbook_landmines`, `playbook_next_step` (propertyName in Title Case, e.g. "Playbook Account Snapshot").

- [ ] **Step 2: Write the operation**

Create `src/core/operations/impl/generate-sales-playbook.ts`. Read `score-icp-fit.ts` first and mirror its imports, dry-run guard, guideline handling, and the `mirror...ToCrm` writeback helper. The operation:

```ts
import type { OperationEntry, OperationContext, OperationResult } from '../types.js';
import { retrieveRecord } from '../../lib/recall.js';
import { loadGuidelines, missingGuidelines } from '../../lib/governance.js';
import { ai } from '../../lib/ai.js';
import { crmWriteback } from '../../lib/crm-writeback.js';
import { appendUpdate } from '../../lib/workspace.js';
import { logger } from '../../lib/logger.js';
import { applyGuards, DEFAULT_GUARD_CONFIG } from '../../lib/guards.js';
import { z } from 'zod';
import { PLAYBOOK_SECTIONS, assemblePlaybook } from '../../lib/playbook/sections.js';

const REQUIRED_GUIDELINES = ['Sales Playbook Rules', 'Brand Voice'];

const PlaybookSchema = z.object(
  Object.fromEntries(PLAYBOOK_SECTIONS.map((s) => [s.name, z.string()]))
);

export const generateSalesPlaybook: OperationEntry = {
  name: 'generate.sales-playbook',
  mode: 'operation',
  category: 'generate',
  status: 'live',
  cost: 'medium',
  idempotent: false,
  guidelines_required: REQUIRED_GUIDELINES,
  run: async (input: unknown, context: OperationContext): Promise<OperationResult> => {
    const email = (input as { email?: string })?.email;
    const base = { ok: true, runId: context.runId, operation: 'generate.sales-playbook', dryRun: context.dryRun, status: 'live' as const };
    if (!email) return { ...base, ok: false, summary: 'no email in input' };

    const contact = await retrieveRecord({ email, type: 'contact' });
    if (!contact) return { ...base, ok: false, summary: `contact not found: ${email}` };

    const guidelines = await loadGuidelines(REQUIRED_GUIDELINES);
    const missing = missingGuidelines(guidelines);
    if (missing.length > 0) return { ...base, ok: false, summary: `missing guidelines: ${missing.join(', ')}` };

    if (context.dryRun) return { ...base, summary: `[dry-run] would generate playbook for ${email}` };

    const facts = Array.isArray((contact as { recent_news?: string[] }).recent_news) ? (contact as { recent_news?: string[] }).recent_news! : [];
    const guidanceLines = PLAYBOOK_SECTIONS.map((s) => `${s.name} (max ${s.max_chars} chars): ${s.guidance}`).join('\n');
    const result = await ai({
      instructions: `Write each sales playbook section for a rep preparing to call ${contact.company ?? contact.email}. Return one string per section key. Sections:\n${guidanceLines}`,
      context: Object.values(guidelines).join('\n\n') + `\n\nCompany: ${contact.company ?? ''}\nTitle: ${contact.job_title ?? ''}\nSignals: ${facts.join('; ')}`,
      outputs: PlaybookSchema,
      temperature: 0.3
    });

    const guardCfg = { ...DEFAULT_GUARD_CONFIG, mode: 'enforce' as const };
    const guarded: Record<string, string> = {};
    let fires = 0;
    for (const s of PLAYBOOK_SECTIONS) {
      const g = applyGuards(String((result.output as Record<string, string>)[s.name] ?? ''), guardCfg, { ownershipConfirmed: false });
      guarded[s.name] = g.text;
      fires += g.fires.length;
    }
    const { full, properties } = assemblePlaybook(guarded);

    await appendUpdate({ email }, { author: 'generate.sales-playbook', type: 'playbook', summary: 'Generated sales playbook', details: full }, 'playbook');

    const crmRecordId = (contact as { crm_record_id?: string }).crm_record_id;
    let wrote = false;
    if (crmRecordId) {
      try {
        wrote = await crmWriteback(
          { crm: context.crm, type: 'contact', crmRecordId },
          { playbook_status: 'generated', playbook_full: full, ...properties }
        );
      } catch (err) {
        logger.warn('sales-playbook: crm writeback failed', { error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { ...base, summary: `playbook generated for ${email}${wrote ? ', written to CRM' : ''}`, metrics: { guard_fires: fires, crm_written: wrote } };
  }
};
```

NOTE for the implementer: the exact flattened field names on `contact` (`company`, `job_title`, `recent_news`, `crm_record_id`) must be confirmed against `score-icp-fit.ts` / the contacts manifest; adjust the reads to the real property names if they differ, and record what you used. The `ai()`, `appendUpdate`, `crmWriteback`, `loadGuidelines` import paths must match how `score-icp-fit.ts` imports them (it is the source of truth); fix any path/name that differs from that file.

- [ ] **Step 3: Register**

In `src/core/operations/registry.ts`, add `import { generateSalesPlaybook } from './impl/generate-sales-playbook.js';` with the other imports and add `generateSalesPlaybook` to the `ALL` array in the generate block.

- [ ] **Step 4: Typecheck and a registration test**

Run `npm run typecheck` (must pass; this is the main gate for the un-unit-testable operation). Then add to an existing or new small test that the registry exposes the op:

Append to `src/__tests__/playbook-sections.test.ts`:

```ts
import { OPERATIONS } from '../core/operations/registry.js';
test('generate.sales-playbook is registered and live', () => {
  const op = OPERATIONS['generate.sales-playbook'];
  assert.ok(op);
  assert.equal(op.status, 'live');
  assert.equal(op.category, 'generate');
});
```

- [ ] **Step 5: Run tests and commit**

Run `npm test` and `npm run typecheck`; all green.

```powershell
git add src/core/operations/impl/generate-sales-playbook.ts manifests/core/collections/contacts.json src/core/operations/registry.ts src/__tests__/playbook-sections.test.ts
git commit -m "feat(generate): dedicated generate.sales-playbook operation delivering CRM properties

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `generate.landing-zones` operation + manifest + registry

**Files:**
- Create: `src/core/operations/impl/generate-landing-zones.ts`
- Modify: `manifests/core/collections/contacts.json` (add example zone properties + status)
- Modify: `src/core/operations/registry.ts`

**Interfaces:**
- Consumes: `generateZones`, `parseStaticZones`, `mapZonesToProperties`, `validateZoneSchema` (zone core); `applyGuards`; the same engine libs as Task 4.
- Produces: `OperationEntry` named `generate.landing-zones`.

The operation resolves the campaign's zone schema from a guideline (the campaign's `zone_schema` guideline body is JSON), then in `personalized` mode runs `generateZones` with an `ai()`-backed generate function, or in `standard` mode runs `parseStaticZones` over a copy guideline, guards the output, maps to `personize_zone_*` properties, and writes them.

- [ ] **Step 1: Manifest properties**

Add to `manifests/core/collections/contacts.json`: `{ propertyName: "Zone Status", systemName: "zone_status", type: "text", autoSystem: true, source: "inferred", writeback: true, description: "Latest landing-zone generation status" }` plus, as provisioned examples covering the shipped generative-marketing zones, three `longtext` properties `zone_hero_headline`, `zone_proof_paragraph`, `zone_cta_line` (propertyName Title Case). Document that additional zone properties are added the same way (or generated via `buildPropertyManifestFragment`) per campaign.

- [ ] **Step 2: Write the operation**

Create `src/core/operations/impl/generate-landing-zones.ts`, mirroring `score-icp-fit.ts` structure and the Task 4 operation. Key differences: it loads the zone-schema guideline (JSON body → `JSON.parse` → `validateZoneSchema`, fail on invalid), branches on `schema.generation_mode`, and writes `personize_zone_*` values.

```ts
import type { OperationEntry, OperationContext, OperationResult } from '../types.js';
import { retrieveRecord } from '../../lib/recall.js';
import { loadGuideline, loadGuidelines, missingGuidelines } from '../../lib/governance.js';
import { ai } from '../../lib/ai.js';
import { crmWriteback } from '../../lib/crm-writeback.js';
// NOTE: appendUpdate is actually workspace.appendUpdate and setProperties lives in
// persist.js; confirm the real import forms and signatures against score-icp-fit.ts
// and persist.js before trusting these lines (Task 4 found the workspace import is
// namespaced, not a bare export).
import { appendUpdate } from '../../lib/workspace.js';
import { setProperties } from '../../lib/persist.js';
import { logger } from '../../lib/logger.js';
import { applyGuards, DEFAULT_GUARD_CONFIG } from '../../lib/guards.js';
import { z } from 'zod';
import { validateZoneSchema, type ZoneSchema } from '../../lib/zones/schema.js';
import { generateZones } from '../../lib/zones/generate.js';
import { parseStaticZones } from '../../lib/zones/static.js';
import { mapZonesToProperties } from '../../lib/zones/properties.js';

const REQUIRED_GUIDELINES = ['Landing Page Rules', 'Brand Voice'];
const ZoneTextSchema = z.object({ value: z.string() });

export const generateLandingZones: OperationEntry = {
  name: 'generate.landing-zones',
  mode: 'operation',
  category: 'generate',
  status: 'live',
  cost: 'medium',
  idempotent: false,
  guidelines_required: REQUIRED_GUIDELINES,
  run: async (input: unknown, context: OperationContext): Promise<OperationResult> => {
    const email = (input as { email?: string })?.email;
    const base = { ok: true, runId: context.runId, operation: 'generate.landing-zones', dryRun: context.dryRun, status: 'live' as const };
    if (!email) return { ...base, ok: false, summary: 'no email in input' };

    const contact = await retrieveRecord({ email, type: 'contact' });
    if (!contact) return { ...base, ok: false, summary: `contact not found: ${email}` };

    const guidelines = await loadGuidelines(REQUIRED_GUIDELINES);
    const missing = missingGuidelines(guidelines);
    if (missing.length > 0) return { ...base, ok: false, summary: `missing guidelines: ${missing.join(', ')}` };

    const schemaBody = await loadGuideline('Landing Zone Schema');
    let schema: ZoneSchema;
    try {
      schema = JSON.parse(schemaBody) as ZoneSchema;
    } catch {
      return { ...base, ok: false, summary: 'Landing Zone Schema guideline is not valid JSON' };
    }
    const schemaErrors = validateZoneSchema(schema);
    if (schemaErrors.length > 0) return { ...base, ok: false, summary: `invalid zone schema: ${schemaErrors.join('; ')}` };

    if (context.dryRun) return { ...base, summary: `[dry-run] would generate ${schema.zones.length} zones for ${email}` };

    const lead = { company: String(contact.company ?? contact.email), industry: contact.industry as string | undefined, researched_facts: Array.isArray((contact as { recent_news?: string[] }).recent_news) ? (contact as { recent_news?: string[] }).recent_news : [], confirmed_customer: false };

    let zoneResults;
    if (schema.generation_mode === 'standard') {
      const copyBody = await loadGuideline('Landing Zone Copy');
      zoneResults = parseStaticZones(copyBody, schema);
    } else {
      const composedContext = Object.values(guidelines).join('\n\n');
      const out = await generateZones(schema, guidelines, lead, {
        generate: async (prompt: string) => {
          const r = await ai({ instructions: prompt, context: composedContext, outputs: ZoneTextSchema, temperature: 0.3 });
          return (r.output as { value: string }).value;
        }
      });
      zoneResults = out.results;
    }

    const guardCfg = { ...DEFAULT_GUARD_CONFIG, mode: 'enforce' as const };
    let fires = 0;
    for (const name of Object.keys(zoneResults)) {
      const g = applyGuards(zoneResults[name]!.text, guardCfg, { ownershipConfirmed: false });
      zoneResults[name] = { ...zoneResults[name]!, text: g.text };
      fires += g.fires.length;
    }
    const properties = mapZonesToProperties(zoneResults, { prefix: 'zone_' });

    // Memory first (source of truth), then CRM mirror, matching crm-writeback.ts's
    // documented order. Use the real persist helper that sets multiple properties on
    // a record (confirm name/signature against src/core/lib/persist.ts and an existing
    // caller). A memory-write failure makes the op return ok:false; the CRM mirror
    // failing stays ok:true. appendUpdate's third arg is the entity type ('contact')
    // and its update `type` must be a valid WorkspaceUpdate type ('action'), and
    // `details` is Record<string, unknown>, not a bare string (reconcile with score-icp-fit.ts).
    const memoryWritten = await setProperties({ email, type: 'contact' }, { zone_status: 'generated', ...properties });
    if (!memoryWritten) {
      return { ...base, ok: false, summary: `zones generated for ${email} but memory write failed` };
    }

    await appendUpdate({ email }, { author: 'generate.landing-zones', type: 'action', summary: `Generated ${Object.keys(properties).length} landing zones`, details: { properties } }, 'contact');

    // Short-circuit: the CRM mirror only runs after a successful memory write, so the
    // external CRM can never be ahead of Personize memory (the source of truth).
    const crmRecordId = (contact as { crm_record_id?: string }).crm_record_id;
    let wrote = false;
    if (crmRecordId) {
      try {
        wrote = await crmWriteback({ crm: context.crm, type: 'contact', crmRecordId }, { zone_status: 'generated', ...properties });
      } catch (err) {
        logger.warn('landing-zones: crm writeback failed', { error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { ...base, summary: `zones generated for ${email}${wrote ? ', written to CRM' : ''}`, metrics: { zones: Object.keys(properties).length, guard_fires: fires, crm_written: wrote } };
  }
};
```

Same NOTE as Task 4: reconcile field/import names against `score-icp-fit.ts` and the manifest; record deviations. Prefix discipline: call `mapZonesToProperties(zoneResults, { prefix: 'zone_' })` so keys are `zone_<name>`; both `setProperties` (memory) and `crmWriteback` (which re-prefixes `personize_`) then produce `personize_zone_<name>` on the CRM. Do NOT pass keys that already start with `personize_` to `crmWriteback` or they double-prefix.

Ownership safety for zones: unlike the playbook op, landing zones are generated one zone at a time, so a single verify-then-emit call does not fit. Zone ownership safety comes from two places already in the pipeline: `buildZonePrompt` injects an explicit offer-framing instruction ("never state or imply the company already uses the product") whenever `lead.confirmed_customer !== true`, and `applyGuards` still performs the config-independent coerce and placeholder-leak checks. Per-campaign banned-phrase and ownership-term enforcement depends on campaign guard config, which is a documented follow-up (note it in the report). Set `lead.confirmed_customer` from a real CRM/brief signal when available; default false (safe).

- [ ] **Step 3: Register + registration test + typecheck**

Add the import and `ALL` entry in registry.ts. Append to `src/__tests__/zones-static.test.ts`:

```ts
import { OPERATIONS } from '../core/operations/registry.js';
test('generate.landing-zones is registered and live', () => {
  const op = OPERATIONS['generate.landing-zones'];
  assert.ok(op && op.status === 'live' && op.category === 'generate');
});
```

Run `npm run typecheck` (primary gate) and `npm test`.

- [ ] **Step 4: Commit**

```powershell
git add src/core/operations/impl/generate-landing-zones.ts manifests/core/collections/contacts.json src/core/operations/registry.ts src/__tests__/zones-static.test.ts
git commit -m "feat(generate): generate.landing-zones operation with personalized and standard modes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Authoring guidelines

**Files:**
- Create: `manifests/core/guidelines/sales-playbook-authoring.md`
- Create: `manifests/core/guidelines/landing-zone-authoring.md`

These are manifest guidelines (gray-matter frontmatter `name:` plus body), provisioned by `setup.apply`. Content authored fresh; no real names; no em dashes. Match the frontmatter shape of an existing file in `manifests/core/guidelines/` (read one first).

- [ ] **Step 1: Read an existing guideline for the frontmatter shape**, then create `sales-playbook-authoring.md` documenting: the five fixed sections and what each must contain, the recency rule for why-now, the offer-framing/ownership rule for the talk track, the under-400-word target, the access-gating expectation, and that the composed body lands in `personize_playbook_full` while sections land in `personize_playbook_<section>`.

- [ ] **Step 2: Create `landing-zone-authoring.md`** documenting: how to write a `Landing Zone Schema` guideline as JSON (the zone schema, variable count, each zone's name/max_chars/fallback/guidance/theme), the two `generation_mode` values and when to use standard (dashboard-editable `Landing Zone Copy` guideline with `## zone_name` sections) vs personalized, the two `fallback_strategy` values (`fallback_copy` renders approved copy, `hide_if_empty` writes empty so the customer template auto-hides the zone), the company-anchor/never-first-name rule, and that zones land in `personize_zone_<name>` properties the customer renders in their own templates.

- [ ] **Step 3: Commit**

```powershell
git add manifests/core/guidelines/sales-playbook-authoring.md manifests/core/guidelines/landing-zone-authoring.md
git commit -m "docs(guidelines): sales-playbook and landing-zone authoring guidelines

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: CHANGELOG, README, full sweep

**Files:**
- Modify: `CHANGELOG.md` (Unreleased), `README.md` (capability menu / operations list if present)

- [ ] **Step 1: CHANGELOG Unreleased entry** naming the two operations, the zone core, the longtext type, and the CRM-property delivery model (both CRMs), and stating there is no behavior change to existing operations.

- [ ] **Step 2: README** add the two operations to whatever operation list or capability menu exists (grep for `generate.outreach-sequence` in README/docs to find it) with one-line descriptions.

- [ ] **Step 3: Full sweep**

Run: `npm run typecheck`, `npm test` (all green; report the total), and confirm the two new operations appear via `node --import tsx/esm -e "import('./src/core/operations/registry.js').then(m=>console.log(Object.keys(m.OPERATIONS).filter(n=>n.includes('playbook')||n.includes('landing'))))"`.

- [ ] **Step 4: Commit**

```powershell
git add CHANGELOG.md README.md
git commit -m "docs: changelog and README for sales-playbook and landing-zones operations

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review Notes (kept for the executor)

- The two operations are un-unit-testable end to end by the engine's own design (no DI seam; `ai`/`client`/`crmWriteback` singletons). Correctness rests on: (1) all real logic living in pure tested helpers (zone core, static parsing, fallback strategy, playbook sections), (2) `run()` mirroring `score-icp-fit.ts` exactly, (3) typecheck, (4) a registration test, and (5) the branch review reading `run()` against `score-icp-fit.ts`. State this honestly; do not fake an end-to-end test.
- Salesforce Text(255) is the reason for the `longtext` type; every full-body property is `longtext`, every short value (`*_status`, a URL) is `text`.
- Guards are called by each operation on generated text before writeback (enforce mode). The runner-level choke point (a separate upstream PR) is not required for these ops to be guarded.
- Zone property provisioning for arbitrary campaign zones is manifest-driven (Task 5 ships three example zone properties); document `buildPropertyManifestFragment` as the per-campaign path. A future enhancement could provision a campaign's declared zones automatically at setup.
- Branch base is `feat/output-guards-lib`; merge order becomes RFC (#20), guards lib (#21), then this branch. The zone-core port is this branch's first commit (already done).
- Field/import names in Tasks 4-5 are written against the documented contract; the implementer reconciles them against `score-icp-fit.ts` (the source of truth in-repo) and records any deviation.
