---
name: outreach-playbook
tags: [sequence, outreach, cadence, email, timing, playbook]
---

# Outreach Sequence Rules

## Sequence Structure

- 3 emails maximum per contact per sequence.
- **Email 1**: Specific observation + value prop + soft CTA ("worth a look?").
- **Email 2**: New angle or insight + their situation + medium CTA ("open to a quick call?").
- **Email 3**: Brief + final reason + binary CTA ("yes or no — should I stop reaching out?").

## Timing

- Minimum 3 business days between emails.
- Never send on weekends or holidays.
- Best send windows: Tue–Thu, 8–10am or 2–4pm in the recipient's timezone.
- If the contact replies at any point, stop the sequence — human takes over.

## Channel Rules

- Email is the default for cold outreach.
- LinkedIn connection request only after Email 1.
- Phone call task only for contacts scored 80+ who opened Email 1.
- SMS is never used for cold outreach.

## Opt-Out

- Every email must include an unsubscribe mechanism.
- If someone replies "not interested" or "remove me", immediately mark as Opted Out.
- Never re-enroll an opted-out contact. Period.

## Escalation

- If a contact opens all 3 emails but doesn't reply → notify rep.
- If a contact replies with interest → notify rep immediately + create CRM task.
- If a contact replies negatively → log it, do not follow up.

## Sequence-Level Skip Rules

`generate.outreach-sequence` should skip a contact when:
- `sequence_status` is `Replied`, `Bounced`, `Opted Out`, or `Complete`.
- `last_sent_at` is within the timing minimum (3 business days).
- `emails_sent >= 3` for the current `campaign_id`.
- `ai_score < 60` (configurable per campaign).

## Example Sequences

### Required HTML structure

All email bodies use these tags only:
- `<p>` — wrap every paragraph
- `<b>` / `<strong>` — emphasis (sparingly)
- `<i>` / `<em>` — names or titles
- `<a href="...">` — links (always include href)
- `<br>` — line break inside a paragraph

Forbidden: `<div>`, `<span>`, `<table>`, `<img>`, inline `style=` attributes, tracking pixels, `<script>`, `<style>`.

### Email 1 — Cold open (max 150 words)

**Subject:** Quick thought on [specific observation]

```html
<p>Hi [First Name],</p>
<p>I noticed [specific verifiable fact — e.g. "you just closed your Series B" or "you're hiring 4 SDRs"]. [One sentence connecting that fact to a pain point we solve].</p>
<p>[One sentence value prop — what we do, not who we are].</p>
<p>Worth a quick look?</p>
<p>[Sender first name]</p>
```

### Email 2 — Follow-up, new angle (max 120 words)

**Subject:** [Different angle from Email 1, not "Re:"]

```html
<p>Hi [First Name],</p>
<p>[New insight or angle — completely different from Email 1]. [How this specifically relates to their situation].</p>
<p>Open to a 15-min call this week?</p>
<p>[Sender first name]</p>
```

### Email 3 — Final, direct (max 100 words)

**Subject:** Should I close the loop?

```html
<p>Hi [First Name],</p>
<p>[One compelling reason to respond — tie back to their specific situation]. [Binary CTA — yes or no question].</p>
<p>Either way, no hard feelings.</p>
<p>[Sender first name]</p>
```

### Anti-patterns

- Walls of text without `<p>` tags
- Multiple CTAs in one email
- Invented statistics, case studies, or testimonials
- Generic "companies like yours" language
- Subject lines with ALL CAPS or excessive punctuation
- Starting with "I hope this email finds you well"
- Unsubscribe text in the body — handled by email infrastructure
