# AgentExchange Listing Plan

> A path to listing crm-ai-operators (or its Personize parent) on Salesforce's AgentExchange marketplace. Last updated 2026-05-01.

## The short version

**Verdict from research:** `crm-ai-operators` cannot be listed today as-is. Three blockers:

1. **No Salesforce Partnership.** AgentExchange listings require an enrolled Salesforce Partner with a Partner Business Org. Individual developers cannot list directly.
2. **Wrong consumption model.** AgentExchange's MCP Partners collection currently targets **Agentforce-as-consumer** — agents running inside Salesforce. Our positioning is the inverse: external agents (Claude / Cursor / etc.) operating Salesforce data. There's no documented category for this yet.
3. **No security review yet.** Listings pass an AppExchange-style security review (encryption, 2FA, GDPR, secure SDLC). Historical timeline: 6-12 weeks.

**Path to listing exists** — it's a 4-phase project, ~2-3 months, with a strategic decision required at the start.

## Strategic decision required first

**Who is the listing entity?**

| Option | Rationale |
|--------|-----------|
| A. **Personize** as the Partner; crm-ai-operators is a feature/surface | Personize is the parent product, has SOC2-quality posture potential, and the listing is really about "Personize for Salesforce" — memory + governance + this operations library. The marketplace audience cares about the platform, not the wrapper. |
| B. **crm-ai-operators** as the listing entity, Personize as a dependency | Cleaner OSS narrative but harder partner story. AgentExchange listings expect a single ISV with commercial agreement. |
| C. **Don't list — distribute via npm + GitHub only** | Skips 2-3 months of process. Loses Salesforce ecosystem distribution + builders fund eligibility. Right answer if Salesforce ecosystem isn't a priority customer source. |

Recommendation: **Option A.** List Personize as the Partner; crm-ai-operators is one of the surfaces. This positions Personize correctly (a platform, not a wrapper around HubSpot) and keeps the OSS story unchanged at the npm level.

## Phase A — Foundation (week 1-2)

| Task | Owner | Notes |
|------|-------|-------|
| Enroll in Salesforce Partner Program | Personize | Free. https://www.salesforce.com/partners/become-a-partner/ → Partner Community |
| Create a Partner Business Org | Personize | Required for development + listing |
| Sign Salesforce ISV Partner Agreement | Personize Legal | Standard. Reuses AppExchange ISV terms. |
| Apply for $50M Builders Initiative | Personize | Capital + Forward Deployed Engineering + lead referrals + MDF. Routed through Partner Community. Per-developer terms not public. |

**Output:** registered SF Partner with Business Org and ISV agreement signed. Builders Initiative submission pending.

## Phase B — Tech qualification (week 3-6)

| Task | Owner | Notes |
|------|-------|-------|
| Build an Agentforce-compatible packaging layer | Personize Eng | Wrap our `operation_run` MCP tool as Agentforce **Topics + Actions** that delegate to crm-ai-operators. AgentExchange MCP listings are oriented to Agentforce consumption — this is the bridge. |
| Document the architecture for security review | Personize Eng | Architecture diagram, data flow, encryption-in-transit/at-rest, third-party libraries, vulnerability scanning, incident response |
| Implement / verify required security controls | Personize Eng + DevOps | TLS everywhere, 2FA on Partner accounts, GDPR data handling, dependency scanning, secure SDLC documentation |
| Pen test (recommended, not strictly required) | External vendor | Strengthens the security review submission |
| Listing assets | Personize Marketing | Logo, screenshots, demo video (~3 min walkthrough), description, supported industries, user guide |

**Output:** Agentforce-compatible package + security review documentation + listing assets.

## Phase C — Submission (week 7-10)

| Task | Owner | Notes |
|------|-------|-------|
| Upload package to AppExchange Publishing Console | Personize | Publishing Console is the gate for AppExchange + AgentExchange listings |
| Submit for security review | Personize | Historical timeline 6-12 weeks. AgentExchange-specific timeline unconfirmed. |
| Submit listing copy + assets | Personize | Trademark guidelines apply to listing copy |
| Determine pricing model | Personize | Free / freemium / subscription / one-time / usage-based — all supported. Revenue share unconfirmed for AgentExchange (AppExchange historical: 15-25% of net revenue). |

