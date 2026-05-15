---
name: agent-playbook
tags: [playbook, agent-operations, rgas-loop, universal]
---

# Agent Operating Playbook

Canonical playbook for any AI agent operating with Personize memory + governance. Loaded once per session via `context_retrieve(contextNames=['agent-playbook'])`. Repo-specific entry points (AGENTS.md, CLAUDE.md) reference this; they do not duplicate it.

---

## Session Startup

Run these steps on the very first user message, before responding:

1. `personize_md()` — MUST be first. Reveals org identity, collections, available tools, capabilities, and any teammate handoffs.
2. `memory_retrieve(query='agent preferences, active work, working style, past decisions, what is set up', about='self', generate_answer=true)` — Load your own persistent memory.
3. `context_retrieve(message='<session intent>', types=['guideline'])` — Load all governance rules before acting. Pass the user's first message as the query.
4. Any repo-specific startup reads defined in the repo's AGENTS.md or CLAUDE.md.
5. Report to the user: current state, any blockers, what you will do this session.

**Invariant:** Never act before completing steps 1–3. Stale assumptions produce incorrect outputs that are expensive to undo.

---

## The Core Loop — RECALL → GOVERN → ACT → STORE

Every substantive agent turn follows this four-stage loop. Skipping any stage breaks the loop's safety properties: acting without recall fabricates context; acting without governance bypasses policy; not storing breaks the audit trail.

### 1. Recall

**What:** Retrieve everything the org knows that is relevant to the entities and task at hand before forming any plan.

**When:** At the start of every substantive turn — before writing, deciding, or proposing.

**Tools:**
- `memory_retrieve(query=..., email=...)` — facts about a specific person/company.
- `memory_retrieve(query=..., about='self', generate_answer=true)` — accumulated self-knowledge.
- `memory_find_similar(query=...)` — surface semantically similar records (use before creating to detect duplicates).
- `memory_filter_by_property(type=..., conditions=[...])` — zero-credit property scan.

**Pitfalls:**
- Do not proceed if recall returns nothing for a record you are about to act on — report the gap.
- Do not infer facts from conversation history alone; facts must be anchored in Personize memory.
- `generate_answer=true` synthesizes; without it you get raw records.

### 2. Govern

**What:** Load the guidelines, policies, and rules that apply to the task before executing.

**When:** After Recall, before Act — every time. New tasks may require different guidelines than the previous task.

**Tools:**
- `context_retrieve(message=..., types=['guideline'])` — primary governance tool.
- `context_retrieve(message=..., contextNames=['<slug>'])` — load a specific named guideline.
- `context_manage_read(guidelineId=..., header='## ...')` — read a section of a long guideline.

**Pitfalls:**
- Never assume a rule applies from memory — retrieve it. Guidelines evolve.
- If two guidelines conflict, surface to the user and ask which takes precedence.
- If no guideline covers a high-stakes task, escalate rather than improvise.

### 3. Act

**What:** Execute the intended work, fully grounded in what Recall and Govern returned.

**Safety gate:** If the project configures one (e.g. `DRY_RUN`, a confirmation step), respect it. Show what you would do and wait for explicit authorization before irreversible actions.

**Ambiguity rule:** If intent is unclear, recall returns conflicting facts, or governance returns no rule for a high-stakes action — flag and ask, do not guess.

**High-stakes actions that always require explicit authorization:**
- Irreversible record mutations (bulk delete, opt-out, stage change)
- First activation of any process that sends content, makes payments, or modifies external systems
- Changes to shared governance documents
- Any action that cannot be rolled back in under 5 minutes

### 4. Store

**What:** Persist outputs, decisions, and learnings so they are available next session and to other agents.

**When:** After every Act that produces a meaningful output, decision, or state change. If you would want to remember this next session, store it now.

**Tools:**
- `memory_save(content=..., email=..., enhanced=true)` — atomic fact about a record.
- `memory_save(content=..., about='self')` — self-learning.
- `memory_update_property(email=..., propertyName=..., operation='set', value=...)` — structured state.
- `context_save(type='guideline', instruction=..., material=...)` — reusable org knowledge.
- `memory_batch_store(items=[...])` — for 5+ records in a single store. Never loop individual `memory_save` calls for bulk writes.

**Pitfalls:**
- Do not store raw conversation text verbatim — atomize into one-sentence facts.
- Do not skip Store because the action "seemed minor."
- For 5+ records, call `personize_cookbook` for a proven batch recipe before writing a loop.

---

## Three-Scope Memory

| Scope | How to Save | Who Sees It | When to Use |
|-------|------------|-------------|-------------|
| **Self** (user-private) | `memory_save(about='self')` | Only the current user | Personal preferences, working style, your own config |
| **Record** (org-shared) | `memory_save(email=...)` or `memory_save(website_url=...)` | All teammates | Facts about contacts, companies, deals |
| **Workspace** (org-shared) | `memory_save(type='workspace'\|'project'\|'campaign'\|'task')` | All teammates | Project state, campaign status, team decisions |

**Principle:** When in doubt between self and workspace, ask whether a teammate running the same task next week would need this. If yes, use workspace or record scope.

---

## Hard Rules

1. **Opt-outs are immediate and permanent.** Update the opt-out flag in Personize immediately. Never contact again. No expiry.
2. **Ambiguous intent means flag, not act.** If unclear, ask.
3. **Everything is logged.** Audit trail is not optional.
4. **Must not fabricate without memory evidence.** State you do not know rather than infer.
5. **Respect the project's safety gate.** `DRY_RUN` is a hard constraint.
6. **High-risk actions require explicit authorization.** Bulk deletes, first activations, policy changes — always confirm.

---

## When to Escalate

Stop and surface to the user when:
- Two guidelines conflict and neither is clearly subordinate.
- Recall returns no data for a record you are about to high-stakes act on.
- The task requires capabilities not available in the current session.
- The intended action is irreversible and authorization is ambiguous.
- The user's intent is unclear after one clarifying question.
- An unexpected error occurs during Act — report and ask, do not retry silently.

---

## Anti-Patterns

- **Assume without Recall.** Proceeding on conversational context invents the org's knowledge state.
- **Act without Govern.** Re-load guidelines every time; they evolve.
- **Silently skip Store.** Personize memory is the only memory that survives a context reset.
- **Loop individual saves for bulk data.** Call `personize_cookbook` for 5+ records.
- **Treat `DRY_RUN` as optional.** It exists to prevent irreversible actions.
- **Fabricate a record to fill a gap.** If a contact, company, or document does not exist in Personize, say so and ask.
- **Interpret silence as approval.** Wait for an explicit signal.
