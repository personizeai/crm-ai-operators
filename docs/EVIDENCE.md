# Evidence and claims discipline

This repository is promoted alongside a reference paper that holds every
quantitative claim to a stated evidence tier. The repo's own public copy
(README, docs) follows the same discipline. This file is the register: if a
number appears in the README, it must be classified here with its method, or it
does not ship.

## Tiers

- **Measured** — produced by one of our own experiments or systems. The workload
  and boundary stay attached to the number. A compaction ratio is not an
  accuracy score; a retrieval result is not a revenue result.
- **Benchmarked** — reported by an external organization, linked to a primary
  source. Not restated as a CRM production result.
- **Modeled** — calculated from printed assumptions. Changing the assumptions
  changes the result. Always labeled as such.
- **Publication hold** — informed earlier drafts but excluded from public claims
  until its source or method is complete.

Categories must not be blended into one universal percentage. Provider discounts,
model-tier savings, token reductions, accuracy, latency, labor reduction, and
revenue outcomes are separate quantities and may be combined only inside one
end-to-end experiment with a shared baseline and an explicit composition method.

## Claims allowed in this repository's public copy

The README describes an architecture and a working reference implementation. It
does **not** assert Personize savings percentages, FTE-equivalent offsets, or
customer outcomes, because those are not measured here. Specifically:

| Claim previously in README | Status | Treatment |
|---|---|---|
| "up to 88% lower cost" | Removed | A model-tier/batch modeling result belongs in the paper with printed assumptions, not as a headline. |
| "replaces 2–3 RevOps hours per day" | Removed / qualified | Illustrative, not measured. Framed as a modeled scenario if kept at all. |
| "offsets 5–10 FTE-equivalent" / "customers report…" | Removed | No measured customer outcome exists to support it. |
| "production-ready" (unqualified) | Replaced | See [MATURITY.md](./MATURITY.md): this is a 0.x evolving reference implementation. |
| "29 operations" | Generated | Sourced from [OPERATIONS.generated.md](./OPERATIONS.generated.md) via `npm run docs:operations`, not hand-typed. |

## The one metric this repo does assert

Cost per accepted unit is the honest unit of AI operation cost:

> model spend + tools + retrieval + memory + infrastructure + retries + review +
> rework, divided by outputs that pass the acceptance gate.

The repository makes this **inspectable**, not proven: operations that declare an
acceptance gate report `attempted` / `accepted` / `rejected` (not just
completions), and those counts persist on durable run records. See the reference
acceptance gate in `src/core/lib/acceptance.ts` and `score.icp-fit`. This is a
minimal deterministic gate — see [MATURITY.md](./MATURITY.md) for what is and is
not yet built.

## Rule

Any new public number added to this repo must land in the table above with a tier
and a method, or be routed to the paper's evidence appendix. No unclassified
percentages.
