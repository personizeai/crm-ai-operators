import { validateZoneSchema, type ZoneSchema, type ZoneSpec } from './schema.js';
import { buildZonePrompt, type LeadContext } from './prompt.js';
import { processZoneOutput, type ZoneResult } from './postprocess.js';

function applyFallbackStrategy(result: ZoneResult, zone: ZoneSpec): ZoneResult {
  if (result.used_fallback && zone.fallback_strategy === 'hide_if_empty') {
    return { text: '', used_fallback: true, notes: [...result.notes, 'hide_if_empty: wrote empty for template auto-hide'] };
  }
  return result;
}

/**
 * Orchestrates zone generation with per-zone failure isolation: one
 * provider failure costs one zone (its fallback ships), never the batch.
 * The generate dependency is injected; WS4-B wires the engine's ai()
 * runtime here, tests use fakes.
 */
export async function generateZones(
  schema: ZoneSchema,
  guidelines: Record<string, string>,
  lead: LeadContext,
  deps: { generate: (prompt: string) => Promise<string> }
): Promise<{ results: Record<string, ZoneResult>; fallbacks: number; notes: string[] }> {
  const schemaErrors = validateZoneSchema(schema);
  if (schemaErrors.length > 0) {
    throw new Error(`invalid zone schema: ${schemaErrors.join('; ')}`);
  }
  const results: Record<string, ZoneResult> = {};
  const notes: string[] = [];
  let fallbacks = 0;
  for (const zone of schema.zones) {
    const prompt = buildZonePrompt(zone, guidelines, lead);
    let result: ZoneResult;
    try {
      const raw = await deps.generate(prompt);
      result = processZoneOutput(raw, zone);
    } catch (err) {
      result = {
        text: zone.fallback,
        used_fallback: true,
        notes: [`generation failed: ${err instanceof Error ? err.message : String(err)}`]
      };
    }
    result = applyFallbackStrategy(result, zone);
    if (result.used_fallback) fallbacks++;
    for (const n of result.notes) notes.push(`${zone.name}: ${n}`);
    results[zone.name] = result;
  }
  return { results, fallbacks, notes };
}
