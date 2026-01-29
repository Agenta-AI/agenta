# API Design: Tools & Integrations

This document defines the API endpoints for managing external tool integrations (via Composio) and tool connections within Agenta.

## Design Principles

1. **Follow existing Agenta patterns** - Router class pattern, DTOs, service layer
2. **Wrap Composio, don't expose it** - Our API abstracts Composio details
3. **Project-scoped connections** - Tools are connected per project (can extend to org later)
4. **Cache aggressively** - Integration catalog is static, cache it
5. **Simple OAuth flow** - Use Composio's hosted OAuth, poll for completion
6. **Composio is optional** - Feature degrades gracefully when not configured (see below)

---

## Feature Availability (Open Source Compatibility)

Since Agenta is open source, Composio integration must be **optional**:

### Backend Behavior

```python
# Check if tools feature is available
def is_tools_feature_enabled() -> bool:
    return bool(env.composio_api_key)
```

### API Response When Disabled

```
GET /api/tools/integrations

# When Composio is not configured:
{
  "enabled": false,
  "message": "Tools integration is not configured. Set COMPOSIO_API_KEY to enable.",
  "items": []
}

# When Composio is configured:
{
  "enabled": true,
  "items": [...]
}
```

### Frontend Behavior

- If `enabled: false`, hide tools UI or show "Not configured" state
- If `enabled: true`, show full tools browser and connection management
- Never break existing functionality when tools are disabled

---

## API Overview

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tools/integrations` | GET | List all available integrations with connection status |
| `/api/tools/integrations/{slug}` | GET | Get integration details |
| `/api/tools/integrations/{slug}/tools` | GET | List tools for an integration |
| `/api/tools/integrations/{slug}/tools/{tool_slug}` | GET | Get tool schema (JSON Schema) |
| `/api/tools/connections` | GET | List project's active connections |
| `/api/tools/connections` | POST | Initiate a new connection (OAuth or API key) |
| `/api/tools/connections/{id}` | GET | Get connection status |
| `/api/tools/connections/{id}` | DELETE | Disconnect/revoke a connection |

---

## Data Model

### Integration (Read-only, from Composio)

An integration represents an external service that can be connected (e.g., Gmail, GitHub, Slack).

```python
class IntegrationDTO(BaseModel):
    slug: str                    # e.g., "gmail", "github"
    name: str                    # e.g., "Gmail", "GitHub"
    description: Optional[str]
    logo_url: Optional[str]
    categories: List[str]        # e.g., ["communication", "email"]
    auth_schemes: List[str]      # e.g., ["OAUTH2"], ["API_KEY"]
    is_connected: bool           # True if project has active connection
    connection_id: Optional[str] # Connected account ID if connected
```

### Tool (Read-only, from Composio)

A tool is an action that can be performed on an integration (e.g., `GMAIL_SEND_EMAIL`).

```python
class ToolSummaryDTO(BaseModel):
    slug: str                    # e.g., "GMAIL_SEND_EMAIL"
    name: str                    # e.g., "Send Email"
    description: str
    integration_slug: str        # e.g., "gmail"

class ToolDetailDTO(ToolSummaryDTO):
    input_schema: dict           # JSON Schema for tool inputs
    output_schema: dict          # JSON Schema for tool outputs
```

### Connection (Stored in Agenta DB)

A connection links a project to a Composio connected account.

```python
class ConnectionDTO(BaseModel):
    id: UUID
    project_id: UUID
    integration_slug: str        # e.g., "gmail"
    integration_name: str        # e.g., "Gmail"
    composio_account_id: str     # Composio's connected_account ID
    status: ConnectionStatus     # ACTIVE, PENDING, FAILED, EXPIRED
    auth_type: str               # OAUTH2, API_KEY
    created_at: datetime
    created_by_id: UUID
```

### Connection Status Enum

```python
class ConnectionStatus(str, Enum):
    PENDING = "PENDING"      # OAuth initiated but not completed
    ACTIVE = "ACTIVE"        # Connected and working
    FAILED = "FAILED"        # Connection attempt failed
    EXPIRED = "EXPIRED"      # Credentials expired (OAuth refresh failed)
