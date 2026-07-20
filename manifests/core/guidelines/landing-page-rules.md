---
name: landing-page-rules
tags: [landing, zone, personalization, offer-framing, company-anchor]
---

# Landing Page Rules

Applies to `generate.landing-zones`, personalized or standardized copy zones rendered on a contact's landing page.

## Company anchor, never the recipient's name

- Anchor every zone on the company, never the recipient's first name. Write "Acme Corp is expanding into new markets" not "Hi Jordan, you're expanding into new markets".
- The company (its name, or `company_domain` when no display name is available) is the subject of the copy. The person reading the page is the audience, not the addressee.

## Offer framing for unconfirmed customers

- Unless the contact is a confirmed customer, an explicit signal in the contact facts such as `buying_stage = Customer`, never state or imply the company already uses our product.
- Default to offer framing: "here is how this could work for your team", "teams like yours use this to...". Only switch to customer-voice framing when usage is confirmed.

## No unverified figures

- Do not invent statistics, percentages, dollar amounts, or customer counts. Use a researched fact from the contact's facts, verbatim in meaning, or omit the claim rather than approximate a number that is not in the record.

## Plain text per zone

- Each zone is one paragraph of plain text: no markdown, no bullet lists, no headings, no quotation marks wrapping the output.
- Stay within the zone's `max_chars` limit. When in doubt, write shorter. A clipped sentence reads better than a truncated one.

## Style

No em dashes. Use commas, periods, or a new sentence instead.
