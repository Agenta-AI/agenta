# API conventions (OSS + EE)

Scope: everything under `api/`. This file loads when you work in the API. The repo-wide
root conventions live in `/AGENTS.md`.

## Environment config conventions

- For API configuration, add new environment variables to `api/oss/src/utils/env.py` and
  consume them via the shared `env` object.
- Avoid calling `os.getenv(...)` directly in feature code when the value is part of
  application config.
- Avoid local imports inside helper functions for configuration lookup; prefer
  module-level imports unless there is a proven circular dependency.

## Formatting

Run `ruff format` then `ruff check --fix` within the API folder (from the repo root:
`ruff format` then `ruff check`). Fix all errors before committing.

## API Architecture Patterns

Use this section for all new work.

### API repo map

- `api/oss/src/*` is the OSS baseline API (new + legacy coexist here).
- `api/ee/src/*` is the EE extension API (billing, organizations, workspace, meters,
  subscriptions, throttling).
- `api/entrypoints/*` is the composition root (dependency wiring and route mounting).

OSS and EE relationship:
- OSS app is assembled first in `api/entrypoints/routers.py`.
- When `is_ee()` is true, EE extends that app via:
  - `ee.extend_main(app)` for extra routers/features.
  - `ee.extend_app_schema(app)` for OpenAPI/security metadata.
- EE is additive over OSS, not a separate API architecture.

Primary references:
- `api/entrypoints/routers.py`
- `api/ee/src/main.py`

### Where to add new API code

- Add new domain features in:
  - `api/oss/src/apis/fastapi/<domain>/`
  - `api/oss/src/core/<domain>/`
  - `api/oss/src/dbs/postgres/<domain>/`
- Avoid adding net-new features to legacy paths:
  - `api/oss/src/routers/*`
  - `api/oss/src/services/*`

### Standard domain folder structure

For a new domain, follow this shape:

- API layer: `api/oss/src/apis/fastapi/<domain>/`
  - `router.py`: route registration + handlers
  - `models.py`: request/response schemas
  - `utils.py`: parsing/merge/normalization helpers
- Core layer: `api/oss/src/core/<domain>/`
  - `dtos.py` or `types.py`: domain data contracts
  - `interfaces.py`: DAO/service contracts when needed
  - `service.py`: business orchestration
- DB layer: `api/oss/src/dbs/postgres/<domain>/`
  - `dbes.py`: SQLAlchemy entities
  - `dbas.py`: shared mixins (when needed)
  - `dao.py`: Postgres implementation
  - `mappings.py`: DTO <-> DBE mapping

Example to copy:
- `api/oss/src/apis/fastapi/workflows/`
- `api/oss/src/core/workflows/`
- `api/oss/src/dbs/postgres/workflows/`

### Layering and dependency direction

Required direction:
- Router -> Service -> DAO Interface -> DAO Implementation -> DB

Rules:
- Core services depend on interfaces (`*DAOInterface`), not concrete DB implementations.
- Wire concrete dependencies in `api/entrypoints/*` only.
- Keep DTO/DBE mapping in `dbs/postgres/*/mappings.py`.
- Do not return DBE objects from router/service contracts.
- As much as possible, define appropriate service exceptions (avoid leaking database
  exceptions).

### Endpoint design conventions

Use consistent endpoint shapes across domains:

- `POST /query` for filtering/search with payload support.
- `POST /{id}/archive` and `POST /{id}/unarchive` for lifecycle state transitions.
- For revisioned resources, expose:
  - `/revisions/retrieve`
  - `/revisions/commit`
  - `/revisions/log`

Request/response conventions:
- Define explicit request/response models in `models.py`.
- Response envelopes should include `count` plus payload (`item`/`items` style).
- Set explicit `operation_id` on routes.

Query conventions:
- Parse params via `Depends(...)` and optionally parse request body JSON.
- Merge params + body into one query object in `utils.py`.
- Use cursor pagination via `Windowing`, not page-number pagination.

