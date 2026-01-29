# Tool Integration Platforms (Composio vs Arcade vs ACI)

This document focuses on platforms that let an LLM/agent call real tools (Gmail, Slack, GitHub, etc.) while handling:

- OAuth for end-users (including token refresh)
- per-user credential storage
- tool catalog discovery
- safe tool execution patterns

## Executive Summary

What changed since the first pass:

- Composio’s **SDK/CLI is open source** (MIT), but the **hosted backend** (Connect Links, credential vault, tool catalog service) is not “just run it from the repo”.
- Arcade has **public pricing** and a clear two-layer auth model.
- ACI.dev (Aipotheosis Labs) is a serious **open-source** contender and maps very well to the “meta-tool router” pattern (search/execute).

Key options:

- **Composio**: biggest catalog (public catalog shows 877 toolkits / 11,000+ tools) + strong “meta-tool” approach.
- **Arcade**: strong security/auth posture + MCP runtime framing + deployability.
- **ACI.dev**: best open-source story in this category; unified MCP meta tools; 600+ integrations.

## What “Managed OAuth” Means (for Agenta)

We want a provider to:

- host (or help host) the OAuth consent flow
- store & refresh OAuth tokens
- map tokens to our user/workspace identifiers
- provide “connection status” and revocation/rotation

In practice: user clicks a “Connect” button in Agenta UI, completes OAuth, and from then on tool calls execute under that user’s authorization.

## Funding Snapshot (public posts)

| Company | Funding (public) | Source |
|---|---:|---|
| Composio | $29M (funding announcement post) | https://composio.dev/blog/series-a |
| Arcade | $12M seed | https://blog.arcade.dev/arcade-dev-raises-12m-to-solve-the-biggest-security-challenge-in-ai-agents |
| Aipotheosis / ACI.dev | Not found in sources reviewed (needs follow-up) | N/A |

## 1. Composio Deep Dive

### What it is

- Website: https://composio.dev
- Docs: https://docs.composio.dev
- SDK repo (MIT): https://github.com/ComposioHQ/composio
- Toolkits catalog: https://composio.dev/toolkits

Composio provides:

- a hosted platform/API for tool catalog + auth + execution orchestration
- SDKs that format tools for common LLM providers/frameworks (OpenAI, Anthropic, LangChain, etc.)

### Open source vs hosted

The GitHub repo is explicitly the **SDKs** (“Composio SDK”). It references pulling OpenAPI specs from a hosted backend (`https://backend.composio.dev/api/v3/openapi.json`). That is a strong signal the backend is a hosted service (even if enterprise offers VPC/on-prem).

Repo: https://github.com/ComposioHQ/composio

### Catalog scale

The public toolkits page currently states:

- 877 toolkits
- 11,000+ tools

Ref: https://composio.dev/toolkits

### Authentication model

Composio docs describe:

- **Connect Links** (hosted pages) for end-user auth
- **Auth configs** as reusable blueprints per toolkit (auth method, scopes, managed vs BYO OAuth credentials)
- **Connected accounts** as per-user credential records (multiple accounts per toolkit allowed)
- automatic token refresh

Ref: https://docs.composio.dev/docs/authentication

### Meta-tool pattern (important)

Instead of loading thousands of tools into an LLM context, Composio provides 5 meta tools:

- `COMPOSIO_SEARCH_TOOLS`
- `COMPOSIO_MANAGE_CONNECTIONS`
- `COMPOSIO_MULTI_EXECUTE_TOOL`
- `COMPOSIO_REMOTE_WORKBENCH`
- `COMPOSIO_REMOTE_BASH_TOOL`

Ref: https://docs.composio.dev/docs/tools-and-toolkits

### Pricing

Public pricing is usage-based (tool calls + connected accounts).

Ref: https://composio.dev/pricing

### Fit for Agenta

Best for:

- broad SaaS integrations quickly
- “agent auth” UX via Connect Links
- keeping LLM tool context small via meta-tool routing

Trade-offs:

- backend is not straightforward OSS self-host from GitHub
- enterprise VPC/on-prem must be validated (contract/product, not OSS)

## 2. Arcade Deep Dive

### What it is

- Website: https://arcade.dev
- Docs: https://docs.arcade.dev/home
- Pricing: https://arcade.dev/pricing
- Tools catalog: https://arcade.dev/tools
- Open-source MCP server framework (MIT): https://github.com/ArcadeAI/arcade-mcp

Arcade positions itself as the **runtime between AI and action**.

### Auth model (two layers)

Arcade documents two authorization layers:

- **Tool-level authorization**: per-tool OAuth scopes; Arcade manages OAuth + token storage; tool code receives token via context.
- **Server-level (resource server) auth**: front-door bearer-token validation for HTTP MCP servers (Arcade can handle this if you deploy via their tooling).

