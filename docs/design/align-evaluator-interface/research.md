# Research

## How the Evaluator System Works

### Architecture Overview

Evaluators are a thin wrapper around the generic **Workflow** system. `EvaluatorsService` delegates to `WorkflowsService`, converting between evaluator and workflow DTOs. Each evaluator is stored as:

```
Evaluator (artifact) -> EvaluatorVariant -> EvaluatorRevision
  └── data: { uri, url, schemas, script, parameters, service, configuration }
```

### Data Flow: From Evaluation Context to User Code

```
Testset (testcases) ──┐
                      ├──> App Invocation ──> Trace
                      │                        │
                      ▼                        ▼
              WorkflowServiceRequestData
              ├── revision:   evaluator metadata
              ├── parameters: evaluator config {correct_answer_key, code, runtime, ...}
              ├── testcase:   raw testcase blob (None in online eval)
              ├── inputs:     testcase.data OR trace inputs (see "Dual Meaning" below)
              ├── trace:      full invocation trace
              └── outputs:    root_span.attributes.ag.data.outputs
                      │
                 ResolverMiddleware (resolves handler by URI)
                      │
                 NormalizerMiddleware (maps data fields to handler params)
                      │
                      ▼
              Handler function (auto_custom_code_run_v0)
              ├── parameters -> request.data.parameters
              ├── inputs     -> request.data.inputs
              ├── outputs    -> request.data.outputs
              └── trace      -> request.data.trace  (NEW: handler now requests this)
                      │
                      ▼  (branches on parameters.version)
              ┌────────────────────────────────────────────┐
              │ v1: execute_code_safely(                   │
              │       app_params={}, inputs, output,       │
              │       correct_answer, code, runtime)       │
              │ v2: execute_code_safely(                   │
              │       inputs, outputs, trace,              │
              │       code, runtime)                       │
              └────────────────────────────────────────────┘
                      │
                 Runner (Local or Daytona)
                      │
                      ▼
              v1: User's evaluate(app_params, inputs, output, correct_answer)
              v2: User's evaluate(inputs, outputs, trace)
```

### The Dual Meaning of `inputs` (Critical Design Insight)

`inputs` in `WorkflowServiceRequestData` has intentionally different sources depending on context:

| Context | `inputs` source | Contains |
|---------|----------------|----------|
| **Batch evaluation** | `testcase.data` | All testcase columns: `{"country": "France", "correct_answer": "Paris"}` |
| **Online evaluation** | `trace.root_span.attributes.ag.data.inputs` | Actual app inputs: `{"country": "France"}` |

Assembly code:
```python
# legacy.py (batch):  inputs = testcase_data or root_span_attributes_ag_data_inputs
# live.py (online):   inputs = testcase_data or root_span_attributes_ag_data_inputs  (testcase_data=None)
```

This dual meaning is **by design** — it allows evaluators (like LLM-as-a-judge) to use the same templates and logic in both batch and online evaluation without branching. This is why we don't add a separate `testcase` parameter to the v2 interface.

### What's in `trace`

A trace is an `OTelSpansTree` serialized to dict:
```python
{
    "spans": {
        "<span_id>": {
            "name": "my_app",
            "start_time": "2025-01-15T10:30:00Z",
            "end_time": "2025-01-15T10:30:02.5Z",
            "status_code": "OK",
            "attributes": {
                "ag": {
                    "type": {"node": "agent", "tree": "agent"},
                    "data": {
                        "inputs": {"country": "France"},
                        "outputs": "The capital is Paris",
                        "internals": {...}
                    },
                    "metrics": {
                        "unit": {
                            "costs": {"total": 0.001},
                            "tokens": {"prompt": 50, "completion": 20, "total": 70},
                            "duration": {"total": 2.5}
                        },
                        "acc": {...}
                    }
                }
            },
            "children": [
                {
                    "name": "litellm_call",
                    "attributes": {...}
                }
            ]
        }
    }
}
```

### How LLM-as-a-Judge Version Flag Works (Our Model)

The `auto_ai_critique` evaluator has a `version` field:

```python
# In evaluators.py settings_template
"version": {
    "label": "Version",
    "type": "hidden",           # user never sees it
    "default": "4",
    "description": "...",
}
```

- Stored in `data.parameters.version`
- Frontend renders as `<Input type="hidden">` — invisible but preserved in form submissions
- Frontend gates features based on version (e.g., `evaluatorVersionNumber >= 4` shows `json_schema` field)
- Handler reads `parameters.get("version")` and branches behavior

### How LLM-as-a-Judge Template Variable Resolution Works

The curly template format (default for version 3+) supports three resolution schemes inside `{{ }}`:

| Syntax | Example | Engine |
|--------|---------|--------|
| Dot-notation | `{{ inputs.country }}` | `resolve_dot_notation` — walks nested dicts/lists |
| JSON Path | `{{ $.inputs.country }}` | `python-jsonpath` library |
| JSON Pointer | `{{ /inputs/country }}` | `python-jsonpath` library |

Template context is built with dual injection of inputs:
```python
context.update(**inputs)           # flattens: {{country}} works
context["inputs"] = inputs         # nested: {{inputs.country}} also works
context["outputs"] = outputs       # {{outputs}} works
context["parameters"] = parameters
```

