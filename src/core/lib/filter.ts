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
  | "not_exists"
  | "is_empty"
  | "in"
  | "not_in";

/** Operators whose value is a list of candidates rather than a single scalar. */
export type ListFilterOperator = "in" | "not_in";

export type FilterConditionValue =
  | FilterValue
  | { [op in Exclude<FilterOperator, ListFilterOperator>]?: FilterValue }
  | { [op in ListFilterOperator]?: FilterValue[] };

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
  value?: FilterValue | FilterValue[];
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
  not_exists: "not_exists",
  is_empty: "isEmpty",
  in: "in",
  not_in: "not_in",
};

/** Operators that test presence/emptiness — they take no value. */
const VALUELESS_OPERATORS = new Set<FilterOperator>(["exists", "not_exists", "is_empty"]);

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
          if (VALUELESS_OPERATORS.has(op as FilterOperator)) {
            // Presence/emptiness checks carry no value. `exists: false` means "not set".
            const operator = op === "exists" && value === false ? OPERATOR_MAP.not_exists : mapped;
            conditions.push({ propertyName: property, operator });
          } else {
            conditions.push({ propertyName: property, operator: mapped, value: value as FilterValue | FilterValue[] });
          }
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
