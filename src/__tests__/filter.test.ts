import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { compileFilter } from "../core/lib/filter.js";

describe("compileFilter", () => {
  test("simple equality produces equals operator", () => {
    const result = compileFilter({
      collection: "contacts",
      where: { lifecycle_stage: "MQL" },
    });
    assert.equal(result.collection, "contacts");
    assert.equal(result.conditions.length, 1);
    assert.deepEqual(result.conditions[0], {
      propertyName: "lifecycle_stage",
      operator: "equals",
      value: "MQL",
    });
  });

  test("null value produces equals operator with null", () => {
    const result = compileFilter({
      collection: "contacts",
      where: { buying_stage: null },
    });
    assert.deepEqual(result.conditions[0], {
      propertyName: "buying_stage",
      operator: "equals",
      value: null,
    });
  });

  test("gte operator maps correctly", () => {
    const result = compileFilter({
      collection: "contacts",
      where: { ai_score: { gte: 70 } },
    });
    assert.deepEqual(result.conditions[0], {
      propertyName: "ai_score",
      operator: "gte",
      value: 70,
    });
  });

  test("contains operator maps correctly", () => {
    const result = compileFilter({
      collection: "contacts",
      where: { job_title: { contains: "VP" } },
    });
    assert.deepEqual(result.conditions[0], {
      propertyName: "job_title",
      operator: "contains",
      value: "VP",
    });
  });

  test("in operator carries an array value", () => {
    const result = compileFilter({
      collection: "companies",
      where: { domain: { in: ["a.com", "b.com"] } },
    });
    assert.deepEqual(result.conditions[0], {
      propertyName: "domain",
      operator: "in",
      value: ["a.com", "b.com"],
    });
  });

  test("not_in operator carries an array value", () => {
    const result = compileFilter({
      collection: "companies",
      where: { lifecycle_stage: { not_in: ["Customer", "Disqualified"] } },
    });
    assert.deepEqual(result.conditions[0], {
      propertyName: "lifecycle_stage",
      operator: "not_in",
      value: ["Customer", "Disqualified"],
    });
  });

  test("neq operator maps to notEquals", () => {
    const result = compileFilter({
      collection: "contacts",
      where: { lifecycle_stage: { neq: "Customer" } },
    });
    assert.equal(result.conditions[0]!.operator, "notEquals");
  });

  test("is_empty operator maps to isEmpty", () => {
    const result = compileFilter({
      collection: "contacts",
      where: { email: { is_empty: true } },
    });
    assert.equal(result.conditions[0]!.operator, "isEmpty");
  });

  test("multiple conditions produces AND with all conditions", () => {
    const result = compileFilter({
      collection: "contacts",
      where: {
        lifecycle_stage: "MQL",
        ai_score: { gte: 70 },
      },
    });
    assert.equal(result.logic, "AND");
    assert.equal(result.conditions.length, 2);
  });

  test("defaults limit to 100", () => {
    const result = compileFilter({ collection: "contacts" });
    assert.equal(result.limit, 100);
  });

  test("respects explicit limit", () => {
    const result = compileFilter({ collection: "contacts", limit: 25 });
    assert.equal(result.limit, 25);
  });

  test("empty where clause produces no conditions", () => {
    const result = compileFilter({ collection: "contacts", where: {} });
    assert.equal(result.conditions.length, 0);
  });

  test("unknown operator throws", () => {
    assert.throws(
      () =>
        compileFilter({
          collection: "contacts",
          where: { field: { unknown_op: "x" } as any },
        }),
      /Unknown filter operator/,
    );
  });
});
