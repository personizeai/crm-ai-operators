# `client.ai.prompt()` — SDK Reference

> Verified against `@personize/sdk` `dist/types.d.ts` line 827. This is the authoritative shape — when this doc and the cookbook disagree, the type definition wins.

The Personize SDK's `client.ai.prompt()` is far richer than our local [`aiPrompt`](../src/core/lib/ai.ts) wrapper currently uses. It supports single-prompt mode, multi-step instructions arrays (with per-step `maxSteps` budget), server-side structured output extraction, server-side evaluation, auto-memorize, MCP tool allowlists, multimodal attachments, and tier-based cost control. We're using ~10% of the surface today.

---

## The full `PromptOptions` interface

```ts
export interface PromptOptions {
  prompt?: string;
  instructions?: Array<string | { prompt: string; maxSteps?: number }>;

  stream?: boolean;

  // Model selection — pick ONE strategy:
  model?: string;            // requires BYOK (openrouterApiKey)
  provider?: string;         // requires BYOK
  tier?: 'basic' | 'pro' | 'ultra';   // when no BYOK; auto-selects model
  openrouterApiKey?: string; // BYOK toggle

  context?: string;
  sessionId?: string;

  attachments?: PromptAttachment[];   // images, PDFs, docs (max 10, 50 MB total)

  evaluate?: PromptEvaluateConfig;
  evaluationCriteria?: string;        // alias for evaluate: { criteria, serverSide: true }

  memorize?: PromptMemorizeConfig;

  outputs?: PromptOutputDefinition[]; // server-side <output name="..."> extraction

  metadata?: { recordId?: string };

  mcpTools?: McpToolSelection[];      // per-MCP allowlist/denylist
}
```

Helper types:

```ts
type PromptEvaluateConfig = boolean | {
  criteria?: string;       // preset name ('sales', 'research', etc.) or custom rubric
  serverSide?: boolean;    // server evaluates with gpt-4o-mini instead of LLM tool call
};

interface PromptMemorizeConfig {
  email?: string;
  websiteUrl?: string;
  recordId?: string;
  type?: 'Contact' | 'Company' | 'User';
  captureToolResults?: boolean;   // auto-memorize tool results from research tools
}

interface PromptOutputDefinition {
  name: string;            // unique name; LLM emits <output name="..."> markers
}

interface McpToolSelection {
  mcpId: string;
  enabledTools?: string[];   // allowlist
  disabledTools?: string[];  // denylist
}

interface PromptAttachment {
  name?: string;
  mimeType: string;          // image/png, application/pdf, text/csv, etc.
  data?: string;             // base64 OR
  url?: string;              // public URL — one of these required
}
```

---

## `prompt` vs `instructions` — two modes, mutually exclusive

### Single-prompt mode — pass `prompt`

```ts
await client.ai.prompt({
  prompt: "Score this company 0-100 against the ICP.",
  context: "# ICP Definition\n\n...",
  tier: "pro",
});
```

One LLM call. Best for classification, scoring, single-act extraction. This is what our local `aiPrompt` wraps today.

### Multi-step mode — pass `instructions: []`

```ts
await client.ai.prompt({
  instructions: [
    "Identify the strongest hook from the contact data.",
    "Draft 3 emails using that hook, applying brand-voice rules.",
    { prompt: "Audit each email; report any brand-voice violations.", maxSteps: 5 },
    "Rewrite to clear all violations.",
  ],
  context: "# Outreach Playbook\n\n...\n\n# Brand Voice\n\n...",
  outputs: [{ name: "final_emails" }, { name: "audit_log" }],
  tier: "pro",
});
```

Each element is **either** a plain string **or** `{ prompt, maxSteps }`. The `maxSteps` cap limits agentic-loop iterations within that single instruction (default: server-side limit). The server runs the chain in one request and returns:

```ts
{
  text: string,                   // final response text
  outputs: { final_emails: ..., audit_log: ... },  // extracted via <output> markers
  steps: [
    { instructionIndex: 0, prompt: "...", text: "...", usage: {...}, toolCalls: [...] },
    { instructionIndex: 1, prompt: "...", text: "...", ... },
    ...
  ],
  metadata: { instructionsExecuted: 4, ... }
}
```

