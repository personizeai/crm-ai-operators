---
name: salesforce-object-model
tags: [salesforce, crm, lead, contact, account, writeback, fls, object-model]
---

# Salesforce Object Model

Rules every operation follows when the connected CRM is Salesforce. Applied only
when setup runs with `--crm salesforce`.

## Lead vs Contact

Salesforce splits people across two objects:

- **Lead** — an inbound prospect who has not been converted. Standalone; not yet
  linked to an Account or Contact.
- **Contact** — a person after conversion, linked to an Account.

The Personize `contacts` collection unifies both. Each record carries
`crm_object_type` (`lead` | `contact`). When reading or writing a person:

- Route by `crm_object_type`. Use `salesforce.person(crmObjectType)` in the
  adapter, or resolve the object with `salesforceObjectFor(crmObjectType)`.
- Never write Contact fields to a Lead or vice-versa — the field sets differ and
  the write will fail.
- `Personize_*__c` writeback fields are provisioned on **both** Lead and Contact
  by `setup.apply --crm salesforce`, so scores land wherever the person lives.

### Syncing both populations

Lead and Contact are **separate sObjects with separate builtin templates**, so a
full people sync runs two datasources — both land in the unified `contacts`
collection:

- `contact` → `salesforce_contacts_standard` (Contact sObject). Resolves the
  parent Account server-side, filling `company` (`Account.Name`) and
  `company_domain` (`Account.Website`).
- `lead` → `salesforce_leads_standard` (Lead sObject). Leads have no Account, so
  the template falls back to the Lead's own `Company` → `company` and `Website` →
  `company_domain` text fields.

`crm.sync-core --crm salesforce` imports `contact`, `lead`, and `company` by
default. **Do not point a Lead sync at the contacts template** — its
`Account.*` traversal won't resolve for Leads.

### `company_domain` coverage caveat (data quality, not a bug)

`company_domain` only populates where the source has the underlying field set:
for a Contact, the parent `Account.Website`; for a Lead, its own `Website`. A
record whose Account has a null Website (or a Lead with no Website) syncs fine but
leaves `company_domain` empty — the same shape as HubSpot's association-derived
`company_domain`. Expect `company_domain` coverage to track the share of your
Accounts/Leads that actually have a website filled in.

## Companies are Accounts

The `companies` collection maps to the Salesforce **Account** object. There is no
bare-domain field on Account — `domain` maps to `Website`. `company_name` →
`Name`, `industry` → `Industry`, `employee_count` → `NumberOfEmployees`.

## After setup — grant field-level security (required)

Custom fields created through the Tooling API are **hidden from every profile by
default**. After `setup.apply --crm salesforce`, an admin must grant field-level
security (read/edit) on the `Personize_*__c` fields to the relevant profiles or
permission sets — otherwise reps won't see the scores and API writes to them may
be rejected. `setup diff` and `setup apply` both print a reminder line per object.

## Template mappings are snapshotted at datasource-create time

The managed sync copies a template's field mappings **into the datasource when it
is created** — later template changes do not propagate to existing datasources. If
Personize ships an updated Salesforce template (e.g. new `Account.*` resolution
for `company_domain`), a plain re-sync of an existing datasource keeps the old
mappings. To pick up new fields, **delete and recreate** the datasource
(`ensureDatasource` will recreate it from the current template on the next run).

## Writeback safety

- Only write `Personize_*__c` custom fields. Never overwrite standard fields
  (`Rating`, `LeadSource`, `Industry`, …) unless an operation's mapping says so.
- Respect **validation rules** and **required fields** — a write that violates one
  fails the whole record. Prefer `upsert` on an external id for idempotence.
- Field-level security and sharing are enforced by Salesforce per the connection's
  user; a write can be silently dropped by FLS even when the API returns success
  for other fields. Treat FLS as configured (step above), not assumed.
