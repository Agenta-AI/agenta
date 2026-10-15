# Tool & Trigger Gateway: Composio vs Nango vs open-source alternatives

**Status:** Research / decision input — not yet a plan
**Date:** 2026-06-28
**Question:** Agenta is open source and self-hosted, but our agent tools and triggers depend on
Composio (`composio.dev`), a hosted SaaS whose backend is closed-source. Can we add a second
provider — Nango or another open-source layer — so self-hosters get tools/MCPs without depending
on Composio's cloud? What breaks, what's missing, what's hard, and is the result clean or hacky?

> Scope note from the requester: we want something that **works as a backend** and whose main job
> is **adding tools or MCPs**. We do *not* want to adopt a workflow-automation product with a UI
> (n8n / Zapier style) as the integration layer. That lens is applied throughout, and especially in
> §7.

---

## TL;DR

- **Our architecture is already provider-pluggable.** Composio sits behind four clean gateway
  interfaces (catalog, connections, tools, triggers). Adding a `nango` provider is "implement four
  adapter classes + register them," not surgery. The seams are real.
- **But Nango is a different *kind* of product.** Composio is an AI-tool platform: a curated
  catalog of ~20,000 ready-to-call tools, semantic tool search, hosted OAuth, and triggers.
  Nango is **integration infrastructure**: managed OAuth for 800+ APIs + an authenticated proxy +
  a runtime where *you write each tool as TypeScript*. There is **no ready-to-call tool catalog**
  and **no semantic tool search** in Nango. Those two are the big gaps.
- **The biggest losses if we swap to Nango:** (1) the 20k pre-built tools become ~1,000 *cloneable
  code templates* you must clone + deploy per tool; (2) `COMPOSIO_SEARCH_TOOLS` semantic discovery
  has no equivalent — we'd build it ourselves; (3) Nango's agentic features (Actions, Syncs,
  Webhooks, MCP) are **gated behind the paid Enterprise tier when self-hosted** — the free
  self-hosted tier is **auth + proxy only**; (4) Nango is **Elastic License 2.0**, not OSI open
  source, which complicates bundling it into Agenta's OSS distribution.
- **"Not everything is a tool/action" is real and matters.** Nango deliberately splits work into
  Actions (on-demand = tool calls), Syncs (background data replication, e.g. for RAG), Proxy
  (raw authenticated calls), and Webhook/Event functions (inbound events). Only *Actions* map to
  agent tool calls. Syncs/Webhooks/Proxy are extra surface we'd either ignore or build new concepts
  around — they don't fit our current "a tool is a callable" model.
- **For "a backend that adds tools or MCPs" specifically, the cleanest fits are MCP-first, not
  Nango and not n8n.** See §7: **Klavis AI** (Apache-2.0 MCP servers) and **Obot + the MCP server
  ecosystem** (MIT gateway) are headless and tool/MCP-centric. **Activepieces** (MIT) is the most
  capable single OSS package but is a workflow platform, heavier than "just add tools." **n8n is
  ruled out** for embedding (Sustainable Use License forbids shipping it inside a redistributed
  commercial/OSS product without a paid OEM deal).
- **Recommended direction:** treat this as **"add an MCP provider," not "clone Composio."** Our
  config already has a first-class `mcp_servers` field and the runner already bridges MCP. A
  self-hostable MCP layer (Klavis servers and/or an Obot-style gateway, plus Nango *only* as the
  OAuth broker if we need managed auth) gives self-hosters real capability without trying to
  recreate Composio's 20k-tool catalog. Keep Composio as the default/hosted "batteries-included"
  provider; offer the OSS path as the self-host story.

---

## 1. How Agenta does tools & triggers today

Composio is integrated behind a clean **ports-and-adapters** layer in the API, plus an SDK
resolver and a TypeScript runner callback. (Verified in-repo; see file paths.)

### Layers

| Layer | Where | Role |
|---|---|---|
| Catalog adapter | `api/oss/src/core/gateway/catalog/providers/composio/adapter.py` | Browse providers/integrations (`/toolkits`) |
| Connections adapter | `api/oss/src/core/gateway/connections/providers/composio/adapter.py` | OAuth/connect lifecycle (`/auth_configs`, `/connected_accounts/link`) |
| Tools adapter | `api/oss/src/core/tools/providers/composio/adapter.py` | List/get/execute actions (`/tools/{slug}`, `/tools/execute/{slug}`) + **semantic search** via `/tools/execute/COMPOSIO_SEARCH_TOOLS` |
| Triggers adapter | `api/oss/src/core/triggers/providers/composio/adapter.py` | Trigger subscriptions (`ti_*` instances) |
| Wiring | `api/entrypoints/routers.py` (~620–692) | Instantiates the four adapters, guarded by `env.composio.enabled` |
| Dev event tunnel | `api/entrypoints/dispatcher_composio.py` | Subscribes to Composio's WebSocket and forwards events to `POST /triggers/composio/events/` (prod needs a public HTTPS webhook) |
| HTTP API | `api/oss/src/apis/fastapi/tools/router.py`, `.../triggers/router.py` | `POST /tools/resolve`, `POST /tools/call`, `POST /tools/discover`, connection callback, trigger ingest/CRUD |
| SDK resolver | `sdks/python/agenta/sdk/agents/platform/{gateway,resolve}.py` | `resolve_tools` / `resolve_mcp` / `resolve_connection`; posts to `/tools/resolve`, wires callback to `/tools/call` |
| TS runner callback | `services/agent/src/tools/callback.ts` | `callAgentaTool()` — the `POST /tools/call` round-trip every delivery path uses |
| Env | `api/oss/src/utils/env.py` (~508–529) | `COMPOSIO_API_KEY`, `COMPOSIO_API_URL` (default `https://backend.composio.dev/api/v3`), webhook target/url |

### Tool definition model (config side)

`sdks/python/agenta/sdk/agents/tools/models.py` — discriminated union `ToolConfig`:
`BuiltinToolConfig` (Pi native) | **`GatewayToolConfig`** (`type="gateway"`, `provider="composio"`,
`integration`, `action`, `connection` → reference `tools.{provider}.{integration}.{action}.{connection}`)
| `CodeToolConfig` | `ClientToolConfig` | `ReferenceToolConfig` | `PlatformToolConfig`. Shared axes
on the base: `needs_approval`, `render`, `permission`. **`GatewayToolConfig` is literally aliased
`ComposioTool`** in `api/oss/src/core/tools/dtos.py`. There is also a sibling **`mcp_servers`** field
(MCP is a first-class concept already).

