export type OperationMode = "setup" | "operation" | "optimization";

export type CrmId = "hubspot" | "salesforce" | (string & {});

export type OperationCategory =
  | "setup"
  | "sync"
  | "research"
  | "score"
  | "generate"
  | "analyze"
  | "act"
  | "report"
  | "optimize";

export type OperationStatus = "live" | "scaffold" | "idea";

export type OperationCost = "low" | "medium" | "high";

export type OperationRunMode = "always" | "on-trigger" | "on-decision" | "manual";

export interface OperationContext {
  runId: string;
  dryRun: boolean;
  mode: OperationMode;
  crm?: CrmId;
  /** Dispatcher-supplied tier override. Operations fall back to their own default when absent. */
  tierOverride?: string;
  /** Dispatcher-supplied model override (BYOK). Operations fall back to their own default when absent. */
  modelOverride?: string;
}

export interface OperationResult {
  ok: boolean;
  runId: string;
  operation: string;
  dryRun: boolean;
  summary: string;
  status?: OperationStatus;
  metrics?: Record<string, unknown>;
}

export interface ScaffoldRehearsal {
  intent: string;
  inputs_received: unknown;
  would_read_from?: string[];
  would_write_to?: string[];
  governance_required?: string[];
  estimated_records?: number | null;
  estimated_cost?: OperationCost;
}

export interface ScaffoldResult extends OperationResult {
  status: "scaffold";
  rehearsal: ScaffoldRehearsal;
  next_steps_to_make_live?: string[];
}

export interface IdeaResult extends OperationResult {
  status: "idea";
  description: string;
}

export interface SkipIfRule {
  property: string;
  updated_within?: string;
  in_states?: string[];
}

export interface OperationEntry {
  name: string;
  mode: OperationMode;
  description: string;
  category?: OperationCategory;
  status?: OperationStatus;
  idempotent?: boolean;
  cost?: OperationCost;
  run_mode?: OperationRunMode;
  guidelines_required?: string[];
  /**
   * Backend capabilities this operation needs (keys of Capabilities in config.ts:
   * "subagent" | "serverOutputs" | "evaluate" | "bulkMemorize" | "filteredQuery" | "webhooks").
   * The runner refuses the operation with a clear message when the active backend
   * (hosted vs Personize Private) lacks one. Absent = runs on any backend.
   */
  requires?: string[];
  skip_if?: SkipIfRule;
  run(input: unknown, context: OperationContext): Promise<OperationResult>;
}
