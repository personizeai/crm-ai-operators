---
name: account-research
tags: [research, account, intel, enrichment, deep-dive]
---

# Account Research

> What `research.account-deep-dive` and related research operations should collect when investigating an account before outreach.

## Required findings (every research run)

These fields must be populated by the end of a research run. If the source can't supply one, write "unknown" — never fabricate.

| Field | Source preference | Where it lands |
|-------|------------------|----------------|
| Company size & growth | Public filings, LinkedIn, the company's own site | `companies.employee_count`, `companies.company_size_band` |
| Industry & business model | Their site's "About" / "Customers" page, then LinkedIn | `companies.industry`, `companies.business_model` |
| Funding & investors | Crunchbase, news, their site | `signals` (severity = high if recent) |
| Recent leadership moves | LinkedIn, news, press releases | `signals` (severity = high if last 60 days) |
| Tech stack relevance | BuiltWith, job postings ("requires HubSpot/Salesforce") | `signals` (severity = medium) |
| Stakeholder map | LinkedIn search by company + target functions | `contacts` records (one per stakeholder) |
| Recent news & moves | Company blog, press releases, news | `signals` |
| Active jobs in target function | Their careers page, LinkedIn jobs | `signals` (severity = medium) |
| Public pain points | Conference talks, podcasts, content they publish | `companies.context` summary line |

## Optional findings (research deeper for tier A)

- Customer logos and case studies (helps tailor proof points)
- Competitive vendors they may use (BuiltWith, job postings naming tools)
- Recent product launches or roadmap signals
- Strategic initiatives mentioned in earnings calls (public companies)
- Conference speaker history (signal of public-facing leadership)

## Hard rules

- **Verify before storing.** A claim from one source is a hypothesis. Two sources = a fact. Mark uncertain claims as such in the `notes` array entry.
- **Never invent.** If LinkedIn doesn't show a CRO, don't write "CRO: unknown person". Leave the field empty and surface the gap.
- **Cite sources** in the `notes` array entry — `{ author, content, category: "enrichment", source_url, timestamp }`. Future operations need to verify or refresh.
- **Don't research opted-out accounts.** Wasted credits and a privacy concern. Check opt-out flag before starting.
- **Respect rate limits.** Tavily, Apollo, and any web-research tool charges credits. Use `personize_cookbook` for batch research.

## Output structure

Research operations return:

```json
{
  "summary": "<one-paragraph account narrative>",
  "facts": [ { "field": "...", "value": "...", "confidence": 0.9, "source": "..." } ],
  "signals": [ { "type": "...", "severity": "...", "title": "...", "occurred_at": "..." } ],
  "stakeholders": [ { "email": "...", "name": "...", "title": "...", "function": "...", "seniority": "..." } ],
  "next_action": "..."
}
```

The runtime persists `summary` to `companies.context`, appends each `signals` entry to the `signals` collection, and creates/updates `contacts` records from `stakeholders`.

## When to refresh

- Tier A accounts: monthly research refresh
- Tier B: quarterly
- Tier C: only on new signal arrival
- Always re-research within 7 days before generating new outreach (to avoid stale context in emails)
