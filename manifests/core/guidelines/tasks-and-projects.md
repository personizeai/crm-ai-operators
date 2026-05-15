---
name: tasks-and-projects
tags: [tasks, projects, workspace, routing, autonomy]
---

# Tasks and Projects

> Tasks are first-class entities, not arrays on contacts. Projects are workspaces that group tasks, conversations, and signals into a coherent unit of work.

## When to create a task vs. just acting

**Create a task** when:
- The work needs to happen later (scheduled, queued, or pending an external event).
- The work needs to be visible to other agents or humans before it executes.
- The work requires approval or human review before running (e.g. high-stakes outreach drafts).
- You're building a queue an operator will consume later.

**Just act** when:
- The work is the immediate execution of the current operation.
- No queueing, no approval gate, no cross-agent visibility needed.

A task that's created and immediately executed in the same agent turn is a sign of overuse — you're adding a record without the queueing benefit.

## Task type → operation routing

The `task_type` field tells the runtime which operation should pick the task up.

| `task_type` | Routed operation category | Typical executor |
|-------------|---------------------------|------------------|
| `send-email` | `generate.outreach-sequence` then `act.send-email` | `agent` |
| `classify-reply` | `analyze.reply-sentiment` | `agent` |
| `enrich-contact` | `research.contact-background` | `research-agent` |
| `research` | `research.account-deep-dive` or `research.contact-background` | `research-agent` |
| `score` | `score.icp-fit` or `score.lead-quality` | `agent` |
| `follow-up` | `generate.follow-up` then `act.send-email` | `agent` |
| `meeting-request` | `act.notify-rep-handoff` (per `meeting-handoff` guideline) | `human:<rep>` |
| `review` | (no automatic execution) — surfaced to assignee | `human:<assignee>` |
| `approve` | (no automatic execution) — surfaced to approver | `human:<approver>` |
| `publish` | `act.publish-content` | `agent` |
| `log-activity` | `act.append-workspace-update` | `agent` or `system` |
| `notify-rep` | `act.notify-rep-handoff` | `agent` |
| `other` | (no routing) — assignee handles directly | varies |

When an operation creates a task it cannot itself execute, leave `assigned_to` open and let the runtime route by `task_type`.

## Linking tasks

Every task should set:
- `custom_key_name` + `custom_key_value` — links the task to a contact, company, or project.
- `project` — the workspace the task belongs to (when applicable).

Examples:
- Task on contact: `custom_key_name='email', custom_key_value='alice@acme.com'`
- Task on company: `custom_key_name='website_url', custom_key_value='acme.com'`
- Task on project: `custom_key_name='name', custom_key_value='Q2 Manufacturing Outreach'`

## Finding work — the agent's task pull pattern

```
memory_filter_by_property(
  type='task',
  conditions=[
    { propertyName: 'status', operator: 'equals', value: 'open' },
    { propertyName: 'assigned_to', operator: 'equals', value: 'agent' }
  ],
  logic='AND'
)
```

Then sort by `priority` desc, `due_date` asc.

## Completing tasks

When done:
1. Set `status` to `done`, `cancelled`, or `declined`.
2. Set `completed_at` (ISO timestamp) and `completed_by`.
3. Write a one-sentence `outcome`.
4. Append a corresponding entry to the linked entity's `workspace.updates` (per `activity-logging`).
5. If the work produced new tasks (follow-ups, escalations), create them now with the right `created_by` reference.

## Project workspaces

Use a project when:
- A campaign or initiative spans multiple contacts/companies and multiple tasks over days/weeks.
- You need a single audit trail across many entities.
- A report (weekly summary, campaign performance) needs to roll up across the work.

Don't create a project for:
- A single one-off task.
- A single conversation.
- An individual contact's lifecycle (the contact record is the workspace there).

## Project ↔ task ↔ entity relationship

```
Project (Q2 Manufacturing Outreach)
    │
    ├── Tasks (filtered by project='Q2 Manufacturing Outreach')
    │       │
    │       ├── send-email tasks linked to contacts
    │       ├── classify-reply tasks linked to contacts
    │       └── notify-rep tasks linked to specific replies
    │
    ├── Conversations (filtered by campaign_id matching the project)
    └── Signals (filtered by campaign_id when applicable)
```

The project's `messages_sent`, `reports`, `decisions`, and `updates` are the campaign's living audit. Per-contact engagement still lives on the contact record.

## Hard rules

- **Don't duplicate work.** Before creating a task, check `memory_filter_by_property` for existing open tasks with the same title + linked entity. If one exists, append context to its `notes` instead.
- **Closed tasks stay closed.** When `status` is `done`, `cancelled`, or `declined`, the task is immutable. Reopening means creating a new task with `created_by` referencing the original `task_id`.
- **Decline with reason.** A declined task must have an `outcome` explaining why. "No LinkedIn access — escalated to sales rep" is acceptable; an empty decline is not.
- **No tasks for opted-out contacts.** Check `opted_out` before any task creation that would touch the contact.
