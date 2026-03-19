# Runnable Catalog

## Scope

This document defines the catalog shape for runnable surfaces:

- workflows
- applications
- evaluators

The namespace is `catalog`.
The primary resource is `templates`.
The nested resource is `presets`.

So the browse model is:

- `catalog/templates`
- `catalog/templates/{template_key}`
- `catalog/templates/{template_key}/presets`
- `catalog/templates/{template_key}/presets/{preset_key}`

## Surface-Specific Routes

### Evaluators

- `GET /preview/evaluators/catalog/templates`
- `GET /preview/evaluators/catalog/templates/{template_key}`
- `GET /preview/evaluators/catalog/templates/{template_key}/presets`
- `GET /preview/evaluators/catalog/templates/{template_key}/presets/{preset_key}`

### Applications

- `GET /preview/applications/catalog/templates`
- `GET /preview/applications/catalog/templates/{template_key}`
- `GET /preview/applications/catalog/templates/{template_key}/presets`
- `GET /preview/applications/catalog/templates/{template_key}/presets/{preset_key}`

### Workflows

- `GET /preview/workflows/catalog/templates`
- `GET /preview/workflows/catalog/templates/{template_key}`
- `GET /preview/workflows/catalog/templates/{template_key}/presets`
- `GET /preview/workflows/catalog/templates/{template_key}/presets/{preset_key}`

## Why The Current Evaluator `/templates` Shape Is Wrong

Current evaluator built-ins already contain two different layers:

- template metadata
- nested presets via `settings_presets`

But the API exposes them as one flat template payload:

- `GET /preview/evaluators/templates`

That is the wrong long-term shape. The correct model is:

- catalog namespace
- template resource
- preset nested resource

## API Models

These are API-layer Pydantic models, not core models.

### Shared Query Params

For now the catalog is read-only and global-ish, but we still need explicit
request models for filtering and archived handling.

```python
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel


class WorkflowCatalogTemplateQuery(BaseModel):
    q: Optional[str] = None
    include_archived: Optional[bool] = None
    categories: Optional[List[str]] = None


class WorkflowCatalogTemplatesRequest(BaseModel):
    template: Optional[WorkflowCatalogTemplateQuery] = None


class WorkflowCatalogPresetsRequest(BaseModel):
    include_archived: Optional[bool] = None
```

The request may stay query-param based in the router, but these are the
explicit models the route should normalize to.

### Template Responses

```python
class WorkflowCatalogTemplateResponse(BaseModel):
    count: int = 0
    template: Optional["WorkflowCatalogTemplate"] = None


class WorkflowCatalogTemplatesResponse(BaseModel):
    count: int = 0
    templates: List["WorkflowCatalogTemplate"] = []
```

### Preset Responses

```python
class WorkflowCatalogPresetResponse(BaseModel):
    count: int = 0
    preset: Optional["WorkflowCatalogPreset"] = None


class WorkflowCatalogPresetsResponse(BaseModel):
    count: int = 0
    presets: List["WorkflowCatalogPreset"] = []
```

### API Resource Models

These are what the router returns.

```python
class WorkflowCatalogPreset(BaseModel):
    key: str
    name: Optional[str] = None
    description: Optional[str] = None
    archived: Optional[bool] = None
    recommended: Optional[bool] = None
    categories: Optional[List[str]] = None
    data: Optional[Dict[str, Any]] = None


class WorkflowCatalogTemplate(BaseModel):
    key: str
    name: Optional[str] = None
    description: Optional[str] = None
    archived: Optional[bool] = None
    recommended: Optional[bool] = None
    categories: Optional[List[str]] = None
    data: Optional[Dict[str, Any]] = None
```

Important point:

- the template list response should not embed full presets
- presets are fetched from the nested presets endpoint

That is one of the main differences from the current evaluator `/templates`
payload.

## Core Models

These are the internal service-layer contracts.

They should be distinct from API models even if they look similar.

```python
from typing import Any, Dict, List, Optional
from pydantic import BaseModel


class CatalogPreset(BaseModel):
    key: str
    name: Optional[str] = None
    description: Optional[str] = None
    archived: Optional[bool] = None
    recommended: Optional[bool] = None
    categories: Optional[List[str]] = None
    data: Optional[Dict[str, Any]] = None


class CatalogTemplate(BaseModel):
    key: str
    name: Optional[str] = None
    description: Optional[str] = None
    archived: Optional[bool] = None
    recommended: Optional[bool] = None
    categories: Optional[List[str]] = None
    data: Optional[Dict[str, Any]] = None


class CatalogTemplateDetail(CatalogTemplate):
    presets: List[CatalogPreset] = []
```

### Why separate core models from API models

- core models represent internal catalog facts
- API models represent transport shape
- API may choose not to expose all internal fields
- API list endpoints should avoid embedding preset bodies by default

