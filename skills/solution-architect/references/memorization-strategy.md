# Memorization Strategy

How to design the right memory architecture for each customer's use case, scale, and data privacy requirements.

---

## What Gets Memorized by Default

The eight default collection types that `crm.sync-core` populates:

| Collection | Entity type | Default properties synced | Primary use |
|-----------|------------|--------------------------|------------|
| `contacts` | contact | 22 properties (name, email, company, lifecycle_stage, lead_score, persona, timezone, opt_out, workspace.updates, ...) | Scoring, outreach, qualification |
| `companies` | company | 18 properties (name, domain, industry, employee_count, revenue, icp_fit_score, buying_stage, workspace.updates, ...) | ICP scoring, research, account intel |
| `conversations` | conversation | subject, channel, direction, sentiment, intent, body_preview, timestamp | Reply analysis, buying stage, call intel |
| `signals` | signal | signal_type, strength, source, entity_ref, detected_at | Lead scoring, buying stage inference |
| `operation_runs` | operation_run | operation, status, duration_ms, records_processed, dry_run, run_id | Audit, skip_if logic |
| `tasks` | task | task_type, status, priority, assigned_to, due_date, linked_entity | Work queue, rep notifications |
| `projects` | project | project_type, status, members, linked_account | Multi-step deals, account management |
| `alerts` | alert | alert_type, severity, message, entity_ref, resolved | Monitoring, rep notifications |

---

## Property Selection by Use Case

Don't memorize everything — memorize what operations actually read. Syncing unused properties wastes Personize storage and slows sync operations.

### Scoring focus (score.icp-fit, score.lead-quality)

**Companies:** `industry`, `employee_count`, `annual_revenue`, `growth_stage`, `technology_stack`, `icp_fit_score`, `icp_fit_score_updated_at`

**Contacts:** `title`, `seniority`, `department`, `persona`, `lead_score`, `lead_score_updated_at`, `buying_intent_signals`

**Skip:** raw email body, call recording transcript, unstructured notes

### Outreach focus (generate.outreach-sequence, generate.meeting-brief)

**Contacts:** + `email`, `phone`, `timezone`, `preferred_channel`, `last_contacted_at`, `opt_out`, `recent_activity_summary`

**Companies:** + `key_initiatives`, `recent_news`, `tech_stack_summary`, `mutual_connections`

**Conversations:** `channel`, `direction`, `sentiment`, `intent`, `body_preview` (not full body)

### Pipeline / call intelligence (analyze.buying-stage, analyze.call-summary)

**Conversations:** full set including `body_preview`, `keywords`, `action_items_extracted`

**Signals:** full set — this is the primary input for buying stage inference

**Companies:** + `open_opportunities`, `last_meeting_date`, `last_call_date`

### Data quality (analyze.deduplication, sync.normalize-lifecycle)

**Contacts:** + `created_source`, `merge_history`, `duplicate_of`, `lifecycle_stage`, `lifecycle_stage_updated_at`

**Companies:** + `domain_variants`, `parent_company`, `subsidiary_of`

---

## Memory Freshness and skip_if Tuning

Every scoring and research operation has a `skip_if` window — it skips a record if the relevant property was updated within that window. These defaults are tunable per customer cadence.

| Operation | skip_if property | Default window | When to tighten | When to loosen |
|-----------|-----------------|----------------|----------------|----------------|
| `score.icp-fit` | `icp_fit_score_updated_at` | 7 days | High-velocity pipeline (ICP changes fast) | Stable enterprise accounts |
| `score.lead-quality` | `lead_score_updated_at` | 3 days | Very active inbound | Slow-motion B2B |
| `research.account-deep-dive` | `last_researched_at` | 30 days | Pre-QBR or strategic accounts | SMB mass outreach |
| `research.contact-background` | `last_researched_at` | 14 days | AE-specific pre-call | SDR mass outreach |
| `analyze.buying-stage` | `buying_stage_updated_at` | 1 day | Active deal rooms | Long-cycle enterprise |
| `analyze.call-summary` | `last_call_summarized_at` | N/A (always runs) | N/A | N/A |

**How to tune:** Edit the `skip_if` block inside the operation's TypeScript file:
```typescript
const skipResult = await evaluateSkipIf(workspace, {
  property: "icp_fit_score_updated_at",
  windowDays: 14,  // change this value
});
```