### Resolution flow (end-to-end)

1. Agent service calls `resolve_tools(tools_config)` (SDK).
2. SDK `AgentaGatewayToolResolver` POSTs `/tools/resolve` → API `ToolsService.resolve_tools()`.
3. Service verifies the `connection` (by slug, scoped to `project_id`), fetches the action schema
   from Composio's catalog, returns `ResolvedTool(call_ref="tools.composio.{integration}.{action}.{connection}", input_schema=...)`.
4. SDK wraps each as a `CallbackToolSpec` + a `ToolCallback(endpoint="{api}/tools/call")`.
5. **At call time:** runner `callAgentaTool()` POSTs `/tools/call` with the OpenAI function-call
   envelope → API parses the 5-segment `call_ref`, looks up the connection's `provider_connection_id`
   (= Composio `connected_account_id`) → `POST {composio}/tools/execute/{slug}` → third-party →
   result wrapped as an OpenAI tool message back to the runner.

### Auth / connections

- OAuth is **fully delegated to Composio.** We create an `auth_config` + a `connected_account`,
  the user authenticates on Composio's hosted page, Composio captures + stores + refreshes tokens.
- We persist only a local row (`gateway_connections`: `provider_key="composio"`, `integration_key`,
  `provider_connection_id`, `is_active`, `data`). **We never store OAuth tokens.**
- Scoping uses `str(project_id)` as Composio's `user_id` → connections are **project-scoped, not
  per-end-user.** Every user in a project shares the same connected account.
- One platform-level `COMPOSIO_API_KEY` → all Agenta projects share one Composio workspace. **This
  is the hard coupling that makes Composio a poor fit for self-hosters** — there is no free,
  fully-self-hosted Composio backend.

### Triggers today

Triggers are **built and first-class** (not just tools-out). `POST /triggers/composio/events/`
ingests HMAC-signed Composio webhooks → enqueues `triggers.dispatch` (Redis Streams) → a delivery
binds an event (e.g. `github.PULL_REQUEST_EVENT`) + a connected account to a target workflow.
Native cron **schedules** live entirely inside Agenta (no Composio dependency). Gaps: no FE trigger
builder confirmed; same project-level (not per-user) scoping as tools.

### Semantic search today

Yes — we call Composio's `COMPOSIO_SEARCH_TOOLS` meta-tool from
`ComposioToolsAdapter.search_capabilities()`, exposed as `POST /tools/discover`, results translated
to Agenta DTOs in `api/oss/src/core/tools/discovery.py` and cached per use-case in Redis. **This is
Composio-specific and has no abstraction** — it's the single most provider-locked feature we have.

### How pluggable are we, really?

To add a provider you implement four interfaces and register under a new key:
`CatalogGatewayInterface`, `ConnectionsGatewayInterface`, `ToolsGatewayInterface`,
`TriggersGatewayInterface`. **Hard coupling points** to widen: `GatewayToolConfig.provider`
defaults to `"composio"`; `ToolProviderKind.COMPOSIO` enum + `provider_key` validation;
`AgentaGatewayToolResolver.resolve()` rejects non-composio providers
(`UnsupportedToolProviderError`); `dispatcher_composio.py` imports the `composio` Python SDK;
`COMPOSIO_SEARCH_TOOLS` discovery has no port. **Verdict: the swap is feasible and the seams are
clean. The work is not the plumbing — it's that the new provider doesn't *have* the same
capabilities to plug in.**

---

## 2. What Composio gives us (the baseline a replacement must match)

| Capability | Composio |
|---|---|
| Tool catalog | **1,000+ apps, ~20,000 tools**, ready-to-call with **zero integration code** |
| Schemas | Pre-formatted for LLM function-calling (OpenAI default; translated to Anthropic/LangChain/25+ frameworks) |
| Semantic tool search | **`COMPOSIO_SEARCH_TOOLS`** — agent describes a use case, gets 4–6 relevant tools out of 20k without flooding context; plus `important=true` curation + tag filters |
| Auth | Hosted OAuth flows, encrypted token storage, auto-refresh; multi-tenant per-user via `user_id`; inline "Connect Link" the agent can surface itself |
| Triggers | Webhook (realtime) + polling, normalized payloads, signed, per-account `ti_*` instances |
| MCP | Per-session hosted MCP endpoints + enterprise MCP gateway (SSO, governance, audit) |
| Self-host | **Enterprise only; backend is closed-source.** SDKs are MIT, the platform (token store, execution engine, catalog) is proprietary SaaS |
| License | MIT (SDKs) / proprietary (backend) |

**The four things that are genuinely hard to replicate:** (1) the 20k-tool curated catalog,
(2) semantic runtime tool discovery, (3) agent-native inline OAuth, (4) breadth of normalized
triggers. Auth-hosting alone is *not* the moat — Nango matches that.

---

## 3. Nango deep dive

Nango is an **integration runtime**: managed OAuth for **800+ APIs**, an authenticated **Proxy**,
and a runtime for integration logic you write as TypeScript. Codebase is ~96% TS, on GitHub
(`NangoHQ/nango`), **Elastic License 2.0**.

### The four primitives — and why "not everything is a tool" matters

| Primitive | What it is | Maps to a tool call? |
|---|---|---|
| **Actions** | On-demand TypeScript function invoked by name; typed input/output (Zod); returns synchronously | **Yes — this is the agent tool call** |
| **Syncs** | Scheduled/event-driven background jobs that replicate external data into Nango's Postgres cache, with change detection + checkpointing | No — background data pipeline (great for RAG/freshness, not a tool) |
| **Proxy** | Raw authenticated HTTP pass-through (`api.nango.dev/proxy/...`); Nango injects credentials | Partially — a raw call, not a described tool |
| **Webhook / Event functions** | Inbound provider webhooks routed to your code; outbound callbacks on auth/sync events; connection-lifecycle reactions | No — these are triggers/plumbing |

