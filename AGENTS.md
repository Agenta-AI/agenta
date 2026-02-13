# Contributor Guide

## Dev Environment Tips
- If you make changes to the frontend, make sure to run `pnpm lint-fix` within the web folder
- If you make changes to the API or SDK, make sure to run `ruff format` and `ruff check --fix` within the SDK or API folder
- If you update Ant Design tokens, run `pnpm generate:tailwind-tokens` in the web folder and commit the generated file


## Testing Instructions

For comprehensive testing documentation, see [docs/designs/testing/README.md](docs/designs/testing/README.md).

Quick overview:
- **API Tests**: `cd api && python run-tests.py --api-url <api_url> --auth-key <auth_key> --license oss`
- **SDK Tests**: `cd sdk && python run-tests.py --api-url <api_url> --auth-key <auth_key> --license oss`
- **Web Tests**: `cd web/tests && AGENTA_WEB_URL=<web_url> TESTMAIL_NAMESPACE=<email_ns> TESTMAIL_API_KEY=<email_key> pnpm tsx playwright/scripts/run-tests.ts --coverage smoke`

Test documentation covers:
- Testing principles and philosophy
- Test boundaries (utils, unit, E2E)
- Test dimensions (coverage, path, case, lens, speed, license, cost, role, plan)
- Interface-specific guides (API, SDK, Web, Services)
- Test structure and organization
- Fixtures and utilities
- Running tests locally and in CI 

