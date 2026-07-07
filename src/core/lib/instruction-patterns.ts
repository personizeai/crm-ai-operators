import { z } from "zod";

// -----------------------------------------------------------------------------
// Instruction patterns — reusable prompt building blocks for operations.
//
// verify-then-emit: append a final self-check step to an operation's instruction.
// The model reviews every drafted output against a set of rules and either
//   (a) CORRECTS the outputs to comply, or
//   (b) REJECTS the draft (sets verification.status = "rejected") when it can't.
// The operation calls assertApproved() before writing anything — a rejection
// throws, the operation's try/catch turns it into a clean failure, and NO write
// happens. This is "AI grades its own output before it goes live" using only the
// prompt surface: no separate eval call, no special backend capability, fully
// portable to Personize Private.
// -----------------------------------------------------------------------------

/** Verification verdict the model emits as the last thing it does. Add to an op's output schema. */
export const VerificationSchema = z.object({
  status: z
    .enum(["approved", "rejected"])
    .describe("approved if all outputs comply with the rules; rejected if they cannot be made compliant"),
  reason: z.string().max(300).optional().describe("If rejected, the single-sentence reason"),
});

export type Verification = z.infer<typeof VerificationSchema>;

/**
 * Build the final self-check instruction block to append to an operation's prompt.
 * `criteria` is the rule set to check against — typically a guideline excerpt plus
 * any hard constraints the schema can't express.
 */
export function verificationInstruction(criteria: string): string {
  return (
    `\n\n---\n` +
    `FINAL SELF-CHECK — do this LAST, after drafting every other output:\n` +
    `Review each field you produced against these rules:\n${criteria}\n\n` +
    `If any field violates a rule, CORRECT it now so it fully complies. ` +
    `If the request genuinely cannot be satisfied while complying, set ` +
    `verification.status to "rejected" and give a one-sentence verification.reason. ` +
    `Otherwise set verification.status to "approved". ` +
    `Always include the verification object in your response.`
  );
}

/** Thrown when the model's self-check rejected its own draft. Callers should not write on this. */
export class OutputRejectedError extends Error {
  reason?: string;
  constructor(reason?: string) {
    super(`Output self-check rejected the draft: ${reason ?? "no reason given"}`);
    this.name = "OutputRejectedError";
    this.reason = reason;
  }
}

/** Throw if the verification verdict is a rejection. Call this before any write. */
export function assertApproved(verification: Verification | undefined): void {
  if (verification?.status === "rejected") {
    throw new OutputRejectedError(verification.reason);
  }
}
