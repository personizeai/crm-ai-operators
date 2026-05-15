import type { OperationEntry } from "../types.js";

export const setupApply: OperationEntry = {
  name: "setup.apply",
  mode: "setup",
  description: "Create missing Personize collections and upsert guidelines from local manifests.",
  category: "setup",
  status: "live",
  idempotent: true,
  cost: "low",
  run_mode: "manual",
  run: async (_input, context) => {
    const { applyManifests } = await import("../../setup/apply-manifests.js");
    const result = await applyManifests({ dryRun: context.dryRun, crm: context.crm });
    return {
      ok: true,
      runId: context.runId,
      operation: "setup.apply",
      dryRun: context.dryRun,
      status: "live",
      summary: `Processed manifests: ${result.collections} collection changes, ${result.guidelines} guideline upserts`,
      metrics: result,
    };
  },
};