References:
- `api/oss/src/apis/fastapi/workflows/router.py`
- `api/oss/src/apis/fastapi/workflows/utils.py`
- `api/oss/src/apis/fastapi/shared/utils.py`
- `api/oss/src/dbs/postgres/shared/utils.py`

### Git-style Artifact/Variant/Revision pattern

When a resource needs commit/history semantics, use the shared Git pattern instead of
inventing a custom one.

Use this pattern when you need:
- revision history and auditability
- latest vs specific revision retrieval
- revision logs
- variant forks/lineage

Core contracts:
- `api/oss/src/core/git/interfaces.py`
- `api/oss/src/core/git/dtos.py`

Postgres implementation:
- `api/oss/src/dbs/postgres/git/dao.py`
- `api/oss/src/dbs/postgres/git/dbas.py`

Domain DBE examples:
- `api/oss/src/dbs/postgres/workflows/dbes.py`
- `api/oss/src/dbs/postgres/queries/dbes.py`
- `api/oss/src/dbs/postgres/testsets/dbes.py`

Service examples:
- `api/oss/src/core/workflows/service.py`
- `api/oss/src/core/queries/service.py`
- `api/oss/src/core/testsets/service.py`

Reuse pattern example:
- Evaluators reuse workflow persistence and can preserve IDs through
  `workflow_id=evaluator_id`.
- Reference: `api/oss/src/core/evaluators/service.py`

### Scope, lifecycle, and archival rules

- Always enforce tenant scope (`project_id` minimum) in DAO reads and writes.
- For revisioned entities, prefer archive/unarchive (`deleted_at`, `deleted_by_id`) over
  hard deletes.
- Respect `include_archived` in query paths.

References:
- `api/oss/src/dbs/postgres/shared/dbas.py`
- `api/oss/src/dbs/postgres/git/dao.py`

### Migration and compatibility rules

Migration should preserve compatibility while moving to new APIs.

- Keep old and new routes running in parallel until migration is complete.
- New stack commonly ships under `/*` while old endpoints remain mounted.
- Prefer data compatibility adapters over breaking payload changes.
- Preserve old IDs/shape when continuity is required.
- If old storage temporarily carries new payload shape, mark it explicitly.

Concrete examples:
- Dual mounting and deprecations: `api/entrypoints/routers.py`
- Legacy app storage marker (`WORKFLOW_MARKER_KEY`):
  `api/oss/src/core/applications/service.py`
- Legacy dedup key normalization (`__dedup_id__` <-> `testcase_dedup_id`):
  `api/oss/src/apis/fastapi/testsets/router.py`

### Router and function style conventions

Router style:
- Register routes inside router class `__init__` using `self.router.add_api_route(...)`.
- Use `@intercept_exceptions()` at the route boundary.
- Use `@suppress_exceptions(...)` only for controlled defaults.

Function signature style:
- Prefer keyword-only parameters using `*`.
- Use grouped sections in signatures/calls with `#` separators for readability.

Example:

```python
async def create_workflow(
    self,
    *,
    project_id: UUID,
    user_id: UUID,
    #
    workflow_create: WorkflowCreate,
    #
    workflow_id: Optional[UUID] = None,
) -> Optional[Workflow]:
    ...
```

### Domain-level exceptions

1. **Define domain exceptions in the core layer** (`core/{domain}/types.py` or
   `core/{domain}/dtos.py`) — never raise `HTTPException` from services or DAOs.
2. **Catch domain exceptions at the API boundary** — in the router or via a decorator —
   and convert them to HTTP responses.
3. **Use a base exception per domain** so callers can catch broadly or narrowly.
4. **Include structured context** (not just a message string) so the router can build
   rich HTTP error responses.

**Example 1 — Folder exceptions (best example of the full pattern):**

Definition in `api/oss/src/core/folders/types.py`:
```python
class FolderNameInvalid(Exception):
    def __init__(self, message: str = "Folder name contains invalid characters."):
        self.message = message
        super().__init__(message)

class FolderPathConflict(Exception):
    def __init__(self, message: str = "A folder with this path already exists."):
        self.message = message
        super().__init__(message)
```

