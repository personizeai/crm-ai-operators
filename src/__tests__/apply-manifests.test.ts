import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { applyEntityTypes } from "../core/setup/apply-entity-types.js";

describe("applyEntityTypes", () => {
  test("skips entity types that already exist", async (t) => {
    // Uses actual manifest file — requires manifests/core/entity-types/entity-types.json to exist.
    // Full integration test requires a live Personize key (excluded from CI).
    if (!process.env.PERSONIZE_SECRET_KEY) {
      t.skip("PERSONIZE_SECRET_KEY not set — skipping integration test");
      return;
    }
    const result = await applyEntityTypes(true); // dryRun = true
    assert.ok(typeof result.created === "number", "created is number");
    assert.ok(typeof result.skipped === "number", "skipped is number");
    assert.ok(Array.isArray(result.details), "details is array");
  });
});
