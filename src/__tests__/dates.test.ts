import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { addBusinessDays, isoDate } from "../core/lib/dates.js";

const MONDAY = new Date("2026-04-27T12:00:00Z"); // Monday
const FRIDAY = new Date("2026-05-01T12:00:00Z"); // Friday

describe("addBusinessDays", () => {
  test("adding 0 days returns same date", () => {
    const result = addBusinessDays(MONDAY, 0);
    assert.equal(result.toDateString(), MONDAY.toDateString());
  });

  test("Friday + 1 business day = Monday", () => {
    const result = addBusinessDays(FRIDAY, 1);
    assert.equal(result.getUTCDay(), 1); // Monday
  });

  test("Friday + 3 business days = Wednesday", () => {
    const result = addBusinessDays(FRIDAY, 3);
    assert.equal(result.getUTCDay(), 3); // Wednesday
  });

  test("Monday + 5 business days = Monday next week", () => {
    const result = addBusinessDays(MONDAY, 5);
    assert.equal(result.getUTCDay(), 1); // Monday
    const diffDays = Math.round(
      (result.getTime() - MONDAY.getTime()) / (1000 * 60 * 60 * 24),
    );
    assert.equal(diffDays, 7);
  });

  test("does not mutate the input date", () => {
    const original = new Date(MONDAY);
    addBusinessDays(MONDAY, 3);
    assert.equal(MONDAY.getTime(), original.getTime());
  });

  test("adding 1 from Monday yields Tuesday", () => {
    const result = addBusinessDays(MONDAY, 1);
    assert.equal(result.getUTCDay(), 2); // Tuesday
  });
});

describe("isoDate", () => {
  test("formats YYYY-MM-DD", () => {
    const d = new Date("2026-04-30T00:00:00Z");
    assert.equal(isoDate(d), "2026-04-30");
  });

  test("ten-character string", () => {
    assert.equal(isoDate(new Date("2026-01-01T00:00:00Z")).length, 10);
  });
});
