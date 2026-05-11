# QA Plan

Scope is WP-B1 only: the judge backend patch (provider/secret resolution + temperature removal), the low-level rendering helper extraction, and the companion frontend evaluator-model transform. Tests for the message renderer, JSON-return renderer, Jinja error alignment, and `mustache` support belong to WP-B2 / WP-B3.

## Testing strategy

Follow `docs/designs/testing/README.md` and the interface specs:

- Prefer isolated unit tests because no running API, DB, or live LLM is required.
- Mock or fake at the boundary: `SecretsManager`, runtime context/secrets, and the LLM completion function.
- Add acceptance/manual coverage only for the full custom-provider flow because it requires a configured provider, credentials, and a running system.
- SDK/runtime tests go under `sdk/oss/tests/pytest/unit/` using `test_*.py`.
- Frontend pure transform tests go in a colocated `__tests__/` folder next to `web/packages/agenta-entities/src/runnable/evaluatorTransforms.ts` if that package has a unit-test runner; otherwise document the cases and cover them with the closest existing web test harness before adding Playwright.

## Tests to add

### SDK runtime unit tests — judge backend patch (Phase 1)

Suggested file: `sdk/oss/tests/pytest/unit/test_auto_ai_critique_v0_runtime.py`.

Cover with mocked dependencies:

- `auto_ai_critique_v0` calls `SecretsManager.ensure_secrets_in_workflow()` and `SecretsManager.get_provider_settings_from_workflow(model)` for the configured model.
- A custom/self-hosted model resolves through `get_provider_settings_from_workflow` and is invoked via the resolved provider settings, not as a raw unsupported model string.
- Missing provider settings raises `InvalidSecretsV0Error` with the selected model.
- The judge LLM call **does not** include `temperature` in its kwargs.
- Existing rendered-message and `response_format` kwargs are preserved.
- Existing result normalization is unchanged: valid JSON parses to a dict; numeric output maps to `{score, success}` using the existing threshold; boolean output maps to `{success}`; non-JSON text remains raw text.
- Prompt rendering still resolves the existing context aliases (direct input keys, `inputs`, `outputs`, `prediction`, `reference`, `ground_truth`, `correct_answer`, `trace`, `parameters`).

Mocking notes:

- Patch `SecretsManager.ensure_secrets_in_workflow` as an async no-op.
- Patch `SecretsManager.get_provider_settings_from_workflow` to return representative standard and custom provider settings.
- Patch the LLM call boundary with a fake response object exposing `choices[0].message.content`.
- Avoid live provider credentials and network calls.

### SDK unit tests — low-level rendering helper (Phase 2)

Suggested file: `sdk/oss/tests/pytest/unit/test_render_template_helper.py`.

The helper signature is `(template_string, mode, context) -> rendered_string`. Cover each mode:

- `curly` resolves top-level keys, nested dot-notation lookups, array indexing (`{{tags.0}}`), JSONPath (`{{$.profile.name}}`), and JSON Pointer (`{{/profile/name}}`).
- `curly` preserves literal-key-first lookup: a top-level key literally named `foo.bar` wins over nested traversal.
- `curly` renders objects/arrays as compact JSON text when inserted as whole values into a string template.
- `fstring` keeps Python `str.format` semantics, including raising on missing keys.
- `jinja2` renders through the sandboxed environment. Existing error behavior (raise on `PromptTemplate` callers, silent-return on judge `_format_with_template` callers) is preserved in this WP — alignment lands in WP-B2.

Behavior-preservation tests for the helper's call sites:

- `PromptTemplate.format` produces the same output before and after the helper extraction for representative templates.
- `_format_with_template` produces the same output before and after the helper extraction for representative templates.

### Frontend transform unit tests — companion change

Suggested colocated file: `web/packages/agenta-entities/src/runnable/__tests__/evaluatorTransforms.test.ts`.

Cases:

- `nestEvaluatorConfiguration(...)` maps `{model: "custom-provider/my-model", prompt_template: [...]}` to `prompt.llm_config.model`.
- `flattenEvaluatorConfiguration(...)` maps `prompt.llm_config.model` back to flat `model`.
- Original flat params outside the UI model path are preserved during flattening.
- `nestEvaluatorSchema(...)` keeps the nested model property marked as a model selector (`x-ag-type-ref: model` or equivalent).
- The transform does not introduce extra `llm_config` fields (`temperature`, `max_tokens`, `tools`, etc.).

These are pure utility tests — no Playwright, no browser.

### Acceptance / manual follow-up

Single smoke scenario after unit tests pass:

1. Configure a custom/self-hosted model in Model Hub.
2. Create or edit an LLM-as-a-judge evaluator and select that model.
3. Save/commit the evaluator.
4. Run an evaluation using that evaluator.
5. Verify the run succeeds and returns the same result shape as before.

Manual to start; promote to Playwright/API acceptance only if stable test credentials and provider configuration exist.

## Out of scope here

The following test surface is intentionally not in WP-B1:

- Tests that the message renderer is shared across services (WP-B2).
- Tests for variable substitution inside `json_schema` / `response_format` (WP-B2).
- Tests that Jinja error behavior is aligned across services (WP-B2).
- Tests for `mustache` mode (WP-B3).
- Frontend tests for native-JSON playground execution and JSON↔string switching (WP-F1, WP-F2).

## Suggested commands

Backend:

```bash
cd sdk
poetry run pytest oss/tests/pytest/unit/test_auto_ai_critique_v0_runtime.py -v
poetry run pytest oss/tests/pytest/unit/test_render_template_helper.py -v

cd ../api
ruff format
ruff check --fix
```

Frontend:

```bash
cd web
pnpm lint-fix
```

If a package unit-test command exists for `web/packages/agenta-entities`, run the colocated transform test through it. Otherwise keep the test plan documented here and avoid adding a one-off runner without a broader web test harness decision.
