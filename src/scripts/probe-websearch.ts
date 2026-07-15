/**
 * Probe: does Personize native `webSearch: true` actually work on this org/plan?
 *
 * The installed SDK (0.16.0) types `webSearch` on PromptOptions, but our ai() wrapper
 * doesn't forward it and the docs don't mention it. This script bypasses the wrapper and
 * calls the SDK directly to find out empirically — BEFORE we depend on it (see
 * docs/tickets/2026-07-15-personize-mcp-and-websearch.md).
 *
 * Run (hosted mode, needs PERSONIZE_SECRET_KEY in .env):
 *   npx tsx src/scripts/probe-websearch.ts
 *
 * It asks a question that requires fresh, post-training-cutoff info, once WITH webSearch
 * and once WITHOUT, and prints whether `metadata.sources` came back. If webSearch is
 * unsupported you'll typically see a 400 `web_search_unsupported`.
 */
import "dotenv/config";
import { Personize } from "@personize/sdk";

const QUESTION =
  "What is the single most recent stable version of Node.js, and on what date was it released? Answer in one sentence.";

async function run(label: string, opts: Record<string, unknown>) {
  const key = process.env.PERSONIZE_SECRET_KEY;
  if (!key) throw new Error("PERSONIZE_SECRET_KEY not set — this probe only runs in hosted mode.");
  const client = new Personize({ secretKey: key, timeout: 60_000 });

  console.log(`\n=== ${label} ===`);
  try {
    // Cast: webSearch is on the SDK PromptOptions type but our wrapper doesn't expose it.
    const res = await (client as any).ai.prompt({ prompt: QUESTION, ...opts });
    const data = res?.data ?? res;
    const text: string = data?.text ?? "(no text)";
    const sources = data?.metadata?.sources ?? [];
    const meta = data?.metadata ?? {};
    console.log("text:", text.trim());
    console.log("model:", meta.model, "| provider:", meta.provider, "| tier:", meta.tier);
    console.log(`sources returned: ${Array.isArray(sources) ? sources.length : 0}`);
    if (Array.isArray(sources) && sources.length) {
      for (const s of sources.slice(0, 5)) console.log("  -", s.url ?? s);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log("ERROR:", msg);
    if (/web_search_unsupported|400/.test(msg)) {
      console.log("→ Native web search appears UNSUPPORTED for this model/plan.");
    }
  }
}

async function main() {
  await run("control: NO webSearch", {});
  await run("test: webSearch: true", { webSearch: true });
  await run("test: webSearch on a subagent", { webSearch: true, agentTools: true });
  console.log(
    "\nInterpretation: if the webSearch runs return sources (and fresher/more accurate text)" +
      " while the control does not, native search works and we can default to it.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
