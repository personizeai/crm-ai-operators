# Dispatch Routes as Content

Dispatch routes — the rules that decide which record gets which treatment, on
which cadence — are manifest files, the same way guidelines are:

```
manifests/core/dispatch-routes/*.json   # one route per file
manifests/local/dispatch-routes/*.json  # git-ignored org overlay, same filename wins
```

Edit a route file, run `npm run setup -- --crm hubspot` (or let the
`publish-content` GitHub Action do it on push — see below), and the change is
live. The dispatcher (`src/core/engine/dispatcher.ts`) reads routes fresh from
Personize on every cycle — publishing a route never requires redeploying the
engine.

`applyDispatchRoutes` (`src/core/setup/apply-dispatch-routes.ts`) upserts each
file into the `dispatch-routes` collection, keyed by `route_id`, idempotently —
re-applying an unchanged route is a no-op.

## Authoring a route

```json
{
  "route_id": "route_my_example",
  "priority": 10,
  "name": "my-example",
  "description": "What this does and when it fires.",
  "enabled": true,
  "filter": { "collection": "contact", "where": { "signal_strength": { "gte": 80 } }, "limit": 50 },
  "target_type": "task",
  "target_name": "hot-signal-handoff",
  "max_per_cycle": 20
}
```

`filter` is authored as a plain object (the raw shape `compileFilter` expects)
for readability — it's serialized to `filter_json` on write, and the
dispatcher parses it back the same way.

## Choosing a target_type

Every target honors the dispatcher's input contract now — pick by intent:

- **`operation`** — calls `runOperation(name, …)`. Per-entity ops (`score.*`,
  `research.*`, `analyze.*`, and the per-contact `generate.*`/`act.*`) resolve
  their record set through `resolveOperationRecords` ([lib/dispatch-input.ts](../src/core/lib/dispatch-input.ts)),
  which honors **batch** (`input.records`), **per-record** (`input.email`), and
  **standalone** (`input.filter ?? DEFAULT_FILTER`) — so the route's filter
  actually reaches the operation instead of being silently replaced by the op's
  default. Use `parallel: true` for scoring/research/enrichment (independent,
  one failure isolated — the doc-recommended shape), or `dispatch_mode: "batch"`
  for a single atomic call over the whole set (most efficient; one failure fails
  all — best for bulk-submit ops like `sync.call-transcripts-bulk`).
- **`target_chain`** — a per-record pipeline (`{email, sessionId}` per stage).
  Keep every stage the **same entity type**: chaining a company op
  (`score.icp-fit`) after a contact-scoped step passes a contact email to a
  record keyed by `recordId`, which won't resolve. A contact chain like
  `["research.contact-background", "score.lead-quality"]` is correct.
- **`subagent`** — runs an autonomous agent per record against the guideline
  named by `instructions_name` (`routeToSubagent`). Still **contacts only
  today** — it hardcodes `memorize: { email, type: "Contact" }`, so a
  company-scoped subagent route would mislabel the record's entity type on
  write. Use contact-scoped filters until that's parameterized.
- **`task`** — creates a Task record (`routeToTask`). No input-shape
  assumptions; safe for any collection.

Two entity-keying notes that matter for `operation`/`target_chain` routes:

- **Company ops** (`score.icp-fit`, `research.account-deep-dive`) take the
  per-record identity as a **record_id** (the dispatcher's `extractEmail`
  returns a company's record_id, not an email) — their `resolveOperationRecords`
  call uses `singleKey: "recordId"`. Contact/conversation ops use `"email"`.
- **`analyze.reply-sentiment` / `analyze.call-summary`** support **batch and
  standalone only** — they process a contact's *conversations*, not a single
  keyed record, and the dispatcher claims per-record by email, so route them
  with `dispatch_mode: "batch"` (or run them standalone on a schedule), not as
  per-record `operation` routes.

The three seed routes in `manifests/core/dispatch-routes/` demonstrate the
range: `score.lead-quality` per-record parallel, `generate.meeting-brief`
per-record, and a `task` handoff.

## Pulling drift back

There's no reverse sync for routes yet (unlike `crm-agent setup sync
guidelines`, which pulls Personize guidelines back into the repo) — if a route
is edited directly in Personize, that change is invisible to the repo until
someone manually reconciles it. Worth adding a `setup sync dispatch-routes` if
routes start getting edited outside the manifest flow.
