# Gateway Tools — API Reference (Draft)

Concrete endpoint definitions, request/response models, DTOs, enums, and DB entities.
This is the iterative working document — update this as the design evolves.

---

## Table of Contents

1. [Enums](#1-enums)
2. [DTOs (Core Layer)](#2-dtos-core-layer)
3. [DB Entity — Tool](#3-db-entity--tool)
4. [API Models (Router Layer)](#4-api-models-router-layer)
5. [Endpoints](#5-endpoints)

---

## 1. Enums

> File: `api/oss/src/core/tools/enums.py`

### 1.1 ToolGatewayKind

Which gateway backend handles execution and auth.

```python
class ToolGatewayKind(str, Enum):
    COMPOSIO = "composio"
    MCP = "mcp"
    CUSTOM = "custom"
    AGENTA = "agenta"
```

### 1.2 ToolAuthMode

```python
class ToolAuthMode(str, Enum):
    OAUTH = "oauth"
    API_KEY = "api_key"
    MCP = "mcp"
    INTERNAL = "internal"
```

---

## 2. DTOs (Core Layer)

> File: `api/oss/src/core/tools/dtos.py`

These are the domain data contracts used by `ToolsService` and mapped to/from API models.

### 2.1 Catalog

```python
class CatalogEntry(BaseModel):
    """A single tool from the catalog."""
    slug: str                                      # tools.gateway.gmail.SEND_EMAIL
    provider: str                                  # gmail
    name: str                                      # SEND_EMAIL
    display_name: Optional[str] = None             # "Send email"
    description: Optional[str] = None              # Human-readable description
    input_schema: Optional[Dict[str, Any]] = None  # JSON Schema (included on detail requests)
    output_schema: Optional[Dict[str, Any]] = None # JSON Schema (included on detail requests)


class CatalogQuery(BaseModel):
    """Filter/search params for catalog lookups."""
    provider: Optional[str] = None                 # filter by provider slug
    search: Optional[str] = None                   # free-text search
    slug: Optional[str] = None                     # exact slug (returns full schema)
    slugs: Optional[List[str]] = None              # batch slug lookup (returns full schemas)
```

### 2.2 Flags & Status

```python
class ToolServiceStatus(BaseModel):
    """Structured status — replaces flat last_error string."""
    code: Optional[str] = None                     # e.g. "TOOL_EXPIRED", "PROVIDER_ERROR"
    message: Optional[str] = None                  # Human-readable description
    type: Optional[str] = None                     # Category: "expired", "failed", "error"


class ToolFlags(BaseModel):
    """Tool state flags (stored as JSONB, follows SSO provider pattern)."""
    is_active: bool = True                         # User intent: tool enabled
    is_valid: bool = False                         # Technical state: connection working
    status: Optional[ToolServiceStatus] = None     # Structured error/state context
```

**Flag semantics:**

| is_active | is_valid | status | Meaning |
|-----------|----------|--------|---------|
| `true` | `false` | `null` | OAuth in progress (just created) |
| `true` | `true` | `null` | Ready to use |
| `true` | `false` | `{code: "TOOL_EXPIRED", ...}` | Tokens expired, needs refresh |
| `false` | `false` | `{code: "TOOL_FAILED", ...}` | Setup failed |
| `false` | `true` | `null` | User disabled |

**Transition rules (following SSO provider pattern):**
- On creation: `is_active=true, is_valid=false`
- OAuth completed: `is_valid=true`
- OAuth failed: `is_valid=false, is_active=false`, `status={code, message, type}`
- Tokens expired: `is_valid=false`, `status={code: "TOOL_EXPIRED", ...}`
- Refresh success: `is_valid=true`, `status=null`
- Settings changed: `is_valid=false` (needs re-verification)
- User disables: `is_active=false`

### 2.3 Tools (public view)

```python
class Tool(BaseModel):
    """Public view of a tool (no auth data exposed)."""
    id: UUID
    provider: str                                  # gmail
    slug: str                                      # support_inbox
    name: Optional[str] = None                     # "Support inbox"
    description: Optional[str] = None
    gateway_kind: ToolGatewayKind                  # composio | mcp | custom | agenta
    flags: Optional[ToolFlags] = None              # is_active, is_valid, status
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ToolCreateRequest(BaseModel):
    """Request to create a new tool."""
    provider: str                                  # gmail (user-facing provider slug)
    mode: ToolAuthMode                             # oauth | api_key
    callback_url: Optional[str] = None             # required for OAuth
    slug: Optional[str] = None                     # auto-generated from name if omitted
    name: Optional[str] = None                     # human-readable label
    description: Optional[str] = None
    credentials: Optional[Dict[str, str]] = None   # for api_key mode: {"api_key": "..."}
    gateway_api_key: Optional[str] = None          # user-provided Composio/MCP key (null=use internal)


class ToolRefreshRequest(BaseModel):
    """Request to refresh an expired tool."""
    force: bool = False                            # force re-authentication
```

### 2.4 Tool Service Contract

> Follows `WorkflowServiceRequest` / `WorkflowServiceResponse` pattern.

```python
class ToolDefinition(BaseModel):
    """A tool with its full schema — returned by /inspect, passed back to /invoke."""
    slug: str                                      # tools.gateway.gmail.SEND_EMAIL
    provider: str                                  # gmail
    name: str                                      # SEND_EMAIL
    display_name: Optional[str] = None
    description: Optional[str] = None
    input_schema: Optional[Dict[str, Any]] = None  # JSON Schema
    output_schema: Optional[Dict[str, Any]] = None # JSON Schema
    connections: List[Tool] = []                    # available tools for this provider


class ToolCallFunction(BaseModel):
    """Function call from LLM."""
    name: str                                      # tool slug (bound or unbound)
    arguments: str                                 # JSON string of arguments


class ToolCall(BaseModel):
    """A single tool call (mirrors OpenAI tool_call shape)."""
    id: str                                        # call_abc123
    type: str = "function"
    function: ToolCallFunction


class ToolServiceRequest(BaseModel):
    """Shared contract for /inspect and /invoke.

    /inspect populates `tools` (definitions + schemas + connections).
    /invoke uses `tools` context + `tool_calls` for execution.
    """
    version: str = "2025.07.14"
    tools: List[ToolDefinition] = []               # populated by /inspect
    tool_calls: List[ToolCall] = []                # filled by caller for /invoke


class ToolMessage(BaseModel):
    """Successful tool result (mirrors OpenAI tool message shape)."""
    role: str = "tool"
    tool_call_id: str                              # matches ToolCall.id
    content: str                                   # JSON string of result


class ToolError(BaseModel):
    """Error for a single tool call within /invoke."""
    code: str                                      # error code (see error model)
    message: str                                   # human-readable description
    tool_call_id: str                              # matches ToolCall.id
    retryable: bool                                # can the caller retry?
    details: Optional[Dict[str, Any]] = None       # extra context (e.g., available_slugs)


class ToolServiceStatus(BaseModel):
    """Overall response status (mirrors WorkflowServiceStatus)."""
    code: Optional[int] = 200
    message: Optional[str] = "Success"
    type: Optional[str] = None


class ToolServiceResponse(BaseModel):
    """Response from /invoke — results + errors (partial success is valid)."""
    version: str = "2025.07.14"
    status: Optional[ToolServiceStatus] = None
    tool_messages: List[ToolMessage] = []
    errors: List[ToolError] = []
```

### 2.5 Tool Slug Format

Tool slugs use a **5-part dot-separated format**:

```
tools.{provider}.{integration}.{action}.{connection}
```

| Segment | Example | Description |
|---------|---------|-------------|
| `tools` | `tools` | Literal prefix — always `"tools"` |
| `provider` | `composio` | Gateway provider key (e.g. `"composio"`) |
| `integration` | `gmail` | Integration / toolkit slug |
| `action` | `SEND_EMAIL` | Action key (uppercase convention) |
| `connection` | `support_inbox` | Connection slug identifying which authenticated account to use |

**All five segments are required** for tool execution via `POST /call`.

> LLMs do not support `.` in function names. Use `__` as a separator when building
> function names for LLM `tools` arrays, e.g. `tools__composio__gmail__SEND_EMAIL__support_inbox`.
> The `POST /call` endpoint normalises `__` → `.` before parsing.

**Examples:**

```
tools.composio.gmail.SEND_EMAIL.support_inbox
tools.composio.github.CREATE_ISSUE.work_account
tools__composio__slack__SEND_MESSAGE__team_bot  ← LLM-safe encoding
```
```

---

## 3. DB Entity — Tool

Tool is a **new standalone entity** with its own table. No changes to secrets.

### 3.1 DBE (SQLAlchemy Entity)

> File: `api/oss/src/dbs/postgres/tools/dbes.py`

```python
class ToolDBE(Base):
    __tablename__ = "tools"

    id: Mapped[UUID]               = mapped_column(primary_key=True, default=uuid7)
    project_id: Mapped[UUID]       = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)

    # Identity
    provider: Mapped[str]          = mapped_column(nullable=False)       # gmail, github, slack
    slug: Mapped[str]              = mapped_column(nullable=False)       # project-unique slug
    gateway_kind: Mapped[str]      = mapped_column(nullable=False)       # composio, mcp, custom, agenta

    # Flags (follows SSO provider pattern)
    # Contains: is_active, is_valid, status: {code, message, type}
    flags: Mapped[Optional[dict]]  = mapped_column(JSONB, nullable=True)

    # Display
    name: Mapped[Optional[str]]    = mapped_column(nullable=True)
    description: Mapped[Optional[str]] = mapped_column(nullable=True)

    # Auth context (gateway-specific, opaque JSON)
    # Contains: connected_account_id, user_id, auth_config_id, server_url, headers, etc.
    auth_data: Mapped[dict]        = mapped_column(JSONB, nullable=False, default=dict)

    # Optional user-provided gateway API key
    gateway_api_key: Mapped[Optional[str]] = mapped_column(nullable=True)

    # Lifecycle
    created_at: Mapped[datetime]   = mapped_column(default=func.now())
    updated_at: Mapped[Optional[datetime]] = mapped_column(nullable=True, onupdate=func.now())
    updated_by_id: Mapped[Optional[UUID]] = mapped_column(nullable=True)

    __table_args__ = (
        UniqueConstraint("project_id", "provider", "slug", name="uq_tool_slug"),
        Index("ix_tools_flags", "flags", postgresql_using="gin"),
    )
```

**Key design choices:**
- `flags` is JSONB — stores `is_active`, `is_valid`, `status` (follows SSO `organization_providers.flags` pattern)
- GIN index on `flags` for efficient JSONB queries (e.g., filtering by `is_active`)
- `auth_data` is JSONB — stores gateway-specific context (Composio `connected_account_id`, MCP `server_url`, etc.)
- `gateway_api_key` is a separate column — can be encrypted later without touching the JSONB
- `UniqueConstraint` on `(project_id, provider, slug)` — enforces slug uniqueness per project per provider
- No PGP encryption for v1

### 3.2 Migration

> File: `api/oss/databases/postgres/migrations/core/versions/<hash>_add_tools_table.py`

```python
def upgrade() -> None:
    op.create_table(
        "tools",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("project_id", sa.UUID(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("gateway_kind", sa.String(), nullable=False),
        sa.Column("flags", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("auth_data", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("gateway_api_key", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by_id", sa.UUID(), nullable=True),
        sa.UniqueConstraint("project_id", "provider", "slug", name="uq_tool_slug"),
    )
    op.create_index("ix_tools_project_id", "tools", ["project_id"])
    op.create_index("ix_tools_provider", "tools", ["project_id", "provider"])
    op.create_index("ix_tools_flags", "tools", ["flags"], postgresql_using="gin")

def downgrade() -> None:
    op.drop_table("tools")
```

### 3.3 DAO Interface

> File: `api/oss/src/core/tools/interfaces.py` (alongside GatewayAdapterInterface)

```python
class ToolsDAOInterface(ABC):

    @abstractmethod
    async def create(
        self,
        *,
        project_id: UUID,
        tool: ToolCreate,
    ) -> ToolDTO: ...

    @abstractmethod
    async def get(
        self,
        *,
        project_id: UUID,
        tool_id: UUID,
    ) -> Optional[ToolDTO]: ...

    @abstractmethod
    async def list(
        self,
        *,
        project_id: UUID,
        provider: Optional[str] = None,
        slug: Optional[str] = None,
        is_active: Optional[bool] = None,
    ) -> List[ToolDTO]: ...

    @abstractmethod
    async def update(
        self,
        *,
        project_id: UUID,
        tool_id: UUID,
        updates: ToolUpdate,
    ) -> Optional[ToolDTO]: ...

    @abstractmethod
    async def delete(
        self,
        *,
        project_id: UUID,
        tool_id: UUID,
    ) -> None: ...
```

### 3.4 DAO Implementation

> File: `api/oss/src/dbs/postgres/tools/dao.py`

Standard async SQLAlchemy DAO. Filters always include `project_id` for tenant isolation.

For `is_active` filtering, use JSONB operator:
```python
ToolDBE.flags["is_active"].astext == "true"
```

### 3.5 Core DTOs (DAO layer)

> File: `api/oss/src/core/tools/dtos.py` (add to existing)

```python
class ToolDTO(BaseModel):
    """Full tool data returned from DAO."""
    id: UUID
    project_id: UUID
    provider: str
    slug: str
    gateway_kind: ToolGatewayKind
    flags: Optional[Dict[str, Any]] = None
    name: Optional[str] = None
    description: Optional[str] = None
    auth_data: Dict[str, Any] = {}
    gateway_api_key: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ToolCreate(BaseModel):
    """DAO input for creating a tool."""
    provider: str
    slug: str
    gateway_kind: ToolGatewayKind
    flags: Optional[Dict[str, Any]] = None         # default: {"is_active": true, "is_valid": false}
    name: Optional[str] = None
    description: Optional[str] = None
    auth_data: Dict[str, Any] = {}
    gateway_api_key: Optional[str] = None


class ToolUpdate(BaseModel):
    """DAO input for partial updates."""
    flags: Optional[Dict[str, Any]] = None
    auth_data: Optional[Dict[str, Any]] = None
    gateway_api_key: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
```

### 3.6 auth_data Examples (by gateway kind)

The `auth_data` column stores gateway-specific execution context as JSON. Shape varies by `gateway_kind`.

**Composio:**
```json
{
  "mode": "oauth",
  "connected_account_id": "ca_abc123",
  "user_id": "project_019abc12-3456-7890",
  "auth_config_id": "ac_xyz789"
}
```

**MCP:**
```json
{
  "mode": "mcp",
  "server_url": "https://mcp.customer.example",
  "server_id": "customer-gmail-mcp",
  "headers": { "Authorization": "Bearer ..." }
}
```

**Agenta:**
```json
{
  "mode": "internal",
  "connector_id": "conn_..."
}
```

---

## 4. API Models (Router Layer)

> File: `api/oss/src/apis/fastapi/tools/models.py`

These wrap core DTOs into HTTP response shapes.

```python
class CatalogResponse(BaseModel):
    """GET /catalog response."""
    count: int = 0
    catalog: List[CatalogEntry] = []


class ToolsResponse(BaseModel):
    """POST /query response."""
    count: int = 0
    tools: List[Tool] = []


class ToolResponse(BaseModel):
    """GET /{tool_id} response."""
    tool: Tool


class ToolCreateResponse(BaseModel):
    """POST / response."""
    tool: Tool
    redirect_url: Optional[str] = None


class ToolRefreshResponse(BaseModel):
    """POST /{tool_id}/refresh response."""
    tool: Tool
    redirect_url: Optional[str] = None
```

`ToolServiceRequest` and `ToolServiceResponse` are used directly from `core/tools/dtos.py` for `/inspect` and `/invoke`.

---

## 5. Endpoints

Base path: `/preview/tools`

### 5.1 `GET /catalog` — Browse Tools

List available tools from gateway providers.

| Param | Location | Type | Required | Description |
|-------|----------|------|----------|-------------|
| `provider` | query | str | no | Filter by provider slug (e.g., `gmail`) |
| `search` | query | str | no | Free-text search in name/description |

**200 Response:** `CatalogResponse`

```json
{
  "count": 2,
  "catalog": [
    {
      "slug": "tools.gateway.gmail.SEND_EMAIL",
      "provider": "gmail",
      "name": "SEND_EMAIL",
      "display_name": "Send email",
      "description": "Send an email via Gmail",
      "input_schema": null,
      "output_schema": null
    },
    {
      "slug": "tools.gateway.gmail.READ_EMAIL",
      "provider": "gmail",
      "name": "READ_EMAIL",
      "display_name": "Read email",
      "description": "Read emails from Gmail inbox",
      "input_schema": null,
      "output_schema": null
    }
  ]
}
```

Schemas are omitted from the list for performance. Use `POST /inspect` to get full schemas.

---

### 5.2 `POST /inspect` — Inspect Tool Schemas

Get full schemas and connection status for specific tool slugs. Returns a `ToolServiceRequest` that can be enriched with `tool_calls` and sent to `/invoke`.

**Request Body:** `ToolServiceRequest` (with `tool_calls` empty, slugs derived from `tools` or passed separately)

```json
{
  "version": "2025.07.14",
  "tools": [
    { "slug": "tools.gateway.gmail.SEND_EMAIL" },
    { "slug": "tools.gateway.github.CREATE_ISSUE" }
  ]
}
```

**200 Response:** `ToolServiceRequest` (populated)

```json
{
  "version": "2025.07.14",
  "tools": [
    {
      "slug": "tools.gateway.gmail.SEND_EMAIL",
      "provider": "gmail",
      "name": "SEND_EMAIL",
      "display_name": "Send email",
      "description": "Send an email via Gmail",
      "input_schema": {
        "type": "object",
        "properties": {
          "to": { "type": "string" },
          "subject": { "type": "string" },
          "body": { "type": "string" }
        },
        "required": ["to", "subject", "body"]
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "message_id": { "type": "string" },
          "status": { "type": "string" }
        }
      },
      "connections": [
        {
          "id": "019abc12-...",
          "provider": "gmail",
          "slug": "support_inbox",
          "name": "Support inbox",
          "gateway_kind": "composio",
          "flags": { "is_active": true, "is_valid": true }
        }
      ]
    },
    {
      "slug": "tools.gateway.github.CREATE_ISSUE",
      "provider": "github",
      "name": "CREATE_ISSUE",
      "display_name": "Create issue",
      "description": "Create a GitHub issue",
      "input_schema": { "..." : "..." },
      "output_schema": { "..." : "..." },
      "connections": []
    }
  ],
  "tool_calls": []
}
```

---

### 5.3 `POST /query` — Query Tools

List/filter tools for the current project.

**Request Body:**

```json
{
  "provider": "gmail",
  "slug": "support_inbox",
  "is_active": true
}
```

All fields are optional. Empty body returns all tools.

**200 Response:** `ToolsResponse`

```json
{
  "count": 2,
  "tools": [
    {
      "id": "some-secret-id",
      "provider": "gmail",
      "slug": "support_inbox",
      "name": "Support inbox",
      "description": "Primary support mailbox",
      "gateway_kind": "composio",
      "flags": {
        "is_active": true,
        "is_valid": true,
        "status": null
      },
      "created_at": "2026-01-15T10:00:00Z",
      "updated_at": "2026-01-15T10:05:00Z"
    },
    {
      "id": "019abc12-3456-7890-abcd-ef1234567891",
      "provider": "gmail",
      "slug": "marketing_inbox",
      "name": "Marketing inbox",
      "description": null,
      "gateway_kind": "composio",
      "flags": {
        "is_active": true,
        "is_valid": true,
        "status": null
      },
      "created_at": "2026-02-01T08:30:00Z",
      "updated_at": "2026-02-01T08:35:00Z"
    }
  ]
}
```

---

### 5.4 `POST /` — Create Tool

Create a new tool (initiate OAuth or API key connection).

**Request Body:** `ToolCreateRequest`

```json
{
  "provider": "gmail",
  "mode": "oauth",
  "slug": "support_inbox",
  "name": "Support inbox",
  "description": "Primary support mailbox",
  "callback_url": "https://app.agenta.ai/tools/callback",
  "gateway_api_key": null
}
```

**201 Response (OAuth):** `ToolCreateResponse`

```json
{
  "tool": {
    "id": "some-secret-id",
    "provider": "gmail",
    "slug": "support_inbox",
    "name": "Support inbox",
    "description": "Primary support mailbox",
    "gateway_kind": "composio",
    "flags": {
      "is_active": true,
      "is_valid": false,
      "status": null
    },
    "created_at": "2026-02-08T10:00:00Z",
    "updated_at": null
  },
  "redirect_url": "https://connect.composio.dev/link/ln_abc123..."
}
```

**201 Response (API key):**

```json
{
  "tool": {
    "id": "019abc12-...",
    "provider": "github",
    "slug": "my_github",
    "name": "My GitHub",
    "gateway_kind": "composio",
    "flags": {
      "is_active": true,
      "is_valid": true,
      "status": null
    },
    "..."
  },
  "redirect_url": null
}
```

**Errors:**

| Status | When |
|--------|------|
| 400 | Missing `callback_url` for OAuth mode |
| 400 | Missing `credentials` for api_key mode |
| 409 | `slug` already exists for this provider in this project |
| 502 | Gateway provider failed to initiate connection |

---

### 5.5 `GET /{tool_id}` — Get Tool

Get a single tool. Supports polling: when `is_valid=false` and no error status, the service checks the gateway for updated status.

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| `tool_id` | UUID | Tool ID |

**200 Response:** `ToolResponse`

```json
{
  "tool": {
    "id": "some-secret-id",
    "provider": "gmail",
    "slug": "support_inbox",
    "name": "Support inbox",
    "description": "Primary support mailbox",
    "gateway_kind": "composio",
    "flags": {
      "is_active": true,
      "is_valid": true,
      "status": null
    },
    "created_at": "2026-02-08T10:00:00Z",
    "updated_at": "2026-02-08T10:01:30Z"
  }
}
```

**Errors:**

| Status | When |
|--------|------|
| 404 | Tool not found |

---

### 5.6 `DELETE /{tool_id}` — Delete Tool

Delete a tool. Revokes provider-side account when possible.

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| `tool_id` | UUID | Tool ID |

**204 Response:** No content.

**Errors:**

| Status | When |
|--------|------|
| 404 | Tool not found |
| 502 | Gateway failed to revoke (tool still deleted locally) |

---

### 5.7 `POST /{tool_id}/refresh` — Refresh Tool

Refresh an expired/failed tool connection.

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| `tool_id` | UUID | Tool ID |

**Request Body:** `ToolRefreshRequest`

```json
{ "force": false }
```

**200 Response:** `ToolRefreshResponse`

```json
{
  "tool": {
    "id": "019abc12-...",
    "provider": "gmail",
    "slug": "support_inbox",
    "gateway_kind": "composio",
    "flags": {
      "is_active": true,
      "is_valid": true,
      "status": null
    },
    "..."
  },
  "redirect_url": null
}
```

If `force=true` or re-authentication is required:
```json
{
  "tool": {
    "...",
    "flags": { "is_active": true, "is_valid": false, "status": null }
  },
  "redirect_url": "https://connect.composio.dev/link/ln_..."
}
```

**Errors:**

| Status | When |
|--------|------|
| 404 | Tool not found |
| 502 | Gateway refresh failed |

---

### 5.8 `POST /invoke` — Execute Tool Calls

Execute one or more tool calls behind the gateway. Supports partial success.

**Request Body:** `ToolServiceRequest`

```json
{
  "version": "2025.07.14",
  "tools": [
    {
      "slug": "tools.gateway.gmail.SEND_EMAIL",
      "provider": "gmail",
      "name": "SEND_EMAIL",
      "input_schema": { "..." : "..." },
      "connections": [
        { "id": "019abc12-...", "slug": "support_inbox", "flags": { "is_active": true, "is_valid": true } }
      ]
    }
  ],
  "tool_calls": [
    {
      "id": "call_abc123",
      "type": "function",
      "function": {
        "name": "tools.gateway.gmail.SEND_EMAIL.support_inbox",
        "arguments": "{\"to\": \"alice@example.com\", \"subject\": \"Hello\", \"body\": \"Hi!\"}"
      }
    },
    {
      "id": "call_def456",
      "type": "function",
      "function": {
        "name": "tools.gateway.github.CREATE_ISSUE",
        "arguments": "{\"repo\": \"acme/app\", \"title\": \"Bug\", \"body\": \"...\"}"
      }
    }
  ]
}
```

**200 Response:** `ToolServiceResponse`

```json
{
  "version": "2025.07.14",
  "status": { "code": 200, "message": "Success" },
  "tool_messages": [
    {
      "role": "tool",
      "tool_call_id": "call_abc123",
      "content": "{\"message_id\": \"msg_xyz\", \"status\": \"sent\"}"
    }
  ],
  "errors": [
    {
      "code": "TOOL_NOT_CONNECTED",
      "message": "No active tool found for provider 'github'",
      "tool_call_id": "call_def456",
      "retryable": false,
      "details": {}
    }
  ]
}
```

**Error codes (in `errors` array):**

| Code | Retryable | Description |
|------|-----------|-------------|
| `TOOL_NOT_CONNECTED` | no | No tool exists for the provider |
| `TOOL_AMBIGUOUS` | no | Multiple tools, slug required. `details.available_slugs` populated. |
| `TOOL_INACTIVE` | no | Tool `is_active=false` |
| `TOOL_INVALID` | maybe | Tool `is_valid=false` (expired, failed, pending) |
| `INVALID_ARGUMENTS` | no | Arguments don't match tool schema |
| `CATALOG_NOT_FOUND` | no | Tool slug doesn't exist in catalog |
| `PROVIDER_ERROR` | maybe | Upstream execution failed |
| `PROVIDER_RATE_LIMITED` | yes | Upstream rate limit hit |
| `PROVIDER_UNAVAILABLE` | yes | Upstream service down |

**Note:** HTTP status is always `200` for `/invoke` unless the request body itself is malformed (400). Individual tool call failures are reported in the `errors` array.

---

## Appendix: Error Mapping (Non-invoke Endpoints)

For non-`/invoke` endpoints, exceptions map to standard HTTP errors:

| Exception | HTTP Status |
|-----------|-------------|
| `ToolNotConnectedError` | 404 |
| `CatalogNotFoundError` | 404 |
| `ToolAmbiguousError` | 409 |
| `InvalidArgumentsError` | 400 |
| `ToolInactiveError` | 422 |
| `ToolInvalidError` | 422 |
| `ProviderError` | 502 |
