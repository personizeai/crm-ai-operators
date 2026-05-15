---
name: signal-definitions
tags: [signal, buying, intent, trigger, scoring, timing]
---

# Buying Signal Definitions

These signals feed into `score.lead-quality`, `score.icp-fit`, and any `analyze.*` operation that updates `ai_score` or `account_score`. Stored in the `signals` collection with `severity` matching the bucket below.

## Strong Signals (severity = high, score +30)

- New funding round announced in last 90 days
- Hiring 3+ sales/revenue roles simultaneously
- New CRO/VP Sales hired in last 60 days
- Competitor contract renewal coming up (known from intel)
- Published content about scaling sales/revenue operations
- Direct reply with positive intent ("interested", "let's chat", "send more")

## Moderate Signals (severity = medium, score +15)

- Job posting for sales ops or revenue ops roles
- Company headcount grew 20%+ in last 6 months
- Expanded to new market or geography
- Mentioned pain points we solve in public content
- Attended relevant industry event or webinar
- Email opened 3+ times in 7 days
- Multiple stakeholders engaging from the same domain

## Weak Signals (severity = low, score +5)

- General hiring activity
- Website traffic increase
- Social media engagement on sales-related topics
- Industry trend affecting their vertical
- Single email open

## Negative Signals (severity = critical, score −20)

- Recent layoffs (especially in sales)
- Funding round failed or down round
- Just signed with a competitor (wait 12 months)
- Company in acquisition talks
- Contact left the company
- Direct opt-out (mark as Disqualified, never re-contact)

## Decay

Old signals decay. Apply a 0.9× multiplier per 30 days since `occurred_at`. Signals older than 180 days have negligible weight unless explicitly refreshed.
