import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { loadCollectionManifest, buildCustomEntitySync } from "../core/lib/crm-field-map.js";
import { loadCustomEntities, customEntitiesByType } from "../core/lib/crm-custom-entities.js";

// The custom-entity sync is manifest-driven: a collection with a `crmSync` block
// (standard !== true) becomes a syncable custom entity with no code change. These
// run against the real shipped manifests (deals.json is the reference instance).

describe("loadCustomEntities (registry)", () => {
  test("discovers deals as a custom entity from its manifest", async () => {
    const deal = (await loadCustomEntities()).find((e) => e.entityType === "deal");
    assert.ok(deal, "deal entity discovered");
    assert.equal(deal.slug, "deals");
  });

  test("excludes standard entities (contact/company have no custom crmSync)", async () => {
    const types = new Set((await loadCustomEntities()).map((e) => e.entityType));
    assert.ok(!types.has("contact"), "contact is not a custom entity");
    assert.ok(!types.has("company"), "company is not a custom entity");
  });

  test("customEntitiesByType keys by entityType", async () => {
    const map = await customEntitiesByType();
    assert.ok(map.has("deal"));
    assert.equal(map.get("deal")?.slug, "deals");
  });
});

describe("buildCustomEntitySync (deals manifest, hubspot)", () => {
  test("derives identityFields from crmSync.identity", async () => {
    const manifest = await loadCollectionManifest("deals");
    const { identityFields } = buildCustomEntitySync(manifest, "hubspot");
    assert.deepEqual(identityFields, { customKeyName: "deal_name", customKeySource: "dealname" });
  });

  test("maps only properties with a hubspot crmField, all direction:in", async () => {
    const manifest = await loadCollectionManifest("deals");
    const { propertyMappings } = buildCustomEntitySync(manifest, "hubspot");
    for (const m of propertyMappings) {
      assert.equal(m.direction, "in");
      assert.ok(m.source && m.target, "each mapping has source + target");
    }
    // identity + a plain CRM field are mapped
    assert.ok(propertyMappings.some((m) => m.target === "deal_name" && m.source === "dealname"));
    assert.ok(propertyMappings.some((m) => m.target === "amount" && m.source === "amount"));
    // inferred-only fields (no crmFields) are NOT sync targets
    assert.ok(!propertyMappings.some((m) => m.target === "context"));
    assert.ok(!propertyMappings.some((m) => m.target === "deal_score"));
  });

  test("throws for a CRM the entity has no identity source for (salesforce)", async () => {
    const manifest = await loadCollectionManifest("deals");
    assert.throws(() => buildCustomEntitySync(manifest, "salesforce"), /no salesforce identity source/i);
  });

  test("throws for a standard/non-custom manifest (companies)", async () => {
    const manifest = await loadCollectionManifest("companies");
    assert.throws(() => buildCustomEntitySync(manifest, "hubspot"), /not a custom-sync entity/i);
  });
});
