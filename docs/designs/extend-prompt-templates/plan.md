# Fallback Models Plan

## Task 1: SDK Contract

1. Add optional `RetryPolicy`, `FallbackPolicy`, and prompt fallback fields to SDK types.
2. Keep `ModelConfig` as the reusable LLM config shape.
3. Add `chat_template_kwargs` to `ModelConfig`.
4. Ensure every new field defaults to `null` in the data model:
   - `fallback_llm_configs`
   - `retry_policy`
   - `fallback_policy`
   - `chat_template_kwargs`
5. Normalize behavior internally at runtime:
   - `fallback_llm_configs: null` -> `[]`
   - `retry_policy: null` -> built-in retry policy
   - `fallback_policy: null` -> `off`
   - `chat_template_kwargs: null` -> omit from provider kwargs
6. Keep `to_openai_kwargs()` primary-only.
7. Add internal helpers for:
   - `[llm_config, *fallback_llm_configs]`
   - candidate-specific OpenAI/LiteLLM kwargs
   - retry policy defaults

Tests:

- prompt-template parses old JSON
- prompt-template parses new JSON
- new fields dump as null/omitted in stored data unless explicitly set
- omitted/null new fields normalize to runtime behavior defaults
- `chat_template_kwargs` dumps into LLM kwargs unchanged
- null `chat_template_kwargs` is omitted from LLM kwargs
- fallback item requires `model`
- dump with `exclude_none=True` preserves explicit fallback fields

## Task 2: Catalog Schema

1. Add schema metadata for fallback fields through `PromptTemplate.model_json_schema()`.
2. Ensure fallback item `model` keeps `x-ag-type-ref: "model"`.
3. Ensure `chat_template_kwargs` appears in primary and fallback LLM config schemas.
4. Add semantic catalog keys if needed:
   - `llm-config`
   - `llm-configs`
   - `retry-policy`
   - `fallback-policy`
5. Do not encode runtime defaults as data-model schema defaults.
6. Let frontend materialize UI/runtime defaults client-side when needed.

Tests:

- catalog type includes prompt-template fallback root fields
- `fallback_llm_configs.items.properties.model["x-ag-type-ref"] == "model"`
- catalog type includes `chat_template_kwargs`
- existing prompt-template interface tests still pass

## Task 3: SDK Runtime

1. Add error classifier:
   - `availability`: network, timeout, 5xx, 503
   - `capacity`: availability + 429/rate-limit/overload
   - `access`: capacity + 401/403
   - `any`: access + 400/404/422 provider-call errors
2. Add `should_fallback(error, fallback_policy)`.
3. Add `run_llm_config_with_retry_policy()`.
4. Add prompt fallback runner:

```text
llm_configs = [llm_config, *fallback_llm_configs]

for current_llm_config in llm_configs:
  run current_llm_config with retry_policy

  if success:
    return response

  if max_retries:
    if fallback_policy allows fallback given final error:
      continue to next current_llm_config

  fail with final error

fail with last error
```

5. Use the shared runner from `completion_v0`.
6. Use the shared runner from `chat_v0`.
7. Normalize `chat_v0` inputs before mutating them.
8. Preserve `_apply_responses_bridge_if_needed()` per candidate.
9. Resolve provider settings per candidate through `SecretsManager.get_provider_settings_from_workflow()`.

Tests:

- primary success does not touch fallbacks
- retry happens before fallback
- `availability` fallback handles 5xx/timeout
- `capacity` fallback handles 429
- `access` fallback handles 401/403
- `any` fallback handles 400/404/422 provider-call errors
- local prompt formatting errors do not fallback
- all candidates exhausted raises final/aggregate unavailable error

## Task 4: Services And API

1. Verify services parse and dump new `PromptTemplate` fields unchanged.
2. Add service smoke fixture with fallback fields.
3. Verify API catalog endpoint returns updated schemas.
4. Verify catalog default normalization does not drop required schema information.

Tests:

- service completion/chat accepts fallback prompt config
- API catalog type endpoint exposes fallback fields

## Task 5: Web Schema And Editing

1. Verify `x-ag-type-ref: "prompt-template"` dereferencing includes fallback fields.
2. Verify generic array/object controls can edit `fallback_llm_configs`.
3. If generic controls are not enough, add a compact prompt fallback editor:
   - add fallback config
   - remove fallback config
   - reorder fallback config
   - model selector per fallback config
4. Render `fallback_policy` as enum/choice.
5. Render `retry_policy` as a small inline object or advanced section.
6. Expose `chat_template_kwargs` in the model-parameters panel for issue #3996.
7. Keep primary model popover focused on `llm_config`; do not overload it with fallback editing unless needed.

Tests:

- fallback policy can be edited and committed
- fallback model can be added and committed
- fallback model `model` uses grouped model options
- `chat_template_kwargs` can be edited and is sent unchanged
- fallback fields survive reload

## Task 6: Web Preservation Paths

1. Preserve fallback root fields in request payload building.
2. Preserve fallback root fields in prompt refinement.
3. Preserve fallback root fields in gateway tools prompt updates.
4. Update model display helpers only if product wants fallback model summaries.

Tests:

- execution request includes fallback root fields
- refine prompt keeps fallback fields when accepting refined messages
- registry still shows primary model

## Task 7: Documentation And Migration

1. Update SDK docs/examples for prompt-template fallback.
2. Add one JSON example and one Python example.
3. Document `chat_template_kwargs` pass-through for Granite/Qwen-style thinking controls.
4. Document fallback policy categories.
5. Document that local prompt/input errors do not fallback.
6. Document that all new fields default to `null` in stored data.
7. Document runtime default behavior:
   - `fallback_llm_configs: null` -> no fallback models
   - `fallback_policy: null` -> `off`
   - `retry_policy: null` -> built-in retry policy
   - `chat_template_kwargs: null` -> omitted from provider kwargs
