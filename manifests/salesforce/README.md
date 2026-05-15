# Salesforce manifests

CRM-specific manifests live here. They are applied in addition to `manifests/core/` when `--crm salesforce` is specified.

Add Salesforce-specific:
- Custom field (`__c`) definitions to create on Salesforce objects (Contact, Lead, Account)
- Lead vs Contact routing rules (`crm_object_type` mapping)
- SOQL query templates for sync operations
- Salesforce-specific guidelines (object-permission nuances, validation rules)

This folder is currently a placeholder. The `setup.apply` operation reads it via `applyManifests({ crm: "salesforce" })`.

## Transports

Salesforce supports two transports as of TDX 2026. See [`docs/salesforce-integration.md`](../../docs/salesforce-integration.md) for the strategy:

- **Personize Passthrough** (default) — any SF edition
- **Salesforce Hosted MCP** (opt-in, Enterprise+) — SF-native auth + per-user CRUD/FLS/sharing enforcement
