# Gateway Tools: Connection and Execution Flows

This document describes how connection flows (OAuth and API key) and execution flows work in the Gateway Tools system.

## Architecture Overview

The Gateway Tools system follows a provider-adapter pattern:

- **Provider**: External service that hosts tool integrations (e.g., Composio)
- **Adapter**: Implementation of `GatewayAdapterInterface` that wraps provider API
- **Registry**: `GatewayAdapterRegistry` dispatches requests to the correct adapter

```
Client Request
    ↓
ToolsRouter (FastAPI)
    ↓
ToolsService (Business logic)
    ↓
GatewayAdapterRegistry (Dispatcher)
    ↓
ComposioAdapter (Provider implementation)
    ↓
Composio API v3 (External service)
```

## Connection Flows

Connections represent authenticated links between a user/entity and a third-party integration (e.g., Gmail, Slack).

### OAuth Connection Flow (Primary)

**Flow Steps:**

1. **Initiate Connection** (`POST /connections`)
   - Frontend calls API with: `entity_id`, `integration_key`, optional `callback_url`
   - Backend calls `adapter.initiate_connection()`
   - Adapter resolves auth configuration for the integration
   - Adapter creates a connected account link request
   - Returns: `{id, redirect_url, auth_config_id}`

2. **User Authorization**
   - Frontend opens `redirect_url` in popup window
   - User completes OAuth flow with third-party service
   - Provider (Composio) handles OAuth callback from third-party
   - Provider redirects to `callback_url` with connection status

3. **Connection Polling/Verification**
   - Frontend polls `GET /connections/{id}` to check status
   - Backend calls `adapter.get_connection_status(provider_connection_id)`
   - Returns: `{status, is_valid}` where status can be:
     - `ACTIVE`: Connection successful and ready to use
     - `PENDING`: OAuth flow in progress
     - `FAILED`: OAuth flow failed or was cancelled

4. **Connection Storage**
   - Once `is_valid=true`, backend stores connection in database
   - Stored data includes:
     - `provider_connection_id`: ID from provider (Composio connected_account_id)
     - `integration_key`: Which integration (gmail, slack, etc.)
     - `entity_id`: User/project identifier
     - `provider_data`: Provider-specific metadata (auth_config_id, etc.)
     - `status`, `is_active`, `is_valid`: Connection state flags

**Composio OAuth Implementation Details:**

```python
async def initiate_connection(
    self,
    *,
    entity_id: str,
    integration_key: str,
    callback_url: Optional[str] = None,
) -> Dict[str, Any]:
    # Step 1: Resolve auth config (determines OAuth provider settings)
    auth_configs = await self._get(
        "/auth_configs",
        params={"toolkit_slugs": integration_key},
    )
    auth_config_id = auth_configs[0]["id"]

    # Step 2: Create connected account link
    result = await self._post(
        "/connected_accounts/link",
        json={
            "user_id": entity_id,
            "auth_config_id": auth_config_id,
            "callback_url": callback_url,  # Optional redirect after OAuth
        }
    )

    return {
        "id": result["id"],  # Provider's connection ID
        "redirect_url": result["redirect_url"],  # OAuth URL to open
        "auth_config_id": auth_config_id,
    }
```

### API Key Connection Flow (Alternative)

**Not yet fully implemented in current adapter**, but typical flow would be:

1. **Direct Connection Creation** (`POST /connections`)
   - Frontend sends: `entity_id`, `integration_key`, `credentials: {api_key: "..."}`
   - Backend calls `adapter.create_connection_with_api_key()`
   - Adapter validates API key with provider
   - Returns connection immediately with status `ACTIVE`

2. **Storage**
   - API key is stored encrypted in secrets vault
   - Connection record references the secret
   - No OAuth flow needed

**Future Implementation Notes:**

- Need to add `mode` parameter: `"oauth"` vs `"api_key"`
- Need to detect available auth modes from integration metadata
- Some integrations support both OAuth and API key (e.g., GitHub)
- `no_auth` flag indicates integration needs no authentication

### Connection Lifecycle Management

**Refresh Connection** (`POST /connections/{id}/refresh`)

Used when OAuth tokens expire or connection becomes invalid:

```python
async def refresh_connection(
    self,
    *,
    provider_connection_id: str,
    force: bool = False,
) -> Dict[str, Any]:
    result = await self._post(
        f"/connected_accounts/{provider_connection_id}/refresh",
        json={},
    )

    return {
        "status": result["status"],
        "is_valid": result["status"] == "ACTIVE",
        "redirect_url": result.get("redirect_url"),  # May require re-auth
    }
```

**Revoke Connection** (`DELETE /connections/{id}`)

Permanently removes the connection:

```python
async def revoke_connection(
    self,
    *,
    provider_connection_id: str,
) -> bool:
    await self._delete(f"/connected_accounts/{provider_connection_id}")
    return True
```

## Execution Flow

Tool execution allows running actions (tools) using an authenticated connection.

### Tool Execution Steps

1. **Client Prepares Execution**
   - Selects a connection (must be `is_valid=true` and `is_active=true`)
   - Selects an action/tool (e.g., `gmail.SEND_EMAIL`)
   - Prepares input arguments matching action's input schema

2. **Execute Action** (`POST /execute`)
   - Frontend calls: `{integration_key, action_key, connection_id, arguments}`
   - Backend resolves connection to get `provider_connection_id`
   - Backend calls `adapter.execute()`
   - Adapter translates request to provider format
   - Provider executes action using the authenticated connection

3. **Result Handling**
   - Provider returns execution result
   - Adapter normalizes result into standard format:
     ```python
     ExecutionResult(
         data: Any,              # Success data from tool execution
         error: Optional[str],   # Error message if failed
         successful: bool,       # True if execution succeeded
     )
     ```
   - Backend returns result to frontend

