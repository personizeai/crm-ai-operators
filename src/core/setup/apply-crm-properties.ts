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
// Salesforce: created via the Tooling API's CustomField sObject, which lives
// under /services/data/ and so is reachable through the Personize passthrough
// (idempotent — duplicate fields are skipped). Note: Tooling-created fields are
// hidden from every profile by default, so setup emits a one-line FLS reminder.
// -----------------------------------------------------------------------------

const MANIFEST_DIR = path.join(process.cwd(), "manifests");
const PERSONIZE_PREFIX = "personize_";
const HUBSPOT_GROUP = "personize";
const SF_API_VERSION = "v60.0";
const SF_PREFIX = "Personize_";
/** Salesforce Field labels are capped at 40 chars. */
const SF_LABEL_MAX = 40;

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

/** HubSpot object each collection maps to. Only these are provisioned. */
const COLLECTION_TO_OBJECT: Record<string, string> = {
  contacts: "contacts",
  companies: "companies",
};

/**
 * Salesforce object(s) each collection maps to. The unified `contacts`
 * collection spans both Lead (pre-conversion) and Contact (post-conversion), so
 * writeback fields are provisioned on both — scores land wherever the person is.
 */
const SF_COLLECTION_TO_OBJECTS: Record<string, string[]> = {
  contacts: ["Contact", "Lead"],
  companies: ["Account"],
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
      // The passthrough's error body sometimes nests a structured object under
      // `.error` (e.g. { code, message }) rather than a string — surface that
      // directly, since error.message collapses it to "[object Object]".
      const body = (error as any)?.cause?.response?.data;
      const msg =
        body?.error?.message ?? body?.message ?? (error instanceof Error ? error.message : String(error));
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

/** `ai_score` → `Personize_Ai_Score__c`. Pure — the SF custom-field API name. */
export function salesforceApiName(systemName: string): string {
  const pascal = systemName
    .split("_")
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("_");
  return `${SF_PREFIX}${pascal}__c`;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

function salesforceValueSet(options?: string[]): Record<string, unknown> {
  return {
    valueSetDefinition: {
      sorted: false,
      value: (options ?? []).map((opt) => ({ fullName: opt, default: false, label: opt })),
    },
  };
}

/**
 * Tooling API `CustomField.Metadata` for one manifest property. Pure — maps the
 * manifest's type to a Salesforce field type. Text caps at 255 (single-line);
 * Checkbox carries a required default; Picklist/Multiselect carry the options.
 */
export function salesforceFieldMetadata(p: ManifestProperty): Record<string, unknown> {
  const base: Record<string, unknown> = {
    label: truncate(`Personize ${p.propertyName}`, SF_LABEL_MAX),
    ...(p.description ? { description: p.description, inlineHelpText: truncate(p.description, 255) } : {}),
  };
  switch (p.type) {
    case "number":
      return { ...base, type: "Number", precision: 18, scale: 0 };
    case "boolean":
      return { ...base, type: "Checkbox", defaultValue: false };
    case "date":
      return { ...base, type: "Date" };
    case "options":
      return { ...base, type: "Picklist", valueSet: salesforceValueSet(p.options) };
    case "array":
      return { ...base, type: "MultiselectPicklist", visibleLines: 4, valueSet: salesforceValueSet(p.options) };
    case "text":
    default:
      return { ...base, type: "Text", length: 255 };
  }
}

async function applySalesforceObject(
  object: string,
  props: ManifestProperty[],
  dryRun: boolean,
  result: ApplyCrmPropertiesResult,
): Promise<void> {
  let notedFls = false;
  for (const p of props) {
    const apiName = salesforceApiName(p.systemName);
    const metadata = salesforceFieldMetadata(p);

    if (dryRun) {
      result.created++;
      result.details.push(`[DRY RUN] salesforce/${object}: would create ${apiName} (${metadata.type as string})`);
      continue;
    }

    try {
      await crmPassthrough({
        crm: "salesforce",
        method: "POST",
        path: `/services/data/${SF_API_VERSION}/tooling/sobjects/CustomField`,
        body: { FullName: `${object}.${apiName}`, Metadata: metadata },
      });
      result.created++;
      result.details.push(`salesforce/${object}: created ${apiName}`);
      if (!notedFls) {
        // Tooling-created fields are invisible until FLS is granted.
        result.details.push(
          `salesforce/${object}: grant field-level security on the Personize_* fields to the relevant profiles / permission sets`,
        );
        notedFls = true;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // Salesforce reports a duplicate field via DUPLICATE_* / "already in use".
      if (/DUPLICATE|already exists|already in use/i.test(msg)) {
        result.skipped++;
        result.details.push(`salesforce/${object}: ${apiName} already exists; skipped`);
      } else {
        logger.warn("Failed to create Salesforce field", { object, apiName, error: msg });
        result.details.push(`salesforce/${object}: FAILED ${apiName} — ${msg}`);
      }
    }
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
      for (const sfObject of SF_COLLECTION_TO_OBJECTS[slug] ?? []) {
        await applySalesforceObject(sfObject, props, dryRun, result);
      }
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
