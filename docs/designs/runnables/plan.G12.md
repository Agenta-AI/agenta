# Plan: G12 — Applications and Evaluators Missing Invoke/Inspect Endpoints

> Status: draft
> Date: 2026-03-17
> Gap: [gap-analysis.md § G12, G12a, G12b](./gap-analysis.md#g12-applications-and-evaluators-missing-invokinspect-endpoints)

---

## Goal

Expose `inspect` endpoints on the applications and evaluators routers, parallel to what already exists on the workflows router. **`/invoke` is intentionally omitted** — the workflows invoke is a full proxy (API in the hot path for every LLM call), and supporting it on applications/evaluators would require either the same proxy overhead or an SDK change to accept auth via query param to support 307 redirects. Neither is desirable now.

Additionally:
- **G12a**: Add canonical workflow catalog endpoints; make evaluator catalog a filtered workflow catalog view.
- **G12b**: Stop writing legacy `service` / `configuration` fields everywhere; normalize them to proper fields on read so consumers always see clean data. Removal of the fields from DTOs follows once a DB migration clears stored legacy data.

---

## G12 — Applications and Evaluators Inspect

### Current State

| Router | Invoke | Inspect |
|--------|--------|---------|
| `WorkflowsRouter` | `POST /invoke` ✅ | `POST /inspect` ✅ |
| `ApplicationsRouter` | not added | ❌ missing |
| `EvaluatorsRouter` | not added | ❌ missing |

The SDK has `inspect_application` and `inspect_evaluator` in `sdk/agenta/sdk/decorators/running.py` (lines 639–762). They are wired to nothing on the API side.

---

### S1. Add `inspect_application` to `ApplicationsService`

**File:** `api/oss/src/core/applications/service.py`

Add a section "application services":

```python
from agenta.sdk.decorators.running import (
    inspect_application as _inspect_application,
)

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

---

### S2. Add `inspect_evaluator` to `EvaluatorsService`

**File:** `api/oss/src/core/evaluators/service.py`

```python
from agenta.sdk.decorators.running import (
    inspect_evaluator as _inspect_evaluator,
)

async def inspect_evaluator(
    self,
    *,
    project_id: UUID,
    user_id: UUID,
    #
    request: WorkflowServiceRequest,
) -> WorkflowServiceRequest:
    return await _inspect_evaluator(request=request)
```

Replace the `# TODO: Implement ?` comment at line 844.

---

### S3. Register `/inspect` route in `ApplicationsRouter`

**File:** `api/oss/src/apis/fastapi/applications/router.py`

Route registration in `__init__`:

```python
# APPLICATION SERVICES ------------------------------------------------

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

Handler:

```python
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

`handle_inspect_success` / `handle_inspect_failure` currently live in `workflows/router.py`. Extract them to `api/oss/src/apis/fastapi/shared/utils.py` before importing from a second router (avoids circular imports).

---

### S4. Register `/inspect` route in `EvaluatorsRouter`

**File:** `api/oss/src/apis/fastapi/evaluators/router.py`

Same pattern as S3. Operation ID: `inspect_evaluator`.

---

### S5. Simple routers

The `SimpleApplicationsService` and `SimpleEvaluatorsService` are CRUD-only. **No inspect on simple routers.**

---

### S6. Tests — G12

**New acceptance test files:**
- `api/oss/tests/pytest/acceptance/applications/test_application_inspect.py`
- `api/oss/tests/pytest/acceptance/evaluators/test_evaluator_inspect.py`

Each file tests:
1. `POST /applications/inspect` → returns `WorkflowServiceRequest` with populated interface/schemas
2. Same for evaluators

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

The evaluator catalog is backed by `api/oss/src/resources/evaluators/evaluators.py` and converts entries via `_registry_entry_to_catalog_template` / `_registry_preset_to_catalog_preset` helpers in the evaluators router. The catalog surface is evaluator-specific.

---

### S10. Define workflow catalog DTOs

**File:** `api/oss/src/apis/fastapi/workflows/models.py`

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
    flags: Optional[dict] = None       # e.g. {"is_evaluator": True}
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

`EvaluatorCatalogTemplate` / `EvaluatorCatalogPreset` become type aliases over these (or unchanged for now to avoid breaking the existing evaluator catalog endpoints).

---

### S11. Add workflow catalog resource registry

**File:** `api/oss/src/resources/workflows/workflows.py` (new)

Structure mirrors `evaluators.py`. Each entry is a dict with `key`, `name`, `categories`, `flags`, `uri`, `schemas` (inputs/parameters/outputs), `presets`, `archived`.

Predefined workflow entries: builtin workflows like `completion`, `chat`, `agent` get entries here. Evaluator entries stay in `evaluators.py` and gain `"flags": {"is_evaluator": True}` for catalog filtering.

---

### S12. Add workflow catalog router endpoints

**File:** `api/oss/src/apis/fastapi/workflows/router.py`

Add `/catalog/templates`, `/catalog/templates/{key}`, `/catalog/templates/{key}/presets`, `/catalog/templates/{key}/presets/{preset_key}` routes. Handlers read from the workflow resource registry using conversion helpers (same pattern as evaluator catalog helpers).

---

### S13. Redirect evaluator catalog to workflow catalog (filtered view)

**File:** `api/oss/src/apis/fastapi/evaluators/router.py`

`list_evaluator_catalog_templates` currently reads directly from the evaluators registry. After S11, it filters from the workflow catalog registry by `flags.is_evaluator == True`. The existing response shapes stay unchanged.

---

### S14. First-class input and parameter schemas for evaluators

**File:** `api/oss/src/resources/evaluators/evaluators.py`

Add `schemas.inputs` as the shared predefined evaluator input contract and `schemas.parameters` derived from `settings_template` for each entry. `settings_template` stays as UI convenience metadata only.

---

## G12b — Eliminate `service` / `configuration` Field Writes; Normalize on Read

### Problem Summary

**Writers** (must be fixed — stop writing legacy fields):

| File | Location | What it writes |
|------|----------|---------------|
| `api/oss/src/core/evaluators/utils.py` | `build_evaluator_data()` lines 130–141 | `service=build_legacy_service(...)` + `configuration=settings_values` |

**Readers / fallbacks** (must be replaced with normalized field reads):

| File | Location | What it reads |
|------|----------|--------------|
| `api/oss/src/core/evaluators/service.py` | `_normalize_simple_evaluator_data()` lines 922–929 | Falls back to `extract_outputs_schema_from_service(service)` when `schemas` is absent |

**Defined / inherited** (DTO cleanup — deferred until DB migration):

| File | What to keep for now |
|------|---------------------|
| `api/oss/src/core/workflows/dtos.py` | Keep `service` + `configuration` fields + rename `validate_legacy_fields` → `normalize_legacy_fields` that POPULATES normalized fields from legacy on read |
| `api/oss/src/core/evaluators/dtos.py` | Inherits automatically |

**Tests asserting on legacy fields** (must be migrated):

| File | Lines | Legacy field |
|------|-------|-------------|
| `acceptance/evaluators/test_evaluators_basics.py` | 67, 142, 255 | `data.service.format` |
| `acceptance/workflows/test_workflow_revisions_basics.py` | 473, 486 | `data.configuration` |

---

### S15. Stop writing legacy fields in `build_evaluator_data()`

**File:** `api/oss/src/core/evaluators/utils.py`

Remove `service` and `configuration` from the returned `SimpleEvaluatorData`. The normalized fields (`uri`, `url`, `schemas`, `script`, `parameters`) are already populated correctly:

```python
# Remove these lines:
service = build_legacy_service(schemas["outputs"])   # line 130 — DELETE

return SimpleEvaluatorData(
    version=_DATA_VERSION,
    uri=uri,
    url=url,
    headers=None,
    schemas=schemas,
    script=script,
    parameters=settings_values if settings_values else None,
    # service=service,           ← REMOVE
    # configuration=settings_values if settings_values else None,  ← REMOVE
)
```

`build_legacy_service()` becomes unused — remove it too.

This fixes:
- All NEW evaluator creates (via `SimpleEvaluatorsService.create`)
- Data migration helpers (`databases/postgres/migrations/core/data_migrations/evaluators.py` in both OSS and EE — they call `build_evaluator_data()` too)
- `db_manager.py` legacy seeding code

---

### S16. Change `validate_legacy_fields` → `normalize_legacy_fields` (on-read migration)

**File:** `api/oss/src/core/workflows/dtos.py`

Rename the validator and change its behaviour: instead of only validating, it should **populate the normalized fields** from legacy data when those fields are absent. This handles OLD persisted revisions that were stored with `service`/`configuration` before this fix.

```python
@model_validator(mode="after")
def normalize_legacy_fields(self) -> "WorkflowRevisionData":
    """
    On-read migration: populate normalized fields from legacy data when missing.
    Handles persisted revisions that pre-date the normalized schema.
    """
    # service.format → schemas.outputs
    if self.service and not (self.schemas and self.schemas.get("outputs")):
        outputs_schema = _extract_outputs_from_service(self.service)
        if outputs_schema:
            existing = self.schemas or {}
            self.schemas = {**existing, "outputs": outputs_schema}

    # service.url → self.url
    if self.service and not self.url:
        service_url = self.service.get("url")
        if service_url and self._is_valid_http_url(service_url):
            self.url = service_url

    # configuration → parameters
    if self.configuration and not self.parameters:
        self.parameters = self.configuration

    return self
```

Where `_extract_outputs_from_service` is the extraction logic from the current `extract_outputs_schema_from_service()` in `evaluators/utils.py` (inline or shared).

This ensures that any consumer reading a `WorkflowRevisionData` always sees proper `schemas.outputs` and `parameters` regardless of whether the stored data was written with legacy or normalized fields.

---

### S17. Remove `extract_outputs_schema_from_service` fallback in `_normalize_simple_evaluator_data`

**File:** `api/oss/src/core/evaluators/service.py` lines 922–929

The fallback at line 922–929 reads `service` to extract `schemas.outputs`. After S16, `normalize_legacy_fields` handles this on-read in the DTO layer, so the service-level fallback is redundant. Remove it:

```python
# REMOVE these lines (922–929):
if "schemas" not in normalized_data_dict:
    outputs_schema = extract_outputs_schema_from_service(
        simple_evaluator_data.service
    )
    if outputs_schema:
        normalized_data_dict["schemas"] = {
            "outputs": outputs_schema,
        }
```

After this, `extract_outputs_schema_from_service` is unused — remove it from `evaluators/utils.py` and from the import in `evaluators/service.py`.

---

### S18. Migrate acceptance tests off legacy fields

**File:** `api/oss/tests/pytest/acceptance/evaluators/test_evaluators_basics.py`

Replace `data.service` payloads with normalized fields:

```python
# Before
"data": {
    "service": {
        "agenta": "v0.1.0",
        "format": _format,
    }
}
assert response["evaluator"]["data"]["service"]["format"] == _format

# After
"data": {
    "uri": "agenta:custom:my-evaluator:v0",
    "schemas": {"outputs": _format},
}
assert response["evaluator"]["data"]["schemas"]["outputs"] == _format
```

**File:** `api/oss/tests/pytest/acceptance/workflows/test_workflow_revisions_basics.py`

```python
# Before
"data": {"configuration": configuration}
assert response["workflow_revision"]["data"]["configuration"] == configuration

# After
"data": {"parameters": configuration}
assert response["workflow_revision"]["data"]["parameters"] == configuration
```

---

### S19. Remove legacy fields from DTOs (deferred — after DB migration)

Once a DB migration has been written and run to rewrite all stored `service`/`configuration` fields to normalized fields, remove from `api/oss/src/core/workflows/dtos.py`:

```python
# Remove:
service: Optional[dict] = None
configuration: Optional[dict] = None
# Remove the normalize_legacy_fields validator entirely
```

**This step is not in scope for this plan.** The DB migration is a separate task. Steps S15–S18 leave the fields in place but stop writing them and ensure on-read normalization handles the existing stored data.

---

## Order of Execution

**1. G12b first** — low-risk, self-contained, unblocks clean revision data for everything else:
   - S15: stop writing legacy fields in `build_evaluator_data()`
   - S16: `normalize_legacy_fields` on-read migration in `WorkflowRevisionData`
   - S17: remove redundant `extract_outputs_schema_from_service` fallback in service
   - S18: migrate acceptance tests

**2. G12 (inspect only)** — add service methods and router endpoints:
   - S1–S2: service methods
   - S3–S4: router routes
   - S6: tests

**3. G12a** — catalog surface (most complex, deliver in sub-steps):
   - S10: DTOs
   - S11: workflow registry
   - S12: workflow catalog endpoints
   - S13: redirect evaluator catalog to workflow registry
   - S14: first-class schemas in evaluator registry

---

## File Map

### G12

| File | Change |
|------|--------|
| `api/oss/src/core/applications/service.py` | Add `inspect_application` |
| `api/oss/src/core/evaluators/service.py` | Add `inspect_evaluator` |
| `api/oss/src/apis/fastapi/applications/router.py` | Add `/inspect` route + handler |
| `api/oss/src/apis/fastapi/evaluators/router.py` | Add `/inspect` route + handler |
| `api/oss/src/apis/fastapi/shared/utils.py` | Extract `handle_inspect_success/failure` from workflows router |
| `api/oss/tests/pytest/acceptance/applications/test_application_inspect.py` | New |
| `api/oss/tests/pytest/acceptance/evaluators/test_evaluator_inspect.py` | New |

### G12a

| File | Change |
|------|--------|
| `api/oss/src/apis/fastapi/workflows/models.py` | Add `WorkflowCatalogTemplate`, `WorkflowCatalogPreset`, response wrappers |
| `api/oss/src/resources/workflows/workflows.py` | New: predefined workflow registry |
| `api/oss/src/apis/fastapi/workflows/router.py` | Add `/catalog/templates*` routes |
| `api/oss/src/apis/fastapi/evaluators/router.py` | Redirect catalog handlers to workflow registry (filtered by `is_evaluator`) |
| `api/oss/src/resources/evaluators/evaluators.py` | Add `schemas.inputs`, `schemas.parameters`, `flags.is_evaluator` to entries |

### G12b

| File | Change |
|------|--------|
| `api/oss/src/core/evaluators/utils.py` | Remove `build_legacy_service()`, remove `service`/`configuration` from `build_evaluator_data()`, remove `extract_outputs_schema_from_service()` |
| `api/oss/src/core/workflows/dtos.py` | Rename `validate_legacy_fields` → `normalize_legacy_fields`; populate normalized fields on read |
| `api/oss/src/core/evaluators/service.py` | Remove `extract_outputs_schema_from_service` fallback in `_normalize_simple_evaluator_data` |
| `api/oss/tests/pytest/acceptance/evaluators/test_evaluators_basics.py` | Migrate `data.service` → `data.schemas` |
| `api/oss/tests/pytest/acceptance/workflows/test_workflow_revisions_basics.py` | Migrate `data.configuration` → `data.parameters` |

---

## Constraints and Compatibility

- **`/invoke` not added**: applications and evaluators do not expose an invoke endpoint. The workflows invoke proxy is intentionally not replicated; invoke goes directly to the service URL.
- **Existing evaluator catalog endpoints** (`/preview/evaluators/catalog/*`) must not break. Response shapes stay the same; only the backing registry source changes (G12a step S13).
- **`settings_template`** stays as UI convenience metadata — not removed in this plan.
- **Simple routers** (`/simple/applications/`, `/simple/evaluators/`) are not touched — CRUD only.
- **Legacy `service`/`configuration` fields in DTOs** stay in place until a DB migration is written — they are just never written by new code (S15) and are normalized away on read (S16).
- **Data migration scripts** that call `build_evaluator_data()` automatically benefit from S15 — they will write clean data going forward.
