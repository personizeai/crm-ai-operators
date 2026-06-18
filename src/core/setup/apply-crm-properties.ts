import { readFile } from "node:fs/promises";
import path from "node:path";
import { crmPassthrough } from "../../adapters/passthrough.js";
import { logger } from "../lib/logger.js";
import type { CrmId } from "../operations/types.js";

// -----------------------------------------------------------------------------
// apply-crm-properties — provisions the `personize_*` custom properties on the
// connected CRM (Phase 6).
//
// Source of truth: the contacts/companies collection manifests. Only properties
// flagged `writeback: true` are provisioned (any provenance — inferred OR
// extracted), prefixed `personize_`, so the AI scores AND structured enrichment
// fields (e.g. employee_count) land in the CRM while CRM-origin keys and
// internal log/array fields stay Personize-side.
//
// HubSpot: created via the Properties API (idempotent — existing props skipped).
// Salesforce: custom fields require the Metadata API (not plain REST), so we
// emit the list of fields to create as a documented manual step.
// -----------------------------------------------------------------------------

const MANIFEST_DIR = path.join(process.cwd(), "manifests");
const PERSONIZE_PREFIX = "personize_";
const HUBSPOT_GROUP = "personize";

interface ManifestProperty {
  propertyName: string;
  systemName: string;
  type: "text" | "number" | "boolean" | "date" | "options" | "array";
  options?: string[];
  description?: string;
  source?: "inferred" | "extracted" | "crm";
  writeback?: boolean;
}

interface ManifestCollection {
  slug: string;
  properties: ManifestProperty[];
}

/** CRM object each collection maps to. Only these are provisioned. */
const COLLECTION_TO_OBJECT: Record<string, string> = {
  contacts: "contacts",
  companies: "companies",
};

interface HubspotFieldType {
  type: "string" | "number" | "bool" | "date" | "enumeration";
  fieldType: "text" | "number" | "booleancheckbox" | "date" | "select" | "checkbox";
}

function hubspotFieldType(p: ManifestProperty): HubspotFieldType {
  switch (p.type) {
    case "number":
      return { type: "number", fieldType: "number" };
    case "boolean":
      return { type: "bool", fieldType: "booleancheckbox" };
    case "date":
      return { type: "date", fieldType: "date" };
    case "options":
      return { type: "enumeration", fieldType: "select" };
    case "array":
      return { type: "enumeration", fieldType: "checkbox" };
    case "text":
    default:
      return { type: "string", fieldType: "text" };
  }
}

async function loadCollection(slug: string): Promise<ManifestCollection | null> {
  try {
    const raw = await readFile(path.join(MANIFEST_DIR, "core", "collections", `${slug}.json`), "utf8");
    return JSON.parse(raw) as ManifestCollection;
  } catch {
    return null;
  }
}

function writebackProps(collection: ManifestCollection): ManifestProperty[] {
  return collection.properties.filter((p) => p.writeback === true);
}

interface ApplyCrmPropertiesOptions {
  crm: CrmId;
  dryRun: boolean;
}

export interface ApplyCrmPropertiesResult {
  created: number;
  skipped: number;
  manual: number;
  details: string[];
}

async function applyHubspotObject(
  objectType: string,
  props: ManifestProperty[],
  dryRun: boolean,
  result: ApplyCrmPropertiesResult,
): Promise<void> {
  // Ensure the property group exists (idempotent — 409 means it already does).
  if (!dryRun) {
    await crmPassthrough({
      crm: "hubspot",
      method: "POST",
      path: `/crm/v3/properties/${objectType}/groups`,
      body: { name: HUBSPOT_GROUP, label: "Personize", displayOrder: -1 },
    }).catch(() => undefined);
  }

  for (const p of props) {
    const name = `${PERSONIZE_PREFIX}${p.systemName}`;
    const ft = hubspotFieldType(p);
    const payload: Record<string, unknown> = {
      name,
      label: `Personize ${p.propertyName}`,
      groupName: HUBSPOT_GROUP,
      type: ft.type,
      fieldType: ft.fieldType,
      description: p.description,
    };
    if (ft.type === "enumeration" && p.options?.length) {
      payload.options = p.options.map((opt, i) => ({ label: opt, value: opt, displayOrder: i }));
    }

    if (dryRun) {
      result.created++;
      result.details.push(`[DRY RUN] hubspot/${objectType}: would create ${name} (${ft.type})`);
      continue;
    }

    try {
      await crmPassthrough({
        crm: "hubspot",
        method: "POST",
        path: `/crm/v3/properties/${objectType}`,
        body: payload,
      });
      result.created++;
      result.details.push(`hubspot/${objectType}: created ${name}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // HubSpot returns 409 PROPERTY_ALREADY_EXISTS when the field is present.
      if (/409|already exists|PROPERTY_ALREADY_EXISTS/i.test(msg)) {
        result.skipped++;
        result.details.push(`hubspot/${objectType}: ${name} already exists; skipped`);
      } else {
        logger.warn("Failed to create HubSpot property", { objectType, name, error: msg });
        result.details.push(`hubspot/${objectType}: FAILED ${name} — ${msg}`);
      }
    }
  }
}

function describeSalesforceManual(
  objectType: string,
  props: ManifestProperty[],
  result: ApplyCrmPropertiesResult,
): void {
  for (const p of props) {
    const apiName = `Personize_${p.systemName
      .split("_")
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join("_")}__c`;
    result.manual++;
    result.details.push(`salesforce/${objectType}: create custom field ${apiName} (${p.type}) — Metadata API / manual`);
  }
}

export async function applyCrmProperties(options: ApplyCrmPropertiesOptions): Promise<ApplyCrmPropertiesResult> {
  const { crm, dryRun } = options;
  const result: ApplyCrmPropertiesResult = { created: 0, skipped: 0, manual: 0, details: [] };

  for (const [slug, objectType] of Object.entries(COLLECTION_TO_OBJECT)) {
    const collection = await loadCollection(slug);
    if (!collection) continue;
    const props = writebackProps(collection);
    if (props.length === 0) continue;

    if (crm === "hubspot") {
      await applyHubspotObject(objectType, props, dryRun, result);
    } else if (crm === "salesforce") {
      describeSalesforceManual(objectType, props, result);
    } else {
      logger.warn("CRM property provisioning not implemented for this CRM; skipping", { crm });
    }
  }

  logger.info("CRM property provisioning complete", {
    crm,
    dryRun,
    created: result.created,
    skipped: result.skipped,
    manual: result.manual,
  });
  return result;
}
