import type { ApiResponse } from "@personize/sdk";

export class PersonizeError extends Error {
  constructor(message: string, public readonly code?: string, public readonly raw?: unknown) {
    super(message);
    this.name = "PersonizeError";
  }
}

export function unwrapOrThrow<T>(res: ApiResponse<T>): T {
  if (!res?.success || res.data === undefined) {
    throw new PersonizeError(
      res?.error ?? res?.message ?? "Personize API error",
      typeof res?.error === "string" ? res.error : undefined,
      res,
    );
  }
  return res.data;
}

/**
 * Produce a legible message from a Personize SDK / Axios error.
 *
 * The SDK's error formatter (toPersonizeError) interpolates `body.message` /
 * `body.error` straight into a template string. When the API returns a
 * *structured* error payload (object or array — e.g. a validation report), that
 * coercion yields the useless "[object Object]" and the real reason is lost.
 * The original AxiosError is preserved on `.cause`, so we recover the raw
 * response body from there and render it faithfully (JSON-stringifying non-string
 * shapes), then re-attach the HTTP status and request context.
 */
export function describeApiError(err: unknown): string {
  const e = err as {
    message?: string;
    status?: number;
    method?: string;
    endpoint?: string;
    cause?: { response?: { status?: number; data?: unknown } };
  };

  const status = e?.status ?? e?.cause?.response?.status;
  const detail = extractErrorDetail(e?.cause?.response?.data);

  if (detail) {
    const parts: string[] = [];
    if (status !== undefined) parts.push(`HTTP ${status}`);
    if (e?.method && e?.endpoint) parts.push(`${e.method} ${e.endpoint}`);
    return parts.length ? `${detail} (${parts.join("; ")})` : detail;
  }

  // No recoverable body — the SDK's own message already carries "(METHOD url)".
  return typeof e?.message === "string" && e.message ? e.message : String(err);
}

/** Pull a human-readable string out of a possibly-structured error body. */
function extractErrorDetail(body: unknown): string | undefined {
  if (body == null) return undefined;
  if (typeof body === "string") return body || undefined;
  if (typeof body !== "object") return String(body);

  const b = body as Record<string, unknown>;
  // Common structured shapes: { message }, { error }, { error: { message } },
  // { detail }, { details: [...] }, { errors: [...] }, zod-style { issues: [...] }.
  for (const candidate of [b.message, b.error, b.detail, b.details, b.errors, b.issues]) {
    const s = stringifyDetail(candidate);
    if (s) return s;
  }
  // Nothing recognizable — stringify the whole body so it's at least legible.
  return safeStringify(b);
}

function stringifyDetail(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return v || undefined;
  if (typeof v === "object") {
    const nested = (v as Record<string, unknown>).message;
    if (typeof nested === "string" && nested) return nested;
    return safeStringify(v);
  }
  return String(v);
}

function safeStringify(v: unknown): string | undefined {
  try {
    const s = JSON.stringify(v);
    return s && s !== "{}" && s !== "[]" ? s : undefined;
  } catch {
    return undefined;
  }
}
