import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

// Set BEFORE dynamic import so module-level WEBHOOK_SECRET captures this value.
const TEST_SECRET = "webhook-test-secret-abc123";
process.env["PERSONIZE_WEBHOOK_SECRET"] = TEST_SECRET;
delete process.env["ALLOW_UNSIGNED_WEBHOOKS"];

function sign(body: string): string {
  return createHmac("sha256", TEST_SECRET).update(body).digest("hex");
}

let server: Server;
let port: number;

async function httpPost(
  path: string,
  body: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body,
  });
}

async function httpGet(path: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`);
}

describe("webhook-server", () => {
  before(async () => {
    const mod = await import("../core/engine/webhook-server.js");
    server = mod.createWebhookServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  );

  describe("HMAC validation", () => {
    const body = JSON.stringify({ event: "test.event", entity_email: "user@example.com" });

    test("accepts correct HMAC", async () => {
      const res = await httpPost("/webhook", body, { "x-personize-signature": sign(body) });
      assert.equal(res.status, 200);
    });

    test("accepts sha256= prefixed signature", async () => {
      const res = await httpPost("/webhook", body, {
        "x-personize-signature": `sha256=${sign(body)}`,
      });
      assert.equal(res.status, 200);
    });

    test("rejects wrong signature — 401", async () => {
      const res = await httpPost("/webhook", body, {
        "x-personize-signature": "deadbeef".repeat(8),
      });
      assert.equal(res.status, 401);
    });

    test("rejects missing signature header — 401", async () => {
      const res = await httpPost("/webhook", body);
      assert.equal(res.status, 401);
    });

    test("rejects truncated signature — 401", async () => {
      const res = await httpPost("/webhook", body, {
        "x-personize-signature": sign(body).slice(0, 16),
      });
      assert.equal(res.status, 401);
    });

    test("rejects signature for different body — 401", async () => {
      const res = await httpPost("/webhook", body, {
        "x-personize-signature": sign(body + " tampered"),
      });
      assert.equal(res.status, 401);
    });
  });

  describe("body size limit", () => {
    test("accepts body just under 1 MB", async () => {
      const payload = JSON.stringify({ event: "test", data: "x".repeat(900_000) });
      const res = await httpPost("/webhook", payload, {
        "x-personize-signature": sign(payload),
      });
      assert.equal(res.status, 200);
    });

    test("rejects body over 1 MB — 413 or connection drop", async () => {
      // req.destroy() races with sendJson so client may see 413 or a socket error
      const large = "x".repeat(1_048_577);
      let status: number | undefined;
      try {
        const res = await httpPost("/webhook", large, {
          "x-personize-signature": sign(large),
        });
        status = res.status;
      } catch {
        // Socket destroyed before response — also acceptable security behaviour
      }
      if (status !== undefined) assert.equal(status, 413);
    });
  });

  describe("routing", () => {
    test("GET /health returns 200 with ok:true", async () => {
      const res = await httpGet("/health");
      assert.equal(res.status, 200);
      const json = (await res.json()) as Record<string, unknown>;
      assert.equal(json["ok"], true);
    });

    test("GET /webhook returns 404", async () => {
      const res = await httpGet("/webhook");
      assert.equal(res.status, 404);
    });

    test("POST /unknown returns 404", async () => {
      const body = "{}";
      const res = await httpPost("/unknown", body, { "x-personize-signature": sign(body) });
      assert.equal(res.status, 404);
    });
  });

  describe("JSON parsing", () => {
    test("rejects invalid JSON with 400", async () => {
      const body = "not-json";
      const res = await httpPost("/webhook", body, {
        "x-personize-signature": sign(body),
      });
      assert.equal(res.status, 400);
    });

    test("accepted webhook responds with received:true and event_id", async () => {
      const body = JSON.stringify({ event: "contact.created", entity_email: "x@example.com" });
      const res = await httpPost("/webhook", body, {
        "x-personize-signature": sign(body),
      });
      assert.equal(res.status, 200);
      const json = (await res.json()) as Record<string, unknown>;
      assert.equal(json["received"], true);
      assert.equal(typeof json["event_id"], "string");
    });
  });
});
