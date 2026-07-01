import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("dispatcher", () => {
  test("module exports dispatch function", async () => {
    const mod = await import("../core/engine/dispatcher.js").catch(() => null);
    assert.ok(mod !== null, "dispatcher module must exist");
    assert.ok(typeof (mod as any)?.dispatch === "function", "dispatch must be a function");
  });
});
