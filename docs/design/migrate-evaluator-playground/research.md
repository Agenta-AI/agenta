# Research Notes: Evaluator Execution Architecture

## Findings from PR #3527 Investigation

### Discovery: Native Evaluator Execution Path

The new architecture treats evaluators as workflows with URI-based identification. The key discovery is that even the legacy `/evaluators/{key}/run/` endpoint now uses the native handler registry internally.

### Handler Registry Architecture

The SDK maintains a global registry of workflow handlers:

**Location:** `sdk/agenta/sdk/workflows/utils.py`

```python
HANDLER_REGISTRY = {
    "agenta": {
        "builtin": {
            "echo": {"v0": echo_v0},
            "auto_exact_match": {"v0": auto_exact_match_v0},
            "auto_regex_test": {"v0": auto_regex_test_v0},
            "field_match_test": {"v0": field_match_test_v0},
            "json_multi_field_match": {"v0": json_multi_field_match_v0},
            "auto_webhook_test": {"v0": auto_webhook_test_v0},
            "auto_custom_code_run": {"v0": auto_custom_code_run_v0},
            "auto_ai_critique": {"v0": auto_ai_critique_v0},
            # ... more evaluators
        }
    },
    "user": {
        "custom": {
            # Custom user evaluators
        }
    }
}
```

**URI Format:** `provider:kind:key:version`

Examples:
- `agenta:builtin:auto_exact_match:v0`
- `user:custom:my_custom_eval:latest`

**URI Parsing:**
```python
def parse_uri(uri: str) -> Tuple[provider, kind, key, version]:
    # "agenta:builtin:echo:v0" → ("agenta", "builtin", "echo", "v0")
```

### How the Legacy Run Endpoint Works Now (PR #3527)

**File:** `api/oss/src/routers/evaluators_router.py`

The PR changed the implementation to use the native handler registry:

```python
@router.post("/{evaluator_key}/run/", response_model=EvaluatorOutputInterface)
async def evaluator_run(request: Request, evaluator_key: str, payload: EvaluatorInputInterface):
    # ... auth setup ...
    result = await _run_evaluator(evaluator_key, payload)
    return result

async def _run_evaluator(evaluator_key: str, evaluator_input: EvaluatorInputInterface):
    # Build URI from evaluator_key
    uri = f"agenta:builtin:{evaluator_key}:v0"
    
    # Retrieve the handler from SDK registry
    handler = retrieve_handler(uri)
    if handler is None:
        raise NotImplementedError(f"Evaluator {evaluator_key} not found (uri={uri})")
    
    # Extract data from evaluator_input
    inputs = evaluator_input.inputs or {}
    settings = evaluator_input.settings or {}
    outputs = inputs.get("prediction", inputs.get("output"))
    
    # Build kwargs based on handler signature
    sig = inspect.signature(handler)
    kwargs = {}
    if "parameters" in sig.parameters:
        kwargs["parameters"] = settings
    if "inputs" in sig.parameters:
        kwargs["inputs"] = inputs
    if "outputs" in sig.parameters:
        kwargs["outputs"] = outputs
    
    # Invoke the handler
    result = handler(**kwargs)
    if inspect.iscoroutine(result):
        result = await result
    
    return {"outputs": result}
```

**Key Insight:** The legacy endpoint is now a thin wrapper that:
1. Builds the URI from the evaluator_key
2. Looks up the handler in the registry
3. Invokes it directly

### Native Workflow Invoke Path

For fully native execution, there's also a generic workflow invoke endpoint:

**Endpoint:** `POST /preview/workflows/invoke`

**Request Structure:**
```python
class WorkflowServiceRequest:
    data: WorkflowServiceRequestData  # inputs, outputs, parameters
    revision: Optional[dict]           # contains URI in data.uri
```

**How Batch Evaluations Use It:**

**File:** `api/oss/src/core/evaluations/tasks/legacy.py` (lines 1185-1228)

```python
workflow_service_request_data = WorkflowServiceRequestData(
    inputs=inputs,
    outputs=outputs,
    #
    parameters=evaluator_reference.get("configuration"),  # settings
)

workflow_service_request = WorkflowServiceRequest(
    data=workflow_service_request_data,
    #
    environment=environment,
    revision=evaluator_reference.get("revision"),  # contains URI
)

await workflows_service.invoke_workflow(
    project_id=project_id,
    user_id=user_id,
    request=workflow_service_request,
)
```

### Implications for Frontend Migration

#### For Evaluator CRUD (Create/Read/Update/Delete)

**Must migrate to new endpoints** because:
- Legacy endpoints now call SimpleEvaluator endpoints internally
- Data is stored in new workflow-based format
- Frontend should use native API to avoid translation overhead

#### For Evaluator Run (Testing in Playground)

**Options:**

1. **Keep using `/evaluators/{key}/run/`** (Recommended for now)
   - Simplest approach
   - Endpoint still works
   - Internally uses native path
   - No frontend changes needed

2. **Use native workflow invoke**
   - Requires building `WorkflowServiceRequest`
   - Need to include evaluator revision with URI
   - More complex but more "correct"
   - Enables custom evaluator support

3. **Hybrid approach**
   - Use legacy endpoint for built-in evaluators
   - Use native invoke for custom evaluators (which will have custom URIs)

### Questions Resolved

**Q: Why does the legacy run endpoint remain unchanged?**

A: It's not unchanged internally - PR #3527 refactored it to use the native handler registry. But the external interface (URL, request/response format) is preserved for backward compatibility.

**Q: Is there a "native" way to run evaluators?**

A: Yes, via the workflow invoke endpoint with `WorkflowServiceRequest` containing the evaluator's URI. But for the playground, the legacy endpoint is simpler and equivalent.

**Q: Should we migrate the run endpoint usage?**

A: Not necessarily. The benefits of migrating would be:
- Consistency with new architecture
- Support for custom evaluators with custom URIs
- Ability to run specific evaluator revisions

But the costs are:
- More complex payload construction
- Need to fetch evaluator revision to get URI
- No immediate user-facing benefit

**Recommendation:** Keep using legacy run endpoint for now, plan native invoke for custom evaluator feature.

## Note on "Qdrant changes"

Within this repository, Qdrant appears in examples and cookbook/tutorial code (e.g., `examples/python/*`, `docs/docs/tutorials/*`), but not in the core evaluator/workflow execution path under `api/oss/src`.

Implication for this migration:
- Migrating the evaluator playground to `/preview/workflows/invoke` does not require any Qdrant-specific frontend changes.
- Any Qdrant-related behavior is part of the *application/workflow being evaluated* (e.g., a RAG app calling Qdrant), and would surface only through normal workflow invocation inputs/outputs/traces.

---

## Related Files Analyzed

- `api/oss/src/routers/evaluators_router.py` - Legacy endpoints (now with native internals)
- `api/oss/src/apis/fastapi/evaluators/router.py` - New SimpleEvaluators router
- `api/oss/src/apis/fastapi/workflows/router.py` - Workflow invoke endpoint
- `api/oss/src/core/workflows/service.py` - Workflow invocation service
- `api/oss/src/core/evaluations/tasks/legacy.py` - Batch evaluation using native invoke
- `sdk/agenta/sdk/workflows/utils.py` - Handler registry and URI parsing
- `sdk/agenta/sdk/workflows/interfaces.py` - Evaluator interfaces (schemas)
- `sdk/agenta/sdk/workflows/handlers.py` - Actual evaluator implementations
