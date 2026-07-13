import type { AcceptanceGate } from "../operations/types.js";

/**
 * Acceptance evaluation — the "completion is not success" check.
 *
 * The reference paper argues the honest unit of AI work is the *accepted* output,
 * not the completed one (a completed output can still fail schema, lack evidence,
 * or be low-confidence). This module is the minimal, deterministic reference
 * implementation of that gate. It is not the full acceptance framework — richer
 * checks (prohibited claims, evidence coverage, evaluator models, human sampling)
 * are future infrastructure, per docs/MATURITY.md.
 */

/** The facts about one produced output that a gate reasons over. */
export interface AcceptanceInput {
  /** Did the output parse against its declared schema? Absent = treated as valid. */
  schema_valid?: boolean;
  /** The output's evidence / reason text, if any. */
  evidence?: string | null;
  /** The output's self-reported confidence in [0,1], if any. */
  confidence?: number | null;
}

export interface AcceptanceResult {
  accepted: boolean;
  /** Machine-readable rejection reason codes; empty when accepted. */
  reasons: string[];
}

/** Minimum length for an evidence string to count as substantive, not a stub. */
const MIN_EVIDENCE_CHARS = 20;

/**
 * Evaluate one produced output against a gate. Deterministic and side-effect
 * free. Returns `accepted: true` only when every declared check passes.
 */
export function evaluateAcceptance(gate: AcceptanceGate, item: AcceptanceInput): AcceptanceResult {
  const reasons: string[] = [];

  if (gate.schema_valid && item.schema_valid === false) {
    reasons.push("schema_invalid");
  }

  if (gate.evidence_required) {
    const evidence = typeof item.evidence === "string" ? item.evidence.trim() : "";
    if (evidence.length === 0) {
      reasons.push("missing_evidence");
    } else if (evidence.length < MIN_EVIDENCE_CHARS) {
      reasons.push("insufficient_evidence");
    }
  }

  if (typeof gate.minimum_confidence === "number") {
    const confidence = typeof item.confidence === "number" ? item.confidence : 0;
    if (confidence < gate.minimum_confidence) {
      reasons.push("below_min_confidence");
    }
  }

  return { accepted: reasons.length === 0, reasons };
}

/**
 * Running tally of acceptance across the records an operation processes.
 * `attempted` counts outputs that were produced and evaluated (not skipped, not
 * errored). `accepted + rejected === attempted`.
 */
export interface AcceptanceTally {
  attempted: number;
  accepted: number;
  rejected: number;
  /** Count of each rejection reason code seen. */
  rejection_reasons: Record<string, number>;
}

export function newTally(): AcceptanceTally {
  return { attempted: 0, accepted: 0, rejected: 0, rejection_reasons: {} };
}

/** Fold one evaluation into the tally. */
export function recordAcceptance(tally: AcceptanceTally, result: AcceptanceResult): void {
  tally.attempted += 1;
  if (result.accepted) {
    tally.accepted += 1;
    return;
  }
  tally.rejected += 1;
  for (const reason of result.reasons) {
    tally.rejection_reasons[reason] = (tally.rejection_reasons[reason] ?? 0) + 1;
  }
}
