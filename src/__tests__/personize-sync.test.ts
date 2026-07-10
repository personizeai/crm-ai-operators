import { test } from "node:test";
import assert from "node:assert/strict";
import {
  connectionProbe,
  classifyProbeStatus,
  connectionOutcome,
  isNotConnectedError,
} from "../adapters/personize-sync.js";

// connectionProbe — the paths must stay inside each provider's passthrough
// allowlist (hubspot `/crm/`, salesforce `/services/data/`) or the probe 400s
// before it can ever confirm the connection.

test("connectionProbe builds a bounded, allowlisted read for HubSpot", () => {
  const probe = connectionProbe("hubspot", "contact");
  assert.equal(probe?.path, "/crm/v3/objects/contacts");
  assert.equal(probe?.query?.limit, 1);
  assert.ok(probe!.path.startsWith("/crm/"), "must be under the HubSpot allowlist prefix");
});

test("connectionProbe pluralizes custom entities for HubSpot", () => {
  assert.equal(connectionProbe("hubspot", "deal")?.path, "/crm/v3/objects/deals");
  assert.equal(connectionProbe("hubspot", "ticket")?.path, "/crm/v3/objects/tickets");
});

test("connectionProbe uses an object-agnostic path for Salesforce", () => {
  const probe = connectionProbe("salesforce", "contact");
  assert.equal(probe?.path, "/services/data/");
  assert.ok(probe!.path.startsWith("/services/data/"), "must be under the Salesforce allowlist prefix");
});

test("connectionProbe returns undefined for providers with no probe", () => {
  assert.equal(connectionProbe("apollo", "contact"), undefined);
});

// classifyProbeStatus — the tri-state that keeps "not connected" distinct from
// "couldn't check".

test("classifyProbeStatus treats 2xx as connected", () => {
  assert.equal(classifyProbeStatus(200), true);
  assert.equal(classifyProbeStatus(204), true);
});

test("classifyProbeStatus treats 401/403 as definitively disconnected", () => {
  assert.equal(classifyProbeStatus(401), false);
  assert.equal(classifyProbeStatus(403), false);
});

test("classifyProbeStatus treats 5xx / missing status as inconclusive", () => {
  assert.equal(classifyProbeStatus(500), undefined);
  assert.equal(classifyProbeStatus(0), undefined);
  assert.equal(classifyProbeStatus(undefined), undefined);
});

// connectionOutcome — the core regression: a template existing must no longer
// read as "this will work". Only a definitive disconnection blocks the dry-run.

test("connectionOutcome: verified connection is ok and confirmed", () => {
  assert.deepEqual(connectionOutcome(true), { ok: true, connectionVerified: true });
});

test("connectionOutcome: definitive disconnection fails the dry-run", () => {
  assert.deepEqual(connectionOutcome(false), { ok: false, connectionVerified: false });
});

test("connectionOutcome: inconclusive probe stays ok but is not claimed verified", () => {
  assert.deepEqual(connectionOutcome(undefined), { ok: true, connectionVerified: false });
});

// isNotConnectedError — definitive "not connected" signals must flip the dry-run,
// while transient failures stay inconclusive. The connection_not_found case is the
// exact error a live org with no Salesforce connection returns.

test("isNotConnectedError catches auth rejections", () => {
  assert.equal(isNotConnectedError(new Error("HubSpot 401 Unauthorized")), true);
  assert.equal(isNotConnectedError(new Error("403 forbidden")), true);
});

test("isNotConnectedError catches Personize connection_not_found (live-observed)", () => {
  assert.equal(
    isNotConnectedError(new Error('{"code":"connection_not_found","message":"No active salesforce connection found."}')),
    true,
  );
  assert.equal(isNotConnectedError(new Error("provider not connected")), true);
});

test("isNotConnectedError leaves transient failures inconclusive", () => {
  assert.equal(isNotConnectedError(new Error("503 Service Unavailable")), false);
  assert.equal(isNotConnectedError(new Error("network timeout")), false);
});