## PR instructions
- If the user provides you with the issue id, title the PR: [issue-id] fix(frontend): <Title> where fix is the type (fix, feat, chore, ci, doc, test.. [we're using better-branch) and frontend is where and it could be API, SDK, frontend, docs, ..

## API Architecture Patterns (OSS + EE)

Use this section for all new work.

### API repo map

- `api/oss/src/*` is the OSS baseline API (new + legacy coexist here).
- `api/ee/src/*` is the EE extension API (billing, organizations, workspace, meters, subscriptions, throttling).
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
- As much as possible, define appropriate service exceptions (avoid leaking database exceptions).

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

When a resource needs commit/history semantics, use the shared Git pattern instead of inventing a custom one.

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
- Evaluators reuse workflow persistence and can preserve IDs through `workflow_id=evaluator_id`.
- Reference: `api/oss/src/core/evaluators/service.py`

### Scope, lifecycle, and archival rules

- Always enforce tenant scope (`project_id` minimum) in DAO reads and writes.
- For revisioned entities, prefer archive/unarchive (`deleted_at`, `deleted_by_id`) over hard deletes.
- Respect `include_archived` in query paths.

References:
- `api/oss/src/dbs/postgres/shared/dbas.py`
- `api/oss/src/dbs/postgres/git/dao.py`

### Migration and compatibility rules

Migration should preserve compatibility while moving to new APIs.

- Keep old and new routes running in parallel until migration is complete.
- New stack commonly ships under `/preview/*` while old endpoints remain mounted.
- Prefer data compatibility adapters over breaking payload changes.
- Preserve old IDs/shape when continuity is required.
- If old storage temporarily carries new payload shape, mark it explicitly.

Concrete examples:
- Dual mounting and deprecations: `api/entrypoints/routers.py`
- Legacy app storage marker (`WORKFLOW_MARKER_KEY`): `api/oss/src/core/applications/service.py`
- Legacy dedup key normalization (`__dedup_id__` <-> `testcase_dedup_id`): `api/oss/src/apis/fastapi/testsets/router.py`

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

1. **Define domain exceptions in the core layer** (`core/{domain}/types.py` or `core/{domain}/dtos.py`) — never raise `HTTPException` from services or DAOs.
2. **Catch domain exceptions at the API boundary** — in the router or via a decorator — and convert them to HTTP responses.
3. **Use a base exception per domain** so callers can catch broadly or narrowly.
4. **Include structured context** (not just a message string) so the router can build rich HTTP error responses.

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
- Do NOT return error dicts like `{"_error": True, "status_code": 502, "detail": "..."}` from services or clients.
- Do NOT raise `HTTPException` from core services — that couples the domain to HTTP.
- Do NOT use bare `Exception` or `ValueError` for domain errors when a typed exception would be clearer.

### Typed DTO returns from services and clients

1. **Service methods must return typed DTOs** (Pydantic `BaseModel` subclasses), not raw dicts, tuples, or `Any`.
2. **HTTP clients should return a response DTO**, not `Tuple[Optional[Any], Optional[str]]`.
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

## Import Aliases Best Practices

The monorepo uses TypeScript path aliases for cleaner imports. Understanding when to use each pattern is important for maintainability.

### Available Aliases

1. **`@/oss/*`** - Resolves with fallback order: `ee/src/*` → `oss/src/*`
2. **`@agenta/oss/src/*`** - Explicit import from OSS package (npm workspace)
3. **`@/agenta-oss-common/*`** - Similar fallback to `@/oss/*` (less common)

### When to Use Each Pattern

#### Use `@/oss/*` for shared utilities and state

Use this pattern when importing shared utilities, helpers, types, hooks, or state that work the same in both EE and OSS:

```typescript
// ✅ Good - Shared utilities
import {getEnv} from "@/oss/lib/helpers/dynamicEnv"
import {useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"
import {User, JSSTheme} from "@/oss/lib/Types"
import {selectedOrgIdAtom} from "@/oss/state/org"
import axios from "@/oss/lib/api/assets/axiosConfig"
```

**Why:** The fallback mechanism allows EE to override implementations if needed, while falling back to OSS by default.

#### Use `@agenta/oss/src/*` for explicit OSS imports

Use this pattern when EE code needs to **explicitly reference the OSS version** of a component or page, typically for:
- Extending/wrapping OSS components
- Re-exporting OSS pages with EE enhancements
- Ensuring you get the OSS implementation (not an EE override)

```typescript
// ✅ Good - Explicit OSS component import
import OssSidebarBanners from "@agenta/oss/src/components/SidebarBanners"
import ObservabilityPage from "@agenta/oss/src/pages/w/[workspace_id]/p/[project_id]/observability"
import {DeploymentRevisions} from "@agenta/oss/src/lib/types_ee"
```

**Why:** This bypasses the fallback mechanism and guarantees you're importing from the OSS package.

#### Never use relative paths for cross-package imports

```typescript
// ❌ Bad - Fragile and hard to maintain
import OssSidebarBanners from "../../../../oss/src/components/SidebarBanners"

// ✅ Good - Use explicit alias
import OssSidebarBanners from "@agenta/oss/src/components/SidebarBanners"
```

**Why:** Relative paths break easily with refactoring and are harder to read.

### Examples in the Codebase

**Shared utilities with `@/oss/*`:**
- `web/ee/src/state/billing/atoms.ts` - Uses `@/oss/*` for API utilities, types, and state atoms
- `web/ee/src/hooks/useCrispChat.ts` - Uses `@/oss/*` for environment helpers

**Explicit OSS imports with `@agenta/oss/src/*`:**
- `web/ee/src/components/SidebarBanners/index.tsx` - Wraps OSS component
- `web/ee/src/pages/w/[workspace_id]/p/[project_id]/apps/[app_id]/traces/index.tsx` - Re-exports OSS page
- `web/ee/src/components/DeploymentHistory/DeploymentHistory.tsx` - Uses EE-specific types from OSS

### Quick Decision Guide

```
Are you in EE code importing from OSS?
├─ Is it a component/page that EE extends or wraps?
│  └─ Use: @agenta/oss/src/*
├─ Is it a utility, helper, type, or state atom?
│  └─ Use: @/oss/*
└─ Not sure?
   └─ Use: @agenta/oss/src/* (explicit is safer)
```


### Architecture Overview

Our folder structure follows a module-based architecture that prioritizes maintainability, reusability, and clear separation of concerns.

#### Core Principles

1. **Modular Organization**

    - Modules represent distinct feature areas (similar to pages)
    - Each module is self-contained with its own components, hooks, and assets
    - Shared functionality is elevated to appropriate hierarchy levels

2. **Component Structure**

    - Components are organized by their scope of use
    - Each component may contain:
        - Presentational logic (`Component.tsx`)
        - UI-only subcomponents (`components/*.tsx`)
        - Component-specific hooks (`hooks/*.ts`)
        - Local constants and utilities (`assets/*.ts`)
        - Type definitions (`types.d.ts`)

3. **Code Movement Guidelines**
   The following rules determine where code should live:
    - Module-specific code stays within the module
    - Components used across multiple modules move to root `/components`
    - Hooks used across multiple modules move to root `/hooks`
    - UI elements, constants, or utilities used across modules move to root `/assets`
    - Types used across modules move to root `types.d.ts`

#### State Management

1. **Store Organization**

 - Each module can have its own `store` folder containing:
     - Jotai atoms for reactive state
   - Global store at root level for cross-module state

2. **State Movement Guidelines**

    - State used only within a component stays as local state
    - State shared between components in a module uses module-level store
    - State shared across modules moves to root `/store`
    - Consider these factors when choosing state location:
        - Scope of state usage
        - Frequency of updates
        - Performance implications
        - Data persistence requirements

3. **State Management Tools**
   - Prefer Jotai atoms for all kind of shared state
   - Local component state for UI-only concerns

4. **Avoiding Prop Drilling**
    - **When state is only meaningful within a component tree**: Use Jotai atoms instead of prop drilling
    - Prop drilling (passing props through multiple levels) makes code brittle and hard to maintain
    - Atoms allow any component in the tree to access state without intermediate components knowing about it

**Example - Avoid prop drilling:**

❌ **Don't do this:**
```typescript
function Parent() {
    const [selectedId, setSelectedId] = useState(null)
    return <Child1 selectedId={selectedId} setSelectedId={setSelectedId} />
}

function Child1({selectedId, setSelectedId}) {
    // Child1 doesn't use these props, just passes them down
    return <Child2 selectedId={selectedId} setSelectedId={setSelectedId} />
}

function Child2({selectedId, setSelectedId}) {
    return <GrandChild selectedId={selectedId} setSelectedId={setSelectedId} />
}

function GrandChild({selectedId, setSelectedId}) {
    // Finally uses them here
    return <div onClick={() => setSelectedId(123)}>{selectedId}</div>
}
```

✅ **Use atoms instead:**
```typescript
// In module store or appropriate location
export const selectedIdAtom = atom<string | null>(null)

function Parent() {
    return <Child1 />
}

function Child1() {
    // No props needed
    return <Child2 />
}

function Child2() {
    return <GrandChild />
}

function GrandChild() {
    // Direct access to state
    const [selectedId, setSelectedId] = useAtom(selectedIdAtom)
    return <div onClick={() => setSelectedId(123)}>{selectedId}</div>
}
```

**When to use atoms vs props:**
- Use **props** when: Parent component owns/controls the state, single level passing, or props are configuration/callbacks
- Use **atoms** when: State needs to be shared across non-parent-child components, multiple levels of drilling, or state is module/feature-scoped

5. **Persisted State with LocalStorage**

For state that needs to persist across browser sessions, use `atomWithStorage` from `jotai/utils`:

```typescript
import {atomWithStorage} from "jotai/utils"

// Simple usage - automatically syncs with localStorage
export const rowHeightAtom = atomWithStorage<"small" | "medium" | "large">(
    "agenta:table:row-height", // localStorage key
    "medium", // default value
)

// Usage in components - same as regular atoms
const [rowHeight, setRowHeight] = useAtom(rowHeightAtom)
```

**For storing app/module-scoped data:**
```typescript
// Storage atom holds all app-specific data
const selectedVariantsByAppAtom = atomWithStorage<Record<string, string[]>>(
    "agenta_selected_revisions_v2",
    {},
)

// Derived atom provides scoped access per app
export const selectedVariantsAtom = atom(
    (get) => {
        const appId = get(routerAppIdAtom) || "__global__"
        const all = get(selectedVariantsByAppAtom)
        return all[appId] || []
    },
    (get, set, next: string[]) => {
        const appId = get(routerAppIdAtom) || "__global__"
        const all = get(selectedVariantsByAppAtom)
        set(selectedVariantsByAppAtom, {...all, [appId]: next})
    },
)
```

**For nullable strings, use custom stringStorage:**
```typescript
import {stringStorage} from "@/oss/state/utils/stringStorage"

export const recentAppIdAtom = atomWithStorage<string | null>(
    "agenta:recent-app",
    null,
    stringStorage, // Handles null values properly
)
```

**When to use `atomWithStorage`:**
- User preferences (theme, row height, view mode)
- Recently used items (recent app, recent filter)
- UI state that should persist (sidebar open/closed, panel sizes)
- Form drafts or temporary data

**Best practices:**
- Prefix keys with `agenta:` for consistency (e.g., `"agenta:table:row-height"`)
- Use TypeScript types for type safety
- Provide sensible defaults
- For complex objects, `atomWithStorage` handles JSON serialization automatically
- For nullable strings, use `stringStorage` helper

**Examples in codebase:**
- `web/oss/src/components/EvalRunDetails2/state/rowHeight.ts` - User preference
- `web/oss/src/state/app/atoms/fetcher.ts` - Recent app tracking
- `web/oss/src/components/Playground/state/atoms/core.ts` - App-scoped selections

#### Implementation Strategy

-   **Current Approach**: Gradual adoption during regular development
-   **Migration**: Update components to follow this structure as they are modified
-   **No Big Bang**: Avoid large-scale refactoring
-   **Progressive Enhancement**: Easy to implement incrementally

This structure supports:

-   Clear ownership and responsibility
-   Easy code review and modification
-   Identification of reusable patterns
-   Natural code organization based on usage
-   Scalable architecture that grows with the application

### Data Fetching Best Practices

**Primary Pattern: Jotai Atoms with TanStack Query**

For data fetching, use `atomWithQuery` from `jotai-tanstack-query`. This combines Jotai's reactive state with TanStack Query's caching and synchronization.

**When to use `atomWithQuery`:**
- Fetching data from APIs
- When query depends on other atoms (e.g., `projectIdAtom`, `appIdAtom`)
- Sharing data across multiple components
- Need caching, loading states, and automatic refetching

**Basic Pattern:**

```typescript
import {atomWithQuery} from "jotai-tanstack-query"

export const dataQueryAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom) // Read dependencies
    
    return {
        queryKey: ["data", projectId], // Include all dependencies
        queryFn: () => fetchData(projectId),
        staleTime: 60_000,
        refetchOnWindowFocus: false,
        enabled: !!projectId, // Conditional fetching
    }
})

// Usage in components
const query = useAtomValue(dataQueryAtom)
const data = query.data
const isLoading = query.isPending
```

**For parameterized queries, use `atomFamily`:**

```typescript
export const itemQueryAtomFamily = atomFamily((itemId: string) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom)
        return {
            queryKey: ["item", itemId, projectId],
            queryFn: () => fetchItem(itemId),
            enabled: !!itemId && !!projectId,
        }
    })
)

// Usage
const itemQuery = useAtomValue(itemQueryAtomFamily(itemId))
```

**Derived atoms for data transformation:**

```typescript
export const dataAtom = selectAtom(
    dataQueryAtom,
    (res) => res.data ?? [],
    deepEqual
)
```

**Mutations and invalidation:**

```typescript
export const createItemAtom = atom(
    null,
    async (_get, _set, payload) => {
        const res = await createItem(payload)
        await queryClient.invalidateQueries({queryKey: ["items"]})
        return res
    }
)
```

**Key Principles:**
1. Include all reactive dependencies in `queryKey`
2. Use `enabled` for conditional queries
3. Use `selectAtom` for derived data
4. Invalidate queries after mutations
5. Set appropriate `staleTime` for caching

**Examples in codebase:**
- `web/oss/src/state/profile/selectors/user.ts` - Simple query
- `web/oss/src/state/environment/atoms/fetcher.ts` - Multi-dependency query
- `web/oss/src/state/queries/atoms/fetcher.ts` - Atom family with parameters
- `web/oss/src/state/testset/hooks/useTestset.ts` - Hook wrapper pattern

---

### Loadable Bridge Pattern

For managing data sources that provide inputs to runnables (testsets, traces), use the **Loadable Bridge** from `@agenta/entities/loadable`.

**Full documentation:** `web/packages/agenta-entities/src/loadable/README.md`

**What is a Loadable?**

A loadable represents a data source that provides input rows for execution. Loadables can operate in:
- **Local mode**: Manual data entry
- **Connected mode**: Synced with an entity (testset revision, trace)

**Basic Usage:**

```typescript
import { loadableBridge } from '@agenta/entities/loadable'
import { useAtomValue, useSetAtom } from 'jotai'

// Read rows
const rows = useAtomValue(loadableBridge.selectors.rows(loadableId))

// Add a row
const addRow = useSetAtom(loadableBridge.actions.addRow)
addRow(loadableId, { prompt: 'Hello, world!' })

// Connect to a testset
const connect = useSetAtom(loadableBridge.actions.connectToSource)
connect(loadableId, testsetRevisionId, 'MyTestset v1', 'testcase')
```

**Available Selectors:**

| Selector | Returns | Description |
|----------|---------|-------------|
| `rows(loadableId)` | `LoadableRow[]` | All rows in the loadable |
| `columns(loadableId)` | `LoadableColumn[]` | Column definitions |
| `activeRow(loadableId)` | `LoadableRow \| null` | Currently selected row |
| `mode(loadableId)` | `'local' \| 'connected'` | Current mode |
| `isDirty(loadableId)` | `boolean` | Has unsaved changes |
| `connectedSource(loadableId)` | `{id, name}` | Connected source info |

**Available Actions:**

| Action | Parameters | Description |
|--------|------------|-------------|
| `addRow` | `(loadableId, data?)` | Add a new row |
| `updateRow` | `(loadableId, rowId, data)` | Update row data |
| `removeRow` | `(loadableId, rowId)` | Remove a row |
| `setActiveRow` | `(loadableId, rowId)` | Select a row |
| `connectToSource` | `(loadableId, sourceId, sourceName, sourceType)` | Connect to entity |
| `disconnect` | `(loadableId)` | Switch to local mode |

---

### Runnable Bridge Pattern

For managing executable entities (app revisions, evaluators), use the **Runnable Bridge** from `@agenta/entities/runnable`.

**Full documentation:** `web/packages/agenta-entities/src/runnable/README.md`

**Basic Usage:**

```typescript
import { runnableBridge } from '@agenta/entities/runnable'
import { useAtomValue } from 'jotai'

// Get runnable data
const data = useAtomValue(runnableBridge.selectors.data(revisionId))

// Get input/output ports
const inputPorts = useAtomValue(runnableBridge.selectors.inputPorts(revisionId))
const outputPorts = useAtomValue(runnableBridge.selectors.outputPorts(revisionId))

// Access evaluator-specific features
const evalController = runnableBridge.runnable('evaluatorRevision')
const presets = useAtomValue(evalController.selectors.presets(evaluatorId))
```

**Available Selectors:**

| Selector | Returns | Description |
| -------- | ------- | ----------- |
| `data(runnableId)` | `RunnableData \| null` | Runnable data |
| `query(runnableId)` | `BridgeQueryState` | Query state with loading/error |
| `isDirty(runnableId)` | `boolean` | Has unsaved changes |
| `inputPorts(runnableId)` | `RunnablePort[]` | Input port definitions |
| `outputPorts(runnableId)` | `RunnablePort[]` | Output port definitions |
| `configuration(runnableId)` | `Record<string, unknown> \| null` | Configuration object |

---

### Entity Selection System

For hierarchical entity selection (App → Variant → Revision), use the unified `EntityPicker` component from `@agenta/entity-ui`.

**Full documentation:** `web/packages/agenta-entity-ui/src/selection/README.md`

**EntityPicker with Variants:**

```typescript
import { EntityPicker, type AppRevisionSelectionResult, type TestsetSelectionResult } from '@agenta/entity-ui'

// Cascading dropdowns (inline forms, compact space)
<EntityPicker<AppRevisionSelectionResult>
  variant="cascading"
  adapter="appRevision"
  onSelect={handleSelect}
/>

// Breadcrumb navigation (modals, full selection UI)
<EntityPicker<AppRevisionSelectionResult>
  variant="breadcrumb"
  adapter="appRevision"
  onSelect={handleSelect}
  showSearch
  showBreadcrumb
  rootLabel="All Apps"
/>

// List with hover popovers (sidebars, 2-level hierarchies)
<EntityPicker<TestsetSelectionResult>
  variant="list-popover"
  adapter="testset"
  onSelect={handleSelect}
  autoSelectLatest
  selectLatestOnParentClick
/>
```

**Mode-Specific Hooks:**

```typescript
import { useCascadingMode, useBreadcrumbMode, useListPopoverMode } from '@agenta/entity-ui'

// For cascading dropdowns
const { levels, isComplete, selection } = useCascadingMode({
  adapter: 'appRevision',
  instanceId: 'my-picker',
  onSelect: handleSelect,
})

// For breadcrumb navigation
const { breadcrumb, items, navigateDown, select } = useBreadcrumbMode({
  adapter: 'appRevision',
  instanceId: 'my-picker',
  onSelect: handleSelect,
})

// For list with popovers
const { parents, handleChildSelect } = useListPopoverMode({
  adapter: 'testset',
  instanceId: 'my-picker',
  onSelect: handleSelect,
})
```

**Pre-built Adapters:**

| Adapter | Hierarchy | Selection Result |
|---------|-----------|------------------|
| `"appRevision"` | App → Variant → Revision | `AppRevisionSelectionResult` |
| `"evaluatorRevision"` | Evaluator → Variant → Revision | `EvaluatorRevisionSelectionResult` |
| `"testset"` | Testset → Revision | `TestsetSelectionResult` |

---

### Molecule Pattern (Entity State Management)

For entities requiring CRUD operations with draft state, loading indicators, and cache management, use the **Molecule Pattern** from `@agenta/entities`.

**Full documentation:** `web/packages/agenta-entities/src/shared/README.md`

**What is a Molecule?**

A molecule provides a unified API for entity state management:

```typescript
molecule.atoms.*        // Atom families for reactive subscriptions
molecule.reducers.*     // Write operations
molecule.get.*          // Imperative reads (snapshot from store)
molecule.set.*          // Imperative writes
molecule.useController  // React hook combining atoms + dispatch
molecule.cleanup.*      // Memory management
```

**Quick Decision - Where to use which API:**

```
Where are you using it?
         │
    ┌────┼────┐
    │    │    │
 React  Atom  Callback
    │    │    │
    ▼    ▼    ▼
useAtom  get(mol.   mol.get.*
         atoms.*)   mol.set.*
```

**Basic Usage:**

```typescript
import { testcaseMolecule } from '@agenta/entities/testcase'

// React hook - returns [state, dispatch]
function TestcaseEditor({ id }: { id: string }) {
  const [state, dispatch] = testcaseMolecule.useController(id)

  if (state.isPending) return <Skeleton />
  if (!state.data) return <NotFound />

  return (
    <Input
      value={state.data.input}
      onChange={(e) => dispatch.update({ input: e.target.value })}
    />
  )
}

// Fine-grained subscriptions - only re-renders when isDirty changes
function DirtyIndicator({ id }: { id: string }) {
  const isDirty = useAtomValue(testcaseMolecule.atoms.isDirty(id))
  return isDirty ? <Badge>Modified</Badge> : null
}
```

**Imperative API (for callbacks):**

```typescript
async function handleSave(id: string) {
  const data = testcaseMolecule.get.data(id)
  if (!data || !testcaseMolecule.get.isDirty(id)) return

  await api.save(data)
  testcaseMolecule.set.discard(id)
}
```

**Available Atoms:**

| Atom | Type | Description |
|------|------|-------------|
| `data` | `T \| null` | Entity with draft merged |
| `serverData` | `T \| null` | Raw server data |
| `draft` | `TDraft \| null` | Local changes only |
| `query` | `QueryState<T>` | Query state (isPending, isError) |
| `isDirty` | `boolean` | Has unsaved local changes |
| `isNew` | `boolean` | Entity not yet on server |

**Available Molecules:**

| Entity | Import | Description |
|--------|--------|-------------|
| Testcase | `testcaseMolecule` from `@agenta/entities/testcase` | Testcase with cell subscriptions |
| Trace Span | `traceSpanMolecule` from `@agenta/entities/trace` | Trace span with attribute drill-in |
| Testset | `testsetMolecule` from `@agenta/entities/testset` | Testset with list/detail queries |
| Revision | `revisionMolecule` from `@agenta/entities/testset` | Revision with column management |

**Data Flow Architecture:**

```
Server → TanStack Query → atoms.serverData
                              ↓
                         atoms.draft (local changes)
                              ↓
                         atoms.data (merged)
                              ↓
                         useController → Component
```

**Anti-Patterns to Avoid:**

```typescript
// BAD - atoms require React context
async function handleSave(id: string) {
  const data = useAtomValue(molecule.atoms.data(id)) // Won't work!
}

// GOOD - use imperative API
async function handleSave(id: string) {
  const data = molecule.get.data(id)
}
```

```typescript
// BAD - new atom every render
const derived = atom((get) => get(molecule.atoms.data(id)))

// GOOD - memoize the atom
const derived = useMemo(
  () => atom((get) => get(molecule.atoms.data(id))),
  [id]
)
```

---

**Legacy: SWR Pattern (avoid for new code)**

We previously used SWR with Axios for data fetching. This pattern is still present in older code but should not be used for new features.

#### ❌ Avoid: useEffect for Data Fetching

Don't use `useEffect` with manual state management for data fetching:

```javascript
// DON'T DO THIS
useEffect(() => {
    fetchData().then(setData).catch(setError)
}, [])
```

Use `atomWithQuery` instead (see above).

### Styling Best Practices

#### Use Tailwind CSS (Preferred)

**Always prefer Tailwind utility classes over CSS-in-JS or separate CSS files** for styling whenever possible.

✅ **Preferred: Tailwind classes**
```typescript
// Good - Uses Tailwind utilities
<main className="flex flex-col grow h-full overflow-hidden items-center justify-center">
    <Card className="max-w-[520px] w-[90%] text-center">
        <Typography.Title level={3} className="!mb-2">
            Unable to establish connection
        </Typography.Title>
    </Card>
</main>
```

❌ **Avoid: CSS-in-JS (react-jss, styled-components)**
```typescript
// Avoid - Creates extra overhead and complexity
const useStyles = createUseStyles((theme: JSSTheme) => ({
    collapseContainer: {
        "& .ant-collapse-header": {
            backgroundColor: `#FAFAFB !important`,
        },
    },
}))