This is the crux of the requester's instinct: **Nango's world is bigger than "tools and actions."**
Syncs, Proxy, and Webhook/Event functions are first-class integration surface that has **no home in
our current model** (where a tool is simply a callable). If we adopt Nango we either ignore those
primitives (wasting much of its value) or grow new Agenta concepts (Syncs → a data-source/RAG
concept; Webhooks → fold into our existing Triggers). Mapping Actions → our tools is clean; the rest
is not a 1:1 fit.

### Auth / connections — the part that *does* match Composio

- 800+ APIs, all auth methods, encrypted storage, auto-refresh, `invalid_credentials` re-auth state.
- A **connection** = one user's authorization for one API, identified by a `connection_id` UUID.
- **Connect sessions + Nango Connect UI**: backend mints a short-lived session token (tags:
  `end_user_id`, `end_user_email`, `organization_id`), frontend embeds the white-label Connect UI,
  Nango fires an auth webhook with the new `connection_id`. **Per-user multi-tenant auth fits
  cleanly** — and is *better* than our current project-scoped model if we want per-end-user auth.

### Pre-built integrations vs custom — the big gap

- **No ready-to-call tool catalog.** Nango ships ~1,000 **templates** (cloneable TS via
  `nango clone hubspot/actions/create-company`) — *starting points you customize + deploy*, not
  pre-hosted callable tools. 800+ APIs get auth + proxy out of the box; only ~1,000 templates have
  a pre-built action/sync to clone.
- **No auto-generated tool schemas** from OpenAPI. You hand-author input/output (Zod + `nango.yaml`),
  AI-assisted.
- For Agenta to expose "GitHub: Create Issue" as a tool, *someone writes/clones + deploys the TS
  action.* That is a large per-tool lift compared to Composio's "call it, done."

### AI / tool-calling fit

- **MCP server: yes** (`api.nango.dev/mcp`, Streamable HTTP; headers `Authorization`, `connection-id`,
  `provider-config-key`). But Nango's *own* engineering blog (Apr 2026) **discourages MCP for
  production** SaaS agents (reliability/latency), saying <10% of prod deployments use it.
- **OpenAI tool format: yes** (`GET /scripts/config?format=openai`). **Anthropic: manual.**
- **Semantic tool discovery: no.** Flat list from `GET /scripts/config`; routing is on the caller.

### Triggers

Three mechanisms: inbound provider webhooks (you write the webhook function + register the URL in
each provider's portal + handle per-provider payloads — Nango does *not* abstract this away);
outbound webhooks from Nango (auth success, sync done, new records); and polling syncs as near-real-
time triggers. **Stronger than Composio for data-sync/event pipelines, weaker on "enable a trigger
per app" convenience** — more developer lift per provider. (Note: this overlaps our existing
Triggers domain; we'd route Nango webhooks into the same `triggers.dispatch` pipeline.)

### Self-hosting + license — the decisive constraints

| Tier | Deploy | Cost | Features |
|---|---|---|---|
| **Free self-hosted** | Docker Compose | Free | **Auth + Proxy only** |
| **Enterprise self-hosted** | Helm / ECS | Paid annual license | Everything: Actions, Syncs, Webhooks, **MCP**, RBAC, SSO, OTel |

- **The agentic features (Actions/MCP) are NOT in the free self-hosted tier.** A self-hosting Agenta
  user gets only auth + proxy for free — i.e. *not* the tool-calling we need.
- Infra for real load: 5 Node services + Postgres (no transaction-pooler) + Redis + Elasticsearch/
  OpenSearch + object storage. Non-trivial but standard.
- **License = Elastic License 2.0 (ELv2), not OSI open source.** Key clause: you may **not** offer
  it to third parties as a managed/hosted service. Bundling Nango into Agenta's OSS docker-compose
  for users who themselves deploy commercially is **legally fraught** and needs counsel. *(Inferred
  legal risk, not a Nango statement.)*

---

## 4. Integration design — how a Nango (or any) provider would slot in

The good news from §1: the gateway abstraction is the right shape. A Nango provider is:

1. **`NangoConnectionsAdapter`** — mint connect sessions, embed Connect UI, store `connection_id`
   in `gateway_connections` (`provider_key="nango"`). *Different flow than Composio's `auth_config` +
   `connected_account`, but conceptually the same lifecycle.* Clean.
2. **`NangoToolsAdapter`** — `list/get/execute`. **Execute is clean** (call the deployed Action,
   or proxy). **List/get is the problem** — there's no catalog to list; tools are whatever TS
   Actions have been deployed to *that* Nango instance. We'd have to define where tool definitions
   come from (a registry we maintain, the `GET /scripts/config` output, or hand-authored configs).
3. **`NangoCatalogAdapter`** — thin/degenerate; "catalog" = the APIs Nango can auth, not callable
   tools. The browse-and-pick-an-action UX Composio gives us mostly disappears.
4. **`NangoTriggersAdapter`** — map Nango inbound/outbound webhooks into our existing
   `/triggers/.../events` pipeline. Feasible; setup per provider is more manual.
5. Widen the coupling points (provider enum, `resolve()` allow-list, config default).

### What's easy vs different vs hard

| Aspect | Easy / same | Different | Hard / new |
|---|---|---|---|
| Plumbing (adapters, wiring) | ✅ ports exist | — | — |
| Execute a tool | ✅ | call shape differs | — |
| Managed OAuth | ✅ matches Composio | session/connection model differs (per-user is *better*) | — |
| **Tool catalog** | — | — | ❌ **no catalog; we define/host tool specs ourselves per deployment** |
| **Semantic tool search** | — | — | ❌ **no equivalent; build our own (vector index over our tool specs)** |
| Triggers | overlaps our domain | per-provider manual setup | webhook registration UX |
| Syncs / Proxy | — | new primitives | ❌ no concept in Agenta; either ignore or design new (RAG/data-source) |
| Self-host story | — | — | ❌ **Actions/MCP need Nango Enterprise; free tier is auth+proxy only** |
| License | — | — | ❌ **ELv2 — can't freely bundle in OSS distro** |

### Is the result clean or hacky?

- **The provider abstraction itself: clean.** This is exactly what ports/adapters are for.
- **Forcing Nango to *be* Composio: hacky.** Faking a "catalog" and a "tool list" from a runtime
  where tools are bespoke TS deployments means we'd ship and maintain our own catalog of TS Actions
  — i.e. we become the catalog vendor. That's a large, ongoing content burden, and it fights
  Nango's grain.
- **Using Nango for what it's *good at*: clean.** Nango as a **managed-OAuth broker** (and optional
  Proxy) behind our connections layer, with **tools delivered via MCP** rather than via Nango
  Actions, is a coherent design that plays to each tool's strengths. (See §7.)