**Output:** listing submitted, security review in progress.

## Phase D — Live + iterate (week 11+)

| Task | Owner | Notes |
|------|-------|-------|
| Address security review feedback | Personize Eng | Common: encryption gaps, missing audit logs, dependency CVEs. Iterations expected. |
| Listing goes live | Personize | Visible on agentexchange.salesforce.com |
| Track installs + qualified leads | Personize Sales | AgentExchange refers leads to listed partners |
| Iterate listing copy + assets based on conversion | Personize Marketing | A/B test screenshots, demo video, CTA |

## Open questions for the user

Before kicking off Phase A, decisions needed:

1. **Listing entity** — Personize as Partner (Option A above)? Confirm.
2. **Legal commitment** — willing to sign the Salesforce ISV Partner Agreement? It's a standard ISV agreement but a real legal commitment.
3. **Time horizon** — willing to commit 8-12 weeks before going live? Reasonable if the SF ecosystem is a priority customer source.
4. **Builders Initiative** — should we apply? Capital + FDE help is real value. The flip side is they may want some commitment in return (priority co-marketing, deeper Agentforce integration).
5. **Pricing model** — free listing for lead generation, or paid SKU? Affects revenue share calculation.
6. **Salesforce-priority pivot question** — once listed, do we re-prioritize Salesforce alongside HubSpot, or keep HubSpot-primary positioning? AgentExchange leads expect SF-first treatment.

## Findings from research (2026-05-01)

| Topic | Finding |
|-------|---------|
| Listing types | Actions, Topics, Agent Templates, Prompt Templates, **MCP Servers** (dedicated "Agentforce MCP Partners" collection), Agents |
| Eligibility | Must be enrolled Salesforce Partner with Partner Business Org. No individual developer listings. |
| Application | Partner Community → Partner Business Org → execute commercial agreement → upload via Publishing Console → security review → publish |
| Timeline | 6-12 weeks for security review (AppExchange historical). AgentExchange-specific unconfirmed. |
| Security review | Mandatory. Encryption, 2FA, GDPR, secure SDLC, third-party library disclosure. SOC2 not explicitly required but recommended. |
| Cost | Partner Program enrollment free. ISV commercial agreement before listing. AppExchange historically charges security review fees + 15-25% revenue share for paid listings. AgentExchange-specific pricing unconfirmed. |
| $50M Builders Initiative | Capital + FDE support + lead referrals + MDF. Targeted at small ISVs / early-stage. Application path: Partner Community / direct partner outreach. Per-developer terms not public. |
| Live MCP listings | PayPal MCP confirmed. "Agentforce MCP Partners" collection at agentexchange.salesforce.com/collections/agentforce-mcp. |
| Our verdict | Listable: **probably not in current form.** Need partner enrollment + Agentforce-compatible packaging + security review. ~2-3 month project. |

## Sources

- [AgentExchange marketplace](https://agentexchange.salesforce.com/)
- [Agentforce MCP Partners collection](https://agentexchange.salesforce.com/collections/agentforce-mcp)
- [AgentExchange announcement (Mar 4, 2025)](https://www.salesforce.com/news/press-releases/2025/03/04/agentexchange-announcement/)
- [Salesforce Opens Agentforce 360 to Builders ($50M fund)](https://www.salesforce.com/news/stories/opening-agentforce-360-to-builders/)
- [SalesforceBen — $50M Builders Initiative explainer](https://www.salesforceben.com/appexchange-slack-marketplace-and-the-agentforce-ecosystem-are-now-one-with-fresh-50m-funding/)
- [Salesforce Partner Program](https://www.salesforce.com/partners/become-a-partner/)
- [Partner Community portal](https://partners.salesforce.com/)
