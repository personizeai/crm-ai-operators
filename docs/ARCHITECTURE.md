# Architecture — How CRM AI Operators Works

> One-page visual tour. All diagrams render natively on GitHub.

## 1. The big picture

Your CRM data lives in **Personize** (governed memory). The **engine** (this repo) decides *what work needs doing* and dispatches it. Every AI action is gated by plain-English **guidelines** your team owns.

```mermaid
flowchart LR
  subgraph CRM["Your CRM"]
    direction TB
    HS[HubSpot]
    SF[Salesforce]
  end

  subgraph ENGINE["crm-ai-operators — open source, runs anywhere<br/>(laptop · Docker · Kubernetes)"]
    direction TB
    TRIG["Triggers<br/>webhooks (HMAC) · cron · CLI · MCP agents"]
    DISP["<b>Dispatcher</b><br/>routes are DATA, not code"]
    RUN["Operation runner<br/>run store + audit trail"]
    OPS["<b>29 governed operations</b><br/>score · research · generate · analyze<br/>act · sync · report · optimize"]
    TRIG --> DISP --> RUN --> OPS
  end

  subgraph PZ["Personize — hosted OR self-hosted (Private gateway)"]
    direction TB
    MEM[("<b>Memory</b><br/>contacts · companies<br/>conversations · signals")]
    GOV["<b>Governance</b><br/>18 plain-English guidelines<br/>(ICP, scoring policy, brand voice…)"]
    AI["<b>AI runtime</b><br/>tiers · multi-step · output→property sync"]
  end

  HS <--> MEM
  SF <--> MEM
  DISP -- "filter: which records<br/>need work? (server-side)" --> MEM
  OPS -- "RECALL" --> MEM
  OPS -- "GOVERN" --> GOV
  OPS -- "ACT — ai()" --> AI
  AI -- "STORE — properties<br/>+ memories, auto-synced" --> MEM
```

**Key idea:** the engine is stateless and cheap — all heavy AI work is offloaded to Personize. Even sequential dispatch handles thousands of records/day on a small VM.

## 2. Every operation runs the same loop

```mermaid
sequenceDiagram
    autonumber
    participant D as Dispatcher
    participant P as Personize
    participant O as Operation

    D->>P: filter query — "which records need work?"<br/>(server-side, indexed = re-run prevention)
    P-->>D: only stale/eligible records
    D->>O: run(record) + tier/model override from route
    O->>P: RECALL — what do we know about this record?
    O->>P: GOVERN — load required guidelines
    O->>P: ACT — ai() with typed schema (Zod-validated)
    P-->>O: validated output (properties auto-written server-side)
    O->>P: STORE — workspace note · audit event · run record
    Note over D,P: ok:false or throw → nothing claimed,<br/>error counted, circuit breaker bumps
```

## 3. Five dispatch patterns — chosen per route, in data

```mermaid
flowchart TB
  R["Route (a record in Personize)<br/><code>filter_json · target · max_per_cycle<br/>tier_override · model_override</code>"]
  R --> Q{dispatch mode}

  Q -->|"sequential<br/>(default)"| S["One record at a time<br/>✔ errors isolated<br/>✔ predictable throughput<br/><i>writes to shared state, high-cost AI</i>"]
  Q -->|"parallel: true"| P["Concurrent, capped (default 8)<br/>✔ wall-clock ≈ slowest record<br/>✔ one failure ≠ cancel the rest<br/><i>independent research / enrichment / scoring</i>"]
  Q -->|"dispatch_mode:<br/>batch"| B["ONE call, full record list<br/>✔ no double-recall<br/>✔ atomic (all-or-nothing)<br/><i>bulk memorize · aggregate reports</i>"]
  Q -->|"target_chain:<br/>[op, op, …]"| C["Per-record pipeline<br/>✔ ordered ops, stop-on-failure<br/>✔ each step gates the next<br/><i>research → score → generate</i>"]
  Q -->|"target_type:<br/>triage"| T["Agent picks the op per record<br/>✔ route decided at run time<br/>✔ one lane, many outcomes<br/><i>mixed inbound · unknown intent</i>"]
```

Routes also carry **cost control**: `tier_override` (basic / pro / ultra) and `model_override` (BYOK) — route the quick-scan lane to a cheap tier and the executive-facing lane to ultra, without touching operation code.

## 4. Safety model — why it's trustable in production

| Layer | Mechanism |
|---|---|
| Default posture | `DRY_RUN=true` until you explicitly authorize live writes |
| Governance | Operations refuse to run without their required guidelines installed |
| Re-run prevention | Staleness lives in the route *filter* (server-side) + `skip_if` in the op — idempotence means a crash-and-rerun is free |
| Failure handling | `ok:false` or throw → record not claimed, error counted; error threshold pauses the whole orchestrator (circuit breaker) |
| Audit | Every run: audit events + run record (scanned/updated/summary) persisted to Personize |
| Security | HMAC-signed webhooks (fail-closed), SSRF-guarded outbound, body-size limits |

## 5. Deployment: hosted or fully private

```mermaid
flowchart LR
  E["crm-ai-operators<br/>(same code, both modes)"]
  E -->|"hosted mode<br/>PERSONIZE_SECRET_KEY"| H["Personize Cloud<br/>full surface: subagent research,<br/>evaluate rubric, Bedrock bulk"]
  E -->|"private mode<br/>gateway URL + key"| G["Personize Private gateway<br/>one Docker container<br/>your Postgres · your LLM (even local)<br/><b>raw CRM data never leaves your network</b>"]
```

**The pitch in one sentence:** an open-source library of 29 governed, audited, idempotent AI operations over your CRM — orchestrated by data-driven routes, gated by guidelines your team writes in English, at ~$0.003/memorize and ~$0.001/recall, deployable down to fully air-gapped.
