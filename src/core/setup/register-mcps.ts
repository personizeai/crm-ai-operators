import { client } from "../config.js";
import { logger } from "../lib/logger.js";

// MCP endpoints to register with Personize for subagent use.
// Extend this list as new MCP integrations are added.
const REQUIRED_MCPS = [
  { name: "hubspot-official", description: "HubSpot official MCP for CRM operations" },
  { name: "tavily", description: "Tavily web search for account and contact research" },
  { name: "salesforce", description: "Salesforce MCP for CRM operations" },
];

export interface RegisterMcpsResult {
  registered: string[];
  skipped: string[];
  errors: string[];
}

export async function registerMcps(): Promise<RegisterMcpsResult> {
  const result: RegisterMcpsResult = { registered: [], skipped: [], errors: [] };

  const existingRes = await (client as any).mcps?.list?.().catch(() => null);
  const existingNames = new Set<string>((existingRes?.data ?? []).map((m: any) => m.name));

  for (const mcp of REQUIRED_MCPS) {
    if (existingNames.has(mcp.name)) {
      result.skipped.push(mcp.name);
      logger.info("MCP already registered; skipping", { name: mcp.name });
      continue;
    }

    try {
      await (client as any).mcps?.register?.({ name: mcp.name, description: mcp.description });
      result.registered.push(mcp.name);
      logger.info("Registered MCP", { name: mcp.name });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      result.errors.push(`${mcp.name}: ${msg}`);
      logger.warn("Failed to register MCP", { name: mcp.name, error: msg });
    }
  }

  return result;
}
