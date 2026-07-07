# Contributing

## Philosophy

This repo is a **pattern library**, not a framework. Every operation is a standalone file. Adding one operation never touches another. Keep that invariant.

## Adding an operation

### 1. Create the implementation file

```
src/core/operations/impl/<category>-<name>.ts
```

Export a single `OperationEntry` object. Start as a scaffold — that's enough for the agent to discover it and the agent to know what it would do.

```ts
import type { OperationEntry } from "../types.js";
import { buildScaffold } from "../helpers.js";

export const myOperation: OperationEntry = {
  name: "category.my-operation",     // dot-separated: category.verb
  mode: "operation",
  description: "One sentence. What it does and why.",
  category: "category",              // setup | sync | research | score | generate | analyze | act | optimize
  status: "scaffold",                // scaffold | live | idea
  idempotent: true,                  // re-running produces same result?
  cost: "medium",                    // low | medium | high
  run_mode: "on-trigger",            // always | on-trigger | on-decision | manual
  guidelines_required: ["my-guideline"],
  run: async (input, context) =>
    buildScaffold(
      "category.my-operation",
      "One sentence intent.",
      context,
      {
        would_read_from: ["personize.contacts", "personize.context (my-guideline)"],
        would_write_to: ["contacts.my_field", "contacts.workspace.updates (type='change')"],
        governance_required: ["my-guideline"],
        estimated_cost: "medium",
      },
      input,
      [
        "Step 1: filter contacts with …",
        "Step 2: call aiPrompt with schema …",
        "Step 3: write back via memory.updateProperty …",
      ],
    ),
};
```

### 2. Register it

Add one import line to `src/core/operations/registry.ts`:

```ts
import { myOperation } from "./impl/category-my-operation.js";
```

And add it to the `ALL` array in the same file. That's it — the CLI and MCP discover it automatically.

### 3. Verify

```bash
npm run operation:list       # should show your operation
npm run typecheck            # must pass clean
npm test                     # must pass
```

### 4. Converting a scaffold to live

The scaffold's `next_steps_to_make_live` array is your checklist. Replace the `buildScaffold(...)` call with the real algorithm; keep all metadata fields identical. Update `status: "live"` and update `docs/CAPABILITY-MENU.md`.

---

## Status conventions

| Status | Meaning | When to use |
|--------|---------|-------------|
| `live` | Real algorithm, makes real changes (gated by `DRY_RUN`). | When the full algorithm is implemented and tested. |
| `scaffold` | Returns a rehearsal envelope describing what it would do. | When the shape is known but implementation is pending. |
| `idea` | Description-only, no execution logic. | Early placeholder — avoid, prefer scaffold. |

## Cost conventions

| Cost | Rule of thumb |
|------|---------------|
| `low` | No LLM calls. At most a few API reads. |
| `medium` | One LLM call, or 10-500 records with lightweight processing. |
| `high` | Multiple LLM calls, or large fan-out (1000+ records), or long-form generation. |

## Run mode conventions

| Run mode | When the operation should run |
|----------|-------------------------------|
| `always` | On a cron schedule (e.g., hourly sync). |
| `on-trigger` | When a CRM event fires (new contact, engagement logged). |
| `on-decision` | The agent decides to run it based on context. |
| `manual` | Only when explicitly requested by a human. |

## Guidelines

Guidelines live in `manifests/core/guidelines/`. If your operation requires a new guideline, add it there and reference it in `guidelines_required`. The agent checks for missing guidelines before executing.

## Code style

- TypeScript strict mode. No `any` unless the SDK surface is genuinely unknown — wrap with a comment.
- Every public function is typed. No implicit `any` from parameters.
- No comments that explain *what* code does — good names do that. Comments explain *why* when non-obvious.
- `workspace.appendUpdate` is mandatory for every operation that writes a property. That's the audit trail.

## Pull requests

- One operation per PR is easiest to review.
- Run `npm run typecheck && npm test` before pushing.
- Update `docs/CAPABILITY-MENU.md` status summary if you change a status.

## Reporting issues

Open a GitHub issue. For security vulnerabilities, see [docs/SECURITY.md](docs/SECURITY.md).
