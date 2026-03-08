# Research: Chat Interface Implementation

## Who Uses What?

### Key Finding: Usage Breakdown

| System | Decorators | Who Uses It |
|--------|-----------|-------------|
| **Legacy** (`serving.py`) | `@ag.entrypoint`, `@ag.route` | Custom workflows built by users, SDK templates, documentation examples, builtin services (chat/completion) |
| **New** (`routing.py`) | `@ag.workflow`, `@ag.route` | Backend API workflow orchestration, internal SDK |

**Critical Insight:** 
- **Custom workflows built by users use the LEGACY system**
- **Builtin chat/completion services also use the LEGACY system** (via `ag.create_app()`)
- The new workflow system is primarily for internal orchestration

### Evidence

**SDK Templates (all use legacy):**
- `sdk/templates/simple_prompt/app.py` - uses `@ag.entrypoint`
- `sdk/templates/compose_email/app.py` - uses `@ag.entrypoint`
- `sdk/templates/extract_data_to_json/app.py` - uses `@ag.entrypoint`

**Documentation Examples (all use legacy):**
- `docs/docs/custom-workflows/02-quick-start.mdx` - uses `@ag.route("/", config_schema=Config)`
- `examples/python/custom_workflows/chain_of_prompts/app.py` - uses `@ag.route`

**Builtin Services (use legacy via `ag.create_app()`):**
- `services/oss/src/chat.py` - uses `ag.create_app()` returning legacy `@route`
- `services/oss/src/completion.py` - uses `ag.create_app()` returning legacy `@route`

### Implication for This RFC

To enable `is_chat` for user-facing custom workflows, we must support the **legacy system** and emit an explicit discovery signal in its OpenAPI.

Decision captured in `docs/design/chat-interface-rfc/plan.md`:
- Add `flags` support to the legacy decorators
- Emit `x-agenta.flags` in legacy OpenAPI
- Align the new system to also accept `flags` on `@ag.route` for interface consistency

---

## How OpenAPI.json is Generated

### Two Systems, Two Paths

Agenta has two workflow systems with different OpenAPI generation mechanisms:

#### 1. Legacy System (`@ag.entrypoint`, `@ag.route` in `serving.py`)

**Location:** `sdk/agenta/sdk/decorators/serving.py`

**Flow:**
1. FastAPI automatically generates OpenAPI schema from endpoint definitions
2. The SDK enriches it via:
   - Type classes with `__schema_type_properties__()` method
   - Pydantic field `json_schema_extra`
   - `override_config_in_schema()` method for config fields
3. The schema is stored in `target_app.openapi_schema`

**Key Code Locations:**
```
sdk/agenta/sdk/decorators/serving.py:
  - Line 121-124: _generate_openapi()
  - Line 404-415: openapi_schema generation
  - Line 811-883: openapi() method with schema manipulation
  - Line 885-912: override_config_in_schema()

sdk/agenta/sdk/types.py:
  - Line 264-265: MessagesInput.__schema_type_properties__() returns {"x-parameter": "messages"}
  - Line 129-130: DictInput returns {"x-parameter": "dict"}
  - Line 135-136: TextParam returns {"x-parameter": "text"}
  - etc.
```

**How chat is detected (frontend):**
- `detectChatVariantFromOpenAISchema()` in `genericTransformer/index.ts` checks `properties?.messages !== undefined`
- Legacy parser in `openapi_parser.ts` checks `x-parameter === "messages"`

#### 2. New Workflow System (`@ag.workflow`, `@ag.route` in `routing.py`)

**Location:** `sdk/agenta/sdk/decorators/routing.py` and `running.py`

**Endpoints Created:**
- `POST /invoke` - Executes the workflow with `WorkflowServiceRequest`
- `GET /inspect` - Returns workflow metadata including flags

**Architecture:**
```
@ag.route("/")           
     │                   
     ▼                   
route.__call__(func) ──► auto_workflow(func) ──► workflow()(func)
     │                                               │
     │                                               ▼
     │                                          Workflow instance
     │                                          with .invoke() and .inspect()
     ▼
Creates /invoke and /inspect endpoints
```

**`@ag.route` is built ON TOP of `@ag.workflow`:**
- `@ag.workflow` provides core functionality (invoke, inspect, middleware)
- `@ag.route` adds HTTP exposure (FastAPI endpoints)

**Current Limitation:**
The `route` class does NOT accept `flags` parameter:
```python
class route:
    def __init__(
        self,
        path: str = "/",
        app: Optional[FastAPI] = None,
        router: Optional[APIRouter] = None,
        # NO flags parameter!
    ):
```

So `@ag.route(flags={"is_chat": True})` does NOT work currently.

Planned fix: add `flags` parameter to the `route` class in `sdk/agenta/sdk/decorators/routing.py` and pass it into `auto_workflow()`.

**Flags Flow (when using `@ag.workflow` directly):**
1. Define: `@ag.workflow(flags={"is_chat": True})`
2. Store: `self.flags = flags` in workflow instance
3. Inspect: `/inspect` returns `WorkflowServiceRequest(flags=self.flags)`
4. Invoke: Request flags merged with decorator flags: `{**self.flags, **request.flags}`

