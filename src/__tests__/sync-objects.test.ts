import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveSyncObjects,
  standardObjects,
  DEFAULT_SYNC_OBJECTS,
} from "../core/lib/sync-objects.js";

const NO_CUSTOM = new Set<string>();

// Salesforce splits people into Contact + Lead; both must be first-class so
// pre-conversion prospects (Leads) aren't silently dropped from a sync.

test("Salesforce defaults include contact, lead, and company (parity with HubSpot people coverage)", () => {
  assert.deepEqual(DEFAULT_SYNC_OBJECTS.salesforce, ["contact", "lead", "company"]);
});

test("HubSpot defaults stay contact + company (single unified people object)", () => {
  assert.deepEqual(DEFAULT_SYNC_OBJECTS.hubspot, ["contact", "company"]);
});

test("resolveSyncObjects accepts 'lead' for Salesforce", () => {
  assert.deepEqual(resolveSyncObjects("salesforce", ["lead"], NO_CUSTOM), ["lead"]);
});

test("resolveSyncObjects drops 'lead' for HubSpot (no such standard object)", () => {
  assert.deepEqual(resolveSyncObjects("hubspot", ["lead"], NO_CUSTOM), []);
});

test("resolveSyncObjects keeps registered custom entities and drops unknown ones", () => {
  const custom = new Set(["deal"]);
  assert.deepEqual(resolveSyncObjects("salesforce", ["deal", "widget"], custom), ["deal"]);
});

test("resolveSyncObjects falls back to provider defaults when none requested", () => {
  assert.deepEqual(resolveSyncObjects("salesforce", undefined, NO_CUSTOM), ["contact", "lead", "company"]);
  assert.deepEqual(resolveSyncObjects("hubspot", [], NO_CUSTOM), ["contact", "company"]);
});

test("standardObjects falls back to contact+company for unknown providers", () => {
  assert.deepEqual([...standardObjects("someCrm")], ["contact", "company"]);
});
