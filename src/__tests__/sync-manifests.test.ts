import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("syncManifests", () => {
  test("module can be imported", async () => {
    // Will fail until sync-manifests.ts exists.
    const { syncManifests } = await import("../core/setup/sync-manifests.js");
    assert.ok(typeof syncManifests === "function", "syncManifests is a function");
  });
});
