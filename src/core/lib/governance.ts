import { client } from "../config.js";
import { logger } from "./logger.js";

/**
 * Load a single guideline by name from Personize. Returns the guideline body
 * as a plain string, or "" if not found / unavailable.
 *
 * Operations should call this for every guideline in their `guidelines_required`
 * before acting. Missing governance is a hard failure mode for any `act.*` or
 * `generate.*` operation.
 */
export async function loadGuideline(name: string): Promise<string> {
  const context = (client as any).context;
  try {
    // Fetch the guideline by name. context.list is a deterministic by-name/id
    // lookup (GET /api/v1/context) — NOT context.retrieve, which is semantic
    // doc-routing and requires a `message` query (it 400s without one).
    const result = await context?.list?.({ type: "guideline" });
    const items: Array<{ name?: string; slug?: string; value?: string; content?: string }> =
      Array.isArray(result) ? result : (result?.data ?? []);
    const match = items.find((item) => item.name === name || item.slug === name);
    if (match) return match.value ?? match.content ?? "";
  } catch (error) {
    logger.warn(`Failed to load guideline '${name}'`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return "";
}

/**
 * Load multiple guidelines in parallel. Returns a map of name → body.
 * Missing guidelines have value "".
 */
export async function loadGuidelines(names: string[]): Promise<Record<string, string>> {
  const entries = await Promise.all(
    names.map(async (name) => [name, await loadGuideline(name)] as const),
  );
  return Object.fromEntries(entries);
}

/**
 * List the names of guidelines that came back empty from a loadGuidelines call.
 * Operations use this to fail fast when required governance is missing.
 */
export function missingGuidelines(loaded: Record<string, string>): string[] {
  return Object.entries(loaded)
    .filter(([, value]) => !value)
    .map(([name]) => name);
}
