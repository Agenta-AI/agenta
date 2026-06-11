# functional-based-class SDK (POC) — demo #3 of three

One of three peer demos under `docs/designs/`, with aligned filenames (`00_*`
foundation + `01_application.py` … `08_testsets.py`) so they diff 1:1:

| folder | `00_*` foundation | `01`–`08` |
|---|---|---|
| [class-based-sdk/](../class-based-sdk/) | `00_core.py` — bases as native classes | **#1** class API, native |
| [function-based-sdk/](../function-based-sdk/) | `00_core.py` — no base classes; decorators + closures | **#2** function API, native |
| this folder | `00_core.py` — the **same bases on the functional core** | **#3** class API as sugar |

Same `01`–`08` examples in all three; three different `00_*` foundations. This
folder's `00_core.py` rebuilds #1's bases on #2's function front-end, proving the
class is sugar.

## The claim

There is **one** workflow base and **two** authoring front-ends over it:

```text
                    Workflow                 (the one base — wraps a handler,
                       │                      holds flags + compiled schemas)
        ┌──────────────┴──────────────┐
 WorkflowFunction               ClassFrontEnd
 (decorator authoring)          (subclass authoring)
      │                              │
 ag.application                 ag.Application      is_application flag
 ag.evaluator                   ag.Evaluator        is_evaluator flag
 ag.configuration               ag.Configuration    has_handler = False
```

The class front-end does not register anything itself. Its `__init_subclass__`
reads the inner models + handler method off your class and **calls
`WorkflowFunction`**, which gathers exactly what a decorator gathers and builds
the one `Workflow`. So: **class authoring → function authoring → one base.**
That chain — all in [`00_core.py`](00_core.py) — is the whole argument.

Grounded in the real SDK: `decorators/running.py` already has a `Workflow` that
wraps a function; `models/workflows.py::WorkflowFlags` already encodes kind
(`is_application`, `is_evaluator`, `has_handler`) as flags. So this isn't
invented structure — it's the structure the SDK already has, surfaced.

## Layout

Filenames are aligned 1:1 with the other two folders (`01_application.py` …
`08_testsets.py`), so each file diffs directly against its siblings. The shared
machinery that has no counterpart lives in `00_core.py`.

| File | Shows | 1:1 sibling in #1 and #2 |
|---|---|---|
| `00_core.py` | `Workflow` + `WorkflowFunction` + `ClassFrontEnd` + `Testset` (the engine) | — (no counterpart; the "extra") |
| `01_application.py` | `ag.Application` | `01_application.py` |
| `02_evaluators.py` | `ag.Evaluator` | `02_evaluators.py` |
| `03_run_evals.py` | using handles in evals | `03_run_evals.py` |
| `04_config_registry.py` | fetch/bind/reference | `04_config_registry.py` |
| `05_serve.py` | routers | `05_serve.py` |
| `06_framework_adapters.py` | manual tier on the shim | `06_framework_adapters.py` |
| `07_config_only.py` | `ag.Configuration` | `07_config_only.py` |
| `08_testsets.py` | `ag.Testset` (not a Workflow) | `08_testsets.py` |

Each `01`–`08` file has two parts:

- **PART A** — binds the front-end from `00_core.py` onto `ag`. Nearly empty,
  because the work lives in the shared core, not per kind. (`03`/`05` need no
  bind — they only consume handles imported from `01`/`02`.)
- **PART B** — the class-based example from `../class-based-sdk/NN_*.py`, pasted
  **verbatim**, running on PART A. It does not know it is sugar.

## What the structure makes visible

- **`01` vs `02`**: in `00_core.py`, `Evaluator` differs from `Application` by
  one word (`_handler_name = "evaluate"`) and one flag (`is_evaluator`). That is
  the entire "evaluators are a different class" story.
- **`07`**: `Configuration` is `_handler_name = None` + `has_handler=False`. No
  runnable, nothing to leave unimplemented — why the functional
  `ag.configuration(...)` is cleaner than an empty class body.
- **`08`**: `Testset` is **not** a `Workflow` and does not go through
  `WorkflowFunction` at all. It has no parameters/handler/schemas-triple and is
  absent from `WorkflowFlags`, so it gets its own small base. The hierarchy
  matches the data model instead of papering over it.

## Files 03, 04, 05, 06 have no shim

They define **no** base class — they only *use* handles (`aevaluate`, `router`,
`from_registry`, `from_agent`). Compare those folder-to-folder directly:
`../function-based-sdk/03_run_evals.py` ↔ `../class-based-sdk/03_run_evals.py`,
and so on. Consuming a handle is the same whether it came from a decorator or a
class.

## The conclusion

The class front-end is an `__init_subclass__` that forwards into the function
front-end, which builds the one `Workflow`. It adds an authoring style — a
`class` statement, `self`, inner-model indentation, method-vs-function lookup —
and nothing else: no engine, no capability, no type. Ship the function
front-end; offer the class front-end if users want it. Both are the same base.
