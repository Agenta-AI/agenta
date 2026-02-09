# Implementation Plan: Chat Interface for Custom Workflows

## Overview

Enable custom workflows to declare `is_chat: true` so Agenta treats them as chat applications with the appropriate UI and behavior.

See `docs/design/chat-interface-rfc/research.md` for the system usage breakdown (legacy vs new) and why Phase 1 targets the legacy decorators.

## Phases

### Phase 1: Legacy System Support (Current Focus)

**Goal:** Allow custom workflows using `@ag.route`/`@ag.entrypoint` to declare `is_chat`

#### 1.1 Add `flags` Parameter to Legacy Decorators

**File:** `sdk/agenta/sdk/decorators/serving.py`

Add `flags` parameter to `route` and `entrypoint` classes (so the legacy system matches the new system interface):

```python
class route:
    def __init__(
        self,
        path: Optional[str] = "/",
        config_schema: Optional[BaseModel] = None,
        flags: Optional[dict] = None,  # NEW
    ):
        self.flags = flags or {}
        # ...
```

#### 1.2 Add `x-agenta.flags` to OpenAPI Schema

**File:** `sdk/agenta/sdk/decorators/serving.py` (in `openapi()` or `override_config_in_schema()`)

Add vendor extension to the generated OpenAPI spec:

```python
def openapi(self):
    # ... existing code ...
    
    # Add x-agenta.flags to the operation
    for path, methods in openapi_schema["paths"].items():
        if "/run" in path or "/test" in path:
            for method_data in methods.values():
                method_data["x-agenta"] = {"flags": dict(self.flags or {})}
    
    return openapi_schema
```

**Discovery contract:** the frontend checks `x-agenta.flags.is_chat === true`.

#### 1.3 Update Builtin Chat Service to Emit `x-agenta.flags.is_chat`

**File:** `services/oss/src/chat.py`

```python
@chat_route("/", config_schema=ChatConfig, flags={"is_chat": True})
async def chat(
    inputs: Optional[Dict[str, str]] = None,
    messages: Optional[List[Message]] = None,
):
    ...
```

This makes the builtin chat service a concrete dogfooding target for `x-agenta.flags` (later we can test that the frontend reads it).

The generated OpenAPI spec will include:
```yaml
paths:
  /run:
    post:
      x-agenta:
        flags:
          is_chat: true
```

#### 1.4 Verification

**Test that:**
1. `@ag.route(flags={"is_chat": True})` adds `x-agenta.flags.is_chat` to OpenAPI spec
2. Frontend can read `x-agenta.flags.is_chat` from `/openapi.json`
3. Existing workflows without `flags.is_chat` default to `false`


---

### Phase 1b: New Workflow System Support (Secondary)

**Goal:** Also support `is_chat` in the new workflow system for internal use

#### 1b.1 Add `flags` Parameter to `route` Class and Propagate It

**File:** `sdk/agenta/sdk/decorators/routing.py`

```python
class route:
    def __init__(
        self,
        path: str = "/",
        app: Optional[FastAPI] = None,
        router: Optional[APIRouter] = None,
        flags: Optional[dict] = None,  # NEW
    ):
        # ... existing code ...
        self.flags = flags  # NEW

    def __call__(self, foo: Optional[Union[Callable[..., Any], Workflow]] = None):
        if foo is None:
            return self

        workflow = auto_workflow(foo, flags=self.flags)  # Pass flags
        # ... rest unchanged ...
```

After this change, users can do:
```python
@ag.route("/", flags={"is_chat": True})
def my_chat_handler(messages):
    ...
```

#### 1b.2 Add `is_chat` to WorkflowFlags Model (Optional, for type hints)

**Files to change:**
- `sdk/agenta/sdk/models/workflows.py` - Add `is_chat: bool = False` to `WorkflowFlags`
- `api/oss/src/core/workflows/dtos.py` - Add `is_chat: bool = False` to `WorkflowFlags`

**Change:**
```python
class WorkflowFlags(BaseModel):
    is_custom: bool = False
    is_evaluator: bool = False
    is_human: bool = False
    is_chat: bool = False  # NEW
```

Note: The `flags` field in requests is `Dict[str, Any]`, so adding to `WorkflowFlags` is optional but recommended for documentation/type hints.

#### 1b.3 Regenerate Fern Client

Run `sdk/scripts/setup_fern.sh` after backend is deployed to regenerate:
- `sdk/agenta/client/backend/types/workflow_flags.py`

---

### Phase 2: Frontend Changes (Future)

**Goal:** Frontend reads `is_chat` flag and uses it for UI decisions

#### 2.1 Update Chat Detection Logic

**File:** `web/oss/src/lib/shared/variant/genericTransformer/index.ts`

Update `detectChatVariantFromOpenAISchema` to:
1. First check `x-agenta.flags.is_chat` on the OpenAPI operation (preferred)
2. Fall back to heuristic (`properties?.messages !== undefined`) for older apps

#### 2.2 Update Playground State

**File:** `web/oss/src/components/Playground/state/atoms/app.ts`

Ensure the chat mode state follows the OpenAPI-derived detection (`x-agenta.flags.is_chat` first, then heuristics) so UI switching is consistent.

#### 2.3 Update Legacy Parser

**File:** `web/oss/src/lib/helpers/openapi_parser.ts`

Keep as fallback for apps using legacy `@ag.entrypoint` decorator.

---

### Phase 3: Evaluation Behavior (Future)

**Goal:** Evaluators behave differently for chat vs non-chat outputs

#### 3.1 Read `is_chat` in Evaluation Service

**File:** `api/oss/src/services/evaluators_service.py`

Currently `validate_string_output()` extracts `.content` from dict outputs. With `is_chat` flag:
- If `is_chat: true`, apply chat-specific extraction
- Otherwise, use default behavior

---

## Implementation Order

```
Phase 1 (SDK, legacy system):
  1.1 Add `flags` to legacy `@ag.route`/`@ag.entrypoint` ──► 1.2 Emit `x-agenta.flags` in OpenAPI ──► 1.3 Update builtin chat service
                                                                                                        │
                                                                                                        ▼
                                                                                                1.4 Verification

Phase 1b (SDK, new system):
  1b.1 Add `flags` to new `@ag.route` and propagate to `auto_workflow()`

Phase 2 (Frontend):
  2.1 Read `x-agenta.flags.is_chat` for detection ──► 2.2 Wire playground state to that decision ──► 2.3 Keep legacy heuristics fallback

Phase 3 (Evaluation):
  3.1 Use chat/non-chat signal where needed (separate work)
```

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Breaking existing apps | Default `is_chat: false`, keep heuristic fallback |
| Non-JSON-serializable flags | Document: flags must be JSON-serializable; coerce/ignore invalid values |
| Partial rollout inconsistencies | Frontend prefers `x-agenta.flags` but falls back to heuristics |

## Definition of Done

### Phase 1
- [x] Legacy `@ag.route(..., flags={"is_chat": True})` is supported
- [x] Legacy OpenAPI includes `x-agenta.flags.is_chat` on the relevant operation(s)
- [x] `services/oss/src/chat.py` sets `flags={"is_chat": True}`
- [x] Documentation updated

### Phase 1b
- [x] New `@ag.route(..., flags={...})` is supported and propagated to `auto_workflow()`

### Phase 2
- [ ] Frontend reads `x-agenta.flags.is_chat` from OpenAPI
- [ ] Chat UI is shown when `is_chat: true`
- [ ] Heuristic fallback works for legacy apps
- [ ] E2E tests pass

### Phase 3
- [ ] Evaluators respect `is_chat` flag
- [ ] Chat-specific extraction logic implemented