Why use multi-step instead of N separate `client.ai.prompt()` calls?
- One HTTP round-trip instead of N
- Server holds the chain context — no client-side re-passing of step outputs
- Per-step `maxSteps` budget gives precise tool-loop control
- Single `metadata` rollup — total tokens, total credits, per-step breakdown
- Streams via `step_complete` SSE events for real-time UX

---

## `outputs` — server-side structured extraction

The SDK's `outputs` is NOT a Zod schema. It's a list of named extractors:

```ts
outputs: [
  { name: "score" },
  { name: "reason" },
  { name: "audit_log" },
]
```

The model is instructed to wrap each named output in XML markers in its response:

```
<output name="score">87</output>
<output name="reason">Strong firmographic match + 3 decision-maker champions</output>
<output name="audit_log">{"issues": []}</output>
```

The server parses these markers and returns them as `response.outputs.score`, `response.outputs.reason`, etc. This replaces unreliable JSON-mode parsing.

You can layer Zod validation on top in your code (the way our local wrapper does), but the *transport* is XML markers, not JSON.

---

## `evaluate` — server-side rubric scoring

```ts
evaluate: true                                    // default criteria
evaluate: { criteria: "sales", serverSide: true } // preset rubric
evaluate: { criteria: "Custom rubric: clarity, evidence cited, no fabricated facts.", serverSide: true }
```

When `serverSide: true`, the server runs evaluation with `gpt-4o-mini` after the main response and returns:

```ts
response.evaluation = {
  finalScore: 0.87,
  criteriaScores: [
    { name: "clarity", score: 9, maxScore: 10, reason: "..." },
    { name: "evidence_cited", score: 8, maxScore: 10, reason: "..." },
  ],
  explanation: "...",
}
```

Use this to auto-flag low-scoring outputs for human review — no extra `aiPrompt` call needed.

---

## `memorize` — auto-save outputs

```ts
memorize: {
  email: "champion@acme.com",
  type: "Contact",
  captureToolResults: true,    // also save research tool outputs
}
```

The server stores the response (and optionally tool results) on the named record after generation completes. Replaces explicit `memory_save` calls.

`captureToolResults: true` excludes meta tools (`smart_guidelines`, `recall_pro`, `memorize_pro`, `store_evaluation_log`) — only research tool outputs are captured.

---

## `tier` — quality / cost control without BYOK

```ts
tier: "basic"   // fast, cheap; small models
tier: "pro"     // balanced (default)
tier: "ultra"   // highest quality; large frontier models
```

Determines default model + per-credit billing rate. Use BYOK (`openrouterApiKey` + `model` + `provider`) for time-based billing instead.

---

## `mcpTools` — per-MCP allowlist / denylist

```ts
mcpTools: [
  { mcpId: "user_clearbit_mcp", enabledTools: ["enrich_company"] },
  { mcpId: "user_perplexity_mcp", disabledTools: ["search_finance"] },
]
```

Limits which MCP tools the prompt can call. Critical for batch ops with cost-sensitive MCPs — prevents the AI from calling expensive tools unnecessarily.

---

## `attachments` — multimodal (images, PDFs, docs)

```ts
attachments: [
  { name: "screenshot.png", mimeType: "image/png", data: "<base64>" },
  { name: "report.pdf", mimeType: "application/pdf", url: "https://..." },
]
```

Max 10 attachments, 20 MB each, 50 MB total. In multi-step mode, attachments are sent with the **first instruction only**.

Supported MIME types: `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml`, `application/pdf`, `text/plain`, `text/csv`, `text/html`, `text/markdown`, `application/json`.

---

## Response shape

