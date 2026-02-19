# Gateway Tools Providers

This directory contains provider implementations for the Gateway Tools system. Each provider is a wrapper around a third-party service that provides tool integrations.

## Directory Structure

```
providers/
├── README.md                      # This file
├── CONNECTION_FLOWS.md            # Detailed connection and execution flow documentation
├── interfaces.py                  # Provider-specific interfaces (if needed)
├── types.py                       # Provider-specific shared types (if needed)
├── composio/                      # Composio provider implementation
│   ├── __init__.py                # Exports ComposioAdapter, ComposioToolConnectionData
│   ├── adapter.py                 # ComposioAdapter implementation
│   └── dtos.py                    # Composio-specific data models
└── agenta/                        # Future: Agenta native tools provider
    └── __init__.py
```

## Provider Pattern

Each provider implementation:

1. **Implements `GatewayAdapterInterface`** from `oss.src.core.tools.interfaces`
2. **Lives in its own subdirectory** under `providers/`
3. **Exports adapter class and DTOs** through `__init__.py`
4. **Handles provider-specific API communication** (HTTP, SDK, etc.)

## Current Providers

### Composio (`composio/`)

**Purpose:** Integration with Composio V3 API for third-party tool access

**Files:**
- `adapter.py`: Main adapter implementing OAuth flows and tool execution
- `dtos.py`: Connection data models (connected_account_id, auth_config_id)

**Key Features:**
- OAuth connection flow support
- 150+ third-party integrations (Gmail, Slack, GitHub, etc.)
- Action execution with authenticated connections
- Connection lifecycle management (refresh, revoke)

**Configuration:**
```
# Environment variables
COMPOSIO_API_KEY=<your_key>                              # Required — presence enables Composio
COMPOSIO_API_URL=https://backend.composio.dev/api/v3    # Optional (default shown)
```

**Usage in entrypoints:**
```python
from oss.src.core.tools.providers.composio import ComposioAdapter

_adapters = {}
if env.composio.enabled:
    _adapters["composio"] = ComposioAdapter(
        api_key=env.composio.api_key,
        api_url=env.composio.api_url,
    )

tools_adapter_registry = GatewayAdapterRegistry(adapters=_adapters)
```

## Adding a New Provider

See [CONNECTION_FLOWS.md](./CONNECTION_FLOWS.md#adding-new-provider-implementations) for detailed instructions.

**Quick Steps:**

1. Create provider directory: `providers/{provider_name}/`
2. Implement adapter: `adapter.py` subclassing `GatewayAdapterInterface`
3. Define DTOs: `dtos.py` for provider-specific connection data
4. Export in `__init__.py`
5. Register in `api/entrypoints/routers.py`
6. Add environment configuration

## Adapter Interface

All providers must implement:

```python
class GatewayAdapterInterface(ABC):
    # Catalog methods
    async def list_providers(self) -> List[CatalogProvider]
    async def list_integrations(self, *, search: Optional[str] = None, limit: Optional[int] = None) -> List[CatalogIntegration]
    async def list_actions(self, *, integration_key: str, ...) -> List[CatalogAction]
    async def get_action(self, *, integration_key: str, action_key: str) -> Optional[CatalogActionDetails]

    # Connection methods
    async def initiate_connection(self, *, entity_id: str, integration_key: str, callback_url: Optional[str] = None) -> Dict[str, Any]
    async def get_connection_status(self, *, provider_connection_id: str) -> Dict[str, Any]
    async def refresh_connection(self, *, provider_connection_id: str, force: bool = False) -> Dict[str, Any]
    async def revoke_connection(self, *, provider_connection_id: str) -> bool

    # Execution methods
    async def execute(self, *, integration_key: str, action_key: str, provider_connection_id: str, arguments: Dict[str, Any]) -> ExecutionResult
```

## Provider vs Adapter Terminology

**Historical Note:** The original implementation used "adapters" directory, but this has been refactored to "providers" for clarity:

- **Provider** = External service that hosts integrations (Composio, Zapier, etc.)
- **Adapter** = Implementation that wraps the provider's API
- **Registry** = Dispatcher that routes to the correct adapter by `provider_key`

The `adapters/` directory still exists for the registry pattern, but individual provider implementations live in `providers/`.

## Related Files

- **Interfaces:** `api/oss/src/core/tools/interfaces.py` - `GatewayAdapterInterface`
- **DTOs:** `api/oss/src/core/tools/dtos.py` - Shared data models
- **Service:** `api/oss/src/core/tools/service.py` - Business logic layer
- **Router:** `api/oss/src/apis/fastapi/tools/router.py` - HTTP endpoints
- **Registry:** `api/oss/src/core/tools/adapters/registry.py` - Adapter dispatcher
- **DAO:** `api/oss/src/dbs/postgres/tools/dao.py` - Database access

## Documentation

- [CONNECTION_FLOWS.md](./CONNECTION_FLOWS.md) - Detailed flow documentation
- [specs.md](./specs.md) - API specification
- [implementation-spec.md](./implementation-spec.md) - Implementation details
