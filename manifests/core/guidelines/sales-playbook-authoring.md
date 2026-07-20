---
name: sales-playbook-authoring
tags: [playbook, sales, authoring, content, account, preparation]
---

# Sales Playbook Authoring

> A sales playbook is a pre-call preparation guide personalized to a specific account. It is composed of five fixed sections, each with specific requirements and constraints.

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

When a playbook is generated for an account, the full composed body lands in the `personize_playbook_full` property. Additionally, each section is stored separately in `personize_playbook_<section_name>` properties, so templates or systems can render individual sections if needed:

- `personize_playbook_account_snapshot`
- `personize_playbook_why_now`
- `personize_playbook_talk_track`
- `personize_playbook_landmines`
- `personize_playbook_next_step`

## Quality Gate: Self-Check on Ownership Claims

Before emitting a playbook, the authoring model must verify that the talk track contains no unconfirmed ownership claims. The model self-checks by asking:

> "Does the talk track claim this contact owns or controls the problem we are proposing to solve without explicit evidence (e.g., title, recent hiring in that function, known budget authority)?"

If the answer is yes, the model must reject and rewrite the talk track to remove the assumption. No playbook ships with "you need to approve this" or similar language unless the contact's title or role explicitly suggests decision authority.
