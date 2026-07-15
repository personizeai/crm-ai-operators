# Ticket → Personize platform team

**Date:** 2026-07-15
**From:** crm-ai-operators
**SDK under test:** `@personize/sdk@0.16.0`

Two related gaps found while wiring web research for operator subagents. Both are
about **doing setup fully from code/API instead of the UI**. Items are independent —
please answer each.

---

## 1. `webSearch` / `agentTools` — documentation + SDK-surface confirmation

### What we found
`dist/types.d.ts` `PromptOptions` (line ~955) exposes fields that are **not documented**
in our copy of the SDK docs and that we'd like to rely on:

```ts
webSearch?: boolean | PromptWebSearchConfig;  // native model web search
agentTools?: boolean;                         // load full agent tool registry
governedMemory?: boolean;
autoRecall?: boolean;
autoGuidelines?: boolean;
mcps?: boolean | string[];                    // select org MCPs (distinct from mcpTools)

interface PromptWebSearchConfig {
  enabled?: boolean;
  maxUsesPerStep?: number;
  allowedDomains?: string[];
  blockedDomains?: string[];
}
// results returned on metadata.sources: { url, title?, snippet? }[]
```

Both `client.ai.prompt` and `client.ai.subagent` take the same `PromptOptions`.

### Questions
1. **Is `webSearch: true` GA and safe to depend on** for both `prompt` and `subagent`?
   Any plan tier / model restrictions?
2. Which **models/providers** support native web search? The typings mention a
   `400 web_search_unsupported` — can we get the supported-model list so we can gate on it?
3. On **managed (non-BYOK) tiers** (`basic`/`pro`/`ultra`) — does `webSearch` work, or is it
   BYOK-only? (We believe it's independent of BYOK; please confirm.)
4. Does `webSearch` work in **Personize Private / gateway** mode, or hosted-only?
5. Please **document** `webSearch`, `agentTools`, `governedMemory`, `autoRecall`,
   `autoGuidelines`, `mcps` in the SDK reference (they're currently undocumented, and the
   reference cites a stale `PromptOptions` line number).

### Why it matters to us
If `webSearch: true` is dependable, we can default research subagents to **native search**
with zero MCP setup, and treat Tavily/Parallel.ai MCPs as an optional upgrade — removing a
silent-failure setup step for every user.

---

## 2. MCP registration + credentialing via REST API (no UI)

### What we found
`dist/types.d.ts` defines a full MCP management contract:

```ts
interface CreateMcpOptions { name; serverUrl; transportType: 'sse'|'http'|'streamable-http';
                             authType: 'bearer'|'api_key'|'none'; apiKey?; description?; }
interface UpdateMcpOptions { ...; apiKey?; status?: 'active'|'disabled'; }
interface McpTestOptions   { serverUrl; transportType; authType; apiKey?; }
interface McpTestResponse  { connected: boolean; tools?; toolsCount?; error?; }
interface McpResponse      { id; name; serverUrl; status; tools[]; ... }
```

…but the SDK client exposes **no `client.mcps` namespace** and ships **no HTTP path** for
these. So today we can't register an MCP or set its API key from code — it appears to require
the Personize UI.

We've built a thin REST helper (`src/core/setup/register-mcps.ts`) that POSTs the credential
directly, but we **guessed the routes** from the orphaned types:

- `GET  /api/v1/mcps`        → list
- `POST /api/v1/mcps`        → create (body = `CreateMcpOptions`, incl. `apiKey`)
- `POST /api/v1/mcps/test`   → connection probe (body = `McpTestOptions` → `McpTestResponse`)

### Questions
1. **What are the real REST routes** for list / create / update / delete / test-connection of
   an org MCP? (We'll drop our guesses and use yours; the path is configurable via
   `PERSONIZE_MCP_API_PATH`.)
2. Does **create accept the `apiKey`** so the whole register+credential flow is code-only, or
   must the credential still be set in the UI?
3. **Auth mapping:** for a remote MCP that wants a bearer token
   (e.g. Tavily `Authorization: Bearer`, Parallel.ai `Authorization: Bearer`), do we send
   `authType: 'bearer'` + `apiKey`, and Personize injects the header? For key-in-query-param
   MCPs (Tavily also supports `?tavilyApiKey=`), is that `authType: 'api_key'`? Please define
   how each `authType` is applied to the outbound MCP connection.
4. Is there really **no managed catalog/marketplace** of known MCPs (install-by-name)? Our
   product owner says not for now — confirming so we always send full `serverUrl` + transport.
5. Will a **future SDK expose a typed `client.mcps`** namespace? If so, when — we'd switch off
   the raw-REST helper.

### Provider configs we're registering (from their docs)
| MCP | serverUrl | transport | auth |
|---|---|---|---|
| Tavily | `https://mcp.tavily.com/mcp/` | streamable-http | bearer (or `?tavilyApiKey=`) |
| Parallel.ai | `https://search.parallel.ai/mcp` | streamable-http | bearer (free anon at lower limits) |

### Why it matters to us
Our `setup.apply` never registered MCPs and `setup.verify` never checked them, so users could
finish "setup" with research ops silently broken. We now register + probe from code — but it
only works if the REST contract above is right.
