# Plan: G12 — Applications and Evaluators Missing Invoke/Inspect Endpoints

> Status: draft
> Date: 2026-03-17
> Gap: [gap-analysis.md § G12, G12a, G12b](./gap-analysis.md#g12-applications-and-evaluators-missing-invokinspect-endpoints)

---

## Goal

Expose `invoke` and `inspect` endpoints on the applications and evaluators routers, parallel to what already exists on the workflows router. The domain routers (`/applications/`, `/evaluators/`) are filtered projections over the workflow execution layer and must surface the same execution/discovery surface.

Additionally:
- **G12a**: Add canonical workflow catalog endpoints; make evaluator catalog a filtered workflow catalog view.
- **G12b**: Remove the legacy `service` / `configuration` fields from `WorkflowRevisionData` once all code paths and tests are migrated to normalized fields.

---

## G12 — Applications and Evaluators Invoke/Inspect

### Current State

| Router | Invoke | Inspect |
|--------|--------|---------|
| `WorkflowsRouter` | `POST /invoke` ✅ | `POST /inspect` ✅ |
| `ApplicationsRouter` | ❌ missing | ❌ missing |
| `EvaluatorsRouter` | ❌ missing | ❌ missing |

The SDK already has `invoke_application`, `inspect_application`, `invoke_evaluator`, `inspect_evaluator` in `sdk/agenta/sdk/decorators/running.py` (lines 607–762). They are wired to nothing on the API side.

`WorkflowsService.invoke_workflow` (lines 757–789) does:
1. Resolve project context → sign a secret token → delegate to `_invoke_workflow(request, credentials)`.
2. `inspect_workflow` delegates directly to `_inspect_workflow(request)` with no credentials needed.

Applications and evaluators services have no invoke/inspect methods today.

---

### S1. Add `invoke_application` / `inspect_application` to `ApplicationsService`

**File:** `api/oss/src/core/applications/service.py`

Add a section "application services" (mirror the "workflow services" section in `WorkflowsService`):

```python
from agenta.sdk.decorators.running import (
    invoke_application as _invoke_application,
    inspect_application as _inspect_application,
)

async def invoke_application(
    self,
    *,
    project_id: UUID,
    user_id: UUID,
    #
    request: WorkflowServiceRequest,
    #
    **kwargs,
) -> Union[WorkflowServiceBatchResponse, WorkflowServiceStreamResponse]:
    project = await get_project_by_id(project_id=str(project_id))
    secret_token = await sign_secret_token(
        user_id=str(user_id),
        project_id=str(project_id),
        workspace_id=str(project.workspace_id),
        organization_id=str(project.organization_id),
    )
    credentials = f"Secret {secret_token}"
    return await _invoke_application(request=request, credentials=credentials, **kwargs)

async def inspect_application(
    self,
    *,
    project_id: UUID,
    user_id: UUID,
    #
    request: WorkflowServiceRequest,
) -> WorkflowServiceRequest:
    return await _inspect_application(request=request)
```

Imports to add (same pattern as `WorkflowsService`):
- `get_project_by_id` — already imported in applications service via the existing `resolve_application_revision` dependencies
- `sign_secret_token` — already imported in workflows service; add same import here

---

### S2. Add `invoke_evaluator` / `inspect_evaluator` to `EvaluatorsService`

**File:** `api/oss/src/core/evaluators/service.py`

Identical pattern as S1, using:

```python
from agenta.sdk.decorators.running import (
    invoke_evaluator as _invoke_evaluator,
    inspect_evaluator as _inspect_evaluator,
)
```

Replace the `# TODO: Implement ?` comment at line 844 with the service methods section.

---

### S3. Register invoke/inspect routes in `ApplicationsRouter`

**File:** `api/oss/src/apis/fastapi/applications/router.py`

Add to `__init__` route registration (in the "APPLICATION SERVICES" section, after CRUD routes):

```python
# APPLICATION SERVICES ------------------------------------------------

self.router.add_api_route(
    "/invoke",
    self.invoke_application,
    methods=["POST"],
    operation_id="invoke_application",
    status_code=status.HTTP_200_OK,
    response_model=Union[WorkflowServiceBatchResponse, WorkflowServiceStreamResponse],
    response_model_exclude_none=True,
)

self.router.add_api_route(
    "/inspect",
    self.inspect_application,
    methods=["POST"],
    operation_id="inspect_application",
    status_code=status.HTTP_200_OK,
    response_model=WorkflowServiceRequest,
    response_model_exclude_none=True,
)
```

Add handler methods (mirror `WorkflowsRouter.invoke_workflow` / `inspect_workflow`):

```python
async def invoke_application(
    self,
    request: Request,
    *,
    workflow_service_request: WorkflowServiceRequest,
):
    # EE permission check: RUN_WORKFLOWS (same permission as workflows)
    try:
        response = await self.applications_service.invoke_application(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            request=workflow_service_request,
        )
        return await handle_invoke_success(request, response)
    except Exception as exception:
        return await handle_invoke_failure(exception)

@intercept_exceptions()
@suppress_exceptions(default=WorkflowServiceRequest(), exclude=[HTTPException])
async def inspect_application(
    self,
    request: Request,
    *,
    workflow_service_request: WorkflowServiceRequest,
):
    # EE permission check: VIEW_WORKFLOWS
    try:
        workflow_service_request = await self.applications_service.inspect_application(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            request=workflow_service_request,
        )
        return await handle_inspect_success(workflow_service_request)
    except Exception as exception:
        return await handle_inspect_failure(exception)
```

Imports to add to the router:
- `handle_invoke_success`, `handle_invoke_failure`, `handle_inspect_success`, `handle_inspect_failure` — from `api/oss/src/apis/fastapi/workflows/router.py` (or extract to shared utils)
- `WorkflowServiceRequest`, `WorkflowServiceBatchResponse`, `WorkflowServiceStreamResponse` — already in scope if they're imported via `workflows` models

**Note on shared utils:** `handle_invoke_success/failure` and `handle_inspect_success/failure` are currently defined in the workflows router. Before importing them cross-router, extract them to `api/oss/src/apis/fastapi/shared/utils.py` or a new `api/oss/src/apis/fastapi/workflows/utils.py` (if not already there). This prevents circular imports.

---

### S4. Register invoke/inspect routes in `EvaluatorsRouter`

**File:** `api/oss/src/apis/fastapi/evaluators/router.py`

Same pattern as S3, using `self.evaluators_service.invoke_evaluator` and `inspect_evaluator`. Operation IDs: `invoke_evaluator`, `inspect_evaluator`.

---

### S5. Consider simple routers

The `SimpleApplicationsService` and `SimpleEvaluatorsService` are CRUD-only, simplified interfaces — they do not need invoke/inspect. The `/simple/applications/` and `/simple/evaluators/` routes are intentionally stripped-down and should remain CRUD-only.

Decision: **no invoke/inspect on simple routers**.

---

### S6. Tests — G12

**New acceptance test files:**

- `api/oss/tests/pytest/acceptance/applications/test_application_invoke.py`
- `api/oss/tests/pytest/acceptance/evaluators/test_evaluator_invoke.py`

Each file should test:
1. `POST /applications/invoke` with a builtin workflow application — returns expected response shape
2. `POST /applications/inspect` — returns `WorkflowServiceRequest` with populated interface/schemas
3. Same for evaluators

Pattern to follow: `api/oss/tests/pytest/acceptance/workflows/test_workflow_invocations.py` (if it exists) or adapt from evaluator basics tests.

---

## G12a — Catalog Surface: Workflow-Centered Catalog

### Current State

| Entity | Catalog endpoint | Status |
|--------|-----------------|--------|
| Evaluators | `GET /preview/evaluators/catalog/templates` | ✅ Implemented |
| Evaluators | `GET /preview/evaluators/catalog/templates/{key}` | ✅ Implemented |
| Evaluators | `GET /preview/evaluators/catalog/templates/{key}/presets` | ✅ Implemented |
| Workflows | None | ❌ Missing |
| Applications | None | ❌ Missing |

The evaluator catalog is backed by a static Python registry (`api/oss/src/resources/evaluators/evaluators.py`) and returns `EvaluatorCatalogTemplate` / `EvaluatorCatalogPreset` DTOs. The catalog surface is evaluator-specific: there is no equivalent for predefined workflows or predefined applications.

The gap analysis action requires making the workflow catalog canonical and the evaluator/application catalogs filtered projections over it.

---

### S7. Define workflow catalog DTOs

**File:** `api/oss/src/apis/fastapi/workflows/models.py` (or a new `catalog.py`)

```python
class WorkflowCatalogTemplateData(BaseModel):
    uri: str
    url: Optional[str] = None
    headers: Optional[dict] = None
    schemas: Optional[JsonSchemas] = None  # inputs, parameters, outputs

class WorkflowCatalogTemplate(BaseModel):
    key: str
    name: str
    description: Optional[str] = None
    archived: Optional[bool] = False
    categories: List[str] = []
    flags: Optional[dict] = None       # workflow flags (is_evaluator, etc.)
    data: WorkflowCatalogTemplateData

class WorkflowCatalogPresetData(BaseModel):
    uri: str
    parameters: Optional[dict] = None
    script: Optional[Any] = None
    headers: Optional[dict] = None

class WorkflowCatalogPreset(BaseModel):
    key: str
    name: str
    description: Optional[str] = None
    archived: Optional[bool] = False
    data: WorkflowCatalogPresetData

class WorkflowCatalogTemplatesResponse(BaseModel):
    count: int
    templates: List[WorkflowCatalogTemplate]

class WorkflowCatalogPresetsResponse(BaseModel):
    count: int
    presets: List[WorkflowCatalogPreset]
```

**Compatibility note:** `EvaluatorCatalogTemplate` / `EvaluatorCatalogPreset` (currently in `evaluators/models.py`) should be aliases over the workflow catalog DTOs (or be replaced by them). The evaluator catalog adds only `categories` filtering (by `is_evaluator` flag). Do not break existing evaluator catalog endpoint shapes.

---

### S8. Add workflow catalog resource registry

**File:** `api/oss/src/resources/workflows/workflows.py` (new)

Structure mirrors `api/oss/src/resources/evaluators/evaluators.py`. Each entry is a dict:

```python
workflows = [
    {
        "name": "Completion",
        "key": "completion",
        "categories": ["builtin"],
        "flags": {"is_evaluator": False},
        "uri": "agenta:builtin:completion:v0",
        "schemas": {
            "inputs": { ... },
            "parameters": { ... },
            "outputs": { ... },
        },
        "presets": [
            {
                "key": "default",
                "name": "Default",
                "parameters": { ... },
            }
        ],
        "archived": False,
    },
    # ...
]
```

Evaluator entries already in `evaluators.py` gain a `"flags": {"is_evaluator": True}` field and stay in the evaluator resource file. The workflow resource file contains non-evaluator predefined workflows.

**Alternative (preferred for symmetry):** merge all predefined runnables into one resource file with a `flags` field. The evaluator catalog endpoint filters by `flags.is_evaluator == True`. This is the canonical single-source-of-truth.

---

### S9. Add workflow catalog router endpoints

**File:** `api/oss/src/apis/fastapi/workflows/router.py`

```python
# WORKFLOW CATALOG ------------------------------------------------

self.router.add_api_route(
    "/catalog/templates",
    self.list_workflow_catalog_templates,
    methods=["GET"],
    operation_id="list_workflow_catalog_templates",
    response_model=WorkflowCatalogTemplatesResponse,
    response_model_exclude_none=True,
)
self.router.add_api_route(
    "/catalog/templates/{template_key}",
    self.fetch_workflow_catalog_template,
    methods=["GET"],
    operation_id="fetch_workflow_catalog_template",
    response_model=WorkflowCatalogTemplate,
    response_model_exclude_none=True,
)
self.router.add_api_route(
    "/catalog/templates/{template_key}/presets",
    self.list_workflow_catalog_presets,
    methods=["GET"],
    operation_id="list_workflow_catalog_presets",
    response_model=WorkflowCatalogPresetsResponse,
    response_model_exclude_none=True,
)
self.router.add_api_route(
    "/catalog/templates/{template_key}/presets/{preset_key}",
    self.fetch_workflow_catalog_preset,
    methods=["GET"],
    operation_id="fetch_workflow_catalog_preset",
    response_model=WorkflowCatalogPreset,
    response_model_exclude_none=True,
)
```

Handlers read from the workflow resource registry and apply conversion helpers (same pattern as the evaluator catalog helpers `_registry_entry_to_catalog_template` / `_registry_preset_to_catalog_preset` in `evaluators/router.py`).

---

### S10. Redirect evaluator catalog to workflow catalog (filtered view)

**File:** `api/oss/src/apis/fastapi/evaluators/router.py`

`list_evaluator_catalog_templates` currently reads from `evaluators.py` registry directly. After S8, it should read from the workflow catalog registry filtered by `flags.is_evaluator == True`. The response shape (`EvaluatorCatalogTemplate`) stays unchanged — just the data source changes.

This step completes the "evaluator catalog as filtered workflow catalog view" described in G12a.

---

### S11. Application catalog (same filtered view)

**File:** `api/oss/src/apis/fastapi/applications/router.py`

Add the same catalog routes as S9 but filtered by `flags.is_evaluator == False` (or a `flags.is_application` marker). This gives applications a symmetric catalog surface.

For now: **defer S11 unless there are predefined application templates to expose**. The evaluator catalog is the immediately high-value surface. Application catalog can be added in a follow-on when predefined application templates exist.

---

### S12. First-class input and parameter schemas for evaluators

**File:** `api/oss/src/resources/evaluators/evaluators.py`

For each evaluator entry, add `schemas.inputs` as the shared predefined evaluator input contract (currently implicit):

```python
"schemas": {
    "inputs": {
        "type": "object",
        "properties": {
            "prediction": {"type": "string"},
            "ground_truth": {"type": "string"},
            # ... shared evaluator inputs
        },
        "required": ["prediction"]
    },
    "parameters": { ... },   # derived from settings_template (not settings_template itself)
    "outputs": { ... },      # already partially in outputs_schema
},
```

`settings_template` remains as UI convenience metadata. The canonical schema contract comes from `schemas.parameters`. These can coexist during migration.

---

## G12b — Remove Legacy `service` / `configuration` Fields

### Current State

`WorkflowRevisionData` in `api/oss/src/core/workflows/dtos.py` (lines 190–193) extends the SDK model with two backward-compatibility fields:

```python
service: Optional[dict] = None       # legacy, e.g. {"agenta": "v0.1.0", "format": {...}}
configuration: Optional[dict] = None # legacy, e.g. {"parameters": {...}}
```

These are **only referenced in acceptance tests**, not in any production code path. Acceptance tests that still use them:

| Test file | Field used | Assertion line |
|-----------|-----------|----------------|
| `acceptance/evaluators/test_evaluators_basics.py` | `data.service.format` | 67, 142, 255 |
| `acceptance/workflows/test_workflow_revisions_basics.py` | `data.configuration` | 473, 486 |

---

### S13. Migrate acceptance tests off legacy fields

**Files:**
- `api/oss/tests/pytest/acceptance/evaluators/test_evaluators_basics.py`
- `api/oss/tests/pytest/acceptance/workflows/test_workflow_revisions_basics.py`

Replace `data.service` payloads with normalized `data.schemas` + `data.uri` payloads. Replace `data.configuration` payloads with `data.parameters` (or `data.schemas.parameters`) payloads.

Example migration for evaluator test:

```python
# Before (legacy)
"data": {
    "service": {
        "agenta": "v0.1.0",
        "format": _format,
    }
}
assert response["evaluator"]["data"]["service"]["format"] == _format

# After (normalized)
"data": {
    "uri": "agenta:custom:my-evaluator:v0",
    "schemas": {
        "outputs": _format,  # the format schema moves here
    }
}
assert response["evaluator"]["data"]["schemas"]["outputs"] == _format
```

Example migration for workflow revision test:

```python
# Before (legacy)
"data": {"configuration": configuration}
assert response["workflow_revision"]["data"]["configuration"] == configuration

# After (normalized)
"data": {"parameters": configuration}  # or data.schemas.parameters depending on shape
assert response["workflow_revision"]["data"]["parameters"] == configuration
```

---

### S14. Remove legacy fields from the API DTO

**File:** `api/oss/src/core/workflows/dtos.py`

Once all tests pass without asserting on `data.service` / `data.configuration`:

1. Remove `service: Optional[dict] = None` from `WorkflowRevisionData`
2. Remove `configuration: Optional[dict] = None` from `WorkflowRevisionData`
3. Remove `validate_legacy_fields` validator (the mode="after" validator for these fields)
4. Remove the comment block explaining the legacy format

The SDK's `WorkflowRevisionData` in `sdk/agenta/sdk/models/workflows.py` never had these fields — no change needed there.

---

### S15. Check generated client types

After S14, regenerate client types (if the API has an auto-generated client from OpenAPI):

- Verify `WorkflowRevisionData` in generated types no longer includes `service` or `configuration`
- Check `api/oss/tests/` for any remaining `data.service` / `data.configuration` assertions (there should be none after S13)

---

## File Map

### G12

| File | Change |
|------|--------|
| `api/oss/src/core/applications/service.py` | Add `invoke_application`, `inspect_application` methods |
| `api/oss/src/core/evaluators/service.py` | Add `invoke_evaluator`, `inspect_evaluator` methods |
| `api/oss/src/apis/fastapi/applications/router.py` | Add `/invoke`, `/inspect` routes + handlers |
| `api/oss/src/apis/fastapi/evaluators/router.py` | Add `/invoke`, `/inspect` routes + handlers |
| `api/oss/src/apis/fastapi/shared/utils.py` (or `workflows/utils.py`) | Extract `handle_invoke_success/failure`, `handle_inspect_success/failure` shared helpers |
| `api/oss/tests/pytest/acceptance/applications/test_application_invoke.py` | New: invoke/inspect acceptance tests |
| `api/oss/tests/pytest/acceptance/evaluators/test_evaluator_invoke.py` | New: invoke/inspect acceptance tests |

### G12a

| File | Change |
|------|--------|
| `api/oss/src/apis/fastapi/workflows/models.py` | Add `WorkflowCatalogTemplate`, `WorkflowCatalogPreset`, response wrappers |
| `api/oss/src/resources/workflows/workflows.py` | New: predefined workflow registry |
| `api/oss/src/apis/fastapi/workflows/router.py` | Add `/catalog/templates`, `/catalog/templates/{key}`, `/catalog/templates/{key}/presets`, preset `{preset_key}` routes |
| `api/oss/src/apis/fastapi/evaluators/router.py` | Redirect catalog handlers to read from workflow registry (filtered by evaluator flag) |
| `api/oss/src/resources/evaluators/evaluators.py` | Add `schemas.inputs` and `schemas.parameters` as first-class fields to each entry |

### G12b

| File | Change |
|------|--------|
| `api/oss/tests/pytest/acceptance/evaluators/test_evaluators_basics.py` | Migrate `data.service` assertions to normalized fields |
| `api/oss/tests/pytest/acceptance/workflows/test_workflow_revisions_basics.py` | Migrate `data.configuration` assertions to normalized fields |
| `api/oss/src/core/workflows/dtos.py` | Remove `service`, `configuration` fields and legacy validator |

---

## Order of Execution

1. **G12b first** — remove legacy fields from tests and DTOs. This is low-risk and unblocks clean revision data.
2. **G12 (invoke/inspect)** — add service methods and router endpoints. Straightforward, well-bounded, directly enables application/evaluator execution.
3. **G12a** — catalog surface. Most complex; involves defining new resource registries and refactoring the evaluator catalog source. Deliver in sub-steps:
   - S7: define DTOs
   - S8: create workflow registry resource file
   - S9: add workflow catalog endpoints
   - S10: redirect evaluator catalog to workflow registry
   - S12: add first-class schemas to evaluator entries

---

## Constraints and Compatibility

- **Existing evaluator catalog endpoints** (`/preview/evaluators/catalog/*`) must not break. Response shapes stay the same; only the backing registry source changes.
- **`settings_template`** stays as UI convenience metadata — it is not removed in this plan.
- **Simple routers** (`/simple/applications/`, `/simple/evaluators/`) are not touched — CRUD only.
- **Legacy `GET /templates` evaluator endpoint** (`/simple/evaluators/templates`) stays mounted for backward compatibility until explicitly deprecated.
- **G12b removals** must be gated on all tests passing without the legacy fields.
