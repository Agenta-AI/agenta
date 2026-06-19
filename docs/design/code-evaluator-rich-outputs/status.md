# Status

**Last updated:** 2026-06-10

## Current state

Implemented and verified end to end on the dev deployment. Version "3" of the
code evaluator interface accepts rich (JSON-serializable) returns. All SDK and
API unit tests pass. In review as
[PR #4626](https://github.com/Agenta-AI/agenta/pull/4626) targeting
`release/v0.103.0`.

## Verified on the dev stack (2026-06-10, port 8280)

- New-evaluator dialog serves the v3 dict template and version "3" defaults
  (required restarting the api and services containers: the SDK is bind-mounted
  but uvicorn reload does not watch /sdks/python).
- A draft v3 code evaluator returning a dict runs without the float error, and
  the playground result card shows every key (Score and Success), not just Score.
- A committed v2 evaluator still renders both declared fields correctly.

## Display bug found and fixed during verification

Symptom: the trace held `{"score": 0, "success": false}` but the evaluator
playground card showed only `Score: 0`.

Root cause: two pieces colliding. `outputPortsAtomFamily`
(`web/packages/agenta-entities/src/workflow/state/molecule.ts`) falls back to a
single synthesized `score` port when an evaluator declares no outputs schema
(which v3 code evaluators never do), and the downstream evaluator card in
`SingleLayout.tsx` (`web/packages/agenta-playground-ui/.../ExecutionRow/`)
deliberately filters displayed entries to port keys (added to hide
backend-injected fields for schema-declared evaluators). The fallback port
acted as an authoritative key list and dropped `success`.

Fix: `RunnablePort` gained an `isFallback` flag
(`web/packages/agenta-entities/src/shared/entityBridge.ts`); the molecule marks
its synthesized default ports; `SingleLayout` filters against declared
(non-fallback) ports only, so fallback-port evaluators render the full response.
Packages `@agenta/entities` and `@agenta/playground-ui` build and lint clean.

## Decision

Direction A plus a version bump (the ai_critique UX migration pattern):

- Interface version "3": same `evaluate(inputs, outputs, trace)` signature as v2,
  but the return may be any JSON-serializable value. Numbers normalize to
  `{"score", "success"}`, bools to `{"success"}`, dicts/lists/strings pass through.
- No declared output schema for v3. Metrics are inferred from traces, exactly like
  SDK `@ag.evaluator` evaluators.
- The catalog keeps one "Code Evaluation" entry. Its hidden `version` setting now
  defaults to "3" and its default templates return `{"score", "success"}` dicts.
- Existing v1/v2 evaluators keep their stored `version` parameter, their float-only
  runner contract, and their pinned `{score, success}` output schema.

## Implementation log (all changes in the working tree)

SDK (`sdks/python/agenta/sdk/engines/running/`):

- `runners/base.py`: new `normalize_result(result, version)` helper. v3 allows
  bool/float/str/dict/list, coerces int to float, enforces a JSON round-trip so
  non-serializable results fail and sandbox objects cannot leak. v1/v2 keep the
  float-only coercion.
- `runners/restricted.py`, `runners/local.py`: run `evaluate(inputs, output, trace)`
  for versions "2" and "3", delegate result handling to `normalize_result`.
- `runners/daytona.py`: v3 params shape, and `_coerce_result` accepts any JSON value
  for v3 when parsing sandbox stdout.
- `templates.py`: new "v2" wrapper templates (python/js/ts) that JSON-serialize any
  result instead of coercing to a number. Used by daytona for interface version "3".
- `handlers.py`: `auto_custom_code_run_v0` accepts version "3" (templates key "v2");
  `code_v0` (agenta:custom:code:v0) accepts a `version` parameter ("2" default, "3"
  opt-in). Both handler tails now check bool before number (bool is an int subclass)
  and pass lists through.
- `interfaces.py`: `auto_custom_code_run_v0_interface` version default "2" → "3" and
  no longer declares the pinned score+success outputs schema (the commit path was
  backfilling it from the interface).
- `builtin.py`: the `auto_custom_code_run` builder now sets `version="3"` by default.

API (`api/oss/src/`):

- `resources/evaluators/evaluators.py`: catalog presets and `code` default template
  return `{"score", "success"}` dicts; hidden `version` default "2" → "3";
  `auto_custom_code_run` removed from `_FIXED_OUTPUT_SCHEMA_BY_KEY`.
- `core/evaluators/utils.py`: `build_evaluator_data` skips the outputs schema for
  v3 code evaluators (`is_v3_code_evaluator`); v1/v2 keep the pinned schema.

Tests:

- `sdks/python/oss/tests/pytest/utils/test_restricted_runner.py`: new
  `TestRestrictedRunnerV3Outputs` (dict, nested dict, float, int, bool, str, list,
  None rejected, non-serializable rejected, v2 still rejects dicts, local runner).
- `sdks/python/oss/tests/pytest/utils/test_code_v0.py`: new `TestCodeV0RichOutputs`
  for the handler-level version "3" behavior.
- `api/oss/tests/pytest/unit/evaluators/test_evaluator_utils.py`: v3 revisions get
  no outputs schema; v2/no-version keep the pinned one.
- `api/oss/tests/pytest/unit/workflows/test_builtin_llm_interfaces.py`: interface
  declares no outputs schema and defaults to version "3"; the empty-required-list
  test repointed at `auto_json_diff_v0_interface`.

Docs:

- `docs/docs/evaluation/configure-evaluators/07-custom-evaluator.mdx`: dict returns
  documented as the primary shape, new exact-match and multi-metric examples, JS/TS
  examples return objects, legacy section covers both old interfaces.

Test runs: `uv run pytest oss/tests/pytest/utils/` in `sdks/python` (293 passed,
2 daytona-only skips) and `uv run pytest oss/tests/pytest/unit/evaluators/
oss/tests/pytest/unit/workflows/` in `api` (71 passed). Ruff format and check clean
on all touched files.

## QA items (manual, against a running stack)

- Create a new code evaluator from the catalog: confirm it gets version "3" and the
  dict template, run it in the playground, confirm each dict key renders in the
  result view.
- Run an evaluation with a dict-returning evaluator: confirm metric columns appear
  via trace inference (revision has no declared outputs schema).
- Edit an existing v2 evaluator and save without touching the version: confirm the
  stored `version` stays "2" and behavior is unchanged (float-only, pinned schema).
  The ai_critique precedent says hidden settings survive edits; verify anyway.
- Playground pre-run state for v3 evaluators has no output ports (no declared
  schema): confirm the idle rendering is acceptable.
- JS/TS runtimes need a daytona-enabled deployment to verify the new v2 wrapper
  templates.

## Known edge cases (accepted)

- An old evaluator manually bumped to version "3" keeps its stored pinned schema
  (the evaluators-service merge prefers existing schemas), so its metrics stay
  score/success until the schema is cleared.
- Daytona v3: a non-JSON-serializable result becomes `{"result": null}` in the
  sandbox wrapper, which the handler rejects with InvalidOutputsV0Error rather
  than the runner's clearer TypeError.

## Out of scope (follow-ups)

- SDK helper for remote invocation of stored evaluators (plan.md phase 5).
- A multi-metric settings preset in the catalog.
- Changelog announcement once this ships.
