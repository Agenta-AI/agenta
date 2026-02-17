# New Evaluator Endpoints

## Overview

The new evaluator system treats evaluators as **workflows** with git-like versioning. The `SimpleEvaluator` API provides a simplified interface that abstracts the underlying workflow structure.

## Key Architectural Change

**Evaluators are now workflows identified by URIs.**

URI Format: `agenta:builtin:{evaluator_key}:v0`

Example: `agenta:builtin:auto_exact_match:v0`

The SDK has a `HANDLER_REGISTRY` that maps URIs to actual handler functions. This enables:
- Native workflow invocation via URI
- Custom evaluators with user-defined URIs (`user:custom:my_evaluator:latest`)
- Version management of evaluator implementations

## Evaluator Execution Paths

### Option 1: Legacy Run Endpoint (Maintained for Backward Compatibility)

```
POST /evaluators/{evaluator_key}/run/
```

**Request:**
```typescript
interface EvaluatorInputInterface {
    inputs: Record<string, any>    // prediction, ground_truth, etc.
    settings: Record<string, any>  // evaluator configuration
    credentials?: Record<string, any>
}
```

**Response:**
```typescript
interface EvaluatorOutputInterface {
    outputs: Record<string, any>  // score, success, etc.
}
```

**Internal Implementation (PR #3527):**
```python
async def _run_evaluator(evaluator_key: str, evaluator_input):
    # Build URI from evaluator_key
    uri = f"agenta:builtin:{evaluator_key}:v0"
    
    # Retrieve handler from SDK registry
    handler = retrieve_handler(uri)
    
    # Invoke handler directly
    result = handler(inputs=inputs, outputs=outputs, parameters=settings)
    
    return {"outputs": result}
```

### Option 2: Native Workflow Invoke Endpoint

```
POST /preview/workflows/invoke
```

**Request:**
```typescript
interface WorkflowServiceRequest {
    data: {
        inputs: Record<string, any>
        outputs?: any
        parameters?: Record<string, any>  // settings
    }
    revision?: {
        data?: {
            uri: string  // e.g., "agenta:builtin:auto_exact_match:v0"
            parameters?: Record<string, any>
        }
    }
}
```

**Response:**
```typescript
interface WorkflowServiceBatchResponse {
    data: {
        outputs: Record<string, any>
    }
    status?: {
        code: number
        message: string
    }
}
```

### Option 3: Evaluator Revision-Based Invoke

For a fully "native" approach:

1. **Fetch the evaluator revision:**
   ```
   POST /preview/evaluators/revisions/retrieve
   ```
   
2. **Get the URI from revision data:**
   ```typescript
   const uri = evaluatorRevision.data.uri  // "agenta:builtin:auto_exact_match:v0"
   ```

3. **Invoke via workflow service:**
   ```
   POST /preview/workflows/invoke
   ```

## Comparison: Which Approach to Use?

| Aspect | Legacy Run | Native Invoke | Revision-Based |
|--------|------------|---------------|----------------|
| **Simplicity** | High | Medium | Low |
| **Frontend Changes** | Minimal | Medium | Significant |
| **Architecture Alignment** | Legacy | Native | Most Native |
| **Flexibility** | Low | High | High |
| **Custom Evaluators** | Limited | Full Support | Full Support |
| **Requires URI** | No (uses key) | Yes | Yes (fetched) |

**Recommendation:** 

For the Evaluator Playground migration:
- **Short-term:** Keep using legacy `/evaluators/{key}/run/` - it works the same and the backend handles URI resolution internally
- **Long-term:** Consider migrating to native workflow invoke when supporting custom evaluators or revision-specific execution

---

## New SimpleEvaluator CRUD Endpoints

Base path: `/preview/simple/evaluators/`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/preview/simple/evaluators/` | POST | Create new evaluator |
| `/preview/simple/evaluators/{id}` | GET | Fetch evaluator by ID |
| `/preview/simple/evaluators/{id}` | PUT | Update evaluator |
| `/preview/simple/evaluators/{id}/archive` | POST | Archive (soft delete) evaluator |
| `/preview/simple/evaluators/{id}/unarchive` | POST | Restore archived evaluator |
| `/preview/simple/evaluators/query` | POST | Query evaluators with filters |

## Data Structures

### SimpleEvaluator (Response)

```python
class SimpleEvaluator:
    id: UUID
    slug: str
    
    # Lifecycle
    created_at: datetime
    updated_at: datetime
    
    # Header
    name: Optional[str]
    description: Optional[str]
    
    # Metadata
    tags: Optional[List[str]]
    meta: Optional[dict]
    
    # Flags
    flags: Optional[SimpleEvaluatorFlags]
    
    # Data (revision data)
    data: Optional[SimpleEvaluatorData]
```

### SimpleEvaluatorData (Revision Configuration)

```python
class SimpleEvaluatorData:
    # Version
    version: Optional[str]  # e.g., "2025.07.14"
    
    # Service Interface - THE KEY FIELD
    uri: Optional[str]      # e.g., "agenta:builtin:auto_exact_match:v0"
    url: Optional[str]      # For webhook evaluators
    headers: Optional[Dict[str, Union[Reference, str]]]
    
    # Schema definitions
    schemas: Optional[Dict[str, Schema]]  # e.g., {"outputs": {...}}
    
    # Configuration
    script: Optional[dict]      # For custom code: {"content": "...", "runtime": "python"}
    parameters: Optional[dict]  # Settings values (same as legacy settings_values)
    
    # Legacy fields (for backward compatibility)
    service: Optional[dict]
    configuration: Optional[dict]
```

### Output schema behavior

Frontend now sends `data.schemas.outputs` when the evaluator output shape is known at configure
time.

Schema source by evaluator type:
- fixed evaluators: `outputs_schema` from `GET /evaluators`
- `auto_ai_critique`: `parameters.json_schema.schema`
- `json_multi_field_match`: derived from configured `fields`
- evaluators with no known template schema: omit `data.schemas.outputs`

Backend builtin hydration remains as a fallback and can still fill missing schema fields for
builtin URIs.

### URI-based Handler Registry

The SDK maintains registries that map URIs to implementations:

```python
HANDLER_REGISTRY = {
    "agenta": {
        "builtin": {
            "echo": {"v0": echo_v0},
            "auto_exact_match": {"v0": auto_exact_match_v0},
            "auto_regex_test": {"v0": auto_regex_test_v0},
            # ... all built-in evaluators
        }
    },
    "user": {
        "custom": {
            # User-defined evaluators go here
        }
    }
}
```

Retrieve handler by URI:
```python
handler = retrieve_handler("agenta:builtin:auto_exact_match:v0")
```

---

## Endpoint Comparison: Old vs New (CRUD)

### List Evaluator Configs

**Old:**
```
GET /evaluators/configs/?project_id={project_id}

Response: EvaluatorConfig[]
{
    id: string
    name: string
    evaluator_key: string
    settings_values: object
    created_at: string
    updated_at: string
}
```

**New:**
```
POST /preview/simple/evaluators/query?project_id={project_id}

Request: SimpleEvaluatorQuery
{
    flags?: { is_evaluator: true }
}

Response: SimpleEvaluatorsResponse
{
    count: number
    evaluators: SimpleEvaluator[]
}
```

**Note:** For the Evaluator Registry (automatic configs), pass `flags.is_human = false` and `include_archived = false` so archived or human evaluators don't show up.

### Create Evaluator Config

**Old:**
```
POST /evaluators/configs/?project_id={project_id}

Request: NewEvaluatorConfig
{
    name: string
    evaluator_key: string
    settings_values: object
}

Response: EvaluatorConfig
```

**New:**
```
POST /preview/simple/evaluators/?project_id={project_id}

Request: SimpleEvaluatorCreateRequest
{
    evaluator: {
        slug: string       # Generated from name
        name: string
        flags: { is_evaluator: true, is_human: false }
        data: {
            uri: "agenta:builtin:{evaluator_key}:v0"
            parameters: object  # settings_values
            schemas: { outputs: object }  # Output schema
        }
    }
}

Response: SimpleEvaluatorResponse
{
    count: number
    evaluator: SimpleEvaluator
}
```

**Note:** Workflow slugs are unique per project. We append a short random suffix when generating slugs to avoid collisions when names repeat.

### Update Evaluator Config

**Old:**
```
PUT /evaluators/configs/{id}/?project_id={project_id}

Request: UpdateEvaluatorConfig
{
    name?: string
    settings_values?: object
}

Response: EvaluatorConfig
```

**New:**
```
PUT /preview/simple/evaluators/{id}?project_id={project_id}

Request: SimpleEvaluatorEditRequest
{
    evaluator: {
        id: UUID
        name?: string
        data?: {
            parameters?: object  # settings_values
        }
    }
}

Response: SimpleEvaluatorResponse
```

**Note:** `SimpleEvaluatorEdit.data` is treated as the full revision payload. When updating, include the existing `data.uri` (and any schemas) along with `data.parameters` to avoid clearing the URI.

### Delete Evaluator Config

**Old:**
```
DELETE /evaluators/configs/{id}/?project_id={project_id}

Response: boolean
```

**New:**
```
POST /preview/simple/evaluators/{id}/archive?project_id={project_id}

Response: SimpleEvaluatorResponse
```

---

## Key Differences Summary

### 1. URI-based Evaluator Identification

**Old:** `evaluator_key: "auto_exact_match"`

**New:** `uri: "agenta:builtin:auto_exact_match:v0"`

The URI enables:
- Version management (`v0`, `v1`, etc.)
- Custom evaluators (`user:custom:my_eval:latest`)
- Handler registry lookup

### 2. Settings Location

**Old:** `settings_values: { threshold: 0.5 }`

**New:** `data.parameters: { threshold: 0.5 }`

### 3. Output Schema (New)

The new model includes explicit output schemas:

```python
data.schemas = {
    "outputs": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
            "score": {"type": "number"},
            "success": {"type": "boolean"}
        }
    }
}
```

### 4. Soft Delete vs Hard Delete

- **Old:** Hard delete (`DELETE`)
- **New:** Soft delete via archive (`POST .../archive`)

### 5. Response Wrapper

**Old:** Returns data directly

**New:** Returns wrapped response: `{ count: number, evaluator: SimpleEvaluator }`

---

## Frontend Mapping Requirements

To migrate, the frontend needs to:

1. **When creating an evaluator:**
   - Generate `slug` from name
   - Build `uri` from `evaluator_key`: `"agenta:builtin:{evaluator_key}:v0"`
   - Move `settings_values` to `data.parameters`
   - Set `flags.is_evaluator = true`
   - Optionally include `data.schemas.outputs`

2. **When reading evaluators:**
   - Extract `evaluator_key` from `uri` (parse the third segment)
   - Read settings from `data.parameters`
   - Unwrap response from `{ evaluator: ... }`

3. **When updating:**
   - Include `id` in request body
   - Update `data.parameters` for settings changes

4. **When deleting:**
   - Use `POST .../archive` instead of `DELETE`

5. **When running evaluators:**
   - **Option A (Recommended):** Keep using `/evaluators/{key}/run/` - no change needed
   - **Option B (Native):** Use `/preview/workflows/invoke` with URI from revision
