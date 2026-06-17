import type { OperationEntry } from "../types.js";
import { buildScaffold } from "../helpers.js";

export const researchAccountDeepDive: OperationEntry = {
  name: "research.account-deep-dive",
  mode: "operation",
  description: "Comprehensive account research per the account-research guideline. Fills companies properties + signals + stakeholder contacts.",
  category: "research",
  status: "scaffold",
  idempotent: true,
  cost: "high",
  run_mode: "on-trigger",
  guidelines_required: ["account-research"],
  skip_if: { property: "context", updated_within: "30d" },
  run: async (input, context) =>
    buildScaffold(
      "research.account-deep-dive",
      "Run the full account-research checklist: firmographics, funding, leadership moves, tech stack, stakeholder map, news, public pain points.",
      context,
      {
        would_read_from: [
          "personize.companies (the target account)",
          "external: Crunchbase, LinkedIn, Tavily web search, BuiltWith, the company's own site",
          "personize.context (account-research guideline)",
        ],
        would_write_to: [
          "companies.context (one-paragraph narrative)",
          "companies.industry / business_model / employee_count (when newly inferred)",
          "signals (one row per buying signal found)",
          "contacts (one row per stakeholder discovered)",
          "companies.workspace.updates + .notes",
        ],
        governance_required: ["account-research"],
        estimated_cost: "high",
      },
      input,
      [
        "Filter target accounts via input.filter (default tier A or B accounts with stale context)",
        "For each account: load companies record + governance + recent signals",
        "Call Tavily/web search for funding, news, leadership; call LinkedIn for stakeholder map (consider 'lib/research-providers.ts')",
        "Use aiSubagent (autonomous, tool-using) with a schema { summary, facts[], signals[], stakeholders[], next_action } to research and structure findings",
        "Persist: companies.context = summary, batch-store signals, batch-store stakeholders as contacts (with crm_object_type='lead')",
        "Append a workspace.updates entry per account; cite sources in companies.notes",
      ],
    ),
};
