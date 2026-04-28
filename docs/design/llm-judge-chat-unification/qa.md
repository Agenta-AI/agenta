# QA Plan

## Testing Strategy From Repo Guidance

Follow `docs/designs/testing/README.md` and the interface specs:

- Prefer isolated unit tests for the runtime change because no running API, DB, or external LLM should be required.
- Mock or fake at the boundary: `SecretsManager`, runtime context/secrets, and the LLM completion function.
- Add acceptance/manual coverage only for the full custom-provider flow because it requires a configured provider, credentials, and running system.
- Put SDK/runtime tests under `sdk/oss/tests/pytest/unit/` using `test_*.py`.
- Put frontend pure transform tests near `web/packages/agenta-entities/src/runnable/evaluatorTransforms.ts` in a colocated `__tests__/` folder if the package has an available unit-test runner; otherwise document the transform cases and cover them with the closest existing package/web test harness before adding Playwright.

## Tests To Add

### SDK Runtime Unit Tests

Add a focused unit test file:

`sdk/oss/tests/pytest/unit/test_builtin_llm_runtime_handlers.py`

If the helper extraction creates a new module, use a more focused name such as:

`sdk/oss/tests/pytest/unit/test_llm_runtime_helpers.py`

Cover these cases with mocked dependencies:

- `auto_ai_critique_v0` calls `SecretsManager.ensure_secrets_in_workflow()` and `SecretsManager.get_provider_settings_from_workflow(model)` for the configured model.
- A custom/self-hosted model key returned by provider settings is passed to the LLM call through provider settings, not as a raw unsupported model string.
- Missing provider settings raises `InvalidSecretsV0Error` with the selected model.
- Existing judge call kwargs are preserved: rendered `messages`, `temperature=0.01`, and `response_format`.
- Valid JSON model output is parsed and returned as a dict unchanged.
- Numeric model output still returns `{score, success}` using the existing threshold behavior.
- Boolean model output still returns `{success}`.
- Non-JSON text output remains raw text.
- Prompt rendering supports the existing context aliases: direct input keys, `inputs`, `outputs`, `prediction`, `reference`, `ground_truth`, `correct_answer`, `trace`, and `parameters`.

Mocking notes:

- Patch `SecretsManager.ensure_secrets_in_workflow` as an async no-op.
- Patch `SecretsManager.get_provider_settings_from_workflow` to return representative standard and custom provider settings.
- Patch the LLM call boundary (`mockllm.acompletion` after Phase 1, or the extracted helper after Phase 2) with a fake response object exposing `choices[0].message.content`.
- Avoid live provider credentials and network calls in unit tests.

### Shared Helper Unit Tests

After Phase 2, add tests for the extracted helper itself:

- Provider settings resolution returns provider settings for standard models.
- Provider settings resolution returns provider settings for custom provider models.
- Provider settings resolution raises the same domain error for missing settings.
- Message rendering handles `curly`, `fstring`, and `jinja2` formats consistently with `PromptTemplate`.
- Completion call helper strips or overrides raw `model` kwargs so provider settings remain authoritative, matching current chat/completion behavior.

Keep adapter-specific return-shape tests in handler tests, not helper tests.

### Chat/Completion Regression Unit Tests

If existing unit coverage for `completion_v0` and `chat_v0` is absent, add minimal regression tests in the same SDK unit file:

- `completion_v0` still returns assistant content.
- `completion_v0` still returns parsed/refusal/tool-call alternatives when message fields are present.
- `chat_v0` still appends runtime `messages` to configured prompt messages.
- Both handlers still resolve provider settings through the shared provider path.

These tests protect the Phase 2 refactor and should not require a running backend.

### Frontend Transform Unit Tests

Add pure transform tests for:

`web/packages/agenta-entities/src/runnable/evaluatorTransforms.ts`

Suggested colocated file:

`web/packages/agenta-entities/src/runnable/__tests__/evaluatorTransforms.test.ts`

Cases:

- `nestEvaluatorConfiguration(...)` maps `{model: "custom-provider/my-model", prompt_template: [...]}` to `prompt.llm_config.model`.
- `flattenEvaluatorConfiguration(...)` maps `prompt.llm_config.model` back to flat `model`.
- Original flat params are preserved during flattening for fields outside the UI model path.
- `nestEvaluatorSchema(...)` keeps the nested model property marked as a model selector (`x-ag-type-ref: model` or equivalent metadata already provided by the flat schema).
- No extra `llm_config` properties such as `temperature`, `max_tokens`, or `tools` are introduced by the transform.

These are pure utility tests and should not use Playwright or a browser.

### Acceptance / Manual Follow-Up

Use a single smoke-style acceptance/manual scenario after unit tests pass:

1. Configure a custom/self-hosted model in Model Hub.
2. Create or edit an LLM-as-a-judge evaluator and select that model.
3. Save/commit the evaluator.
4. Run an evaluation using that evaluator.
5. Verify the evaluator executes and returns the same result shape as before.

This scenario belongs in manual QA initially because it requires real provider credentials and environment setup. Promote it to Playwright/API acceptance only if stable test credentials and provider configuration exist.

## Backend Unit Coverage

- `auto_ai_critique_v0` resolves a standard model through `get_provider_settings_from_workflow`.
- `auto_ai_critique_v0` resolves a custom/self-hosted model through `get_provider_settings_from_workflow`.
- Missing provider settings raises `InvalidSecretsV0Error` with the model name.
- Existing `response_type` values still map to the same `response_format`.
- JSON schema output is parsed and returned unchanged when the model returns valid JSON.
- Numeric output still maps to `{score, success}` using existing threshold behavior.
- Boolean output still maps to `{success}`.
- Non-JSON text output remains raw output.
- Prompt variables still resolve for direct input keys, `inputs`, `outputs`, `prediction`, `reference`, `ground_truth`, `trace`, and `parameters`.

## Backend Regression Coverage

- `completion_v0` still returns text, parsed structured responses, refusals, and tool calls as before.
- `chat_v0` still appends runtime chat messages and returns a final assistant message dict.
- Existing prompt template formats still work: `curly`, `fstring`, `jinja2`.

## Frontend Coverage

- `nestEvaluatorConfiguration(...)` maps a custom model string from flat `model` to `prompt.llm_config.model`.
- `flattenEvaluatorConfiguration(...)` maps `prompt.llm_config.model` back to flat `model`.
- `nestEvaluatorSchema(...)` keeps the model field renderable as the LLM provider selector.
- No new judge config fields are rendered for temperature, max tokens, or tools.

## Manual Scenarios

1. Add or use a custom provider/model in the UI.
2. Create or edit an LLM-as-a-judge evaluator and select the custom model.
3. Save/commit the evaluator and reload the page.
4. Verify the selected model persists.
5. Run an evaluation using the evaluator.
6. Verify the run succeeds and returns the same result structure as an equivalent standard-model judge.

## Suggested Commands

Backend:

```bash
cd sdk
poetry run pytest oss/tests/pytest/unit/test_builtin_llm_runtime_handlers.py -v

cd ../api
ruff format
ruff check --fix
```

Frontend:

```bash
cd web
pnpm lint-fix
```

If a package unit-test command exists for `web/packages/agenta-entities`, run the colocated transform test through that runner. If not, keep the test plan in this workspace and avoid adding a one-off runner without a broader web test harness decision.
