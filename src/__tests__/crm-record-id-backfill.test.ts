import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeKey } from "../core/lib/crm-record-id-backfill.js";

// The backfill matches CRM objects to Personize records by normalized primary
// key. If the normalization on the two sides disagrees, crm_record_id never
// lands — the exact class of bug this feature fixes — so lock the rules down.

describe("normalizeKey (domain)", () => {
  test("lowercases and trims", () => assert.equal(normalizeKey("  VividSeats.com ", true), "vividseats.com"));
  test("strips https:// protocol", () => assert.equal(normalizeKey("https://vividseats.com", true), "vividseats.com"));
  test("strips http:// protocol", () => assert.equal(normalizeKey("http://vividseats.com", true), "vividseats.com"));
  test("strips leading www.", () => assert.equal(normalizeKey("www.vividseats.com", true), "vividseats.com"));
  test("strips protocol and www. together", () =>
    assert.equal(normalizeKey("https://www.vividseats.com", true), "vividseats.com"));
  test("drops a path", () => assert.equal(normalizeKey("vividseats.com/tickets", true), "vividseats.com"));
  test("drops protocol, www., and path together", () =>
    assert.equal(normalizeKey("https://www.vividseats.com/tickets/nba", true), "vividseats.com"));
  test("a bare domain and its full URL normalize equal", () =>
    assert.equal(normalizeKey("vividseats.com", true), normalizeKey("https://www.vividseats.com/", true)));
});

describe("normalizeKey (email)", () => {
  test("lowercases and trims, keeps the address intact", () =>
    assert.equal(normalizeKey("  Rep@ClubSpeed.com ", false), "rep@clubspeed.com"));
  test("does not strip anything email-shaped", () =>
    assert.equal(normalizeKey("first.last+tag@sub.example.com", false), "first.last+tag@sub.example.com"));
});

describe("normalizeKey (empty / missing)", () => {
  test("null -> undefined", () => assert.equal(normalizeKey(null, true), undefined));
  test("undefined -> undefined", () => assert.equal(normalizeKey(undefined, false), undefined));
  test("empty string -> undefined", () => assert.equal(normalizeKey("   ", true), undefined));
  test("protocol-only -> undefined", () => assert.equal(normalizeKey("https://", true), undefined));
});
