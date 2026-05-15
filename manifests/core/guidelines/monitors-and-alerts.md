---
name: monitors-and-alerts
tags: [monitors, alerts, autonomy, proactive, watching]
---

# Monitors and Alerts

> Monitors are persistent watchers that check for conditions over time. When a monitor's condition fires, it produces an alert. Together they let agents act *proactively* rather than only when prompted.

## When to use a monitor vs. just running an operation

**Use a monitor** when:
- The condition needs to be checked repeatedly over time (every pulse, daily, weekly).
- The trigger is conditional, not scheduled — e.g. "alert when login frequency drops below X".
- Multiple agents or humans need visibility into the same watched condition.
- The watcher needs to outlast the agent session that created it.

**Just run an operation** when:
- One-off check, no long-running watching needed.
- The user is asking for a current state, not a future-looking alarm.

## Monitor types

| Type | What it does | Example |
|------|-------------|---------|
| `threshold` | Triggers when a numeric value crosses a line | "Alert if `account_score < 60` on a tier-A account" |
| `change_detection` | Triggers when a value moves materially | "Alert if `lifecycle_stage` changes for a Customer to anything else" |
| `schedule` | Runs on a cadence regardless of conditions | "Weekly campaign report" |
| `absence` | Triggers when an expected event doesn't happen | "Alert if no sync from HubSpot in 24h" |
| `anomaly` | AI-detected outlier from a baseline | "Alert if reply rate drops 2σ below baseline" |

## Action types

What happens when a monitor fires:

| Action | Effect |
|--------|--------|
| `notify` | Create an Alert with `status=open`. Surfaces in dashboards / inboxes. |
| `escalate` | Create an Alert + create a high-priority Task. Puts work in the queue. |
| `auto_act` | Run the operation named in `action_operation`. The runtime executes it without human intervention (gated by the operation's own DRY_RUN and governance rules). |
| `log_only` | Append to the linked entity's `workspace.updates` array. No alert, no task. Useful for telemetry. |

## Hard rules

- **Monitors must specify their action.** No silent monitors. If you don't know what to do when it triggers, you don't have a monitor — you have a question to answer first.
- **`auto_act` requires the named operation to be `idempotent: true`.** Operations that aren't idempotent must not be auto-triggered — they need a human in the loop. Fail-fast at monitor creation if the operation's metadata says otherwise.
- **Alert deduplication.** Before creating a new alert, check for an open alert with the same `source_monitor_id` + `custom_key_value`. If one exists, update its `message` rather than creating a duplicate. Repeated firing of the same condition increments a counter, not a queue.
- **Acknowledged alerts pause monitor firing for that entity until resolved.** Otherwise a noisy condition produces N alerts the user has to dismiss N times.
- **Critical-severity alerts trigger immediate notification.** Don't batch them. Same speed rules as `meeting-handoff` — within 5 minutes.
- **Retired monitors don't evaluate.** Retire instead of deleting so history is preserved and patterns can be audited.

## Recommended monitors per workspace type

For an **account workspace** (tier A or B):
- Engagement drop (threshold on conversation frequency)
- Score change (change_detection on `account_score`)
- Stakeholder departure (change_detection on champion contact's company)
- Renewal proximity (schedule, 90/60/30 days before renewal)

For a **campaign workspace**:
- Reply-rate dip (anomaly vs. campaign baseline)
- Bounce-rate spike (threshold > 5%)
- Stalled sequence (absence — no progress on N+ contacts in 48h)

For **org-wide**:
- HubSpot/Salesforce sync freshness (absence on last sync > 6h)
- Operation failure rate (anomaly on `operation-runs` failures)
- Opt-out spike (threshold on opt-out rate per day)

## Alert lifecycle

```
open ──ack─→ acknowledged ──resolve─→ resolved
  │              │                        │
  │              └──dismiss─→ dismissed   │
  │                                       │
  └──── expires (after expires_at) ──→ expired
```

- `open` alerts must be ack'd within their severity SLA: critical = 15 min, warning = 4h, info = next-day.
- Dismissed = "noted, not acting". Resolved = "we did something". The distinction matters for monitor tuning.
- Expired alerts indicate either a too-aggressive monitor or an unmonitored channel. Run `optimize.review-runs` to surface these patterns.
