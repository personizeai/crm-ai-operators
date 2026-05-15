# HubSpot manifests

CRM-specific manifests live here. They are applied in addition to `manifests/core/` when `--crm hubspot` is specified.

Add HubSpot-specific:
- Custom property definitions to create on the HubSpot side (mirror of Personize AI properties for writeback)
- HubSpot ↔ Personize field mapping overrides
- HubSpot-specific guidelines (writeback policy nuances, custom object handling)

This folder is currently a placeholder. The `setup.apply` operation reads it via `applyManifests({ crm: "hubspot" })`.
