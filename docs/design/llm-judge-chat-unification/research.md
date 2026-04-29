# Research

## Backend Runtime Findings

- `auto_ai_critique_v0` lives in `sdk/agenta/sdk/engines/running/handlers.py`. It validates flat evaluator parameters, builds a context from `parameters`, `inputs`, `outputs`, and `trace`, renders `prompt_template`, calls LiteLLM, parses JSON if possible, and returns evaluator result data.
- `auto_ai_critique_v0` currently calls `SecretsManager.retrieve_secrets()` and manually assigns `litellm.openai_key`, `litellm.anthropic_key`, `litellm.openrouter_key`, `litellm.cohere_key`, `litellm.azure_key`, and `litellm.groq_key`. This skips the custom provider resolution path.
- `completion_v0` and `chat_v0` use `SecretsManager.ensure_secrets_in_workflow()` and `SecretsManager.get_provider_settings_from_workflow(config.prompt.llm_config.model)`. This resolves provider-specific settings and custom provider models.
- `completion_v0` and `chat_v0` call `mockllm.acompletion(...)` under `mockllm.user_aws_credentials_from(provider_settings)` with provider settings merged into the request.
- `PromptTemplate` in `sdk/agenta/sdk/utils/types.py` supports `curly`, `fstring`, and `jinja2`, renders message content, recursively substitutes variables into response-format JSON, and converts prompt config into OpenAI/LiteLLM kwargs.
- `auto_ai_critique_v0` has a local render path over `prompt_template` and `response_format` construction, so rendering behavior can drift from chat/completion.
- `auto_ai_critique_v0` currently sends `temperature=0.01`. This should not be preserved in the shared call path because some newer models reject temperature. The compatibility target is the evaluator config/output contract, not preserving an unsupported optional provider kwarg.

## Frontend Findings

- Evaluator UI config is transformed in `web/packages/agenta-entities/src/runnable/evaluatorTransforms.ts`.
- `nestEvaluatorConfiguration(...)` maps flat evaluator params to nested UI shape:
  `{ prompt: { messages: prompt_template, llm_config: { model } }, feedback_config, advanced_config }`.
- `flattenEvaluatorConfiguration(...)` maps the nested UI shape back to the flat backend contract:
  `{ prompt_template: prompt.messages, model: llmConfig?.model, ... }`.
- `nestEvaluatorSchema(...)` builds a prompt-like schema where `llm_config.properties` currently contains only `model`.
- The model selector UI supports custom provider models through `useLLMProviderConfig()` and `SelectLLMProviderBase`, as long as the schema is recognized as a model field.

## SDK and Contract Findings

- `auto_ai_critique_v0_interface` declares flat evaluator parameters, with `model` marked as `x-ag-type-ref: model`.
- The flat config shape is used by evaluator workflows and evaluation execution paths, so changing it directly would create unnecessary migration risk.
- The SDK-generated backend clients expose workflow/evaluator revision data and evaluation run APIs. The safest path is to preserve stored parameters and handler outputs while changing internals.

## Gotchas

- `chat_v0` currently mutates `inputs` with `inputs.pop("messages", None)` without guarding `inputs is None`. This is adjacent but out of scope unless helper extraction touches that path.
- `threshold = parameters.get("threshold") or 0.5` rejects integer thresholds because the later validation requires `float`. Avoid changing this unless tests already cover it or product explicitly asks.
- Do not carry over the hard-coded `temperature=0.01` from `auto_ai_critique_v0`; preserving it would keep breaking models that reject temperature. The safer compatibility boundary is no stored config migration and unchanged result shape.
- The frontend should not start persisting nested `prompt.llm_config` as the backend source of truth for old judge evaluators. Flatten back to `model`.