function Component() {
    const classes = useStyles()
    return <div className={classes.collapseContainer}>...</div>
}
```

❌ **Avoid: Inline styles**
```typescript
// Avoid - Not themeable, harder to maintain
<div style={{maxWidth: "520px", width: "90%", textAlign: "center"}}>
```

**When CSS-in-JS is acceptable:**
- Complex Ant Design component overrides that can't be done with Tailwind
- Dynamic theme-dependent styles that require JS calculations
- Legacy components (refactor to Tailwind when touching the code)

**Tailwind benefits:**
- No style bloat or unused CSS
- Consistent design system
- Better performance (no runtime style injection)
- Easier to read and maintain
- Works seamlessly with Ant Design

**Examples in codebase:**
- `web/oss/src/components/CustomWorkflowBanner/index.tsx` - Good Tailwind usage
- `web/oss/src/components/ChatInputs/ChatInputs.tsx` - Mixed (being migrated)

---

### React Best Practices

#### Component Reusability

**Before implementing similar functionality in multiple places, consider reusability:**

When you notice patterns that could be extracted:
1. **Don't immediately refactor** - Jumping straight to abstraction can over-engineer
2. **Ask the developer** with context about the potential for reuse
3. **Provide analysis**: Show where similar code exists and potential benefits/costs of refactoring

**Example prompt when detecting reusability:**
```
I notice this table cell rendering logic is similar to:
- components/EvalRunDetails2/TableCells/MetricCell.tsx
- components/Evaluators/cells/MetricDisplayCell.tsx