After editing, run with `DRY_RUN=true` and inspect workspace.updates to confirm skips are happening at the right cadence.

---

## Bulk Sync Strategy

For large CRMs (10k+ contacts or companies), naive sync will hit rate limits. Use the staged sync pattern.

### Recommended batch sizes

| CRM size | Contacts per batch | Companies per batch | Recommended strategy |
|---------|-------------------|--------------------|--------------------|
| < 2,000 | Full sync | Full sync | Single `crm.sync-core` run |
| 2k–20k | 500/batch | 200/batch | Paginated sync with `offset` filter |
| 20k–100k | 250/batch | 100/batch | Staged sync (priority tiers first) |
| 100k+ | 100/batch | 50/batch | Staged sync + background job (SDK) |

### Priority tier approach for large CRMs

Run sync in three passes, most important first:
1. **Pass 1 — Active pipeline:** `lifecycle_stage` in [MQL, SQL, Opportunity, Customer]
2. **Pass 2 — Warm contacts:** `last_activity_date` within 90 days
3. **Pass 3 — Full database:** remaining unsynced records

This ensures your AI has the most important records available in hours, not days.

### Parallelism notes

- Max 5 concurrent `crm.sync-core` operations (Personize rate limit)
- Add 100ms delay between batch starts to avoid burst errors
- For 100k+ records, use the Personize SDK's batch import pattern — see `docs/SCALING.md`

---

## What NOT to Memorize

Avoid syncing these to Personize:

| Do not memorize | Why |
|----------------|-----|
| Full email bodies | High storage cost, PII risk, low signal-to-noise — store `body_preview` (first 500 chars) only |
| Call recordings (audio/video) | Binary, not queryable, high storage — store `call_summary` from `analyze.call-summary` instead |
| Binary attachments | PDFs, decks — not searchable; store extracted key_points if needed |
| Opportunity amount history | Belongs in CRM; only sync current `amount` and `stage` |
| Duplicate contacts before dedup | Run `analyze.deduplication` first; sync winner record only |
| System / internal contacts (noreply@, support@) | Filter at sync time: exclude `email NOT CONTAINS '@yourcompany.com'` or known system patterns |
| Deleted CRM records | Use `crm.sync-core` filter `is_deleted: false`; run periodic cleanup for stale Personize records |

---

## Data Privacy and Retention

### GDPR / CCPA deletion flow

When a contact requests deletion:

```
Step 1: Delete from Personize
  delete_resource(type='contact', id='<personize_record_id>')
  → This cascades: removes all properties, workspace.updates, signals, and operation_run references for that contact

Step 2: Delete from CRM
  CRM deletion via HubSpot or Salesforce native delete (outside this repo)

Step 3: Verify
  memory_get_properties(id='<personize_record_id>')
  → Should return 404 / not found

Step 4: Log
  Append deletion event to your compliance log (outside this repo)
```

### Opt-out enforcement

Contacts with `opted_out: true` or `do_not_contact: true` in Personize are gated at multiple layers:

1. **Operation filter layer:** `crm.sync-core` syncs the `hs_email_optout` / Salesforce `HasOptedOutOfEmail` field into `opted_out`
2. **Governance layer:** `agent-playbook.md` and `multichannel-rules.md` guidelines instruct the AI to skip opted-out contacts
3. **Write layer:** `generate.outreach-sequence` checks `opted_out` before generating any sequence

**Never bypass this:** Do not filter out opted-out contacts from sync — they need to be in Personize with `opted_out: true` so the governance layer can enforce the rule. Deleting them from Personize means the rule can't be checked.

### Data residency

Personize stores data in the region configured at account setup (EU or US). Confirm with the customer before syncing PII:

- EU region: compliant with GDPR by default
- US region: confirm customer's data processing agreements
- Cross-border transfers: if CRM is in EU but agent runs in US, confirm DPA covers this

### Retention windows

Align `skip_if` windows with the customer's data retention policy. If retention policy is 12 months, set `skip_if` windows to never exceed that. For operation_runs collection, prune records older than the retention window using the Personize SDK's delete API.

### Reference

See `docs/PRIVACY.md` in this repo for the full privacy policy and deletion runbooks.