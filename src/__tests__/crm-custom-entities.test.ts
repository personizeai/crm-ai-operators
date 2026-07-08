import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadCollectionManifest, buildCustomEntitySync, type CollectionManifest } from "../core/lib/crm-field-map.js";
import { loadCustomEntities } from "../core/lib/crm-custom-entities.js";

// Custom-entity sync is manifest-driven: a collection with a `crmSync` block
// (standard !== true) becomes a syncable custom entity, no code change. No custom
// entity SHIPS by default — deals is an example the agent copies into
// manifests/local/collections/ after asking the user for its identifier.

const EXAMPLE_DEALS = path.join(process.cwd(), "manifests", "examples", "collections", "deals.json");
async function dealsExample(): Promise<CollectionManifest> {
  return JSON.parse(await readFile(EXAMPLE_DEALS, "utf8")) as CollectionManifest;
}

describe("loadCustomEntities (registry) — nothing custom ships by default", () => {
  test("excludes standard entities and does not include the deals example", async () => {
    const entities = await loadCustomEntities();
    const types = new Set(entities.map((e) => e.entityType));
    assert.ok(!types.has("contact"), "contact is not a custom entity");
    assert.ok(!types.has("company"), "company is not a custom entity");
    assert.ok(!types.has("deal"), "deal ships as an example, not a core manifest");
    // Invariant: anything discovered is a non-standard crmSync entity.
    for (const e of entities) {
      assert.notEqual(e.manifest.crmSync?.standard, true);
      assert.ok(e.manifest.crmSync?.entityType);
    }
  });
});

describe("buildCustomEntitySync (deals example, hubspot)", () => {
  test("derives identityFields from crmSync.identity", async () => {
    const { identityFields } = buildCustomEntitySync(await dealsExample(), "hubspot");
    assert.deepEqual(identityFields, { customKeyName: "deal_name", customKeySource: "dealname" });
  });

  test("maps only properties with a hubspot crmField, all direction:in", async () => {
    const { propertyMappings } = buildCustomEntitySync(await dealsExample(), "hubspot");
    for (const m of propertyMappings) {
      assert.equal(m.direction, "in");
      assert.ok(m.source && m.target, "each mapping has source + target");
    }
    assert.ok(propertyMappings.some((m) => m.target === "deal_name" && m.source === "dealname"));
    assert.ok(propertyMappings.some((m) => m.target === "amount" && m.source === "amount"));
    // inferred-only fields (no crmFields) are NOT sync targets
    assert.ok(!propertyMappings.some((m) => m.target === "context"));
    assert.ok(!propertyMappings.some((m) => m.target === "deal_score"));
  });

  test("throws for a CRM the entity has no identity source for (salesforce)", async () => {
    const manifest = await dealsExample();
    assert.throws(() => buildCustomEntitySync(manifest, "salesforce"), /no salesforce identity source/i);
  });

  test("throws for a standard/non-custom manifest (companies)", async () => {
    const manifest = await loadCollectionManifest("companies");
    assert.throws(() => buildCustomEntitySync(manifest, "hubspot"), /not a custom-sync entity/i);
  });
});