So the preferred service shape is:

- `list_templates(...) -> List[CatalogTemplate]`
- `get_template(...) -> Optional[CatalogTemplateDetail]`
- `list_presets(...) -> List[CatalogPreset]`
- `get_preset(...) -> Optional[CatalogPreset]`

Not:

- one giant template object with `settings_presets` always embedded

## No Stencil Layer

The catalog should not introduce a separate stencil or transform layer.

Instead:

- template `data.schemas`
  remains the canonical contract
- preset `data`
  must already be expressible directly in that canonical contract

That means the canonical runnable schemas need to expose the user-facing
concepts directly, rather than expecting catalog-specific transforms.

For matcher-style evaluators, that implies first-class fields and modes such as:

- `exact`
- `starts_with`
- `ends_with`
- `contains`
- `references`
- `match = "all" | "any"`

So a `contains_any` preset can stay plain runnable `data`, for example:

```json
{
  "parameters": {
    "mode": "contains",
    "references": ["foo", "bar", "baz"],
    "match": "any",
    "case_sensitive": true
  }
}
```

This is the simpler catalog contract:

- no preset-local transform system
- no separate stencil resource
- presets remain plain runnable payloads
- the underlying runnable schemas carry the real UX concepts directly

## Evaluator Mapping From Current Registry

Current registry source:

- `api/oss/src/resources/evaluators/evaluators.py`

Current evaluator registry item roughly contains:

- template fields:
  - `key`
  - `uri` (derived today for evaluators)
  - `name`
  - `archived`
  - `tags`
  - `settings_template`
  - `outputs_schema`
- preset fields:
  - `settings_presets`

So evaluator migration should be:

```python
class EvaluatorTemplateRegistryEntry(BaseModel):
    key: str
    name: str
    archived: bool = False
    tags: List[str] = []
    data: Optional[Dict[str, Any]] = None
    settings_template: Dict[str, Any]
    outputs_schema: Optional[Dict[str, Any]] = None
    settings_presets: Optional[List[Dict[str, Any]]] = None
```

Then transform to core models:

- one registry entry -> one `CatalogTemplate`
- `settings_presets[]` -> `CatalogPreset[]`

Normalization rules:

- registry `tags` become catalog `categories`
- `settings_template` + `outputs_schema` move under template `data.schemas`
  - `data.schemas.parameters` = normalized former `settings_template`
  - `data.schemas.outputs` = normalized former `outputs_schema`
- template `data.uri` is explicit catalog metadata
- preset payloads are expressed as `data`, not legacy `values`

## Field Semantics: Current Reality

This section records what these fields mean today in BE/FE, so we do not
accidentally document aspirational metadata as if it already existed.

### `direct_use`

Current status:

- real field in the evaluator registry
- effectively backend-only today

Current behavior:

- used to auto-create default evaluator configs for new projects
- not meaningfully consumed by the frontend UI today

Current backend use:

- `api/oss/src/services/db_manager.py`
- `api/oss/databases/postgres/migrations/core/data_migrations/projects.py`

Catalog implication:

- should not be part of the catalog models
- should move to a separate default-template/default-evaluators list keyed by
  template keys

### `requires_llm_api_keys`

Current status:

- real field in backend registry
- real field in frontend normalization and display logic

Catalog implication:

- should not be part of the catalog models
- credential handling belongs to backend/runtime behavior, not template browse
  metadata

### `runtime`

Current status:

- not currently a universal catalog field
- currently appears as evaluator configuration/settings data, especially for
  code evaluators

Current behavior:

- code evaluators use runtime values like `python`, `javascript`,
  `typescript`
- frontend reads runtime from evaluator parameters for code-editing UI

Current sources:

- evaluator presets/settings in `api/oss/src/resources/evaluators/evaluators.py`
- UI usage in
  `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/DynamicFormField.tsx`

Catalog implication:

- do not model `runtime` as a universal top-level catalog field
- runtime belongs inside preset `data` when applicable, and may also appear in
  template `schemas.parameters`

### `supports_traces`

Current status:

- not an implemented field today

Current closest source:

- evaluator registry field `requires_trace`

Current behavior:

- evaluators currently describe trace requirements with values like `always`
  and `never`

Catalog implication:

- `supports_traces` would be a normalized derived field
- it should be derived from current capability/requirement metadata, not treated
  as a native existing source field

### `supports_ground_truth`

Current status:

- not an implemented field today

Current closest sources:

- evaluator registry field `requires_testcase`
- `ground_truth_key=True` markers inside `settings_template`

Current behavior:

- backend seeding/default logic also inspects `ground_truth_key`

Catalog implication:

- `supports_ground_truth` would also be a normalized derived field
- it should not be described as native source data yet

### `category`

Current status:

