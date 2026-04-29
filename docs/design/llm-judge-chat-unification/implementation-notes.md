# Implementation Notes

## Backend Patch Shape

`auto_ai_critique_v0` should keep accepting the same flat parameters.

Replace this pattern:

- retrieve all secrets
- manually copy selected provider keys into LiteLLM globals
- call `litellm.acompletion(model=model, ...)`

With this pattern:

- call `await SecretsManager.ensure_secrets_in_workflow()`
- call `SecretsManager.get_provider_settings_from_workflow(model)`
- if missing, raise `InvalidSecretsV0Error(expected="dict", got=provider_settings, model=model)`
- call the shared completion function with `messages`, `response_format`, and resolved provider settings

Preserve the existing JSON parsing and result normalization after the LLM call.

Do not inject `temperature` into the judge LLM call. The current handler hard-codes `temperature=0.01`, but the migration should intentionally stop doing that because several newer models reject temperature. This is a behavior-compatible change at the evaluator contract level: the flat config and output shape stay unchanged, while the runtime avoids sending an unsupported optional provider parameter.

## Prompt Rendering

Two acceptable Phase 1 options:

- Minimal: keep `auto_ai_critique_v0` using `_format_with_template(...)` for message content, but move provider execution to the shared path. This is lowest risk and directly fixes custom models.
- Better: construct a `PromptTemplate(messages=..., template_format=..., llm_config=...)` and call `format(**context)`, then merge evaluator-specific response format into call kwargs. This aligns formatting with chat/completion sooner.

If using `PromptTemplate`, do not expose new config fields. The constructed `llm_config` should be internal and only include the model plus response format needed for execution. It should not set temperature, max tokens, top p, tools, or other optional model parameters unless those are explicitly introduced in a later product change.

## Shared Helper Boundary

Prefer a helper API that separates concerns:

```python
async def resolve_provider_settings_for_model(model: str) -> Dict[str, Any]:
    ...

def render_messages(
    *,
    messages: List[Dict[str, Any]],
    template_format: str,
    context: Dict[str, Any],
) -> List[Dict[str, Any]]:
    ...

async def call_llm_with_provider_settings(
    *,
    provider_settings: Dict[str, Any],
    kwargs: Dict[str, Any],
) -> Any:
    ...
```

Keep response interpretation in each handler:

- `completion_v0`: content/refusal/parsed/tool calls.
- `chat_v0`: assistant message dump.
- `auto_ai_critique_v0`: raw message content -> JSON parse -> evaluator dict/bool/score normalization.

## Frontend Scope

Do not add new LLM-as-a-judge config controls for:

- temperature
- max tokens
- top p
- tools
- tool choice
- reasoning effort

The frontend change should be limited to model support and transform robustness:

- confirm `model` keeps `x-ag-type-ref: model` through the nested prompt schema
- confirm custom model keys from `useLLMProviderConfig()` are valid selections
- confirm `flattenEvaluatorConfiguration(...)` writes the selected model back to the flat `model` field

If a future feature wants more judge model parameters, that should be a separate design because it changes product behavior and stored evaluator config semantics.

## Compatibility Rules

- Existing evaluator revisions continue to store flat params.
- Existing SDK usage continues to fetch and pass evaluator config as flat params.
- Existing evaluation result shape is unchanged.
- Existing chat/completion behavior is unchanged except for shared helper internals after Phase 2.
