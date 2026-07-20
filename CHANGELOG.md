# Changelog

## Unreleased

### Added

- Deterministic output guards library (`src/core/lib/guards.ts`, RFC 0001): config-driven banned-phrase scrub, negation-aware ownership-claim guard, recipient-name and placeholder leak guards, test-identity audit notes, signal recency filter, and output coercion, with off/shadow/enforce modes and per-fire provenance. Not yet wired into the operation runner; no behavior change.
- Sales playbook and landing zones generation operations (`generate.sales-playbook`, `generate.landing-zones`): rep-facing pre-call playbook and AI-scored landing page zone recommendations, with zone generation core (`src/core/lib/zones`), playbook section engine (`src/core/lib/playbook`), longtext property type (HubSpot textarea, Salesforce LongTextArea) for full-body content, and dual-CRM writeback to `personize_playbook_*` and `personize_zone_*` custom properties. No behavior change to existing operations.
