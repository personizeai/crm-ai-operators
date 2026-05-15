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
    const result = await context?.retrieve?.({
      contextNames: [name],
      types: ["guideline"],
    });
    if (typeof result === "string") return result;
    if (result?.data) {
      const items = Array.isArray(result.data) ? result.data : [result.data];
      const texts = items
        .map((item: { value?: string; content?: string }) => item.value ?? item.content)
        .filter((t: string | undefined): t is string => typeof t === "string");
      return texts.join("\n\n");
    }
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
