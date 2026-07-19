# Changelog

## Unreleased

### Added

- Deterministic output guards library (`src/core/lib/guards.ts`, RFC 0001): config-driven banned-phrase scrub, negation-aware ownership-claim guard, recipient-name and placeholder leak guards, test-identity audit notes, signal recency filter, and output coercion, with off/shadow/enforce modes and per-fire provenance. Not yet wired into the operation runner; no behavior change.
