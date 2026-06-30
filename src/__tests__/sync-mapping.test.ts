import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveMaxRecords, resolveMappingMode } from "../core/operations/impl/crm-sync-core.js";

describe("resolveMaxRecords", () => {
  test("accepts a positive integer", () => assert.equal(resolveMaxRecords(50), 50));
  test("coerces a numeric string", () => assert.equal(resolveMaxRecords("25"), 25));
  test("rejects zero", () => assert.equal(resolveMaxRecords(0), undefined));
  test("rejects negatives", () => assert.equal(resolveMaxRecords(-5), undefined));
  test("rejects non-integers", () => assert.equal(resolveMaxRecords(2.5), undefined));
  test("rejects garbage", () => assert.equal(resolveMaxRecords("abc"), undefined));
  test("undefined stays undefined", () => assert.equal(resolveMaxRecords(undefined), undefined));
});

describe("resolveMappingMode", () => {
  test("honors an explicit template request", () =>
    assert.equal(resolveMappingMode("template", "hubspot"), "template"));
  test("honors an explicit ai request", () =>
    assert.equal(resolveMappingMode("ai", "salesforce"), "ai"));
  test("honors an explicit auto request", () =>
    assert.equal(resolveMappingMode("auto", "apollo"), "auto"));
  test("defaults template-less providers (apollo) to ai", () =>
    assert.equal(resolveMappingMode(undefined, "apollo"), "ai"));
  test("defaults apollo-oauth to ai", () =>
    assert.equal(resolveMappingMode(undefined, "apollo-oauth"), "ai"));
  test("defaults template-backed providers to auto", () =>
    assert.equal(resolveMappingMode(undefined, "hubspot"), "auto"));
  test("ignores an invalid mode and falls back to the provider default", () =>
    assert.equal(resolveMappingMode("nonsense", "salesforce"), "auto"));
});
