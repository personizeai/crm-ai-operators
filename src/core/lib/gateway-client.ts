import { logger } from "./logger.js";

// -----------------------------------------------------------------------------
// Gateway client — a fetch-based shim that makes the self-hosted Personize
// Private gateway (REST) look like the subset of the @personize/sdk client the
// operations use. No new dependency; translation only.
//
// The lib modules access the client structurally via `(client as any).method`
// and already fail soft when a surface is missing, so this shim implements the
// used surface and maps gateway REST responses to the shapes those callers read:
//
//   client.me()                         -> GET  /whoami
//   client.retrieve({mode,filters})     -> POST /memory/retrieve  (filter query)
//   client.memory.upsert(payload)       -> POST /memory/save      (structured, authoritative properties)
//   client.memory.update(...)           -> (arrayPush unsupported on gateway; throws → caller fails soft)
//   client.memory.retrieve({...})       -> POST /memory/retrieve  (config/record read)
//   client.memory.memorizeBatch({...})  -> POST /memory/import    (async → jobId)
//   client.collections.list()           -> GET  /collections
//   client.context.retrieve({...})      -> POST /memory/retrieve  (recordless → governance docs)
//   client.ai.prompt(opts)              -> POST /prompt
//   (client.ai.subagent is intentionally absent — capability-gated upstream)
//
// STATUS: endpoint contracts follow docs/"Personize Private" handbook v0.5.0.
// The response-shape mappings are best-effort and pending validation against a
// live gateway; everything fails soft and this module is inert unless
// PERSONIZE_MODE=private. See docs/PERSONIZE-PRIVATE.md.
// -----------------------------------------------------------------------------

export interface GatewayClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

interface GatewayHttp {
  get(path: string): Promise<any>;
  post(path: string, body: unknown): Promise<any>;
}

function makeHttp(opts: GatewayClientOptions): GatewayHttp {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${opts.apiKey}`,
  };

  async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      const json = text ? safeJson(text) : undefined;
      if (!res.ok) {
        throw new Error(`Gateway ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
      }
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    get: (path) => call("GET", path),
    post: (path, body) => call("POST", path, body),
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Build a gateway-backed client structurally compatible with the SDK subset the
 * operations use. Typed loosely (returns `any`) because it stands in for the SDK
 * client at the same `(client as any).*` call sites.
 */
