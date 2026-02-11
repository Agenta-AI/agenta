# Gateway Tools — Implementation Spec

This document is the implementation blueprint for Gateway Tools.
It consolidates the RFC, summary, and examples docs into a single actionable reference with all design decisions resolved.

---

## 1. Resolved Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Slug format** | User-centric: `tools.gateway.{provider}.{tool}[.{slug}]` | Users should not care about how Gmail is connected (Composio vs MCP). Gateway kind is resolved from the tool record. |
| **Route prefix** | `/preview/tools` | Matches convention for new domains (e.g., `/preview/workflows`, `/preview/evaluations`). |
| **Composio SDK** | No SDK — use `httpx` directly | Avoids heavy transitive dependency. We only need ~7 REST endpoints. `httpx` is already in deps. |
| **Persistence** | Standalone `tools` table | New DB entity with dedicated columns. No coupling to secrets infrastructure. Can migrate to secrets later if needed. |
| **Catalog source** | Composio API, cached in-memory (TTL) | Catalog items are a provider concern, not an Agenta entity. `cachetools.TTLCache` (already in deps) with 5-min TTL. |
| **OAuth flow** | Frontend polling (no callback endpoint) | `POST /` returns `redirect_url`. Frontend opens popup. Polls `GET /{tool_id}` until `is_valid=true`. |
| **Encryption** | No PGP encryption for v1 | `auth_data` and `gateway_api_key` stored in plain JSONB/text. Can migrate sensitive fields to encrypted storage later. |

---

## 2. Architecture

```
┌─────────────┐
│ ToolsRouter  │  ← HTTP boundary (FastAPI)
└──────┬───────┘
       │
┌──────▼───────┐
│ ToolsService  │  ← Business orchestration
└──┬────────┬──┘
   │        │
   │   ┌────▼──────────────────┐
   │   │ GatewayAdapterRegistry │
   │   └────┬──────────────────┘
   │        │
   │   ┌────▼──────────┐
   │   │ComposioAdapter │  ← httpx → Composio REST API v3
   │   │(future: MCP,   │
   │   │ Custom, Agenta)│
   │   └───────────────┘
   │
┌──▼──────────────────────┐
│ ToolsDAO       │  ← Postgres CRUD (tools table)
│ (via DAOInterface)       │
└─────────────────────────┘
```

Dependency direction: `Router → Service → DAOInterface + AdapterInterface → DAO Implementation + Adapter Implementation`

---

## 3. Tool Slug Strategy

### Format

```
tools.gateway.{provider}.{tool}              ← unbound
tools.gateway.{provider}.{tool}.{slug}       ← bound
```

- **provider**: user-facing tool family (`gmail`, `github`, `slack`, `jira`)
- **tool**: capability name (`SEND_EMAIL`, `CREATE_ISSUE`)
- **slug**: project-unique slug disambiguating multiple tools for the same provider

### Resolution Rules

| Scenario | Behavior |
|----------|----------|
| Unbound slug, exactly 1 ACTIVE tool for provider | Auto-resolve to that tool |
| Unbound slug, 0 tools | `TOOL_NOT_CONNECTED` error |
| Unbound slug, >1 tools | `TOOL_AMBIGUOUS` error (response includes available slugs) |
| Bound slug | Resolve to the specific tool matching `slug` |

### Examples

```
tools.gateway.gmail.SEND_EMAIL                  ← unbound (1 gmail tool)
tools.gateway.gmail.SEND_EMAIL.support_inbox    ← bound
tools.gateway.gmail.SEND_EMAIL.marketing_inbox  ← bound (different tool)
```

---

## 4. Tool Entity

Tools are persisted as rows in the `tools` table. The `auth_data` column (JSONB) carries all gateway-specific context.

### Table Schema

