# Incident Report — `personize_cookbook` MCP returned ~42K tokens, missed the actual SDK signature

**Reported by:** AI agent (Claude Sonnet 4.6) consuming `personize_cookbook` via Personize MCP
**Reporter contact:** success@personize.ai
**Date:** 2026-05-04
**Severity:** Medium — costs tokens, produces incorrect docs/code, but recoverable by checking SDK types directly
**Component:** `personize_cookbook` MCP tool + skill content (`personize-reference`, `personize-agent-core`, `cheat-agentic-workflows.md`)
**SDK version observed:** `@personize/sdk` (whatever version is installed in `crm-ai-operators` repo as of 2026-05-04)

---

## Summary

I asked the cookbook twice for the request schema of `client.ai.prompt()`, specifically whether `instructions` accepts a string or an array. Both responses came back at ~21K tokens each (42K total), exceeded the harness per-tool-result cap, and **never contained the literal `PromptOptions` interface**. Worse, one of the cheat tables (`cheat-agentic-workflows.md`) actively misled me into believing `instructions` was a parameter on `client.responses.create()` only, which caused me to write incorrect documentation that downstream developers would have shipped.

The actual answer was 6 lines in `node_modules/@personize/sdk/dist/types.d.ts` line 827. A direct `Read` on the SDK types file solved it instantly.

This ticket includes (a) reproducible queries, (b) file paths to the persisted raw responses for verification, (c) the specific misleading content, and (d) recommended fixes.

---

## Reproducer

### Call 1

**Tool invocation:**
```
mcp__personize__personize_cookbook({
  message: "How does the Personize SDK ai prompt method work? Specifically, does the `instructions` parameter accept a single string OR an array of instructions? Show me the full request param schema and any examples of multi-step / chained instructions.",
  focus: "reference"
})
```

**Response metadata:**
- Persisted file: `<reporter-machine>/.claude/projects/<project>/tool-results/mcp-personize-personize_cookbook-1777920942259.txt`
- Bytes on disk: **88,936**
- Parsed text length (after JSON envelope strip): **85,940 chars**
- Approx tokens (chars / 4): **~21,485**
- Result was rejected by the harness ("exceeds maximum allowed tokens"), forcing chunked file reads

**Routing:**
- Selected skill: `personize-reference`
- Embedding similarity: **0.631**
- Variable ID: `<redacted>`

**Content audit (regex over the parsed text):**

| Probe | Found? |
|---|---|
| String `PromptOptions` | ❌ No |
| Pattern `instructions?:` (TS optional syntax) | ❌ No |
| Pattern `Array<string` | ❌ No |
| String `maxSteps` | ❌ No |
| String `outputs?: PromptOutputDefinition` | ❌ No |
| Phrase `multi-step` | ✅ Yes (in prose only) |
| `client.ai.prompt(` mentions | 8 (all in endpoint table) |
| `responses.create` mentions | 4 |
| `instruction` substring matches | 6 (all about `guidelines.smartUpdate({ instruction })` — a different SDK method) |

**Bottom line:** the literal answer to my question — "does `client.ai.prompt()` accept an array for `instructions`?" — was nowhere in 21K tokens.

---

### Call 2

**Tool invocation:**
```
mcp__personize__personize_cookbook({
  message: "Show me the exact request body schema for client.ai.prompt() — every parameter, including instructions (single string vs array?), context, outputs, evaluate, memorize, tools, temperature, model. I need a concrete code example showing all options.",
  focus: "enabler"
})
```

**Response metadata:**
- Persisted file: `<reporter-machine>/.claude/projects/<project>/tool-results/mcp-personize-personize_cookbook-1777922094064.txt`
- Bytes on disk: **87,745**
- Parsed text length: **84,767 chars**
- Approx tokens: **~21,192**
- Same harness-cap rejection as Call 1

**Routing:**
- Selected skill: `personize-agent-core` (NOT `personize-reference`)
- Embedding similarity: **0.484** (weaker than Call 1)
- Variable ID: `<redacted>`

**Content audit:** Same regex probe as Call 1 → identical result. `PromptOptions` not present. Six `instruction` substring matches were all about `guidelines.smartUpdate`. The actual answer was again missing.

**Critical regression:** my second query was *more specific* ("exact TypeScript interface", named all the params), but the routing got *worse* — moved from `personize-reference` (0.631) to `personize-agent-core` (0.484). Asking for SDK schema with `focus: enabler` sent me to coordination patterns instead of the reference skill.

---

## What the cookbook DID get right

The endpoint mapping table that appeared in both responses is accurate at a high level:

```
| Operation                  | SDK Method                       | API                              |
|----------------------------|----------------------------------|----------------------------------|
| Single prompt              | client.ai.prompt()               | POST /api/v1/prompt              |
| Prompt with tools          | client.ai.prompt()               | POST /api/v1/prompt              |
| Prompt with evaluation     | client.ai.prompt()               | POST /api/v1/prompt              |
| Prompt with auto-memorize  | client.ai.prompt()               | POST /api/v1/prompt              |
| Streaming (SSE)            | client.ai.promptStream()         | POST /api/v1/prompt              |
| Multi-step / agentic       | client.responses.create()        | POST /api/v1/responses           |
| Chat completions           | client.chat.completions.create() | POST /api/v1/chat/completions    |
```

