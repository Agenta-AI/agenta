# Fallback Models Proposal

## Goal

Extend prompt templates without changing the existing meaning of `llm_config`.

Also include [GitHub issue #3996](https://github.com/Agenta-AI/agenta/issues/3996): `chat_template_kwargs` should be a model parameter exposed in the playground and passed through unchanged to the provider request.

All new fields default to `null` in the data model. Runtime applies field-specific built-in behavior.

Root fields on `PromptTemplate`:

```python
class PromptTemplate(BaseModel):
    messages: Messages
    template_format: Literal["curly", "fstring", "jinja2"] = "curly"
    input_keys: list[str] | None = None

    llm_config: LLMConfig
    fallback_configs: list[LLMConfig] | None = None
    retry_config: RetryConfig | None = None
    retry_policy: RetryPolicy | None = None
    fallback_policy: FallbackPolicy | None = None
```

## Semantics

Rule for new fields:

```text
data model default: null
runtime behavior default: field-specific built-in behavior
```

```text
llm_config
  Primary LLM config.

fallback_configs
  Ordered fallback LLM configs.
  Same shape as llm_config.
  Optional/null in stored config.
  Runtime default: [].

retry_config
  Retry count and delay settings.
  Applies to each attempted LLM config:
  primary and every fallback.
  Optional/null in stored config.
  Runtime default: max_retries=0 and delay_ms=0.

retry_policy
  Controls which error categories can retry the same LLM config.
  Applies to each attempted LLM config:
  primary and every fallback.
  Optional/null in stored config.
  Runtime default: off.

fallback_policy
  Decides whether the final error for one LLM config can move execution
  to the next fallback LLM config.
  Optional/null in stored config.
  Runtime default: off.
```

New field defaults:

```text
fallback_configs
  data model: null
  runtime: []

retry_config
  data model: null
  runtime: max_retries=0, delay_ms=0

retry_policy
  data model: null
  runtime: off

fallback_policy
  data model: null
  runtime: off

chat_template_kwargs
  data model: null
  runtime: omit from provider request
```

## LLM Config

Use one reusable LLM config shape for primary and fallback entries.

```python
class LLMConfig(BaseModel):
    model: str = Field(..., json_schema_extra={"x-ag-type-ref": "model"})
    temperature: float | None = None
    max_tokens: int | None = None
    top_p: float | None = None
    frequency_penalty: float | None = None
    presence_penalty: float | None = None
    reasoning_effort: Literal["none", "low", "medium", "high"] | None = None
    chat_template_kwargs: dict | None = None
    response_format: ResponseFormat | None = None
    stream: bool | None = None
    tools: list[dict] | None = None
    tool_choice: Literal["none", "auto"] | dict | None = None
```

`fallback_configs` item rules:

- `model` is required.
- Every other field is optional.
- No retry/fallback fields are nested inside `LLMConfig`.
- `chat_template_kwargs` is part of `LLMConfig`, so it applies to both primary and fallback configs.

## Retry Policy

Keep this minimal and explicit.

```python
class RetryConfig(BaseModel):
    max_retries: int = 0
    delay_ms: int = 0
```

The runtime may extend delay strategy later, but the initial contract should stay small.

`RetryPolicy` is an enum and must be explicitly enabled:

```text
off
  no retry

availability
  retry provider-side availability failures such as timeout, network errors, 5xx, and 503

capacity
  availability + 429/rate-capacity errors

transient
  capacity + temporary upstream/resource conflicts such as 409/423

any
  retry any classified provider-call error
```

## Fallback Policy

```text
off
  no fallback

availability
  network errors, timeout, 5xx, 503

capacity
  availability + 429/rate limit/overload

access
  capacity + 401/403

context
  access + context-window or token-limit provider errors

any
  context + 400/404/422 provider-call errors
```

Never fallback on local errors:

```text
missing input key
invalid prompt template
malformed messages before provider call
local schema/config validation error
```

## Runtime Loop

```text
llm_configs = [llm_config, *fallback_configs]

for current_llm_config in llm_configs:
  run current_llm_config with retry_config and retry_policy

  if success:
    return response

  if max_retries:
    if fallback_policy allows fallback given final error:
      continue to next current_llm_config

  fail with final error

fail with last error
```

## SDK Runtime Changes

Add shared prompt-template helpers near `completion_v0` and `chat_v0`:

- build candidates from `prompt.llm_config` and `prompt.fallback_configs`
- run one candidate with `prompt.retry_config` and `prompt.retry_policy`
- classify final errors
- evaluate `prompt.fallback_policy`
- resolve provider settings per candidate through `SecretsManager.get_provider_settings_from_workflow()`
- preserve `_apply_responses_bridge_if_needed()` per candidate

Keep `PromptTemplate.to_openai_kwargs()` primary-only when called without arguments. Pass a specific LLM config to the same method for candidate-specific kwargs.

## Catalog And X-Ag Schema

Expose the new fields through the existing `prompt-template` catalog type.

Expected schema behavior:

```json
{
  "fallback_configs": {
    "default": null,
    "anyOf": [
      {
        "type": "array",
        "x-ag-type-ref": "llm-configs",
        "items": {
          "type": "object",
          "x-ag-type-ref": "llm-config",
          "properties": {
            "model": {
              "type": "string",
              "x-ag-type-ref": "model"
            }
          },
          "required": ["model"]
        }
      },
      { "type": "null" }
    ]
  }
}
```

Use the same schema-default rule for `retry_config`, `retry_policy`, `fallback_policy`, and `chat_template_kwargs`: nullable, with `default: null`.

Add semantic catalog keys if useful for frontend rendering:

- `llm-config`
- `llm-configs`
- `retry-policy`
- `fallback-policy`

The minimum requirement is that `fallback_configs.items.properties.model` keeps `x-ag-type-ref: "model"` so the frontend can reuse the grouped model selector.

## Services

Service wrappers should remain thin:

- keep `CompletionConfig.prompt: PromptTemplate`
- keep `ChatConfig.prompt: PromptTemplate`
- rely on SDK model parsing and `model_dump()`

No service-specific fallback policy should be introduced.

## Web

Schema-driven rendering should handle most fields automatically if catalog schemas are correct.

Required web follow-up:

- make sure `fallback_configs` can be added, removed, and reordered in the prompt editor/drill-in UI
- make sure each fallback entry renders `model` with the grouped model selector
- expose `chat_template_kwargs` in model parameters and pass it through 1:1
- make sure `retry_config`, `retry_policy`, and `fallback_policy` appear as prompt root fields, not under `llm_config`
- preserve fallback fields through prompt extraction, execution payload building, and commit flows
- update model display helpers only if we want to show fallback summary in registry/playground headers
- update refine prompt modal so it preserves unknown prompt root fields, or explicitly includes fallback fields

## Backward Compatibility

- Existing prompt templates remain valid.
- Existing `llm_config.model` remains the primary model.
- Existing `to_openai_kwargs()` callers keep getting the primary config only.
- Omitted/null `fallback_configs` means runtime `[]`.
- Omitted/null `retry_config` means runtime `max_retries=0` and `delay_ms=0`.
- Omitted/null `retry_policy` means runtime `off`.
- Omitted/null `fallback_policy` means runtime `off`.
- Omitted/null `chat_template_kwargs` means no `chat_template_kwargs` key is sent.
