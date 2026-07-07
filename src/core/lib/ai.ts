import { z } from "zod";
import { client, hasCapability } from "../config.js";
import { logger } from "./logger.js";
import { reportUsage } from "./usage.js";
import { setProperty } from "./persist.js";

// -----------------------------------------------------------------------------
// Types — mirror the relevant subset of @personize/sdk PromptOptions
// -----------------------------------------------------------------------------

export type InstructionStep = string | { prompt: string; maxSteps?: number };

export interface ServerOutputDefinition {
  /** Marker name. The model emits <output name="..."> in the LAST step. */
  name: string;
  /** Caller-success-gating outputs. Missing → request fails. */
  required?: boolean;
  /** Optional: auto-write the extracted value to a record property (bypass path). */
  collectionId?: string;
  propertyId?: string;
}

export interface EvaluateConfig {
  criteria?: string;
  serverSide?: boolean;
}

export interface MemorizeConfig {
  email?: string;
  websiteUrl?: string;
  recordId?: string;
  type?: "Contact" | "Company" | "User";
  captureToolResults?: boolean;
}

export interface McpToolSelection {
  mcpId: string;
  enabledTools?: string[];
  disabledTools?: string[];
}

export interface PromptAttachmentLite {
  name?: string;
  mimeType: string;
  data?: string;
  url?: string;
}

export type Tier = "basic" | "pro" | "ultra";

// -----------------------------------------------------------------------------
// AiPromptOptions — backward compatible. Existing callers (instructions: string +
// outputs: ZodSchema) keep working unchanged. New callers can pass
// instructions: array, serverOutputs[], evaluate, memorize, tier, mcpTools, etc.
// -----------------------------------------------------------------------------

export interface AiPromptOptions<T extends z.ZodTypeAny> {
  /**
   * When true, runs as an autonomous subagent (agent tools on, governed memory off).
   * Use for research.*, act.*, and any "plan → use tools → act" task.
   * Defaults to false: governed prompt (governed memory on, no tool use) for
   * score.*, analyze.*, report.*, and generate.* structured extraction.
   */
  autonomous?: boolean;

  /**
   * Instructions for the model.
   * - string → single-prompt mode (legacy). The wrapper concatenates context and asks for JSON back.
   * - array  → multi-step mode. Each step is one mental act. Last step emits <output> markers.
   *            Each element can be a plain string OR { prompt, maxSteps } where maxSteps caps tool-loop iterations for that step.
   */
  instructions: string | InstructionStep[];

  /**
   * Zod schema validated against the FINAL response (single-prompt: parsed JSON;
   * multi-step: assembled from server `outputs`). When using multi-step with
   * serverOutputs, this schema should match the assembled outputs object.
   */
  outputs: T;

  /** Context grounding text — guidelines, retrieved memory, policy. Prepended to the prompt. */
  context?: string;

  /** Sampling temperature. Default 0.3. Single-prompt mode only — multi-step uses server defaults per tier. */
  temperature?: number;

  /**
   * Max output tokens. Single-prompt mode only.
   * Default: 2000 for governed prompts; NO default when autonomous (tier default governs).
   */
  maxTokens?: number;

  /** Model override (BYOK). Without BYOK, use `tier` instead. */
  model?: string;

  // ---------- multi-step + full-surface fields (optional, ignored by single-prompt mode) ----------

  /** Cost/quality tier when no BYOK. 'basic' for high-volume deterministic, 'pro' default, 'ultra' for executive-facing. */
  tier?: Tier;

  /** Server-side <output name="..."> extraction definitions. Required when instructions is an array. */
  serverOutputs?: ServerOutputDefinition[];

  /** Server-side rubric eval. true = default criteria; { criteria, serverSide: true } = custom. */
  evaluate?: boolean | EvaluateConfig;

  /** Auto-save outputs to a record. Skips the operation's explicit memory_save call. */
  memorize?: MemorizeConfig;

  /** Per-MCP tool allowlist/denylist. Critical for batch ops with cost-sensitive MCPs. */
  mcpTools?: McpToolSelection[];

