# Context

## Problem

The LLM-as-a-judge evaluator (`auto_ai_critique_v0`) and the chat/completion app handlers (`chat_v0`, `completion_v0`) both execute LLM calls, but they do not share the same provider resolution and prompt rendering path. Chat/completion can use custom or self-hosted models configured through the UI because they resolve provider settings through `SecretsManager.get_provider_settings_from_workflow(...)`. LLM-as-a-judge manually extracts a small set of standard provider keys and calls LiteLLM with the raw model string, so configured custom models are not reliably usable.

## Goals

- Let LLM-as-a-judge use all models available to chat/completion, including custom/self-hosted models configured in the UI.
- Keep the existing LLM-as-a-judge flat config contract unchanged: `prompt_template`, `model`, `response_type`, `json_schema`, `correct_answer_key`, `threshold`, `version`.
- Keep the existing LLM-as-a-judge output shape unchanged.
- Reuse the same provider resolution and prompt rendering semantics across judge, chat, and completion.
- Extract shared runtime helper code after the safe patch so future drift is less likely.
- Keep frontend changes scoped to model-selection compatibility for evaluator config.

## Non-Goals

- Do not migrate existing evaluators to `agenta:builtin:llm:v0`.
- Do not add new LLM-as-a-judge controls for temperature, max tokens, tools, or other model parameters in this iteration.
- Do not change evaluator result parsing semantics.
- Do not change the evaluation SDK public contract.
- Do not break stored evaluator revisions or existing playground flatten/nesting behavior.

## Scope Clarification

The earlier “include full `llm_config`” idea should be narrowed. For this plan, frontend work means preserving model selection through the existing nested UI shape and ensuring custom/self-hosted model options remain available and persisted back to the flat `model` field. It does not mean exposing temperature, max tokens, tools, or response-format controls as new judge configuration features.
