# Fallback Models Initial Specs

## Prompt Template Shape

Add fallback and retry behavior as optional root fields on `PromptTemplate`, not inside `llm_config`.

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

## Field Semantics

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

## LLM Config Shape

Fallback configs use the same schema as the primary config.

```python
class LLMConfig(BaseModel):
    model: str
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

For `fallback_configs` items, `model` is required and all other fields are optional.

## JSON Schema Hints

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

## Retry Policy

```python
class RetryConfig(BaseModel):
    max_retries: int = 0
    delay_ms: int = 0
```

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

Local prompt/template errors do not fallback:

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
