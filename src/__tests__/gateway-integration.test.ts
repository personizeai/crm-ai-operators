import { test, describe } from "node:test";
import assert from "node:assert/strict";

// End-to-end smoke test against a live Personize Private gateway.
// Skips unless PERSONIZE_GATEWAY_URL is set (same gate pattern as the hosted
// integration test). Run it to validate the gateway shim's real response shapes:
//
//   PERSONIZE_MODE=private PERSONIZE_GATEWAY_URL=http://localhost:3000 \
//     PERSONIZE_GATEWAY_KEY=... npm test
//
// A local gateway is provided in docker-compose.gateway.yml.
describe("gateway integration (private mode)", () => {
  const url = process.env.PERSONIZE_GATEWAY_URL;
  const key = process.env.PERSONIZE_GATEWAY_KEY;

  test("health + capability probe against a live gateway", async (t) => {
    if (!url || !key) {
      t.skip("PERSONIZE_GATEWAY_URL not set — skipping live gateway integration test");
      return;
    }

    const { createGatewayClient } = await import("../core/lib/gateway-client.js");
    const client = createGatewayClient({ baseUrl: url, apiKey: key });

    // me() should resolve an identity from /whoami.
    const me = await client.me();
    assert.ok(me, "me() returned a value");

    // collections.list() should return the { data: [...] } envelope callers read.
    const collections = await client.collections.list();
    assert.ok(Array.isArray(collections.data), "collections.list().data is an array");

    // A filter query should return the { records, pagination } shape recall.ts reads.
    const res = await client.retrieve({ mode: "filter", filters: { crmFilter: { type: "contact" }, pageSize: 1 } });
    assert.ok(Array.isArray(res.records), "retrieve().records is an array");
    assert.ok(res.pagination && typeof res.pagination.totalMatched === "number", "pagination present");
  });
});
