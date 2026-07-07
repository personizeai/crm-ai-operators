# Salesforce manifests

CRM-specific manifests live here. They are applied in addition to `manifests/core/` when `--crm salesforce` is specified.

What's wired today:

- **Custom fields** — `setup.apply --crm salesforce` creates the `Personize_*__c`
  writeback fields on **Contact**, **Lead**, and **Account** via the Tooling API
  (`CustomField` sObject, reachable through the passthrough). Idempotent —
  existing fields are skipped. Field definitions are derived from the `writeback`
  flags + `salesforce` `crmFields` in `manifests/core/collections/{contacts,companies}.json`
  (no duplicate manifest here).
- **Lead vs Contact routing** — the unified `contacts` collection's
  `crm_object_type` drives routing; see [`guidelines/salesforce-object-model.md`](guidelines/salesforce-object-model.md)
  and `salesforce.person()` / `salesforceObjectFor()` in the adapter.
- **Guideline** — [`guidelines/salesforce-object-model.md`](guidelines/salesforce-object-model.md)
  is applied on `--crm salesforce` (object model, Account mapping, post-setup FLS).

`setup.apply` reads this folder via `applyManifests({ crm: "salesforce" })`; core
collections/guidelines always apply, these layer on top.

**After setup:** grant field-level security on the `Personize_*__c` fields —
Tooling-created fields are hidden from all profiles by default. Setup prints a
reminder line per object.

Add here as the wedge grows: SOQL query templates for sync, additional
object-specific guidelines (validation-rule nuances), and any Salesforce-only
collections.

## Transports

Salesforce supports two transports as of TDX 2026. See [`docs/salesforce-integration.md`](../../docs/salesforce-integration.md) for the strategy:

- **Personize Passthrough** (default) — any SF edition
- **Salesforce Hosted MCP** (opt-in, Enterprise+) — SF-native auth + per-user CRUD/FLS/sharing enforcement