- not a stable backend evaluator registry field today
- partially inferred in frontend logic

Current frontend behavior:

- frontend tries to infer evaluator category from:
  - `meta.category`
  - `meta.slug`
  - `meta.type`
  - `flags.category`
  - tags
  - `requires_llm_api_keys`
  - fallback key/name matching

Current frontend use:

- `web/oss/src/components/pages/evaluations/onlineEvaluation/utils/evaluatorDetails.ts`

Catalog implication:

- use `categories` in the catalog, not `category`
- current evaluator `tags` should be normalized into catalog `categories`
- frontend category inference should stop once the catalog serves explicit
  categories

### `tags`

Current status:

- real field today

Current behavior:

- evaluator registry already contains tags like `classifiers`, `similarity`,
  `custom`, `rag`
- frontend reads and normalizes tags from multiple shapes

Current frontend use:

- `web/oss/src/services/evaluators/index.ts`
- `web/oss/src/state/evaluators/atoms.ts`
- `web/oss/src/components/pages/evaluations/onlineEvaluation/utils/evaluatorDetails.ts`

Catalog implication:

- do not expose `tags` in the catalog models
- normalize current source tags into catalog `categories`

## Field Recommendation For Catalog Models

### Keep as first-class fields now

- `categories`

### Keep outside the catalog as operational metadata

- `direct_use`

### Add only if we explicitly normalize them

- `supports_traces`
- `supports_ground_truth`
- `categories` for non-evaluator surfaces when source metadata is available

### Do not expose in catalog models

- `requires_llm_api_keys`
- `tags`
- `runtime` as a top-level field

## Concrete Evaluator API Shapes

### `GET /preview/evaluators/catalog/templates`

Response:

```python
class EvaluatorCatalogTemplatesResponse(BaseModel):
    count: int = 0
    templates: List[EvaluatorCatalogTemplate] = []
```

Example item:

```json
{
  "key": "auto_ai_critique",
  "name": "LLM-as-a-judge",
  "archived": false,
  "recommended": true,
  "categories": ["llm_judge"],
  "data": {
    "uri": "agenta:builtin:auto_ai_critique:v0",
    "schemas": {
      "parameters": {},
      "outputs": {}
    }
  }
}
```

### `GET /preview/evaluators/catalog/templates/{template_key}`

Response:

```python
class EvaluatorCatalogTemplateResponse(BaseModel):
    count: int = 0
    template: Optional[EvaluatorCatalogTemplate] = None
```

### `GET /preview/evaluators/catalog/templates/{template_key}/presets`

Response:

```python
class EvaluatorCatalogPresetsResponse(BaseModel):
    count: int = 0
    presets: List[EvaluatorCatalogPreset] = []
```

Example item:

```json
{
  "key": "hallucination",
  "name": "Hallucination Detection",
  "archived": false,
  "recommended": true,
  "categories": ["llm_judge"],
  "data": {
    "uri": "agenta:builtin:auto_ai_critique:v0",
    "parameters": {
      "prompt_template": [],
      "model": "gpt-4o-mini"
    }
  }
}
```

### `GET /preview/evaluators/catalog/templates/{template_key}/presets/{preset_key}`

Response:

```python
class EvaluatorCatalogPresetResponse(BaseModel):
    count: int = 0
    preset: Optional[EvaluatorCatalogPreset] = None
```

Note:

- keep the single preset route for parity with the tools catalog nested-detail
  pattern
- even if preset list/detail initially return the same shape, the dedicated
  route leaves room for later divergence without changing the route tree

## Open Questions

### 1. Should template detail embed presets?

My recommendation: no.

Reason:

- tools catalog does not collapse nested resources into parent detail by default
- keeping presets separate is cleaner
- avoids oversized list/detail payloads

If needed later, we can add:

- `include_presets=true`

but not as the default shape.

### 2. Should `settings_template` and `outputs_schema` stay as top-level fields?

No.

They should be normalized into:

- `schemas.parameters`
- `schemas.outputs`

The exact inner schema typing can stay permissive for now, but the top-level
catalog contract should already use `schemas`.

### 3. Should `/preview/evaluators/templates` stay?

Yes, temporarily.

But it should become a compatibility endpoint over the new template/preset
pipeline, not the primary API shape.

## Recommendation

For evaluators specifically, the immediate target should be:

- keep the static registry as the source of truth
- add `catalog/templates` endpoints
- split template and preset responses
- normalize source `tags` into catalog `categories`
- normalize source `settings_template` and `outputs_schema` into catalog
  `schemas`
- stop treating one template object with embedded `settings_presets` as the
  canonical shape
- stop exposing `direct_use` and `requires_llm_api_keys` in the catalog
- model preset payloads as runnable `data`, not legacy `values`

Then use the same catalog pattern for:

- workflows
- applications
- evaluators
