---
name: landing-zone-authoring
tags: [landing, zone, schema, template, personalization, content]
---

# Landing Zone Authoring

> A landing zone is a customizable content section on a personalized landing page. Zones are defined by a schema guideline (JSON) that specifies the available zones, their constraints, and rendering rules.

## Runtime Guidelines

`generate.landing-zones` reads three guidelines before every run, plus the shared `brand-voice` guideline for tone:

- `landing-page-rules`: free-text rules the generator follows in personalized mode (company anchor, offer framing for unconfirmed customers, no unverified figures, plain text per zone). Edit this to change generation behavior without a code deploy.
- `landing-zone-schema`: the JSON schema described below, one per campaign. Defines which zones exist and their constraints.
- `landing-zone-copy`: standard-mode copy, read only when the schema's `generation_mode` is `standard`. See "Generation Mode" below.

The operation fails closed with "Missing required guidelines" if `landing-page-rules` or `brand-voice` comes back empty, and with a schema-specific error if `landing-zone-schema` is missing or not valid JSON.

## Landing Zone Schema (JSON)

A Landing Zone Schema is a JSON guideline, stored under the name `landing-zone-schema`, that defines the zones a landing page can render. The schema is an object with these top-level fields:

- `format_version` (number): schema format version. Must be `1`.
- `output` (string): output format for zone content. Must be `plain_text`.
- `generation_mode` (string, optional): `personalized` or `standard`. See "Generation Mode" below. Omitting it behaves as `personalized`.
- `zones` (array): the zone definitions, each specifying:
  - `name` (string): The zone identifier (e.g., `hero`, `social_proof`, `pricing_table`). Used to derive the property name that stores the zone content (`zone_<name>`). The name `status` is reserved and must not be used as a zone name: `zone_<name>` would become `zone_status`, colliding with the operation's own generation-status marker property of the same name.
  - `max_chars` (integer): Character limit for the zone content, an integer between 20 and 2000.
  - `fallback` (string): Fallback text to render if no personalized content is available (e.g., "General information about our platform"). Must fit within `max_chars`.
  - `guidance` (string): Instructions for the generator describing what the zone should contain and any brand or tone guidelines.
  - `theme` (string, optional): A rendering hint for the template (e.g., `dark`, `light`, `accent_color`). The customer template interprets this value.
  - `fallback_strategy` (string, optional): `fallback_copy` or `hide_if_empty`. See "Fallback Strategy" below.

The number of zones is variable; design the schema for your landing page's sections.

### Example Schema

```json
{
  "format_version": 1,
  "output": "plain_text",
  "generation_mode": "personalized",
  "zones": [
    {
      "name": "hero",
      "max_chars": 300,
      "fallback": "Welcome to our platform",
      "guidance": "Personalized headline addressing the company's top business challenge",
      "theme": "dark",
      "fallback_strategy": "fallback_copy"
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

Zone content is AI-generated fresh for each account, using the account's research data and context and the rules in `landing-page-rules`. Each zone lands in its own `zone_<name>` property on the account record. The generator uses the zone's `guidance` field to author content tailored to the specific account.

### Standard Mode

Zone content comes from a dashboard-editable guideline named `landing-zone-copy`. This guideline uses Markdown with section headers matching each zone name (e.g., `## hero`, `## social_proof`). The generator reads the appropriate section from the guideline and copies it to the zone property. No per-account personalization occurs, and the copy is used as-is rather than drafted against `landing-page-rules`.

Standard mode is useful when you want consistent, pre-approved messaging across all accounts, or when personalization is not yet mature enough to release.

## Fallback Strategy: Rendering Behavior

The schema specifies a `fallback_strategy` that tells the template how to handle missing zone content:

### fallback_copy

If the zone property is empty or missing, render the `fallback` text from the schema. This ensures the section always displays something.

### hide_if_empty

If the zone property is empty or missing, write an empty string or null to the property. The customer template detects this and hides the zone entirely via CSS (`display:none` or similar). Useful for optional sections where an absent zone is preferred to generic fallback text.

## Company Anchor and Naming

All personalized landing pages must anchor to the account's company name, never the contact's first name. Always reference the company entity ("ABC Corp is tackling", "Your team at ABC Corp") rather than personal pronouns or first-name basis. This maintains professionalism and clarity across organizations. See `landing-page-rules` for the full rule set the generator follows, including offer framing for accounts that are not confirmed customers.

## Property Storage

When a landing page is personalized, each zone's content is stored in a property on the Personize contact record following the pattern:

```
zone_<zone_name>
```

For example, if your schema defines zones `hero` and `social_proof`, the zone properties will be:

- `zone_hero`
- `zone_social_proof`

These are the Personize property names, and Personize memory is the source of truth for them. The CRM writeback then mirrors the same values to the connected CRM's namespaced custom fields automatically, no separate mapping step needed: HubSpot receives `personize_zone_<zone_name>` (e.g. `personize_zone_hero`), Salesforce receives `Personize_Zone_<Zone_Name>__c` (e.g. `Personize_Zone_Hero__c`). Author and reference the bare `zone_*` names above; the CRM-specific prefix is applied by the writeback layer, not by this operation. The customer's landing page template queries the CRM-side fields and renders them in the appropriate DOM locations.