Before implementing, would you like me to:
A) Create a reusable component (requires refactoring both existing usages)
B) Proceed with current implementation (can consolidate later if pattern repeats)

The trade-off: (A) takes more time now but improves maintainability; (B) is faster but may create tech debt.
```

**When to extract components:**
- Used in 3+ places with similar logic
- Complex logic that benefits from isolation
- Clear, stable interface that won't change often

**When NOT to extract:**
- Only used twice (wait for third usage to confirm pattern)
- Requirements are still evolving
- Small, simple components (< 20 lines)

---

#### Performance Considerations

**Critical for evaluations and observability features** - these handle large datasets:

1. **Minimize Re-renders**
   - Use `useMemo` for expensive computations
   - Use `React.memo` for components that receive stable props
   - Avoid inline functions/objects in render (especially in lists)

```typescript
// ❌ Bad - Creates new function every render
{items.map(item => <Row key={item.id} onClick={() => handleClick(item)} />)}

// ✅ Good - Stable callback
const handleRowClick = useCallback((item) => handleClick(item), [])
{items.map(item => <Row key={item.id} onClick={handleRowClick} item={item} />)}
```

2. **Optimize Query Updates**
   - Be mindful of `queryKey` dependencies - don't include frequently changing values unnecessarily
   - Use `select` option in queries to extract only needed data
   - Consider `staleTime` for data that doesn't change often

```typescript
// ❌ Bad - Refetches on every UI update
atomWithQuery((get) => ({
    queryKey: ["data", get(currentTimeAtom)], // currentTimeAtom updates every second!
    queryFn: fetchData
}))