**Composio Execution Implementation:**

```python
async def execute(
    self,
    *,
    integration_key: str,
    action_key: str,
    provider_connection_id: str,
    arguments: Dict[str, Any],
) -> ExecutionResult:
    # Translate Agenta action key to Composio format
    # Example: integration_key="gmail", action_key="SEND_EMAIL"
    #          → composio_slug="GMAIL_SEND_EMAIL"
    composio_slug = self._to_composio_slug(
        integration_key=integration_key,
        action_key=action_key,
    )

    # Execute tool via Composio API
    result = await self._post(
        f"/tools/execute/{composio_slug}",
        json={
            "arguments": arguments,  # Tool input parameters
            "connected_account_id": provider_connection_id,  # Auth context
        },
    )

    return ExecutionResult(
        data=result.get("data"),
        error=result.get("error"),
        successful=result.get("successful", False),
    )
```

### Action Discovery Flow

Before execution, clients need to discover available actions:

1. **List Providers** (`GET /providers`)
   - Returns available providers (e.g., Composio)

2. **List Integrations** (`GET /{provider}/integrations`)
   - Returns integrations for a provider (e.g., gmail, slack)
   - Includes: name, description, logo, auth_schemes, actions_count

3. **List Actions** (`GET /{provider}/integrations/{integration}/actions`)
   - Returns actions for an integration
   - Each action includes: key, name, description, tags

4. **Get Action Details** (`GET /{provider}/integrations/{integration}/actions/{action}`)
   - Returns full action schema including:
     - `input_schema`: JSON schema defining required/optional parameters
     - `output_schema`: JSON schema defining return value structure

## Provider-Specific Considerations

### Composio Provider

**Key Concepts:**

- **Entity ID**: User or project identifier for multi-tenant isolation
- **Toolkit**: Composio's term for integration (e.g., "gmail")
- **Tool**: Individual action within a toolkit (e.g., "GMAIL_SEND_EMAIL")
- **Connected Account**: Authenticated connection to a third-party service
- **Auth Config**: OAuth configuration for an integration

**Naming Conventions:**

- Agenta uses: `integration_key` (lowercase, e.g., "gmail") + `action_key` (e.g., "SEND_EMAIL")
- Composio uses: `toolkit_slug` (lowercase) + tool slug pattern `{TOOLKIT}_{ACTION}`
- Adapter translates between formats using `_to_composio_slug()` and `_extract_action_key()`

**API Endpoints Used:**

- `GET /toolkits` - List available integrations
- `GET /tools` - List actions for a toolkit
- `GET /tools/{slug}` - Get action details
- `GET /auth_configs` - Get OAuth configuration for integration
- `POST /connected_accounts/link` - Initiate OAuth connection
- `GET /connected_accounts/{id}` - Check connection status
- `POST /connected_accounts/{id}/refresh` - Refresh OAuth tokens
- `DELETE /connected_accounts/{id}` - Revoke connection
- `POST /tools/execute/{slug}` - Execute action

**Authentication:**

- Uses API key authentication: `x-api-key` header
- API key configured via `COMPOSIO_API_KEY` environment variable
- Each request includes the API key for Composio authorization

## Adding New Provider Implementations

To add a new provider (e.g., Agenta native tools, Zapier, Make):

1. **Create Provider Directory:**
   ```
   api/oss/src/core/tools/providers/{provider_name}/
   ├── __init__.py
   ├── adapter.py      # Adapter implementation
   └── dtos.py         # Provider-specific data models
   ```

2. **Implement Adapter:**
   - Subclass `GatewayAdapterInterface`
   - Implement all required methods:
     - Catalog: `list_providers`, `list_integrations`, `list_actions`, `get_action`
     - Connections: `initiate_connection`, `get_connection_status`, `refresh_connection`, `revoke_connection`
     - Execution: `execute`

3. **Register Provider:**
   ```python
   # In api/entrypoints/routers.py
   _adapters = {}

   if env.composio.enabled:
       _adapters["composio"] = ComposioAdapter(...)

   if env.custom_provider.enabled:
       _adapters["custom"] = CustomAdapter(...)

   tools_adapter_registry = GatewayAdapterRegistry(adapters=_adapters)
   ```

4. **Connection Data:**
   - Define provider-specific DTOs in `dtos.py`
   - Store provider metadata in `Connection.provider_data` JSON field
   - Example: `ComposioToolConnectionData` stores `connected_account_id` and `auth_config_id`

5. **Testing:**
   - Test OAuth flow end-to-end
   - Test connection lifecycle (refresh, revoke)
   - Test action execution with authenticated connection
   - Test error handling (invalid credentials, expired tokens, etc.)

## Error Handling

All adapter methods should raise `AdapterError` for provider-specific errors:

```python
from oss.src.core.tools.exceptions import AdapterError

try:
    result = await self._post("/endpoint", json=payload)
except httpx.HTTPError as e:
    raise AdapterError(
        provider_key="composio",
        operation="initiate_connection",
        detail=str(e),
    ) from e
```

The service layer catches these and returns appropriate HTTP error responses.

## Security Considerations

1. **API Keys**: Provider API keys stored in environment variables, never exposed to frontend
2. **OAuth Tokens**: Managed by provider, never stored in Agenta database
3. **Connection IDs**: Provider connection IDs are opaque identifiers
4. **Entity Isolation**: Each connection scoped to a specific `entity_id` for multi-tenancy
5. **Secrets Storage**: API key auth mode should store keys encrypted in vault
6. **Callback URLs**: Validate callback URLs to prevent redirect attacks
