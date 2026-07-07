import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  VerificationSchema,
  verificationInstruction,
  assertApproved,
  OutputRejectedError,
} from "../core/lib/instruction-patterns.js";

describe("verification pattern", () => {
  test("verificationInstruction embeds the criteria and asks for a verdict", () => {
    const block = verificationInstruction("Subjects must be under 120 chars.");
    assert.match(block, /Subjects must be under 120 chars\./);
    assert.match(block, /verification\.status/);
    assert.match(block, /rejected/);
    assert.match(block, /approved/);
  });

  test("assertApproved passes on approved", () => {
    assert.doesNotThrow(() => assertApproved({ status: "approved" }));
  });

  test("assertApproved passes when verification is absent (backward compatible)", () => {
    assert.doesNotThrow(() => assertApproved(undefined));
  });

  test("assertApproved throws OutputRejectedError with the reason on rejection", () => {
    try {
      assertApproved({ status: "rejected", reason: "subject was ALL CAPS" });
      assert.fail("should have thrown");
    } catch (err) {
      assert.ok(err instanceof OutputRejectedError);
      assert.equal((err as OutputRejectedError).reason, "subject was ALL CAPS");
      assert.match(String(err), /subject was ALL CAPS/);
    }
  });

  test("VerificationSchema validates the expected shape", () => {
    assert.equal(VerificationSchema.safeParse({ status: "approved" }).success, true);
    assert.equal(VerificationSchema.safeParse({ status: "maybe" }).success, false);
  });
});
