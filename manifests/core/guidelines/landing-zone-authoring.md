---
name: landing-zone-authoring
tags: [landing, zone, schema, template, personalization, content]
---

# Landing Zone Authoring

> A landing zone is a customizable content section on a personalized landing page. Zones are defined by a schema guideline (JSON) that specifies the available zones, their constraints, and rendering rules.

## Landing Zone Schema (JSON)

A Landing Zone Schema is a JSON guideline that defines the zones a landing page can render. The schema is an object with a `zones` array, where each zone specifies:

- `name` (string): The zone identifier (e.g., `hero`, `social_proof`, `pricing_table`). Used to derive the property name that stores the zone content (`personize_zone_<name>`). The name `status` is reserved and must not be used as a zone name.
- `max_chars` (integer): Character limit for the zone content. Enforcement is a soft recommendation to the generator; oversized content may be truncated at render time.
- `fallback` (string): Fallback text to render if no personalized content is available (e.g., "General information about our platform").
- `guidance` (string): Instructions for the generator describing what the zone should contain and any brand or tone guidelines.
- `theme` (string): A rendering hint for the template (e.g., `dark`, `light`, `accent_color`). The customer template interprets this value.

The number of zones is variable; design the schema for your landing page's sections.

### Example Schema

```json
{
  "zones": [
    {
      "name": "hero",
      "max_chars": 300,
      "fallback": "Welcome to our platform",
      "guidance": "Personalized headline addressing the company's top business challenge",
      "theme": "dark"
    },
    {
      "name": "social_proof",
      "max_chars": 500,
      "fallback": "Trusted by industry leaders",
      "guidance": "Case study or customer reference relevant to the account's industry",
      "theme": "light"
    }
  ]
}
```

## Generation Mode: Personalized vs Standard

The schema specifies a `generation_mode` that determines how zone content is produced:

### Personalized Mode

Zone content is AI-generated fresh for each account, using the account's research data and context. Each zone lands in its own `personize_zone_<name>` property on the account record. The generator uses the zone's `guidance` field to author content tailored to the specific account.

### Standard Mode

Zone content comes from a dashboard-editable guideline named "Landing Zone Copy". This guideline uses Markdown with section headers matching each zone name (e.g., `## hero`, `## social_proof`). The generator reads the appropriate section from the guideline and copies it to the zone property. No per-account personalization occurs.

Standard mode is useful when you want consistent, pre-approved messaging across all accounts, or when personalization is not yet mature enough to release.

## Fallback Strategy: Rendering Behavior

The schema specifies a `fallback_strategy` that tells the template how to handle missing zone content:

### fallback_copy

If the zone property is empty or missing, render the `fallback` text from the schema. This ensures the section always displays something.

### hide_if_empty

If the zone property is empty or missing, write an empty string or null to the property. The customer template detects this and hides the zone entirely via CSS (`display:none` or similar). Useful for optional sections where an absent zone is preferred to generic fallback text.

## Company Anchor and Naming

All personalized landing pages must anchor to the account's company name, never the contact's first name. Always reference the company entity ("ABC Corp is tackling", "Your team at ABC Corp") rather than personal pronouns or first-name basis. This maintains professionalism and clarity across organizations.

## Property Storage

When a landing page is personalized, each zone's content is stored in a property following the pattern:

```
personize_zone_<zone_name>
```

For example, if your schema defines zones `hero` and `social_proof`, the zone properties will be:

- `personize_zone_hero`
- `personize_zone_social_proof`

The customer's landing page template queries these properties and renders them in the appropriate DOM locations.
