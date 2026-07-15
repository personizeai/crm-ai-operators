import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveOperationRecords } from "../core/lib/dispatch-input.js";

const DEFAULT_FILTER = { collection: "companies", where: {}, limit: 50 };

describe("resolveOperationRecords", () => {
  test("batch: returns input.records verbatim without recalling", async () => {
    const records = [{ domain: "a.com" }, { domain: "b.com" }];
    // No PERSONIZE_SECRET_KEY needed — the batch branch never touches the client.
    const out = await resolveOperationRecords({
      input: { records },
      type: "company",
      defaultFilter: DEFAULT_FILTER,
      singleKey: "recordId",
    });
    assert.deepEqual(out, records, "preloaded records are passed through unchanged");
  });

  test("batch: an empty records array is honored (not treated as 'no input')", async () => {
    const out = await resolveOperationRecords({
      input: { records: [] },
      type: "company",
      defaultFilter: DEFAULT_FILTER,
      singleKey: "recordId",
    });
    assert.deepEqual(out, [], "empty batch means nothing to process, not fall-through to recall");
  });

  test("per-record: recalls exactly one record via the single key", async (t) => {
    // Touches the Personize client (retrieveRecord) — needs a live key, like
    // apply-manifests.test.ts. Operations always call ensurePersonizeKey() before
    // reaching here, so the client is present in the real path.
    if (!process.env.PERSONIZE_SECRET_KEY) {
      t.skip("PERSONIZE_SECRET_KEY not set — skipping client-backed test");
      return;
    }
    const out = await resolveOperationRecords({
      input: { email: "person@acme.com" },
      type: "contact",
      defaultFilter: DEFAULT_FILTER,
      singleKey: "email",
    });
    assert.ok(Array.isArray(out), "returns an array");
    assert.ok(out.length <= 1, "per-record recall yields at most one record");
  });

  test("standalone: recalls via the operation's own filter", async (t) => {
    if (!process.env.PERSONIZE_SECRET_KEY) {
      t.skip("PERSONIZE_SECRET_KEY not set — skipping client-backed test");
      return;
    }
    const out = await resolveOperationRecords({
      input: {},
      type: "company",
      defaultFilter: DEFAULT_FILTER,
      singleKey: "recordId",
    });
    assert.ok(Array.isArray(out), "returns an array");
  });

  test("per-record path is disabled when singleKey is omitted (batch still works)", async () => {
    const records = [{ conversation_id: "c1" }];
    const out = await resolveOperationRecords({
      input: { records },
      type: "conversation",
      defaultFilter: { collection: "conversations", where: {}, limit: 10 },
    });
    assert.deepEqual(out, records);
  });
});
