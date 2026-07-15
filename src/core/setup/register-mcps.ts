import { PERSONIZE_API_BASE_URL, PERSONIZE_MODE } from "../config.js";
import { logger } from "../lib/logger.js";

// ---------------------------------------------------------------------------
// MCP registration + credentialing via the Personize REST API.
//
// WHY A RAW REST HELPER (not the SDK):
// The installed @personize/sdk (0.16.0) defines CreateMcpOptions / UpdateMcpOptions /
// McpTestOptions / McpResponse in its typings but exposes NO `client.mcps` namespace
// and ships NO HTTP path for them (the old register-mcps.ts called
// `(client as any).mcps?.register?.(...)`, which silently no-ops). Until a newer SDK
// surfaces a typed `client.mcps`, we talk to the REST endpoints directly so a user can
// register an MCP AND set its credential without touching the Personize UI.
//
// ENDPOINT CONTRACT — UNVERIFIED. The routes below are INFERRED from the SDK's orphaned
// types and MUST be confirmed with the Personize team (see
// docs/tickets/2026-07-15-personize-mcp-and-websearch.md). If the real routes differ,
// override the base path via PERSONIZE_MCP_API_PATH — no code change needed. The helper
// degrades gracefully: any non-2xx is recorded in `errors`, never thrown past
// registerMcps()/verifyMcps(), so `setup.apply` never fails because of MCP wiring.
//
// PROVIDER CONFIGS come from each provider's own docs:
//   Tavily      — https://mcp.tavily.com/mcp/   (streamable-http; key via bearer header)
//   Parallel.ai — https://search.parallel.ai/mcp (streamable-http; free anon, bearer for higher limits)
// The user chooses which to enable by setting TAVILY_API_KEY and/or PARALLEL_API_KEY.
// ---------------------------------------------------------------------------

type TransportType = "sse" | "http" | "streamable-http";
type AuthType = "bearer" | "api_key" | "none";

interface McpCatalogEntry {
  name: string;
  description: string;
  serverUrl: string;
  transportType: TransportType;
  /** authType used when an API key IS supplied. */
  authType: AuthType;
  /** env var holding the provider API key. */
  apiKeyEnv: string;
  /** when true, register anonymously (authType→"none") if the key env var is unset. */
  optionalKey?: boolean;
}

// Web-search MCPs the operator's research subagents can use. CRM MCPs
// (hubspot/salesforce) authenticate via a CRM connectionId, not an apiKey, so
// they are provisioned separately and are intentionally NOT in this catalog.
const MCP_CATALOG: McpCatalogEntry[] = [
  {
    name: "tavily",
    description: "Tavily web search for account and contact research",
    serverUrl: "https://mcp.tavily.com/mcp/",
    transportType: "streamable-http",
    authType: "bearer",
    apiKeyEnv: "TAVILY_API_KEY",
  },
  {
    name: "parallel-search",
    description: "Parallel.ai web search + fetch for account and contact research",
    serverUrl: "https://search.parallel.ai/mcp",
    transportType: "streamable-http",
    authType: "bearer",
    apiKeyEnv: "PARALLEL_API_KEY",
    optionalKey: true, // Parallel Search is free anonymously at lower rate limits
  },
];

const MCP_API_PATH = process.env.PERSONIZE_MCP_API_PATH ?? "/api/v1/mcps";

export interface McpStatus {
  name: string;
  connected: boolean;
  registered: boolean;
  toolsCount?: number;
  error?: string;
}

export interface RegisterMcpsResult {
  registered: string[];
  skipped: string[];
  connected: string[];
  errors: string[];
}

// --- Raw REST plumbing -----------------------------------------------------

interface McpResponse {
  id: string;
  name: string;
  serverUrl: string;
  transportType: string;
  authType: string;
  status: string;
  tools?: Array<{ name: string }>;
}

async function mcpFetch(pathSuffix: string, init: RequestInit): Promise<Response> {
  const key = process.env.PERSONIZE_SECRET_KEY;
  return fetch(`${PERSONIZE_API_BASE_URL}${MCP_API_PATH}${pathSuffix}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key ?? ""}`,
      ...(init.headers ?? {}),
    },
  });
}

