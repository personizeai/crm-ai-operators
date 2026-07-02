#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { OPERATION_NAMES, OPERATIONS } from "../core/operations/registry.js";
import { runOperation } from "../core/runtime/operation-runner.js";
import { getRelationCatalog, checkRelations } from "../core/lib/graph.js";

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

// --- Graph relations: the two tools the assistant uses to build correct edges ---
// The mandatory save protocol (AGENTS.md → "Building graph edges on every save"):
// before declaring edges on a memory save, call `relation_types` to see what's
// allowed, then `relations_validate` to polish the payload down to valid edges.

server.tool(
  "relation_types",
  "List the org's allowed graph relation types (the relation registry). Call this BEFORE declaring any edges on a memory save — each entry gives the relationType and its allowed from/to entity types ([] means any).",
  {},
  async () => ({
    content: [{ type: "text", text: JSON.stringify(await getRelationCatalog(), null, 2) }],
  }),
);

const DeclaredRelationSchema = z.object({
  relationType: z.string().describe("Relation type name from relation_types, e.g. works_at"),
  toRecordId: z.string().optional().describe("Target by record id (use this OR toIdentity)"),
  toIdentity: z
    .object({
      kind: z.enum(["email", "websiteUrl", "domain", "phoneNumber", "name"]),
      value: z.string(),
    })
    .optional()
    .describe("Target by strong identity; resolved or stubbed at write time"),
  toEntityType: z.string().optional().describe("Target entity type, e.g. company (required with toIdentity)"),
  confidence: z.number().min(0).max(1).optional(),
});

server.tool(
  "relations_validate",
  "Validate proposed graph edges against the org registry WITHOUT saving. Returns { valid, dropped } so you can polish a declared-edge payload before saving. `dropped` explains why each edge failed (unknown-type | inactive | from-type-not-allowed | to-type-not-allowed).",
  {
    fromEntityType: z.string().describe("Entity type of the record you're saving, e.g. contact"),
    relations: z.array(DeclaredRelationSchema).describe("The edges you intend to declare on the save"),
  },
  async ({ fromEntityType, relations }: { fromEntityType: string; relations: z.infer<typeof DeclaredRelationSchema>[] }) => {
    const { valid, dropped } = await checkRelations(fromEntityType, relations);
    return { content: [{ type: "text", text: JSON.stringify({ valid, dropped }, null, 2) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