See [api-reference.md § 3.1](api-reference.md#31-dbe-sqlalchemy-entity) for the full DBE definition.

Key columns:
| Column | Type | Description |
|--------|------|-------------|
| `provider` | str | User-facing provider (`gmail`, `slack`, etc.) |
| `slug` | str | Project-unique identifier for this tool |
| `gateway_kind` | str | Which gateway handles execution (`composio`, `mcp`, `custom`, `agenta`) |
| `flags` | JSONB | `{is_active, is_valid, status: {code, message, type}}` — follows SSO provider pattern |
| `auth_data` | JSONB | Gateway-specific execution context (see below) |
| `gateway_api_key` | str? | User-provided gateway key. `null` = use internal key if available. |

### auth_data Shapes (by gateway kind)

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

## 5. API Endpoints

Base: `/preview/tools`

All endpoints are on the base path. See [api-reference.md](api-reference.md) for full request/response examples with JSON payloads.

| Method | Path | Request Body | Response | Description |
|--------|------|-------------|----------|-------------|
| `GET` | `/catalog` | — | `CatalogResponse` | Browse available tools from gateway providers |
| `POST` | `/inspect` | `ToolServiceRequest` | `ToolServiceRequest` (populated) | Get full schemas + connection status for specific slugs |
| `POST` | `/query` | (optional filters) | `ToolsResponse` | List/filter tools for the project |
| `POST` | `/` | `ToolCreateRequest` | `ToolCreateResponse` (201) | Create a tool (initiate OAuth or API key connection) |
| `GET` | `/{tool_id}` | — | `ToolResponse` | Get a single tool (supports polling for `is_valid`) |
| `DELETE` | `/{tool_id}` | — | 204 | Delete a tool (revokes provider-side when possible) |
| `POST` | `/{tool_id}/refresh` | `ToolRefreshRequest` | `ToolRefreshResponse` | Refresh expired/failed tool |
| `POST` | `/invoke` | `ToolServiceRequest` | `ToolServiceResponse` | Execute tool calls behind the gateway |

### Key behaviors

- **`GET /catalog`**: Query params `provider`, `search`. Schemas omitted from list — use `POST /inspect` for full schemas.
- **`POST /inspect`**: Returns `ToolServiceRequest` populated with `ToolDefinition` entries (full schemas + connection list per provider). Used by playground/agent builder.
- **`POST /query`**: Optional body with `provider`, `slug`, `is_active` filters. Empty body returns all tools.
- **`POST /`**: Returns `redirect_url` for OAuth mode (frontend opens popup, polls `GET /{tool_id}` until `is_valid=true`). For `api_key` mode, returns `is_valid=true` directly.
- **`GET /{tool_id}`**: When `is_valid=false` and no error status, the service checks the gateway adapter for updated flags (supports frontend polling).
- **`POST /invoke`**: Partial success — each tool call independent. Errors in `errors` array, successes in `tool_messages`. HTTP status always `200` unless request body malformed.

---

## 6. Error Model

### Error Codes

| Code | HTTP | Retryable | When |
|------|------|-----------|------|
| `TOOL_NOT_CONNECTED` | 404 | No | No tool exists for the provider |
| `TOOL_AMBIGUOUS` | 409 | No | Multiple tools, slug required |
| `TOOL_INACTIVE` | 422 | No | Tool `is_active=false` |
| `TOOL_INVALID` | 422 | Maybe | Tool `is_valid=false` (expired, failed, pending) |
| `CATALOG_NOT_FOUND` | 404 | No | Tool slug doesn't exist in catalog |
| `INVALID_ARGUMENTS` | 400 | No | Arguments don't match schema |
| `PROVIDER_ERROR` | 502 | Maybe | Upstream execution failed |
| `PROVIDER_RATE_LIMITED` | 502 | Yes | Upstream rate limit hit |
| `PROVIDER_UNAVAILABLE` | 503 | Yes | Upstream service down |

### Error Shape (in `/invoke` response)

```json
{
  "code": "TOOL_AMBIGUOUS",
  "message": "Multiple tools found for gmail. Use a bound slug.",
  "tool_call_id": "call_abc123",
  "retryable": false,
  "details": {
    "available_slugs": ["support_inbox", "marketing_inbox"]
  }
}
```

For non-`/invoke` endpoints, exceptions map to standard HTTP status codes. See [api-reference.md § Appendix](api-reference.md#appendix-error-mapping-non-invoke-endpoints).

---

## 7. Core Contracts

### 7.1 Enums

**New** `api/oss/src/core/tools/enums.py`:
```python
class ToolGatewayKind(str, Enum):
    COMPOSIO = "composio"
    MCP = "mcp"
    CUSTOM = "custom"
    AGENTA = "agenta"

class ToolAuthMode(str, Enum):
    OAUTH = "oauth"
    API_KEY = "api_key"
    MCP = "mcp"
    INTERNAL = "internal"
```

No `ToolStatus` enum — tool state is expressed via `flags` JSONB (`is_active`, `is_valid`, `status`).
No `CapabilityKind` enum — only implementing tools (no resource/prompt distinction).

No changes to `api/oss/src/core/secrets/enums.py`.

### 7.2 DTOs

**New** `api/oss/src/core/tools/dtos.py`:

See [api-reference.md § 2](api-reference.md#2-dtos-core-layer) for full definitions with field comments. Summary:

```python
# --- Catalog ---
class CatalogEntry(BaseModel): ...          # slug, provider, name, display_name, description, input_schema, output_schema
class CatalogQuery(BaseModel): ...          # provider, search, slug, slugs

# --- Flags & Status ---
class ToolServiceStatus(BaseModel): ...     # code, message, type (structured error context)
class ToolFlags(BaseModel): ...             # is_active, is_valid, status: Optional[ToolServiceStatus]

# --- Tools (public view) ---
class Tool(BaseModel): ...                  # id, provider, slug, name, description, gateway_kind, flags (ToolFlags), created_at, updated_at
class ToolCreateRequest(BaseModel): ...     # provider, mode (ToolAuthMode), callback_url, slug, name, description, credentials, gateway_api_key
class ToolRefreshRequest(BaseModel): ...    # force: bool

# --- Tools (DAO layer) ---
class ToolDTO(BaseModel): ...               # id, project_id, provider, slug, gateway_kind, flags (dict), auth_data, gateway_api_key, ...
class ToolCreate(BaseModel): ...            # provider, slug, gateway_kind, flags (default: {is_active: true, is_valid: false}), auth_data, ...
class ToolUpdate(BaseModel): ...            # flags, auth_data, gateway_api_key, name, description

# --- Tool Service Contract (shared for /inspect and /invoke) ---
class ToolDefinition(BaseModel): ...        # slug, provider, name, display_name, description, input_schema, output_schema, connections: List[Tool]
class ToolCallFunction(BaseModel): ...      # name, arguments (JSON string)
class ToolCall(BaseModel): ...              # id, type, function
class ToolServiceRequest(BaseModel): ...    # version, tools: List[ToolDefinition], tool_calls: List[ToolCall]
class ToolMessage(BaseModel): ...           # role, tool_call_id, content (JSON string)
class ToolError(BaseModel): ...             # code, message, tool_call_id, retryable, details
class ToolServiceResponse(BaseModel): ...   # version, status, tool_messages: List[ToolMessage], errors: List[ToolError]
```

### 7.3 Exceptions

**New** `api/oss/src/core/tools/exceptions.py`:

```python
class ToolsServiceError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False, details: dict = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.details = details or {}

class ToolNotConnectedError(ToolsServiceError): ...
class ToolAmbiguousError(ToolsServiceError): ...
class ToolInactiveError(ToolsServiceError): ...
class ToolInvalidError(ToolsServiceError): ...
class CatalogNotFoundError(ToolsServiceError): ...
class InvalidArgumentsError(ToolsServiceError): ...
class ProviderError(ToolsServiceError): ...
```

### 7.4 Gateway Adapter Interface

**New** `api/oss/src/core/tools/interfaces.py`:

```python
class GatewayAdapterInterface(ABC):

    @abstractmethod
    async def list_catalog(
        self,
        *,
        query: CatalogQuery,
    ) -> List[CatalogEntry]: ...

    @abstractmethod
    async def get_catalog_entry(
        self,
        *,
        slug: str,
    ) -> Optional[CatalogEntry]: ...

    @abstractmethod
    async def initiate_connection(
        self,
        *,
        integration: str,
        entity_id: str,
        callback_url: Optional[str] = None,
        auth_mode: str = "oauth",
        credentials: Optional[Dict[str, str]] = None,
        gateway_api_key: Optional[str] = None,
    ) -> Dict[str, Any]: ...

    @abstractmethod
    async def check_connection_status(
        self,
        *,
        auth_data: Dict[str, Any],
        gateway_api_key: Optional[str] = None,
    ) -> str: ...

    @abstractmethod
    async def execute_tool(
        self,
        *,
        tool_name: str,
        arguments: Dict[str, Any],
        auth_data: Dict[str, Any],
        gateway_api_key: Optional[str] = None,
    ) -> Dict[str, Any]: ...

    @abstractmethod
    async def refresh_connection(
        self,
        *,
        auth_data: Dict[str, Any],
        force: bool = False,
        gateway_api_key: Optional[str] = None,
    ) -> Dict[str, Any]: ...

    @abstractmethod
    async def delete_connection(
        self,
        *,
        auth_data: Dict[str, Any],
        gateway_api_key: Optional[str] = None,
    ) -> None: ...
```

### 7.5 Tools DAO Interface

**New** `api/oss/src/core/tools/interfaces.py` (same file):

See [api-reference.md § 3.3](api-reference.md#33-dao-interface) for the full interface. Param naming uses `tool` / `tool_id` / `slug` (not `connection*`).

### 7.6 Slug Parser

**New** `api/oss/src/core/tools/slugs.py`:

See [api-reference.md § 2.5](api-reference.md#25-slug-utilities) for the full definition. Field naming uses `slug` (not `connection_slug`).

---

## 8. Service Layer

**New** `api/oss/src/core/tools/service.py`:

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
```

### Key Methods

#### `list_catalog(project_id, query) → List[CatalogEntry]`
- Queries all registered adapters (or specific one if `query.provider` maps to a known gateway).
- Aggregates and returns results.

#### `inspect_tools(project_id, request) → ToolServiceRequest`
1. Parse each slug in `request.tools` to determine provider, delegate to adapters for full schemas.
2. For each unique provider, query `tools_dao.list(project_id=project_id, provider=provider)` to get matching tools.
3. Assemble `ToolDefinition` entries with catalog data + tool list per provider.
4. Return populated `ToolServiceRequest` (with `tool_calls` empty). Caller enriches with `tool_calls` and sends to `/invoke`.

#### `list_tools(project_id, provider?, slug?, is_active?) → List[Tool]`
1. `tools_dao.list(project_id=project_id, provider=provider, slug=slug, is_active=is_active)`
2. Map `ToolDTO` to public `Tool` DTOs (strip `auth_data`, `gateway_api_key`)

#### `create_tool(project_id, request) → ToolCreateResponse`
1. Determine gateway kind (default `composio` for v1, or inferred from provider)
2. Auto-generate `slug` from `name` if not provided (slugify)
3. `adapter.initiate_connection(integration=provider, entity_id=f"project_{project_id}", ...)`
4. Build `ToolCreate` with `auth_data` from adapter response
5. `tools_dao.create(project_id=project_id, tool=tool_create)`
6. Return `ToolCreateResponse` with tool + optional `redirect_url`

#### `get_tool(project_id, tool_id) → Tool`
1. `tools_dao.get(project_id=project_id, tool_id=tool_id)`
2. If `flags.is_valid=false` and no error status: `adapter.check_connection_status(auth_data=dto.auth_data)`
3. If flags changed → `tools_dao.update(...)` to persist new flags
4. Return public `Tool` DTO

#### `delete_tool(project_id, tool_id) → None`
1. Read tool, extract `auth_data` + `gateway_kind`
2. `adapter.delete_connection(auth_data=dto.auth_data, gateway_api_key=dto.gateway_api_key)`
3. `tools_dao.delete(project_id=project_id, tool_id=tool_id)`

#### `refresh_tool(project_id, tool_id, request) → ToolRefreshResponse`
1. Read tool, get adapter
2. `adapter.refresh_connection(auth_data=dto.auth_data, force=request.force)`
3. Update tool if auth data changed: `tools_dao.update(...)`
4. Return result with tool + optional redirect_url

#### `invoke_tools(project_id, request) → ToolServiceResponse`
For each `tool_call` in `request.tool_calls`:
1. `parse_tool_slug(tool_call.function.name)` → provider, tool_name, slug
2. `_resolve_tool(project_id, provider, slug)` → ToolDTO
3. Validate `flags.is_active=true` (else `ToolInactiveError`) and `flags.is_valid=true` (else `ToolInvalidError`)
4. Get adapter: `adapter_registry.get(ToolGatewayKind(dto.gateway_kind))`
5. Parse `function.arguments` as JSON
6. `adapter.execute_tool(tool_name=..., arguments=..., auth_data=dto.auth_data, gateway_api_key=dto.gateway_api_key)`
7. Build `ToolMessage` on success, `ToolError` on failure

#### `_resolve_tool(project_id, provider, slug?) → ToolDTO`
1. `tools_dao.list(project_id=project_id, provider=provider)`
2. If `slug`: find exact match on `slug`
3. If no slug: count active+valid tools (`is_active=true`)
   - 1 → return it
   - 0 → raise `ToolNotConnectedError`
   - \>1 → raise `ToolAmbiguousError` with available slugs in details

---

## 9. Composio Adapter

**New** `api/oss/src/core/tools/adapters/composio.py`:

```python
class ComposioAdapter(GatewayAdapterInterface):
    def __init__(self, *, api_url: str, default_api_key: str | None = None):
        self.api_url = api_url
        self.default_api_key = default_api_key
        self._catalog_cache = TTLCache(maxsize=100, ttl=300)  # 5-min TTL
```

Uses `httpx.AsyncClient` to call Composio REST API v3:

| Method | Composio Endpoint | Notes |
|--------|------------------|-------|
| `list_catalog` | `GET /api/v3/toolkits` + `GET /api/v3/tools` | List toolkits, then tools per toolkit. Cached. |
| `get_catalog_entry` | `GET /api/v3/tools/{tool_slug}` | Returns full schema |
| `initiate_connection` | `GET /api/v3/auth_configs` + `POST /api/v3/connected_accounts/link` | Resolve auth config, then create link |
| `check_connection_status` | `GET /api/v3/connected_accounts/{ca_id}` | Returns status |
| `execute_tool` | `POST /api/v3/tools/execute/{tool_slug}` | Passes `connected_account_id` + args |
| `refresh_connection` | `POST /api/v3/connected_accounts/{ca_id}/refresh` | Triggers credential refresh |
| `delete_connection` | `DELETE /api/v3/connected_accounts/{ca_id}` | Revokes provider account |

Key: uses `gateway_api_key` if provided by user, else `default_api_key` (system `COMPOSIO_API_KEY`).

See [composio-integration.md](composio-integration.md) for full Composio API details.

**Adapter Registry** `api/oss/src/core/tools/adapters/registry.py`:
```python
class GatewayAdapterRegistry:
    def register(self, kind: ToolGatewayKind, adapter: GatewayAdapterInterface): ...
    def get(self, kind: ToolGatewayKind) -> GatewayAdapterInterface: ...
```

---

## 10. DB Entity & DAO

### 10.1 DBE

See [api-reference.md § 3.1](api-reference.md#31-dbe-sqlalchemy-entity) for the full `ToolDBE` definition.

> File: `api/oss/src/dbs/postgres/tools/dbes.py`

### 10.2 DAO Implementation

> File: `api/oss/src/dbs/postgres/tools/dao.py`

Standard async SQLAlchemy DAO implementing `ToolsDAOInterface`. Filters always include `project_id` for tenant isolation.

### 10.3 DBE ↔ DTO Mappings

> File: `api/oss/src/dbs/postgres/tools/mappings.py`

Maps between `ToolDBE` and `ToolDTO`/`ToolCreate`/`ToolUpdate`.

---

## 11. DB Migration

**New** `api/oss/databases/postgres/migrations/core/versions/<hash>_add_tools_table.py`

```python
"""Add tools table

Revision ID: <generated>
Revises: <current_head>
"""

from alembic import op
import sqlalchemy as sa

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

No changes to `secretkind_enum` or any secrets tables.

---

## 12. Environment Configuration

**Extend** `api/oss/src/utils/env.py`:

```python
class ComposioConfig(BaseModel):
    api_key: str | None = os.getenv("COMPOSIO_API_KEY")
    api_url: str = os.getenv("COMPOSIO_API_URL") or "https://backend.composio.dev/api/v3"

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)
```

Add to `EnvironSettings`:
```python
composio: ComposioConfig = ComposioConfig()
```

---

## 13. Entrypoint Wiring

**Extend** `api/entrypoints/routers.py`:

```python
# Imports
from oss.src.core.tools.service import ToolsService
from oss.src.core.tools.adapters.registry import GatewayAdapterRegistry
from oss.src.core.tools.adapters.composio import ComposioAdapter
from oss.src.core.tools.enums import ToolGatewayKind
from oss.src.apis.fastapi.tools.router import ToolsRouter
from oss.src.dbs.postgres.tools.dao import ToolsDAO

# After existing DAO/service setup:
tools_dao = ToolsDAO(session_factory=session_factory)

gateway_adapter_registry = GatewayAdapterRegistry()
if env.composio.enabled:
    composio_adapter = ComposioAdapter(
        api_url=env.composio.api_url,
        default_api_key=env.composio.api_key,
    )
    gateway_adapter_registry.register(ToolGatewayKind.COMPOSIO, composio_adapter)

tools_service = ToolsService(
    tools_dao=tools_dao,
    adapter_registry=gateway_adapter_registry,
)

tools = ToolsRouter(tools_service=tools_service)

# Mount:
app.include_router(
    router=tools.router,
    prefix="/preview/tools",
    tags=["Tools"],
)
```

---

## 14. File Inventory

### New Files (17)

| # | Path | Purpose |
|---|------|---------|
| 1 | `api/oss/src/core/tools/__init__.py` | Package marker |
| 2 | `api/oss/src/core/tools/enums.py` | ToolGatewayKind, ToolAuthMode |
| 3 | `api/oss/src/core/tools/dtos.py` | All domain DTOs (public + DAO layer) |
| 4 | `api/oss/src/core/tools/exceptions.py` | Service exceptions |
| 5 | `api/oss/src/core/tools/interfaces.py` | GatewayAdapterInterface, ToolsDAOInterface |
| 6 | `api/oss/src/core/tools/slugs.py` | Slug parsing/building |
| 7 | `api/oss/src/core/tools/service.py` | ToolsService |
| 8 | `api/oss/src/core/tools/adapters/__init__.py` | Package marker |
| 9 | `api/oss/src/core/tools/adapters/registry.py` | Adapter registry |
| 10 | `api/oss/src/core/tools/adapters/composio.py` | Composio httpx adapter |
| 11 | `api/oss/src/dbs/postgres/tools/__init__.py` | Package marker |
| 12 | `api/oss/src/dbs/postgres/tools/dbes.py` | ToolDBE |
| 13 | `api/oss/src/dbs/postgres/tools/dao.py` | ToolsDAO |
| 14 | `api/oss/src/dbs/postgres/tools/mappings.py` | DBE ↔ DTO mapping |
| 15 | `api/oss/src/apis/fastapi/tools/__init__.py` | Package marker |
| 16 | `api/oss/src/apis/fastapi/tools/models.py` | API response models (CatalogResponse, ToolsResponse, etc.) |
| 17 | `api/oss/src/apis/fastapi/tools/router.py` | ToolsRouter |

### Modified Files (2)

| # | Path | Change |
|---|------|--------|
| 1 | `api/oss/src/utils/env.py` | Add `ComposioConfig` to `EnvironSettings` |
| 2 | `api/entrypoints/routers.py` | Wire tools components, mount router |

### New Migration (1)

| Path | Change |
|------|--------|
| `api/oss/databases/postgres/migrations/core/versions/<hash>_add_tools.py` | Create `tools` table |

---

## 15. Implementation Order

```
Step 1: Enums + DTOs                     (no deps)
Step 2: Exceptions + Slug parser         (no deps)
Step 3: Gateway interface + DAO interface (depends on Step 1)
Step 4: DBE + DAO implementation         (depends on Steps 1, 3)
Step 5: DB migration                     (depends on Step 4)
Step 6: Composio adapter + env config    (depends on Step 3)
Step 7: ToolsService                     (depends on Steps 1-6)
Step 8: API router                       (depends on Step 7)
Step 9: Entrypoint wiring               (depends on all above)
```

---

## 16. Verification

1. **Migration**: `alembic upgrade head` — verify `tools` table created with correct indexes (incl. GIN on `flags`) and constraints
2. **Catalog**: `GET /preview/tools/catalog` with `COMPOSIO_API_KEY` env var set — verify integrations returned
3. **Inspect**: `POST /preview/tools/inspect` with tool slugs — verify `ToolServiceRequest` returned with full schemas + connections
4. **Create (OAuth)**: `POST /preview/tools/` with `provider=gmail, mode=oauth` — verify tool with `flags.is_valid=false` + `redirect_url`
5. **Poll**: `GET /preview/tools/{tool_id}` — verify flag polling works (`is_valid=false` → `is_valid=true`)
6. **Query**: `POST /preview/tools/query` with `is_active=true` — verify filtered results
7. **Invoke**: `POST /preview/tools/invoke` with bound slug — verify tool resolution + Composio execution
8. **Ambiguity**: Create two gmail tools, call `/invoke` with unbound slug — verify `TOOL_AMBIGUOUS` error with available slugs
9. **Delete**: `DELETE /preview/tools/{tool_id}` — verify Composio revocation + row deleted
10. **Lint**: `ruff format api/ && ruff check --fix api/`
