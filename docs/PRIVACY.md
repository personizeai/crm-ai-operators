# Privacy

## What this library touches

`crm-ai-operators` is a **local execution library**. It does not run a server, collect telemetry, or phone home. All data flow is between your machine, your CRM (HubSpot / Salesforce), and your Personize organization.

### Data paths

| Direction | What | Where it goes |
|-----------|------|---------------|
| Inbound | CRM contacts + companies | → Personize memory (your org) |
| Inbound | CRM engagements (emails, calls, meetings) | → Personize conversations collection |
| Outbound | AI-generated properties (score, stage, sequence) | → CRM custom fields via Personize passthrough |
| Outbound | Handoff payloads | → Slack / CRM task / email (per your config) |
| Local | Audit log | → `~/.crm-ai-operators/audit/*.ndjson` on the host |

### What the library does NOT do

- Collect usage analytics or telemetry
- Send data to any endpoint other than Personize and your CRM
- Store CRM credentials (OAuth tokens are held by Personize, not this library)
- Persist contact PII outside of Personize and your own CRM

## Audit log

The local audit log (`~/.crm-ai-operators/audit/`) contains:

- Operation name, run timestamp, duration, outcome (success / error)
- Record counts (how many contacts processed)
- Error messages (which may reference entity identifiers like email addresses)

This file lives on the host that runs the CLI/MCP and is not transmitted anywhere by this library. Treat it with the same care as other operational logs.

## Personize data handling

Contact and company records synced into Personize are governed by your Personize organization's data retention and access policies. Refer to [Personize's Privacy Policy](https://personize.ai/privacy) for details on how that platform handles your data.

## CRM data

This library reads from and writes to HubSpot and Salesforce via the Personize passthrough API. Your CRM's own privacy and data residency policies apply to the records stored there.

## Questions

For privacy-related questions, email **privacy@personize.ai**.