Ref: https://docs.arcade.dev/en/learn/server-level-vs-tool-level-auth

### Tool catalog scale

- Tools page claims: “over 8,000 enterprise tools”
- Docs list 129 MCP servers in their catalog

Refs:

- https://arcade.dev/tools
- https://docs.arcade.dev/en/resources/integrations

### Pricing

Arcade pricing is public:

- Hobby: Free
- Growth: $25/month + usage
- Enterprise: Custom

Ref: https://arcade.dev/pricing

### Fit for Agenta

Best for:

- “auth and governance” heavy environments
- MCP ecosystem interoperability
- clear separation between securing the MCP server (front-door) vs securing external tool calls

Trade-offs:

- unclear what portion of the overall runtime is OSS beyond the MCP framework repo
- pricing model includes multiple dimensions (executions, “user challenges”, hosted workers)

## 3. ACI.dev / Aipotheosis Labs Deep Dive

### What it is

- Platform repo (Apache-2.0): https://github.com/aipotheosis-labs/aci
- MCP server(s) (MIT): https://github.com/aipotheosis-labs/aci-mcp
- Agent examples: https://github.com/aipotheosis-labs/aci-agents
- Product page (Embedded iPaaS): https://aci.dev/products/embedded-ipaas

The ACI.dev repo claims:

- 600+ integrations
- multi-tenant auth
- dynamic tool discovery
- “100% open source” under Apache-2.0 (backend + dev portal + integrations)

Ref: https://github.com/aipotheosis-labs/aci

### Unified MCP meta-tool pattern

Their `aci-mcp-unified` server exposes two meta tools:

- `ACI_SEARCH_FUNCTIONS`
- `ACI_EXECUTE_FUNCTION`

Ref: https://github.com/aipotheosis-labs/aci-mcp

### Agent patterns (practical usage)

`aci-agents` describes:

- static tool list agents
- dynamic discovery agents using `ACI_SEARCH_FUNCTIONS` + either:
  - tool list expansion (more reliable)
  - text-context + execute indirection (less reliable)

Ref: https://github.com/aipotheosis-labs/aci-agents

### Fit for Agenta

Best for:

- open-source-first strategy
- meta-tool routing that keeps LLM context small
- building an “external tools” provider layer without hard vendor lock-in

Trade-offs:

- need deeper validation of real-world integration maturity/coverage vs Composio

## 4. Comparison Matrix (Agenta-centric)

| Dimension | Composio | Arcade | ACI.dev |
|---|---|---|---|
| Core value prop | tool catalog + meta-tools + Connect Links | MCP runtime + auth + governance posture | open-source tool-calling + unified MCP + meta-tools |
| Catalog scale (claimed) | 877 toolkits / 11,000+ tools | 8,000+ tools; 129 MCP servers | 600+ integrations |
| OSS status | SDK/CLI OSS (MIT); backend hosted | MCP framework OSS (MIT); runtime includes SaaS + deployable workers | platform repo claims full OSS (Apache-2.0); MCP servers OSS |
| Discovery pattern | 5 meta tools (search/connect/execute/workbench) | catalog + MCP servers; strong auth primitives | 2 meta tools (search/execute) |
| Managed OAuth UX | Connect Links; auth configs; connected accounts | user challenges; tool scopes; token injection | multi-tenant auth + linked accounts (per marketing/docs) |
| “Keep context small” | yes (meta tools) | depends (can be many tools); has MCP gateway patterns | yes (meta tools) |
| Pricing | public tiers + usage | public tiers + usage | Gate22 pricing public; embedded iPaaS sales-led |

## 5. Implications for Agenta’s Design

### Prefer meta-tool routing

Agenta should support a “provider router” mode where the model sees a small, fixed tool list (search/connect/execute) rather than 1,000+ tool schemas. Composio and ACI both provide this out of the box.

### Provider abstraction we likely need

To keep Agenta flexible:

- `list_catalog()` (apps/toolkits)
- `list_connections(user)`
- `start_oauth(user, toolkit)` -> redirect_url
- `get_model_tools(user, selection)` -> meta tools and/or direct schemas
- `execute(user, tool_call)`

This lets us start with one provider (likely ACI if OSS-first, or Composio if catalog-first) and add others later.

## Notes on using “Exa” for research

You asked me to use Exa and to check `code/repo_tracker` for skills/endpoints. In this Agenta repo/worktree I do not see any `repo_tracker` folder or an Exa-search integration to call.

If you want me to use Exa’s API for future research passes, I’ll need either:

- the location of your `repo_tracker` code (different repo/worktree), or
- an Exa API key + the intended endpoint/wrapper you want used.
