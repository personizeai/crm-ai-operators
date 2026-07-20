---
name: landing-zone-schema
tags: [zone, schema, landing, personalization, json]
---
{
  "format_version": 1,
  "output": "plain_text",
  "generation_mode": "personalized",
  "zones": [
    {
      "name": "hero_headline",
      "max_chars": 90,
      "fallback": "Built for teams like yours.",
      "guidance": "One-line value statement anchored on the company, offer framing only."
    },
    {
      "name": "proof_paragraph",
      "max_chars": 400,
      "fallback": "Teams in your industry use this to cut manual work.",
      "guidance": "Tie one researched fact to the offer.",
      "theme": "capability-proof"
    },
    {
      "name": "cta_line",
      "max_chars": 120,
      "fallback": "See how this looks on your own data.",
      "guidance": "One sentence to the campaign CTA, no urgency."
    }
  ]
}