async function listMcps(): Promise<McpResponse[]> {
  try {
    const res = await mcpFetch("", { method: "GET" });
    if (!res.ok) {
      logger.warn("MCP list failed", { status: res.status });
      return [];
    }
    const json = (await res.json()) as { data?: McpResponse[] } | McpResponse[];
    return Array.isArray(json) ? json : (json.data ?? []);
  } catch (error) {
    logger.warn("MCP list threw", { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

async function testMcp(opts: {
  serverUrl: string;
  transportType: TransportType;
  authType: AuthType;
  apiKey?: string;
}): Promise<{ connected: boolean; toolsCount?: number; error?: string }> {
  try {
    const res = await mcpFetch("/test", { method: "POST", body: JSON.stringify(opts) });
    if (!res.ok) return { connected: false, error: `HTTP ${res.status}` };
    const json = (await res.json()) as
      | { data?: { connected?: boolean; toolsCount?: number; error?: string } }
      | { connected?: boolean; toolsCount?: number; error?: string };
    const data = ("data" in json && json.data ? json.data : json) as {
      connected?: boolean;
      toolsCount?: number;
      error?: string;
    };
    return { connected: Boolean(data.connected), toolsCount: data.toolsCount, error: data.error };
  } catch (error) {
    return { connected: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function createMcp(entry: McpCatalogEntry, authType: AuthType, apiKey?: string): Promise<boolean> {
  const res = await mcpFetch("", {
    method: "POST",
    body: JSON.stringify({
      name: entry.name,
      description: entry.description,
      serverUrl: entry.serverUrl,
      transportType: entry.transportType,
      authType,
      ...(apiKey ? { apiKey } : {}),
    }),
  });
  if (!res.ok) {
    logger.warn("MCP create failed", { name: entry.name, status: res.status });
    return false;
  }
  return true;
}

// --- Public API ------------------------------------------------------------

/**
 * Register (and credential) the web-search MCPs whose API keys are configured.
 * Idempotent: probes the connection first, skips MCPs already registered, and
 * skips MCPs whose key env var is unset (unless the provider allows anonymous use).
 * Only runs in hosted mode — the private gateway has no MCP surface.
 */
export async function registerMcps(): Promise<RegisterMcpsResult> {
  const result: RegisterMcpsResult = { registered: [], skipped: [], connected: [], errors: [] };

  if (PERSONIZE_MODE === "private") {
    logger.info("MCP registration skipped — private gateway has no MCP surface");
    result.skipped.push(...MCP_CATALOG.map((m) => `${m.name} (private mode)`));
    return result;
  }

  const existingNames = new Set((await listMcps()).map((m) => m.name));

  for (const entry of MCP_CATALOG) {
    const apiKey = process.env[entry.apiKeyEnv];
    const hasKey = Boolean(apiKey);

    if (!hasKey && !entry.optionalKey) {
      result.skipped.push(`${entry.name} (set ${entry.apiKeyEnv} to enable)`);
      continue;
    }
    const authType: AuthType = hasKey ? entry.authType : "none";

    // 1. Probe the connection before registering (McpTestOptions/connected).
    const probe = await testMcp({
      serverUrl: entry.serverUrl,
      transportType: entry.transportType,
      authType,
      apiKey,
    });
    if (!probe.connected) {
      result.errors.push(`${entry.name}: connection probe failed — ${probe.error ?? "not connected"}`);
      continue;
    }
    result.connected.push(entry.name);

    // 2. Create only if not already registered.
    if (existingNames.has(entry.name)) {
      result.skipped.push(`${entry.name} (already registered)`);
      continue;
    }
    if (await createMcp(entry, authType, apiKey)) {
      result.registered.push(entry.name);
      logger.info("Registered MCP", { name: entry.name, authType });
    } else {
      result.errors.push(`${entry.name}: registration request failed`);
    }
  }

  return result;
}

/**
 * Read-only health check for setup.verify: which catalog MCPs are registered and
 * whether they currently connect. Warns about keys set for an MCP that never
 * registered, and MCPs enabled without a key. Never throws.
 */
export async function verifyMcps(): Promise<McpStatus[]> {
  if (PERSONIZE_MODE === "private") return [];

  const registered = new Set((await listMcps()).map((m) => m.name));
  const statuses: McpStatus[] = [];

  for (const entry of MCP_CATALOG) {
    const apiKey = process.env[entry.apiKeyEnv];
    const hasKey = Boolean(apiKey);
    if (!hasKey && !entry.optionalKey) {
      // Not enabled by the user — report as not-registered without probing.
      statuses.push({ name: entry.name, connected: false, registered: registered.has(entry.name) });
      continue;
    }
    const authType: AuthType = hasKey ? entry.authType : "none";
    const probe = await testMcp({
      serverUrl: entry.serverUrl,
      transportType: entry.transportType,
      authType,
      apiKey,
    });
    statuses.push({
      name: entry.name,
      connected: probe.connected,
      registered: registered.has(entry.name),
      toolsCount: probe.toolsCount,
      error: probe.error,
    });
  }

  return statuses;
}
