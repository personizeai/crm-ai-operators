import type { CrmId } from "../operations/types.js";

export type FilterValue = string | number | boolean | null;

export type FilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "exists"
  | "is_empty";

export type FilterConditionValue =
  | FilterValue
  | { [op in FilterOperator]?: FilterValue };

export interface FilterWhere {
  [property: string]: FilterConditionValue;
}

export interface Filter {
  /** The Personize collection slug (e.g. "contacts", "companies", "tasks"). */
  collection: string;
  /** Property predicates. Simple equality: { lifecycle_stage: "MQL" }. With operator: { ai_score: { gte: 70 } }. */
  where?: FilterWhere;
  /** Max records to return. Default 100. */
  limit?: number;
  /** Pagination offset (when supported by the runtime). */
  offset?: number;
  /** Optional CRM scope override. */
  crm?: CrmId;
}

export interface CompiledCondition {
  propertyName: string;
  operator: string;
  value?: FilterValue;
}

export interface CompiledFilter {
  collection: string;
  conditions: CompiledCondition[];
  limit: number;
  logic: "AND" | "OR";
}

const OPERATOR_MAP: Record<FilterOperator, string> = {
  eq: "equals",
  neq: "notEquals",
  gt: "gt",
  gte: "gte",
  lt: "lt",
  lte: "lte",
  contains: "contains",
  not_contains: "not_contains",
  starts_with: "starts_with",
  exists: "exists",
  is_empty: "isEmpty",
};

/**
 * Compile a declarative Filter into the conditions array shape that
 * Personize's memory_filter_by_property expects.
 *
 * Simple equality:  { where: { lifecycle_stage: "MQL" } }
 * With operator:    { where: { ai_score: { gte: 70 } } }
 * Multiple props:   { where: { lifecycle_stage: "MQL", ai_score: { gte: 70 } } }  (AND)
 */
export function compileFilter(filter: Filter): CompiledFilter {
  const conditions: CompiledCondition[] = [];

  if (filter.where) {
    for (const [property, condition] of Object.entries(filter.where)) {
      if (condition === null || typeof condition !== "object") {
        conditions.push({ propertyName: property, operator: "equals", value: condition });
      } else {
        for (const [op, value] of Object.entries(condition)) {
          const mapped = OPERATOR_MAP[op as FilterOperator];
          if (!mapped) {
            throw new Error(`Unknown filter operator '${op}' on property '${property}'`);
          }
          conditions.push({ propertyName: property, operator: mapped, value: value as FilterValue });
        }
      }
    }
  }

  return {
    collection: filter.collection,
    conditions,
    limit: filter.limit ?? 100,
    logic: "AND",
  };
}

/**
 * Type guard for the input shape of operations that accept a filter.
 */
export function parseFilterInput(input: unknown): Filter | undefined {
  if (!input || typeof input !== "object") return undefined;
  const obj = input as { filter?: Filter };
  return obj.filter;
}
