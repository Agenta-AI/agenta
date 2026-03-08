# Context

## Problem

The built-in code evaluator (`auto_custom_code_run`) uses a legacy interface that differs from SDK custom evaluators (`@ag.evaluator`):

```python
# Current (v1) - legacy interface
def evaluate(
    app_params: Dict[str, str],      # deprecated, always {}
    inputs: Dict[str, str],
    output: Union[str, Dict],
    correct_answer: str,             # requires correct_answer_key setting
) -> float:
```

```python
# Settled (v2) - aligned with SDK
def evaluate(
    inputs: Dict[str, Any],          # testcase data OR app inputs from trace
    outputs: Any,                    # application outputs
    trace: Dict[str, Any],           # full trace data (spans, metrics, etc.)
) -> float:
```

### Why This Matters

1. **No trace access.** Users cannot inspect spans, latency, token usage, or internals stored during execution.
2. **Confusing interface.** `app_params` is deprecated/empty. `correct_answer` requires a separate `correct_answer_key` setting. Users who learn the SDK interface must learn a different pattern for built-in evaluators.

### Why 3 Params, Not 4

The original issue proposed `(testcase, inputs, outputs, trace)` with separate `testcase` and `inputs`. After analysis, we settled on `(inputs, outputs, trace)` because:

- `inputs` already serves a **dual purpose by design**: it's `testcase.data` in batch evaluation and `trace.root_span.attributes.ag.data.inputs` in online evaluation. This allows LLM-as-a-judge (and other evaluators) to use the same templates for both modes.
- Adding a separate `testcase` param would break this symmetry — online evaluations have no testcase, so evaluators would need different logic per mode.
- `correct_answer_key` is no longer needed: users just access `inputs["correct_answer"]` directly.
- If users need the real app inputs (distinct from testcase data), they can extract them from `trace`.

## Goals

1. Add a hidden `version` setting (like LLM-as-a-judge) using string versioning (`"1"`, `"2"`)
2. Update default template and presets to use the new 3-param interface
3. Support both interfaces in the handler by branching on version
4. Backward compatibility: existing evaluators keep working unchanged (version `"1"`)
5. Update documentation

## Non-Goals

- Changing the SDK evaluator interface itself
- Migrating LLM-as-a-judge or other evaluator types
- Breaking existing user evaluator code
- Changing how `WorkflowServiceRequestData` is assembled

## Design Decisions (Settled)

### Interface: `(inputs, outputs, trace)`
- Drops `app_params` (deprecated, always `{}`)
- Drops `correct_answer` as separate param — available via `inputs["correct_answer"]`
- Adds `trace` — full OTel trace with spans, metrics, latency, token counts
- Renames `output` → `outputs` (plural, consistent with SDK)

### Versioning: Branch in existing handler (like LLM-as-a-judge)
- No new handler or URI. The handler `auto_custom_code_run_v0` reads `parameters.get("version")` and branches.
- Adding `trace` to the handler signature is harmless — NormalizerMiddleware populates it from `request.data`.
- The URI version (`:v0`) refers to the handler API version. The `parameters.version` is the user-facing interface version.

### Version values
- `"1"` (or missing) = legacy interface `(app_params, inputs, output, correct_answer)`
- `"2"` = new interface `(inputs, outputs, trace)`
- New evaluators default to `"2"`. Existing evaluators keep their version (or get `"1"` by default).

### Sandbox: Pass a `params` dict, branch by version
- The sandbox receives a single `params` dict whose shape depends on version.
- v1 params: `{"app_params": {}, "inputs": ..., "output": ..., "correct_answer": ...}`
- v2 params: `{"inputs": ..., "outputs": ..., "trace": ...}`
- Templates in `templates.py` get a `"v1"` key alongside the existing `"v0"`.
- LocalRunner branches on version for the `evaluate()` call.
