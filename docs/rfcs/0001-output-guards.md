# RFC 0001: Output Guards

Status: Proposed
Date: 2026-07-19

## Summary

A deterministic guard layer for generated output. Small pure functions, parameterized by data, applied at one choke point in the operation runner before anything is persisted or written back to a CRM. Guidelines steer generation; guards enforce the rules that must never be broken.

## Motivation

Production experience with AI outreach shows a stable set of failure classes that prompt instructions reduce but do not eliminate: claiming a prospect already uses the vendor's product when they do not, citing stale or future-dated signals, leaking recipient names or unfilled template placeholders, and emitting banned phrases. Each class is cheap to detect deterministically. Enforcement therefore belongs in code, not in prompts, and in the write path, not in an optional after-the-fact audit.

## Non-goals

- No plugin system. The guard set is fixed and small; new guard types arrive by RFC and release, not by user code injection. Customization is data only.
- No statistics engine. A guard fires or it does not.
- No new storage. Guard fires append to the existing operation-run records.
- No behavior change on upgrade. The built-in default mode is off.

## The guard set

| Guard | Detects | Enforce action |
|---|---|---|
| coerce | stray JSON wrappers, code fences around output | rewrite (runs in every mode; malformed output is never acceptable) |
| banned_phrases | configured phrase map | rewrite (replace) |
| ownership | sentences claiming the prospect already uses the vendor product, when ownership is not confirmed | drop sentence |
| name_leak | recipient name where forbidden | rewrite (strip) |
| placeholder_leak | unfilled [BRACKET] tokens | drop sentence |
| test_identity | configured denylist of test identities | note only (audit) |

A separate helper, signal recency filtering (window in months, undated and future-dated entries dropped, kept newest first), is exported for operations that handle structured signal lists.

## Configuration

Plain JSON, versioned:

    {
      "format_version": 1,
      "mode": "off | shadow | enforce",
      "banned_phrases": {"phrase": "replacement"},
      "ownership": {
        "vendor_terms": [],
        "ownership_verbs": [],
        "confirm_pattern": "",
        "negation_cues": []
      },
      "recency_months": 12,
      "forbid_recipient_name": false,
      "test_identity_denylist": []
    }

Resolution order: campaign record, then an org default on the orchestrator config record, then the built-in default (mode off, empty lists). An empty confirm_pattern compiles to match-nothing, so ownership stays unconfirmed unless positively signaled: the fail-safe direction.

## Modes and rollout doctrine

- off: only coercion runs.
- shadow: all guards evaluate and log fires; output is unchanged.
- enforce: guards rewrite or drop as specified above.

Recommended rollout: shadow for a period, review the fires, tune the data, then enforce. Every fire carries provenance: guard name, matched rule, the action taken, and which config layer supplied the rule.

## Audit trail

Fires append to the operation-run record as audit_rewrites entries. No new collection. This feeds tuning during shadow mode and gives operators receipts for what enforcement prevented.

## Choke point and invariant

applyGuards is called in the operation runner immediately before persist and CRM writeback. CI will carry a check that no module outside the runner imports the persist or writeback modules directly, making "all output passes through the guards" an invariant rather than a convention.

## Delivery

1. This RFC.
2. Guards library plus tests and incident-derived fixtures (no wiring, zero behavior change).
3. Runner wiring behind default-off config, audit_rewrites, bypass check.
4. Eval runner with fixture capture; pack format specification and validator.
5. Campaign collection, guideline composition, opt-out enforcement, metering completeness.
