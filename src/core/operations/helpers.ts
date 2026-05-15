import type { OperationContext, ScaffoldResult } from "./types.js";

export function buildScaffold(
  name: string,
  intent: string,
  context: OperationContext,
  rehearsal: Omit<ScaffoldResult["rehearsal"], "intent" | "inputs_received">,
  inputs: unknown,
  next_steps: string[],
): ScaffoldResult {
  return {
    ok: true,
    runId: context.runId,
    operation: name,
    dryRun: context.dryRun,
    status: "scaffold",
    summary: `Scaffold for ${name} — ${intent}`,
    rehearsal: { intent, inputs_received: inputs, ...rehearsal },
    next_steps_to_make_live: next_steps,
    metrics: { rehearsal_only: true },
  };
}