Raised in service `api/oss/src/core/folders/service.py`:
```python
def _validate_folder_name(name: Optional[str]) -> None:
    if not name or not fullmatch(r"[\w -]+", name):
        raise FolderNameInvalid()
```

Caught in router via decorator `api/oss/src/apis/fastapi/folders/router.py`:
```python
def handle_folder_exceptions():
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except FolderNameInvalid as e:
                raise FolderNameInvalidException(message=e.message) from e
            except FolderPathConflict as e:
                raise FolderPathConflictException(message=e.message) from e
        return wrapper
    return decorator
```

**Example 2 — Filtering exception (inline catch in router):**

Definition in `api/oss/src/core/tracing/dtos.py`:
```python
class FilteringException(Exception):
    pass
```

Caught in `api/oss/src/apis/fastapi/tracing/router.py`:
```python
except FilteringException as e:
    raise HTTPException(status_code=400, detail=str(e)) from e
```

**Example 3 — EE organization exceptions (base class hierarchy):**

Definition in `api/ee/src/core/organizations/exceptions.py`:
```python
class OrganizationError(Exception):
    """Base exception for organization-related errors."""
    pass

class OrganizationSlugConflictError(OrganizationError):
    def __init__(self, slug: str, message: str = None):
        self.slug = slug
        self.message = message or f"Organization slug '{slug}' is already in use."
        super().__init__(self.message)

class OrganizationNotFoundError(OrganizationError):
    def __init__(self, organization_id: str, message: str = None):
        self.organization_id = organization_id
        self.message = message or f"Organization '{organization_id}' not found."
        super().__init__(self.message)
```

Anti-patterns:
- Do NOT return error dicts like `{"_error": True, "status_code": 502, "detail": "..."}`
  from services or clients.
- Do NOT raise `HTTPException` from core services — that couples the domain to HTTP.
- Do NOT use bare `Exception` or `ValueError` for domain errors when a typed exception
  would be clearer.

### Typed DTO returns from services and clients

1. **Service methods must return typed DTOs** (Pydantic `BaseModel` subclasses), not raw
   dicts, tuples, or `Any`.
2. **HTTP clients should return a response DTO**, not
   `Tuple[Optional[Any], Optional[str]]`.
3. **Define DTOs in `core/{domain}/dtos.py`** alongside the domain's other data contracts.
4. **Use `Optional[DTO]` for missing entities**, `List[DTO]` for collections.

**Example — Workflow service returns typed DTOs:**

```python
# core/workflows/dtos.py
class Workflow(Artifact):
    pass

class WorkflowVariant(Variant):
    pass

# core/workflows/service.py
async def create_workflow(self, *, project_id, user_id, workflow_create) -> Optional[Workflow]:
    artifact = await self.workflows_dao.create_artifact(...)
    if not artifact:
        return None
    return Workflow(**artifact.model_dump(mode="json"))
```

**Example — HTTP client returns a DTO instead of a raw tuple:**

```python
# Instead of:
async def invoke(...) -> Tuple[Optional[Any], Optional[str]]:
    return data, trace_id  # untyped

# Do:
class InvokeResponse(BaseModel):
    data: Any
    trace_id: Optional[str] = None

async def invoke(...) -> InvokeResponse:
    return InvokeResponse(data=data, trace_id=trace_id)
```

Anti-patterns:
- Do NOT return raw dicts from service methods.
- Do NOT return tuples like `(data, trace_id)` — use a named DTO.
- Do NOT use `Dict[str, Any]` as a return type when you can define a proper model.

### Migration seams (do not copy for net-new code)

These exist during transition but should not be copied into new implementations:

- Core importing API routers/models directly
  - `api/oss/src/core/invocations/service.py`
  - `api/oss/src/core/annotations/service.py`
- Core importing legacy `db_manager` in new modules
  - `api/oss/src/core/workflows/service.py`
  - `api/oss/src/core/testsets/service.py`
  - `api/oss/src/core/evaluations/service.py`

Preferred fix for new work:
- introduce/extend core interfaces and adapters
- keep strict layer boundaries