// ✅ Good - Only refetches when meaningful dependencies change
atomWithQuery((get) => ({
    queryKey: ["data", get(projectIdAtom), get(filterAtom)],
    queryFn: fetchData,
    staleTime: 60_000 // Cache for 1 minute
}))
```

3. **Virtualization for Large Lists**
   - Use virtual scrolling for lists with 100+ items
   - Reference: `InfiniteVirtualTable` component

4. **Debounce/Throttle User Input**
   - Debounce search inputs, filters
   - Throttle scroll handlers, resize handlers

---

#### Modular Component Design

**Keep components focused and decoupled:**

✅ **Good: Component owns its internal concerns**
```typescript
// Component only needs IDs, fetches its own data
function UserCard({userId}: {userId: string}) {
    const user = useAtomValue(userQueryAtomFamily(userId))
    return <Card>{user.name}</Card>
}

// Parent doesn't need to know about user data structure
function UserList({userIds}: {userIds: string[]}) {
    return userIds.map(id => <UserCard key={id} userId={id} />)
}
```

❌ **Bad: Parent must know too much**
```typescript
// Parent must fetch and pass everything
function UserCard({
    userName,
    userEmail,
    userAvatar,
    userRole,
    userDepartment
}: {/* many props */}) {
    return <Card>...</Card>
}

