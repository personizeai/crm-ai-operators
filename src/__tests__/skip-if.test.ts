import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseDuration, evaluateSkipIf } from "../core/lib/skip-if.js";

describe("parseDuration", () => {
  test("seconds", () => assert.equal(parseDuration("30s"), 30_000));
  test("minutes", () => assert.equal(parseDuration("5m"), 5 * 60 * 1000));
  test("hours", () => assert.equal(parseDuration("24h"), 24 * 60 * 60 * 1000));
  test("days", () => assert.equal(parseDuration("7d"), 7 * 24 * 60 * 60 * 1000));
  test("weeks", () => assert.equal(parseDuration("2w"), 2 * 7 * 24 * 60 * 60 * 1000));
  test("unknown unit returns 0", () => assert.equal(parseDuration("3x"), 0));
  test("no unit returns 0", () => assert.equal(parseDuration("100"), 0));
  test("empty string returns 0", () => assert.equal(parseDuration(""), 0));
});

describe("evaluateSkipIf — in_states", () => {
  const rule = { property: "lifecycle_stage", in_states: ["Customer", "Disqualified"] };

  test("skips when value is in list", () => {
    const result = evaluateSkipIf(rule, { lifecycle_stage: "Customer" });
    assert.equal(result.skip, true);
    assert.match(result.reason!, /lifecycle_stage=Customer/);
  });

  test("does not skip when value is not in list", () => {
    const result = evaluateSkipIf(rule, { lifecycle_stage: "MQL" });
    assert.equal(result.skip, false);
  });

  test("does not skip when property is absent", () => {
    const result = evaluateSkipIf(rule, {});
    assert.equal(result.skip, false);
  });

  test("does not skip when value is non-string", () => {
    const result = evaluateSkipIf(rule, { lifecycle_stage: 42 });
    assert.equal(result.skip, false);
  });
});

describe("evaluateSkipIf — updated_within", () => {
  const rule = { property: "icp_fit_score", updated_within: "7d" };

  test("skips when _updated_at is recent", () => {
    const recent = new Date(Date.now() - 1_000).toISOString(); // 1 second ago
    const result = evaluateSkipIf(rule, { icp_fit_score_updated_at: recent });
    assert.equal(result.skip, true);
  });

  test("does not skip when _updated_at is older than window", () => {
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(); // 8 days ago
    const result = evaluateSkipIf(rule, { icp_fit_score_updated_at: old });
    assert.equal(result.skip, false);
  });

  test("does not skip when _updated_at is missing", () => {
    const result = evaluateSkipIf(rule, { icp_fit_score: 82 });
    assert.equal(result.skip, false);
  });

  test("camelCase key is also accepted", () => {
    const recent = new Date(Date.now() - 1_000).toISOString();
    const result = evaluateSkipIf(rule, { icp_fit_scoreUpdatedAt: recent });
    assert.equal(result.skip, true);
  });
});
