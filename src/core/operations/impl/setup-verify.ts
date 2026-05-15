import { readdir } from "node:fs/promises";
import path from "node:path";
import { client, ensurePersonizeKey } from "../../config.js";
import { logger } from "../../lib/logger.js";
import type { OperationEntry } from "../types.js";

const MANIFEST_DIR = path.join(process.cwd(), "manifests");

interface VerifyReport {
  auth: boolean;
  org?: string;
  rate_limit?: number | string;
  collections_in_org: number;
  guidelines_in_org: number;
  missing_collections: string[];
  missing_guidelines: string[];
}

async function listManifestSlugs(dir: string, ext: ".json" | ".md"): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(ext))
    .map((entry) => entry.name.replace(new RegExp(`\\${ext}$`), ""));
}

export const setupVerify: OperationEntry = {
  name: "setup.verify",
  mode: "setup",
  description: "Verify Personize auth and report which manifest collections + guidelines are missing in the org.",
  category: "setup",
  status: "live",
  idempotent: true,
  cost: "low",
  run_mode: "manual",
  run: async (_input, context) => {
    ensurePersonizeKey();

    const report: VerifyReport = {
      auth: false,
      collections_in_org: 0,
      guidelines_in_org: 0,
      missing_collections: [],
      missing_guidelines: [],
    };

    // 1. Auth check via client.me()
    try {
      const me = await (client as any).me?.();
      report.auth = Boolean(me?.data ?? me);
      report.org = me?.data?.organization ?? me?.organization;
      report.rate_limit = me?.data?.plan?.limits?.maxApiCallsPerMinute ?? me?.plan?.limits?.maxApiCallsPerMinute;
    } catch (error) {
      logger.warn("Personize auth check failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // 2. List collections in the org and diff against local manifests.
    const collectionsResponse = await client.collections.list().catch((error) => {
      logger.warn("Failed to list collections", {
        error: error instanceof Error ? error.message : String(error),
      });
      return { data: [] as Array<{ slug?: string }> };
    });
    const orgSlugs = new Set<string>(
      (collectionsResponse.data ?? [])
        .map((c) => c.slug)
        .filter((s): s is string => typeof s === "string"),
    );
    report.collections_in_org = orgSlugs.size;

    const coreCollectionsDir = path.join(MANIFEST_DIR, "core", "collections");
    const localCollectionFiles = await listManifestSlugs(coreCollectionsDir, ".json");
    // Manifest filenames are slugs by convention; verify by reading each file's slug field would be more precise.
    report.missing_collections = localCollectionFiles.filter((slug) => !orgSlugs.has(slug));

    // 3. List guidelines in the org and diff against local manifests.
    const guidelinesResponse = await (client as any).context
      ?.list?.({ type: "guideline" })
      .catch((error: unknown) => {
        logger.warn("Failed to list guidelines", {
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });
    const orgGuidelineNames = new Set<string>(
      (guidelinesResponse?.data ?? [])
        .map((g: { name?: string }) => g.name)
        .filter((n: string | undefined): n is string => typeof n === "string"),
    );
    report.guidelines_in_org = orgGuidelineNames.size;

    const coreGuidelinesDir = path.join(MANIFEST_DIR, "core", "guidelines");
    const localGuidelineFiles = await listManifestSlugs(coreGuidelinesDir, ".md");
    report.missing_guidelines = localGuidelineFiles.filter((name) => !orgGuidelineNames.has(name));

    const summary = report.auth
      ? `Auth OK${report.org ? ` (${report.org})` : ""}. ${report.collections_in_org} collections, ${report.guidelines_in_org} guidelines in org. Missing: ${report.missing_collections.length} collections, ${report.missing_guidelines.length} guidelines.`
      : "Auth failed — check PERSONIZE_SECRET_KEY.";

    return {
      ok: report.auth,
      runId: context.runId,
      operation: "setup.verify",
      dryRun: context.dryRun,
      status: "live",
      summary,
      metrics: { ...(report as unknown as Record<string, unknown>) },
    };
  },
};
