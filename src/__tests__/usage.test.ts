import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { withUsageSink, reportUsage, getUsageTotals } from "../core/lib/usage.js";

describe("usage telemetry", () => {
  test("accumulates credits, tokens, and call count within a sink", async () => {
    const totals = await withUsageSink(async () => {
      reportUsage({ credits: 3, tokens: 100 });
      reportUsage({ credits: 1, tokens: 50 });
      return getUsageTotals();
    });
    assert.deepEqual(totals, { credits: 4, tokens: 150, aiCalls: 2 });
  });

  test("reportUsage outside a sink is a no-op (no throw)", () => {
    assert.doesNotThrow(() => reportUsage({ credits: 5, tokens: 10 }));
    assert.equal(getUsageTotals(), undefined);
  });

  test("concurrent sinks accumulate independently — no cross-run attribution", async () => {
    // Two runs interleaved: each must only see its own usage.
    const [a, b] = await Promise.all([
      withUsageSink(async () => {
        reportUsage({ credits: 10, tokens: 0 });
        await new Promise((r) => setTimeout(r, 10));
        reportUsage({ credits: 10, tokens: 0 });
        return getUsageTotals();
      }),
      withUsageSink(async () => {
        reportUsage({ credits: 1, tokens: 0 });
        await new Promise((r) => setTimeout(r, 5));
        reportUsage({ credits: 1, tokens: 0 });
        return getUsageTotals();
      }),
    ]);
    assert.equal(a?.credits, 20);
    assert.equal(b?.credits, 2);
  });

  test("missing usage fields default to zero", async () => {
    const totals = await withUsageSink(async () => {
      reportUsage({});
      return getUsageTotals();
    });
    assert.deepEqual(totals, { credits: 0, tokens: 0, aiCalls: 1 });
  });
});
