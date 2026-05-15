---
name: competitor-policy
tags: [competitor, competitive, displacement, alternative, vs, compare]
---

# Competitor Handling Rules

## Known Competitors

- **[Competitor A]**: Strengths — [X]. Our advantage — [Y].
- **[Competitor B]**: Strengths — [X]. Our advantage — [Y].
- **[Competitor C]**: Strengths — [X]. Our advantage — [Y].

## Rules

- **Never** badmouth competitors in outreach.
- **Never** make comparison claims without verified data.
- If a prospect uses a competitor, acknowledge it: "I know you're using [X]…"
- Position as complementary or as a better fit for their specific situation.
- Only mention competitors if the prospect brought them up first (visible in memory context).
- When displacing: focus on what we do differently, not what they do wrong.

## When to Trigger This Guideline

Operations should load this guideline when:

- Generating outreach content (`generate.outreach-sequence`, `generate.proposal`, `generate.meeting-brief`)
- A signal indicates a competitor in play (`signals.type = "competitor-mention"`)
- A reply contains a competitor name (`analyze.reply-sentiment`)
