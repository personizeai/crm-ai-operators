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

## Writeback safety

- Only write `Personize_*__c` custom fields. Never overwrite standard fields
  (`Rating`, `LeadSource`, `Industry`, …) unless an operation's mapping says so.
- Respect **validation rules** and **required fields** — a write that violates one
  fails the whole record. Prefer `upsert` on an external id for idempotence.
- Field-level security and sharing are enforced by Salesforce per the connection's
  user; a write can be silently dropped by FLS even when the API returns success
  for other fields. Treat FLS as configured (step above), not assumed.
