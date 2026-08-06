# Plan: Directions and Draft Phases

> **Decision (2026-06-10):** Direction A with a version bump, mirroring the
> ai_critique UX migration. No declared output schema; metrics are inferred from
> traces, the same way SDK `@ag.evaluator` evaluators work. A new interface
> version "3" of `auto_custom_code_run` expects rich (JSON-serializable) returns.
> New evaluators created from the catalog get version "3" and a dict-returning
> default template. Existing v1/v2 evaluators keep their stored version and exact
> current behavior. See status.md for the implementation log.

Research (see [research.md](./research.md)) shows the dict restriction lives in two
places: the sandbox runners and the pinned output schema. Everything downstream
(handler, metrics, UI) already handles dicts. The directions below differ mainly in
how the output **schema** is handled, because that drives metric columns and rendering.

## Direction A: Allow dicts, infer the schema (minimal)

Relax the runners to return dicts (and bools) as-is, and stop pinning the
`{score, success, additionalProperties: False}` schema for `auto_custom_code_run`.
With no declared schema, the existing trace-inference path
(`_infer_evaluator_schema_from_traces`) derives metric keys from actual outputs.

- Pros: smallest change, no new settings, no new UI. Matches how SDK evaluators
  already get their metrics.
- Cons: metric columns only appear after the first run (inference needs traces).
  Playground rendering before any run has no port schema to draw from. Existing
  revisions already store the pinned schema, so a migration or an
  ignore-pinned-schema rule is needed for old code evaluators that start returning
  dicts.

## Direction B: User-declared output schema (the ai_critique pattern)

Add an optional `outputs_schema` setting to the code evaluator, the same way
LLM-as-a-judge takes a `json_schema`. `build_evaluator_data` writes it into the
revision (it already does exactly this for `auto_ai_critique` and builds dynamic
schemas for `json_multi_field_match`). The handler can validate the returned dict
against it. When absent, fall back to Direction A behavior.

- Pros: metric columns and playground rendering are correct before the first run.
  Type-safe metrics (numeric vs categorical vs binary). Validation gives users a
  clear error when their code returns the wrong shape. Consistent with the two
  existing multi-metric evaluators.
- Cons: more work (catalog field, frontend schema editor wiring, validation), and a
  schema users must keep in sync with their code.

## Direction C: Convention only

Like A, but with documented reserved keys: a numeric `score` still drives
`success` via the threshold, `success` stays boolean, all other keys are free-form
metrics. No schema anywhere; everything rides on inference.

This is not really a separate direction. It is the contract we should document in
either A or B. Calling it out so the reserved-keys decision is explicit.

## Recommendation

Direction B with A as its fallback, shipped in two steps. Step one relaxes the
runners and the pinned schema and rides on inference (Direction A); this alone fixes
the user-facing error and the SDK parity gap. Step two adds the optional declared
schema for first-run columns and validation. Step one is useful on its own and step
two never blocks it.

## Cross-cutting decisions to settle

1. **Allowed return types.** Proposal: float, int, bool (as today), plus dict.
   Strings stay float-coerced for backward compatibility (today `"0.7"` works).
   Lists: only inside dicts. Anything else is an error.
2. **JSON-serializability at the sandbox boundary.** The restricted sandbox should
   not hand back arbitrary objects. Proposal: `json.dumps`/`loads` round-trip in the
   runner; fail with a clear error if the result is not JSON-serializable. This also
   keeps the three runners behaviorally identical, since daytona already crosses a
   JSON boundary.
3. **Nested dicts.** The metrics helper already flattens nested objects to dotted
   paths. Proposal: allow nesting, document the flattening.
4. **Threshold semantics.** `success` is computed only for plain numeric returns.
   Dict returns are passed through untouched; if the user wants `success`, they
   return it.
5. **JS/TS runtimes.** The wrapper templates and the daytona stdout parsing must
   carry arbitrary JSON values in `{"result": ...}`, not just numbers.
6. **Existing revisions.** Old code evaluator revisions carry the pinned
   score+success schema. Decide: lazy migration (drop or widen the schema on next
   commit), or have the metrics step treat the pinned schema as overridable by
   inference for `auto_custom_code_run`.

## Draft phases (for Direction A + B)

### Phase 1: Runners accept rich outputs (SDK)
- `runners/restricted.py`, `runners/local.py`: keep numeric/str float coercion,
  accept bool and dict, enforce JSON round-trip, raise a typed error for the rest.
- `templates.py` + `runners/daytona.py`: pass arbitrary JSON through `{"result": ...}`.
- Extend `test_restricted_runner.py` and `test_code_v0.py` with dict-return cases
  (flat, nested, non-serializable, reserved keys).

### Phase 2: Schema unpinning (API)
- Remove `auto_custom_code_run` from the strict fixed-schema map, or widen it
  (`additionalProperties: True`, no required keys).
- `build_evaluator_data`: stop writing the pinned schema for code evaluators (or
  write the widened one). Settle the existing-revisions decision (cross-cutting #6).

### Phase 3: Declared output schema (API + frontend, Direction B)
- New optional `outputs_schema` setting in the catalog entry, mirrored into
  `data.schemas.outputs` by `build_evaluator_data`, like ai_critique.
- Handler validates dict results against the declared schema when present.
- Frontend: schema editor for the setting; verify `EvaluatorFieldGrid` port wiring.

### Phase 4: Docs and templates
- Update `07-custom-evaluator.mdx` return-type section and examples.
- Update the default code templates (catalog `settings_presets`) if we want a
  multi-metric example preset.

### Phase 5 (optional, separate scope): SDK remote invocation
- A public SDK helper that runs a stored evaluator remotely through
  `POST /services/invoke`, closing the interchangeability story:
  same evaluator, local or remote, same output shape.

## Validation

- SDK: `pytest sdks/python/oss/tests/pytest/utils/test_restricted_runner.py
  sdks/python/oss/tests/pytest/utils/test_code_v0.py` plus new cases.
- End to end: playground run of a dict-returning code evaluator on the dev stack;
  check the result grid, then an evaluation run's metric columns (inference path).
- Backward compat: existing float and bool evaluators, v1 and v2 signatures, all
  three runners.
