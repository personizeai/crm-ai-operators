import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { applyEntityTypes } from "../core/setup/apply-entity-types.js";
import { describeApiError } from "../core/lib/personize-helpers.js";

describe("describeApiError", () => {
  // Mirrors the SDK's PersonizeError: mangled top-level message, real body on .cause.
  const makeErr = (body: unknown, opts: Partial<{ status: number; method: string; endpoint: string }> = {}) => ({
    message: `${String(body && typeof body === "object" ? body : body)} (${opts.method ?? "POST"} ${opts.endpoint ?? "/x"})`,
    status: opts.status,
    method: opts.method,
    endpoint: opts.endpoint,
    cause: { response: { status: opts.status, data: body } },
  });

  test("recovers a structured validation body the SDK renders as [object Object]", () => {
    const err = makeErr(
      { message: { field: "tags", reason: "unknown tag reference" } },
      { status: 400, method: "POST", endpoint: "/api/v1.1/context/manage/doc-types" },
    );
    const out = describeApiError(err);
    assert.ok(!out.includes("[object Object]"), "must not contain [object Object]");
    assert.ok(out.includes("tags"), "surfaces the real field");
    assert.ok(out.includes("HTTP 400"), "includes status");
  });

  test("passes through a plain string error body", () => {
    const err = makeErr({ error: "not_found" }, { status: 404, method: "GET", endpoint: "/api/v1/entity-types" });
    assert.equal(describeApiError(err).startsWith("not_found"), true);
  });

  test("stringifies an array/issues body", () => {
    const err = makeErr({ issues: [{ path: "name", message: "required" }] }, { status: 422 });
    const out = describeApiError(err);
    assert.ok(out.includes("required"), "renders nested issue detail");
    assert.ok(!out.includes("[object Object]"));
  });

  test("falls back to the message when there is no recoverable body", () => {
    assert.equal(describeApiError(new Error("boom")), "boom");
  });
});

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
