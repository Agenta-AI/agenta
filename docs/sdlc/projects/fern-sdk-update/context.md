# Context

## What is Fern?
Fern generates a Python SDK client from the API's OpenAPI spec. The generated code lives in `sdk/agenta/client/backend/`.

## Generation Flow
```
FastAPI API → OpenAPI spec → Fern → Python SDK (sdk/agenta/client/backend/)
```

## Problems Found

### 1. Script Path Outdated
`sdk/scripts/setup_fern.sh` references `core/agenta-cli/agenta/client` which doesn't exist. Correct path: `sdk/agenta/client`

### 2. OpenAPI Spec Issues (FIXED in PR #3441)
- Deprecated `/preview/tracing/*` routes caused duplicate type declarations
- `start_evaluation` operationId collision between two endpoints
- Fix: Added `include_in_schema=False` and explicit `operation_id`

### 3. SDK Type Dependencies (FIXED in PR #3442)
- SDK imported `AgentaNodeDto`, `AgentaNodesResponse` from Fern-generated types
- These types aren't in the cloud API spec (internal models)
- Fix: Defined types locally in `sdk/agenta/sdk/types.py`

### 4. Recursive Type Definitions
Fern generates recursive types that break Pydantic:
- `sdk/agenta/client/backend/types/full_json_input.py`
- `sdk/agenta/client/backend/types/full_json_output.py`
- `sdk/agenta/client/backend/types/label_json_input.py`
- `sdk/agenta/client/backend/types/label_json_output.py`

Fix: Replace self-references with `typing.Any` after generation.

### 5. generators.yml Format Changed
Old: `api: path: openapi/openapi.json`
New: `api: specs: - openapi: openapi/openapi.json`

## Key Files
| File | Purpose |
|------|---------|
| `sdk/scripts/setup_fern.sh` | Generation script (needs update) |
| `sdk/agenta/client/backend/` | Fern-generated SDK code |
| `sdk/agenta/client/Readme.md` | Documents Pydantic issues |
| `sdk/agenta/client/__init__.py` | Re-exports from backend |