```ts
{
  success: boolean,
  text: string,                  // final response text
  outputs?: Record<string, unknown>,   // server-extracted by name
  evaluation?: {
    finalScore: number,
    criteriaScores: Array<{ name, score, maxScore, reason }>,
    explanation: string,
  },
  metadata?: {
    model: string,
    provider: string,
    tier?: 'basic' | 'pro' | 'ultra',
    creditsCharged?: number,         // 1 credit = $0.01
    byok?: boolean,
    usage?: { promptTokens, completionTokens, totalTokens },
    toolCalls?: Array<{ toolName, args }>,
    toolResults?: Array<{ toolName, result }>,
    stepsExecuted?: number,           // simple mode AI SDK steps
    instructionsExecuted?: number,    // multi-step mode
  },
  steps?: Array<{                  // multi-step mode only
    instructionIndex: number,
    prompt: string,
    text: string,
    usage?: { promptTokens, completionTokens, totalTokens },
    toolCalls?: Array<{ toolName, args }>,
    stepsExecuted: number,
  }>
}
```

Streaming yields `text`, `output`, `step_complete`, `done`, `error` SSE events.

---

## What our local `aiPrompt` does (and what it skips)

[`src/core/lib/ai.ts`](../src/core/lib/ai.ts) currently:

| SDK feature | Used by our wrapper? |
|---|---|
| `prompt: string` | ✅ Yes — concatenates `context + instructions` |
| `instructions: array` | ❌ Not exposed |
| `context` | ✅ Passed through |
| `outputs: PromptOutputDefinition[]` | ❌ Not used — Zod-validates JSON client-side instead |
| `evaluate` | ❌ Not used |
| `memorize` | ❌ Not used — operations call `memory_*` explicitly |
| `tier` | ❌ Not exposed (uses provider defaults) |
| `model`, `provider`, `openrouterApiKey` | ⚠️ Only `model` exposed |
| `mcpTools` | ❌ Not exposed |
| `attachments` | ❌ Not exposed |
| `metadata.recordId` | ❌ Not used |
| `sessionId` | ❌ Not used |

We've left a lot on the table. In particular:
- **`instructions` array** would let one operation run plan→execute→qa→self-correct as ONE server-side call instead of 4 round-trips.
- **`outputs` (server XML extraction)** is more reliable than client-side JSON parsing — no markdown-fence stripping, no partial-truncation failures.
- **`evaluate`** would replace hand-rolled QA prompts in high-stakes ops.
- **`memorize`** would consolidate the "generate → write back" pattern into a single call.
- **`tier`** would let operations declare cost class (`basic` for sync ops, `ultra` for proposals).
- **`mcpTools`** would let batch ops cap MCP usage per record.

---

## Conventions we use today (with the limited wrapper)

```ts
const guidelines = await loadGuidelines([...]);

for (const record of records) {
  const result = await aiPrompt({
    instructions: `<verb directive>\n\n<format spec>\n\nData:\n${JSON.stringify(record)}`,
    context: `# Guideline 1\n\n${guidelines["g1"]}\n\n---\n\n# Guideline 2\n\n${guidelines["g2"]}`,
    outputs: SomeZodSchema,    // client-side Zod validation
    temperature: 0.1 | 0.2 | 0.3 | 0.4,
    maxTokens: 300 | 800 | 1500,
  });
  // ...write result.output to memory...
}
```

Conventions:
1. **Schemas at module scope, with strict bounds** — `z.number().int().min(0).max(100)`, `z.string().min(20).max(280)`, `z.enum([...])`.
2. **Guidelines in `context`, per-record data in `instructions`** — keeps cacheable text separate from variable text.
3. **Temperature tuned per task class** — `0.1` classification, `0.2` scoring, `0.3-0.5` generation.
4. **`maxTokens` right-sized to schema** — 300 for one-field, 1500 for full reports.

These conventions still apply when we move to the full `PromptOptions` surface — they translate directly.

---

## Migration plan: expand the wrapper

Two concrete steps to unlock the full SDK:

### Step 1 — extend `aiPrompt` to support multi-step

```ts
export interface AiPromptOptions<T extends z.ZodTypeAny> {
  // existing
  instructions: string | Array<string | { prompt: string; maxSteps?: number }>;
  outputs: T;
  context?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;

