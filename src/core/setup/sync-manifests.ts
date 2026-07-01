import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { client } from "../config.js";
import { logger } from "../lib/logger.js";

const MANIFEST_DIR = path.join(process.cwd(), "manifests", "core");

export interface SyncManifestsResult {
  written: number;
  skipped: number;
  details: string[];
}

type SyncFilter = "all" | "guidelines" | "collections" | "entity-types" | "document-types" | "document-tags" | "graph-relations";

interface SyncOptions {
  dryRun: boolean;
  filter?: SyncFilter;
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function writeIfChanged(filePath: string, content: string, dryRun: boolean, result: SyncManifestsResult, label: string): Promise<void> {
  const { readFile } = await import("node:fs/promises");
  const existing = await readFile(filePath, "utf8").catch(() => null);
  if (existing === content) {
    result.skipped++;
    result.details.push(`Up-to-date: ${label}`);
    return;
  }
  if (dryRun) {
    result.written++;
    result.details.push(`[DRY RUN] Would write: ${label}`);
    return;
  }
  await writeFile(filePath, content, "utf8");
  result.written++;
  result.details.push(`Written: ${label}`);
}

async function syncGuidelines(dryRun: boolean, result: SyncManifestsResult): Promise<void> {
  const res = await (client as any).context?.list?.({ type: "guideline" }).catch(() => null);
  const items: Array<{ name: string; value: string; tags?: string[] }> = res?.data ?? [];
  if (items.length === 0) { logger.info("No guidelines found in Personize; skipping"); return; }

  const dir = path.join(MANIFEST_DIR, "guidelines");
  await ensureDir(dir);

  for (const item of items) {
    if (!item.name || !item.value) continue;
    const slug = item.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const tags = item.tags?.length ? `tags: [${item.tags.map((t: string) => `"${t}"`).join(", ")}]\n` : "";
    const content = `---\nname: ${item.name}\n${tags}---\n\n${item.value.trim()}\n`;
    await writeIfChanged(path.join(dir, `${slug}.md`), content, dryRun, result, `guidelines/${slug}.md`);
  }
}

async function syncCollections(dryRun: boolean, result: SyncManifestsResult): Promise<void> {
  const res = await client.collections.list().catch(() => ({ data: [] }));
  const items = res.data ?? [];
  const dir = path.join(MANIFEST_DIR, "collections");
  await ensureDir(dir);

  for (const col of items) {
    if (!col.slug) continue;
    // Skip system collections — they are defined in the fargate seed, not in this repo.
    if ((col as any).isSystem) { result.skipped++; result.details.push(`Skipped system collection: ${col.slug}`); continue; }
    const content = JSON.stringify(col, null, 2) + "\n";
    await writeIfChanged(path.join(dir, `${col.slug}.json`), content, dryRun, result, `collections/${col.slug}.json`);
  }
}

async function syncContextType(typeName: string, dir: string, filename: string, dryRun: boolean, result: SyncManifestsResult): Promise<void> {
  const res = await (client as any).context?.list?.({ type: typeName }).catch(() => null);
  const items: unknown[] = res?.data ?? [];
  if (items.length === 0) { logger.info(`No ${typeName} found in Personize; skipping`); return; }
  await ensureDir(path.join(MANIFEST_DIR, dir));
  const content = JSON.stringify(items, null, 2) + "\n";
  await writeIfChanged(path.join(MANIFEST_DIR, dir, filename), content, dryRun, result, `${dir}/${filename}`);
}

export async function syncManifests(opts: SyncOptions): Promise<SyncManifestsResult> {
  const { dryRun, filter = "all" } = opts;
  const result: SyncManifestsResult = { written: 0, skipped: 0, details: [] };

  const run = (type: SyncFilter) => filter === "all" || filter === type;

  if (run("guidelines")) await syncGuidelines(dryRun, result);
  if (run("collections")) await syncCollections(dryRun, result);
  if (run("entity-types")) await syncContextType("entity-type", "entity-types", "entity-types.json", dryRun, result);
  if (run("document-types")) await syncContextType("document-type", "document-types", "document-types.json", dryRun, result);
  if (run("document-tags")) await syncContextType("document-tag", "document-tags", "document-tags.json", dryRun, result);
  if (run("graph-relations")) await syncContextType("graph-relation", "graph-relations", "graph-relations.json", dryRun, result);

  logger.info("Sync complete", { written: result.written, skipped: result.skipped });
  return result;
}