This correctly tells me what methods exist and what HTTP routes they hit. It does NOT tell me what the request body of any of them looks like.

---

## What the cookbook ACTIVELY MISLED with

`cheat-agentic-workflows.md` (verbatim from both responses):

```
| Mode             | Use When                              | Cost   | Key Params                      |
| ai.prompt        | Single prompt, eval, auto-memorize    | 1 call | prompt, evaluate, memorize:true |
| responses.create | Multi-step, client tools, loops       | varies | instructions, tools, steps      |
| chat.completions | OpenAI drop-in replacement            | varies | messages, model                 |
| promptStream     | Real-time streaming UX                | 1 call | prompt, stream:true             |
```

Three problems with this table:

1. **It attributes `instructions` to `responses.create` only.** Per `types.d.ts:827`, `instructions: Array<string | { prompt: string; maxSteps?: number }>` is on `PromptOptions` — the param type for `client.ai.prompt()`. Both methods accept `instructions`. The table implies `ai.prompt` does not.

2. **It says `ai.prompt` is "Single prompt"** in the "Use When" column. The truth is `ai.prompt` is dual-mode — `prompt` xor `instructions[]`. Calling it "Single prompt" reinforces the false impression.

3. **The "Key Params" for `ai.prompt` lists only `prompt, evaluate, memorize:true`** — omitting `instructions`, `outputs[]` (server-side `<output>` extraction), `tier`, `mcpTools`, `attachments`, `metadata.recordId`. This is a small fraction of the real surface.

This table exists to help an AI choose between modes quickly. Because it lies by omission about `ai.prompt`'s capabilities, an AI consuming it will pick `responses.create` for any multi-step need and write more complex code than necessary.

**This is what I did.** I wrote a docs/AI-INSTRUCTIONS.md file claiming `responses.create` was the multi-step API and `ai.prompt` was single-only. The user caught it.

---

## Ground truth (verified)

**File:** `node_modules/@personize/sdk/dist/types.d.ts`
**Line:** 827

```ts
export interface PromptOptions {
  prompt?: string;
  instructions?: Array<string | { prompt: string; maxSteps?: number }>;
  stream?: boolean;
  model?: string;            // BYOK only
  provider?: string;         // BYOK only
  tier?: 'basic' | 'pro' | 'ultra';
  openrouterApiKey?: string;
  context?: string;
  sessionId?: string;
  attachments?: PromptAttachment[];
  evaluate?: PromptEvaluateConfig;
  evaluationCriteria?: string;
  memorize?: PromptMemorizeConfig;
  outputs?: PromptOutputDefinition[];
  metadata?: { recordId?: string };
  mcpTools?: McpToolSelection[];
}
```

Six lines (the field list) tell the agent everything it needs:
- `prompt` and `instructions` are mutually exclusive optional fields
- `instructions` is an array; each element is either a string or `{ prompt, maxSteps }`
- `outputs` is an array of `{ name }` (server-side `<output name="">` XML extraction, not a Zod schema)
- All the other surface area: `tier`, `evaluate`, `memorize`, `mcpTools`, `attachments`

---

## Token economics

| Metric | Value |
|---|---|
| Cookbook calls made | 2 |
| Total cookbook tokens returned | ~42,677 |
| Tokens that contained the answer | 0 |
| Tokens needed if cookbook had returned the type signature | ~120 (6 lines × ~20 tokens) |
| Cost ratio | **~355× over-spend** |
| Harness rejections (over per-result cap) | 2 / 2 |
| Manual recovery work (file read + JSON parse + regex triage) | 4-6 extra tool calls |

Both responses also blew the harness per-tool-result token cap, forcing the agent to:
1. Read the persisted txt file from disk
2. Parse the JSON envelope (`[{type, text}]`)
3. Run regex searches over 85K chars in PowerShell
4. Manually triage which sections might contain the answer

This adds latency and tool-call overhead even when the answer is nowhere in the persisted content.

---

## Persisted artifacts (for downstream verification)

Both raw responses are persisted on the reporter's machine. Format per the harness: JSON array `[{type: string, text: string}]`. The Personize team or another agent can read them at:

1. **Call 1 (focus: reference, query about `instructions` array):**
   `<reporter-machine>/.claude/projects/<project>/tool-results/mcp-personize-personize_cookbook-1777920942259.txt`

2. **Call 2 (focus: enabler, query for full TS interface):**
   `<reporter-machine>/.claude/projects/<project>/tool-results/mcp-personize-personize_cookbook-1777922094064.txt`

To verify my audit, parse `[0].text` and grep for `PromptOptions`, `Array<string`, `maxSteps`, `outputs?: PromptOutputDefinition`. None will appear.

---

## Recommended fixes

### A. Fix the misleading cheat table

`cheat-agentic-workflows.md` — current table attributes `instructions` to `responses.create` only. Replace with:

```
| Mode             | Use When                                   | Key Params                                                                                  |
| ai.prompt (single)        | One mental act (classify/score/extract)    | prompt, context, outputs, evaluate, memorize, tier, mcpTools, attachments                |
| ai.prompt (multi-step)    | plan -> act -> qa -> fix in one round-trip | instructions: [string | {prompt, maxSteps}], outputs, evaluate, memorize, tier, mcpTools |
| responses.create          | Multi-step + client-side tool loop > 20    | instructions, tools, steps                                                                |
| chat.completions          | OpenAI-SDK drop-in                         | messages, model                                                                           |
| promptStream              | Real-time streaming UX                     | prompt or instructions, stream:true                                                       |
```

The split into "ai.prompt (single)" and "ai.prompt (multi-step)" makes the dual-mode nature obvious at a glance.

### B. Add `prompt-options-schema.md` as a reference attachment

Ship a literal copy of the `PromptOptions`, `PromptResponse`, `PromptMemorizeConfig`, `PromptEvaluateConfig`, `PromptOutputDefinition`, `McpToolSelection`, `PromptAttachment` interfaces — copy-pasted from `types.d.ts`. Tag with `personize:skill:reference` and `personize:skill:sdk`.

When an agent asks "what does `client.ai.prompt()` accept", the cookbook should return THIS file, not 21K tokens of cheat-sheet prose.

### C. Improve embedding match for schema-shaped queries

Phrases that should always route to `personize-reference` (and to schema attachments specifically):
- "exact TypeScript interface"
- "request body schema"
- "what parameters does X accept"
- "show me the full signature"
- "what fields does Y have"

In Call 2 my query contained "exact request body schema for client.ai.prompt()" and `focus: enabler`. The system routed to `personize-agent-core` (coordination patterns). It should have routed to `personize-reference` and surfaced the schema attachment.

### D. Consider a "schema-only" return mode

When the query is clearly schema-shaped, return JUST the type signature + a one-line example, not the cheat-sheet bundle. The agent can ask follow-ups for prose if it wants. A 200-token return beats a 21K-token return.

### E. Match-score floor / fallback

When the embedding similarity is below ~0.5 (Call 2 was 0.484), the cookbook should warn the agent: "Low confidence match — consider checking SDK types directly at `node_modules/@personize/sdk/dist/types.d.ts`." Call 1 at 0.631 was a stronger match but still missed the schema; Call 2 at 0.484 was a routing miss the system could have flagged.

---

## What I'm doing on my side

For agents working in this repo (and any repo using `@personize/sdk`):

1. **First check, when the question is "what does method X accept":** `Glob` for `**/node_modules/@personize/sdk/**/*.d.ts`, then `Grep` the type name. Ground truth in 1-2 tool calls.
2. **Cookbook second:** use it for "how do I do X at scale", patterns, batch recipes — not for type lookups.
3. **Watch for cheat-table misattribution:** high-level mode-comparison tables prioritize quick decisions over factual completeness. Verify against the actual SDK before quoting them in production docs.

---

## Reproduction without my session

The harness-persisted files include the full JSON envelopes returned by the MCP tool. To reproduce the audit without access to my session:

```powershell
$path = "<path to persisted .txt file>"
$parsed = Get-Content $path -Raw | ConvertFrom-Json
$text = $parsed[0].text
"length: $($text.Length)"
# Should be ~85K chars
"PromptOptions present: $($text -match 'PromptOptions')"
# Should be False
"Array<string present: $($text -match 'Array<string')"
# Should be False
```

Or fire fresh `personize_cookbook` calls with the queries listed under "Call 1" and "Call 2" above and run the same probes against the new responses.

---

## Acceptance criteria for the fix

- [ ] An agent asking `personize_cookbook("does client.ai.prompt() accept instructions as an array?")` receives the literal `PromptOptions` interface in the response (or a clear pointer to a schema attachment containing it).
- [ ] `cheat-agentic-workflows.md` table no longer attributes `instructions` to `responses.create` only.
- [ ] Total token return for a schema-shaped query is < 2,000 tokens (vs the current ~21K).
- [ ] An embedding-match score < 0.5 produces a warning to the agent suggesting direct SDK type lookup.

---

## Appendix — search probes used to audit the persisted responses

```powershell
$content = Get-Content $path -Raw
$parsed = $content | ConvertFrom-Json
$text = $parsed[0].text
foreach ($probe in @('PromptOptions','instructions\?:','Array<string','maxSteps','outputs\?:\s*PromptOutputDefinition','multi-step')) {
  $hit = ($text -match "(?i)$probe")
  "{0,-50}: {1}" -f $probe, $hit
}
```

Counts on raw `instruction` substring (note: matches `guidelines.smartUpdate({ instruction })` and unrelated noise; no match was for `ai.prompt`'s `instructions` parameter):

```powershell
$mm = [regex]::Matches($text, '(?i)instruction')
"Total occurrences: $($mm.Count)"
foreach ($m in $mm) {
  $start = [Math]::Max(0, $m.Index - 60)
  $text.Substring($start, [Math]::Min(160, $text.Length - $start))
}
```

In both Call 1 and Call 2, all 6 occurrences were `guidelines.smartUpdate({ instruction })` — irrelevant to the question.