// Parent is tightly coupled to UserCard's needs
function UserList({userIds}: {userIds: string[]}) {
    const users = useAtomValue(usersQueryAtom) // Must fetch all data
    return users.map(user => (
        <UserCard
            key={user.id}
            userName={user.name}
            userEmail={user.email}
            userAvatar={user.avatar}
            userRole={user.role}
            userDepartment={user.department}
        />
    ))
}
```

**Principles:**
- **High cohesion**: Component contains related logic together
- **Low coupling**: Minimal dependencies on parent/sibling components
- **Props should be minimal**: Pass IDs/keys, not entire data structures when possible
- **Components fetch their own data**: Use atoms with queries for data needs
- **Single Responsibility**: Each component does one thing well

**Benefits:**
- Easier to test in isolation
- Can reuse without bringing unnecessary dependencies
- Changes to one component don't cascade to others
- Clear interfaces and responsibilities

---

#### Avoiding Inline Array Props

Passing inline arrays of objects with heavy content such as JSX is considered a bad practice in React. This is because it can lead to unnecessary re-renders and performance issues. When you pass an inline array, a new array is created every time the component renders, causing React to think that the prop has changed even if the content is the same.

For example, in the `AccordionTreePanel` component, the `items` prop is passed an inline array of objects with JSX content:

❌ **Avoid this pattern:**

```javascript
<AccordionTreePanel
  items={[
    {
      title: "Item 1",
      content: <div>Content 1</div>,
    },
    {
      title: "Item 2",
      content: <div>Content 2</div>,
    },
  ]}