### Scalability / "what does it come with"

- Nango scales fine operationally (it's built for high execution volume) — but **scaling *coverage*
  (the number of tools) does not scale for free**: every new tool is code someone writes/clones/
  deploys. Composio's coverage scales because *they* maintain 20k tools. With Nango, **we** own that
  curve. That's the real scalability question, and it's unfavorable if the goal is breadth.
- It "comes with": real OSS-able auth for 800+ APIs, syncs for RAG, a proxy, observability, CI/CD
  deploy — but also an Elasticsearch dependency, an ELv2 license, and a paywall on the exact agentic
  features we need when self-hosted.

---

## 5. Missing functionality & limitations (direct answers)

- **Semantic search over tools (you remembered right):** Composio has it
  (`COMPOSIO_SEARCH_TOOLS`); **Nango does not.** If we want it on a non-Composio provider we build
  it ourselves (embed tool descriptions, vector search, return top-k into the agent). Doable, but
  it's net-new infrastructure and only as good as the tool descriptions we have.
- **Tool catalog / "important actions" curation:** Composio has it; Nango has cloneable templates,
  not a callable catalog. This is the single biggest missing piece.
- **Inline agent-driven OAuth ("Connect Link as a tool"):** Composio has it; Nango's Connect UI is
  developer-embedded (you build the surface). Achievable, not free.
- **Triggers — what's limited:** Nango *can* do triggers (inbound webhooks, polling syncs), and is
  arguably stronger for data pipelines. The limitation is **per-provider manual setup** (write the
  webhook fn, register the URL, parse the payload) vs Composio's "enable trigger for app X." So the
  limit isn't *which* triggers — it's the **integration labor** per trigger. Both ultimately rely on
  the same provider webhook/polling realities.
- **Self-host paywall:** Nango's tool-calling (Actions/MCP) is Enterprise-only when self-hosted —
  a hard limit for a free OSS self-host story.

---

## 6. Self-hosting Nango alongside Agenta — how hard?

- **Mechanically:** moderate. Docker Compose for free tier; Helm/ECS for Enterprise. It adds
  Postgres (dedicated, no transaction pooler), Redis, and Elasticsearch/OpenSearch to the stack —
  heavier than Agenta's current footprint but not exotic.
- **Practically:** the free self-hosted tier is **auth + proxy only**, so a self-hoster who stands
  up free Nango next to Agenta gets credential management but **not** the Actions/MCP needed to
  actually run tools. To get tools they need Nango Enterprise (paid). So "self-host Nango in parallel
  for free and get Composio-like tools" **does not hold** — that's the key finding.
- **License:** ELv2 means we likely can't ship Nango *inside* Agenta's distribution; at most we
  document "point Agenta at your own Nango." Counsel should confirm.

---

## 7. The lens you asked for: a backend that mainly **adds tools or MCPs**

You don't want a workflow UI; you want a **headless backend that adds tools/MCPs**. With that lens,
the field re-ranks. Our config already has a first-class **`mcp_servers`** field and the runner
already bridges MCP — so **"add an MCP provider" is the lowest-friction, most on-grain path**, and
it's exactly "adding tools or MCPs."

| Option | License | Headless backend? | "Add tools/MCPs" fit | Managed OAuth | Catalog breadth | Notes |
|---|---|---|---|---|---|---|
| **Klavis AI** | Apache-2.0 | ✅ MCP servers as Docker images | ★★★ MCP-native | Partial (broker may be cloud-tethered — verify) | 50–100+ prod MCP servers | Young (YC 2025); cleanest license; **best "add MCPs" fit** |
| **Obot + MCP ecosystem** | MIT (gateway) | ✅ K8s gateway | ★★★ MCP gateway + OAuth 2.1 broker | ✅ OAuth 2.1 + IdP plugins | bring-your-own from MCP registry | You own catalog curation; purest self-contained stack |
| **Nango** | ELv2 | ✅ infra/runtime | ★ Actions are TS you write; MCP exists but Enterprise-gated self-host | ✅ 800+ APIs (its strength) | no callable catalog | Best as an **OAuth broker**, not as the tool catalog |
| **Activepieces** | MIT (CE) | ⚠️ workflow platform w/ UI | ★★ all 200+ "pieces" auto-expose as MCP | ✅ managed `PLATFORM_OAUTH2`, embeddable | 200+ pieces | Most capable single OSS package, but it's an automation *platform*, heavier than "just a backend" |
| **n8n** | Sustainable Use (not OSS) | ⚠️ platform w/ UI | ★★ native MCP server | per-integration (self-configured) | 500+ (best coverage) | **Ruled out for embedding** — SUL forbids shipping inside a redistributed product without paid OEM |
| Raw MCP servers + gateway | mixed (MIT/Apache) | ✅ | ★★★ literally tools/MCPs | ❌ DIY per server | the whole MCP registry (500+) | No managed multi-tenant auth/triggers without a gateway like Obot |

**Reading of this for "add tools or MCPs as a backend":**

- **MCP is the right abstraction for your stated goal.** "Adding a tool" becomes "register an MCP
  server," which we already model. This sidesteps the catalog/semantic-search rebuild entirely —
  MCP servers carry their own tool lists and schemas.
- **Klavis AI** is the most direct fit: Apache-2.0, headless, production MCP servers for the common
  apps (GitHub, Slack, Gmail, Salesforce, Linear, Notion). Open question to verify with them: is the
  **OAuth broker** fully self-hostable, or cloud-tethered? If cloud-tethered, it trades Composio
  lock-in for Klavis lock-in.
- **Obot** is the best **self-hostable MCP gateway** (MIT, OAuth 2.1 broker with Google/GitHub/Okta/
  Auth0 plugins, multi-tenant isolation, audit) — but it has **no pre-built catalog**; you wire MCP
  servers yourself. Obot-as-gateway + Klavis/official MCP servers as the catalog is a credible
  fully-OSS stack.
- **Nango's role, if any, is the OAuth broker** behind MCP servers / our connections layer — not the
  tool catalog. That's the clean way to use it.
- **n8n and Activepieces are workflow-automation platforms.** They *can* emit MCP, but adopting
  either as our integration backend means running a second app with its own UI/engine — against your
  "just a backend" requirement. Activepieces stays in the table because its license is clean and its
  embeddable managed-OAuth is genuinely useful; n8n is out for licensing.

---

## 8. Other open-source / self-hostable alternatives (full scan)

| Candidate | License | Self-host | Verdict |
|---|---|---|---|
| **Activepieces** | MIT (CE) / commercial | ✅ easy (Docker Compose) | Strongest single OSS package (auth + 200+ pieces + MCP + triggers); but it's a workflow platform |
| **Klavis AI** | Apache-2.0 | ⚠️ servers yes; auth broker unclear | Best MCP-native fit; verify self-hosted auth |
| **Obot** + MCP registry | MIT | ✅ K8s | Best OSS gateway; you curate the catalog |
| **n8n** | Sustainable Use (not OSS) | ✅ but OEM-paywalled for embedding | Best coverage; **ruled out** for OSS embedding |
| **Pica** (`picahq/pica`) | GPL-3.0 | ❌ CE abandoned, SaaS-only now | Dead end |
| **Arcade.dev** | SDK MIT; engine closed | ❌ engine closed (enterprise only) | Not viable for OSS self-host |
| **Pipedream Connect** | closed SaaS (Workday-acquired 2025) | ❌ | Not viable |
| Merge.dev / Apideck / Paragon / Integration.app / Unify | closed SaaS | ❌ | Unified-API SaaS; not self-hostable |
| **Toolhouse** | SaaS | ❌ | Not viable |
| **Supaglue** | MIT | ❌ archived Mar 2024 | Defunct |
| **MCPJungle** | OSS | ✅ light router | OAuth not shipped yet |

**Honest framing:** the combination of *(truly self-hostable) + (managed multi-tenant OAuth) +
(broad ready-to-call catalog) + (AI tool schemas)* in one free OSS package **does not exist**.
Composio's depth is genuinely hard to match self-hosted. Every OSS path trades away catalog breadth,
or asks us to own the catalog, or (n8n) is license-blocked.

---

## 9. Recommendation & options

**Reframe the goal.** "Replace Composio with Nango" is the wrong shape — Nango isn't a tool catalog
and its agentic features are paywalled/ELv2 self-hosted. The right framing, matching your "backend
that adds tools or MCPs" requirement, is **"add a self-hostable MCP-based tool provider."**

Three options, in order of how clean they are:

1. **(Recommended) MCP provider, Composio stays the hosted default.**
   Keep Composio as the batteries-included default (great for Agenta Cloud). For self-hosters, add a
   provider that registers **MCP servers** (Klavis Apache-2.0 servers and/or official MCP servers,
   optionally behind an **Obot** gateway for OAuth + multi-tenant isolation). This reuses our
   existing `mcp_servers` concept and runner MCP bridge, avoids rebuilding the catalog and semantic
   search, and gives a real OSS story. Coverage is narrower than Composio but honest and free.
   *Effort: moderate; grain: with our architecture; risk: low.*

2. **Nango as the OAuth broker only.**
   If managed per-user OAuth for many APIs is the actual pain, add Nango **behind the connections
   adapter** for auth, and deliver tools via MCP (option 1) rather than Nango Actions. Avoids the
   "we become the TS-action catalog" trap. Caveat: ELv2 + Enterprise gating still apply to anything
   beyond auth/proxy; confirm license fit for bundling vs "bring your own Nango."

3. **Full Nango provider (Actions = tools).**
   Implement all four adapters against Nango. *Only worth it* if we commit to authoring/curating a
   library of TS Actions ourselves and accept ELv2 + Enterprise self-host gating. This is the most
   work and the most against-the-grain; not recommended as the primary path.

**Open questions to resolve before planning:**
- Legal: can we bundle/recommend ELv2 (Nango) or do we only document "point at your own"?
- Klavis: is the OAuth broker fully self-hostable, or cloud-tethered?
- Do self-hosters actually need 20k tools, or do ~30–50 common apps (GitHub/Slack/Gmail/Notion/
  Linear/Jira/…) cover real demand? That answer decides whether MCP-coverage is "enough."
- Do we want per-end-user auth (Nango/Klavis model) vs today's project-scoped connections?

---

## 10. Why no truly-OSS Composio exists, and how MCP gateways work

### Why there is no open-source Composio

Composio's moat is **content and operations, not code** — the two things open source structurally
can't give away:

1. **The catalog.** ~20,000 tool definitions, hand-built, normalized, and *continuously repaired*
   as upstream APIs drift. That is ongoing human labor, not a static artifact. An OSS repo can hold
   ~50 server definitions; it can't hold a maintained 20k-tool catalog because nobody volunteers to
   fix a provider's schema change on a schedule.
2. **Hosted OAuth at scale.** OAuth for GitHub needs a *registered GitHub OAuth app + client secret*;
   same for Slack, Google, Notion, etc., each with its own registration/review/redirect setup.
   Composio holds thousands of these apps and custodies the resulting user tokens. A self-hoster
   can't inherit them — they must register their own app per provider. **That friction lives at the
   providers, not in the code**, so no OSS project can remove it.

The ecosystem therefore split predictably: **open-source the protocol (MCP) and the plumbing
(gateways, auth brokers); monetize the catalog + hosted credentials.** That's why there are many OSS
gateways and zero OSS "20k tools with hosted OAuth." Nango is the same story from the other side: it
open-sources the auth/runtime engine, but you write every tool yourself.

### How MCP gateways work

A gateway is a reverse proxy + aggregator between agents and a fleet of MCP servers: one endpoint out
front, many servers behind. Four mechanics:

- **Transport bridging.** MCP servers speak **stdio** (local subprocess; same-machine only) or
  **Streamable HTTP** (remote). Most OSS servers are stdio-only. The gateway spawns each stdio server
  as a subprocess/container, talks stdio locally, and exposes HTTP outward.
- **Federation + routing.** Calls `tools/list` on every backend, merges into one catalog,
  **namespaces** with prefixes to avoid collisions (`github_create_issue` vs `gitlab_create_issue`),
  keeps a `tool_name → backend` map, and routes each `tools/call` to the right backend (starting it
  if lazy).
- **Virtual servers / filtering.** A named endpoint exposing a chosen subset of tools — the
  multi-tenancy lever.
- **Lifecycle.** Register via config/API; start eagerly or lazily (Docker spawns the container on
  first call, idles otherwise); health = `tools/list` succeeds.

**Auth is the hard part, in two separate layers** (commonly conflated):

- **Layer A — agent → gateway:** who may use the gateway (API key, or OAuth 2.1 per MCP spec). Easy.
- **Layer B — gateway → third-party API:** the user's actual Google/GitHub token. Needs a 3-legged
  **OAuth broker** that runs consent, stores+refreshes tokens, injects the right one per request, and
  isolates tenants. **This is the expensive part and most gateways don't do it** — it's the same
  thing Composio charges for.

| Gateway | Lang / License | Backend OAuth broker? | Shape |
|---|---|---|---|
| **Obot** (obot-platform/obot) | Go / Apache-2.0 | **Yes** (Google/GitHub/Okta/Entra/Auth0) | Full platform: gateway + registry + broker + chat UI; the one self-hostable option with a real broker; heavier |
| **Klavis** | Apache-2.0 | **Yes** (per-user/per-service) | Per-service servers + unified endpoint; self-host is per-server; auth plumbing leans on a Klavis key |
| **Docker MCP Gateway** | Go / Apache-2.0 | Partial | Servers as signed containers, lazy start, 300+ image catalog, secret injection; Docker-Desktop-bound, dev-oriented |
| **IBM ContextForge** (mcp-context-forge) | Python / Apache-2.0 | **No** | Thin gateway + registry + REST→MCP translation + admin UI; JWT/Basic only |
| **MCPJungle** | Go / MPL-2.0 | **No** (stated gap) | Lightest; tool groups; static bearer tokens only |
| **agentgateway** (Solo.io/LF) | Rust / Apache-2.0 | No | Infra data plane (mTLS/OIDC/OPA); routing+security, not user-delegated auth |

**What a gateway gives vs doesn't.** Gives: federation, routing, transport bridging, governance,
and (Obot/Klavis only) the OAuth broker. **Does not give:** catalog breadth (you supply the servers),
semantic tool search (none — `tools/list` is flat), or triggers (MCP is request/response, no inbound
events).

**Concrete self-host stack for Agenta:** a **gateway** (Obot for a built-in broker, or ContextForge
thin + bring-your-own auth) + **MCP server containers** (official `modelcontextprotocol/servers` +
Docker catalog + Klavis) + an **OAuth broker** (Obot/Klavis built-in, or Nango as a sidecar doing
only token custody). Catalog breadth and semantic search remain ours either way — the honest cost of
leaving Composio.

*Sources: MCP authorization spec (2025-11-25) + transports spec; github.com/obot-platform/obot +
obot.ai/mcp-auth-solution; github.com/IBM/mcp-context-forge; github.com/mcpjungle/MCPJungle;
github.com/docker/mcp-gateway + docs.docker.com/ai/mcp-catalog-and-toolkit; github.com/Klavis-AI/klavis;
agentgateway.dev; docs.stacklok.com/toolhive (vMCP tool aggregation).*

---

## 11. The OAuth-app question (connector code vs OAuth client) — and why MCP changes it

A common confusion ("n8n self-hosts and gives you all integrations, so why do you say you need
thousands of pre-registered OAuth apps?") resolves once two things are separated:

1. **Connector / integration code** — the software that knows an API's endpoints/params/shapes
   ("send a Slack message"). Cheap to share; open source is good at this.
2. **OAuth app (client credentials)** — a registration *you the vendor* create in the provider's
   own developer console (Google Cloud project, Slack app, GitHub OAuth app) yielding a
   `client_id`/`client_secret` that identifies *your software* to that provider. **Not shareable**
   (the secret is yours; the provider binds issued tokens to it). Required to run the user-consent
   screen at all.

### How n8n actually works (verified from n8n docs)

- **Self-hosted n8n:** BYO OAuth app for **every** OAuth service, always. n8n docs:
  *"Managed OAuth2 isn't available for self-hosted n8n users… You must create a custom OAuth2 single
  service credential."* n8n runs the **flow** (redirect/exchange/refresh) but never gives you the
  credentials.
- **n8n Cloud:** pre-registered n8n's **own** OAuth app ("Sign in with Google", zero console setup)
  **only for a named subset of 12 Google nodes** (Gmail, Sheets, Drive, Calendar, Docs, Slides,
  Tasks, Contacts + triggers). Every other Google node and **every non-Google service** is still BYO,
  even on Cloud.

So n8n gives away the **connector code** (500+), not hosted OAuth. Even n8n Cloud only bothered to
pre-register OAuth for ~12 Google nodes — which *confirms* that per-service OAuth-app registration +
token custody is the expensive part. **That is exactly what Composio sells** (hundreds of services).
The connector code was never the moat.

### Does MCP remove the OAuth-app requirement? Two layers, only one removed

- **Layer A — agent → MCP server:** removed. The MCP auth spec uses **Client ID Metadata Documents**
  (preferred) or **Dynamic Client Registration** (deprecated fallback) so a client identifies itself
  to a server with **no human dashboard registration**. ✅
- **Layer B — MCP server → the real third-party API** (e.g. a Gmail MCP server calling Google):
  **not removed.** Google et al. don't support automatic registration, so **someone still needs an
  OAuth app** here. ❌ (Confirmed: the MCP spec explicitly does not cover upstream-API auth.)

**The decisive nuance — who removes Layer B depends on who hosts the server:**

| Path | Connector code | OAuth app (Layer B) | Who maintains |
|---|---|---|---|
| n8n self-host | free (500+) | you, per service, always | you |
| n8n Cloud | free | n8n for ~12 Google nodes; rest BYO | n8n (those 12) |
| Composio | ~20k catalog | Composio, hundreds (hosted, closed/paid) | Composio |
| **First-party remote MCP server** | **the provider** | **the provider** (same company as the API) | **the provider** |
| Self-hosted community MCP server | the author | you, per service | you |

When the **provider runs its own official remote MCP server**, the provider already registered the
OAuth app (it *is* the API), so the user just clicks connect — **we register nothing, maintain no
connector, host no catalog.** Confirmed first-party remote MCP servers (2025–2026): GitHub
(`api.githubcopilot.com/mcp/`), Notion (`mcp.notion.com`), Atlassian (Jira/Confluence), Linear,
Stripe, Asana, Sentry, Cloudflare, Intercom, PayPal/Block, Microsoft (10+). Many launched together
via Cloudflare's "MCP Demo Day."

**Why this matters for Agenta:** the MCP path is the only one where the OAuth-app + maintenance
burden **moves off us onto the provider**, for the growing set of services with first-party remote
servers. For those, a self-hosted Agenta gets click-to-connect tools with no Composio, no catalog of
ours, no OAuth apps of ours. For the long tail with no official server, we fall back to a self-hosted
community server + BYO OAuth — **no worse than n8n self-host.** This is a materially better
self-hosting story than rebuilding Composio.

**Honest caveat:** to connect to a first-party server, Agenta-as-host may need to register *one*
OAuth app per provider for the **client** side (Layer A) — unless we use Client ID Metadata Documents,
which avoids it. That's one app per provider for us, once; not per user, not per tool — a rounding
error next to maintaining hundreds of hosted OAuth apps + a 20k catalog.

*Sources: docs.n8n.io/integrations/builtin/credentials/google (+ /oauth-single-service);
modelcontextprotocol.io authorization + client-registration specs; solo.io/blog
(MCP authorization patterns for upstream API calls); github.blog changelog (remote GitHub MCP GA);
atlassian.com/blog (remote MCP server); developers.notion.com (MCP); blog.cloudflare.com/mcp-demo-day;
developer.microsoft.com/blog (10 Microsoft MCP servers).*

---

## 12. Being an MCP gateway: auth split, gateway functionality, triggers, build paths

This section answers the "what does it mean to be an MCP gateway, and how do we get there" follow-ups.
It supersedes nothing above; it operationalizes §7/§10/§11.

### 12.1 The auth split — most integrations are API keys, not OAuth

Verified across ~35 common integrations:

| Auth type | Share | Who | Cost to support |
|---|---|---|---|
| API key / PAT / static token | **~55%** | OpenAI, Anthropic, GitHub (PAT), GitLab, Linear, Atlassian (API token), Airtable, Sentry, Cloudflare, Twilio, SendGrid, Stripe, all DBs, vector stores | **Near-zero** — store secret, inject header |
| OAuth 2.0 (3-legged) | ~30% | Google Workspace, Salesforce, Notion, Slack/HubSpot/Intercom (distributable), Shopify (public) | **High** — OAuth app + redirect + per-user token store + refresh |
| Hybrid (first-party remote MCP: OAuth or key) | ~10% | GitHub, Stripe, Linear, Atlassian, Cloudflare remote servers | Low (provider carries it) |
| Other (SigV4, DB password) | ~5% | AWS, Postgres/MySQL | Low–medium |

Rule of thumb: **data that belongs to a human's account → OAuth; calling a service as yourself
(operator key) → API key.** The Composio "moat" (pre-registered OAuth apps) only applies to the ~30%
OAuth slice. The API-key 55% has essentially no moat — Agenta's existing vault/named-secrets layer
already covers it. (Sources: provider docs cited in research; OAuth-vs-API-keys analyses.)

**MCP auth mechanics.** stdio servers get creds via `env` at spawn. Remote servers use OAuth 2.1
(PKCE, RFC 9728 PRM, RFC 8707 resource indicators) OR accept an API key/PAT in the connection
`headers`. **Elicitation** (2025-11-25 spec) lets a running server request input from the user, but
the spec **forbids** collecting secrets (API keys/passwords) via in-band "form mode" — sensitive
input must use "URL mode" (a hosted page), which is also how a server kicks off upstream OAuth without
the secret crossing the MCP channel.

**Strategy ladder (cheapest first):** (1) API-key tools + API-key MCP servers — trivial; (2)
first-party remote MCP servers — provider handles OAuth/catalog, many also accept a PAT; (3)
long-tail OAuth — needs a real broker (build on our vault, embed Obot, or use a service).

### 12.2 What "being an MCP gateway" requires (functionality checklist)

A gateway sits between agents and N MCP servers: register servers, auth to each, pull tool lists,
merge + namespace, route calls + inject creds. **We already have several pieces** (noted):

- Server registry (add/remove/list) — *we have `mcp_servers`*
- Transport bridging: stdio subprocess + Streamable HTTP behind one endpoint — *runner bridges MCP*
- Tool aggregation + namespacing (prefix to avoid collisions) + routing
- Per-tenant virtual servers / tool allowlists — *overlaps capability-config*
- Layer-A auth (client → gateway): API key or OAuth
- **Layer-B auth (gateway → backend): per-user OAuth broker + secret store — the real gap**
- Lifecycle: lazy start, health, restart
- Observability: audit log, traces, rate limits — *we have tracing*
- Approval / HITL: intercept a call for human sign-off — *we have `needs_approval`, which most OSS
  gateways lack*

**"Support all MCPs?"** Yes — any spec-compliant server, no per-server code. It means "given a URL or
command we can register + route it," not "we ship every integration." Practical limits: one-time
OAuth-app setup per provider, stdio needs a runtime/sandbox, third-party servers carry trust risk
(tool-description poisoning), so sandbox + allowlist.

### 12.3 Adding a server — the two mechanics

- **Remote (e.g. GitHub `api.githubcopilot.com/mcp/`):** register URL → gateway hits 401 → discovers
  provider AS → OAuth flow (or paste PAT) → store token → reconnect → `tools/list` → merge. Later
  calls inject + auto-refresh the user's token.
- **Self-hosted stdio (npm/uvx):** configure `{command, args, env:{KEY:$vault:ref}}` → on first call
  resolve secret, spawn subprocess, MCP handshake over stdio, list + proxy. Manage lifecycle.

### 12.4 Embedding an existing OSS gateway (don't build from scratch)

Best fit to drive headlessly from our backend (we keep our UX): **IBM ContextForge**
(`mcp-context-forge`, MIT). Full REST API (`POST /gateways` register, `POST /servers` per-project
virtual server, `GET /tools`), team-scoped tokens, REST-to-MCP adapter, Docker/K8s. Its gap is the
per-user Layer-B OAuth broker.

- **Obot** (MIT) is the one OSS gateway with a real built-in OAuth broker, but thinner API + bundles a
  full platform/UI we don't need.
- **Lean: ContextForge for registry/routing + build the OAuth broker on our own vault** (we already
  store per-project secrets; extend to OAuth token custody + refresh). Bounded, avoids Obot lock-in.

Comparison verified: ContextForge (MIT, full REST, virtual servers, partial Layer-B) > Obot (MIT,
full OAuth broker, thin API) > ToolHive (Apache, K8s CRDs, no REST) > MCPJungle (MPL, CLI, no OAuth
yet) > Docker MCP Gateway (MIT, CLI, single-user) > agentgateway (Apache, L4/L7 routing, not a tool
registry).

### 12.5 Triggers are a SEPARATE subsystem (and we already have it)

**MCP is request/response — it has no external-event triggers.** It has session-scoped notifications
(`notifications/tools/list_changed`, resource updates, progress, Tasks for "call now/fetch later"),
but nothing where an outside event ("new email") wakes an agent. The MCP "Triggers & Events" WG was
only chartered **2026-03-24** and has shipped nothing (charter is the sole commit).

So triggers are their own subsystem for everyone. n8n/Composio/Zapier all do it the same way: provider
**webhook** (register a URL) or **polling** (credential + interval, slower) → ingress → dispatch an
agent run. **Agenta already has this** (Composio HMAC webhook ingest + Redis dispatch + native cron
schedules; §1). It is not MCP-specific, so adding the MCP tool path leaves triggers working through
the same pipeline. Tool backend and trigger backend are independent — correct by design.

### 12.6 How n8n does it (the BYO flow), for reference

Self-hosted OAuth: user creates the app in the provider console, **sets redirect URI to
`/rest/oauth2-credential/callback`**, pastes client_id+secret into n8n; n8n runs consent → code
exchange → stores access+refresh tokens encrypted → refreshes automatically → nodes select the stored
credential. API-key services collapse to "paste key → inject header." n8n ships the connector code +
the OAuth *flow* + a trigger system, but the OAuth *client credentials* are BYO on self-host (Cloud
pre-registers only ~12 Google nodes). n8n is also **both an MCP server** (MCP Server Trigger node;
instance server at `/mcp-server/http`) **and an MCP client** (MCP Client Tool node, with
Bearer/Header/OAuth + tool allowlists) — even n8n uses MCP as the interop layer.

### 12.7 Two build paths

- **Yourself (no MCP):** OAuth app or API key + connector code per endpoint + maintenance. Weeks per
  OAuth integration. Use only when no server exists or Agenta-specific behavior is needed.
- **With MCP:** first-party remote server = register URL, provider carries auth + catalog + upkeep
  (minutes); community stdio = configure command + secrets. Fall back to "yourself" for the long tail.

### 12.8 Proposed direction for Agenta

1. Lean into being an **MCP client/gateway**, not a Composio clone (we already have `mcp_servers`,
   runner bridge, vault, HITL, tracing).
2. Ship the cheap **API-key 55%** first (API-key MCP servers + direct API-key tools) — fully
   self-hostable, near-zero cost.
3. Add **first-party remote MCP servers** (GitHub, Notion, Linear, Atlassian, Stripe, Cloudflare);
   PAT-accepting ones stay in the easy lane.
4. **Embed ContextForge** for registry/routing rather than building a gateway from scratch.
5. **Build the OAuth broker on our vault** for the long-tail OAuth services, when demand justifies it
   (the one bounded piece of hard work).
6. **Keep triggers as the existing separate subsystem** (provider webhooks/polling → dispatch).
7. Keep **Composio as the optional hosted provider** for Agenta Cloud (still wins on catalog breadth).

*Sources: modelcontextprotocol.io (authorization, elicitation, transports, triggers-events charter);
ibm.github.io/mcp-context-forge + github.com/IBM/mcp-context-forge; github.com/obot-platform/obot +
obot.ai/mcp-auth-solution; docs.stacklok.com/toolhive; github.com/mcpjungle/MCPJungle;
github.com/docker/mcp-gateway; agentgateway.dev; docs.n8n.io (credentials, MCP nodes, triggers);
provider docs for GitHub/Notion/Atlassian/Linear/Stripe/Cloudflare remote MCP servers;
scalekit.com/blog (OAuth vs API keys for AI agents).*

---

## Sources

**Codebase:** paths cited inline (api gateway adapters, SDK `agenta.sdk.agents.platform`,
`services/agent/src/tools/callback.ts`, `api/oss/src/utils/env.py`).

**Nango:** docs.nango.dev (intro, auth guide, functions guide, tool-calling, self-hosting,
webhooks), nango.dev/blog (composio-vs-nango, nango-clone, best-self-hosted-platforms),
github.com/NangoHQ/nango (ELv2), nango.dev/pricing.

**Composio:** composio.dev/toolkits (1,000+/20,000+), docs.composio.dev (search_tools, triggers,
authentication, native-tools-vs-mcp), composio.dev/mcp-gateway, composio.dev/pricing,
github.com/ComposioHQ/composio (MIT SDKs) + issues/291 + discussions/1037 (self-host = enterprise).

**Alternatives:** github.com/activepieces/activepieces (MIT) + activepieces.com/mcp,
github.com/Klavis-AI/klavis (Apache-2.0), github.com/obot-platform/obot (MIT) + obot.ai,
docs.n8n.io/sustainable-use-license, github.com/picahq/pica (GPL, CE abandoned),
scalekit.com/blog/arcade-alternatives, github.com/supaglue-labs/supaglue (archived),
registry.modelcontextprotocol.io, github.com/docker/mcp-registry, github.com/mcpjungle/MCPJungle.
