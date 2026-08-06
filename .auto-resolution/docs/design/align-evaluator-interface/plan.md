# Implementation Plan

## Phase 1: SDK — Handler + Sandbox + Templates

### 1.1 Handler: Branch on version in `auto_custom_code_run_v0`
**File:** `sdk/agenta/sdk/workflows/handlers.py`

- Add `trace` to handler signature: `auto_custom_code_run_v0(parameters, inputs, outputs, trace)`
- Read `version = parameters.get("version") or "1"`
- v1 path: unchanged (existing logic)
- v2 path: call sandbox with `(inputs, outputs, trace, code, runtime)`
- v2 does NOT need `correct_answer_key` — skip that extraction entirely
- v2 should still support returning float, bool, dict, or str (same as v1)

### 1.2 Sandbox: Add v2 execution path
**File:** `sdk/agenta/sdk/workflows/sandbox.py`

- Add a new function or extend `execute_code_safely` with a `version` param
- v2 passes `params = {"inputs": ..., "outputs": ..., "trace": ...}` to the runner

### 1.3 LocalRunner: Support v2 call
**File:** `sdk/agenta/sdk/workflows/runners/local.py`

- Branch on version in `run()`:
  - v1: `environment["evaluate"](app_params, inputs, output, correct_answer)`
  - v2: `environment["evaluate"](inputs, outputs, trace)`

### 1.4 DaytonaRunner: Support v2 params shape
**File:** `sdk/agenta/sdk/workflows/runners/daytona.py`

- The runner already serializes a `params` dict to JSON — just change the shape for v2
- Select template from `EVALUATOR_TEMPLATES["v1"]` instead of `["v0"]` for v2

### 1.5 Templates: Add v1 templates for all 3 runtimes
**File:** `sdk/agenta/sdk/workflows/templates.py`

- Add `"v1"` key alongside existing `"v0"` in `EVALUATOR_TEMPLATES`
- Python template: unpack `inputs`, `outputs`, `trace` from params, call `evaluate(inputs, outputs, trace)`
- JavaScript template: same pattern
- TypeScript template: same pattern

## Phase 2: API — Evaluator Definitions + Presets

### 2.1 Add version field to settings_template
**File:** `api/oss/src/resources/evaluators/evaluators.py`

- Add to `auto_custom_code_run` settings_template:
  ```python
  "version": {
      "label": "Version",
      "type": "hidden",
      "default": "2",
      "description": "The version of the evaluator interface",
      "advanced": False,
  }
  ```
- Existing evaluators (no version in their params) get `"1"` by default via handler fallback

### 2.2 Update default code template
**File:** `api/oss/src/resources/evaluators/evaluators.py`

- Change the default `code` field to v2 signature:
  ```python
  def evaluate(
      inputs: Dict[str, Any],
      outputs: Any,
      trace: Dict[str, Any],
  ) -> float:
      if outputs == inputs.get("correct_answer"):
          return 1.0
      return 0.0
  ```

### 2.3 Update presets
**File:** `api/oss/src/resources/evaluators/evaluators.py`

- Update `python_default`, `javascript_default`, `typescript_default` presets to v2 interface
- All presets should include `"version": "2"` in their values
- Consider adding new presets that demonstrate trace access, e.g.:
  - "Latency Check" — checks if `trace` duration is within threshold
  - "Token Budget" — checks token usage from trace metrics

### 2.4 Handle `correct_answer_key` for v2
**File:** `api/oss/src/resources/evaluators/evaluators.py`

- `correct_answer_key` should remain in settings_template (for v1 backward compat)
- For v2 evaluators it's not used by the handler, but keeping it in the form doesn't hurt
- Optionally: frontend could hide it when version >= 2 (like LLM-as-a-judge hides fields based on version)

## Phase 3: Frontend (Minimal)

### 3.1 Version-based field visibility (optional enhancement)

- `correct_answer_key` is defined in the evaluator's `settings_template` schema (in `evaluators.py`), not hardcoded in the frontend
- For v2 evaluators, `correct_answer_key` is unused by the handler but still meaningful as a `ground_truth_key` hint to the frontend (tells the UI which column to show as ground truth in results)
- Decision: keep `correct_answer_key` in the schema for now — it doesn't hurt to have it, and the `ground_truth_key: true` flag is used by the frontend to display the ground truth column in evaluation results
- No frontend changes needed — the hidden version field, code editor, and preset loading all work as-is