```

---

## Endpoints

### 1. List Integrations

```
GET /api/tools/integrations
```

Returns all available integrations with their connection status for the current project.

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `category` | string | Filter by category (optional) |
| `search` | string | Search by name (optional) |
| `connected_only` | bool | Only show connected integrations (optional) |

**Response:**

```json
{
  "items": [
    {
      "slug": "gmail",
      "name": "Gmail",
      "description": "Send and read emails with Gmail",
      "logo_url": "https://composio.dev/logos/gmail.svg",
      "categories": ["communication", "email"],
      "auth_schemes": ["OAUTH2"],
      "is_connected": true,
      "connection_id": "019abc12-3456-7890-abcd-ef1234567890"
    },
    {
      "slug": "github",
      "name": "GitHub",
      "description": "Interact with GitHub repositories",
      "logo_url": "https://composio.dev/logos/github.svg",
      "categories": ["development", "version-control"],
      "auth_schemes": ["OAUTH2"],
      "is_connected": false,
      "connection_id": null
    }
  ],
  "total": 97,
  "categories": ["communication", "development", "productivity", ...]
}
```

**Implementation Notes:**

- Cache the integration catalog from Composio (TTL: 1 hour)
- Merge with project's active connections to set `is_connected`
- Return categories for filtering UI

---

### 2. Get Integration Details

```
GET /api/tools/integrations/{slug}
```

Get details for a specific integration.

**Response:**

```json
{
  "slug": "gmail",
  "name": "Gmail",
  "description": "Send and read emails with Gmail",
  "logo_url": "https://composio.dev/logos/gmail.svg",
  "categories": ["communication", "email"],
  "auth_schemes": ["OAUTH2"],
  "is_connected": true,
  "connection_id": "019abc12-3456-7890-abcd-ef1234567890",
  "auth_config": {
    "type": "OAUTH2",
    "required_fields": [],
    "scopes": ["https://mail.google.com/"]
  }
}
```

---

### 3. List Tools for Integration

```
GET /api/tools/integrations/{slug}/tools
```

List all available tools for an integration.

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `search` | string | Search by tool name/description (optional) |

**Response:**

```json
{
  "items": [
    {
      "slug": "GMAIL_SEND_EMAIL",
      "name": "Send Email",
      "description": "Send an email using Gmail",
      "integration_slug": "gmail"
    },
    {
      "slug": "GMAIL_LIST_MESSAGES",
      "name": "List Messages",
      "description": "List emails in the inbox",
      "integration_slug": "gmail"
    }
  ],
  "total": 12
}
```

**Implementation Notes:**

- Cache tool lists per integration (TTL: 1 hour)
- This endpoint doesn't require a connection (for browsing)

---

### 4. Get Tool Schema

```
GET /api/tools/integrations/{slug}/tools/{tool_slug}
```

Get full JSON Schema for a tool's inputs and outputs.

**Response:**

```json
{
  "slug": "GMAIL_SEND_EMAIL",
  "name": "Send Email",
  "description": "Send an email using Gmail",
  "integration_slug": "gmail",
  "input_schema": {
    "type": "object",
    "properties": {
      "to": {
        "type": "string",
        "description": "Recipient email address"
      },
      "subject": {
        "type": "string",
        "description": "Email subject"
      },
      "body": {
        "type": "string",
        "description": "Email body content"
      }
    },
    "required": ["to", "subject", "body"]
  },
  "output_schema": {
    "type": "object",
    "properties": {
      "message_id": {
        "type": "string",
        "description": "ID of the sent message"
      },
      "thread_id": {
        "type": "string"
      }
    }
  }
}
```

**Implementation Notes:**

- This is the schema used by LLMs for tool calling
- Cache individual tool schemas (TTL: 1 hour)

---

### 5. List Project Connections

```
GET /api/tools/connections
```

List all active connections for the current project.

**Response:**

```json
{
  "items": [
    {
      "id": "019abc12-3456-7890-abcd-ef1234567890",
      "project_id": "019def34-5678-90ab-cdef-1234567890ab",
      "integration_slug": "gmail",
      "integration_name": "Gmail",
      "composio_account_id": "ca_xyz123",
      "status": "ACTIVE",
      "auth_type": "OAUTH2",
      "created_at": "2026-01-29T10:30:00Z",
      "created_by_id": "019ghi56-7890-abcd-ef12-34567890abcd"
    }
  ],
  "total": 1
}
```

---

### 6. Create Connection (Initiate OAuth)

```
POST /api/tools/connections
```

Initiate a new connection. For OAuth, returns a redirect URL. For API key, creates immediately.

**Request (OAuth):**

```json
{
  "integration_slug": "gmail",
  "callback_url": "https://app.agenta.ai/auth/callback"
}
```

**Response (OAuth - Pending):**

```json
{
  "id": "019abc12-3456-7890-abcd-ef1234567890",
  "status": "PENDING",
  "redirect_url": "https://connect.composio.dev/link/ln_abc123",
  "message": "Redirect user to complete OAuth authorization"
}
```

**Request (API Key):**

```json
{
  "integration_slug": "stripe",
  "credentials": {
    "api_key": "sk_live_xxx"
  }
}
```

**Response (API Key - Immediate):**

```json
{
  "id": "019abc12-3456-7890-abcd-ef1234567890",
  "status": "ACTIVE",
  "message": "Connection established successfully"
}
```

**Implementation Notes:**

- For OAuth: Create local record with PENDING status, call Composio to initiate
- For API Key: Validate with Composio, create local record with ACTIVE status
- Store `composio_account_id` in our DB for later use

---

### 7. Get Connection Status

```
GET /api/tools/connections/{id}
```

Check the status of a connection (useful for polling after OAuth).

**Response:**

```json
{
  "id": "019abc12-3456-7890-abcd-ef1234567890",
  "project_id": "019def34-5678-90ab-cdef-1234567890ab",
  "integration_slug": "gmail",
  "integration_name": "Gmail",
  "composio_account_id": "ca_xyz123",
  "status": "ACTIVE",
  "auth_type": "OAUTH2",
  "created_at": "2026-01-29T10:30:00Z",
  "created_by_id": "019ghi56-7890-abcd-ef12-34567890abcd"
}
```

**Implementation Notes:**

- If status is PENDING, poll Composio to check if OAuth completed
- Update local status if Composio shows ACTIVE

---

### 8. Delete Connection

```
DELETE /api/tools/connections/{id}
```

Disconnect and revoke credentials.

**Response:**

```
204 No Content
```

**Implementation Notes:**

- Delete from Composio first (revokes tokens)
- Then delete from our DB
- Invalidate caches

---

## OAuth Flow Sequence

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. User clicks "Connect" on Gmail in Tool Browser                    │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. Frontend: POST /api/tools/connections                             │
│    { "integration_slug": "gmail", "callback_url": "..." }            │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. Backend:                                                          │
│    - Create ConnectionDB record (status: PENDING)                    │
│    - Call Composio: POST /api/v3/connected_accounts                  │
│    - Store composio_account_id                                       │
│    - Return redirect_url to frontend                                 │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. Frontend: Open popup with redirect_url                            │
│    window.open(redirect_url, 'oauth-popup', 'width=600,height=700')  │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 5. User completes OAuth on Composio/Google                           │
│    - Sees Google consent screen                                      │
│    - Grants permissions                                              │
│    - Composio receives callback, stores tokens                       │
│    - Composio redirects to our callback_url                          │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 6. Frontend callback page:                                           │
│    - Detect OAuth complete                                           │
│    - Close popup OR postMessage to parent                            │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 7. Frontend: Poll GET /api/tools/connections/{id}                    │
│    - Until status === "ACTIVE"                                       │
│    - Backend checks Composio on each poll                            │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 8. Connection complete!                                              │
│    - UI shows "Connected" badge                                      │
│    - Tools from Gmail are now available                              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### Table: `tool_connections`

```sql
CREATE TABLE tool_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    
    -- Scope
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    
    -- Integration info
    integration_slug VARCHAR(100) NOT NULL,
    integration_name VARCHAR(255) NOT NULL,
    
    -- Composio reference
    composio_account_id VARCHAR(255),  -- Composio's connected_account ID
    composio_auth_config_id VARCHAR(255),  -- Optional: custom auth config
    
    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    auth_type VARCHAR(20) NOT NULL,  -- OAUTH2, API_KEY
    
    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by_id UUID NOT NULL REFERENCES users(id),
    
    -- Constraints
    UNIQUE(project_id, integration_slug)  -- One connection per integration per project
);

