import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { OPERATIONS } from "../core/operations/registry.js";

// Same source of truth apply-manifests.ts uses: manifests/core/ is always
// applied, relative to the process cwd (the repo root when `npm test` runs).
const GUIDELINES_DIR = path.join(process.cwd(), "manifests", "core", "guidelines");

/**
 * Every shipped guideline's frontmatter `name:`, the only names loadGuideline
 * can ever resolve (see governance.ts: it matches on item.name or item.slug,
 * sourced from this same frontmatter at setup.apply time). Reading the
 * frontmatter directly, instead of trusting the filename, is what catches a
 * guideline whose filename and declared `name:` have drifted apart.
 */
function shippedGuidelineNames(): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync(GUIDELINES_DIR)) {
    if (!file.endsWith(".md")) continue;
    const parsed = matter(readFileSync(path.join(GUIDELINES_DIR, file), "utf8"));
    const data = parsed.data as Record<string, unknown>;
    if (typeof data.name === "string" && data.name.length > 0) names.add(data.name);
  }
  return names;
}

describe("guideline wiring", () => {
  const shipped = shippedGuidelineNames();

  test("shipped guideline manifest directory is non-empty (sanity check)", () => {
    assert.ok(shipped.size > 0, "expected at least one shipped guideline under manifests/core/guidelines/");
  });

  // Structural regression guard: every op.guidelines_required entry must name
  // a guideline that actually ships, by its frontmatter name (not a
  // Title Case display label, not a filename guess). This is the class of
  // bug that already shipped once: an op referencing a guideline name that
  // doesn't match any shipped frontmatter name, so loadGuideline always
  // returns "" and the op fails closed with "Missing required guidelines".
  test("every operation's guidelines_required names a shipped guideline", () => {
    const missing: string[] = [];
    for (const op of Object.values(OPERATIONS)) {
      for (const name of op.guidelines_required ?? []) {
        if (!shipped.has(name)) missing.push(`${op.name} -> "${name}"`);
      }
    }
    assert.deepEqual(missing, [], `unwired guidelines_required (operation -> missing name): ${missing.join(", ")}`);
  });

  // generate.landing-zones loads these two by literal string at runtime
  // (loadGuideline("landing-zone-schema") / ("landing-zone-copy")), outside
  // its own guidelines_required array, so the check above never sees them.
  test("generate.landing-zones' runtime-loaded guidelines are shipped", () => {
    for (const name of ["landing-zone-schema", "landing-zone-copy"]) {
      assert.ok(shipped.has(name), `expected a shipped guideline named "${name}"`);
    }
  });
});
