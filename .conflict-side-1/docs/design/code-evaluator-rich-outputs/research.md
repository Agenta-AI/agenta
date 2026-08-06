# Research: How Code Evaluators Work Today

All paths are relative to the repo root. Line numbers are from June 2026; treat them as
anchors, not exact references.

## The execution flow, end to end

A "code evaluator" is an evaluator revision whose `parameters` hold the code as a
string, plus `runtime`, `version`, `correct_answer_key`, and `threshold`. The catalog
entry is "Code Evaluation", key `auto_custom_code_run`
(`api/oss/src/resources/evaluators/evaluators.py:310`).

1. **Playground run.** The frontend executes evaluators through
   `executeWorkflowRevision` (`web/packages/agenta-playground/src/executeWorkflowRevision.ts`),
   which posts to `POST /services/invoke` with the URI
   `agenta:builtin:auto_custom_code_run:v0` plus inputs and parameters.
2. **Services container.** `services/entrypoints/main.py:82` receives the request and
   dispatches into the SDK's running engine (the services container imports the SDK,
   so "SDK code" here runs server-side).
3. **Handler.** `auto_custom_code_run_v0`
   (`sdks/python/agenta/sdk/engines/running/handlers.py:728`) validates parameters and
   calls `execute_code_safely`
   (`sdks/python/agenta/sdk/engines/running/sandbox.py:9`).
4. **Runner.** `execute_code_safely` dispatches to one of three runners picked by the
   `AGENTA_SERVICES_CODE_SANDBOX_RUNNER` env var
   (`sdks/python/agenta/sdk/engines/running/runners/registry.py:21`):
   - `restricted` (default): in-process RestrictedPython sandbox (`runners/restricted.py`)
   - `local`: raw `exec()` for trusted deployments (`runners/local.py`)
   - `daytona`: remote sandbox, the only one supporting JS/TS (`runners/daytona.py`)
5. **Float enforcement (the bug).** Every runner coerces the result to float and
   raises otherwise:
   - `restricted.py:162-171` and `local.py:63-72`:
     ```python
     if isinstance(result, (float, int, str)):
         result = float(result)
     if not isinstance(result, float):
         raise TypeError(f"Result is not a float after conversion: {type(result)}")
     ```
     The generic `except` then wraps it as
     `RuntimeError(f"Error during code execution: {e}")`. That is the exact error the
     user sees.
   - `daytona.py:412-447` only extracts float/int from the sandbox's JSON output.
   - The JS/TS/Python wrapper templates
     (`sdks/python/agenta/sdk/engines/running/templates.py`) also coerce to
     float/Number before printing `{"result": ...}`, so dicts die inside the sandbox
     too.
6. **Handler normalization (already dict-ready).** After the runner returns, the
   handler tail (`handlers.py:846-857`) does:
   - number → `{"score": x, "success": x >= threshold}`
   - bool → `{"success": x}`
   - **dict or str → passed through unchanged**

   The dict branch is unreachable today for code evaluators because the runner raises
   first. The same normalization tail is live and working for `auto_webhook_test_v0`
   (`handlers.py:715-724`) and `auto_ai_critique_v0` (`handlers.py:1065-1077`), which
   both return dicts in production.

## Output schemas and the metrics pipeline

The float limit is not the only blocker. The catalog pins the declared output schema:

- `_FIXED_OUTPUT_SCHEMA_BY_KEY["auto_custom_code_run"]` is
  `{"score": number, "success": boolean}` with `additionalProperties: False`
  (`api/oss/src/resources/evaluators/evaluators.py:858-869`).
- When a user creates a code evaluator, `build_evaluator_data` writes that same pinned
  schema into the evaluator revision (`api/oss/src/core/evaluators/utils.py:57-74`).

The metrics pipeline consumes that schema:

- For each annotation step, the evaluations service fetches the evaluator revision and
  reads `data.schemas.outputs` (`api/oss/src/core/evaluations/service.py:1436-1463`).
- `get_metrics_keys_from_schema` (`api/oss/src/core/evaluations/utils.py:180-219`)
  walks the schema **recursively**, emitting one metric key per leaf with a dotted
  path and a type (number → numeric/continuous, boolean → binary, string with enum →
  categorical, plain object → json). Nested dicts are supported.
- If a revision has **no** declared outputs schema, the service **infers one from the
  traces** (`_infer_evaluator_schema_from_traces`, `service.py:1626`) and rewrites the
  run mappings. So even undeclared multi-key outputs become metrics.

