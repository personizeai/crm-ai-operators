import { z } from "zod";
import { client } from "../config.js";
import { logger } from "./logger.js";

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

  /** Max output tokens. Default 1000. Single-prompt mode only. */
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
// aiPrompt / aiSubagent — the two public verbs.
//
//   aiPrompt   → deterministic structured generation (governed memory on).
//                Use for score.*, analyze.*, report.*, and generate.* extraction.
//   aiSubagent → autonomous, tool-using run (agent tools on, governed memory off).
//                Use for research.*, act.*, and any "plan → use tools → act" task.
//
// Both hit the same /api/v1/prompt endpoint and share this code path; they differ
// only in which SDK verb is invoked (client.ai.prompt vs client.ai.subagent), which
// flips the autonomy defaults server-side. Requires @personize/sdk >= 0.14.0.
// -----------------------------------------------------------------------------

export async function aiPrompt<T extends z.ZodTypeAny>(
  options: AiPromptOptions<T>,
): Promise<AiResult<z.infer<T>>> {
  return runAi(options, "prompt");
}

export async function aiSubagent<T extends z.ZodTypeAny>(
  options: AiPromptOptions<T>,
): Promise<AiResult<z.infer<T>>> {
  return runAi(options, "subagent");
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

  return Array.isArray(options.instructions)
    ? runMultiStep(options, ai, verb)
    : runSinglePrompt(options, ai, verb);
}

// -----------------------------------------------------------------------------
// Single-prompt path — uses client.ai.{prompt|subagent} with the `prompt` field
// -----------------------------------------------------------------------------

async function runSinglePrompt<T extends z.ZodTypeAny>(
  options: AiPromptOptions<T>,
  ai: any,
  verb: "prompt" | "subagent",
): Promise<AiResult<z.infer<T>>> {
  const fullPrompt = buildPrompt(options.context, options.instructions as string);

  const sdkOpts: Record<string, unknown> = {
    prompt: fullPrompt,
    temperature: options.temperature ?? 0.3,
    maxTokens: options.maxTokens ?? 1000,
  };
  attachCommonFields(sdkOpts, options);

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
  if (options.serverOutputs?.length && response?.outputs) {
    return finalizeServerOutputs(options, response);
  }

  // Else: legacy JSON parse path
  const raw = typeof response === "string" ? response : extractText(response);
  return finalizeJsonOutput(options, raw, response);
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

function buildPrompt(context: string | undefined, instructions: string): string {
  return context
    ? `${context}\n\n---\n\nReturn ONLY a JSON object matching the requested schema. No prose, no markdown fences.\n\n${instructions}`
    : `Return ONLY a JSON object matching the requested schema. No prose, no markdown fences.\n\n${instructions}`;
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
  if (typeof ai[verb] === "function") return ai[verb](sdkOpts);
  throw new AiPromptError("sdk_unavailable", `client.ai.${verb} is not a function`);
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
