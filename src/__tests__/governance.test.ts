import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { missingGuidelines } from "../core/lib/governance.js";

describe("missingGuidelines", () => {
  test("empty string value is missing", () => {
    const result = missingGuidelines({ "icp-definition": "" });
    assert.deepEqual(result, ["icp-definition"]);
  });

  test("non-empty value is not missing", () => {
    const result = missingGuidelines({ "brand-voice": "Be concise and confident." });
    assert.deepEqual(result, []);
  });

  test("mix: returns only the empty ones", () => {
    const result = missingGuidelines({
      "icp-definition": "SaaS companies 50-500 employees...",
      "brand-voice": "",
      "outreach-playbook": "Multi-touch sequence...",
      "reply-handling": "",
    });
    assert.deepEqual(result.sort(), ["brand-voice", "reply-handling"].sort());
  });

  test("all present returns empty array", () => {
    const result = missingGuidelines({
      "icp-definition": "content",
      "brand-voice": "content",
    });
    assert.deepEqual(result, []);
  });

  test("all missing returns all names", () => {
    const result = missingGuidelines({ a: "", b: "", c: "" });
    assert.equal(result.length, 3);
  });

  test("empty object returns empty array", () => {
    const result = missingGuidelines({});
    assert.deepEqual(result, []);
  });
});
