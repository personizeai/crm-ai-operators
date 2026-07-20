import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { validateZoneSchema, type ZoneSchema } from "../core/lib/zones/schema.js";
import { parseStaticZones } from "../core/lib/zones/static.js";

const GUIDELINES_DIR = path.join(process.cwd(), "manifests", "core", "guidelines");

function readGuidelineBody(fileName: string): string {
  const raw = readFileSync(path.join(GUIDELINES_DIR, fileName), "utf8");
  return matter(raw).content.trim();
}

describe("shipped guidelines are runnable, not just well-formed markdown", () => {
  test("landing-zone-schema.md body parses as JSON and validates as a zone schema", () => {
    const body = readGuidelineBody("landing-zone-schema.md");
    const parsed = JSON.parse(body) as ZoneSchema;
    assert.deepEqual(validateZoneSchema(parsed), []);
  });

  // The example schema and the example copy are shipped as two separate
  // guideline files that must stay in sync by convention (zone names in the
  // schema must match "## <zone_name>" headings in the copy). Running the
  // real static-zone parser against both, instead of eyeballing them, is the
  // only thing that actually proves they still agree after either one is edited.
  test("landing-zone-copy.md supplies real copy for every zone in landing-zone-schema.md (no zone falls back)", () => {
    const schemaBody = readGuidelineBody("landing-zone-schema.md");
    const schema = JSON.parse(schemaBody) as ZoneSchema;
    const copyBody = readGuidelineBody("landing-zone-copy.md");
    const results = parseStaticZones(copyBody, schema);
    for (const zone of schema.zones) {
      const result = results[zone.name];
      assert.ok(result, `no parsed result for zone "${zone.name}"`);
      assert.equal(
        result.used_fallback,
        false,
        `zone "${zone.name}" fell back to its schema default; landing-zone-copy.md is missing a ` +
          `"## ${zone.name}" section, or that section's content didn't survive processing`,
      );
    }
  });
});
