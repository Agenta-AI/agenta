# Fallback Models Gap

## Summary

The current system supports a single prompt-template `llm_config` in legacy completion/chat handlers. The proposal adds optional root-level retry and fallback controls plus ordered fallback LLM configs.

## SDK Type Gap

Current:

- `PromptTemplate` has `messages`, `template_format`, `input_keys`, and `llm_config`.
- `ModelConfig` is only a primary config.
- `ModelConfig` does not include `chat_template_kwargs`.
- There are no prompt-template root fields for retry or fallback.
- `to_openai_kwargs()` only serializes `self.llm_config`.

Needed:

- Add `fallback_configs`, `retry_config`, `retry_policy`, and `fallback_policy` to `PromptTemplate`.
- Keep every new field optional/null in stored config.
- Apply runtime behavior defaults outside the data model:
  - `fallback_configs: null` -> `[]`
  - `retry_config: null` -> `max_retries=0`, `delay_ms=0`
  - `retry_policy: null` -> `off`
  - `fallback_policy: null` -> `off`
  - `chat_template_kwargs: null` -> omitted from provider kwargs
- Reuse the current `ModelConfig` shape for fallback entries while requiring `model`.
- Add `chat_template_kwargs` to the reusable LLM config shape for primary and fallback configs.
- Add enums/models for retry and fallback policy.
- Add internal candidate-specific kwargs helpers.
- Ensure `PromptTemplate.format()` preserves and formats relevant fallback fields where needed.

## SDK Handler Gap

Current:

- `completion_v0` resolves provider settings for one model, formats once, and calls once.
- `chat_v0` resolves provider settings for one model, formats once, appends messages, and calls once.
- `_call_llm_with_fallback()` exists only for `llm_v0` and uses different secret/provider behavior.
- Retry behavior exists only as fixed low-level `mockllm` recovery for closed HTTP clients.

Needed:

- Add a shared prompt fallback runner for `completion_v0` and `chat_v0`.
- Retry each current LLM config before considering fallback.
- Classify provider-call errors into `availability`, `capacity`, `access`, `context`, and `any`.
- Keep local prompt/input validation outside fallback.
- Resolve provider settings for each candidate via `SecretsManager.get_provider_settings_from_workflow()`.
- Clean up `chat_v0` input normalization.

## Interface And Catalog Gap

Current:

- `single_prompt_parameters_schema()` exposes `prompt` as `x-ag-type-ref: "prompt-template"`.
- `CATALOG_TYPES` exposes `prompt-template`, `model`, `llm`, and `llms`.
- Tests assert `prompt-template.llm_config.model` has `x-ag-type-ref: "model"`.
- No catalog schema exists for prompt root fallback fields.

Needed:

- Update the generated/dereferenced prompt-template schema.
- Ensure `fallback_configs.items` carries the full LLM config schema.
- Ensure fallback item `model` carries `x-ag-type-ref: "model"`.
- Add or update catalog tests.

## Services Gap

Current:

- Completion/chat services pass `PromptTemplate` through to SDK handlers.
- Managed `llm_v0` service is separate and already has its own `llms` flow.

Needed:

- Mostly no explicit service code change if SDK types parse and dump correctly.
- Service smoke tests should include prompt fallback fields to catch serialization loss.

## API Gap

Current:

- API catalog types are sourced from SDK `CATALOG_TYPES`.
- API does not implement special prompt fallback behavior.
- `llm_apps_service.py` only uses `x-ag-type-ref` for parameter inference.

Needed:

- Ensure catalog endpoint returns new prompt-template schema.
- Ensure no default-stripping or schema normalization drops non-primitive defaults incorrectly.
- Add API catalog tests for fallback fields.

## Web Schema/UI Gap

Current:

- Web resolves `x-ag-type-ref: "prompt-template"` dynamically.
- Prompt controls know how to render `messages`, nested `llm_config`, tools, and response format.
- Generic array/object controls can render arrays, but fallback entry add/remove/reorder UX needs confirmation.
- Model popover only edits primary `llm_config` or `llms[0]`.
- The model-parameters panel does not currently expose `chat_template_kwargs`, requested by issue #3996.
- Refine prompt modal only models/extracts messages and template format, and can drop extra root fields.
- Registry/display helpers generally pick the first primary model.

Needed:

- Confirm or add a usable array editor for `fallback_configs`.
- Make fallback item `model` render through the grouped model selector.
- Render `fallback_policy` as enum/choice.
- Render `retry_config` and `retry_policy` in an advanced section.
- Render `chat_template_kwargs` as a model parameter object field and preserve it unchanged.
- Preserve fallback fields in prompt refine flows and execution payload building.
- Optionally show fallback summary in registry/playground headers.

## Test Gap

Current:

- Tests cover prompt-template catalog exposure, interface references, and basic storage roundtrip.
- No tests cover fallback config storage, schema hints, handler fallback behavior, or web persistence.

Needed:

- SDK unit tests for Pydantic parsing/dumping and candidate construction.
- SDK unit tests proving new data-model defaults are null while runtime defaults are normalized separately.
- SDK handler tests for retry, fallback policy acceptance/rejection, and exhaustion.
- API catalog tests for new schema fields and x-ag metadata.
- Web tests for editing/preserving fallback fields.
