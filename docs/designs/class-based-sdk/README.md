# Class-based SDK (POC)

**Status: design proposal. None of this code runs.** This folder shows what the
authoring experience would look like if the SDK were class-oriented. The bases
the examples subclass — `ag.Application`, `ag.Evaluator`, `ag.Configuration`,
`ag.Testset` — are defined in [`00_core.py`](00_core.py), implemented natively
as classes (no functional layer underneath). That is this folder's foundation.

> One of three peer demos under `docs/designs/`, with aligned filenames
> (`00_*` foundation + `01_application.py` … `08_testsets.py`) so they diff 1:1:
>
> | folder | `00_*` foundation | `01`–`08` |
> |---|---|---|
> | [class-based-sdk/](.) (this one) | `00_core.py` — bases as **native classes** | class API |
> | [function-based-sdk/](../function-based-sdk/) | `00_core.py` — no base classes; decorators + closures | function API |
> | [functional-based-class-sdk/](../functional-based-class-sdk/) | `00_core.py` — the **same bases on the functional core** | class API as sugar |
>
> Same `01`–`08` examples everywhere; three different `00_*` foundations. The
> third folder proves the class API is sugar by rebuilding `00_core.py` on top
> of the function front-end.

## The idea

Today users author applications and evaluators by decorating plain functions. Schemas
are inferred from function signatures, and the settings/inputs/outputs contracts are
untyped dicts.

In this design, the class **is** the workflow. You subclass `ag.Application` or
`ag.Evaluator`, declare three inner Pydantic models, and implement one method. The
class compiles directly into the existing workflow data models:

| You write | It becomes |
|---|---|
| `class Parameters(BaseModel)` | `schemas.parameters` (the playground-editable config) |
| `class Inputs(BaseModel)` | `schemas.inputs` (runtime inputs / testset columns) |
| `class Outputs(BaseModel)` | `schemas.outputs` (what evaluators receive) |
| `run()` / `evaluate()` | the registered handler, auto-instrumented |
| `slug`, `name`, `description` | the workflow identity on the platform |
| `MyApp(parameters={...})` | pinned revision parameters |

Evaluators stay what they already are in the backend: workflows with
`is_evaluator=True`. The class layer is a typed front-end over `WorkflowRevision`,
not a parallel system. Instrumentation, middleware, the handler registry,
`invoke`/`inspect`, serving, and upsert all reuse the existing engine.

## Files, in reading order

1. `01_application.py` - an application as a class: typed config, inputs, outputs,
   instrumentation with child spans, optional streaming, local calls, push.
2. `02_evaluators.py` - evaluators as classes: a heuristic check, an LLM judge with
   its own settings, a trace-based cost check, and a typed builtin.
3. `03_run_evals.py` - running an evaluation with class applications and evaluators.
4. `04_config_registry.py` - pulling deployed configurations from Agenta, binding an
   instance to an environment, and referencing managed configs from other apps.
5. `05_serve.py` - serving with plain FastAPI: every class exposes a standard
   `APIRouter` (typed `/invoke` and `/inspect` endpoints), mounted with
   `app.include_router`. Streaming negotiation, auth via FastAPI dependencies,
   and a standalone ASGI/CLI path for the no-boilerplate case.
6. `06_framework_adapters.py` - bringing agents built with OpenAI Agents SDK,
   Pydantic AI, or LangGraph into Agenta. Three tiers: manual (framework
   inside `run()`), factory (implement `build()`, the base does the rest), and
   automatic (`ag.Application.from_agent(agent)`). The `AgentAdapter` port at
   the bottom is the contract all of it sits on.
7. `07_config_only.py` - configuration-only workflows (`ag.Configuration`):
   Parameters without a runnable. Prompt management generalized to any typed,
   versioned, deployable config.
8. `08_testsets.py` - testsets as classes: typed columns, validated rows,
   curation from traces, and fail-fast compatibility checks against
   application and evaluator inputs.

## What carries over from the current SDK

- `@ag.instrument()` still exists and works on any method for child spans. The
  `run`/`evaluate` methods are instrumented automatically, like decorated handlers
  are today.
- The middleware chain (vault, resolver, normalizer) runs unchanged under
  `.invoke()`.
- Decorators do not go away. They stay as the quick path for wrapping existing
  functions. Both compile to the same engine.