  /** Multimodal attachments. In multi-step mode, attached to the FIRST instruction only. */
  attachments?: PromptAttachmentLite[];

  /** Links the run to a record in the journal — always include when processing a specific record. */
  metadata?: { recordId?: string };

  /** Session continuity across calls. */
  sessionId?: string;
}

// -----------------------------------------------------------------------------
// AiResult — backward compatible. New fields are optional and only present
// when multi-step / evaluate / abort response shapes are used.
// -----------------------------------------------------------------------------

export interface AiResult<T> {
  /** The validated, typed output. Single-prompt: parsed JSON. Multi-step: server-extracted outputs. */
  output: T;

  /** Raw model text — for debugging only. */
  raw?: string;

  /** Token + credit usage when reported by the SDK. */
  usage?: {
    tokens?: number;
    cost?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    creditsCharged?: number;
  };

  /** Server-side eval result, when `evaluate` was set. */
  evaluation?: {
    finalScore: number;
    criteriaScores: Array<{ name: string; score: number; maxScore: number; reason: string }>;
    explanation: string;
  };

  /** Per-step breakdown, only present in multi-step mode. */
  steps?: Array<{
    instructionIndex: number;
    prompt: string;
    text: string;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    toolCalls?: Array<{ toolName: string; args?: Record<string, unknown> }>;
  }>;

  /** Names of OPTIONAL outputs the model honestly skipped. */
  skippedOutputs?: string[];

  /** Number of instructions the server actually executed. */
  instructionsExecuted?: number;
}

// -----------------------------------------------------------------------------
// AiPromptError — typed errors for the failure modes (abort, missing-required,
// schema validation). Callers can branch on `kind` to route appropriately.
// -----------------------------------------------------------------------------

export type AiPromptErrorKind =
  | "aborted_by_model"
  | "missing_required_outputs"
  | "schema_validation"
  | "invalid_json"
  | "sdk_unavailable"
  | "sdk_error";

export class AiPromptError extends Error {
  kind: AiPromptErrorKind;
  abortReason?: string;
  missingRequiredOutputs?: string[];
  raw?: string;

  constructor(kind: AiPromptErrorKind, message: string, extras: Partial<AiPromptError> = {}) {
    super(message);
    this.name = "AiPromptError";
    this.kind = kind;
    Object.assign(this, extras);
  }
}

// -----------------------------------------------------------------------------
// ai() — the single public verb.
//
// Both modes hit the same /api/v1/prompt endpoint via the Personize SDK.
// The `autonomous` flag (on AiPromptOptions) picks which SDK verb to invoke:
//
//   autonomous: false (default) → client.ai.prompt
//     Governed memory on. Use for score.*, analyze.*, report.*, generate.*
//     Deterministic structured generation from memory + context.
//
//   autonomous: true → client.ai.subagent
//     Agent tools on, governed memory off. Use for research.*, act.*,
//     and any "plan → use tools → act" task.
//
// Requires @personize/sdk >= 0.14.0.
// -----------------------------------------------------------------------------

export async function ai<T extends z.ZodTypeAny>(
  options: AiPromptOptions<T>,
): Promise<AiResult<z.infer<T>>> {
  return runAi(options, options.autonomous ? "subagent" : "prompt");
}

async function runAi<T extends z.ZodTypeAny>(
  options: AiPromptOptions<T>,
  verb: "prompt" | "subagent",
): Promise<AiResult<z.infer<T>>> {
  const ai = (client as any).ai;
  if (!ai || typeof ai[verb] !== "function") {
    throw new AiPromptError(
      "sdk_unavailable",
      `client.ai.${verb} is not available. Update @personize/sdk to >= 0.14.0.`,
    );
  }

  const result = Array.isArray(options.instructions)
    ? await runMultiStep(options, ai, verb)
    : await runSinglePrompt(options, ai, verb);

  // Report cost to the active per-run usage sink (no-op outside one).
  if (result.usage) {
    reportUsage({
      credits: result.usage.creditsCharged,
      tokens: result.usage.totalTokens ?? result.usage.tokens,
    });
  }

  // serverOutputs client-side fallback: when the backend can't sync outputs to
  // properties server-side (e.g. Personize Private), write them here from the
  // validated output using the same collectionId/propertyId mapping. This makes
  // serverOutputs a declarative contract that runs server- OR client-side.
  if (options.serverOutputs?.length && !hasCapability("serverOutputs") && options.memorize) {
    await applyServerOutputsClientSide(options, result.output);
  }
  return result;
}