### 3.2 Debug section / evaluator playground
**File:** `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/DebugSection.tsx`

- May need to pass `trace` data to evaluator invocation for v2 testing
- Currently the debug section assembles `inputs` and `outputs` but may not pass `trace`
- Investigate whether the workflow invoke endpoint already sends trace data for evaluator playground

## Phase 4: Documentation

### 4.1 Rewrite custom code evaluator docs
**File:** `docs/docs/evaluation/configure-evaluators/07-custom-evaluator.mdx`

Current state: 46 lines, only documents v1 signature. Needs full rewrite.

**New structure:**
1. **Introduction** — what the custom code evaluator is
2. **New interface (v2)** — primary, shown first
   - Function signature: `evaluate(inputs, outputs, trace) -> float`
   - What each parameter contains:
     - `inputs`: In batch eval = testcase data (all columns including ground truth). In online eval = actual app inputs from the trace. (Same dual-source as LLM-as-a-judge `{{inputs}}` — this is by design so the same evaluator works in both contexts.)
     - `outputs`: The application's output (string or dict)
     - `trace`: Full OTel trace dict with spans, metrics (latency, token counts, costs), child spans
   - Return value: float 0.0-1.0, or dict with `score`/`success`, or bool
   - Examples:
     - Exact match (simple)
     - Latency check (uses trace)
     - Token budget check (uses trace metrics)
     - JSON output validation
3. **Accessing ground truth** — `inputs["correct_answer"]` directly, no `correct_answer_key` needed
4. **Accessing trace data** — how to navigate the trace dict, what's available
   - Root span path: `trace["spans"][root_id]["attributes"]["ag"]`
   - Metrics: `...["ag"]["metrics"]["unit"]["duration"]["total"]` for latency
   - Tokens: `...["ag"]["metrics"]["unit"]["tokens"]`
   - Child spans: `...["children"]` for internal steps
5. **JavaScript and TypeScript** — same interface, show examples
6. **Legacy interface (v1)** — brief note for backward compat, link to old signature
7. **Migration guide** — how to update existing v1 evaluators to v2

### 4.2 Update LLM-as-a-judge docs
**File:** `docs/docs/evaluation/configure-evaluators/05-llm-as-a-judge.mdx`

Current gaps to fill (these are independent of the code evaluator v2 work but worth fixing in this pass):

1. **Template variable nesting** — document that dot-notation works:
   - `{{inputs.country}}` — access nested fields
   - `{{inputs}}` — full dict (JSON-serialized)
   - `{{country}}` — flat access to testcase columns (because inputs are flattened into context)
   - Remove or clarify the `{{$input_column_name}}` syntax — the `$` prefix in the current docs is misleading (it triggers JSON Path resolver, not simple column access). The correct syntax for column access is just `{{country}}`.

2. **Where inputs come from** — explain the dual source:
   - Batch evaluation: `inputs` = testcase data (all columns)
   - Online evaluation: `inputs` = app inputs from trace
   - This is why the same template works for both modes

3. **Template format options** — mention that curly `{{ }}` is the default, but jinja2 is also available

4. **Available resolution schemes** — document dot-notation, JSON Path (`{{$.path}}`), JSON Pointer (`{{/path}}`)

### 4.3 Update overview page
**File:** `docs/docs/evaluation/configure-evaluators/01-overview.mdx`

- Update the Custom Code Evaluation row in the evaluators table to mention trace access
- Current description: "Allows users to define their own evaluator in Python."
- New: "Define custom evaluators in Python, JavaScript, or TypeScript. Access inputs, outputs, and full trace data (spans, latency, token usage)."

### 4.4 Update SDK evaluator docs (minor)
**File:** `docs/docs/evaluation/evaluation-from-sdk/04-configuring-evaluators.mdx`

- No major changes needed — this covers `@ag.evaluator` and built-in evaluators
- Optionally: add a note linking to the updated code evaluator docs for the built-in code editor interface

## Phase 5: Examples

### 5.1 Update built-in code evaluator example files
**Directory:** `examples/python/evaluators/`

These are example scripts for the built-in code evaluator (pasted into the code editor UI). They use the v1 `(app_params, inputs, output, correct_answer)` signature. They are NOT `@ag.evaluator` SDK evaluators.

- Replace existing v1 examples with v2 interface (v1 is deprecated)
- New v2 examples demonstrating trace access:
  - `trace_latency_check.py` — evaluator that checks response time
  - `trace_token_budget.py` — evaluator that checks token usage
