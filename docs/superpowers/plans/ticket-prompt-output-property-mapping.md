# Ticket: Extend `/api/v1/prompt` to Support Output → Property Auto-Sync

## Summary

The internal agent executor (`execute.controller.ts`) already supports `collectionId` and
`propertyId` on output definitions, routing extracted prompt outputs directly to specific
Personize properties on the target record. The real-time `/api/v1/prompt` endpoint does not
expose this capability — its `PromptOutputDefinition` type only has `name: string`. This
ticket asks the backend team to wire the same behavior into the real-time path.

**No new payload shape is being invented.** The extension uses the identical fields and
resolution logic that `execute.controller.ts` already implements.

---

## Gap

### Current type in `prompt-types.ts` (both fargate repos)

```typescript
export interface PromptOutputDefinition {
  name: string;  // only field
}
```

### Extended type that execute.controller.ts already processes

```typescript
// From RunPromptSchedulePayload in SDK and execute.controller.ts
outputs?: Array<{
  name: string;
  collectionId?: string;   // slug or ID of the target Personize collection
  propertyId?: string;     // systemName or ID of the target property
  required?: boolean;
}>;
```

### What the execute controller already does (do the same in prompt controller)

1. `enrichOutputsWithSchema(orgId, outputs)` — three-tier property lookup:
   - direct by `propertyId`
   - fallback to `systemName`
   - fallback to property `name`
2. Passes enriched outputs to `autoMemorizeOutputs` with `collectionId` per output
3. `memorize-factory.ts` `buildMemorizeContext` routes each mapped output to its collection

### What the prompt controller is missing

`prompt.controller.ts` calls `autoMemorizeOutputs` but only passes `memorizeConfig`
(entity anchor: email/websiteUrl/recordId). It never passes the `outputDefinitions`,
so `collectionId`/`propertyId` are invisible to the auto-memorize step.

Files to change:
- `src/modules/api/prompt/prompt-types.ts` — add `collectionId?` and `propertyId?` to `PromptOutputDefinition`
- `src/modules/api/prompt.controller.ts` — pass `outputDefinitions` to `autoMemorizeOutputs` in both sync (lines ~704) and async (lines ~1061) paths
- `src/modules/api/prompt/auto-memorize.ts` — accept `outputDefinitions` param and route per-output `collectionId` (reuse the logic in `memorize-factory.ts`)

---

## Desired Behaviour (after fix)

### Payload — real-time `POST /api/v1/prompt`

```json
{
  "instructions": "Research this company and return structured findings.",
  "outputs": [
    { "name": "context_summary", "collectionId": "companies", "propertyId": "context", "required": true },
    { "name": "industry",        "collectionId": "companies", "propertyId": "industry" },
    { "name": "employee_count",  "collectionId": "companies", "propertyId": "employee_count" }
  ],
  "memorize": {
    "websiteUrl": "acme.com",
    "type": "Company"
  },
  "tier": "pro",
  "mcpTools": [{ "mcpId": "tavily" }]
}
```

### Rules

| Condition | Behaviour |
|-----------|-----------|
| Output has `collectionId` + `propertyId` AND `memorize` is set | Extracted value auto-written to `propertyId` on the memorized record |
| Output has mapping but `memorize` is NOT set | Mapping is silently ignored (no record to anchor to) |
| Output has NO mapping | Returned in response only — current behaviour, unchanged |
| Output value is null / undefined / empty | No write (skip gracefully) |
| `required: true` output missing from model response | Request fails with existing "missing required output" error |

### Response shape — unchanged

```json
{
  "success": true,
  "text": "...",
  "outputs": {
    "context_summary": "Acme Corp is a...",
    "industry": "SaaS"
  }
}
```

Mapped outputs are still returned in the response. Auto-sync is additive — callers
that already call `setProperty()` manually after the prompt will double-write (harmless
but redundant; callers should remove the manual write once this ships).

---

## How crm-ai-operators will use this (assumed fixed)

Once this ships, `research.account-deep-dive` and `research.contact-background` will
pass `serverOutputs` with `collectionId`/`propertyId` for each mappable property and
drop the corresponding manual `setProperty()` calls. The `memorize` field already exists
in our `AiPromptOptions` interface and will provide the record anchor.

Properties NOT mappable via this feature (kept as manual writes):
- Computed timestamps (`context_updated_at`, `job_title_updated_at`) — not AI outputs
- Transformed values (`pain_points` array → pipe-joined string) — need client-side transform
- Multi-record writes (signals, stakeholder contacts) — one AI call, many records

---

## References

- Execute controller enrichment: `src/modules/internal/execute/execute.controller.ts` lines 242, 571–577, 1195–1206
- Memorize factory collection routing: `src/modules/internal/executor/tools/definitions/memory/memorize-factory.ts` lines 198–232
- SDK type that already has the extended fields: `RunPromptSchedulePayload` in `sdk/dist/types.d.ts` lines 3792–3797
- crm-ai-operators wrapper types: `src/core/lib/ai.ts` — `ServerOutputDefinition`, `MemorizeConfig`
