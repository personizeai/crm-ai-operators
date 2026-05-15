---
name: contact-qualification
tags: [qualification, contact, lead, persona, champion]
---

# Contact Qualification

> Even at a qualified account, not every contact is worth engaging. This rule gates per-contact actions.

## Hard gates (any failure = disqualified)

- Email is missing or invalid format — fail.
- Email domain doesn't match the contact's company domain (free-email contact) — fail unless the contact is explicitly tagged as a stakeholder or referrer.
- `crm_object_type = lead` AND status is "Disqualified" / "Unqualified" / "Lost" — fail.
- Contact has opted out (any sequence, any campaign) — fail. Opt-outs are global and permanent.
- Contact's company (via `company_domain`) failed account qualification — fail (even great contacts at bad-fit companies don't justify outreach).

## Persona match

Contact must match at least one of:

- **Decision Maker**: Title contains target role from ICP definition AND seniority is `Director`, `VP`, `C-Level`, or `Founder`.
- **Champion**: Function matches but seniority is `Manager` or `IC` — engageable for content, not primary outreach.
- **Influencer**: Senior contact in adjacent function (e.g., VP Marketing at a sales-focused ICP) — engageable as a referral path.
- **Gatekeeper**: Operations / RevOps / Sales Ops contact who can introduce — engage for referral, not direct sale.

If contact matches none → `Disqualified`.

## Persona scoring

Compute `ai_score` (0–100) per contact:

| Dimension | Weight |
|-----------|--------|
| Persona match (Decision Maker = 100, Champion = 70, Influencer = 50, Gatekeeper = 40) | 35% |
| Seniority alignment with target | 20% |
| Function alignment with target | 15% |
| Engagement history (recent opens, replies, meeting attendance) | 20% |
| Account-level lift (parent account_score) | 10% |

## Skip rules for operations

- `generate.outreach-sequence` skips when `ai_score < 60` OR persona match is missing.
- `act.log-task` (human follow-up) fires only for `ai_score >= 80`.
- `analyze.reply-sentiment` runs on every reply regardless of score (replies are always informative).

## Multi-contact accounts

For accounts with multiple qualified contacts:
- Outreach to **at most 2 contacts simultaneously** (avoid the "spammy multi-contact" pattern).
- Prefer Decision Maker > Champion > Influencer > Gatekeeper when picking who.
- If the first contact replies negatively, do **not** pivot to a second contact at the same company within 90 days.