/>
```

✅ **Use this pattern:**

```javascript
import {useMemo} from "react"

const items = useMemo(
    () => [
        {
            title: "Item 1",
            content: <div>Content 1</div>,
        },
        {
            title: "Item 2",
            content: <div>Content 2</div>,
        },
    ],
    [],
)

<AccordionTreePanel items={items} />
```

---

### Shared Components and Package Architecture

The monorepo uses workspace packages to share components, utilities, and logic across OSS and EE. Understanding which package to use and how to properly compose components is important for maintainability.

**Key Documentation:**

| Package | README Location |
|---------|-----------------|
| `@agenta/ui` | `web/packages/agenta-ui/README.md` |
| `@agenta/entities` | `web/packages/agenta-entities/README.md` |
| `@agenta/shared` | `web/packages/agenta-shared/README.md` |
| `@agenta/playground` | `web/packages/agenta-playground/` |

#### Package Overview

| Package | Purpose | Key Exports |
|---------|---------|-------------|
| `@agenta/shared` | Pure utilities (no React) | Path utilities, common types |
| `@agenta/ui` | Reusable React components | `EnhancedModal`, `InfiniteVirtualTable`, `cn`, `textColors`, presentational components |
| `@agenta/entities` | Entity state/hooks/controllers | Molecules, bridges, UI components (modals, pickers) |
| `@agenta/playground` | Playground-specific components | `PlaygroundContent`, `EntitySelector`, `InputMappingModal` |

#### Subpath Imports for Tree-Shaking

**Always use subpath imports for better tree-shaking.** Importing from root barrel exports (e.g., `@agenta/shared`) pulls the entire dependency graph, which significantly increases bundle size.

#### @agenta/shared Subpath Exports

```typescript
// API utilities
import {axios, getAgentaApiUrl, getEnv, configureAxios} from "@agenta/shared/api"