This dual injection means both `{{country}}` (flat) and `{{inputs.country}}` (nested dot path) work in templates.

### Evaluator Templates and Presets

All defined in `api/oss/src/resources/evaluators/evaluators.py`:

**Presets** for `auto_custom_code_run`:
- `python_default` — Exact Match (Python)
- `javascript_default` — Exact Match (JavaScript)
- `typescript_default` — Exact Match (TypeScript)

**Daytona wrapper templates** in `sdk/agenta/sdk/workflows/templates.py`:
- One template per runtime (python, javascript, typescript) under `"v0"` key
- Template deserializes params, injects user code, calls `evaluate()`, prints JSON result

### Where User Code is Executed

**LocalRunner** (`sdk/agenta/sdk/workflows/runners/local.py`):
- Python only
- Uses `exec(code, environment)` then calls `environment["evaluate"](app_params, inputs, output, correct_answer)`

**DaytonaRunner** (`sdk/agenta/sdk/workflows/runners/daytona.py`):
- Python, JavaScript, TypeScript
- Wraps user code with a template from `sdk/agenta/sdk/workflows/templates.py`
- Template parses a JSON params blob, injects user code, calls `evaluate(app_params, inputs, output, correct_answer)`

### SDK `@ag.evaluator` Interface (How Custom SDK Evaluators Work)

From the SDK docs and notebook examples:
```python
@ag.evaluator(slug="exact_match")
async def exact_match(capital: str, outputs: str):
    is_correct = outputs == capital
    return {"score": 1.0 if is_correct else 0.0, "success": is_correct}
```

The NormalizerMiddleware maps:
- `outputs` → `request.data.outputs` (app output)
- `capital` → `request.data.inputs["capital"]` (looked up in inputs dict by param name)

### Current Documentation

Two documentation pages exist for evaluators:

1. **Custom Code Evaluator** (`docs/docs/evaluation/configure-evaluators/07-custom-evaluator.mdx`): Documents the v1 interface with `(app_params, inputs, output, correct_answer)`. Needs updating for v2.

2. **SDK Configuring Evaluators** (`docs/docs/evaluation/evaluation-from-sdk/04-configuring-evaluators.mdx`): Documents `@ag.evaluator` with named params + `outputs`. Shows built-in evaluators like `builtin.auto_exact_match()`, `builtin.auto_ai_critique()`, etc.

## Key Files

### Evaluator Definitions & Presets
| File | What |
|------|------|
| `api/oss/src/resources/evaluators/evaluators.py` | All evaluator registry entries, settings_template, presets |
| `api/oss/src/core/evaluators/utils.py` | `build_evaluator_data()`, evaluator type classification |
| `api/oss/src/core/evaluators/dtos.py` | DTOs: `Evaluator`, `EvaluatorRevision`, flags |

### Execution Engine
| File | What |
|------|------|
| `sdk/agenta/sdk/workflows/handlers.py` | All builtin evaluator handler implementations |
| `sdk/agenta/sdk/workflows/sandbox.py` | `execute_code_safely()` — entry point to code runners |
| `sdk/agenta/sdk/workflows/runners/local.py` | `LocalRunner` — `exec()` + `evaluate()` call |
| `sdk/agenta/sdk/workflows/runners/daytona.py` | `DaytonaRunner` — remote sandbox execution |
| `sdk/agenta/sdk/workflows/templates.py` | Daytona wrapper templates per runtime |
| `sdk/agenta/sdk/middlewares/running/normalizer.py` | Maps WorkflowServiceRequestData → handler kwargs |

### Evaluation Orchestration
| File | What |
|------|------|
| `api/oss/src/core/evaluations/tasks/legacy.py` | Batch evaluation: assembles WorkflowServiceRequestData |
| `api/oss/src/core/evaluations/tasks/live.py` | Live evaluation: assembles WorkflowServiceRequestData |
| `sdk/agenta/sdk/evaluations/preview/evaluate.py` | SDK preview evaluation |

### Frontend
| File | What |
|------|------|
| `web/.../ConfigureEvaluator/index.tsx` | Evaluator config form (already handles hidden version field) |
| `web/.../ConfigureEvaluator/DynamicFormField.tsx` | Renders `type: "hidden"` as invisible form input |
| `web/.../ConfigureEvaluator/DebugSection.tsx` | Evaluator playground / debug section |
| `web/oss/src/services/workflows/invoke.ts` | Frontend evaluator invocation |

### Documentation
| File | What |
|------|------|
| `docs/docs/evaluation/configure-evaluators/07-custom-evaluator.mdx` | Custom code evaluator docs (needs update) |
| `docs/docs/evaluation/evaluation-from-sdk/04-configuring-evaluators.mdx` | SDK evaluator docs |

### Data Models
| File | What |
|------|------|
| `sdk/agenta/sdk/models/workflows.py` | `WorkflowServiceRequestData`, `WorkflowServiceRequest` |
| `sdk/agenta/sdk/workflows/interfaces.py` | JSON Schema definitions for evaluator inputs/outputs |
