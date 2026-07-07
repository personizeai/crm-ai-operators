import { test } from "node:test";
import assert from "node:assert/strict";
import { salesforceApiName, salesforceFieldMetadata } from "../core/setup/apply-crm-properties.js";
import { salesforceObjectFor, buildSoql, SF_API_VERSION } from "../adapters/salesforce/adapter.js";

test("salesforceApiName PascalCases the systemName and adds the custom suffix", () => {
  assert.equal(salesforceApiName("ai_score"), "Personize_Ai_Score__c");
  assert.equal(salesforceApiName("icp_fit_score"), "Personize_Icp_Fit_Score__c");
  assert.equal(salesforceApiName("next_best_action"), "Personize_Next_Best_Action__c");
});

test("salesforceFieldMetadata maps manifest types to Salesforce field types", () => {
  const text = salesforceFieldMetadata({ propertyName: "AI Score Reason", systemName: "ai_score_reason", type: "text" });
  assert.equal(text.type, "Text");
  assert.equal(text.length, 255);

  const num = salesforceFieldMetadata({ propertyName: "AI Score", systemName: "ai_score", type: "number" });
  assert.equal(num.type, "Number");
  assert.equal(num.precision, 18);
  assert.equal(num.scale, 0);

  const bool = salesforceFieldMetadata({ propertyName: "Flag", systemName: "flag", type: "boolean" });
  assert.equal(bool.type, "Checkbox");
  assert.equal(bool.defaultValue, false);

  const date = salesforceFieldMetadata({ propertyName: "Seen", systemName: "seen", type: "date" });
  assert.equal(date.type, "Date");
});

test("salesforceFieldMetadata carries picklist options through the valueSet", () => {
  const pick = salesforceFieldMetadata({
    propertyName: "Buying Stage",
    systemName: "buying_stage",
    type: "options",
    options: ["Awareness", "Evaluating", "Decision"],
  });
  assert.equal(pick.type, "Picklist");
  const values = (pick.valueSet as { valueSetDefinition: { value: Array<{ fullName: string }> } }).valueSetDefinition.value;
  assert.deepEqual(values.map((v) => v.fullName), ["Awareness", "Evaluating", "Decision"]);

  const multi = salesforceFieldMetadata({ propertyName: "Signals", systemName: "signals", type: "array", options: ["A", "B"] });
  assert.equal(multi.type, "MultiselectPicklist");
  assert.equal(multi.visibleLines, 4);
});

test("salesforceFieldMetadata caps the label at 40 chars", () => {
  const md = salesforceFieldMetadata({
    propertyName: "A very long human readable property name that exceeds the limit",
    systemName: "long_one",
    type: "text",
  });
  assert.ok((md.label as string).length <= 40);
});

test("salesforceObjectFor routes only explicit leads to Lead", () => {
  assert.equal(salesforceObjectFor("lead"), "Lead");
  assert.equal(salesforceObjectFor("Lead"), "Lead");
  assert.equal(salesforceObjectFor("LEAD"), "Lead");
  assert.equal(salesforceObjectFor("contact"), "Contact");
  assert.equal(salesforceObjectFor(undefined), "Contact");
  assert.equal(salesforceObjectFor(null), "Contact");
  assert.equal(salesforceObjectFor(""), "Contact");
});

test("buildSoql assembles bounded queries and defaults fields to Id", () => {
  assert.equal(buildSoql("Contact"), "SELECT Id FROM Contact");
  assert.equal(
    buildSoql("Lead", { fields: ["Id", "Email"], where: "Status = 'Open'", limit: 50 }),
    "SELECT Id, Email FROM Lead WHERE Status = 'Open' LIMIT 50",
  );
});

test("SF_API_VERSION is pinned", () => {
  assert.match(SF_API_VERSION, /^v\d+\.\d+$/);
});
