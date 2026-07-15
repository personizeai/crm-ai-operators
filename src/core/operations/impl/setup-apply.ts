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
    const crmProps = result.crmProperties;
    const crmSummary = crmProps
      ? `; CRM personize_* props: ${crmProps.created} created, ${crmProps.skipped} existing${crmProps.manual ? `, ${crmProps.manual} manual (Salesforce)` : ""}`
      : "";

    // Register + credential the web-search MCPs (Tavily / Parallel.ai) so research
    // subagents actually have a search tool. Live write, so skipped on dry-run.
    // Never throws — MCP wiring problems are surfaced, not fatal to setup.apply.
    let mcpSummary = "";
    if (!context.dryRun) {
      const { registerMcps } = await import("../../setup/register-mcps.js");
      const mcp = await registerMcps();
      mcpSummary = `; MCPs: ${mcp.registered.length} registered, ${mcp.connected.length} connected, ${mcp.skipped.length} skipped${mcp.errors.length ? `, ${mcp.errors.length} errors` : ""}`;
      (result as Record<string, unknown>).mcps = mcp;
    }

    return {
      ok: true,
      runId: context.runId,
      operation: "setup.apply",
      dryRun: context.dryRun,
      status: "live",
      summary: `Processed manifests: ${result.collections} collection changes, ${result.guidelines} guideline upserts${crmSummary}${mcpSummary}`,
      metrics: result,
    };
  },
};
