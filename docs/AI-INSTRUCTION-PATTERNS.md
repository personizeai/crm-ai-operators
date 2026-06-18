# Multi-step `instructions[]` — Authoring Guide + Pattern Catalog

> Authoritative guide for writing `client.ai.prompt({ instructions: [...] })` calls. Covers (a) when to use multi-step, (b) framework runtime behavior the author can't change, (c) authoring rules, (d) context-wiring conventions, (e) 14 patterns across two tiers, (f) four error-handling tiers with an inline cookbook, and (g) response shapes and anti-patterns.
>
> Companion to [AI-INSTRUCTIONS.md](AI-INSTRUCTIONS.md) (full `PromptOptions` reference). Authoring craft lives here; raw API surface lives there.
>
> These patterns apply equally to the deterministic `prompt` verb and the autonomous `subagent` verb (`client.ai.subagent` / the repo's `aiSubagent`) — same options, same endpoint. Multi-step authoring is most relevant to `subagent`-style plan→act→qa flows.

---

## Table of Contents

1. [When to use multi-step](#when-to-use-multi-step-over-a-single-prompt)
2. [Framework runtime behavior per step](#how-the-framework-treats-each-step)
3. [Authoring rules of thumb](#authoring-rules-of-thumb)
4. [Per-step responsibilities](#per-step-responsibilities)
5. [Output granularity per step](#output-granularity-per-step)
6. [Context-wiring conventions](#context-wiring-conventions)
7. [`<abort>` mechanism](#the-abort-mechanism)
8. [`outputs[]` semantics](#outputs-semantics--required-vs-optional-property-bindings)
9. [Part I — Core patterns (1–5)](#part-i--core-patterns)
10. [Part II — Advanced patterns (A–I)](#part-ii--advanced-patterns)
11. [Error-handling tiers T1–T4](#error-handling-tiers-t1t4)
12. [Inline error-handling cookbook](#inline-error-handling-cookbook)
13. [Response shapes](#response-shapes-verified-against-promptresponse)
14. [Common pitfalls (25+)](#common-pitfalls)
15. [Quick decision flowchart](#quick-decision-flowchart)
16. [When NOT to use multi-step](#when-not-to-use-multi-step)
17. [Migration checklist](#migration-checklist-single-prompt--multi-step)

---

## When to use multi-step over a single prompt

Single prompt is the default. Multi-step earns its complexity only when **at least one** is true:

- The task has genuinely sequential reasoning (step N's output shapes step N+1's wording)
- You want a clear tool-call boundary (gather → reason → produce)
- You're paying for repeat completions and want the static system-prompt prefix cached (~90% discount on steps 2+ since the prefix doesn't change)

If the task fits in a single prompt without contortion, use a single prompt.

---

## How the framework treats each step (you can't change this — design around it)

| Step | What's special about it |
|---|---|
| **1st** | Gets the full retrieval pass: governed memory, `smart_guidelines`, `autoRecall`, `autoGuidelines`. Top-level `attachments` apply here. |
| **middle** | No fresh retrieval — inherits via accumulated `chatHistory`. Top-level `attachments` do NOT apply (use per-instruction inline data if needed). |
| **last** | Output marker reminder is auto-appended (`buildOutputReminder`). Evaluation prompts attach if `evaluate: true`. |
| **all** | Tool calls accumulate. Token usage sums into one credit charge. **`<abort>` in step N halts steps N+1..end and skips auto-memorize entirely.** |

Implications for authoring:
- **Front-load tool use into step 1** — that's where retrieval happens.
- **Put `<output>` markers on the last step by default** — the auto-reminder only fires there. Explicitly prompt middle steps if you need mid-chain outputs.
- **Put abort conditions in the verification step** — usually a middle step. Aborting early prevents downstream steps from amplifying garbage.

---

## Authoring rules of thumb

1. **One job per step.** If a step does two things, split it. If it does half a thing, merge with a neighbor.
2. **Reference, don't repeat.** "Based on the company profile above…" beats restating the original task. The earlier conversation is in `chatHistory`.
3. **Output granularity follows cohesion, not step position.** Each step can emit one output OR a bundle of related outputs. Group outputs that share reasoning (header + subhead + CTA = one landing-page narrative). Split outputs that need different reasoning (audit list ≠ rewritten draft). See [§ Output granularity per step](#output-granularity-per-step).
4. **The last step gets the marker reminder for free.** Middle steps emit outputs only when you explicitly ask in that step's prompt — the framework's auto-reminder is on the last step only.
5. **Use `required: true` sparingly** — only on outputs that gate the caller's notion of success. Mark the rest optional so the model can honestly skip rather than fabricate.
6. **Teach the model when to abort.** For research/identity tasks, write the abort condition into the prompt of the step that owns verification. Aborting early prevents downstream steps from amplifying garbage.
7. **2–4 steps is usually right.** Each step is its own LLM round-trip with its own latency. 6+ is a smell.

---

## Per-step responsibilities

### Step 1 — Setup / discovery

- Front-load tool use (web search, recall, smart_guidelines). The framework's retrieval pass happens here only.
- Tell the model to summarize what it found in plain prose.
- **Don't** ask for output markers yet.

### Middle steps — Reason / decide / validate

- Pure thinking over what's already in `chatHistory`.
- This is the right place to embed abort conditions: *"If after looking at the data above you cannot verify X, emit `<abort reason='unverified_X'>...</abort>`."*
- Aborting in a middle step prevents the last step from getting work it shouldn't.

### Last step — Synthesize + emit

- Compose the final answer and emit each output marker exactly once.
- Keep it short — the model has been thinking for two or three steps already; this is just the final write.
- The framework's marker reminder is auto-appended here, so a brief "emit the required outputs" suffices.

### A note on middle-step outputs

Middle steps CAN emit `<output>` markers when you ask explicitly in that step's prompt. The framework just doesn't auto-remind on those steps. Reasons to emit from a middle step:

- **The output is a deliverable in its own right** (e.g. a draft that the next step audits — both draft and audit are useful artifacts).
- **The output binds to a record property mid-chain** (e.g. raw research findings get auto-written before the synthesis step runs).
- **The output is consumed by the caller for routing** (e.g. classification with confidence — the operation may decide to short-circuit on low confidence without waiting for the rest).

When you want a middle step to emit, write `"Emit <output name='draft'>...</output>"` directly into that step's prompt. Don't rely on the framework to prompt the model.

---

## Output granularity per step

Step-to-output is **not** 1:1. Each step can emit one output OR a bundle of related outputs. The right granularity is determined by **cohesion** — do the outputs share reasoning, or are they distinct mental acts?

### Bundle related outputs into one step

When outputs are part of a single coherent narrative — they reference each other, share a tone, or one's choice constrains another — generate them together. The model holds the whole picture in working memory for that step, so cross-output consistency is automatic.

**Example: website personalization (one step, multiple outputs)**

```ts
{
  prompt: "Write the hero section for this visitor's vertical. Output ALL of: <output name='header_1'>primary headline (5-8 words)</output>, <output name='header_2'>supporting subhead (12-18 words)</output>, <output name='paragraph'>two-sentence value prop</output>, <output name='cta_text'>3-5 word CTA button copy</output>. The four pieces must form ONE coherent narrative — the subhead supports the headline, the paragraph supports the subhead, the CTA reflects the desired action implied by all three.",
  // (one step, 4 outputs — they're cohesive)
}
```

This is correct because:
- The headline shapes the subhead which shapes the paragraph which shapes the CTA.
- Splitting across 4 steps would force the model to re-establish the angle 4 times.
- Cross-piece consistency (tone, jargon, length parallelism) is much harder to achieve when each piece is generated in isolation.

### Split distinct mental acts into separate steps

When outputs require different reasoning modes — write vs. audit, plan vs. execute, classify vs. recommend — they belong in different steps even if they relate to the same artifact.

**Example: email + review (two steps, second one fuses review+regenerate)**

```ts
instructions: [
  // Step 1 — generate (cohesive bundle: subject + body MUST match)
  "Draft an email for this contact. Output BOTH together: <output name='subject_line'>compelling subject ≤ 60 chars</output> and <output name='body_html'>email body ≤ 120 words, brand-voice compliant</output>. Subject must reflect the body's hook.",

  // Step 2 — review + regenerate if needed (one step is OK because emails are SHORT)
  "Review the draft above against brand-voice and the outreach-playbook. If it passes, emit <output name='final_subject'>...</output> and <output name='final_body'>...</output> unchanged. If it fails, fix the issues AND emit the corrected versions. Either way, the final outputs MUST be the production-ready text.",
]
```

This is correct because:
- Subject + body is a cohesive bundle (subject ↔ body coherence is the most common email failure mode), so they share a step.
- Review and regenerate are different mental acts — but for a SHORT artifact like an email, fusing them in one step is acceptable because the rewrite is small enough that the model can hold "what to fix" and "the fix" together. For longer artifacts (proposals, reports), keep audit and rewrite separated (see Pattern 1).

### When to fuse review+rewrite vs. when to split them

| Length of artifact | Approach | Reason |
|---|---|---|
| Email (≤ 200 words), single CTA, hero section | **Fuse** review + rewrite into one step | The rewrite is small enough that the model can audit and fix in one pass without losing track |
| Multi-section proposal, MAP, win-loss report | **Split** audit and rewrite into separate steps | Long artifacts have many issues; fused steps tend to silently mask audit findings |
| Classification, scoring, single-field extraction | **Don't split at all** — one step is enough | Output is small; audit is just "did the math add up" — handle in step 2 of Pattern 2 (consistency check) |

### Granularity decision flowchart

```
For each artifact you want to produce:
├── Is it composed of pieces that reference each other (header + subhead + CTA, subject + body)?
│   └── YES → bundle them in ONE step's outputs
│
├── Is it the result of a single mental act (one classification, one score, one summary)?
│   └── YES → ONE step, ONE output
│
└── Is it the synthesis of distinct phases (plan + draft + audit + rewrite)?
    ├── Artifact is short (email, hero block, single paragraph) → fuse audit + rewrite into one final step
    └── Artifact is long (multi-section report, proposal, MAP) → keep audit and rewrite as separate steps
```

---

## Context-wiring conventions

The framework retrieves guidelines automatically on step 1 via SmartContext (`autoGuidelines`). Everything else is opt-in. Use the right wire for each kind of content:

| Source | How to attach | Scope | Best for |
|---|---|---|---|
| SmartContext (`autoGuidelines`) | Automatic — no code needed | **Step 1 only** | Org policies, brand voice, slow-changing compliance rules. Fired once per request. |
| `context` field | `context: "# Policy\n\n..."` in `PromptOptions` | **All steps** | Deterministic content the model must see at every step: ICP formulas, legal definitions, enumerated labels. Keep ≤ 2K tokens. |
| Top-level `attachments` | `attachments: [{ mimeType, data/url }]` | **Step 1 only** | Binary grounding material for the entire chain: PDFs, images, CSVs. Max 10, 50 MB total. |
| Inline in instruction string | String-concatenate into the instruction | **Single step only** | Very short data (≤ 200 words) specific to one step. Per-record data goes here, not in `context`. |

**Multi-step gotchas you must design around:**

- `autoGuidelines` fires ONCE at step 1. Do not assume middle steps can re-trigger it — all policy context must be grounded in step 1's memory or passed via `context`.
- `context` is re-sent every step — keep it concise or prefix-caching savings disappear. Don't put per-record data in `context`; that belongs inline in the step that first needs it.
- `attachments` (top-level) attach to step 1 only. If a later step needs a document, reference it by a public URL inline in that step's prompt.
- Per-record fields (the specific contact or company being processed) belong inline in step 1's prompt or whichever step first needs them — not in `context`, which is for guidelines, not data.
- `metadata.recordId` links the entire run to the record in the journal — always set it when processing a specific record.

---

## The `<abort>` mechanism

For identity-sensitive or research tasks, give the model an explicit way out:

```
"...If after looking at the data above you cannot verify the contact's current
employer, emit <abort reason='unverified_employer'>explanation</abort> instead.
Do not invent."
```

Effects of an abort:
- Halts steps after the aborting step
- Skips auto-memorize entirely (partial outputs are NOT written to records)
- Skips auto-evaluate
- Returns `success: false, aborted: true, abortReason: "..."` (HTTP 422 sync, async event marked `failed`)

This is the cure for the "AI invented a plausible email/name/role" failure mode. Without an abort path, the model fills gaps with fabrications and `auto-memorize` writes them to the record.

Pair with `required: true` on the outputs the abort would prevent — if the abort fires, the missing-required-outputs path doesn't trigger separately; the abort takes precedence.

---

## `outputs[]` semantics — required vs optional, property bindings

```ts
outputs: [
  // Gates the caller's success — abort or fail if missing
  { name: "email_draft",        required: true,  collectionId: "Contact", propertyId: "next_email_draft" },
  { name: "top_signal",         required: true },

  // Optional — model can honestly skip if data is weak
  { name: "secondary_signals",                    collectionId: "Contact", propertyId: "talking_points" },
  { name: "uncertainty_notes" },
]
```

| Field | Effect |
|---|---|
| `name` | The XML tag the model emits: `<output name="email_draft">...</output>` |
| `required: true` | Missing this output → request fails with `missing_required_outputs` |
| `collectionId` + `propertyId` | Auto-write the extracted value to a property on a record (bypasses LLM re-extraction) |

**Use `required: true` sparingly.** A single un-producible required field fails the entire request. The caller often prefers partial success they can act on.

**Property bindings** (`collectionId` + `propertyId`) are the bypass path in `auto-memorize` — the framework writes the output value directly to the named record property. No second LLM call to re-extract from text. Cheaper and more reliable.

---

## Part I — Core patterns

| # | Pattern | Use case in this repo | Tier | Steps | Self-check |
|---|---|---|---|---|---|
| 1 | **Plan → Draft → Audit → Rewrite** | `generate.outreach-sequence`, `generate.proposal` | `pro` | 4 | Internal QA + rewrite |
| 2 | **Analyze → Score → Consistency-check** | `score.icp-fit`, `score.lead-quality` | `basic` | 3 | Math invariant check |
| 3 | **Extract evidence → Classify → Route** | `analyze.reply-sentiment`, `analyze.buying-stage` | `basic` | 2 | Server `evaluate` |
| 4 | **MCP search → Synthesize → Cite-check** | `research.account-deep-dive` | `pro` | 3 | Citation grounding + abort |
| 5 | **Plan → Write → Adversarial-attack → Refine** | `report.win-loss`, `optimize.refine-icp` | `ultra` | 4 | Adversarial 2nd-pass + eval |

---

### Pattern 1 — Plan → Draft → Audit → Rewrite

**For:** generation that must follow strict format + voice rules. The model often gets the content right but violates one tone rule on the way; the audit + rewrite catches it without a human round-trip.

```ts
await client.ai.prompt({
  instructions: [
    // Step 1 — discovery + plan (no output markers)
    "Recall what we know about this contact, then identify the strongest hook from their data. Pick three distinct angles for emails 1, 2, 3. Summarize the plan in plain prose.",

    // Step 2 — draft
    "Based on the plan above, draft 3 emails. Email 1 = hook + soft ask. Email 2 = email2 angle (NOT a follow-up reminder). Email 3 = binary CTA. Apply brand-voice tone rules per line. Use only HTML tags from the outreach-playbook.",

    // Step 3 — audit (this is where abort lives if voice violation is unfixable)
    "Audit the draft above against brand-voice and outreach-playbook. Check: subject 5-120 chars; no ALL CAPS; no banned words; angles distinct; only allowed HTML tags; the primary hook from the plan appears in email 1. List each issue with a fix hint. If the draft fundamentally violates brand-voice in ways a mechanical rewrite cannot fix, emit <abort reason='brand_voice_violation'>explanation</abort>.",

    // Step 4 — rewrite + emit
    "Rewrite the emails to clear each issue from the audit. Touch only the lines the issue references — do not add new content. Then emit the required outputs.",
  ],
  context: `# Outreach Playbook\n\n${guidelines["outreach-playbook"]}\n\n---\n\n# Brand Voice\n\n${guidelines["brand-voice"]}`,
  outputs: [
    { name: "final_emails", required: true,  collectionId: "Contact", propertyId: "next_email_sequence" },
    { name: "audit_log" },  // optional — useful for debugging, not required for success
  ],
  tier: "pro",
  evaluate: { criteria: "outreach-quality", serverSide: true },
  memorize: { email: contact.email, type: "Contact" },
  metadata: { recordId: contact.record_id },
});
```

**Why this works:**
- Plan locks the angles BEFORE prose is written. Drift between angles is the #1 cold-outreach failure mode.
- Audit is **separate from rewrite**. Fused QA-and-rewrite tends to silently mask failures.
- Rewrite is mechanical — forbidden from new content.
- Abort path on step 3 prevents the rewrite step from running on garbage that needs human intervention.
- Property binding on `final_emails` writes the sequence directly to the contact without a second LLM extraction call.

---

### Pattern 2 — Analyze → Score → Consistency-check

**For:** numerical scoring where the model often weights factors inconsistently across records. The third step recomputes the score from the factor breakdown — catching the AI when its summary number disagrees with its own components.

```ts
await client.ai.prompt({
  instructions: [
    // Step 1 — discovery + per-factor evidence
    "Recall this company's firmographics, signals, engagement history, and champion data. Score each factor 0-100 independently: firmographic_fit, buying_signals, engagement, champion_potential. For each, name the strongest 1-2 pieces of evidence. Summarize in prose.",

    // Step 2 — score (mechanical weighted sum)
    "Compute the weighted total from the factors above: 0.4*firmographic + 0.3*signals + 0.2*engagement + 0.1*champion. Round to integer. Identify the top factor by weighted contribution. Write a one-sentence reason citing the top factor's evidence.",

    // Step 3 — consistency check + emit
    "Recompute the weighted sum using the formula 0.4*firmographic + 0.3*signals + 0.2*engagement + 0.1*champion. If it differs from your step-2 score by more than 1, use the recomputed value. Verify the reason cites the top factor's evidence verbatim. Emit the required outputs.",
  ],
  context: `# ICP Definition\n\n${guidelines["icp-definition"]}`,
  outputs: [
    { name: "icp_fit_score",  required: true, collectionId: "Company", propertyId: "icp_fit_score" },
    { name: "icp_fit_reason", required: true, collectionId: "Company", propertyId: "icp_fit_reason" },
    { name: "factor_breakdown" },  // optional — preserved for audit, not required
  ],
  tier: "basic",  // high volume, deterministic — cheap tier wins
  memorize: { websiteUrl: company.domain, type: "Company" },
  metadata: { recordId: company.record_id },
});
```

**Why this works:**
- Per-factor decomposition before the summary number forces evidence-grounded sub-scores.
- The consistency check is a math invariant: weighted sum from `factors` MUST equal `icp_fit_score`. If not, the recompute fixes it without involving creative reasoning.
- `tier: "basic"` because the math + analysis fit small models. Don't pay `pro` for deterministic work.
- Property bindings on score + reason write directly to the company record.
- No `evaluate` — the consistency check IS the eval.

---

### Pattern 3 — Extract evidence → Classify → Route

**For:** classification of inbound text (replies, intent signals, transcripts) where the class is constrained but the action depends on the class. Cheap, fast, runs on every inbound event.

```ts
await client.ai.prompt({
  instructions: [
    // Step 1 — extract evidence FIRST (forces reading)
    "Read the email body below and extract verbatim quotes that signal sentiment, intent, or objections. Pull at most 3 quotes. List them in plain prose with a label per quote.",

    // Step 2 — classify + route + emit
    "Using the evidence above, classify the reply into ONE of: 'Positive interest', 'Question', 'Referral', 'Objection', 'Soft no', 'Hard no', 'OOO', 'Unsubscribe', 'Bounce'. Pick the recommended next action: 'rep-handoff' / 'follow-up' / 'pause-sequence' / 'opt-out' / 'no-action'. State your confidence (low/medium/high). If the body is empty or unparseable, emit <abort reason='unreadable_reply'>explanation</abort>. Otherwise emit the required outputs.",
  ],
  context: `# Reply Handling\n\n${guidelines["reply-handling"]}\n\n---\n\n# Signal Definitions\n\n${guidelines["signal-definitions"]}`,
  outputs: [
    { name: "classification",     required: true, collectionId: "Conversation", propertyId: "sentiment" },
    { name: "recommended_action", required: true },
    { name: "confidence",         required: true },
    { name: "evidence_quotes" },  // optional
  ],
  tier: "basic",
  evaluate: true,  // server-side default eval — score < threshold flags for human review
  memorize: { email: reply.contact_email, type: "Contact" },
  metadata: { recordId: reply.conversation_id },
});
```

**Why this works:**
- Forcing evidence extraction in step 1 prevents the "vibe classification" failure mode.
- Step 2 binds the class TO the evidence — hallucinated classifications drop sharply.
- `confidence` is required — the operation routes `low` confidence to a human task instead of auto-acting.
- Abort path catches empty/unparseable bodies before they get force-classified as "no signal".
- Property binding on `classification` writes directly to the conversation record.

---

### Pattern 4 — MCP search → Synthesize → Cite-check

**For:** research that requires fresh external data via MCP tools. Different from the other patterns because it explicitly invokes tools and uses `maxSteps` to bound tool-loop iterations.

```ts
await client.ai.prompt({
  instructions: [
    // Step 1 — agentic search (tool-bounded, no output markers)
    {
      prompt: "Research this company using the allowed MCP tools. Fetch: recent news (last 90 days), funding events, leadership changes, public mentions of relevant pain points. Stop when you have enough evidence. Summarize findings in prose with source URLs and dates inline.",
      maxSteps: 5,  // tool-loop budget for this step only
    },

    // Step 2 — synthesize + verification gate
    "Using the findings above, synthesize a structured brief covering: company snapshot, current priorities (with evidence), buying signals (with severity), recommended angles. If after the search you cannot verify even the company's basic identity (no website, no recent activity, contradicting data), emit <abort reason='unverified_company'>explanation</abort> instead. Do not invent.",

    // Step 3 — citation grounding + emit
    "Verify every claim in your synthesis references a finding from step 1. Soften unsupported claims to 'preliminary' or remove them. Then emit the required outputs.",
  ],
  context: `# Account Research\n\n${guidelines["account-research"]}`,
  outputs: [
    { name: "company_snapshot",     required: true, collectionId: "Company", propertyId: "ai_snapshot" },
    { name: "buying_signals",                       collectionId: "Company", propertyId: "ai_signals" },
    { name: "recommended_angles",                   collectionId: "Company", propertyId: "ai_angles" },
    { name: "research_citations" },
  ],
  tier: "pro",
  mcpTools: [
    { mcpId: "user_perplexity_mcp", enabledTools: ["search_news", "search_web"] },
    { mcpId: "user_clearbit_mcp",   enabledTools: ["company_lookup"] },
    // implicit denylist: any other MCP tool is disabled for this run
  ],
  memorize: { websiteUrl: company.domain, type: "Company", captureToolResults: true },
  metadata: { recordId: company.record_id },
});
```

**Why this works:**
- `maxSteps: 5` on step 1 caps tool-loop runaways.
- `mcpTools` allowlist scopes which tools are callable — critical for batch ops where one expensive tool blows the budget.
- Abort on step 2 prevents the synthesis step from inventing a company profile when verification fails.
- Citation grounding (step 3) cures the "AI invented a stat" failure mode common in research outputs.
- `captureToolResults: true` auto-memorizes search/enrichment data for reuse by future operations.

---

### Pattern 5 — Plan → Write → Adversarial-attack → Refine

**For:** high-stakes outputs that ship to executives or customers. The third step is an *adversarial* pass — the model attacks its own previous work, finding fabrications and weak claims. More rigorous than Pattern 1's audit because it actively looks for logical/factual integrity issues, not just rule violations.

```ts
await client.ai.prompt({
  instructions: [
    // Step 1 — plan with statistical thresholds (discovery + reasoning)
    "Recall the won and lost account data. Identify the 3 most statistically meaningful differences between won and lost cohorts. A difference is meaningful only if it appears in 3+ accounts on one side AND <30% on the other. Reject patterns that look like coincidence. Summarize the plan in prose.",

    // Step 2 — write the report grounded in the plan
    "Using ONLY the differences from the plan above, write the win/loss report. Cite specific accounts by name for each pattern. Do NOT introduce patterns not in the plan.",

    // Step 3 — adversarial attack
    "Pretend you are an executive skeptic reviewing the draft above. Attack it. Find: (a) statements not grounded in plan evidence; (b) generalizations from too-small samples; (c) account names that may have been invented; (d) recommendations that don't follow from the data. Be ruthless — this report goes to leadership. List each finding with severity (critical/major/minor) and recommendation (remove/soften/cite-evidence). If the draft has so many critical issues that refinement would change its conclusions wholesale, emit <abort reason='draft_unsalvageable'>explanation</abort>.",

    // Step 4 — refine + emit
    "Rewrite the report to clear all 'critical' and 'major' attacks. Apply remove/soften/cite-evidence per attack. Leave 'minor' attacks alone. Then emit the required outputs.",
  ],
  context: `# ICP Definition\n\n${guidelines["icp-definition"]}\n\n---\n\n# Account Qualification\n\n${guidelines["account-qualification"]}`,
  outputs: [
    { name: "executive_summary",    required: true, collectionId: "Project", propertyId: "report_summary" },
    { name: "win_patterns",         required: true },
    { name: "loss_patterns",        required: true },
    { name: "icp_refinement_signals" },
    { name: "common_objections" },
    { name: "attack_log" },  // optional — kept for audit trail
  ],
  tier: "ultra",  // executive-facing, low volume — quality wins
  evaluate: {
    criteria: "Report rigor: every claim cited; no fabricated accounts; recommendations follow from data; no overgeneralization from small samples.",
    serverSide: true,
  },
  memorize: { recordId: report.record_id, type: "Contact" },
  metadata: { recordId: report.record_id },
});
```

**Why this works:**
- Adversarial step explicitly *looks for* fabrications — Pattern 1's audit checks rule violations; Pattern 5's attack checks logical integrity. Different failure modes.
- Graded refinement (`remove` / `soften` / `cite-evidence`) preserves useful content while raising the rigor bar.
- Abort on step 3 protects against shipping a report that's fundamentally broken.
- `tier: "ultra"` is justified by low volume × executive-facing × the adversarial pass needing strong models.
- Server-side `evaluate` with custom rubric — operations using this pattern can require `finalScore >= 0.85` before publishing, falling back to a human-review task otherwise.

---

## Part II — Advanced patterns

| # | Pattern | Use case in this repo | Tier | Key feature |
|---|---|---|---|---|
| A | **Conditional Specialize** | `generate.outreach-sequence` (enterprise vs SMB), `generate.meeting-brief` | `pro` | Step 1 classifies; step 2+ specializes per class |
| B | **Multi-Source Reconciliation** | `research.account-deep-dive`, `analyze.deduplication` | `pro` | Two sources, explicit conflict surfacing |
| C | **Soft Degradation** | `score.icp-fit` (thin data), `analyze.buying-stage` (sparse signals) | `basic` | Confidence signal + partial emit instead of abort |
| D | **Compliance-Gated Generation** | Any outreach op with opt-out / rate-limit / GDPR rules | `pro` | Gate fires FIRST; generation only on pass |
| E | **Multi-Recipient Fanout** | `generate.outreach-sequence` (multi-contact), `act.daily-digest` | `pro` | Shared context once, personalized per recipient |
| F | **Tool-Bounded Research** | `research.account-deep-dive`, `research.contact-background` | `pro` | Pre-search plan + `maxSteps` + `captureToolResults` |
| G | **Few-Shot Calibrated Classification** | `analyze.reply-sentiment`, `analyze.buying-stage` | `basic` | Boundary examples with WHY rationale |
| H | **Checklist-Gated Workflow** | `sync.normalize-lifecycle`, `analyze.deduplication` | `basic` | Explicit checklist before execution; completion verification |
| I | **Self-Reflective Refinement Loop** | `generate.proposal`, `generate.mutual-action-plan` | `ultra` | Constructive self-critique focused on THIS recipient |

---

### Pattern A — Conditional Specialize

**For:** Tasks where the right approach depends on entity attributes discovered in step 1. Instead of a generic prompt that tries to handle all entity types, step 1 classifies and subsequent steps branch on the discovered type.

**In this repo:** `generate.outreach-sequence` (enterprise vs. mid-market vs. SMB — each needs a different sequence structure), `generate.meeting-brief` (discovery vs. renewal vs. exec review calls), `analyze.call-summary` (technical vs. business call uses different extraction schema).

**BAD:**
```ts
// One prompt tries to handle all entity types — mediocre for all
instructions: "Write outreach emails for this contact. If enterprise, be formal. If SMB, be casual. Adjust length accordingly."
// Result: generic blend that satisfies neither track
```

**GOOD:**
```ts
await client.ai.prompt({
  instructions: [
    // Step 1 — classify, grounded in memory
    "Recall this company's firmographics and recent engagement. Classify into ONE of:\n• 'enterprise' — 500+ employees, multi-stakeholder buying, POC/pilot-first cycles\n• 'mid-market' — 50–500 employees, 2-3 stakeholders, faster cycles\n• 'smb' — <50 employees, single decision-maker, budget-first\n\nState the classification and the 2-3 specific signals that determined it.",

    // Step 2 — specialize based on classification
    "Based on the classification above:\n\n• enterprise → 3-email sequence (hook → proof → ask). Exec language. ROI framing. Email 1 to champion, email 3 to economic buyer.\n• mid-market → 3-email sequence (pain → solution → commitment). Conversational. Focus on time-to-value.\n• smb → 2-email sequence (direct value → clear ask). Ultra-short. Price signal in email 2.\n\nWrite the sequence for the correct track. Apply brand-voice rules.",

    // Step 3 — audit against the classified track + emit
    "Verify the sequence matches the correct track template for the step-1 classification. Check brand-voice compliance. Rewrite any non-compliant line. Then emit the required outputs.",
  ],
  context: `# Brand Voice\n\n${guidelines["brand-voice"]}\n\n---\n\n# Outreach Playbook\n\n${guidelines["outreach-playbook"]}`,
  outputs: [
    { name: "sequence",    required: true, collectionId: "Contact", propertyId: "next_email_sequence" },
    { name: "track_used",  required: true },  // 'enterprise' | 'mid-market' | 'smb' — useful for analytics
  ],
  tier: "pro",
  memorize: { email: contact.email, type: "Contact" },
  metadata: { recordId: contact.record_id },
});
```

**Why this works:**
- Step 1 classification is grounded in recalled memory — not guessed from one data point.
- Step 2 uses the classification as a hard branch, not a suggestion — the model executes the right track.
- `track_used` as a required output gives the operation's caller signal for analytics ("did enterprise contacts convert better?").
- Avoids maintaining three separate operation variants with duplicated scaffolding.

---

### Pattern B — Multi-Source Reconciliation

**For:** Research that combines data from multiple independent sources. Sources will disagree. The reconciliation step surfaces conflicts explicitly rather than silently picking one.

**In this repo:** `research.account-deep-dive` (CRM memory vs. external web research), `analyze.deduplication` (field-by-field comparison of two records), `sync.normalize-lifecycle` (CRM stage vs. engagement-derived stage — which is authoritative?).

**BAD:**
```ts
instructions: [
  "Fetch company data from memory and external tools.",
  "Summarize findings.",  // ← silently resolves conflicts by picking whatever sounds right
]
```

**GOOD:**
```ts
await client.ai.prompt({
  instructions: [
    // Step 1 — source A (owned memory)
    "Recall everything in Personize memory about this company: firmographics, contacts, engagement history, signals. Summarize in prose, citing source and date for each fact. Note any fields where memory itself has conflicting values.",

    // Step 2 — source B (external research)
    {
      prompt: "Research this company externally. Find: recent news (90 days), headcount, funding, tech stack signals. Cite source URLs and dates. Stop at 5 tool calls.",
      maxSteps: 5,
    },

    // Step 3 — reconcile conflicts explicitly
    "Compare step-1 memory data vs step-2 external data for each field both sources cover.\n• Agree → mark 'confirmed'\n• Disagree → surface BOTH values, rate confidence in each (memory-date vs external-date), do NOT resolve — let the caller decide\n• Single source only → mark 'memory-only' or 'external-only'\n\nDo NOT pick one value when sources conflict.",

    // Step 4 — emit the reconciled brief
    "Write the company brief using the reconciled findings. Mark confirmed fields, note conflicts inline, mark single-source fields as 'preliminary'. Emit the required outputs.",
  ],
  outputs: [
    { name: "company_brief",   required: true, collectionId: "Company", propertyId: "ai_snapshot" },
    { name: "conflicts_found", required: true },  // caller knows whether manual review is needed
    { name: "research_citations" },
  ],
  tier: "pro",
  mcpTools: [
    { mcpId: "user_perplexity_mcp", enabledTools: ["search_news", "search_web"] },
  ],
  memorize: { websiteUrl: company.domain, type: "Company", captureToolResults: true },
  metadata: { recordId: company.record_id },
});
```

**Why this works:**
- Explicit reconciliation (step 3) surfaces conflicts as findings, not as silently-resolved values.
- Two-source cross-check reduces fabrication rates — the model won't invent something that neither source mentions.
- `conflicts_found` as a required output signals the caller: if non-empty, flag for human review before writing to CRM.
- `captureToolResults: true` saves external research to memory — the next run for the same company starts richer.

---

### Pattern C — Soft Degradation

**For:** Tasks where the data might be insufficient for a full result, but partial output is still useful. Instead of failing the entire request, emit what's grounded and signal what's missing so the caller can route appropriately.

**In this repo:** `score.icp-fit` on a new lead with only 1-2 factors available, `analyze.buying-stage` on sparse engagement data, any op where "some result" is better than "no result".

**BAD:**
```ts
outputs: [
  { name: "icp_score",       required: true },
  { name: "factor_breakdown", required: true },  // ← fails if any factor can't be determined
  { name: "buy_signals",     required: true },
]
// If buy_signals data is missing, the entire request fails — caller gets nothing
```

**GOOD:**
```ts
await client.ai.prompt({
  instructions: [
    "Recall company data and attempt to score the 4 ICP factors: firmographic_fit, buying_signals, engagement, champion_potential. For each factor:\n• If you CAN determine it from available data: score 0-100 with evidence.\n• If you CANNOT determine it: mark it 'undetermined' and state what data would resolve it.\nThis is NOT a failure — partial scores are valid.",

    "Compute the weighted ICP score using ONLY the determined factors. Adjust the formula weights proportionally if factors are missing. If fewer than 2 factors are determined, set confidence='low'. If 3-4 determined, set confidence='medium'. If all 4, set confidence='high'. State which factors were included vs. skipped. Do NOT guess undetermined factors. Emit the required outputs.",
  ],
  outputs: [
    { name: "icp_score",        required: true, collectionId: "Company", propertyId: "icp_fit_score" },
    { name: "confidence_level", required: true, collectionId: "Company", propertyId: "icp_confidence" },
    { name: "factor_breakdown", required: true },
    { name: "data_gaps" },     // optional — what would improve the score; seeds an enrichment agenda
  ],
  tier: "basic",
  memorize: { websiteUrl: company.domain, type: "Company" },
  metadata: { recordId: company.record_id },
});
```

**Caller routing:**
```ts
if (result.output.confidence_level === "low") {
  await queueForEnrichment(company, result.output.data_gaps);
  // Don't act on a low-confidence score — enrich first
} else {
  await routeToSalesStage(company, result.output.icp_score);
}
```

**Why this works:**
- `confidence_level` is required — the caller ALWAYS knows whether to trust the score.
- The operation never fails just because data is sparse — partial scores are stored with their confidence.
- `data_gaps` seeds an enrichment agenda: the next call to `research.account-deep-dive` knows what to find.
- Distinct from abort (T1): abort = fundamentally invalid; soft degrade = valid but partial.

---

### Pattern D — Compliance-Gated Generation

**For:** Any output that must pass a policy or legal check before being created. Gate fires FIRST — generation only happens on pass. Never check compliance after generating.

**In this repo:** GDPR/opt-out check before email generation, sequence rate-limit check before enrollment, data-residency check before cross-border enrichment.

**BAD:**
```ts
instructions: [
  "Write the email sequence.",     // ← generates first
  "Check if this contact is opted out.",  // ← too late; content already created
]
```

**GOOD:**
```ts
await client.ai.prompt({
  instructions: [
    // Step 1 — gate FIRST; generation only if all checks pass
    "Before generating any content, check ALL of the following from memory:\n1. Is this contact's email marked opted-out or GDPR-suppressed?\n2. Was this contact messaged in the last 14 days (check sequence_history)?\n3. Does this contact's domain appear on the global suppression list?\n\nIf ANY check fails, emit <abort reason='compliance_[check_name]'>which check failed and why</abort>. Do NOT proceed to generation under any circumstances.",

    // Step 2 — runs ONLY if step 1 passed (no abort fired)
    "All compliance checks passed. Draft the outreach sequence per the brand-voice guidelines.",

    // Step 3 — final audit + emit
    "Review the draft for brand-voice compliance. Rewrite any violations. Emit the required outputs.",
  ],
  outputs: [
    { name: "email_sequence", required: true, collectionId: "Contact", propertyId: "next_email_sequence" },
  ],
  tier: "pro",
  memorize: { email: contact.email, type: "Contact" },
  metadata: { recordId: contact.record_id },
});
```

**Abort reason routing on the caller side:**
```ts
try {
  const result = await aiPrompt({ ... });
  // content was generated and is compliant
} catch (err) {
  if (err instanceof AiPromptError && err.kind === "aborted_by_model") {
    if (err.abortReason?.startsWith("compliance_opted_out")) {
      await markContactSuppressed(contact.id);
    } else if (err.abortReason?.startsWith("compliance_rate_limit")) {
      await scheduleForLater(contact.id, { delayDays: 14 });
    }
  }
}
```

**Why this works:**
- Gate before generate eliminates "generated content we can't send" entirely.
- Structured abort reason (`compliance_opted_out`, `compliance_rate_limit`) lets the caller handle each violation differently.
- New compliance rules only need to be added to step 1 — the rest of the chain is unaffected.

---

### Pattern E — Multi-Recipient Fanout

**For:** Generating personalized content for multiple recipients where the account-level setup cost is shared. Build the shared context once; personalize per recipient in subsequent steps.

**In this repo:** `generate.outreach-sequence` for multiple contacts at the same account, `act.daily-digest` (shared pipeline summary + per-rep personalized sections), multi-stakeholder meeting briefs.

**BAD:**
```ts
// N separate aiPrompt calls, each rebuilding the full account context
for (const contact of accountContacts) {
  await aiPrompt({
    instructions: `Write an email for ${contact.name}... ${fullAccountContext}`,
    // Full account context repeated N times — expensive and slow
  });
}
```

**GOOD:**
```ts
await client.ai.prompt({
  instructions: [
    // Step 1 — shared account frame (runs once, informs all recipient steps)
    "Recall the account-level context for this company: snapshot, recent signals, shared pain points, buying committee members, and open opportunities. Summarize in structured prose for use in all follow-up steps.",

    // Step 2 — recipient 1 personalization
    "For the VP of Engineering (see account context: technical buyer, cares about integration time and security): Write a personalized first email focused on technical pain points. Tone: peer-to-peer. Max 100 words. Emit: <output name='email_vp_eng'>...</output>",

    // Step 3 — recipient 2 personalization
    "For the CFO (see account context: economic buyer, risk-averse, 3 prior vendor switches): Write a personalized first email focused on ROI and risk mitigation. Tone: executive. Max 80 words. Emit: <output name='email_cfo'>...</output>",

    // Step 4 — final check + emit all
    "Review both emails above for brand-voice compliance and appropriate tone differentiation. If any email doesn't meet the standard, rewrite it now. Then emit all required outputs together.",
  ],
  outputs: [
    { name: "email_vp_eng", required: true },
    { name: "email_cfo",    required: true },
  ],
  tier: "pro",
  metadata: { recordId: account.record_id },
});
```

**Why this works:**
- Account context retrieval (step 1) runs once instead of N times — significant credit savings for accounts with 3+ contacts.
- Each personalization step is shorter because it references the shared context from step 1 rather than re-establishing it.
- The final step catches tone drift across recipients — individual reviews in isolation miss cross-recipient inconsistencies.

---

### Pattern F — Tool-Bounded Research

**For:** Research operations that use MCP tools. Goes beyond Pattern 4 by adding a pre-search planning step (prevents "search and hope" loops) and explicit tool-call tracking. Tool loops must be bounded with `maxSteps`; tool costs must be controlled with `mcpTools` allowlists.

**In this repo:** `research.account-deep-dive`, `research.contact-background`.

**BAD:**
```ts
instructions: [
  { prompt: "Research this company thoroughly.", maxSteps: 20 },  // unlimited budget, unplanned
  "Summarize.",
]
```

**GOOD:**
```ts
await client.ai.prompt({
  instructions: [
    // Step 1 — plan the search before executing (no tool calls yet)
    "Before making any tool calls, write a 3-query search plan: (1) what specific query to run first and why, (2) what query to run second if the first is insufficient, (3) what would make you stop early. This is a planning step only — do not execute any tools yet. Output the plan in prose.",

    // Step 2 — execute the plan with explicit tracking
    {
      prompt: "Execute the search plan from step 1. After each tool call: note what you found (or that it returned empty/error). Stop when the plan is complete OR you have sufficient evidence for all key claims. Do NOT run extra queries 'just to be thorough'. Budget: max 6 tool calls.",
      maxSteps: 6,
    },

    // Step 3 — cite-check + emit
    "Verify each claim in your step-2 findings references a specific tool result. Soften or remove claims that aren't cited. Then emit the required outputs.",
  ],
  context: `# Account Research Guidelines\n\n${guidelines["account-research"]}`,
  outputs: [
    { name: "company_brief",    required: true, collectionId: "Company", propertyId: "ai_snapshot" },
    { name: "buying_signals",                   collectionId: "Company", propertyId: "ai_signals" },
    { name: "research_gaps" },  // optional — what the search couldn't find
  ],
  tier: "pro",
  mcpTools: [
    { mcpId: "user_perplexity_mcp", enabledTools: ["search_news", "search_web"] },
    { mcpId: "user_clearbit_mcp",   enabledTools: ["company_lookup"] },
  ],
  memorize: { websiteUrl: company.domain, type: "Company", captureToolResults: true },
  metadata: { recordId: company.record_id },
});
```

**Why this works:**
- Pre-search planning (step 1) prevents aimless tool loops — the model knows what "done" looks like before it starts.
- `maxSteps: 6` caps cost; `mcpTools` allowlist prevents expensive off-plan calls.
- `captureToolResults: true` writes tool results to company memory — the next research run starts with this data already available.
- `research_gaps` surfaces what couldn't be found, seeding follow-up enrichment or manual research.

---

### Pattern G — Few-Shot Calibrated Classification

**For:** Classification where label boundaries are fuzzy and the cost of mis-classification is high. Few-shot examples with explicit WHY rationale calibrate the model on the hard boundary cases that matter most for your specific labels.

**In this repo:** `analyze.reply-sentiment` (email reply classification), `analyze.buying-stage` (stage from engagement signals).

**BAD:**
```ts
instructions: "Classify this email reply as: Positive interest / Question / Referral / Objection / Soft no / Hard no / OOO / Unsubscribe / Bounce."
// No calibration → model applies its own priors which may not match your definitions
// Especially bad for 'Soft no' vs 'Hard no', 'Question' vs 'Positive interest'
```

**GOOD:**
```ts
await client.ai.prompt({
  instructions: [
    // Step 1 — extract evidence before classifying (prevents "vibe" classification)
    "Read this email and extract verbatim quotes (max 3) that signal intent, sentiment, or objection. Label each quote briefly.",

    // Step 2 — classify with boundary calibration examples
    `Classify the reply using the evidence above.

**Label space:** Positive interest | Question | Referral | Objection | Soft no | Hard no | OOO | Unsubscribe | Bounce

**Boundary calibration (use to calibrate judgment, not as rigid rules):**
- "Let's talk next week" → Positive interest ← has a future commitment, not just vague interest
- "What's the pricing like?" → Question ← single topic, not broad engagement
- "I'm not the right person, try our CTO" → Referral ← explicit role redirect
- "We already have a vendor" → Objection ← rebuttable; timing may be different later
- "Now isn't a great time" → Soft no ← timing objection, not a permanent rejection
- "Please stop contacting me" → Hard no ← explicit rejection; must trigger opt-out immediately
- "I'm out until May 12" → OOO ← auto-reply or explicit return date
- "Remove me from your list" → Unsubscribe ← must trigger immediate opt-out
- "550: User not found" → Bounce ← delivery error, not a sentiment signal

State: classification, confidence (low/medium/high), recommended_action, and the quote that most influenced your classification.
If the body is empty or unparseable → <abort reason='unreadable_reply'>explanation</abort>.`,
  ],
  outputs: [
    { name: "classification",     required: true, collectionId: "Conversation", propertyId: "reply_sentiment" },
    { name: "recommended_action", required: true },
    { name: "confidence",         required: true },
    { name: "key_quote" },        // optional — useful for audit trail and training data
  ],
  tier: "basic",
  evaluate: true,
  memorize: { email: reply.contact_email, type: "Contact" },
  metadata: { recordId: reply.conversation_id },
});
```

**Why this works:**
- Evidence extraction (step 1) forces the model to read the email before classifying — prevents vibe-based decisions.
- Calibration examples show the distinguishing characteristic for each boundary case, not just the label.
- The examples cover the pairs that are most commonly confused in email replies (Soft no vs Hard no, Question vs Positive interest).
- `confidence` is required — low confidence routes to a human queue without failing the operation.

---

### Pattern H — Checklist-Gated Workflow

**For:** Execution tasks where completeness matters — every item in a list must be attempted, not just the obvious ones. Step 1 generates an explicit checklist from the task before any execution begins. Final step verifies all items were completed.

**In this repo:** `sync.normalize-lifecycle` (each field has specific normalization rules), `analyze.deduplication` (systematic field-by-field comparison), `generate.mutual-action-plan` (MAP has required sections per methodology).

**BAD:**
```ts
instructions: "Normalize the lifecycle stage and all related CRM fields for this contact."
// Model touches the obvious fields, misses the obscure ones — incompleteness is invisible
```

**GOOD:**
```ts
await client.ai.prompt({
  instructions: [
    // Step 1 — expand to explicit checklist FIRST (planning, no execution)
    "Based on the contact data and normalization rules in context, create a numbered checklist of every field that must be normalized. For each checklist item: field name, current raw value, target normalization rule. This is a planning step only — do not normalize any field yet. Output the complete checklist.",

    // Step 2 — execute each checklist item systematically
    "Execute the normalization checklist from step 1 item by item. For each item: state the field name, input value, rule applied, and output value. Check off each item as you complete it. If a normalization rule is ambiguous for this specific value, note it explicitly for the caller rather than guessing.",

    // Step 3 — completion verification + emit
    "Count the items in the step-1 checklist. Count the items you completed in step 2. If counts differ, explain each skipped item and why. Then emit the required outputs.",
  ],
  context: `# Normalization Rules\n\n${guidelines["lifecycle-normalization"]}`,
  outputs: [
    { name: "normalized_fields",  required: true, collectionId: "Contact", propertyId: "normalized_lifecycle" },
    { name: "completion_report",  required: true },   // checklist summary — how many items, how many completed
    { name: "ambiguous_rules" },                      // optional — flags for the ops team to improve the guideline
  ],
  tier: "basic",
  memorize: { email: contact.email, type: "Contact" },
  metadata: { recordId: contact.record_id },
});
```

**Why this works:**
- Checklist expansion (step 1) prevents "selective execution" — the model can't silently skip obscure fields.
- The completion check (step 3) gives the caller explicit confirmation of what was done vs. skipped.
- `ambiguous_rules` surfaces edge cases: over time, these become improvements to the normalization guideline.
- Pattern applies to any "process every item in a rule-set" task — not just lifecycle normalization.

---

### Pattern I — Self-Reflective Refinement Loop

**For:** High-stakes generation where quality matters more than latency and the failure mode is mediocrity (generic, undifferentiated output) rather than policy violation. Step 1 drafts. Step 2 self-reflects with specific questions about THIS recipient's known context. Step 3 applies the improvements.

**Distinct from Pattern 5's adversarial attack:** Pattern I is constructive ("what would make this better for this specific person?") vs adversarial ("what's wrong with this?"). Use Pattern I for relational/creative outputs (proposals, MAPs, meeting briefs). Use Pattern 5 for analytical/factual outputs (reports, research).

**In this repo:** `generate.proposal`, `generate.mutual-action-plan`, `generate.meeting-brief` (high-stakes, relationship-critical documents).

**BAD:**
```ts
instructions: "Write a proposal for this account including: executive summary, solution overview, pricing, next steps."
// Produces structurally correct but generically voiced proposals that could apply to any account
```

**GOOD:**
```ts
await client.ai.prompt({
  instructions: [
    // Step 1 — draft
    "Recall this account's context and write the proposal. Required sections: executive summary, how we address their top 3 pain points, implementation timeline, pricing, next steps. Apply brand-voice rules.",

    // Step 2 — self-reflection specific to THIS recipient
    "You've written a proposal. Now reflect on it specifically for the economic buyer recalled from memory (note their role, concerns, and history):\n1. Which one section would immediately lose this specific buyer? (Answer specifically — not 'the pricing section might be too long', but 'the pricing section assumes a 12-month commitment; this buyer's memory shows they rejected a previous vendor over annual lock-in'.)\n2. What one thing is missing that this buyer SPECIFICALLY cares about based on their known concerns?\n3. What is the single weakest sentence in the executive summary?\n\nAnswer all three specifically. Do NOT rewrite yet.",

    // Step 3 — apply reflections selectively
    "Apply the three improvements from step 2. Rewrite only the affected sentences/sections. Keep all other content unchanged. Then emit the required outputs.",
  ],
  outputs: [
    { name: "proposal",         required: true, collectionId: "Project", propertyId: "ai_proposal" },
    { name: "reflection_log" }, // optional — valuable training data; shows model's self-critique quality
  ],
  tier: "ultra",  // low volume, high stakes
  evaluate: {
    criteria: "Proposal quality: recipient-specific language (not generic), evidence-based claims, clear next step, no boilerplate that could apply to any account.",
    serverSide: true,
  },
  memorize: { recordId: project.record_id, type: "Contact" },
  metadata: { recordId: project.record_id },
});
```

**Why this works:**
- Self-reflection forces the model to connect the proposal to the SPECIFIC buyer's known profile — not a generic CFO or VP archetype.
- Separating reflection (step 2) from application (step 3) prevents superficial self-critique — the model must articulate concrete improvements before rewriting.
- The reflection questions are pointed: "which section would LOSE them" and "what are THEY missing" require specificity, not generalities.
- `reflection_log` as an optional output creates a training dataset showing what the model believed would improve the document — useful for evaluating reflection quality over time.

---

## Error-handling tiers T1–T4

Every operation should explicitly decide which tiers it uses. Tiers are not mutually exclusive — most production operations use T1 + T2, some use T3 internally, and any batch op with MCP tools should add T4.

| Tier | Name | Mechanism | When to use |
|---|---|---|---|
| **T1** | Hard abort | `<abort reason="...">` in a verification step | Output would be fundamentally invalid; downstream steps would amplify garbage; partial result has no value |
| **T2** | Soft degrade | Emit partial output + `confidence` marker as required output | Partial result is better than nothing; caller can route low-confidence to human review queue |
| **T3** | Self-correct | Rewrite loop within the chain (review step → rewrite step) | Fixable error the model can identify and correct in the same chain |
| **T4** | Blast-radius bound | `maxSteps: N` on tool steps + `mcpTools` allowlist | Tool cost could run away in batch context; expensive MCPs must be budgeted per record |

### T1 — Hard abort

When the output would be invalid and there's no safe partial result. The abort fires in a verification/gate step and halts the entire chain.

```
Abort fires → success: false, aborted: true, abortReason: "..."
→ auto-memorize is SKIPPED (no partial data written to records)
→ auto-evaluate is SKIPPED
→ HTTP 422 (sync) / event marked 'failed' (async)
```

Use for: unverifiable identity (Pattern 4), compliance violations (Pattern D), draft quality below a recoverable threshold (Pattern 5).

### T2 — Soft degrade

When partial output is genuinely useful and the caller can make a decision based on it — even if incomplete. The operation succeeds but signals the caller about what's missing.

```
Soft degrade → success: true
→ required outputs include a confidence marker
→ caller branches on confidence_level: 'low' → human review / enrichment agenda
→ auto-memorize runs, including the confidence level
```

Use for: thin-data scoring (Pattern C), classification with insufficient evidence, any score where some factors are undetermined.

### T3 — Self-correct

A repair step within the chain. Step N produces a draft. Step N+1 checks a specific invariant (math, voice, citation). If the invariant fails, step N+1 fixes it inline. The caller never sees the intermediate draft.

```
Self-correct → transparent to caller
→ the correction is internal to the chain
→ final output meets the invariant; no special response shape
```

Use for: math consistency (Pattern 2, step 3), brand-voice violations in a rewrite step (Pattern 1, step 4), unsupported claims (Pattern 4, step 3 cite-check).

### T4 — Blast-radius bound

Tool cost containment for batch operations. Set explicit budgets on tool-heavy steps and use `mcpTools` allowlists to prevent accidental expensive tool calls.

```ts
// Budget the tool step
{ prompt: "Research this company...", maxSteps: 6 }

// Allowlist only the tools this step needs
mcpTools: [
  { mcpId: "user_perplexity_mcp", enabledTools: ["search_news"] },
  // all other MCPs are implicitly disabled
]
```

Use for: any research operation with MCP tools in a batch context, any operation where a user-provided MCP could call expensive external APIs.

---

## Inline error-handling cookbook

These 12 phrases drop into instruction prompts without modification. Copy the one that matches the error mode.

### T1 phrases — hard abort

1. **Completeness gate:** `"If you cannot find [X] for this entity, emit <abort reason='missing_[x]'>explanation</abort> instead of guessing."`

2. **Identity gate:** `"If the data above does not confirm [contact/company/domain] identity with at least 2 independent signals, emit <abort reason='unverified_identity'>which signals are missing</abort>."`

3. **Compliance gate:** `"If [compliance rule] is violated, emit <abort reason='compliance_[rule_name]'>what was violated and why</abort>. Do NOT generate any content."`

4. **Quality floor gate:** `"If the draft above has more than [N] critical issues, emit <abort reason='draft_unsalvageable'>explanation</abort> instead of attempting a repair."`

### T2 phrases — soft degrade

5. **Confidence signal:** `"If you lack sufficient evidence for [factor], set that factor's confidence to 'low' and note what data would resolve it. Do NOT guess."`

6. **Partial emit:** `"Emit the outputs you can ground in the data above. For any output you cannot support, omit it entirely. Do not fabricate to fill gaps."`

### T3 phrases — self-correct

7. **Self-correct loop:** `"Review the step-[N] output above. If [condition], rewrite it now inline. If it already meets the criteria, pass it through unchanged."`

8. **Math invariant:** `"Recompute [formula] from the factor breakdown above. If your result differs from step-[N]'s value by more than [threshold], use the recomputed value and note the correction."`

9. **Voice invariant:** `"Re-read each sentence of the draft. Rewrite any sentence that uses a banned word or violates the tone rule. Leave compliant sentences untouched."`

### T4 phrases — blast-radius

10. **Tool budget:** `"Use at most [N] tool calls for this step. Stop when you have enough evidence to proceed — do not search exhaustively."`

11. **Retry once:** `"If a tool returns an error or empty result, retry once with a reformulated query. If still empty, proceed without that source and note the gap explicitly."`

### Universal

12. **Cite-check:** `"Before emitting any output, verify each claim references a specific finding from step 1 or step 2. Soften to 'preliminary' or remove any claim that isn't cited."`

---

## Response shapes (verified against `PromptResponse`)

### Happy path

```json
{
  "success": true,
  "text": "...natural prose...",
  "outputs": {
    "email_draft": "...",
    "top_signal": "..."
  },
  "metadata": {
    "stepsExecuted": 3,
    "instructionsExecuted": 3,
    "skippedOutputs": [],
    "creditsCharged": 4,
    "usage": { "promptTokens": 1240, "completionTokens": 312, "totalTokens": 1552 }
  },
  "steps": [/* per-step breakdown */]
}
```

### Optional output skipped (still success)

```json
{
  "success": true,
  "outputs": { "email_draft": "...", "top_signal": "..." },
  "metadata": { "skippedOutputs": ["secondary_signals", "uncertainty_notes"] }
}
```

The model honestly skipped the optional fields rather than fabricating. The operation still succeeds because no `required: true` field is missing.

### Required output missing (failure)

```json
{
  "success": false,
  "error": "missing_required_outputs",
  "metadata": {
    "missingRequiredOutputs": ["email_draft"],
    "skippedOutputs": [...]
  }
}
```

HTTP `422` for sync mode. Async mode marks the event `failed` and skips auto-memorize.

### Aborted by model (failure)

```json
{
  "success": false,
  "aborted": true,
  "abortReason": "insufficient_signal",
  "error": "aborted_by_model"
}
```

HTTP `422` for sync. Async event `failed`. Auto-memorize and auto-evaluate are both skipped — partial outputs from earlier steps are NOT written to records.

### Soft-degraded (success with confidence signal)

```json
{
  "success": true,
  "outputs": {
    "icp_score": 62,
    "confidence_level": "low",
    "factor_breakdown": { "firmographic_fit": 71, "buying_signals": "undetermined", ... }
  }
}
```

Caller MUST check `confidence_level` before acting. Low confidence = route to human review or enrichment queue, not to the sales stage.

---

## Common pitfalls

| Pitfall | Why it bites |
|---|---|
| **Implicit middle-step outputs** — relying on the framework reminder for mid-chain markers | Marker reminder is auto-appended to the LAST step only. Write `"Emit <output name='draft'>...</output>"` explicitly into every middle step that should emit. |
| **Splitting cohesive outputs across steps** (header in step 1, subhead in step 2) | Forces the model to re-establish tone/angle each step. Cross-piece consistency drops sharply. Bundle cohesive outputs in one step. |
| **Bundling distinct mental acts** (write + audit together for a long artifact) | The model masks failures by silently rewriting instead of reporting them. Audit and rewrite for long artifacts MUST be separated. |
| **Restating the original task in every step** | Inflates tokens, breaks the cache prefix, confuses the model. Each step should reference "the output above", not re-specify the full task. |
| **Tool calls in the last step** | The last step is for synthesis. If more data is needed, add a middle step with `maxSteps`. |
| **Marking everything `required: true`** | One un-producible required field fails the entire request. Prefer partial success that the caller can route. |
| **No abort path on identity-sensitive tasks** | The model fills gaps with plausible-but-wrong emails/names/roles, and `auto-memorize` writes them to the record. |
| **6+ steps** | Each step is a round-trip with latency. 6+ usually means you've packed too many micro-steps, or the task needs a workflow engine, not a prompt chain. |
| **`maxSteps` on a non-tool step** | `maxSteps` is a tool-loop budget. Setting it on a pure-reasoning step does nothing and confuses readers. |
| **Adversarial attack before evidence is established** | Pattern 5's attack only works because steps 1+2 grounded the artifact. Skipping the plan makes the attack vague and unhelpful. |
| **Mixing creative and deterministic steps without `tier` consideration** | A 4-step chain with `tier: 'basic'` may fail Pattern 5; `tier: 'ultra'` on Pattern 3 is wasted spend. Match tier to the hardest step. |
| **Forgetting `metadata.recordId`** | The run journal can't link the prompt to the record being processed — bad for batch debugging and per-record telemetry. |
| **Putting per-record data in `context`** | `context` is re-sent every step and is for guidelines, not data. Per-record fields belong inline in the first step's prompt. |
| **`context` over 2K tokens** | Prefix-caching savings disappear when `context` is too long. Keep policy context tight; elaborate reasoning goes in step 1's prompt, not context. |
| **Compliance check after generation (Pattern D anti-pattern)** | Generates content you can't send. Gate must fire before any generation step. |
| **No `mcpTools` allowlist in batch context** | A user-provided MCP with expensive API costs can burn budget on every record in a 500-record batch. Always allowlist in batch ops. |
| **Research without a search plan (Pattern F anti-pattern)** | Aimless tool loops with `maxSteps: 20` waste credits. Add a pre-search planning step that declares what "done" looks like. |
| **Missing `captureToolResults: true` on research ops** | Expensive MCP results are computed and discarded. With `captureToolResults: true`, they're saved to memory and available to future operations on the same record. |
| **Using soft degrade (T2) when the data is so thin that any score would mislead** | T2 is for "partial but valid" results. If 0 of 4 ICP factors can be determined, emitting `confidence: 'low'` with a score of 0 is still misleading — that's when T1 abort is correct. |
| **Few-shot examples without WHY rationale (Pattern G anti-pattern)** | "X → Soft no" tells the model the label. "X → Soft no ← timing objection, not permanent" teaches the model the BOUNDARY. Examples without rationale don't help with novel boundary cases. |
| **Checklist generation AND execution in the same step (Pattern H anti-pattern)** | The model generates a short checklist and immediately executes it, often missing items it didn't bother to plan. Checklist generation must be its own step with explicit "planning only — do not execute" instruction. |
| **Self-reflection that's non-specific (Pattern I anti-pattern)** | "What could be improved?" → "The writing could be clearer." Specific reflection: "Which section would lose THIS buyer based on their known concerns?" forces grounded answers. |
| **Confusing abort vs. missing-required-outputs error kinds** | Abort (`aborted: true`) = model chose to halt. Missing required outputs = model completed but forgot to emit. Both return HTTP 422 but require different handling — check `err.kind` in the caller. |
| **`tier: 'ultra'` on high-volume batch ops** | `ultra` uses large frontier models at high credit cost. Save it for executive-facing, low-volume ops (Pattern 5, Pattern I). Use `basic` for Pattern 2, Pattern G. |

---

## Quick decision flowchart

```
Need outputs structured?
├── No → single prompt, no `outputs` field
└── Yes
    Does the task need sequential reasoning OR tool boundaries?
    ├── No → single prompt with `outputs`
    └── Yes
        How many distinct phases?
        ├── 2 → instructions: [discovery, synthesis]
        ├── 3 → instructions: [discovery, reasoning+abort-checks, synthesis]
        └── 4+ → re-examine; consider folding two phases together

        Which pattern fits?
        ├── Must follow strict format rules → Pattern 1 (plan→draft→audit→rewrite)
        ├── Numerical scoring → Pattern 2 (analyze→score→consistency-check)
        ├── Inbound classification → Pattern 3 or G (extract evidence first)
        ├── MCP research → Pattern 4 or F (bound the tool loop)
        ├── Executive-facing output → Pattern 5 (adversarial) or I (reflective)
        ├── Entity type determines approach → Pattern A (conditional specialize)
        ├── Multiple data sources → Pattern B (reconcile conflicts)
        ├── Possibly sparse data → Pattern C (soft degrade, don't abort)
        ├── Must check compliance first → Pattern D (gate before generate)
        ├── Multiple recipients → Pattern E (fanout: shared context once)
        └── Completeness matters → Pattern H (checklist-gated)

        For each output:
        ├── Caller can't succeed without it → required: true
        ├── Has a clean property home     → add collectionId + propertyId
        └── Otherwise                    → leave required omitted (default)

        Error tiers to use:
        ├── Identity/research/compliance sensitive → T1 (abort gate)
        ├── Possible thin/sparse data → T2 (soft degrade + confidence)
        ├── Fixable invariant → T3 (self-correct step)
        └── MCP tools in batch → T4 (maxSteps + mcpTools allowlist)
```

---

## When NOT to use multi-step

| Don't use multi-step | Use single `prompt` instead |
|---|---|
| Single classification (one label out) | `tier: 'basic'`, single prompt |
| Single field extraction | Single prompt with `outputs[]` markers |
| Sub-200ms latency required | Single prompt; multi-step adds round-trip overhead |
| The "steps" are really sub-fields of one schema | Single prompt with one rich schema |

A 4-step chain on a one-line classification is wasteful. Stay single-prompt unless the task has genuinely distinct mental acts.

---

## Migration checklist (single-prompt → multi-step)

When upgrading an existing operation:

- [ ] Identify the implicit acts in the current prompt (planning, drafting, checking).
- [ ] Split distinct mental acts into separate steps. **But:** bundle cohesive outputs (subject + body, header + subhead + CTA) within a single step.
- [ ] For SHORT artifacts (email, hero block), fuse audit + rewrite into one final step. For LONG artifacts (reports, proposals), keep them separate.
- [ ] Choose the right pattern from the catalog above. Map the operation's failure mode to the pattern that addresses it.
- [ ] Add error-handling tiers: T1 abort gate for identity/compliance, T2 soft degrade for thin data, T3 self-correct for fixable invariants, T4 bounds for tool-heavy steps.
- [ ] Place `<output name="...">` markers based on cohesion — last step for synthesis (auto-reminder), middle steps for mid-chain artifacts (write the emit instruction explicitly).
- [ ] Add `outputs: [{ name }, ...]` array to `PromptOptions`.
- [ ] Mark only the truly-gating outputs as `required: true`.
- [ ] Add `collectionId` + `propertyId` to outputs that have a clean property home — bypasses LLM re-extraction.
- [ ] Add an abort condition to the verification step for identity-sensitive ops.
- [ ] Choose `tier` based on volume × stakes (`basic` for Pattern 2/3/G/H, `pro` for Pattern 1/4/A/B/D/E/F, `ultra` for Pattern 5/I).
- [ ] Add `evaluate` if the output ships to a customer or executive.
- [ ] Add `memorize` to skip explicit `memory_save` calls after generation.
- [ ] Set `captureToolResults: true` on `memorize` for research ops with MCP tools.
- [ ] Add `metadata.recordId`.
- [ ] Add `mcpTools` allowlist for any op that uses MCP tools (especially in batch).
- [ ] Run on 10 records; compare quality + token cost to the single-prompt baseline.
- [ ] If quality didn't improve, diagnose: (a) steps not referencing each other, (b) `<output>` markers missing from last step, (c) wrong tier for the task class.

---

## See also

- [AI-INSTRUCTIONS.md](AI-INSTRUCTIONS.md) — full `PromptOptions` reference, response shapes, all SDK fields
- [ORCHESTRATION.md](ORCHESTRATION.md) — three-layer composition model, five composition patterns mapped to our 26 operations
- [`node_modules/@personize/sdk/dist/types.d.ts:827`](../node_modules/@personize/sdk/dist/types.d.ts) — authoritative `PromptOptions` interface
- [`src/core/lib/ai.ts`](../src/core/lib/ai.ts) — local wrapper (fully expanded — supports all SDK fields)
- [`src/core/operations/impl/`](../src/core/operations/impl/) — 26 current operations (candidates for multi-step migration)