// State atoms
import {projectIdAtom, setProjectIdAtom} from "@agenta/shared/state"

// Utilities (most common)
import {
  dayjs,
  createBatchFetcher,
  isValidUUID,
  dereferenceSchema,
  getValueAtPath,
  setValueAtPath,
  extractTypedPaths,
  determineMappingStatus,
  formatNumber,
  formatLatency,
} from "@agenta/shared/utils"

// React hooks
import {useDebounceInput} from "@agenta/shared/hooks"

// Schemas (for validation)
import {MESSAGE_CONTENT_SCHEMA, CHAT_MESSAGE_SCHEMA} from "@agenta/shared/schemas"

// Types (use `import type` for type-only imports)
import type {SimpleChatMessage, MessageContent, ToolCall} from "@agenta/shared/types"
```

#### @agenta/ui Subpath Exports

```typescript
import {...} from "@agenta/ui"                   // Main exports (presentational components)
import {...} from "@agenta/ui/table"             // InfiniteVirtualTable, paginated stores
import {...} from "@agenta/ui/editor"            // Editor, JSON parsing utilities
import {...} from "@agenta/ui/shared-editor"     // SharedEditor, useDebounceInput
import {...} from "@agenta/ui/chat-message"      // ChatMessageEditor, message types/schemas
import {...} from "@agenta/ui/llm-icons"         // LLM provider icons
import {...} from "@agenta/ui/select-llm-provider" // LLM provider selector
import {...} from "@agenta/ui/app-message"       // AppMessageContext, useAppMessage
import {...} from "@agenta/ui/cell-renderers"    // Table cell renderers, CellRendererRegistry
```

#### @agenta/entities Subpath Exports

```typescript
import {...} from "@agenta/entities"             // Clean named exports (preferred)
import {...} from "@agenta/entities/shared"      // Molecule factories, transforms
import {...} from "@agenta/entities/trace"       // Trace/span molecule, schemas
import {...} from "@agenta/entities/testset"     // Testset/revision molecules
import {...} from "@agenta/entities/testcase"    // Testcase molecule
import {...} from "@agenta/entities/loadable"    // Loadable bridge
import {...} from "@agenta/entities/runnable"    // Runnable bridge
import {...} from "@agenta/entity-ui"            // UI components (modals, pickers)
```

#### EnhancedModal (Required for All New Modals)

**All new modals MUST use `EnhancedModal` from `@agenta/ui`** instead of raw `antd Modal`:

```typescript
import {EnhancedModal, ModalContent, ModalFooter} from "@agenta/ui"

function MyModal({open, onClose}: {open: boolean; onClose: () => void}) {
    return (
        <EnhancedModal
            open={open}
            onCancel={onClose}
            title="Modal Title"
            footer={null}
        >
            <ModalContent>
                {/* Main content */}
            </ModalContent>
            <ModalFooter>
                <Button onClick={onClose}>Cancel</Button>
                <Button type="primary">Confirm</Button>
            </ModalFooter>
        </EnhancedModal>
    )
}
```

**Why EnhancedModal:**

- Consistent styling across the application
- Proper scroll handling with `ModalContent`
- Standardized footer layout with `ModalFooter`
- Theme integration

#### Style Utilities

Use utilities from `@agenta/ui` for consistent styling:

```typescript
import {cn, textColors, bgColors} from "@agenta/ui"

// cn - Combines class names with conditional support
<div className={cn("base-class", isActive && "active-class")} />

// textColors - Theme-aware text colors
<span className={textColors.secondary}>Secondary text</span>

// bgColors - Theme-aware background colors
<div className={bgColors.hover}>Hoverable area</div>
```

#### Presentational Components

Use section layout primitives from `@agenta/ui`:

```typescript
import {
  SectionCard,
  SectionLabel,
  SectionHeaderRow,
  ConfigBlock,
  VersionBadge,
  RevisionLabel,
  StatusTag,
  PanelHeader,
  SourceIndicator,
} from "@agenta/ui"

// Section card with header
<SectionCard>
  <SectionHeaderRow
    left={<SectionLabel>Configuration</SectionLabel>}
    right={<Button>Edit</Button>}
  />
  <ConfigBlock title="Settings">
    <Input />
  </ConfigBlock>
</SectionCard>
```

#### Package Selection Guide

```text
Need a modal?
└─ Use: EnhancedModal from @agenta/ui

Need class name utilities or theme colors?
└─ Use: cn, textColors, bgColors from @agenta/ui

Need section layout primitives?
└─ Use: SectionCard, SectionLabel, ConfigBlock from @agenta/ui

Need entity state management (molecules)?
└─ Use: *Molecule from @agenta/entities/{entity}

Need entity selection UI?
└─ Use: EntityPicker, EntityCascader from @agenta/entity-ui

Need loadable/runnable bridges?
└─ Use: loadableBridge, runnableBridge from @agenta/entities/{type}

Building playground features?
└─ Use: Components from @agenta/playground
```
