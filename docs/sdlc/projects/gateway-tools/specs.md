# Gateway Tools — `tools/call` vs `tools/invoke` Comparison

Analysis of the two tool execution endpoints: the AI Services `tools/call` (PR #3687) and the Gateway Tools `tools/invoke` design.

---

## 1. Contract Shape

| Aspect | `tools/call` (AI Services) | `tools/invoke` (Gateway Tools) |
|--------|---------------------------|-------------------------------|
| **Path** | `POST /preview/ai/services/tools/call` | `POST /preview/tools/invoke` |
| **Shape** | MCP-shaped | OpenAI-shaped |
| **Cardinality** | Single call per request | Batch (multiple `tool_calls`) |
| **Request** | `{ name, arguments: dict }` | `{ version, tools: [ToolDefinition], tool_calls: [{ id, type, function: { name, arguments: str } }] }` |
| **Response** | `{ content: [{type, text}], structuredContent?, isError, meta? }` | `{ version, status, tool_messages: [{role, tool_call_id, content}], errors: [{code, message, tool_call_id, retryable, details}] }` |

Key friction points:

- **`arguments`** is a `Dict` in AI Services but a **JSON string** in Gateway (matching OpenAI `function.arguments`).
- **No `tool_call_id`** in AI Services — no way to correlate request-to-response in a batch.
- **`isError` boolean** vs **structured `ToolError` with `code`, `retryable`, `details`** — the Gateway error model is far richer.

---

## 2. Tool Definition / Schema

| Aspect | AI Services | Gateway Tools |
|--------|-------------|---------------|
| **Schema keys** | `inputSchema`, `outputSchema` (camelCase) | `input_schema`, `output_schema` (snake_case) |
| **Definition model** | `ToolDefinition(name, title, description, inputSchema, outputSchema)` | `ToolDefinition(slug, provider, name, display_name, description, input_schema, output_schema, connections)` |
| **Connections** | N/A (no connection concept) | `connections: List[Tool]` — which tools are wired for this provider |

The Gateway `ToolDefinition` is a superset — it adds `slug`, `provider`, `connections` (the bound tools for that provider). AI Services `ToolDefinition` has a `title` field that Gateway uses as `display_name`.

---

## 3. Slug Convention

Both follow the `tools.{category}.{...}` pattern:

```
AI Services:    tools.agenta.api.refine_prompt
Gateway:        tools.gateway.{provider}.{tool}[.{slug}]
```

The natural dispatch path for `tools.agenta.api.refine_prompt`:

```
tools → agenta handler → api handler → refine_prompt handler
```

This maps cleanly to `ToolGatewayKind.AGENTA` in the adapter registry. The AI Services module is essentially a `tools.agenta.*` adapter.

---

## 4. Error Handling

| Aspect | AI Services | Gateway Tools |
|--------|-------------|---------------|
| **Strategy** | HTTP status codes (400, 429, 503) | Always 200; errors in response `errors[]` array |
| **Error shape** | HTTPException detail string | `ToolError { code, message, tool_call_id, retryable, details }` |
| **Partial success** | N/A (single call) | Yes — some calls succeed, some fail |
| **Rate limiting** | Router-level (burst=10, 30/min) | Delegated to upstream providers |
| **Retryability** | Implicit via HTTP status | Explicit `retryable: bool` field |

---

## 5. Routing & Dispatch

| Aspect | AI Services | Gateway Tools |
|--------|-------------|---------------|
| **Dispatch** | Hardcoded `if name != TOOL_REFINE_PROMPT` | `GatewayAdapterRegistry.get(gateway_kind)` -> adapter |
| **Resolution** | Direct name match | Slug parsing -> DB lookup -> adapter dispatch |
| **Auth** | Env-var gated (`AGENTA_AI_SERVICES_*`) | Per-tool OAuth/API key, stored in `tools` table |

---

## 6. Convergence Path

The natural convergence:

1. **`tools/invoke` becomes the single execution endpoint** for all tool types.
2. **AI Services becomes a `ToolGatewayKind.AGENTA` adapter** implementing `GatewayAdapterInterface`.
3. **The slug `tools.agenta.api.refine_prompt`** gets dispatched by the same registry that handles `tools.gateway.gmail.SEND_EMAIL`.
4. The MCP-shaped response from AI Services gets normalized into the OpenAI-shaped `ToolServiceResponse`.

Tensions to resolve:

- **Single vs batch**: `tools/call` is 1:1 by design; `tools/invoke` is N:M. The Agenta adapter can handle one call at a time within the batch loop.
- **`arguments` as dict vs string**: Need to pick one. OpenAI convention is string (JSON-encoded), but internally the service parses it anyway.
- **`isError` + `structuredContent` vs `ToolError`**: The richer Gateway error model subsumes what AI Services does. `structuredContent` could map to `ToolMessage.content` (JSON string).
- **Connections**: Agenta tools don't have "connections" in the OAuth sense — they're internally wired. The adapter could return an empty `connections` list, or a synthetic entry representing the env-var config.

---

## 7. What's Duplicated Today

If both ship as-is:

- Two `ToolDefinition` models (different field casing, different fields).
- Two tool dispatch mechanisms (hardcoded if-else vs adapter registry).
- Two error strategies (HTTP codes vs in-band errors).
- Two response shapes (MCP vs OpenAI).

The AI Services PR is a valid v1 for shipping refine-prompt quickly, but architecturally the AI Services module should fold into the Gateway Tools adapter system as `ToolGatewayKind.AGENTA`.

---

## 8. Decision: OpenAI-shaped (not MCP-shaped)

**The Gateway Tools `/invoke` endpoint uses OpenAI-shaped contracts.** This is the right choice.

### Composio's Native Format

Composio uses their own proprietary schema that maps 1:1 to OpenAI:

| Composio native | OpenAI function calling |
|-----------------|------------------------|
| `slug` | `function.name` |
| `input_parameters` (JSON Schema) | `function.parameters` |
| `name` / `description` | `function.name` / `function.description` |

Their SDK's `wrapTool()` is a trivial mapping:

```python
# Composio -> OpenAI (from their SDK)
{
    "type": "function",
    "function": {
        "name": tool.slug,              # GMAIL_SEND_EMAIL
        "description": tool.description,
        "parameters": tool.input_parameters  # JSON Schema passthrough
    }
}
```

Their execution response is `{ data, error, successful, log_id }` — a simple envelope that maps cleanly to `ToolMessage` (on success) or `ToolError` (on failure).

### MCP is a Transport Layer

Composio exposes MCP as an optional transport via Tool Router sessions:

```
POST /tool_router/session → { session_id, mcp: { url: "https://...composio.dev/.../mcp" } }
```

MCP defines how to **communicate with a tool server** (protocol, discovery, streaming). It is not the right shape for the **wire format between your API and LLM callers**. Using MCP shape at the API boundary conflates transport with contract.

### Why OpenAI-shaped Wins

1. **Composio is OpenAI-native** — their tool schema maps 1:1. No translation needed in the adapter.
2. **De facto LLM standard** — Anthropic, Google, Mistral, OpenAI all converge on the same `tool_calls[{ id, function: { name, arguments } }]` shape.
3. **Batch + correlation** — `tool_call_id` enables partial success in `/invoke`. MCP's `{ content[], isError }` has no correlation mechanism.
4. **Gateway sits between LLM and providers** — keeping the same shape avoids unnecessary translation at both ends.
5. **Future adapters (MCP, custom)** — an MCP adapter translates MCP responses into the common OpenAI-shaped `ToolServiceResponse`. The adapter pattern handles format bridging.

### How AI Services (`tools/call`) Folds In

When AI Services becomes a `ToolGatewayKind.AGENTA` adapter:

- The adapter internally uses whatever format it needs (MCP-shaped, custom, etc.)
- The gateway normalizes it into `ToolMessage` / `ToolError`
- `tools.agenta.api.refine_prompt` dispatches through the same registry as `tools.gateway.gmail.SEND_EMAIL`
- The MCP-shaped `tools/call` endpoint can remain as a convenience alias if needed, or be deprecated

---

## 9. Slug Format (Revised)

```
tools.{provider_key}.{integration_key}.{action_key}[.{connection_slug}]
```

| Segment | Description | Examples |
|---------|-------------|----------|
| `provider_key` | Gateway backend / tool source | `composio`, `agenta` |
| `integration_key` | Toolkit / app / capability group | `gmail`, `github`, `slack`, `api` |
| `action_key` | Specific executable action | `SEND_EMAIL`, `CREATE_ISSUE`, `refine_prompt` |
| `connection_slug` | (Optional) Bound connection for disambiguation. Must be unique per integration within a project — not reusable. | `support_inbox`, `marketing_inbox` |

### Examples

```
tools.composio.gmail.SEND_EMAIL                       ← unbound (auto-resolve if 1 connection)
tools.composio.gmail.SEND_EMAIL.support_inbox         ← bound to specific connection
tools.composio.gmail.SEND_EMAIL.marketing_inbox       ← bound to different connection
tools.composio.github.CREATE_ISSUE                    ← unbound
tools.agenta.api.refine_prompt                        ← agenta internal tool (no connection needed)
```

### Key Insight: Connections Are at the Integration Level

You connect to **Gmail** (the integration), not to **SEND_EMAIL** (the action). A connection gives access to all actions within that integration. The `connection_slug` in the tool slug is just disambiguation — it selects _which_ Gmail connection to use, not which action.

### Resolution Rules

| Scenario | Behavior |
|----------|----------|
| Unbound slug, exactly 1 ACTIVE connection for integration | Auto-resolve to that connection |
| Unbound slug, 0 connections | `TOOL_NOT_CONNECTED` error |
| Unbound slug, >1 connections | `TOOL_AMBIGUOUS` error (response includes available connection slugs) |
| Bound slug | Resolve to the specific connection matching `connection_slug` |

### Composio Slug Mapping

```
Agenta:    tools.composio.gmail.SEND_EMAIL
Composio:  GMAIL_SEND_EMAIL

Agenta → Composio:  integration_key.upper() + "_" + action_key  →  GMAIL_SEND_EMAIL
Composio → Agenta:  split by toolkit.slug prefix                →  (gmail, SEND_EMAIL)
```

---

## 10. Catalog Endpoints

Base path: `/preview/tools/catalog`

Two access patterns:
1. **Browse** — REST hierarchy for UI drill-down
2. **Query** — search/filter with windowing for programmatic use

### 10.1 Browse — REST Hierarchy

```
GET  /providers                                                    → list providers
GET  /providers/{provider_key}                                     → provider detail
GET  /providers/{provider_key}/integrations                                → list integrations
GET  /providers/{provider_key}/integrations/{integration_key}                      → integration detail + connections
GET  /providers/{provider_key}/integrations/{integration_key}/actions              → list actions (no schemas)
GET  /providers/{provider_key}/integrations/{integration_key}/actions/{action_key} → action detail (full schema)
```

### 10.2 Browse — Response Shapes

#### `GET /providers`

Lists registered gateway providers.

```json
{
  "count": 2,
  "items": [
    {
      "key": "composio",
      "name": "Composio",
      "description": "Third-party tool integrations via Composio",
      "integrations_count": 150,
      "enabled": true
    },
    {
      "key": "agenta",
      "name": "Agenta",
      "description": "Built-in AI-powered tools",
      "integrations_count": 1,
      "enabled": true
    }
  ]
}
```

#### `GET /providers/{provider_key}`

Single provider with metadata.

```json
{
  "key": "composio",
  "name": "Composio",
  "description": "Third-party tool integrations via Composio",
  "integrations_count": 150,
  "enabled": true
}
```

#### `GET /providers/{provider_key}/integrations`

Lists integrations (toolkits/apps) for a provider.

Query params: `search` (free-text), `limit`, `cursor`.

```json
{
  "count": 3,
  "items": [
    {
      "key": "gmail",
      "name": "Gmail",
      "description": "Google's email service, featuring spam protection...",
      "logo": "https://logos.composio.dev/api/gmail",
      "auth_schemes": ["OAUTH2"],
      "actions_count": 40,
      "categories": ["collaboration & communication"],
      "no_auth": false,
      "connections_count": 2
    },
    {
      "key": "github",
      "name": "GitHub",
      "description": "Code hosting platform for version control...",
      "logo": "https://logos.composio.dev/api/github",
      "auth_schemes": ["OAUTH2"],
      "actions_count": 792,
      "categories": ["developer tools & devops"],
      "no_auth": false,
      "connections_count": 1
    },
    {
      "key": "slack",
      "name": "Slack",
      "description": "Team messaging and collaboration platform...",
      "logo": "https://logos.composio.dev/api/slack",
      "auth_schemes": ["OAUTH2"],
      "actions_count": 55,
      "categories": ["collaboration & communication"],
      "no_auth": false,
      "connections_count": 0
    }
  ],
  "next_cursor": null
}
```

Notes:
- `connections_count` indicates how many connections exist for this integration in the current project. This lets the UI show connection status at the integration level (0 = not connected, 1 = connected, 2+ = multiple connections).
- Source: integrations from Composio `GET /toolkits`, connections_count from local DB.

#### `GET /providers/{provider_key}/integrations/{integration_key}`

Single integration with metadata **and connections**.

Connections belong here because they are at the integration level — you connect to Gmail, not to SEND_EMAIL.

```json
{
  "key": "gmail",
  "name": "Gmail",
  "description": "Google's email service...",
  "logo": "https://logos.composio.dev/api/gmail",
  "auth_schemes": ["OAUTH2"],
  "actions_count": 40,
  "categories": ["collaboration & communication"],
  "no_auth": false,
  "connections": [
    {
      "slug": "support_inbox",
      "name": "Support inbox",
      "description": "Primary support mailbox",
      "is_active": true,
      "is_valid": true,
      "status": null,
      "created_at": "2026-02-08T10:00:00Z"
    },
    {
      "slug": "marketing_inbox",
      "name": "Marketing inbox",
      "description": null,
      "is_active": true,
      "is_valid": true,
      "status": null,
      "created_at": "2026-02-01T08:30:00Z"
    }
  ]
}
```

Notes:
- `connections[].slug` is the `connection_slug` used in the tool slug for disambiguation. It is unique per integration within the project and not reusable once deleted.
- `connections[].is_active` / `is_valid` / `status` follow the SSO provider flags pattern.
- On the list endpoint (`GET .../integrations`), only `connections_count` is returned for performance. The full `connections[]` array is on the detail endpoint.

#### `GET /providers/{provider_key}/integrations/{integration_key}/actions`

Lists actions for an integration. **Schemas omitted** for performance.

Query params: `search`, `tags` (e.g., `important`), `limit`, `cursor`.

```json
{
  "count": 3,
  "items": [
    {
      "key": "SEND_EMAIL",
      "slug": "tools.composio.gmail.SEND_EMAIL",
      "name": "Send Email",
      "description": "Sends an email via gmail api...",
      "tags": ["important", "openWorldHint"]
    },
    {
      "key": "CREATE_EMAIL_DRAFT",
      "slug": "tools.composio.gmail.CREATE_EMAIL_DRAFT",
      "name": "Create email draft",
      "description": "Creates a gmail email draft...",
      "tags": ["important"]
    },
    {
      "key": "LIST_EMAILS",
      "slug": "tools.composio.gmail.LIST_EMAILS",
      "name": "List Emails",
      "description": "Lists emails matching criteria...",
      "tags": ["important"]
    }
  ],
  "next_cursor": null
}
```

Notes:
- No `connections` here — connections are at the integration level, not the action level.
- Source: maps from Composio `GET /tools?toolkit_slug={integration_key}` response.

#### `GET /providers/{provider_key}/integrations/{integration_key}/actions/{action_key}`

Full action detail **with schemas**. No connections — those are on the integration.

```json
{
  "key": "SEND_EMAIL",
  "slug": "tools.composio.gmail.SEND_EMAIL",
  "name": "Send Email",
  "description": "Sends an email via gmail api using the authenticated user's profile...",
  "tags": ["important", "openWorldHint"],
  "input_schema": {
    "type": "object",
    "properties": {
      "recipient_email": {
        "type": "string",
        "description": "Primary recipient's email address.",
        "examples": ["john@doe.com"]
      },
      "subject": {
        "type": "string",
        "description": "Subject line of the email.",
        "nullable": true,
        "default": null
      },
      "body": {
        "type": "string",
        "description": "Email content (plain text or HTML)."
      },
      "cc": {
        "type": "array",
        "items": {"type": "string"},
        "default": [],
        "description": "CC recipients."
      },
      "bcc": {
        "type": "array",
        "items": {"type": "string"},
        "default": [],
        "description": "BCC recipients."
      },
      "is_html": {
        "type": "boolean",
        "default": false,
        "description": "Set to True if body contains HTML."
      }
    },
    "required": ["recipient_email", "body"]
  },
  "output_schema": {
    "type": "object",
    "properties": {
      "data": {
        "type": "object",
        "properties": {
          "response_data": {
            "type": "object",
            "description": "Gmail API response with message ID and threadId."
          }
        },
        "required": ["response_data"]
      },
      "successful": {"type": "boolean"},
      "error": {"type": "string", "nullable": true}
    },
    "required": ["data", "successful"]
  }
}
```

Notes:
- `input_schema` / `output_schema` are passthrough from Composio's `input_parameters` / `output_parameters`.
- No `connections` — that's on the integration detail. The UI already has integration context from the browse hierarchy.

### 10.3 Catalog Query — `POST /tools/catalog/query`

Search/filter **actions** across the catalog. Returns actions (the catalog leaf) — no connection expansion, no tool slugs. This is for discovery: "what's available to connect?"

#### Request

```json
{
  "action": {
    "name": "send email",
    "description": null,
    "provider_key": "composio",
    "integration_key": "gmail",
    "tags": {
      "important": true
    }
  },
  "windowing": {
    "limit": 20,
    "next": null
  }
}
```

All fields optional. Empty body returns all actions across all providers/integrations (paginated).

| Field | Type | Description |
|-------|------|-------------|
| `action` | `ActionQuery?` | Filter object (all fields optional) |
| `action.name` | `str?` | Substring match (ilike `%name%`) on action name |
| `action.description` | `str?` | Substring match (ilike `%description%`) on action description |
| `action.provider_key` | `str?` | Exact match on provider |
| `action.integration_key` | `str?` | Exact match on integration |
| `action.tags` | `Dict[str, LabelJson]?` | JSONb contains match (e.g. `{"important": true}`) |
| `windowing` | `Windowing?` | Standard windowing (`next: UUID?`, `limit: int?`, `order`) |

#### Response

```json
{
  "count": 2,
  "actions": [
    {
      "key": "SEND_EMAIL",
      "name": "Send Email",
      "description": "Sends an email via gmail api...",
      "tags": {"important": true, "openWorldHint": true},
      "provider_key": "composio",
      "integration_key": "gmail",
      "integration_name": "Gmail",
      "integration_logo": "https://logos.composio.dev/api/gmail"
    },
    {
      "key": "SEND_EMAIL",
      "name": "Send Email",
      "description": "Sends an email via Outlook...",
      "tags": {"important": true},
      "provider_key": "composio",
      "integration_key": "outlook",
      "integration_name": "Outlook",
      "integration_logo": "https://logos.composio.dev/api/outlook"
    }
  ]
}
```

Notes:
- Returns **actions**, not tools. No tool slugs, no connection expansion. One action per integration regardless of how many connections exist.
- Each result includes `provider_key`, `integration_key`, `integration_name`, `integration_logo` for context.
- Schemas are **omitted**. Use `GET .../actions/{action_key}` for full schemas.
- No `connection` or `flags.is_connected` — this is pure catalog. For connection-aware queries, use `POST /tools/query`.

---

### 10.4 Tool Query — `POST /tools/query`

Search/filter **tools** — fully resolved entities (action × connection). Returns one tool per connection binding. This is for "what can I invoke?"

Mounted at `/preview/tools/query` alongside other slug-based operations.

#### Request

```json
{
  "tool": {
    "name": "send email",
    "description": null,
    "provider_key": "composio",
    "integration_key": "gmail",
    "tags": {
      "important": true
    },
    "flags": {
      "is_connected": true
    }
  },
  "include_connections": true,
  "windowing": {
    "limit": 20,
    "next": null
  }
}
```

All fields optional. Empty body returns all tools (paginated), with connections included.

| Field | Type | Description |
|-------|------|-------------|
| `tool` | `ToolQuery?` | Filter object (all fields optional) |
| `tool.name` | `str?` | Substring match (ilike `%name%`) on tool name |
| `tool.description` | `str?` | Substring match (ilike `%description%`) on tool description |
| `tool.provider_key` | `str?` | Exact match on provider |
| `tool.integration_key` | `str?` | Exact match on integration |
| `tool.tags` | `Dict[str, LabelJson]?` | JSONb contains match (e.g. `{"important": true}`) |
| `tool.flags` | `ToolQueryFlags?` | Boolean filters. `is_connected: true` = connected only, `false` = unconnected only, missing = all |
| `include_connections` | `bool?` | Include `connection` detail in results. Defaults to `true`. Set `false` for lighter payload (slug still has connection suffix). |
| `windowing` | `Windowing?` | Standard windowing (`next: UUID?`, `limit: int?`, `order`) |

#### Response

A **tool** is a fully resolved entity: action × connection. One action with two connections → two tools, each with its own full slug. Unconnected actions → one tool with `connection: null` and a slug without connection suffix.

```json
{
  "count": 3,
  "tools": [
    {
      "slug": "tools.composio.gmail.SEND_EMAIL.support_inbox",
      "action_key": "SEND_EMAIL",
      "name": "Send Email",
      "description": "Sends an email via gmail api...",
      "tags": {"important": true, "openWorldHint": true},
      "provider_key": "composio",
      "integration_key": "gmail",
      "integration_name": "Gmail",
      "integration_logo": "https://logos.composio.dev/api/gmail",
      "connection": {
        "slug": "support_inbox",
        "name": "Support inbox",
        "is_active": true,
        "is_valid": true
      }
    },
    {
      "slug": "tools.composio.gmail.SEND_EMAIL.marketing_inbox",
      "action_key": "SEND_EMAIL",
      "name": "Send Email",
      "description": "Sends an email via gmail api...",
      "tags": {"important": true, "openWorldHint": true},
      "provider_key": "composio",
      "integration_key": "gmail",
      "integration_name": "Gmail",
      "integration_logo": "https://logos.composio.dev/api/gmail",
      "connection": {
        "slug": "marketing_inbox",
        "name": "Marketing inbox",
        "is_active": true,
        "is_valid": true
      }
    },
    {
      "slug": "tools.composio.outlook.SEND_EMAIL",
      "action_key": "SEND_EMAIL",
      "name": "Send Email",
      "description": "Sends an email via Outlook...",
      "tags": {"important": true},
      "provider_key": "composio",
      "integration_key": "outlook",
      "integration_name": "Outlook",
      "integration_logo": "https://logos.composio.dev/api/outlook",
      "connection": null
    }
  ]
}
```

Notes:
- A **tool = action × connection**. The tool is the invokable unit. Its `slug` is the full slug including the connection suffix (when connected).
- One action with N connections → N tools. One action with 0 connections → 1 tool with `connection: null`.
- `action_key` is the action leaf (e.g., `SEND_EMAIL`). The slug is the full `tools.{provider}.{integration}.{action}[.{connection}]`.
- `connection` is a single object (not an array) — it's the specific connection this tool is bound to. `null` means unconnected.
- `flags.is_connected: true` → only tools with `connection != null` (ready to invoke). `false` → only unconnected tools. Missing → both.
- `include_connections` controls whether `connection` detail is populated. When `false`, `connection` is `null` even for connected tools — the slug still has the connection suffix, so callers can distinguish.
- Schemas are **omitted**. Use `GET .../actions/{action_key}` or `POST /tools/inspect` for full schemas.

#### Internal DTOs

```python
# core/tools/dtos.py

class ActionQuery(BaseModel):
    """Filter criteria for catalog actions (POST /tools/catalog/query)."""
    name: Optional[str] = None              # ilike %name%
    description: Optional[str] = None       # ilike %description%
    provider_key: Optional[str] = None      # exact match
    integration_key: Optional[str] = None   # exact match
    tags: Optional[Tags] = None             # jsonb contains

class ActionQueryRequest(BaseModel):
    """POST /tools/catalog/query request body."""
    action: Optional[ActionQuery] = None
    #
    windowing: Optional[Windowing] = None

class ToolQueryFlags(BaseModel):
    """Boolean flags for tool filtering."""
    is_connected: Optional[bool] = None     # true=connected, false=unconnected, None=all

class ToolQuery(BaseModel):
    """Filter criteria for tools (POST /tools/query)."""
    name: Optional[str] = None              # ilike %name%
    description: Optional[str] = None       # ilike %description%
    provider_key: Optional[str] = None      # exact match
    integration_key: Optional[str] = None   # exact match
    tags: Optional[Tags] = None             # jsonb contains
    flags: Optional[ToolQueryFlags] = None

class ToolQueryRequest(BaseModel):
    """POST /tools/query request body."""
    tool: Optional[ToolQuery] = None
    #
    include_connections: Optional[bool] = True  # populate connection detail in response
    #
    windowing: Optional[Windowing] = None

# apis/fastapi/tools/models.py

class Action(BaseModel):
    """A catalog action — no connection expansion."""
    key: str
    name: str
    description: Optional[str] = None
    tags: Optional[Tags] = None
    #
    provider_key: str
    integration_key: str
    integration_name: str
    integration_logo: Optional[str] = None

class ActionsResponse(BaseModel):
    """POST /tools/catalog/query response."""
    count: int = 0
    actions: List[Action] = []

class ConnectionSummary(BaseModel):
    """Lightweight connection info bound to a tool."""
    slug: str
    name: Optional[str] = None
    is_active: bool
    is_valid: bool

class Tool(BaseModel):
    """A tool — fully resolved: action × connection."""
    slug: str                                    # full slug incl. connection suffix
    action_key: str                              # the action leaf (e.g. SEND_EMAIL)
    name: str
    description: Optional[str] = None
    tags: Optional[Tags] = None
    #
    provider_key: str
    integration_key: str
    integration_name: str
    integration_logo: Optional[str] = None
    #
    connection: Optional[ConnectionSummary] = None  # null = unconnected

class ToolsResponse(BaseModel):
    """POST /tools/query response."""
    count: int = 0
    tools: List[Tool] = []
```

---

## 11. Connection Endpoints

Connections are managed at the **integration level** — you connect to Gmail, not to SEND_EMAIL. A connection gives access to all actions within that integration.

Two access patterns:
1. **REST** — CRUD on connections within the integration hierarchy
2. **Slug-based** — action-oriented operations using the tool slug

### 11.1 REST — Connection CRUD (within integration hierarchy)

Base path: `/preview/tools/catalog/providers/{provider_key}/integrations/{integration_key}/connections`

```
GET    .../connections                              → list connections for this integration
POST   .../connections                              → connect (initiate OAuth or API key)
GET    .../connections/{connection_slug}             → get connection (supports polling for is_valid)
DELETE .../connections/{connection_slug}             → disconnect (revokes provider-side)
POST   .../connections/{connection_slug}/refresh     → refresh expired connection
```

#### `POST .../connections` — Connect

**Request:**

```json
{
  "slug": "support_inbox",
  "name": "Support inbox",
  "description": "Primary support mailbox",
  "mode": "oauth",
  "callback_url": "https://app.agenta.ai/tools/callback",
  "credentials": null,
  "gateway_api_key": null
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `slug` | yes | Unique connection slug (not reusable once deleted) |
| `name` | no | Human-readable label |
| `mode` | yes | `oauth` or `api_key` |
| `callback_url` | for oauth | Where to redirect after OAuth |
| `credentials` | for api_key | `{"api_key": "..."}` |
| `gateway_api_key` | no | User-provided Composio key (null = use internal) |

**201 Response (OAuth):**

```json
{
  "connection": {
    "slug": "support_inbox",
    "name": "Support inbox",
    "description": "Primary support mailbox",
    "is_active": true,
    "is_valid": false,
    "status": null,
    "created_at": "2026-02-08T10:00:00Z"
  },
  "redirect_url": "https://connect.composio.dev/link/ln_abc123..."
}
```

Frontend opens `redirect_url` in a popup, then polls `GET .../connections/{connection_slug}` until `is_valid=true`.

**201 Response (API key):**

```json
{
  "connection": {
    "slug": "my_github",
    "name": "My GitHub",
    "is_active": true,
    "is_valid": true,
    "status": null,
    "created_at": "2026-02-08T10:00:00Z"
  },
  "redirect_url": null
}
```

#### `GET .../connections/{connection_slug}` — Poll

Returns the connection with up-to-date flags. When `is_valid=false` and no error status, the service checks the gateway adapter for updated status (supports polling).

```json
{
  "slug": "support_inbox",
  "name": "Support inbox",
  "description": "Primary support mailbox",
  "is_active": true,
  "is_valid": true,
  "status": null,
  "created_at": "2026-02-08T10:00:00Z",
  "updated_at": "2026-02-08T10:01:30Z"
}
```

#### `DELETE .../connections/{connection_slug}` — Disconnect

Revokes provider-side credentials and deletes the connection. **204 No Content.**

The `connection_slug` is permanently consumed — it cannot be reused for a new connection.

#### `POST .../connections/{connection_slug}/refresh` — Refresh

```json
{ "force": false }
```

**200 Response:**

```json
{
  "connection": {
    "slug": "support_inbox",
    "is_active": true,
    "is_valid": true,
    "status": null
  },
  "redirect_url": null
}
```

If `force=true` or re-authentication required, `is_valid=false` and `redirect_url` is provided.

### 11.2 Slug-based — Action-Oriented Operations

For callers that work with tool slugs directly (e.g., LLM agents, playground).

Base path: `/preview/tools`

```
POST /query       → search/filter actions (see section 10.3)
POST /connect     → connect using a tool slug (without connection_slug)
POST /refresh     → refresh a connection using a tool slug (with connection_slug)
POST /inspect     → get action schema + connections using a tool slug
POST /invoke      → execute a tool call using a tool slug (with or without connection_slug)
GET  /callback    → OAuth redirect handler (see section 11.4)
```

#### `POST /connect`

Initiate a connection using the tool slug prefix (provider + integration).

**Request:**

```json
{
  "slug": "tools.composio.gmail",
  "connection_slug": "support_inbox",
  "name": "Support inbox",
  "mode": "oauth",
  "callback_url": "https://app.agenta.ai/tools/callback"
}
```

The slug is `tools.{provider_key}.{integration_key}` — no action_key needed since connections are at the integration level.

**201 Response:** Same shape as the REST `POST .../connections` response.

#### `POST /refresh`

Refresh a connection using a tool slug with `connection_slug`.

**Request:**

```json
{
  "slug": "tools.composio.gmail.support_inbox",
  "force": false
}
```

The slug is `tools.{provider_key}.{integration_key}.{connection_slug}` — no action_key since refresh is at the connection level.

**200 Response:** Same shape as the REST `POST .../connections/{connection_slug}/refresh` response.

#### `POST /inspect` (deferred — detailed in future section)

Given a tool slug, returns the action schema + connections for that integration.

- With `connection_slug`: returns that specific connection's status
- Without `connection_slug`: returns all connections + default resolution

#### `POST /invoke` (deferred — detailed in future section)

Execute a tool call. Uses the full slug with optional `connection_slug` for disambiguation.

### 11.3 Connection Slug Rules

- **Unique per integration per project**: `(project_id, provider_key, integration_key, connection_slug)` is the uniqueness constraint.
- **Not reusable**: once a connection slug is deleted, it cannot be reused. This prevents confusion with audit trails and references in tool call history.
- **User-provided**: the slug is provided by the user at connection time (not auto-generated). It's a meaningful identifier like `support_inbox`, not a random ID.
- **Appears in tool slugs**: when an LLM emits `tools.composio.gmail.SEND_EMAIL.support_inbox`, the `support_inbox` suffix is the connection slug.

### 11.4 OAuth Callback Endpoint

After the user completes OAuth in the provider's popup, the provider redirects to a server-side callback. This endpoint handles the redirect, updates the connection status, and closes the popup.

```
GET /preview/tools/callback?state={state}&code={code}
```

#### Flow

1. **Frontend** calls `POST .../connections` with `callback_url` pointing to this endpoint (or a frontend URL that proxies to it).
2. **Backend** stores the pending connection with a `state` token that maps to `(project_id, provider_key, integration_key, connection_slug)`.
3. **Provider** (Composio) redirects the user to the callback URL after OAuth consent.
4. **Callback endpoint** receives the redirect, verifies `state`, exchanges the `code` with the provider adapter, marks the connection as `is_valid=true`, and returns an HTML page that closes the popup.

#### `GET /preview/tools/callback`

Query params (provider-dependent, but standard OAuth2):

| Param | Description |
|-------|-------------|
| `state` | Opaque token mapping to the pending connection |
| `code` | Authorization code from the OAuth provider |
| `error` | (Optional) OAuth error code if the user denied consent |

**Success response:** `200 OK` with HTML that posts a message to the opener window and closes the popup.

```html
<html>
<body>
<script>
  window.opener.postMessage({ type: "tools:oauth:complete", status: "success" }, "*");
  window.close();
</script>
</body>
</html>
```

**Error response:** `200 OK` with HTML that posts an error message and closes the popup.

```html
<html>
<body>
<script>
  window.opener.postMessage({ type: "tools:oauth:complete", status: "error", error: "access_denied" }, "*");
  window.close();
</script>
</body>
</html>
```

#### Callback URL Configuration

The `callback_url` in the connect request can be:

| Strategy | `callback_url` value | Description |
|----------|---------------------|-------------|
| **Server-side** | `https://api.agenta.ai/preview/tools/callback` | Backend handles redirect directly. Simplest. |
| **Frontend proxy** | `https://app.agenta.ai/tools/callback` | Frontend receives redirect, relays to backend, then closes popup. More control over UX. |

When using the server-side strategy, Composio's `redirect_url` already includes the `state` param. The backend callback endpoint:
1. Extracts `state` from the query string
2. Looks up the pending connection by state token
3. Calls the provider adapter to finalize the connection (exchange code, store tokens)
4. Marks `is_valid=true` in the DB
5. Returns the popup-closing HTML

This eliminates the need for frontend polling — the `postMessage` event tells the frontend the connection is ready.

---

## 12. Implementation Architecture

Gateway Tools is a **hybrid domain** — catalog data (providers, integrations, actions) comes from external adapters (Composio), while only connections are persisted locally. No Git-style revision pattern is needed.

### 12.1 Layer Structure

```
api/oss/src/apis/fastapi/tools/
├── router.py          # Route registration + handlers
├── models.py          # Request/response schemas
└── utils.py           # Query param parsing + merge

api/oss/src/core/tools/
├── dtos.py            # Domain data contracts
├── interfaces.py      # DAO + adapter port contracts
├── service.py         # Business orchestration
└── adapters/
    ├── registry.py    # GatewayAdapterRegistry (dispatches by provider_key)
    └── composio.py    # Composio adapter implementation

api/oss/src/dbs/postgres/tools/
├── dbes.py            # SQLAlchemy entities (ConnectionDBE)
├── dao.py             # ToolsDAO (connection CRUD + query)
└── mappings.py        # DTO ↔ DBE mapping
```

### 12.2 API Layer — `apis/fastapi/tools/`

#### `router.py`

Class-based router following existing patterns.

```python
class ToolsRouter:
    def __init__(self, tools_service: ToolsService):
        self.tools_service = tools_service
        self.router = APIRouter()

        # --- Catalog browse ---
        self.router.add_api_route(
            "/catalog/providers",
            self.list_providers,
            methods=["GET"],
            operation_id="list_tool_providers",
        )
        self.router.add_api_route(
            "/catalog/providers/{provider_key}",
            self.get_provider,
            methods=["GET"],
            operation_id="get_tool_provider",
        )
        self.router.add_api_route(
            "/catalog/providers/{provider_key}/integrations",
            self.list_integrations,
            methods=["GET"],
            operation_id="list_tool_integrations",
        )
        self.router.add_api_route(
            "/catalog/providers/{provider_key}/integrations/{integration_key}",
            self.get_integration,
            methods=["GET"],
            operation_id="get_tool_integration",
        )
        self.router.add_api_route(
            "/catalog/providers/{provider_key}/integrations/{integration_key}/actions",
            self.list_actions,
            methods=["GET"],
            operation_id="list_tool_actions",
        )
        self.router.add_api_route(
            "/catalog/providers/{provider_key}/integrations/{integration_key}/actions/{action_key}",
            self.get_action,
            methods=["GET"],
            operation_id="get_tool_action",
        )

        # --- Catalog query ---
        self.router.add_api_route(
            "/catalog/query",
            self.query_catalog,
            methods=["POST"],
            operation_id="query_tool_catalog",
        )

        # --- Connection CRUD (REST, within catalog hierarchy) ---
        self.router.add_api_route(
            "/catalog/providers/{provider_key}/integrations/{integration_key}/connections",
            self.list_connections,
            methods=["GET"],
            operation_id="list_tool_connections",
        )
        self.router.add_api_route(
            "/catalog/providers/{provider_key}/integrations/{integration_key}/connections",
            self.create_connection,
            methods=["POST"],
            operation_id="create_tool_connection",
            status_code=201,
        )
        self.router.add_api_route(
            "/catalog/providers/{provider_key}/integrations/{integration_key}/connections/{connection_slug}",
            self.get_connection,
            methods=["GET"],
            operation_id="get_tool_connection",
        )
        self.router.add_api_route(
            "/catalog/providers/{provider_key}/integrations/{integration_key}/connections/{connection_slug}",
            self.delete_connection,
            methods=["DELETE"],
            operation_id="delete_tool_connection",
            status_code=204,
        )
        self.router.add_api_route(
            "/catalog/providers/{provider_key}/integrations/{integration_key}/connections/{connection_slug}/refresh",
            self.refresh_connection_rest,
            methods=["POST"],
            operation_id="refresh_tool_connection",
        )

        # --- Slug-based operations ---
        self.router.add_api_route(
            "/query",
            self.query_tools,
            methods=["POST"],
            operation_id="query_tools",
        )
        self.router.add_api_route(
            "/connect",
            self.connect,
            methods=["POST"],
            operation_id="connect_tool",
            status_code=201,
        )
        self.router.add_api_route(
            "/refresh",
            self.refresh,
            methods=["POST"],
            operation_id="refresh_tool",
        )
        self.router.add_api_route(
            "/inspect",
            self.inspect,
            methods=["POST"],
            operation_id="inspect_tool",
        )
        self.router.add_api_route(
            "/invoke",
            self.invoke,
            methods=["POST"],
            operation_id="invoke_tool",
        )
        self.router.add_api_route(
            "/callback",
            self.oauth_callback,
            methods=["GET"],
            operation_id="tool_oauth_callback",
        )
```

All handlers follow the standard pattern:

```python
@intercept_exceptions()
async def query_tools(
    self,
    request: Request,
    *,
    query_request_params: Optional[ToolQueryRequest] = Depends(
        parse_tool_query_request_from_params
    ),
) -> ToolsResponse:
    # Parse body, merge with params (same pattern as workflows)
    ...

    tools = await self.tools_service.query_tools(
        project_id=UUID(request.state.project_id),
        #
        tool_query=tool_query_request.tool,
        #
        include_connections=tool_query_request.include_connections,
        #
        windowing=tool_query_request.windowing,
    )

    return ToolsResponse(
        count=len(tools),
        tools=tools,
    )
```

#### `models.py`

Request/response schemas (see sections 10.3 and 10.4 for the full definitions). Wraps core DTOs with envelope pattern:

```python
# Catalog query
class ActionQueryRequest(BaseModel): ...
class ActionsResponse(BaseModel):
    count: int = 0
    actions: List[Action] = []

# Tool query
class ToolQueryRequest(BaseModel): ...
class ToolsResponse(BaseModel):
    count: int = 0
    tools: List[Tool] = []

# Connection
class ConnectionCreateRequest(BaseModel): ...
class ConnectionResponse(BaseModel):
    connection: Connection
    redirect_url: Optional[str] = None
```

#### `utils.py`

Query param parsing and merge — same pattern as workflows:

```python
def parse_tool_query_request_from_params(
    name: Optional[str] = Query(None),
    provider_key: Optional[str] = Query(None),
    integration_key: Optional[str] = Query(None),
    tags: Optional[str] = Query(None),          # JSON string
    is_connected: Optional[bool] = Query(None),
    include_connections: Optional[bool] = Query(None),
    #
    next: Optional[UUID] = Query(None),
    limit: Optional[int] = Query(None),
    order: Optional[Literal["ascending", "descending"]] = Query(None),
) -> ToolQueryRequest:
    ...

def merge_tool_query_requests(
    params: Optional[ToolQueryRequest],
    body: Optional[ToolQueryRequest],
) -> ToolQueryRequest:
    # Body takes precedence over params
    ...
```

### 12.3 Core Layer — `core/tools/`

#### `dtos.py`

Domain data contracts. Reuses shared `Windowing` and `Tags`.

```python
from oss.src.core.shared.dtos import Windowing

Tags = Dict[str, Any]  # dot-notation JSONb

# --- Catalog query DTOs ---

class ActionQuery(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    provider_key: Optional[str] = None
    integration_key: Optional[str] = None
    tags: Optional[Tags] = None

# --- Tool query DTOs ---

class ToolQueryFlags(BaseModel):
    is_connected: Optional[bool] = None

class ToolQuery(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    provider_key: Optional[str] = None
    integration_key: Optional[str] = None
    tags: Optional[Tags] = None
    flags: Optional[ToolQueryFlags] = None

# --- Connection DTOs ---

class ConnectionCreate(BaseModel):
    slug: str
    name: Optional[str] = None
    description: Optional[str] = None
    mode: Literal["oauth", "api_key"]
    callback_url: Optional[str] = None
    credentials: Optional[Dict[str, str]] = None

class Connection(BaseModel):
    id: UUID
    slug: str
    name: Optional[str] = None
    description: Optional[str] = None
    provider_key: str
    integration_key: str
    is_active: bool
    is_valid: bool
    status: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

# --- Adapter DTOs (what adapters return) ---

class CatalogProvider(BaseModel):
    key: str
    name: str
    description: Optional[str] = None
    integrations_count: int = 0
    enabled: bool = True

class CatalogIntegration(BaseModel):
    key: str
    name: str
    description: Optional[str] = None
    logo: Optional[str] = None
    auth_schemes: List[str] = []
    actions_count: int = 0
    categories: List[str] = []
    no_auth: bool = False

class CatalogAction(BaseModel):
    key: str
    name: str
    description: Optional[str] = None
    tags: Optional[Tags] = None
    input_schema: Optional[Dict[str, Any]] = None
    output_schema: Optional[Dict[str, Any]] = None
```

#### `interfaces.py`

Two contracts: one for the DB (connections), one for external adapters (catalog + execution).

```python
class ToolsDAOInterface(ABC):
    """Connection persistence."""

    @abstractmethod
    async def create_connection(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        provider_key: str,
        integration_key: str,
        #
        connection_create: ConnectionCreate,
    ) -> Optional[Connection]:
        ...

    @abstractmethod
    async def get_connection(
        self,
        *,
        project_id: UUID,
        #
        provider_key: str,
        integration_key: str,
        connection_slug: str,
    ) -> Optional[Connection]:
        ...

    @abstractmethod
    async def delete_connection(
        self,
        *,
        project_id: UUID,
        #
        provider_key: str,
        integration_key: str,
        connection_slug: str,
    ) -> bool:
        ...

    @abstractmethod
    async def query_connections(
        self,
        *,
        project_id: UUID,
        #
        provider_key: Optional[str] = None,
        integration_key: Optional[str] = None,
    ) -> List[Connection]:
        ...


class GatewayAdapterInterface(ABC):
    """Port for external tool providers (Composio, Agenta, etc.)."""

    @abstractmethod
    async def list_providers(self) -> List[CatalogProvider]:
        ...

    @abstractmethod
    async def list_integrations(
        self,
        *,
        search: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> List[CatalogIntegration]:
        ...

    @abstractmethod
    async def list_actions(
        self,
        *,
        integration_key: str,
        search: Optional[str] = None,
        tags: Optional[Tags] = None,
        limit: Optional[int] = None,
    ) -> List[CatalogAction]:
        ...

    @abstractmethod
    async def get_action(
        self,
        *,
        integration_key: str,
        action_key: str,
    ) -> Optional[CatalogAction]:
        ...

    @abstractmethod
    async def initiate_connection(
        self,
        *,
        entity_id: str,
        integration_key: str,
        auth_config_id: str,
        callback_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Returns provider-side connection ID + redirect_url (for OAuth)."""
        ...

    @abstractmethod
    async def get_connection_status(
        self,
        *,
        provider_connection_id: str,
    ) -> Dict[str, Any]:
        """Poll provider for updated connection status."""
        ...

    @abstractmethod
    async def refresh_connection(
        self,
        *,
        provider_connection_id: str,
        force: bool = False,
    ) -> Dict[str, Any]:
        ...

    @abstractmethod
    async def delete_connection(
        self,
        *,
        provider_connection_id: str,
    ) -> bool:
        ...

    @abstractmethod
    async def execute(
        self,
        *,
        action_key: str,
        integration_key: str,
        provider_connection_id: str,
        arguments: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Execute a tool action. Returns { data, error, successful }."""
        ...
```

#### `service.py`

The service **joins two sources**: adapter (catalog) + DAO (connections).

```python
class ToolsService:
    def __init__(
        self,
        *,
        tools_dao: ToolsDAOInterface,
        adapter_registry: GatewayAdapterRegistry,
    ):
        self.tools_dao = tools_dao
        self.adapter_registry = adapter_registry

    # --- Catalog browse (delegated to adapter) ---

    async def list_providers(self) -> List[CatalogProvider]:
        results = []
        for key, adapter in self.adapter_registry.items():
            providers = await adapter.list_providers()
            results.extend(providers)
        return results

    async def list_integrations(
        self,
        *,
        project_id: UUID,
        provider_key: str,
        #
        search: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> List[CatalogIntegration]:
        adapter = self.adapter_registry.get(provider_key)
        integrations = await adapter.list_integrations(
            search=search,
            limit=limit,
        )

        # Enrich with local connection counts
        connections = await self.tools_dao.query_connections(
            project_id=project_id,
            provider_key=provider_key,
        )
        counts = _count_by_integration(connections)
        for integration in integrations:
            integration.connections_count = counts.get(integration.key, 0)

        return integrations

    # --- Tool query (joins adapter + DAO) ---

    async def query_tools(
        self,
        *,
        project_id: UUID,
        #
        tool_query: Optional[ToolQuery] = None,
        #
        include_connections: Optional[bool] = True,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[Tool]:
        query = tool_query or ToolQuery()

        # 1. Fetch actions from adapter (filtered by catalog criteria)
        adapter = self.adapter_registry.get(query.provider_key or "composio")
        actions = await adapter.list_actions(
            integration_key=query.integration_key,
            search=query.name,
            tags=query.tags,
        )

        # 2. Fetch connections from DAO
        connections = await self.tools_dao.query_connections(
            project_id=project_id,
            provider_key=query.provider_key,
            integration_key=query.integration_key,
        )
        connections_by_integration = _group_by_integration(connections)

        # 3. Expand: action × connection → tools
        tools = []
        for action in actions:
            conns = connections_by_integration.get(action.integration_key, [])
            if conns:
                for conn in conns:
                    tools.append(_make_tool(action, conn, include_connections))
            else:
                tools.append(_make_tool(action, None, include_connections))

        # 4. Apply flags filter (is_connected)
        if query.flags and query.flags.is_connected is not None:
            if query.flags.is_connected:
                tools = [t for t in tools if t.connection is not None]
            else:
                tools = [t for t in tools if t.connection is None]

        # 5. Apply windowing (in-memory for now; can optimize later)
        ...

        return tools

    # --- Connection management ---

    async def create_connection(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        provider_key: str,
        integration_key: str,
        #
        connection_create: ConnectionCreate,
    ) -> Tuple[Connection, Optional[str]]:
        adapter = self.adapter_registry.get(provider_key)

        # Initiate with provider (get redirect_url for OAuth)
        provider_result = await adapter.initiate_connection(
            entity_id=f"project_{project_id}",
            integration_key=integration_key,
            callback_url=connection_create.callback_url,
            ...
        )

        # Persist locally
        connection = await self.tools_dao.create_connection(
            project_id=project_id,
            user_id=user_id,
            #
            provider_key=provider_key,
            integration_key=integration_key,
            #
            connection_create=connection_create,
        )

        redirect_url = provider_result.get("redirect_url")
        return connection, redirect_url
```

#### `adapters/registry.py`

```python
class GatewayAdapterRegistry:
    def __init__(
        self,
        *,
        adapters: Dict[str, GatewayAdapterInterface],
    ):
        self._adapters = adapters

    def get(self, provider_key: str) -> GatewayAdapterInterface:
        adapter = self._adapters.get(provider_key)
        if not adapter:
            raise ProviderNotFoundError(provider_key)
        return adapter

    def items(self) -> ItemsView[str, GatewayAdapterInterface]:
        return self._adapters.items()
```

#### `adapters/composio.py`

Maps between Agenta DTOs and Composio's V3 API.

```python
class ComposioAdapter(GatewayAdapterInterface):
    def __init__(self, *, api_key: str, base_url: str = "https://backend.composio.dev/api/v3"):
        self.api_key = api_key
        self.base_url = base_url

    async def list_integrations(self, *, search=None, limit=None):
        # GET /toolkits?search=...&limit=...
        # Map response → List[CatalogIntegration]
        ...

    async def list_actions(self, *, integration_key, search=None, tags=None, limit=None):
        # GET /tools?toolkit_slug={integration_key}&limit=...
        # Map response → List[CatalogAction]
        ...

    async def execute(self, *, action_key, integration_key, provider_connection_id, arguments):
        # POST /tools/execute/{INTEGRATION_KEY}_{ACTION_KEY}
        # Map { connected_account_id, arguments } → { data, error, successful }
        ...
```

### 12.4 DB Layer — `dbs/postgres/tools/`

#### `dbes.py`

Only connections are persisted. No Git pattern needed.

```python
class ConnectionDBE(Base, ProjectScopeDBA):
    __tablename__ = "tool_connections"

    id = Column(UUID(as_uuid=True), nullable=False, default=uuid7)
    slug = Column(String, nullable=False)
    name = Column(String, nullable=True)
    description = Column(String, nullable=True)
    #
    provider_key = Column(String, nullable=False)
    integration_key = Column(String, nullable=False)
    #
    provider_connection_id = Column(String, nullable=True)  # Composio connected_account_id
    auth_config_id = Column(String, nullable=True)          # Composio auth_config_id
    #
    is_active = Column(Boolean, nullable=False, default=True)
    is_valid = Column(Boolean, nullable=False, default=False)
    status = Column(String, nullable=True)
    #
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.current_timestamp())
    updated_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_by_id = Column(UUID(as_uuid=True), nullable=False)

    __table_args__ = (
        PrimaryKeyConstraint("project_id", "id"),
        UniqueConstraint("project_id", "provider_key", "integration_key", "slug"),
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        Index("ix_tool_connections_project_provider_integration",
              "project_id", "provider_key", "integration_key"),
    )
```

#### `dao.py`

Standard DAO with connection CRUD. Uses `ilike` for name filtering, JSONb contains for tags (if stored locally — otherwise adapter handles it).

#### `mappings.py`

`map_dto_to_dbe` / `map_dbe_to_dto` following the shared pattern.

### 12.5 Entrypoint Wiring

In `api/entrypoints/routers.py`:

```python
from oss.src.dbs.postgres.tools.dbes import ConnectionDBE
from oss.src.dbs.postgres.tools.dao import ToolsDAO
from oss.src.core.tools.adapters.composio import ComposioAdapter
from oss.src.core.tools.adapters.registry import GatewayAdapterRegistry
from oss.src.core.tools.service import ToolsService
from oss.src.apis.fastapi.tools.router import ToolsRouter

# DAO
tools_dao = ToolsDAO(ConnectionDBE=ConnectionDBE)

# Adapters
composio_adapter = ComposioAdapter(
    api_key=settings.composio_api_key,
)
adapter_registry = GatewayAdapterRegistry(
    adapters={"composio": composio_adapter},
)

# Service
tools_service = ToolsService(
    tools_dao=tools_dao,
    adapter_registry=adapter_registry,
)

# Router
tools = ToolsRouter(tools_service=tools_service)

app.include_router(
    router=tools.router,
    prefix="/preview/tools",
    tags=["Tools"],
)
```

### 12.6 Key Architectural Decisions

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| **What's persisted** | Only connections | Catalog data lives in external providers. No need to replicate. |
| **Git pattern** | Not used | Connections don't need revision history. Simple CRUD. |
| **Tool query join** | Service-layer join | Actions from adapter + connections from DAO, expanded in-memory. Can optimize with caching later. |
| **Adapter interface** | Single `GatewayAdapterInterface` | Composio and future providers (Agenta built-in) implement the same port. |
| **Slug parsing** | Router/utils layer | Parse `tools.{provider}.{integration}.{action}[.{connection}]` before calling service. Service works with decomposed keys. |
| **Catalog filtering** | Delegated to adapter | `name`, `tags`, `integration_key` filtering happens in the Composio API call. DAO only filters connections. |
| **Connection filtering** | DAO + service | `is_connected` flag is applied after the action × connection join in the service. |
| **Windowing** | Reuses shared `Windowing` DTO | Standard cursor pagination. For tool query (in-memory join), windowing is applied post-join. For connection CRUD, windowing is applied in the DAO query. |

---

## 13. AI Services Convergence

The existing AI Services PR (`feat/refine-ai-feature`, `POST /preview/ai/services/tools/call`) ships a single Agenta-internal tool (`tools.agenta.api.refine_prompt`) with MCP-shaped contracts and hardcoded dispatch. This section describes how to fold it into the Gateway Tools architecture.

### 13.1 Current AI Services Shape

```
POST /preview/ai/services/tools/call

Request:  { name: str, arguments: Dict }              ← MCP-shaped, single call
Response: { content: [{type, text}], isError: bool }   ← MCP-shaped
Dispatch: if name != "tools.agenta.api.refine_prompt": raise 400
```

Key properties:
- **Single tool only**: `tools.agenta.api.refine_prompt`
- **No batch**: one call per request (no `tool_call_id`)
- **`arguments` is a Dict**, not a JSON string
- **MCP-shaped response**: `{ content, structuredContent, isError, meta }`
- **Env-gated**: requires `AGENTA_AI_SERVICES_*` env vars
- **Calls Agenta cloud**: HTTP client to deployed prompt on `cloud.agenta.ai`
- **EE permission check** + **rate limiting** (burst=10, 30/min)

### 13.2 Convergence: AgentaAdapter

AI Services becomes `AgentaAdapter` — a `GatewayAdapterInterface` implementation registered under `provider_key: "agenta"`.

```
api/oss/src/core/tools/adapters/
├── registry.py      # GatewayAdapterRegistry
├── composio.py      # ComposioAdapter
└── agenta.py        # AgentaAdapter (absorbs ai_services)
```

#### `adapters/agenta.py`

```python
class AgentaAdapter(GatewayAdapterInterface):
    """Built-in Agenta tools (refine_prompt, etc.)."""

    def __init__(self, *, ai_services_config: AIServicesConfig):
        self.config = ai_services_config
        self.client = AIServicesClient(config=ai_services_config)

        # Static catalog — Agenta tools are hardcoded, not discovered dynamically
        self._integrations = {
            "api": CatalogIntegration(
                key="api",
                name="Agenta API",
                description="Built-in AI-powered tools",
                auth_schemes=[],     # No auth needed (env-var gated)
                no_auth=True,
                actions_count=1,
                categories=["ai"],
            ),
        }
        self._actions = {
            "api": {
                "refine_prompt": CatalogAction(
                    key="refine_prompt",
                    name="Refine Prompt",
                    description="AI-powered prompt refinement",
                    tags={"important": True},
                    input_schema={...},   # From existing ToolDefinition.inputSchema
                    output_schema={...},
                ),
            },
        }

    # --- Catalog (static) ---

    async def list_providers(self) -> List[CatalogProvider]:
        return [CatalogProvider(
            key="agenta",
            name="Agenta",
            description="Built-in AI-powered tools",
            integrations_count=len(self._integrations),
            enabled=self.config.enabled,
        )]

    async def list_integrations(self, *, search=None, limit=None):
        return list(self._integrations.values())

    async def list_actions(self, *, integration_key, search=None, tags=None, limit=None):
        actions = self._actions.get(integration_key, {})
        return list(actions.values())

    async def get_action(self, *, integration_key, action_key):
        return self._actions.get(integration_key, {}).get(action_key)

    # --- Connections (no-op for Agenta tools) ---

    async def initiate_connection(self, **kwargs):
        raise NotSupported("Agenta tools do not require connections")

    async def get_connection_status(self, **kwargs):
        raise NotSupported("Agenta tools do not require connections")

    async def refresh_connection(self, **kwargs):
        raise NotSupported("Agenta tools do not require connections")

    async def delete_connection(self, **kwargs):
        raise NotSupported("Agenta tools do not require connections")

    # --- Execution (delegates to existing AIServicesClient) ---

    async def execute(
        self,
        *,
        action_key: str,
        integration_key: str,
        provider_connection_id: str,  # ignored for Agenta tools
        arguments: Dict[str, Any],
    ) -> Dict[str, Any]:
        # Reuse existing AI Services client
        mcp_response = await self.client.call_tool(
            name=f"tools.agenta.{integration_key}.{action_key}",
            arguments=arguments,
        )

        # Normalize MCP → common shape
        return {
            "data": mcp_response.get("structuredContent") or _extract_text(mcp_response),
            "error": _extract_error(mcp_response) if mcp_response.get("isError") else None,
            "successful": not mcp_response.get("isError", False),
        }
```

### 13.3 What Changes in AI Services Code

| Component | Current (ai_services) | After convergence |
|-----------|----------------------|-------------------|
| `core/ai_services/client.py` | HTTP client to cloud | **Kept as-is** — reused inside `AgentaAdapter` |
| `core/ai_services/service.py` | Dispatches tool calls | **Removed** — replaced by `ToolsService` + `AgentaAdapter` |
| `core/ai_services/dtos.py` | `ToolDefinition`, `ToolCallRequest/Response` | **Removed** — replaced by `core/tools/dtos.py` |
| `apis/fastapi/ai_services/router.py` | `POST /preview/ai/services/tools/call` | **Kept as deprecation alias** (see below) |
| `apis/fastapi/ai_services/models.py` | MCP-shaped request/response | **Kept** for the legacy alias endpoint |
| Env config (`AIServicesConfig`) | Standalone | **Moved to** `AgentaAdapter` constructor |
| Rate limiting | In router | **Moved to** `ToolsRouter` or `ToolsService` |
| EE permission check | In router | **Reused in** `ToolsRouter` |

### 13.4 Migration Path

**Phase 1: Ship Gateway Tools with AgentaAdapter**

```python
# api/entrypoints/routers.py

# Agenta adapter (absorbs AI Services)
agenta_adapter = AgentaAdapter(
    ai_services_config=AIServicesConfig.from_env(),
)

# Composio adapter
composio_adapter = ComposioAdapter(
    api_key=settings.composio_api_key,
)

# Registry with both providers
adapter_registry = GatewayAdapterRegistry(
    adapters={
        "agenta": agenta_adapter,
        "composio": composio_adapter,
    },
)

# Single tools router
tools_service = ToolsService(
    tools_dao=tools_dao,
    adapter_registry=adapter_registry,
)
tools = ToolsRouter(tools_service=tools_service)
app.include_router(tools.router, prefix="/preview/tools", tags=["Tools"])
```

After this, `tools.agenta.api.refine_prompt` is invokable via `POST /preview/tools/invoke` — same endpoint as `tools.composio.gmail.SEND_EMAIL`.

**Phase 2: Legacy alias (keep old endpoint running)**

The existing `POST /preview/ai/services/tools/call` stays mounted during transition. Its handler becomes a thin adapter:

```python
# apis/fastapi/ai_services/router.py (modified)

@intercept_exceptions()
async def call_tool(self, request: Request, *, tool_call: ToolCallRequest):
    # Translate MCP-shaped request → gateway invoke
    result = await self.tools_service.invoke(
        project_id=UUID(request.state.project_id),
        #
        slug=tool_call.name,              # "tools.agenta.api.refine_prompt"
        arguments=tool_call.arguments,    # Dict, not JSON string
    )

    # Translate gateway result → MCP-shaped response
    return ToolCallResponse(
        content=[{"type": "text", "text": json.dumps(result.get("data", {}))}],
        structuredContent=result.get("data"),
        isError=not result.get("successful", True),
        meta={"trace_id": result.get("trace_id")},
    )
```

**Phase 3: Deprecate legacy endpoint**

Once callers migrate to `POST /preview/tools/invoke`, remove the legacy alias.

### 13.5 Slug Dispatch Flow

```
POST /preview/tools/invoke
  body: { tool_calls: [{ function: { name: "tools.agenta.api.refine_prompt", arguments: "..." } }] }

→ ToolsRouter parses slug: provider_key="agenta", integration_key="api", action_key="refine_prompt"
→ ToolsService.invoke() → adapter_registry.get("agenta") → AgentaAdapter
→ AgentaAdapter.execute(integration_key="api", action_key="refine_prompt", arguments={...})
→ AIServicesClient.call_tool("tools.agenta.api.refine_prompt", arguments)
→ HTTP POST to cloud.agenta.ai → MCP response
→ AgentaAdapter normalizes MCP → { data, error, successful }
→ ToolsService wraps into ToolMessage / ToolError
→ ToolsRouter returns OpenAI-shaped ToolServiceResponse
```

### 13.6 Agenta Tools vs Composio Tools

| Aspect | `tools.agenta.*` | `tools.composio.*` |
|--------|------------------|---------------------|
| **Catalog source** | Static (hardcoded in adapter) | Dynamic (Composio API) |
| **Connections** | Not needed (env-var gated) | Required (OAuth / API key) |
| **Execution backend** | Agenta cloud (deployed prompts) | Composio API |
| **Auth** | `AGENTA_AI_SERVICES_*` env vars | Per-connection OAuth tokens |
| **Tool query behavior** | Always `connection: null`, `flags.is_connected` doesn't apply | Expanded per connection |
| **Rate limiting** | Adapter-level (burst=10, 30/min) | Provider-level (Composio handles) |
| **New tools** | Add to `AgentaAdapter._actions` dict | Available via Composio catalog |
