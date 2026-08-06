# Status

## Current state

WP-B1 is the first work package from the [RFC](../README.md). Scope is the judge backend patch (provider/secret resolution + temperature removal), the low-level rendering helper extraction, and the companion frontend evaluator-model transform robustness. The earlier idea of broadening LLM-as-a-judge with `llm_config` controls is explicitly out of scope.

## Progress log

- 2026-04-29: Created the planning workspace (then named `llm-judge-chat-unification/`).
- 2026-04-29: Reviewed `auto_ai_critique_v0`, `completion_v0`, `chat_v0`, `PromptTemplate`, `SecretsManager`, and the evaluator frontend transforms.
- 2026-04-29: Captured the implementation plan and QA strategy.
- 2026-04-29: Addressed PR review feedback: removed planned judge temperature injection, added compatibility guidance for future optional LLM parameters, added `variable-and-template-analysis.md`.
- 2026-04-30: Drafted [RFC](../README.md) covering variable handling, JSON preservation, template formats, playground UX, and runtime unification.
- 2026-04-30: Resolved review comments and locked the RFC's work-package layering (backend foundations → mustache → frontend → docs).
- 2026-04-30: Renamed the design workspace to `prompt-runtime-unification/` and moved this WP-B1 content under `wp-b1-runtime-foundation/`. Aligned `plan.md`, `implementation-notes.md`, `qa.md`, and `variable-and-template-analysis.md` with the new RFC's WP-B1 scope.
- 2026-04-30: Implemented Phase 1: patched `auto_ai_critique_v0` in `sdk/agenta/sdk/engines/running/handlers.py` to resolve provider settings via `SecretsManager.ensure_secrets_in_workflow()` + `SecretsManager.get_provider_settings_from_workflow(model)`, raise `InvalidSecretsV0Error` on missing settings, route the LLM call through `mockllm.acompletion` under `mockllm.user_aws_credentials_from(...)`, and stop sending `temperature=0.01`. Added `sdk/oss/tests/pytest/unit/test_auto_ai_critique_v0_runtime.py` (10 tests, passing).
- 2026-04-30: Implemented Phase 2: extracted the low-level rendering helper to `sdk/agenta/sdk/utils/templating.py` (`render_template(template, mode, context) -> str`). Updated both `_format_with_template` (judge) and `PromptTemplate._format_with_template` (chat/completion) to call the helper. The judge call site preserves its silent-return-on-jinja-error behavior for WP-B1; alignment to raise across all services lands in WP-B2. Added `sdk/oss/tests/pytest/unit/test_render_template_helper.py` (20 tests, passing). Existing `test_jinja2_sandbox.py` still passes.
- 2026-04-30: Verified the companion frontend evaluator transforms in `web/packages/agenta-entities/src/runnable/evaluatorTransforms.ts` already round-trip custom-model selections correctly (`nestEvaluatorConfiguration` writes `prompt.llm_config.model`; `flattenEvaluatorConfiguration` writes back to flat `model`; `nestEvaluatorSchema` passes the `model` schema through so `x-ag-type-ref: "model"` is preserved). `pnpm run types:check` clean.

## Decisions

- Preserve the flat LLM-as-a-judge parameter contract.
- Preserve the LLM-as-a-judge output shape.
- Fix model support by reusing `SecretsManager.get_provider_settings_from_workflow(model)`, not by migrating the judge to a new config shape.
- Keep companion frontend work limited to evaluator model-selection transform robustness. No new judge UI controls.
- Do not inject `temperature` into the judge runtime call. Model/provider compatibility outweighs preserving the current unsupported optional kwarg.
- Extract a low-level rendering helper with signature `(template_string, mode, context) -> rendered_string`. Pure, unit-testable, no service knowledge. Foundation for WP-B2 and WP-B3.
- Primary automated coverage is SDK unit tests and pure frontend transform tests; full custom-provider execution stays as manual/acceptance follow-up unless stable credentials exist.

## Blockers

None for WP-B1.

## Open questions

- ~~Where should the low-level rendering helper live?~~ Resolved — landed at `sdk/agenta/sdk/utils/templating.py`, next to the other rendering primitives in `utils/`.
- ~~Is there an existing SDK/runtime test suite suitable for mocking `SecretsManager` and the LLM call boundary?~~ Resolved — the new tests live under `sdk/oss/tests/pytest/unit/` with local monkeypatching of `SecretsManager` and `mockllm`.
- Which runner should own the colocated `web/packages/agenta-entities` unit test for the evaluator transform if no package-level test command currently exists? Still open. The `agenta-entities` package only ships `tsc --noEmit` + ESLint; introducing Vitest/Jest for one test is out of scope for WP-B1. Verified the transform behavior by reading the code (custom-model strings round-trip through nest → flatten unchanged) and ran `pnpm run types:check`. Defer the test runner decision to the broader frontend test-harness conversation.

## Next steps

1. Smoke-test in-product: configure a custom/self-hosted model in Model Hub, point an LLM-as-a-judge evaluator at it, and run an evaluation to confirm provider resolution end-to-end.
2. Hand off to WP-B2 (message renderer + JSON-return renderer + Jinja error alignment). The helper at `sdk/agenta/sdk/utils/templating.py` is the integration point.
