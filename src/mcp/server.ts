#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { OPERATION_NAMES, OPERATIONS } from "../core/operations/registry.js";
import { runOperation } from "../core/runtime/operation-runner.js";

type McpProfile = "planner" | "operator" | "admin" | "auditor";
const PROFILE = (process.env.MCP_PROFILE as McpProfile) || "planner";

const server = new McpServer({
  name: "crm-ai-operators",
  version: "0.1.0",
});

function canRun(operation: string): boolean {
  const mode = OPERATIONS[operation]?.mode;
  if (PROFILE === "admin") return true;
  if (PROFILE === "operator") return mode === "operation" || mode === "optimization";
  if (PROFILE === "auditor") return false;
  return mode === "optimization";
}

server.tool(
  "operation_list",
  "List CRM Agent Operating System operations available in this repo.",
  {},
  async () => ({
    content: [{
      type: "text",
      text: JSON.stringify(
        OPERATION_NAMES.map((name) => ({
          name,
          mode: OPERATIONS[name].mode,
          description: OPERATIONS[name].description,
        })),
        null,
        2,
      ),
    }],
  }),
);

server.tool(
  "operation_run",
  "Run an approved operation by name. DRY_RUN defaults to true unless explicitly disabled in the environment.",
  {
    name: z.string().describe("Operation name, for example setup.apply or crm.sync-core"),
    input: z.record(z.unknown()).optional().describe("JSON input passed to the operation"),
  },
  async ({ name, input }: { name: string; input?: Record<string, unknown> }) => {
    if (!OPERATIONS[name]) {
      return { content: [{ type: "text", text: `Unknown operation: ${name}` }] };
    }
    if (!canRun(name)) {
      return { content: [{ type: "text", text: `MCP profile ${PROFILE} is not allowed to run ${name}` }] };
    }
    const result = await runOperation(name, input ?? {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