**Key Code Locations:**
```
sdk/agenta/sdk/decorators/routing.py:
  - Line 207-218: route class (no flags param)
  - Line 274-279: /invoke endpoint registration
  - Line 281-286: /inspect endpoint registration

sdk/agenta/sdk/decorators/running.py:
  - Line 102-182: workflow class with flags parameter
  - Line 310-322: invoke() merges flags
  - Line 383-451: inspect() returns flags in response

sdk/agenta/sdk/models/workflows.py:
  - Line 90-94: WorkflowFlags model
  - Line 242-243: WorkflowServiceRequest (flags is Dict[str, Any], not WorkflowFlags)
```

**Interface vs Configuration:**
| Aspect | `interface` | `configuration` |
|--------|-------------|-----------------|
| Purpose | **HOW** to invoke (contract) | **WHAT** values to use |
| Contains | URI, URL, headers, schemas | script, parameters |
| `interface.schemas` | JSON schemas for params/inputs/outputs | - |

**OpenAPI Generation:**
The new system uses standard FastAPI OpenAPI generation - no custom manipulation like in `serving.py`.

## WorkflowFlags Model

**Current Definition (SDK):**
```python
# sdk/agenta/sdk/models/workflows.py:90-94
class WorkflowFlags(BaseModel):
    is_custom: bool = False
    is_evaluator: bool = False
    is_human: bool = False
```

**Current Definition (API):**
```python
# api/oss/src/core/workflows/dtos.py:101-104
class WorkflowFlags(BaseModel):
    is_custom: bool = False
    is_evaluator: bool = False
    is_human: bool = False
```

**Usage Example (evaluator decorator):**
```python
# sdk/agenta/sdk/decorators/running.py:648-652
class evaluator(workflow):
    def __init__(self, ...):
        kwargs["flags"] = dict(
            is_evaluator=True,
        )
```

## How Flags Flow Through the System

1. **Developer declares workflow:**
   ```python
   @ag.workflow(flags={"is_chat": True})
   def my_chat_workflow(messages, ...):
       ...
   ```

2. **SDK stores flags in workflow instance:**
   - `running.py:161`: `self.flags = flags`

3. **`/inspect` endpoint returns flags:**
   - `running.py:424-434`: Builds `WorkflowServiceRequest` with flags

4. **Backend proxies to frontend:**
   - `api/.../workflows/service.py:760-770`: Calls `_inspect_workflow`
   - Returns `WorkflowServiceRequest` to frontend

5. **Frontend reads flags for UI decisions:**
   - Playground chat detection is OpenAPI-driven; preferred signal is `x-agenta.flags.is_chat` on the `/run` (and/or `/test`) operation.
   - Fallbacks: legacy heuristics (`properties.messages` / `x-parameter: messages`).

## Files That Need Changes

### SDK (Phase 1 - Legacy System, User-Facing)

| File | Change |
|------|--------|
| `sdk/agenta/sdk/decorators/serving.py` | Add `flags: Optional[dict]` to legacy `route` and `entrypoint` |
| `sdk/agenta/sdk/decorators/serving.py` | Emit `x-agenta.flags` on relevant OpenAPI operations |
| `services/oss/src/chat.py` | Set `flags={"is_chat": True}` on `@chat_route` |

### SDK (Phase 1b - New Workflow System, Consistency)

| File | Change |
|------|--------|
| `sdk/agenta/sdk/decorators/routing.py` | Add `flags: Optional[dict]` to new `route` and pass to `auto_workflow()` |
| `sdk/agenta/sdk/models/workflows.py` | (Optional) Add `is_chat` to `WorkflowFlags` for type hints |
| `api/oss/src/core/workflows/dtos.py` | (Optional) Add `is_chat` to API `WorkflowFlags` |
| `sdk/scripts/setup_fern.sh` | (Optional) Regenerate Fern client after backend updates |

### Frontend (Phase 2)

| File | Change |
|------|--------|
| `web/oss/src/lib/shared/variant/genericTransformer/index.ts` | Prefer `x-agenta.flags.is_chat`; fallback to `properties.messages` |
| `web/oss/src/lib/helpers/openapi_parser.ts` | Keep legacy parser fallback as needed |
| `web/oss/src/components/Playground/state/atoms/app.ts` | Ensure state uses the same detection output |

## Backward Compatibility

- **Existing apps:** no `x-agenta.flags` -> frontend falls back to heuristics.
- **Apps opting-in:** set `flags={"is_chat": True}` -> OpenAPI includes `x-agenta.flags.is_chat: true`.
- **No breaking changes:** missing `flags` behaves like `{}`.

## OpenAPI Extension (Primary Discovery Signal)

We use `x-agenta.flags` as an OpenAPI vendor extension on the operation to explicitly declare chat capability.

```yaml
paths:
  /run:
    post:
      x-agenta:
        flags:
          is_chat: true
```

Notes:
- `x-agenta.flags` is extensible (future flags can be added without changing detection shape).
- For legacy custom workflows, OpenAPI is the current discovery surface the frontend already consumes.
