import type { OperationEntry } from "../types.js";

export const setupDiff: OperationEntry = {
  name: "setup.diff",
  mode: "setup",
  description: "Show what setup.apply would create or update without making changes. Equivalent to setup.apply with dry-run forced on.",
  category: "setup",
  status: "live",
  idempotent: true,
  cost: "low",
  run_mode: "manual",
  run: async (_input, context) => {
    const { applyManifests } = await import("../../setup/apply-manifests.js");
    const result = await applyManifests({ dryRun: true, crm: context.crm });
    const cp = result.crmProperties;
    const crmSummary = cp
      ? ` ${cp.created} personize_* CRM prop(s) would be provisioned${cp.manual ? `, ${cp.manual} manual (Salesforce)` : ""}.`
      : "";
    return {
      ok: true,
      runId: context.runId,
      operation: "setup.diff",
      dryRun: true,
      status: "live",
      summary: `Diff: ${result.collections} collection change(s), ${result.guidelines} guideline upsert(s) would be applied.${crmSummary}`,
      metrics: { ...result, dry_run_forced: true },
    };
  },
};