Two evaluators already exercise this multi-metric path:

- `json_multi_field_match` returns `{"<field>": 0|1, ..., "aggregate_score": x}`
  (`handlers.py:503-612`). Its output schema is built dynamically from its settings:
  one number property per configured field (`core/evaluators/utils.py:44-55`).
- `auto_ai_critique` with `response_type: json_schema` returns whatever dict the LLM
  produces, and the user's `json_schema` setting becomes the revision's outputs schema
  (`core/evaluators/utils.py:39-42`).

## Frontend

- The playground renders evaluator results with `EvaluatorFieldGrid`
  (`web/packages/agenta-playground-ui/src/components/shared/EvaluatorFieldGrid/`). It
  extracts `[key, value]` entries from `response.data.outputs` (falling back to
  `response.outputs`, then `response`) and renders one row per key, schema-aware via
  output ports derived from the revision's outputs schema. Multi-field outputs from
  AI critique and json_multi_field_match render through this today.
- Errors surface through `ExecutionResultView`'s `ErrorContent`
  (`web/packages/agenta-playground-ui/src/components/ExecutionResultView/index.tsx`),
  which displays the server's error string directly. That is where the user reads
  "Result is not a float after conversion".
- The code editor for the snippet is `CodeEditorControl`
  (`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/CodeEditorControl.tsx`),
  driven by the `code` settings field in the catalog whose default template is typed
  `-> float` (`evaluators.py:364`).

## The SDK story and interchangeability today

Two different things are both called "custom evaluator":

1. **UI code evaluators**: a code string in `parameters.code` of an evaluator
   revision, executed by the sandbox runners above.
2. **SDK evaluators**: any Python function decorated with `@ag.evaluator`
   (`sdks/python/agenta/sdk/decorators/running.py:714`). The evaluations runtime
   treats its return value as opaque. Dicts already work; metrics come from the same
   trace-inference path.

Where they meet:

- Both are stored as workflow/evaluator revisions (`WorkflowRevisionData` carries
  `uri`, `script`, `runtime`, `parameters`, `schemas`). UI code evaluators carry code
  in parameters; SDK evaluators carry a `uri` pointing at a handler.
- The SDK can fetch a platform-stored code evaluator
  (`/evaluators/revisions/retrieve`, see `sdk/managers/evaluators.py`) and run it
  **locally** through the same `auto_custom_code_run` handler and sandbox. So the
  float limit binds there too, and fixing the runners fixes both.
- The SDK does not currently call the platform to run a stored code evaluator
  remotely. `POST /services/invoke` exists and is what the playground uses, but the
  SDK has no public helper wrapping it for evaluators.
- The reverse direction does not exist: the platform cannot execute an
  `@ag.evaluator` function because the code lives in the user's environment.

So the user's mental model ("UI and SDK evaluators are interchangeable") holds at the
storage level and partially at the local-execution level, but not for remote
invocation, and the float limit breaks output-shape parity.

## Why the float limit exists

It is a leftover from the legacy evaluation system, where `evaluate()` fed a single
score column. The v2 interface work (see
[align-evaluator-interface](../align-evaluator-interface/)) modernized the signature
but deliberately kept the return contract. The docs
(`docs/docs/evaluation/configure-evaluators/07-custom-evaluator.mdx:36-39`) promise
only float and bool returns.

## Tests that pin the current behavior

- `sdks/python/oss/tests/pytest/utils/test_restricted_runner.py` asserts float
  returns, int/bool coercion, and (implicitly) the dict rejection.
- `sdks/python/oss/tests/pytest/utils/test_code_v0.py` asserts the handler
  normalization (number → score+success, bool → success). No dict-return tests exist.

## Summary of the actual blockers

| Layer | State | Work needed |
|-------|-------|-------------|
| Runners (restricted, local, daytona) + wrapper templates | Reject non-float | Yes, the core change |
| Handler `auto_custom_code_run_v0` | Passes dicts through | None (maybe validation) |
| Declared outputs schema (catalog + `build_evaluator_data`) | Pinned to score+success, `additionalProperties: False` | Yes, must become flexible |
| Metrics aggregation | Multi-key, nested, plus trace inference | None |
| Playground result rendering | Renders arbitrary keys | Verify only |
| Docs + default code template | Promise `-> float` | Update |
| SDK local run of UI evaluators | Same handler/runners | Fixed by the runner change |
| SDK remote run of UI evaluators | No public helper | Optional new scope |
