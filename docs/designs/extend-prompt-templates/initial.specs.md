# Fallback Models Initial Specs

## Prompt Template Shape

Add fallback and retry behavior as optional root fields on `PromptTemplate`, not inside `llm_config`.

```python
class PromptTemplate(BaseModel):
    messages: Messages
    template_format: Literal["curly", "fstring", "jinja2"] = "curly"
    input_keys: list[str] | None = None

    llm_config: LLMConfig
    fallback_llm_configs: list[LLMConfig] | None = None
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

fallback_llm_configs
  Ordered fallback LLM configs.
  Same shape as llm_config.
  Optional/null in stored config.
  Runtime default: [].

retry_policy
  Applies to each attempted LLM config:
  primary and every fallback.
  Optional/null in stored config.
  Runtime default: built-in retry policy.

fallback_policy
  Decides whether the final error for one LLM config can move execution
  to the next fallback LLM config.
  Optional/null in stored config.
  Runtime default: off.
```

New field defaults:

```text
fallback_llm_configs
  data model: null
  runtime: []

retry_policy
  data model: null
  runtime: built-in retry policy

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

For `fallback_llm_configs` items, `model` is required and all other fields are optional.

## JSON Schema Hints

```json
{
  "fallback_llm_configs": {
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

Use the same schema-default rule for `retry_policy`, `fallback_policy`, and `chat_template_kwargs`: nullable, with `default: null`.

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

any
  access + 400/404/422 provider-call errors
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
