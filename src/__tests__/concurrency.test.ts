import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runWithConcurrency } from "../core/lib/concurrency.js";

describe("runWithConcurrency", () => {
  test("returns results in input order regardless of completion order", async () => {
    const items = [30, 10, 20];
    const results = await runWithConcurrency(items, 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms * 2;
    });
    assert.deepEqual(
      results.map((r) => (r.status === "fulfilled" ? r.value : null)),
      [60, 20, 40],
    );
  });

  test("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await runWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    assert.equal(results.length, 20);
    assert.ok(peak <= 4, `peak concurrency ${peak} exceeded limit 4`);
    assert.ok(peak >= 2, `pool did not actually run concurrently (peak ${peak})`);
  });

  test("captures rejections without aborting other items", async () => {
    const results = await runWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      return n;
    });
    assert.equal(results[0].status, "fulfilled");
    assert.equal(results[1].status, "rejected");
    assert.equal(results[2].status, "fulfilled");
    assert.match(String((results[1] as PromiseRejectedResult).reason), /boom/);
  });

  test("handles empty input and clamps a nonsense limit", async () => {
    const empty = await runWithConcurrency([], 5, async () => 1);
    assert.deepEqual(empty, []);

    const clamped = await runWithConcurrency([1, 2], 0, async (n) => n);
    assert.equal(clamped.length, 2);
    assert.equal(clamped[0].status, "fulfilled");
  });
});
