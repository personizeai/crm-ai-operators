---
name: activity-logging
tags: [logging, audit, workspace, updates, observability]
---

# Activity Logging

> Every operation that touches a record must append to that record's `workspace.updates` array. This is what makes cross-agent visibility work.

## Mandatory: workspace.updates entry

After any meaningful action on a contact, company, or conversation, append:

```json
{
  "author": "<operation_name>",
  "type": "<update_type>",
  "summary": "<one-sentence description>",
  "details": { /* operation-specific structured payload */ },
  "timestamp": "<ISO-8601>"
}
```

### `author` field

- Always the registered operation name (e.g. `score.icp-fit`, `analyze.reply-sentiment`).
- For human actions (rep replies, manual updates), use `human:<email>`.
- For external system events that flow in via webhook, use `webhook:<provider>`.

### `type` field — one of

| Type | When to use |
|------|------------|
| `enrichment` | New facts discovered (research, sync, scraping) |
| `signal` | A signal was detected and recorded |
| `outreach` | An email/call/message was generated or sent |
| `engagement` | A reply, open, click, meeting was logged |
| `score` | A score was computed or updated |
| `qualification` | Account or contact qualification status changed |
| `system` | Operation-internal change (status flip, retry, error recovery) |
| `handoff` | Ownership changed (agent → human, or between roles) |

### `summary` field

- One sentence. Past tense.
- Include the key fact, not the operation mechanics.
- Good: *"Scored 87 — strong ICP fit + recent funding signal."*
- Bad: *"Ran score.icp-fit operation against record."*

### `details` field

- Structured. Match the operation's contribution.
- For `score`: include the previous and new value, the dimensions, the confidence.
- For `engagement`: include the conversation_id, channel, sentiment.
- For `outreach`: include the subject, channel, step number.

## What NOT to log

- **Read-only operations.** If you only fetched data, don't append. The reads themselves are tracked in the audit JSONL log; the workspace timeline is for state changes.
- **Failures.** Failures go to the audit log, not the workspace. Retries that succeed → log only the success.
- **Verbose multi-line content.** Don't paste full email bodies into `details`. Reference the conversation_id in the `conversations` collection.
- **PII beyond what's necessary.** Don't put credit-card-shaped numbers, government IDs, or anything you wouldn't want in a screenshot.

## Frequency

- One update per record per operation run is the norm.
- A run that touches 100 contacts produces 100 update entries (one per contact), not one batch entry.
- A single contact never gets two updates from the same operation in the same run.

## Reading the workspace

- `workspace.updates` is append-only and ordered by timestamp. Most recent first when displaying.
- Operations that read updates should filter by `author`, `type`, or recency, not parse the full timeline.
- The `optimize.review-runs` operation aggregates across updates to find patterns.

## Where work-tracking belongs

| Concept | Where to write | Why |
|---------|---------------|-----|
| **Pending tasks** | `tasks` collection (queryable entity), linked via `custom_key_name` + `custom_key_value` | One filter call finds all open tasks across the org. An array on contacts requires fetching every contact. |
| **Decisions** | `<entity>.decisions` array property | Co-located with the entity it's about; rarely queried across entities. |
| **Updates / events** | `<entity>.updates` array property | Per-entity timeline is the right shape for cross-agent visibility. |
| **Notes / knowledge** | `<entity>.notes` array property | Same — per-entity. |
| **Conversations (emails/calls/meetings)** | `conversations` collection | Queryable across entities (e.g. "all positive replies this week"). |
| **Signals (events from any source)** | `signals` collection | Same — queryable, time-ordered, cross-entity. |

The rule of thumb: **if a property would benefit from `memory_filter_by_property` queries across entities, make it its own collection. If it's read 90%+ of the time alongside its parent entity, make it an array property.**
