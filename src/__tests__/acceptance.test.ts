import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateAcceptance,
  newTally,
  recordAcceptance,
} from "../core/lib/acceptance.js";
import type { AcceptanceGate } from "../core/operations/types.js";

describe("evaluateAcceptance", () => {
  test("empty gate accepts anything", () => {
    const result = evaluateAcceptance({}, {});
    assert.equal(result.accepted, true);
    assert.deepEqual(result.reasons, []);
  });

  test("schema_valid gate rejects invalid schema", () => {
    const gate: AcceptanceGate = { schema_valid: true };
    assert.equal(evaluateAcceptance(gate, { schema_valid: true }).accepted, true);
    const bad = evaluateAcceptance(gate, { schema_valid: false });
    assert.equal(bad.accepted, false);
    assert.deepEqual(bad.reasons, ["schema_invalid"]);
  });

  test("schema_valid treats absent flag as valid", () => {
    assert.equal(evaluateAcceptance({ schema_valid: true }, {}).accepted, true);
  });

  test("evidence_required rejects empty and stub evidence", () => {
    const gate: AcceptanceGate = { evidence_required: true };
    assert.deepEqual(evaluateAcceptance(gate, { evidence: "" }).reasons, ["missing_evidence"]);
    assert.deepEqual(evaluateAcceptance(gate, { evidence: null }).reasons, ["missing_evidence"]);
    assert.deepEqual(evaluateAcceptance(gate, { evidence: "too short" }).reasons, [
      "insufficient_evidence",
    ]);
    assert.equal(
      evaluateAcceptance(gate, { evidence: "VP title, 500+ employees, recent pricing visit" })
        .accepted,
      true,
    );
  });

  test("minimum_confidence rejects below threshold, absent confidence is zero", () => {
    const gate: AcceptanceGate = { minimum_confidence: 0.7 };
    assert.equal(evaluateAcceptance(gate, { confidence: 0.9 }).accepted, true);
    assert.deepEqual(evaluateAcceptance(gate, { confidence: 0.5 }).reasons, ["below_min_confidence"]);
    assert.deepEqual(evaluateAcceptance(gate, {}).reasons, ["below_min_confidence"]);
  });

  test("multiple failing checks accumulate reasons", () => {
    const gate: AcceptanceGate = { schema_valid: true, evidence_required: true, minimum_confidence: 0.8 };
    const result = evaluateAcceptance(gate, { schema_valid: false, evidence: "", confidence: 0.1 });
    assert.equal(result.accepted, false);
    assert.deepEqual(result.reasons.sort(), ["below_min_confidence", "missing_evidence", "schema_invalid"]);
  });
});

describe("acceptance tally", () => {
  test("attempted equals accepted plus rejected; reasons counted", () => {
    const gate: AcceptanceGate = { evidence_required: true };
    const tally = newTally();
    recordAcceptance(tally, evaluateAcceptance(gate, { evidence: "a substantive, cited reason here" }));
    recordAcceptance(tally, evaluateAcceptance(gate, { evidence: "" }));
    recordAcceptance(tally, evaluateAcceptance(gate, { evidence: "short" }));

    assert.equal(tally.attempted, 3);
    assert.equal(tally.accepted, 1);
    assert.equal(tally.rejected, 2);
    assert.equal(tally.attempted, tally.accepted + tally.rejected);
    assert.equal(tally.rejection_reasons["missing_evidence"], 1);
    assert.equal(tally.rejection_reasons["insufficient_evidence"], 1);
  });
});
