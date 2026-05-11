# Status

## Current Phase: Implementation Complete — Docs in progress

### Completed

#### Research & Planning
- [x] Read and understood issue #3591
- [x] Rebased branch onto latest main
- [x] Researched evaluator preset/template definitions
- [x] Researched full execution pipeline (handler → sandbox → user code)
- [x] Researched variable translation (WorkflowServiceRequestData → NormalizerMiddleware → handler)
- [x] Researched LLM-as-a-judge version flag as model for migration
- [x] Researched dual meaning of `inputs` (batch vs online eval)
- [x] Researched LLM-as-a-judge template nesting/dot-notation support
- [x] Reviewed current documentation and identified gaps
- [x] Created planning workspace
- [x] Created implementation plan
- [x] Created QA protocol

#### Phase 1: SDK — Handler + Sandbox + Templates
- [x] `auto_custom_code_run_v0`: Added `trace` param and explicit version branching (v1/v2)
- [x] `auto_ai_critique_v0`: Added `trace` param, `trace` injected into template context
- [x] `sandbox.py`: Added `version` and `trace` pass-through params
- [x] `runners/base.py`: Updated interface with `version` and `trace` kwargs
- [x] `runners/local.py`: Version-based v1/v2 dispatch
- [x] `runners/daytona.py`: Version-branched params dict shape
- [x] `templates.py`: Added `"v1"` templates (python/js/ts) alongside existing `"v0"`
- [x] `handlers.py`: `ErrorStatus` exceptions preserved (not wrapped in `CustomCodeServerV0Error`)

#### Phase 2: API — Evaluator Definitions + Presets
- [x] Added hidden `version` field to `auto_custom_code_run` settings_template (default `"2"`)
- [x] Updated default code template to v2 signature
- [x] Updated all presets (python/js/ts) to v2 interface with `version: "2"`
- [x] Updated evaluator description to mention Python/JS/TS and trace access

#### Phase 3: Frontend
- [x] `invoke.ts`: Added `trace` to `InvokeEvaluatorParams` and request payload
- [x] `DebugSection.tsx`: Passes `traceTree.trace` to evaluator invocation; version-gated ground truth key logic
- [x] `ConfigureEvaluator/index.tsx`: Version-aware field visibility (hides `correct_answer_key` for code eval v2); edit/clone backward compat (missing version → force v1); strips `correct_answer_key` from submit for v2
- [x] `AdvancedSettings.tsx`: Collapsed by default

#### Phase 4: Documentation
- [x] Rewrote `07-custom-evaluator.mdx` for v2 interface
- [x] Updated `01-overview.mdx` evaluator table (Custom Code row)
- [x] Updated `05-llm-as-a-judge.mdx` (template variables, nesting, trace access)

### Design Decisions Settled
- **Interface**: `(inputs, outputs, trace)` — 3 params, no separate `testcase`
- **Versioning**: Branch in existing handler, string versions `"1"` / `"2"`
- **Sandbox**: Pass params dict, version determines shape
- **`correct_answer_key`**: Hidden in UI for v2; stripped from submit payload; not required by v2 handler
- **No assembly changes**: `WorkflowServiceRequestData` stays as-is
- **Version source of truth**: Runtime dispatch follows explicit `parameters.version` (`"1"`/`"2"`)
- **LLM-as-a-judge trace**: `trace` added to template context, works in playground; evaluation-run support needs trace assembly verification

### Known Issues / Follow-ups
- LLM-as-a-judge `{{trace}}` works in playground but may fail in batch evaluation runs ("Template variables not found or unresolved: trace") — likely `trace` not being passed through evaluation task assembly correctly. Needs targeted logging in `legacy.py`/`live.py`.
- Phase 5 (examples) deferred — no standalone example files updated yet.
