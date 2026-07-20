---
name: sales-playbook-authoring
tags: [playbook, sales, authoring, content, account, preparation]
---

# Sales Playbook Authoring

> A sales playbook is a pre-call preparation guide personalized to a specific account. It is composed of five fixed sections, each with specific requirements and constraints.

## Runtime Guideline

This document describes the shape of a sales playbook for whoever configures the operation. The rules the generation model actually reads at run time live in a separate, directly editable guideline named `sales-playbook-rules` (offer framing, the recency window for why-now, the five sections and their word budget), plus the shared `brand-voice` guideline for tone. Edit `sales-playbook-rules` to change playbook behavior without a code deploy. `generate.sales-playbook` loads both before every run and fails closed with "Missing required guidelines" if either comes back empty.

## The Five Fixed Sections

A playbook must contain exactly these sections, in this order:

### 1. Account Snapshot

High-level context about the account: company name, industry, scale, and any top-level factual background (headcount, revenue, geographic presence). This section orients the rep without deep analysis.

### 2. Why Now

The business case for contact right now: recent hiring, competitive moves, regulatory changes, earnings calls, funding rounds, or other time-sensitive signals that create urgency. This section must cite **recent signals only** (within the last 90 days) with dates. Never reference stale information as if it were current.

### 3. Talk Track

The conversational opening and value angle tailored to the account. This section frames the offer in the account's language and business context, addressing their likely priorities. It must never assume the contact has decision-making authority or ownership over the proposed problem. Always position as exploratory ("I wanted to learn if", "would it make sense to explore") rather than prescriptive. Keep the tone consultative and genuine.

### 4. Landmines

Pitfalls, sensitivities, or context the rep must avoid. Examples: recent layoffs, active competitive bids, known objections within the industry, or specific budget constraints. This section protects the rep from missteps before the conversation starts.

### 5. Next Step

Clear, single-action guidance for moving the conversation forward if the account shows interest. This is not a list of options, but one recommended path (e.g., "schedule a 15-minute discovery call to map their tech stack").

## Length and Access Gating

The composed playbook body (all five sections combined) must stay under 400 words total. Brevity forces prioritization of the most signal-rich context.

Playbooks are access-gated to the sales team and should never be shared externally. They are internal preparation tools.

## Storage and Personalization

When a playbook is generated for an account, the full composed body lands in the `playbook_full` property on the Personize contact record. Additionally, each section is stored separately in its own `playbook_<section_name>` property, so templates or systems can render individual sections if needed:

- `playbook_account_snapshot`
- `playbook_why_now`
- `playbook_talk_track`
- `playbook_landmines`
- `playbook_next_step`

These are the Personize property names, and Personize memory is the source of truth for them. The CRM writeback then mirrors the same values to the connected CRM's namespaced custom fields automatically, no separate mapping step needed: HubSpot receives `personize_playbook_<section_name>` (e.g. `personize_playbook_talk_track`), Salesforce receives `Personize_Playbook_<Section_Name>__c` (e.g. `Personize_Playbook_Talk_Track__c`). Author and reference the bare `playbook_*` names above; the CRM-specific prefix is applied by the writeback layer, not by this operation.

## Quality Gate: Verify-Then-Emit

Every playbook generation ends with a self-check step. While drafting, the model checks each section against the rules in `sales-playbook-rules`, most importantly that the talk track and landmines carry no unconfirmed ownership claim, meaning a claim that the account already uses our product, or that the contact controls the problem being proposed, without explicit evidence such as title, recent hiring in that function, or known budget authority. When the model finds a violation, it corrects the affected text itself, silently, as part of the same draft, before the output is returned.

The model sets `verification.status` to `rejected` only as a hard stop, reserved for when the request genuinely cannot be satisfied while complying with the rules, for example when the contact facts contain nothing usable and the model cannot avoid inventing a claim. A rejection is terminal for that run: the operation returns `ok: false`, nothing is written to memory or the CRM, and there is no automatic retry or rewrite cycle within the call. No playbook ships with "you need to approve this" or similar language unless the contact's title or role explicitly suggests decision authority.
