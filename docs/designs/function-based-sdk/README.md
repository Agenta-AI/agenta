# Function-based SDK (POC)

**Status: design proposal. None of this code runs.** This is the functional
counter-proposal to `../class-based-sdk/`. It exposes the *same* surface
(typed `Parameters`/`Inputs`/`Outputs`, lifecycle, serving, framework adapters,
config registry, testsets) without subclassing anything.

> One of three peer demos under `docs/designs/`, with aligned filenames
> (`00_*` foundation + `01_application.py` … `08_testsets.py`) so they diff 1:1:
>
> | folder | `00_*` foundation | `01`–`08` |
> |---|---|---|
> | [class-based-sdk/](../class-based-sdk/) | `00_core.py` — bases as native classes | class API |
> | [function-based-sdk/](.) (this one) | `00_core.py` — no base classes; decorators + closures | function API |
> | [functional-based-class-sdk/](../functional-based-class-sdk/) | `00_core.py` — the same bases on the functional core | class API as sugar |

Read `../class-based-sdk/` first. This folder answers one question its author
raised: **does the class earn its keep, or is it style?** The claim here is
style. The peer folder [`../functional-based-class-sdk/`](../functional-based-class-sdk/)
proves it by rebuilding the entire class API as a thin shim over this functional
core — one file per base class, each diffable against its functional sibling
here and its class-based original in `../class-based-sdk/`. The class becomes
optional sugar, not a second
system.

## The idea

The class-based proposal makes the *class* the workflow. This one keeps the
workflow a **function** — which is what it already is in today's SDK — and moves
the three things the class actually added onto the decorator and its return
value:

| class-based                          | function-based                                    |
|--------------------------------------|---------------------------------------------------|
| `class HotelAgent(ag.Application)`    | `@ag.application(...)` over a function             |
| inner `class Parameters(BaseModel)`   | a module-level `Parameters` model, passed in       |
| inner `class Inputs` / `class Outputs`| module-level models, passed in                     |
| `run()` method                        | the decorated function itself                      |
| `stream()` method                     | a second function, `@handler.stream`               |
| `__init__` for clients/retrievers     | module singletons, or a `setup=` hook              |
| `HotelAgent(parameters={...})`        | `handler.pin(**overrides)` — a `functools.partial` |
| `HotelAgent.apush()` / `.router()`    | `handler.push()` / `handler.router()`              |
| `HotelAgent.Parameters` as a type     | the `Parameters` model you already named           |

The decorator does **not** return a bare function. It returns a **handle**: a
callable object that also carries `.pin()`, `.push()`, `.router()`,
`.inspect()`, `.from_registry()`, `.fetch_parameters()`. That handle is the
functional equivalent of the class instance. `.pin()` is the constructor
builder — a partial over `parameters` — which is exactly the "constructor
builders with partials" intuition that motivated this folder.

## Why functions, concretely

- **One authoring model, not two.** The class proposal keeps decorators "as the
  quick path" *alongside* classes — two ways to author one engine. Here the
  decorator scales from "wrap my existing function" to "declare full typed
  schemas + lifecycle" by adding keyword arguments. No inheritance, no `self`,
  no "did they define a `stream` method?" introspection.
- **Schemas are declared, not inferred.** This is the real upgrade in the class
  proposal, and it has nothing to do with classes. Passing `parameters=`,
  `inputs=`, `outputs=` to the decorator gives the same explicit, validated
  schemas — the win survives the demotion from class to function.
- **No empty shells.** A config-only workflow (`07`) is `ag.configuration(...)`,
  not a class with three methods left unimplemented. A trivial evaluator (`02`)
  is four lines, no class body.
- **Partials all the way down.** Pinning config, binding to an environment, and
  serving a configured instance are all the same operation: a partial over
  `parameters`. The class spells this three different ways (`__init__`,
  `from_registry`, pinned-instance `router`); here it is one verb, `.pin()`.

## Files, in reading order

Files `01`–`08` are aligned 1:1 with the other two folders so they diff
directly. Each folder's `00_core.py` is its foundation; this folder's has no
base classes (the function form doesn't subclass), so it documents the
decorator + closure conventions instead.

0. `00_core.py` — the function form's foundation. No base classes to define;
   the foundation is the decorator plus closures: factories that keep
   `Parameters`/`Inputs`/`Outputs` private (scoped, not leaked to the module),
   selective exposure, and config-bound factories. The one part with no 1:1
   sibling in the other folders.
1. `01_application.py` — an application as a decorated function. Typed config,
   inputs, outputs; instrumentation with child spans; optional streaming;
   local calls; pinning; push.
2. `02_evaluators.py` — evaluators as functions: a heuristic check, an LLM
   judge with its own settings, a trace-based cost check, and typed builtins.
3. `03_run_evals.py` — running an evaluation with function workflows and
   pinned handles.
4. `04_config_registry.py` — fetching deployed parameters as typed objects,
   binding a handle to an environment, referencing managed configs.
5. `05_serve.py` — serving with plain FastAPI: each handle exposes a standard
   `APIRouter`, mounted with `app.include_router`.
6. `06_framework_adapters.py` — OpenAI Agents SDK, Pydantic AI, LangGraph.
   Three tiers: manual (framework inside the function), factory (a `build`
   function the decorator drives), automatic (`ag.from_agent(agent)`).
7. `07_config_only.py` — configuration-only workflows (`ag.configuration`):
   Parameters, no runnable.
8. `08_testsets.py` — testsets as functions: typed columns, validated rows,
   curation from traces, fail-fast compatibility checks.
**The punchline lives in a peer folder:**
[`../functional-based-class-sdk/`](../functional-based-class-sdk/) rebuilds the
class-based API of `../class-based-sdk/` as a thin shim over this functional
core — one base, two front-ends (`WorkflowFunction` decorator path +
`ClassFrontEnd` subclass path), split one file per kind so each diffs against
its sibling here and its class original. Both proposals, one engine, the class
shown to be cosmetics.

## What carries over from the current SDK

- `@ag.instrument()` still wraps any function for child spans. The decorated
  handler is instrumented automatically.
- The middleware chain (vault, resolver, normalizer) runs unchanged under
  `.invoke()`.
- Today's plain `@ag.application` / `@ag.evaluator` decorators are the *same*
  decorators, just taught to accept explicit schema models. Existing decorated
  functions keep working with inferred schemas.
