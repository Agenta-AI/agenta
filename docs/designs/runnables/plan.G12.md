# Plan: G12 — Applications and Evaluators Do Not Get API Invoke/Inspect Endpoints

> Status: closed — not planned
> Date: 2026-03-17
> Gap: [gap-analysis.md § G12, G12a, G12b](./gap-analysis.md#g12-applications-and-evaluators-missing-invokinspect-endpoints)

---

## Decision

`/invoke` and `/inspect` are runtime `/services` endpoints, not API endpoints. Applications and evaluators remain filtered workflow projections at the API layer; they do not get their own runnable invoke/inspect routes.

What stays in scope:
- **G12a**: canonical workflow catalog endpoints, with application/evaluator catalog views as filtered projections
- **G12b**: removal of legacy `service` / `configuration` fields from the target revision contract

What is out of scope:
- `POST /applications/invoke`
- `POST /applications/inspect`
- `POST /evaluators/invoke`
- `POST /evaluators/inspect`
- any API-owned proxy or redirect surface that pretends runnable execution/discovery belongs to the API router family

The API service layer may still resolve references and call runtime `/services/.../invoke` or `/services/.../inspect` internally when the control plane needs live execution or discovery.

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