export function createGatewayClient(opts: GatewayClientOptions): any {
  const http = makeHttp(opts);

  return {
    // ---- identity / health ------------------------------------------------
    async me() {
      try {
        const who = await http.get("/whoami");
        return {
          success: true,
          data: {
            organization: who?.orgId ?? who?.namespace ?? who?.organization ?? "gateway",
            plan: { limits: {} },
          },
        };
      } catch (error) {
        logger.warn("gateway.me failed", { error: errMsg(error) });
        return { success: false, data: undefined };
      }
    },

    // ---- filtered record query (recall.ts) --------------------------------
    // recall.ts calls client.retrieve({ mode: "filter", filters }) and reads
    // res.records + res.pagination.totalMatched. The gateway wants the filter
    // fields nested under `filters` — which is exactly what recall.ts already
    // sends — so pass them straight through.
    async retrieve(payload: { mode?: string; filters?: unknown }) {
      try {
        const resp = await http.post("/memory/retrieve", { filters: payload.filters });
        const records = resp?.records ?? resp?.data ?? [];
        return {
          records,
          pagination: {
            totalMatched: resp?.pagination?.totalMatched ?? resp?.total ?? records.length,
          },
        };
      } catch (error) {
        logger.warn("gateway.retrieve failed", { error: errMsg(error) });
        return { records: [], pagination: { totalMatched: 0 } };
      }
    },

    // ---- memory writes / reads (persist.ts, orchestrator.ts, bulk) --------
    memory: {
      // Structured, verbatim, authoritative property write. persist.setProperties
      // sends a single payload or { items: [...] }.
      async upsert(payload: any) {
        const items: any[] = Array.isArray(payload?.items) ? payload.items : [payload];
        for (const item of items) {
          const body: Record<string, unknown> = {
            shape: "shortform",
            entityType: item.type,
            properties: item.properties,
          };
          if (item.email) body.email = item.email;
          if (item.websiteUrl) body.websiteUrl = item.websiteUrl;
          if (item.recordId) body.entityId = item.recordId;
          // Gateway extracts per-collection; a properties-only save writes them
          // authoritatively. No content = no extraction, which is what we want here.
          await http.post("/memory/save", body);
        }
        return { success: true };
      },

      // arrayPush has no gateway equivalent; fail soft (appendToProperty catches).
      async update() {
        throw new Error("memory.update (arrayPush) is not supported by the Personize Private gateway");
      },

      // Config / single-record read used by orchestrator.getOrchestratorConfig.
      async retrieve(payload: { collection?: string; filter?: unknown; limit?: number }) {
        try {
          const resp = await http.post("/memory/retrieve", {
            filters: { crmFilter: { collection: payload.collection }, ...(payload.filter ? { where: payload.filter } : {}) },
          });
          return { data: resp?.records ?? resp?.data ?? [] };
        } catch (error) {
          logger.warn("gateway.memory.retrieve failed", { error: errMsg(error) });
          return { data: [] };
        }
      },

      // Bulk memorize → gateway async import. Returns a jobId we surface as eventId.
      async memorizeBatch(payload: any) {
        const resp = await http.post("/memory/import", {
          rows: payload?.rows ?? [],
          mapping: payload?.mapping,
        });
        const jobId = resp?.jobId ?? resp?.data?.jobId ?? "unknown";
        return { data: { eventId: jobId, trackingId: jobId } };
      },
    },

    // ---- collections (persist.collectionIndex) ----------------------------
    collections: {
      async list() {
        try {
          const resp = await http.get("/collections");
          const data = (resp?.data ?? resp?.collections ?? resp ?? []) as any[];
          return { data };
        } catch (error) {
          logger.warn("gateway.collections.list failed", { error: errMsg(error) });
          return { data: [] };
        }
      },
    },

    // ---- governance docs (governance.loadGuideline) -----------------------
    context: {
      async retrieve(payload: { contextNames?: string[]; types?: string[] }) {
        const name = payload?.contextNames?.[0];
        try {
          const resp = await http.post("/memory/retrieve", { message: name });
          const docs = resp?.documents ?? resp?.data ?? [];
          const items = (Array.isArray(docs) ? docs : [docs])
            .map((d: any) => ({ value: d?.content ?? d?.body ?? d?.value }))
            .filter((d: any) => typeof d.value === "string");
          return { data: items };
        } catch (error) {
          logger.warn("gateway.context.retrieve failed", { name, error: errMsg(error) });
          return { data: [] };
        }
      },
    },

    // ---- generation (ai.ts governed prompt path) --------------------------
    // The gateway supports /prompt generation. It has no serverOutputs marker
    // extraction, so ai.ts strips serverOutputs and uses the JSON text path;
    // we return the generated text for that path to parse.
    ai: {
      async prompt(sdkOpts: any) {
        const resp = await http.post("/prompt", {
          prompt: sdkOpts?.prompt,
          context: sdkOpts?.context,
          temperature: sdkOpts?.temperature,
          maxTokens: sdkOpts?.maxTokens,
          tier: sdkOpts?.tier,
          model: sdkOpts?.model,
        });
        return {
          text: resp?.text ?? resp?.output ?? resp?.content ?? (typeof resp === "string" ? resp : ""),
          metadata: resp?.metadata,
        };
      },
      // ai.subagent intentionally omitted — subagent capability is false in
      // private mode, so subagent operations are refused before reaching here.
    },
  };
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