async function applyServerOutputsClientSide<T extends z.ZodTypeAny>(
  options: AiPromptOptions<T>,
  output: Record<string, unknown>,
): Promise<void> {
  const m = options.memorize!;
  const type = (m.type ?? "Contact").toLowerCase();
  for (const so of options.serverOutputs ?? []) {
    if (!so.collectionId || !so.propertyId) continue; // unstructured output — nothing to write
    const value = output?.[so.name];
    if (value === undefined || value === null) continue;
    await setProperty(
      { type, email: m.email, websiteUrl: m.websiteUrl, recordId: m.recordId, collection: so.collectionId },
      so.propertyId,
      value,
    );
  }
}

// -----------------------------------------------------------------------------
// Single-prompt path — uses client.ai.{prompt|subagent} with the `prompt` field
// -----------------------------------------------------------------------------

async function runSinglePrompt<T extends z.ZodTypeAny>(
  options: AiPromptOptions<T>,
  ai: any,
  verb: "prompt" | "subagent",
): Promise<AiResult<z.infer<T>>> {
  const instructions = options.instructions as string;
  // Only use the server's <output> marker extraction when the backend supports it.
  // Otherwise fall through to the JSON path and write properties client-side (see runAi).
  const useServerOutputs = Boolean(options.serverOutputs?.length) && hasCapability("serverOutputs");

  // When serverOutputs are defined, the server's <output> marker extraction is the
  // format contract — demanding raw JSON at the same time gives the model two
  // contradictory output formats. Only add the JSON boilerplate (and the injected
  // Zod schema shape) on the parse path.
  const fullPrompt = useServerOutputs
    ? options.context
      ? `${options.context}\n\n---\n\n${instructions}`
      : instructions
    : buildPrompt(options.context, instructions, options.outputs);

  const baseOpts: Record<string, unknown> = {
    prompt: fullPrompt,
    temperature: options.temperature ?? 0.3,
  };
  // Governed prompts get a bounded default. Autonomous runs send no default —
  // research output sizes vary too much for a fixed client cap, and a silent
  // truncation surfaces as a confusing invalid_json error. Explicit values win.
  const maxTokens = options.maxTokens ?? (options.autonomous ? undefined : 2000);
  if (maxTokens !== undefined) baseOpts.maxTokens = maxTokens;
  attachCommonFields(baseOpts, options);

  // Self-repair loop: on a validation failure in the JSON parse path, retry ONCE
  // with the validation error appended so the model can correct its format.
  const MAX_ATTEMPTS = 2;
  let lastError: AiPromptError | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const sdkOpts =
      attempt === 1
        ? baseOpts
        : {
            ...baseOpts,
            prompt:
              `${fullPrompt}\n\n---\n\nYour previous response was rejected: ${lastError!.message}\n` +
              `Respond again following the required format exactly.`,
          };

    let response: any;
    try {
      response = await callAi(ai, sdkOpts, verb);
    } catch (error) {
      logger.error("AI prompt failed", { error: errMsg(error) });
      throw new AiPromptError("sdk_error", errMsg(error));
    }

    if (response?.aborted) {
      throw new AiPromptError("aborted_by_model", `Model aborted: ${response.abortReason ?? "unknown"}`, {
        abortReason: response.abortReason,
      });
    }

    // If serverOutputs are defined, the SDK extracts via XML markers — use those.
    // Server-side extraction failures are not retried here (re-asking rarely fixes them).
    if (useServerOutputs && response?.outputs) {
      return finalizeServerOutputs(options, response);
    }

    // Else: JSON parse path (retryable once on validation failure)
    const raw = typeof response === "string" ? response : extractText(response);
    try {
      return finalizeJsonOutput(options, raw, response);
    } catch (error) {
      const retryable =
        error instanceof AiPromptError &&
        (error.kind === "invalid_json" || error.kind === "schema_validation");
      if (retryable && attempt < MAX_ATTEMPTS) {
        lastError = error as AiPromptError;
        logger.warn("AI response failed validation — retrying once with the error appended", {
          kind: lastError.kind,
        });
        continue;
      }
      throw error;
    }
  }

  // Unreachable: the loop either returns or throws.
  throw lastError ?? new AiPromptError("sdk_error", "runSinglePrompt exited without a result");
}

