import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { applyDispatchRoutes } from "../core/setup/apply-dispatch-routes.js";

describe("applyDispatchRoutes", () => {
  test("loads the seed manifests and reports a result shape", async (t) => {
    // Uses the actual manifests/core/dispatch-routes/*.json seed files.
    // Full integration (upsert against Personize) requires a live key — excluded from CI.
    if (!process.env.PERSONIZE_SECRET_KEY) {
      t.skip("PERSONIZE_SECRET_KEY not set — skipping integration test");
      return;
    }
    const result = await applyDispatchRoutes(true); // dryRun = true
    assert.ok(typeof result.created === "number", "created is number");
    assert.ok(typeof result.updated === "number", "updated is number");
    assert.ok(typeof result.skipped === "number", "skipped is number");
    assert.ok(Array.isArray(result.details), "details is array");
  });

  test("dry-runs the seed manifests without a live key and never throws", async () => {
    // No PERSONIZE_SECRET_KEY needed: retrieveRecords/setProperties fail soft to
    // empty results without one, so this exercises manifest parsing + the
    // dry-run reporting path against the real manifests/core/dispatch-routes/
    // seed files (CORE_DIR is resolved from process.cwd() at module-import
    // time, same as apply-manifests.ts, so this only reflects the repo's own
    // manifests — not an arbitrary directory).
    const result = await applyDispatchRoutes(true);
    assert.equal(result.created + result.updated + result.skipped, 3, "the 3 seed routes are all accounted for");
    assert.ok(result.details.every((d) => typeof d === "string"), "details are strings");
  });
});
