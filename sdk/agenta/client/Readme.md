# Agenta SDK Client

This directory contains the Fern-generated Python SDK client for Agenta's API.

## Directory Structure

```
sdk/agenta/client/
├── __init__.py          # Re-exports from backend
├── backend/             # Fern-generated SDK code
│   ├── client.py        # AgentaApi and AsyncAgentaApi clients
│   ├── types/           # Generated Pydantic models
│   └── ...              # Other generated modules
└── Readme.md            # This file
```

## Regenerating the SDK

The SDK is auto-generated from the API's OpenAPI spec using [Fern](https://buildwithfern.com/).

### Prerequisites

- Node.js and npm
- Fern CLI: `npm install -g fern-api`
- jq: `apt install jq` or `brew install jq`

### Generate SDK

```bash
# From the repository root
./sdk/scripts/setup_fern.sh

# Or with a specific OpenAPI URL
./sdk/scripts/setup_fern.sh https://cloud.agenta.ai/api/openapi.json
```

The script will:
1. Download the OpenAPI spec
2. Initialize Fern and configure the Python SDK generator
3. Generate the SDK to `backend/`
4. Fix recursive type definitions (Pydantic compatibility)
5. Clean up temporary files

### Post-Generation Fixes

The script automatically applies these fixes:

**Recursive Type Definitions**: Files like `full_json_input.py`, `full_json_output.py`, etc. contain recursive type references that cause Pydantic schema generation to fail. The script replaces self-references with `typing.Any`.

## Usage

```python
from agenta.client import AgentaApi, AsyncAgentaApi

# Sync client
client = AgentaApi(api_key="your-api-key")

# Async client
async_client = AsyncAgentaApi(api_key="your-api-key")
```

---

# Common Fern Issues with Pydantic Models

When using Fern to generate SDKs from FastAPI applications with Pydantic models, you may encounter several issues related to model naming conflicts, schema generation, and recursive type definitions.

## Issue 1: Model Name Conflicts

### Problem
Multiple Pydantic models with the same name across different modules get merged into a single schema.

### Solution
Use unique model names or Pydantic's `model_config` with custom titles:

```python
class User(BaseModel):
    model_config = ConfigDict(title="AdminUser")
    # ...
```

## Issue 2: Enum Schema Generation

### Problem
Fern inlines enum values instead of creating shared enum schemas.

### Solution
Create explicit schema models or use Field with schema customization.

## Issue 3: Recursive Type Definitions

### Problem
Self-referential types like `Dict[str, "FullJsonInput"]` cause infinite recursion during Pydantic schema generation.

### Solution
Replace recursive self-references with `Any`:

```python
# Before (causes recursion)
FullJsonInput = Union[str, Dict[str, Optional["FullJsonInput"]]]

# After (works)
FullJsonInput = Union[str, Dict[str, Any]]
```

The `setup_fern.sh` script automatically applies this fix to:
- `backend/types/full_json_input.py`
- `backend/types/full_json_output.py`
- `backend/types/label_json_input.py`
- `backend/types/label_json_output.py`

## Issue 4: Duplicate Type Declarations

### Problem
Same router mounted with different prefixes causes duplicate request types.

### Solution
Use `include_in_schema=False` for deprecated routes (see PR #3441).

## Issue 5: OperationId Collisions

### Problem
Multiple endpoints with auto-generated operationIds that collide.

### Solution
Add explicit `operation_id` parameter to routes (see PR #3441).