// -----------------------------------------------------------------------------
// Multi-step path — uses client.ai.{prompt|subagent} with `instructions` array
// -----------------------------------------------------------------------------

async function runMultiStep<T extends z.ZodTypeAny>(
  options: AiPromptOptions<T>,
  ai: any,
  verb: "prompt" | "subagent",
): Promise<AiResult<z.infer<T>>> {
  if (!options.serverOutputs?.length) {
    throw new AiPromptError(
      "schema_validation",
      "Multi-step instructions require `serverOutputs: [{ name, required? }, ...]`. " +
        "Server-side <output> extraction is the only reliable way to capture multi-step results.",
    );
  }
  if (!hasCapability("serverOutputs")) {
    throw new AiPromptError(
      "sdk_unavailable",
      "Multi-step instructions require server-side <output> extraction, which the active " +
        "backend does not support (e.g. Personize Private). Use a single-prompt instruction instead.",
    );
  }

  const sdkOpts: Record<string, unknown> = {
    instructions: options.instructions, // pass through verbatim
  };
  attachCommonFields(sdkOpts, options);

  let response: any;
  try {
    response = await callAi(ai, sdkOpts, verb);
  } catch (error) {
    logger.error("AI multi-step prompt failed", { error: errMsg(error) });
    throw new AiPromptError("sdk_error", errMsg(error));
  }

  if (response?.aborted) {
    throw new AiPromptError("aborted_by_model", `Model aborted: ${response.abortReason ?? "unknown"}`, {
      abortReason: response.abortReason,
    });
  }

  const missing = response?.metadata?.missingRequiredOutputs as string[] | undefined;
  if (missing?.length) {
    throw new AiPromptError(
      "missing_required_outputs",
      `Required outputs missing: ${missing.join(", ")}`,
      { missingRequiredOutputs: missing },
    );
  }

  return finalizeServerOutputs(options, response);
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function buildPrompt(context: string | undefined, instructions: string, outputs?: z.ZodTypeAny): string {
  // Inject the EXACT output shape (keys + types) derived from the Zod schema.
  // Without this, prompts that don't manually enumerate their keys let the model
  // invent its own ({ score } instead of { ai_score }, recent_engagement as an
  // array instead of a string, …) and validation fails. Deriving it from the
  // schema fixes the whole class at the source and can't drift from the schema.
  const shape = outputs ? describeZodShape(outputs) : undefined;
  const directive = shape
    ? `Return ONLY a JSON object with EXACTLY this shape — these keys and types, no others, no extra keys. No prose, no markdown fences.\n\nOutput shape:\n${shape}`
    : "Return ONLY a JSON object matching the requested schema. No prose, no markdown fences.";
  return context
    ? `${context}\n\n---\n\n${directive}\n\n${instructions}`
    : `${directive}\n\n${instructions}`;
}

/**
 * Render a compact, human-readable description of a Zod schema's shape — keys,
 * types, ranges, enum values — so the model knows exactly what JSON to emit.
 * Handles the constructs the operations use; unknown nodes degrade to "value".
 */
function describeZodShape(schema: z.ZodTypeAny, depth = 0): string {
  const def: any = (schema as any)?._def;
  if (!def || depth > 6) return "value";
  switch (def.typeName) {
    case "ZodObject": {
      const shape = typeof def.shape === "function" ? def.shape() : def.shape;
      const entries = Object.entries(shape).map(
        ([k, v]) => `${JSON.stringify(k)}: ${describeZodShape(v as z.ZodTypeAny, depth + 1)}`,
      );
      return `{ ${entries.join(", ")} }`;
    }
    case "ZodString": {
      const checks = def.checks ?? [];
      const min = checks.find((c: any) => c.kind === "min")?.value;
      const max = checks.find((c: any) => c.kind === "max")?.value;
      return min != null || max != null ? `string (${min ?? 0}-${max ?? "∞"} chars)` : "string";
    }
    case "ZodNumber": {
      const checks = def.checks ?? [];
      const isInt = checks.some((c: any) => c.kind === "int");
      const min = checks.find((c: any) => c.kind === "min")?.value;
      const max = checks.find((c: any) => c.kind === "max")?.value;
      const range = min != null || max != null ? ` (${min ?? ""}–${max ?? ""})` : "";
      return `${isInt ? "integer" : "number"}${range}`;
    }
    case "ZodBoolean":
      return "boolean";
    case "ZodEnum":
      return `one of: ${(def.values as string[]).map((v) => JSON.stringify(v)).join(" | ")}`;
    case "ZodNativeEnum":
      return `one of: ${Object.values(def.values).map((v) => JSON.stringify(v)).join(" | ")}`;
    case "ZodLiteral":
      return JSON.stringify(def.value);
    case "ZodArray":
      return `array of ${describeZodShape(def.type, depth + 1)}`;
    case "ZodOptional":
      return `${describeZodShape(def.innerType, depth)} (optional)`;
    case "ZodNullable":
      return `${describeZodShape(def.innerType, depth)} or null`;
    case "ZodDefault":
      return describeZodShape(def.innerType, depth);
    case "ZodEffects":
      return describeZodShape(def.schema, depth);
    case "ZodUnion":
      return (def.options as z.ZodTypeAny[]).map((o) => describeZodShape(o, depth)).join(" | ");
    case "ZodRecord":
      return "object (string-keyed)";
    default:
      return "value";
  }
}

function attachCommonFields(sdkOpts: Record<string, unknown>, options: AiPromptOptions<any>): void {
  if (options.context) sdkOpts.context = options.context;
  if (options.model) sdkOpts.model = options.model;
  if (options.tier) sdkOpts.tier = options.tier;
  if (options.serverOutputs?.length) sdkOpts.outputs = options.serverOutputs;
  if (options.evaluate !== undefined) sdkOpts.evaluate = options.evaluate;
  if (options.memorize) sdkOpts.memorize = options.memorize;
  if (options.mcpTools?.length) sdkOpts.mcpTools = options.mcpTools;
  if (options.attachments?.length) sdkOpts.attachments = options.attachments;
  if (options.metadata) sdkOpts.metadata = options.metadata;
  if (options.sessionId) sdkOpts.sessionId = options.sessionId;
}

async function callAi(
  ai: any,
  sdkOpts: Record<string, unknown>,
  verb: "prompt" | "subagent",
): Promise<any> {
  if (typeof ai[verb] !== "function") {
    throw new AiPromptError("sdk_unavailable", `client.ai.${verb} is not a function`);
  }
  const raw = await ai[verb](sdkOpts);
  return resolvePromptResult(raw);
}

// -----------------------------------------------------------------------------
// resolvePromptResult — bridge the async prompt API.
//
// /api/v1/prompt runs ASYNC by default: it returns a 202 ack
//   { success, message, data: { eventId, status } }
// and the result is delivered out-of-band. (The documented sync switch,
// `stream:true`, returns an empty 200 body in this deployment, so we don't use
// it.) We poll GET /api/v1/events/:eventId until the status is terminal, then
// return `data.responsePayload` — shaped { success, text, outputs?, evaluation?,
// metadata } — exactly what the downstream finalizers already expect.
//
// A synchronous response (no eventId) is passed straight through unchanged.
// -----------------------------------------------------------------------------
const TERMINAL_EVENT_STATUS = new Set(["completed", "partial_completed", "failed", "failed_stale"]);
const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 120; // ~180s ceiling

async function resolvePromptResult(raw: any): Promise<any> {
  const eventId = raw?.data?.eventId ?? raw?.eventId;
  if (!eventId) return raw; // already synchronous — has text/outputs inline

  const http = (client as any).client;
  if (!http || typeof http.get !== "function") {
    throw new AiPromptError(
      "sdk_error",
      `Async prompt ack (event ${eventId}) received but the SDK HTTP client is unavailable to poll for the result.`,
    );
  }

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);
    let body: any;
    try {
      const resp = await http.get(`/api/v1/events/${eventId}`);
      body = resp?.data ?? resp;
    } catch (error) {
      throw new AiPromptError("sdk_error", `Polling prompt event ${eventId} failed: ${errMsg(error)}`);
    }
    const data = body?.data ?? body;
    const status = data?.status as string | undefined;
    if (!status || !TERMINAL_EVENT_STATUS.has(status)) continue;

    if (status === "failed" || status === "failed_stale") {
      const detail = data?.responsePayload?.error ?? data?.error ?? "no detail";
      throw new AiPromptError("sdk_error", `Prompt event ${eventId} ${status}: ${detail}`);
    }
    const payload = data?.responsePayload;
    if (!payload) {
      throw new AiPromptError("sdk_error", `Prompt event ${eventId} reached '${status}' but carried no responsePayload.`);
    }
    return payload;
  }

  throw new AiPromptError(
    "sdk_error",
    `Prompt event ${eventId} did not complete within ${(POLL_INTERVAL_MS * POLL_MAX_ATTEMPTS) / 1000}s.`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function finalizeServerOutputs<T extends z.ZodTypeAny>(
  options: AiPromptOptions<T>,
  response: any,
): AiResult<z.infer<T>> {
  const validated = options.outputs.safeParse(response.outputs);
  if (!validated.success) {
    throw new AiPromptError(
      "schema_validation",
      `Server outputs did not match Zod schema: ${validated.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }

  return {
    output: validated.data,
    raw: response.text,
    usage: response.metadata?.usage
      ? {
          promptTokens: response.metadata.usage.promptTokens,
          completionTokens: response.metadata.usage.completionTokens,
          totalTokens: response.metadata.usage.totalTokens,
          tokens: response.metadata.usage.totalTokens,
          creditsCharged: response.metadata.creditsCharged,
        }
      : undefined,
    evaluation: response.evaluation,
    steps: response.steps,
    skippedOutputs: response.metadata?.skippedOutputs,
    instructionsExecuted: response.metadata?.instructionsExecuted,
  };
}

function finalizeJsonOutput<T extends z.ZodTypeAny>(
  options: AiPromptOptions<T>,
  raw: string,
  response: any,
): AiResult<z.infer<T>> {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new AiPromptError(
      "invalid_json",
      `AI response was not valid JSON. First 200 chars: ${cleaned.slice(0, 200)}`,
      { raw: cleaned },
    );
  }

  const validated = options.outputs.safeParse(parsed);
  if (!validated.success) {
    throw new AiPromptError(
      "schema_validation",
      `AI response did not match output schema: ${validated.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
      { raw: cleaned },
    );
  }

  return {
    output: validated.data,
    raw: cleaned,
    usage: response?.metadata?.usage
      ? {
          promptTokens: response.metadata.usage.promptTokens,
          completionTokens: response.metadata.usage.completionTokens,
          totalTokens: response.metadata.usage.totalTokens,
          tokens: response.metadata.usage.totalTokens,
          creditsCharged: response.metadata.creditsCharged,
        }
      : undefined,
  };
}

function extractText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.text === "string") return r.text;
    if (typeof r.content === "string") return r.content;
    if (typeof r.output === "string") return r.output;
    if (Array.isArray(r.content) && r.content[0] && typeof r.content[0] === "object") {
      const first = r.content[0] as Record<string, unknown>;
      if (typeof first.text === "string") return first.text;
    }
  }
  return JSON.stringify(result);
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
