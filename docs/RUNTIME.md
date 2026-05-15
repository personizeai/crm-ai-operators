# Setup, Operation, And Optimization Runtime

This repo runs in three modes.

## Setup Mode

Setup mode creates or updates the operating surface:

- Personize collections
- entity properties
- governance guidelines
- CRM custom properties
- CRM-to-Personize mappings

Initial command:

```bash
npm run setup -- --crm hubspot
```

`DRY_RUN=true` is the default. A dry run reports what would be created without mutating the runtime.

The `--crm` flag selects which CRM-specific manifests apply on top of `manifests/core/`. Omit it to apply only the CRM-independent core.

## Operation Mode

Operation mode runs bounded work, logs the run, and stops.

Examples:

```bash
npm run operation:list
npm run pipeline -- crm.sync-core --crm hubspot --input '{"since":"1d"}'
```

Operation mode is for batch work such as CRM sync, AI property backfill, scoring, win-back scans, proposal generation, and safe writeback.

## Optimization Mode

Optimization mode reviews outcomes and proposes changes to schemas, guidelines, prompts, plays, mappings, and operations. It is the loop that lets humans and agents improve the system between runs.

## Runtime Invariants

- `DRY_RUN=true` unless explicitly disabled.
- All runnable work is registered in `src/core/operations/registry.ts`.
- MCP and CLI both call the same operation runner.
- Every run writes an audit event to `data/audit/*.jsonl`.
- CRM access flows through `src/adapters/{hubspot,salesforce}/adapter.ts` — never via raw `fetch` against CRM endpoints.
