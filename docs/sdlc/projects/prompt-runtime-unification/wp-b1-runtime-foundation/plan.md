# Plan

## Phase 1 — Backend patch: provider/secret resolution and temperature removal

Objective: add custom/self-hosted model support to `auto_ai_critique_v0` and remove the hard-coded `temperature=0.01`, without changing the judge's public config or output shape.

Steps:

1. Replace the manual standard-provider key extraction in `auto_ai_critique_v0` with the same workflow-secret path used by chat/completion. Use `SecretsManager.ensure_secrets_in_workflow()` and `SecretsManager.get_provider_settings_from_workflow(model)`.
2. Raise `InvalidSecretsV0Error` when provider settings are missing for the configured model, matching chat/completion's behavior.
3. Stop sending `temperature=0.01` (or any unsupported optional kwarg) on the judge LLM call. Some newer models reject `temperature` outright, and the judge has no UI for configuring it.
4. Keep the existing message rendering path (`_format_with_template`) and the existing render context (direct input keys, `inputs`, `outputs`, `prediction`, `ground_truth`, `correct_answer`, `reference`, `trace`, `parameters`).
5. Keep the existing JSON parsing and result normalization after the LLM call.

Milestone: a judge evaluator using a custom/self-hosted model configured in the UI runs successfully with no stored config migration. The LLM call no longer carries `temperature`.

## Phase 2 — Extract the low-level rendering helper

Objective: create the foundation that WP-B2 and WP-B3 build on, without changing handler behavior in this WP.

Steps:

1. Introduce a low-level rendering helper with signature roughly `(template_string, mode, context) -> rendered_string`. Pure, unit-testable, no service knowledge. Modes are the existing three substitution formats (`curly`, `fstring`) and `jinja2`, plus `mustache` once WP-B3 lands.
2. Move the substitution and Jinja-rendering logic that lives inside `PromptTemplate` and `_format_with_template` into the helper. Both call sites continue to call into it; their public behavior is unchanged in this WP.
3. Add unit tests on the helper directly (top-level keys, nested lookup, JSONPath, JSON Pointer, literal-key-first behavior in `curly`, whole-object insertion as compact JSON, brace handling in `fstring`, sandboxed Jinja behavior).
4. Do not adopt the helper at the handler level beyond what the existing `PromptTemplate` and `_format_with_template` already do — that adoption is part of WP-B2.

Milestone: the helper exists, is unit-tested, and is the single place where mode-specific substitution logic lives. Handler behavior is unchanged.

## Companion frontend change — Evaluator model-selection transform robustness

Scope is limited to making the existing evaluator UI persist custom-model selections through `nestEvaluatorConfiguration` / `flattenEvaluatorConfiguration` / `nestEvaluatorSchema` in `web/packages/agenta-entities/src/runnable/evaluatorTransforms.ts`. No new judge controls.

Steps:

1. Confirm flat evaluator `model` maps to nested `prompt.llm_config.model` and back without losing custom/self-hosted model values.
2. Confirm the model schema remains recognizable by `GroupedChoiceControl` / `SelectLLMProviderBase` and receives custom-provider option groups.
3. Add focused frontend tests for transforming a custom model key through nest → no-op → flatten.

Broader playground UX (JSON↔string switching, native JSON in playground execution, autocomplete) is not in this WP. See the RFC's WP-F1, WP-F2, WP-F3.

## Sequencing

Phase 1 unblocks the user-visible bug with the least migration risk; ship first. Phase 2 (helper extraction) is a refactor — do it after Phase 1 ships and baseline tests are green so behavior changes are easy to bisect. The companion frontend change can run in parallel with Phase 1 since it's small and independent.