CREATE INDEX idx_tool_connections_project ON tool_connections(project_id);
CREATE INDEX idx_tool_connections_status ON tool_connections(status);
```

---

## Error Responses

### Standard Error Format

```json
{
  "detail": "Human-readable error message",
  "code": "ERROR_CODE",
  "context": {
    "integration_slug": "gmail"
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `INTEGRATION_NOT_FOUND` | 404 | Integration slug doesn't exist |
| `TOOL_NOT_FOUND` | 404 | Tool slug doesn't exist |
| `CONNECTION_NOT_FOUND` | 404 | Connection ID doesn't exist |
| `CONNECTION_ALREADY_EXISTS` | 409 | Project already has connection for this integration |
| `OAUTH_FAILED` | 400 | OAuth flow failed (user denied, timeout, etc.) |
| `INVALID_CREDENTIALS` | 400 | API key validation failed |
| `COMPOSIO_ERROR` | 502 | Error communicating with Composio |

---

## Caching Strategy

| Data | TTL | Invalidation |
|------|-----|--------------|
| Integration catalog | 1 hour | Manual refresh endpoint |
| Tool list per integration | 1 hour | Manual refresh endpoint |
| Tool schema | 1 hour | Manual refresh endpoint |
| Project connections | On demand | On create/delete connection |

**Cache Keys:**

```
tools:integrations                          # Full catalog
tools:integrations:{slug}                   # Single integration
tools:integrations:{slug}:tools             # Tool list
tools:integrations:{slug}:tools:{tool_slug} # Tool schema
tools:connections:{project_id}              # Project's connections
```

---

## Service Layer Structure

Following existing Agenta patterns:

```
api/oss/src/
├── core/
│   └── tools/
│       ├── __init__.py
│       ├── dtos.py              # DTOs defined above
│       ├── enums.py             # ConnectionStatus enum
│       ├── services.py          # ToolsService class
│       ├── composio_client.py   # Composio API wrapper
│       └── interfaces.py        # DAO interface
├── apis/
│   └── fastapi/
│       └── tools/
│           ├── __init__.py
│           ├── router.py        # ToolsRouter class
│           └── models.py        # Request/response models
└── dbs/
    └── postgres/
        └── tools/
            ├── __init__.py
            └── dao.py           # ToolsDAO implementation
```

---

## Composio Client Wrapper

```python
# api/oss/src/core/tools/composio_client.py

from composio import Composio
from typing import Optional
import httpx

class ComposioClient:
    """Wrapper around Composio SDK with caching and error handling."""
    
    def __init__(self, api_key: str):
        self.client = Composio(api_key=api_key)
        self._http = httpx.AsyncClient(
            base_url="https://backend.composio.dev/api/v3",
            headers={"x-api-key": api_key}
        )
    
    async def list_toolkits(self) -> list[dict]:
        """List all available toolkits (cached)."""
        ...
    
    async def get_toolkit(self, slug: str) -> dict:
        """Get toolkit details."""
        ...
    
    async def list_tools(self, integration_slug: str) -> list[dict]:
        """List tools for an integration (cached)."""
        ...
    
    async def get_tool_schema(self, integration_slug: str, tool_slug: str) -> dict:
        """Get full tool schema."""
        ...
    
    async def initiate_connection(
        self, 
        user_id: str, 
        toolkit_slug: str,
        callback_url: str
    ) -> dict:
        """Initiate OAuth connection, returns redirect URL."""
        ...
    
    async def create_api_key_connection(
        self, 
        user_id: str, 
        toolkit_slug: str,
        api_key: str
    ) -> dict:
        """Create connection with API key."""
        ...
    
    async def get_connection_status(self, connection_id: str) -> str:
        """Get status of a connected account."""
        ...
    
    async def delete_connection(self, connection_id: str) -> None:
        """Delete/revoke a connected account."""
        ...
```

---

## Security Considerations

1. **API Key Storage**: Composio API key stored in Agenta secrets (vault)
2. **User Mapping**: Use `agenta_project_{project_id}` as Composio user_id
3. **Credential Isolation**: Composio handles OAuth token storage, we only store reference IDs
4. **Permission Checks**: EDIT_TOOLS permission required for create/delete connections
5. **Rate Limiting**: Apply rate limits to connection creation endpoints

---

## Future Extensions

1. **Organization-level connections**: Share connections across projects
2. **Custom OAuth apps**: Bring-your-own OAuth credentials for white-labeling
3. **MCP support**: Add custom MCP servers alongside Composio tools
4. **Tool execution audit**: Log all tool executions for observability
5. **Scoped permissions**: Allow different team members different tool access

---

## Related Documents

- [Composio OAuth Research](./pre-research/research-composio-oauth.md)
- [Competitor A API Analysis](./pre-research/research-competitor-a-composio-api.md)
- [Data Model](./data-model.md) (to be created)
- [UI Flow](./ui-flow.md) (to be created)
