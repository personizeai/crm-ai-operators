---
name: data-hygiene
tags: [data, hygiene, dedupe, conflict, sync, quality]
---

# Data Hygiene

> When CRM and Personize disagree, who wins? When two records look like duplicates, what do we do? This guideline answers those questions.

## Source of truth, by field type

| Field type | Source of truth | Example fields |
|------------|----------------|----------------|
| Identity (immutable) | CRM (most recently human-edited wins) | email, first_name, last_name, company name |
| Firmographics | Most recent confident source | industry, employee_count, business_model |
| Lifecycle / stage | CRM (it's the workflow tool) | lifecycle_stage, deal stage |
| AI-derived | Personize | ai_score, ai_score_reason, buying_stage, next_best_action |
| Signals & engagement | Personize | last_signal, signal_strength |
| Workspace data | Personize (Personize-only fields) | context, updates, notes, pending_tasks |

## Conflict resolution

When the same field has different values in CRM and Personize:

1. If field is `human_entered` flagged in CRM (the field has a recent edit by a human user, not an integration) → **CRM wins.** Do not overwrite.
2. Else if AI-derived field → **Personize wins** by definition.
3. Else if last-modified timestamp differs by >7 days → **most-recent wins.**
4. Else flag conflict to `workspace.open_issues` for human review.

## Dedupe rules

Trigger dedupe checks before any record creation, not after.

| Object | Match keys (in priority order) |
|--------|-------------------------------|
| Contact | email (exact, case-insensitive) → linkedin_url → first_name+last_name+company_domain |
| Company | domain (root, no www) → company_name+headquarters_country |
| Conversation | conversation_id → (channel + sender + sent_at within 5 minutes + recipient overlap) |

## Dedupe action

- **Exact match (primary key)** → update existing record; do not create duplicate.
- **High-confidence fuzzy match** (e.g. domain matches but company name differs slightly) → merge candidate; surface to `workspace.pending_tasks` for confirmation if score < 0.95.
- **Low-confidence match** → create new record + flag both with `potential_duplicate_of` cross-reference.

## Personal-email handling

- Personal-email domains (gmail.com, outlook.com, yahoo.com, hotmail.com, etc.) **must not** be used as `company_domain`.
- A contact with a personal email is allowed only when the contact is a known stakeholder or referrer, tracked in `notes` with the linking justification.
- Never auto-create a `companies` record from a personal-email domain.

## Stale data rules

- A `contacts` record with no engagement in 12+ months → tag `stale`, exclude from active outreach until refreshed.
- A `companies` record with no signals or research updates in 6+ months → re-research before any outreach.
- Stale doesn't mean delete. Personize retains history; staleness gates the *active* set.

## CRM writeback safety

(See `crm-writeback-policy.md` for the canonical rules. Summary: dry-run by default, AI properties to dedicated CRM custom fields, never overwrite human values.)
