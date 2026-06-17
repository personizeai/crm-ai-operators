import type { OperationEntry } from "../types.js";
import { buildScaffold } from "../helpers.js";

export const researchContactBackground: OperationEntry = {
  name: "research.contact-background",
  mode: "operation",
  description: "Per-contact background research — title history, public content, recent role moves, communication style cues.",
  category: "research",
  status: "scaffold",
  idempotent: true,
  cost: "medium",
  run_mode: "on-trigger",
  guidelines_required: ["account-research"],
  skip_if: { property: "job_title", updated_within: "60d" },
  run: async (input, context) =>
    buildScaffold(
      "research.contact-background",
      "Look up role history, public content, recent moves; infer communication style and pain points.",
      context,
      {
        would_read_from: [
          "personize.contacts (target)",
          "external: LinkedIn, Tavily web (recent posts, podcasts, conference talks)",
          "personize.conversations (any prior interactions)",
        ],
        would_write_to: [
          "contacts.job_title / seniority / function (when changed)",
          "contacts.communication_style (inferred from public content)",
          "contacts.pain_points (append from observed signals)",
          "contacts.workspace.notes (per source)",
          "contacts.workspace.updates",
        ],
        governance_required: ["account-research"],
        estimated_cost: "medium",
      },
      input,
      [
        "Filter contacts via input.filter (default: ai_score >= 70 with stale background)",
        "For each contact: pull LinkedIn profile + recent public content via Tavily",
        "Use aiSubagent (autonomous, tool-using) with schema { title_history[], topics[], style_summary, recent_moves[], pain_signals[] }",
        "Update title-history entries only when newer than current; append style/pain_points",
        "Cite sources in notes; respect privacy — no scraping of private content",
      ],
    ),
};