  // NEW — pass-through to SDK
  tier?: 'basic' | 'pro' | 'ultra';
  evaluate?: PromptEvaluateConfig;
  memorize?: PromptMemorizeConfig;
  serverOutputs?: PromptOutputDefinition[];   // server-side XML extraction
  mcpTools?: McpToolSelection[];
  attachments?: PromptAttachment[];
  metadata?: { recordId?: string };
}
```

When `instructions` is a string → routes to SDK `prompt`. When array → routes to SDK `instructions`. Result extends with `steps[]` and `evaluation` when present.

### Step 2 — operations adopt where it pays

| Operation class | Adopt | Why |
|---|---|---|
| `score.icp-fit`, `score.lead-quality` | `tier: 'basic'` | Volume × deterministic = cheap tier wins |
| `analyze.reply-sentiment`, `analyze.buying-stage` | `evaluate: true` | Confidence-gate writes by server eval |
| `generate.proposal`, `generate.mutual-action-plan`, `generate.outreach-sequence` | `instructions: []` for plan→execute→qa→self-correct | Single round-trip beats 4 |
| `report.win-loss`, `report.pipeline-health` | `tier: 'ultra'` + `evaluate` | Quality matters; server eval flags weak reports |
| `research.account-deep-dive` | `mcpTools` allowlist + `memorize` | Constrain tool budget; auto-save research |
| All ops | `metadata.recordId` | Links the prompt run to the record being processed |

Worked example — `generate.outreach-sequence` upgraded:

```ts
await aiPrompt({
  instructions: [
    "Identify the strongest hook + 3 distinct angles for this contact.",
    "Draft 3 emails using those angles. Apply brand-voice tone rules.",
    "Audit each email against the outreach-playbook + brand-voice. Report violations.",
    "Rewrite to clear all violations. No new content.",
  ],
  context: `# Outreach Playbook\n\n${guidelines["outreach-playbook"]}\n\n---\n\n# Brand Voice\n\n${guidelines["brand-voice"]}`,
  serverOutputs: [{ name: "final_emails" }, { name: "audit_log" }],
  outputs: EmailsSchema,                  // client-side Zod on final_emails
  tier: "pro",
  evaluate: { criteria: "outreach-quality", serverSide: true },
  memorize: { email: contact.email, type: "Contact" },
  mcpTools: [{ mcpId: "user_research_mcp", enabledTools: ["search_news"] }],
  metadata: { recordId: contact.record_id },
});
```

One server-side request replaces:
- 4 separate `aiPrompt` calls
- Manual `memory.save` after generation
- Manual `evaluate` prompt
- Manual MCP tool guard

---

## Quick reference

```ts
// Today (single-prompt only via local wrapper)
import { aiPrompt } from "../../lib/ai.js";
import { z } from "zod";

const Schema = z.object({ score: z.number(), reason: z.string() });

const r = await aiPrompt({
  instructions: `Score this.\n\n${data}`,
  context: `# Rules\n\n${guideline}`,
  outputs: Schema,
  temperature: 0.2,
});
r.output.score;  // typed
```

```ts
// SDK direct — full surface (until we expand the wrapper)
const r = await client.ai.prompt({
  instructions: [
    "Plan the angle.",
    { prompt: "Draft using the plan.", maxSteps: 3 },
    "Audit and report violations.",
    "Rewrite to clear violations.",
  ],
  context: "# Brand Voice\n\n...",
  outputs: [{ name: "draft" }, { name: "audit" }],
  tier: "pro",
  evaluate: true,
  memorize: { email: "...", type: "Contact" },
  metadata: { recordId: "..." },
});

r.outputs.draft;          // server-extracted
r.evaluation.finalScore;  // 0..1
r.steps[0].usage;         // per-step tokens
r.metadata.creditsCharged;
```

---

## See also

- [`node_modules/@personize/sdk/dist/types.d.ts:827`](../node_modules/@personize/sdk/dist/types.d.ts) — authoritative `PromptOptions` interface
- [`src/core/lib/ai.ts`](../src/core/lib/ai.ts) — current local wrapper (uses ~10% of the surface)
- Personize cookbook → `personize_cookbook(focus="agent")` → `cheat-agentic-workflows.md` — when to use which SDK surface
