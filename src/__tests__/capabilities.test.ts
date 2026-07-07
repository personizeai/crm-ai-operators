import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  OPERATIONS,
  isOperationAvailable,
  unavailableOperations,
} from "../core/operations/registry.js";
import { createGatewayClient } from "../core/lib/gateway-client.js";

describe("capability gating (registry)", () => {
  const allTrue = () => true;
  const noSubagent = (cap: string) => cap !== "subagent";

  test("operations with no requires run on any backend", () => {
    const op = OPERATIONS["score.icp-fit"];
    assert.ok(op);
    assert.equal(isOperationAvailable(op, allTrue), true);
    assert.equal(isOperationAvailable(op, noSubagent), true);
  });

  test("subagent-requiring operations are unavailable without the capability", () => {
    const op = OPERATIONS["research.contact-background"];
    assert.ok(op);
    assert.equal(isOperationAvailable(op, allTrue), true);
    assert.equal(isOperationAvailable(op, noSubagent), false);
  });

  test("unavailableOperations lists exactly the subagent ops in private mode", () => {
    const unavailable = unavailableOperations(noSubagent);
    assert.deepEqual(unavailable, ["research.account-deep-dive", "research.contact-background"]);
    // With full capabilities, nothing is unavailable.
    assert.deepEqual(unavailableOperations(allTrue), []);
  });
});

describe("gateway client translation", () => {
  test("retrieve nests the filter fields under `filters` and reads records back", async () => {
    let captured: { url?: string; body?: any } = {};
    const fakeFetch = async (url: string, init: any) => {
      captured = { url, body: JSON.parse(init.body) };
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ records: [{ record_id: "c1" }], pagination: { totalMatched: 1 } }),
      } as any;
    };
    const original = globalThis.fetch;
    (globalThis as any).fetch = fakeFetch;
    try {
      const client = createGatewayClient({ baseUrl: "http://gw.local/", apiKey: "k" });
      const res = await client.retrieve({ mode: "filter", filters: { crmFilter: { type: "contact" } } });
      assert.match(captured.url!, /\/memory\/retrieve$/);
      assert.deepEqual(captured.body.filters, { crmFilter: { type: "contact" } });
      assert.equal(res.records.length, 1);
      assert.equal(res.pagination.totalMatched, 1);
    } finally {
      (globalThis as any).fetch = original;
    }
  });

  test("collections.list normalizes the response to { data }", async () => {
    const fakeFetch = async () =>
      ({ ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: "1", slug: "contacts" }] }) }) as any;
    const original = globalThis.fetch;
    (globalThis as any).fetch = fakeFetch;
    try {
      const client = createGatewayClient({ baseUrl: "http://gw.local", apiKey: "k" });
      const res = await client.collections.list();
      assert.equal(res.data[0].slug, "contacts");
    } finally {
      (globalThis as any).fetch = original;
    }
  });

  test("memorizeBatch maps the gateway jobId to eventId/trackingId", async () => {
    const fakeFetch = async () =>
      ({ ok: true, status: 202, text: async () => JSON.stringify({ jobId: "job_123" }) }) as any;
    const original = globalThis.fetch;
    (globalThis as any).fetch = fakeFetch;
    try {
      const client = createGatewayClient({ baseUrl: "http://gw.local", apiKey: "k" });
      const res = await client.memory.memorizeBatch({ rows: [], mapping: {} });
      assert.equal(res.data.eventId, "job_123");
      assert.equal(res.data.trackingId, "job_123");
    } finally {
      (globalThis as any).fetch = original;
    }
  });

  test("context.list normalizes guideline docs to { name, slug, value } (governance path)", async () => {
    const fakeFetch = async () =>
      ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ data: [{ name: "icp-definition", slug: "icp-definition", content: "Our ICP is..." }] }),
      }) as any;
    const original = globalThis.fetch;
    (globalThis as any).fetch = fakeFetch;
    try {
      const client = createGatewayClient({ baseUrl: "http://gw.local", apiKey: "k" });
      const res = await client.context.list({ type: "guideline" });
      assert.equal(res.data[0].name, "icp-definition");
      assert.equal(res.data[0].value, "Our ICP is...");
    } finally {
      (globalThis as any).fetch = original;
    }
  });

  test("upsert forwards the collection target to the gateway save body", async () => {
    let body: any;
    const fakeFetch = async (_url: string, init: any) => {
      body = JSON.parse(init.body);
      return { ok: true, status: 200, text: async () => "{}" } as any;
    };
    const original = globalThis.fetch;
    (globalThis as any).fetch = fakeFetch;
    try {
      const client = createGatewayClient({ baseUrl: "http://gw.local", apiKey: "k" });
      await client.memory.upsert({ type: "company", websiteUrl: "acme.com", collectionName: "companies", properties: { x: "1" } });
      assert.equal(body.collectionName, "companies");
      assert.equal(body.entityType, "company");
    } finally {
      (globalThis as any).fetch = original;
    }
  });

  test("a non-ok gateway response fails soft on retrieve", async () => {
    const fakeFetch = async () => ({ ok: false, status: 500, text: async () => "boom" }) as any;
    const original = globalThis.fetch;
    (globalThis as any).fetch = fakeFetch;
    try {
      const client = createGatewayClient({ baseUrl: "http://gw.local", apiKey: "k" });
      const res = await client.retrieve({ mode: "filter", filters: {} });
      assert.deepEqual(res.records, []);
    } finally {
      (globalThis as any).fetch = original;
    }
  });
});
