---
name: account-qualification
tags: [qualification, account, accounts, fit, decision, gating]
---

# Account Qualification

> ICP definition is the *ideal*. This guideline is the *runtime decision*: should we act on **this specific account** right now?

## Hard gates (any failure = disqualified)

- Domain matches a personal-email or freemail domain (`gmail.com`, `outlook.com`, etc.) — fail. Real companies have real domains.
- Industry is on the disqualified list in `icp-definition.md`.
- Lifecycle stage is `Customer`, `Churned`, `Win-Back`, or `Disqualified` — handled by separate motions, not new outbound.
- The account has an active opt-out flag.
- The account is below the minimum employee count threshold.

## Tier scoring (after hard gates pass)

Apply these weights against the account's properties to produce `account_score`:

| Dimension | Weight | What it measures |
|-----------|--------|------------------|
| ICP firmographic fit | 40% | Industry, size band, business model, growth stage match against `icp-definition` |
| Buying signals | 30% | `signal_strength` aggregated from recent `signals` records, decayed per `signal-definitions` |
| Engagement signals | 20% | Recent meaningful conversations, opens, clicks, meeting attendance from the `conversations` collection |
| Champion potential | 10% | Whether at least one resolved contact at the account is in the right function + seniority band |

## Tiering

| Score | Tier | Operation behavior |
|-------|------|-------------------|
| 80–100 | A | Eligible for high-touch motion (calls, custom proposals, AE-led outreach) |
| 60–79 | B | Eligible for standard outreach sequences |
| 40–59 | C | Nurture only — light-touch content, no direct outreach |
| 0–39 | D | Disqualified for now; recheck if a strong signal lands |

## Decision rules for operations

- `score.icp-fit` writes `icp_fit_score` and `icp_fit_reason`. Apply hard gates first; if any fail, return score 0 with reason "Hard gate: <which one>".
- `generate.outreach-sequence` skips accounts in tier C or D.
- `act.log-task` for human follow-up only fires for tier A.
- Re-qualify accounts when a new strong signal arrives or when account properties change materially.

## Re-qualification cadence

- Tier A: weekly
- Tier B: every 2 weeks
- Tier C: monthly
- Tier D: only on new signal arrival
