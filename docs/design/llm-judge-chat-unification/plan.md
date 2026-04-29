# Plan

## Phase 1: Patch LLM-as-a-Judge Provider and Rendering Path

Objective: Add custom/self-hosted model support to `auto_ai_critique_v0` without changing its public config or output shape.

Steps:

1. Replace manual standard-provider key extraction with the same workflow-secret path used by chat/completion.
2. Resolve provider settings with `SecretsManager.get_provider_settings_from_workflow(model)`.
3. Call the LLM using the resolved provider settings and evaluator `response_format`, without injecting temperature or other optional model parameters.
4. Reuse the existing `PromptTemplate` rendering path or a small shared rendering helper that mirrors it for flat `prompt_template`.
5. Preserve current context variables: direct input keys, `inputs`, `outputs`, `prediction`, `ground_truth`, `correct_answer`, `reference`, `trace`, and `parameters`.
6. Keep result parsing and return behavior unchanged.

Milestone: A judge evaluator using a custom model configured in the UI can run successfully with no stored config migration.

## Phase 2: Extract Common Runtime Helper

Objective: Remove duplicated provider resolution, prompt rendering, LiteLLM/mockllm call construction, and response extraction code from judge, chat, and completion.

Steps:

1. Introduce an internal helper in the runtime layer, likely near `sdk/agenta/sdk/engines/running/handlers.py` initially or a new focused module if size warrants it.
2. Move provider resolution into one function that accepts a model string and returns provider settings or raises `InvalidSecretsV0Error` with the model.
3. Move prompt rendering into one function that accepts messages, template format, and variables/context.
4. Move LLM call execution into one function that accepts OpenAI/LiteLLM kwargs plus provider settings.
5. Keep adapter-specific output extraction in `completion_v0`, `chat_v0`, and `auto_ai_critique_v0` so public outputs remain unchanged.
6. Add tests around the helper and existing handlers before and after extraction.
7. Use `variable-and-template-analysis.md` as the decision checklist for which context variables and formatting behavior are intentionally shared versus handler-specific.

Milestone: Chat, completion, and judge use one runtime call path for provider resolution and prompt rendering.

## Phase 3: Frontend Model Transform Alignment

Objective: Keep evaluator UI model selection aligned with app prompt UI and custom-provider options without introducing new judge controls.

Steps:

1. Review `nestEvaluatorConfiguration(...)`, `flattenEvaluatorConfiguration(...)`, and `nestEvaluatorSchema(...)` for model field handling.
2. Ensure flat evaluator `model` maps to nested `prompt.llm_config.model` and back without losing custom/self-hosted model values.
3. Ensure the model schema remains recognizable by `GroupedChoiceControl` / `SelectLLMProviderBase` and receives custom-provider option groups.
4. Avoid adding temperature, max tokens, tools, or other `llm_config` fields to the LLM-as-a-judge UI in this iteration.
5. Add focused frontend tests for transforming a custom model key through nest -> edit/no-op -> flatten.

Milestone: The UI can select and persist custom model values for LLM-as-a-judge, and runtime can execute them.

## Sequencing

Implement Phase 1 first because it fixes the user-visible bug with the least migration risk. Do Phase 2 after tests establish baseline behavior, since helper extraction is a refactor. Do Phase 3 after or alongside Phase 1 validation, scoped only to model selection/persistence.
