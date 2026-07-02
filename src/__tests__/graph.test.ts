import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { RelationType } from "@personize/sdk";
import { filterRelations } from "../core/lib/graph.js";

function relType(over: Partial<RelationType> & { typeName: string }): RelationType {
  return {
    displayLabel: null,
    description: null,
    category: "generic",
    isBuiltin: true,
    isSingleValued: false,
    isSymmetric: false,
    inverseType: null,
    defaultWeight: 1,
    allowedFromTypes: [],
    allowedToTypes: [],
    examples: [],
    isActive: true,
    scope: "system",
    createdAt: "",
    updatedAt: "",
    ...over,
  } as RelationType;
}

function registry(...types: RelationType[]): Map<string, RelationType> {
  return new Map(types.map((t) => [t.typeName, t]));
}

const worksAt = relType({ typeName: "works_at", allowedFromTypes: ["contact"], allowedToTypes: ["company"] });

describe("filterRelations", () => {
  test("keeps a valid edge", () => {
    const { valid, dropped } = filterRelations(
      registry(worksAt),
      "contact",
      [{ relationType: "works_at", toIdentity: { kind: "domain", value: "acme.com" }, toEntityType: "company" }],
    );
    assert.equal(valid.length, 1);
    assert.equal(dropped.length, 0);
  });

  test("drops an unknown relation type", () => {
    const { valid, dropped } = filterRelations(registry(worksAt), "contact", [
      { relationType: "invented", toEntityType: "company" },
    ]);
    assert.equal(valid.length, 0);
    assert.equal(dropped[0].reason, "unknown-type");
  });

  test("drops an inactive relation type", () => {
    const inactive = relType({ typeName: "works_at", isActive: false });
    const { dropped } = filterRelations(registry(inactive), "contact", [{ relationType: "works_at" }]);
    assert.equal(dropped[0].reason, "inactive");
  });

  test("drops when the from-entity type isn't allowed", () => {
    const { dropped } = filterRelations(registry(worksAt), "company", [
      { relationType: "works_at", toEntityType: "company" },
    ]);
    assert.equal(dropped[0].reason, "from-type-not-allowed");
  });

  test("drops when the to-entity type isn't allowed", () => {
    const { dropped } = filterRelations(registry(worksAt), "contact", [
      { relationType: "works_at", toEntityType: "signal" },
    ]);
    assert.equal(dropped[0].reason, "to-type-not-allowed");
  });

  test("empty allow-lists mean any type is accepted", () => {
    const generic = relType({ typeName: "related_to" });
    const { valid } = filterRelations(registry(generic), "signal", [
      { relationType: "related_to", toEntityType: "company" },
    ]);
    assert.equal(valid.length, 1);
  });

  test("type matching is case-insensitive on entity types", () => {
    const { valid } = filterRelations(registry(worksAt), "Contact", [
      { relationType: "works_at", toEntityType: "Company" },
    ]);
    assert.equal(valid.length, 1);
  });

  test("an empty registry drops everything", () => {
    const { valid, dropped } = filterRelations(new Map(), "contact", [{ relationType: "works_at" }]);
    assert.equal(valid.length, 0);
    assert.equal(dropped[0].reason, "unknown-type");
  });

  test("no relations → empty result", () => {
    const { valid, dropped } = filterRelations(registry(worksAt), "contact", undefined);
    assert.equal(valid.length, 0);
    assert.equal(dropped.length, 0);
  });
});
