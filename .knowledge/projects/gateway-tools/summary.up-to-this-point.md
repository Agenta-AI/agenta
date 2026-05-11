# Tools Providers / Gateway - Summary (Up To This Point)

This document summarizes the decisions and direction reached so far for "Agents + Tools" support in Agenta.

**Goal**
- Enable SMEs to connect third-party tools (Gmail, GitHub, Slack, etc.) and use them in multi-step agents.
- Keep provider-specific auth and execution complexity behind an Agenta-managed gateway.

**Non-Goals (For Now)**
- Full execution implementation details.
- Event logging and replay for tool calls (would live in a separate observability/tracing service).

**Core Modeling Decisions**
- Entities are simple (not git-style artifacts/variants/revisions).
- Only stateful resources become entities.
- Providers/integrations/capabilities/tools are catalog concepts (fields/enums), not persisted entities.

**What Is Actually Persisted**
- Tool "connections" are represented as `secrets` records (no separate ToolConnection entity).
- Each connection has a stable `slug` used to disambiguate multiple connections for the same provider.

**Terminology (Current Working Terms)**
- Gateway kind: where execution/auth is handled. Examples: `composio`, `mcp`, `custom`, `agenta`.
- Provider (tool provider): the user-facing tool family. Examples: `gmail`, `slack`, `github`.
- Tool (capability): a callable function within a provider. Examples: `SEND_EMAIL`, `CREATE_ISSUE`.

**Tool Slug Strategy**
- Tool slugs are user/tool-centric; they should not force users to care about *how* Gmail is connected.
- Unbound tool slug (no connection specified): `tools.gateway.{provider}.{tool}`.
- Bound tool slug (explicit connection): `tools.gateway.{provider}.{tool}.{connection_slug}`.
- Resolution rule:
- If exactly one ACTIVE connection exists for `{provider}`, unbound slugs can resolve to it.
- If multiple connections exist, invocation must use a bound slug (otherwise return an ambiguity error).

**Secrets Strategy**
- A new `SecretKind` will represent tool provider keys (the "connection" record).
- The secret payload must include gateway kind (we do not hide Composio/MCP/Agenta/custom).
- User can optionally provide a gateway API key as part of the secret.
- If no gateway key is provided and Agenta supports it, the gateway uses an internal key.

**API Surface Direction**
- Base route: `/tools` (exact prefix depends on router conventions; the intent is one tools router).
- Discovery:
- `GET /tools/catalog` returns available providers and tools (no persisted entities needed).
- Connections:
- `GET /tools/secrets` (or reuse existing secrets endpoints with filtering) lists tool provider secrets.
- Execution:
- `POST /tools/invoke` executes tool calls behind the gateway and returns tool results.
- Connection flows:
- `POST /tools/connect` initiates connection creation (OAuth or API key) and creates/updates the secret.
- `POST /tools/callback` (or `GET` depending on OAuth provider constraints) completes OAuth and finalizes the secret.

**Multiple Connections**
- Multiple secrets can exist for the same `{provider}` (e.g., two Gmail accounts).
- Each has a unique `slug` within the project scope.
- The UI binds tools to specific connections by selecting the secret slug; the bound tool slug includes that slug.

**Open Design Items**
- Whether secrets need a first-class `slug` column vs storing `connection_slug` inside secret `data`.
- Exact list shape for the catalog (whether it returns unbound tools only, bound tools when multiple, or both).
- Error contract for ambiguity and inactive/expired connections, including refresh semantics.
