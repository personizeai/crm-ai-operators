import { readFile } from "node:fs/promises";
import path from "node:path";

const STATE_PATH = path.join(process.cwd(), "data", "state", "dry_run.txt");
let cached: boolean | null = null;

export async function isDryRun(): Promise<boolean> {
  if (cached !== null) return cached;
  if (process.env.DRY_RUN === "false") {
    cached = false;
    return cached;
  }
  try {
    const raw = (await readFile(STATE_PATH, "utf8")).trim().toLowerCase();
    cached = raw !== "false";
  } catch {
    cached = true;
  }
  return cached;
}

export function resetDryRunCache(): void {
  cached = null;
}
