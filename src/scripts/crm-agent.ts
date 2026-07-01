#!/usr/bin/env node
import { parseArgs } from "node:util";
import { OPERATION_NAMES, OPERATIONS } from "../core/operations/registry.js";
import { runOperation } from "../core/runtime/operation-runner.js";
import { isDryRun } from "../core/lib/dry-run.js";
import { syncManifests } from "../core/setup/sync-manifests.js";
import { registerWebhooks } from "../core/setup/register-webhooks.js";
import { registerMcps } from "../core/setup/register-mcps.js";

function usage(): string {
  return `Usage:
  crm-agent operation list
  crm-agent operation run <name> [--input '<json>'] [--crm hubspot|salesforce]
  crm-agent setup apply [--crm hubspot|salesforce]
  crm-agent setup diff [--crm hubspot|salesforce]
  crm-agent setup verify
  crm-agent setup sync [all|guidelines|collections|entity-types|document-types|document-tags|graph-relations]
  crm-agent setup webhooks
  crm-agent setup mcps
  crm-agent operate <name> [--input '<json>'] [--crm hubspot|salesforce]
  crm-agent optimize <name> [--input '<json>']

Examples:
  crm-agent setup apply --crm hubspot
  crm-agent setup sync guidelines
  crm-agent operation run crm.sync-core --input '{"crm":"hubspot"}'`;
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    input: { type: "string", short: "i" },
    crm: { type: "string", short: "c" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help || positionals.length === 0) {
  console.log(usage());
  process.exit(0);
}

const [scope, action, maybeName] = positionals;

if (scope === "operation" && action === "list") {
  for (const name of OPERATION_NAMES) {
    const entry = OPERATIONS[name];
    console.log(`${name.padEnd(24)} ${entry.mode.padEnd(12)} ${entry.description}`);
  }
  process.exit(0);
}

// setup sync
if (scope === "setup" && action === "sync") {
  const filter = maybeName as "all" | "guidelines" | "collections" | "entity-types" | "document-types" | "document-tags" | "graph-relations" | undefined;
  const result = await syncManifests({ dryRun: await isDryRun(), filter: filter ?? "all" });
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

// setup webhooks (post-deploy)
if (scope === "setup" && action === "webhooks") {
  const result = await registerWebhooks();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.errors.length > 0 ? 1 : 0);
}

// setup mcps (post-deploy)
if (scope === "setup" && action === "mcps") {
  const result = await registerMcps();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.errors.length > 0 ? 1 : 0);
}

let operationName = maybeName;
if (scope === "setup" && action === "apply") operationName = "setup.apply";
if (scope === "setup" && action === "verify") operationName = "setup.verify";
if (scope === "setup" && action === "diff") operationName = "setup.diff";
if (scope === "operate") operationName = action;
if (scope === "optimize") operationName = action;

if (scope === "operation" && action !== "run") {
  console.error(usage());
  process.exit(1);
}

if (!operationName) {
  console.error(usage());
  process.exit(1);
}

let input: unknown = {};
if (values.input) {
  try {
    input = JSON.parse(values.input);
  } catch (error) {
    console.error(`Invalid --input JSON: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

runOperation(operationName, input, { crm: values.crm })
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
