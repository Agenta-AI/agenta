# Fallback Models Research

## Scope

This captures the current code paths affected by prompt-template fallback models:

- SDK prompt-template types and catalog schemas
- SDK runtime handlers
- managed services wrapping SDK handlers
- API catalog type exposure
- web playground/schema controls and registry consumers
- related model-parameter request in GitHub issue #3996

## Related Issue: #3996

[GitHub issue #3996](https://github.com/Agenta-AI/agenta/issues/3996) requests `chat_template_kwargs` in the playground `Model Parameters` panel.

- Use case: some reasoning-capable models do not support `reasoning_effort` or soft prompt switches.
- Examples from the issue: IBM Granite uses `{"thinking": true/false}` and Qwen3 uses `{"enable_thinking": true/false}`.
- Desired behavior: expose an input in model parameters and pass `chat_template_kwargs` 1:1 to the API request.
- Current code search found no existing `chat_template_kwargs` implementation in the SDK/API/services/web paths checked.

## SDK Types

Current prompt-template types live in `application/sdk/agenta/sdk/utils/types.py`.

- `ModelConfig` is the primary LLM config shape. It has `model`, temperature, token, sampling, response format, stream, tools, and tool choice fields. `model` has `json_schema_extra={"x-ag-type-ref": "model"}`. It does not have `chat_template_kwargs`.
- `PromptTemplate` currently has only `messages`, `template_format`, `input_keys`, and `llm_config`.
- `PromptTemplate.format()` formats messages and `llm_config.response_format`, then returns a new `PromptTemplate`.
- `PromptTemplate.to_openai_kwargs()` emits one OpenAI/LiteLLM payload from `self.llm_config`.
- `AgLLM` and `AgLLMs` are separate catalog semantic types for the newer `llm_v0` interface. They are not currently used by legacy `PromptTemplate`.
- `CATALOG_TYPES` exposes `"model"`, `"llm"`, `"llms"`, and `"prompt-template"` schemas for the API catalog.

Relevant files:

- `application/sdk/agenta/sdk/utils/types.py`
- `application/api/oss/tests/pytest/unit/evaluators/test_catalog_types.py`
- `application/sdk/oss/tests/pytest/acceptance/integrations/test_prompt_template_storage.py`

## SDK Interfaces

Legacy completion/chat interfaces use `single_prompt_parameters_schema()`.

- The schema contains a top-level `prompt` property with `x-ag-type-ref: "prompt-template"`.
- Defaults currently include `messages`, `template_format`, `input_keys`, and `llm_config: {"model": "gpt-4o-mini"}`.
- Interface tests assert that `prompt` is a semantic reference, not inline `x-ag-type`.

The newer `llm_v0` interface is separate.

- It stores model attempts in `parameters.llms`.
- It already describes an ordered list of LLM configs.
- It does not expose prompt-template root fields like `fallback_configs`, `retry_config`, `retry_policy`, or `fallback_policy`.

Relevant files:

- `application/sdk/agenta/sdk/engines/running/interfaces.py`
- `application/api/oss/tests/pytest/unit/workflows/test_builtin_llm_interfaces.py`

## SDK Runtime

Legacy handlers:

- `completion_v0` validates `parameters.prompt`, loads `SinglePromptConfig`, resolves secrets for `config.prompt.llm_config.model`, formats the prompt, applies the OpenAI Responses bridge if tools require it, and calls `mockllm.acompletion()` once.
- `chat_v0` follows the same single-model path and appends runtime chat messages before calling `mockllm.acompletion()`.
- There is no prompt-template fallback loop and no user-configurable retry policy.
- `chat_v0` calls `inputs.pop("messages", None)` before normalizing `inputs`, so this path should be cleaned up while touching the handler.

Newer `llm_v0` handler:

- `_call_llm_with_fallback()` already iterates `parameters.llms`.
- It falls back on a hardcoded LiteLLM exception tuple: auth, rate limit, service unavailable, and not found.
- It fetches provider keys directly via `retrieve_secrets()` and sets LiteLLM globals.
- It does not use `SecretsManager.get_provider_settings_from_workflow()`, so it does not exactly match legacy prompt custom-provider behavior.

Other runtime pieces:

- `mockllm.acompletion()` has an internal fixed retry for closed HTTP clients and Azure API connection errors, but this is not user policy.
- `InvalidSecretsV0Error`, `PromptCompletionV0Error`, and `LLMUnavailableV0Error` already exist.

Relevant files:

- `application/sdk/agenta/sdk/engines/running/handlers.py`
- `application/sdk/agenta/sdk/litellm/mockllm.py`
- `application/sdk/agenta/sdk/managers/secrets.py`
- `application/sdk/agenta/sdk/engines/running/errors.py`

## Services

The service package wraps SDK handlers.

- `services/oss/src/completion.py` defines `CompletionConfig.prompt: PromptTemplate`, dumps it to JSON, and calls `completion_v0`.
- `services/oss/src/chat.py` defines `ChatConfig.prompt: PromptTemplate`, dumps it to JSON, and calls `chat_v0`.
- `services/oss/src/managed.py` exposes `llm_v0` separately as `agenta:builtin:llm:v0`.

These wrappers should pick up new SDK `PromptTemplate` fields automatically if they are part of the Pydantic model and preserved by `model_dump(exclude_none=True)`.

Relevant files:

- `application/services/oss/src/completion.py`
- `application/services/oss/src/chat.py`
- `application/services/oss/src/managed.py`

## API Catalog

The API exposes SDK catalog types directly.

- `get_workflow_catalog_types()` returns `CATALOG_TYPES`.
- `get_workflow_catalog_type()` returns one dereferenced schema by key.
- The web uses this to resolve `x-ag-type-ref: "prompt-template"`.
- `llm_apps_service.py` infers legacy config parameters and detects messages from `x-ag-type-ref` in schemas.

Relevant files:

- `application/api/oss/src/resources/workflows/catalog.py`
- `application/api/oss/src/services/llm_apps_service.py`

## Web Schema Consumption

The web mostly renders this through schema metadata.

- `fetchAgTypeSchema("prompt-template")` fetches the dereferenced schema from `/workflows/catalog/types/{agType}`.
- `agTypeSchemaAtomFamily` caches those schemas.
- `parametersSchemaAtomFamily` recursively enriches `x-ag-type-ref` nodes with the fetched catalog type schema.
- `SchemaPropertyRenderer` prioritizes `x-ag-type-ref`, then `x-ag-type`, then legacy `x-parameter`.
- `PromptSchemaControl.isPromptSchema()` treats `x-ag-type-ref: "prompt-template"` as a prompt.
- `schemaUtils.getLLMConfigSchema()` finds nested `llm_config`, `llmConfig`, or canonical `llms[0]`.
- `schemaUtils.getLLMConfigProperties()` renders additional LLM config fields as advanced parameters.
- `PlaygroundConfigSection` has a model-parameters popover that updates `prompt.llm_config` or `llms[0]`.
- Issue #3996 specifically targets this model-parameters panel for `chat_template_kwargs`.

Relevant files:

- `application/web/packages/agenta-entities/src/workflow/api/api.ts`
- `application/web/packages/agenta-entities/src/workflow/state/store.ts`
- `application/web/packages/agenta-entities/src/workflow/state/molecule.ts`
- `application/web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/SchemaPropertyRenderer.tsx`
- `application/web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/PromptSchemaControl.tsx`
- `application/web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/schemaUtils.ts`
- `application/web/packages/agenta-entity-ui/src/DrillInView/components/PlaygroundConfigSection.tsx`

## Web Request Payload

Playground execution sends stored prompt config through `ag_config`.

- `requestBodyBuilder` preserves raw server config shape, overlays edited prompt configs, strips legacy `system_prompt` and `user_prompt`, sanitizes `llm_config.response_format`, strips Agenta metadata, and writes `data.ag_config`.
- For workflow invoke payloads, `executionItems.ts` maps legacy request pieces into `data.inputs` and `data.parameters`.
- Since fallback fields are root prompt fields, they must survive prompt extraction, merge, sanitization, and metadata stripping.

Relevant files:

- `application/web/packages/agenta-entities/src/shared/execution/requestBodyBuilder.ts`
- `application/web/packages/agenta-playground/src/state/execution/executionItems.ts`
- `application/web/packages/agenta-entities/src/runnable/utils.ts`
- `application/web/packages/agenta-entities/src/workflow/state/runnableSetup.ts`

## Web Registry And Prompt Utilities

Registry/prompt utility code reads the primary model only today.

- `registryStore.pickModelFromParams()` recursively finds direct model fields or nested `llm_config.model`.
- `executionItems.getPromptModel()` reads `prompt.llm_config.model` for display/trace context.
- Gateway tools helpers preserve `llm_config` versus `llmConfig` paths.
- Refine prompt modal only models `messages`, `template_format`, `input_keys`, and `llm_config`; it drops any fallback fields when extracting a prompt.
- Variable extraction looks at prompt messages plus `llm_config.response_format` and `llm_config.tools`.

Relevant files:

- `application/web/oss/src/components/VariantsComponents/store/registryStore.ts`
- `application/web/packages/agenta-playground/src/state/execution/executionItems.ts`
- `application/web/oss/src/features/gateway-tools/prompt/atoms.ts`
- `application/web/oss/src/components/Playground/Components/Modals/RefinePromptModal/types.ts`
- `application/web/oss/src/components/Playground/Components/Modals/RefinePromptModal/hooks/useRefinePrompt.ts`
- `application/web/packages/agenta-shared/src/utils/chatPrompts.ts`

## Current Tests To Update Or Add

- SDK prompt-template storage roundtrip should include `retry_config`, `retry_policy`, `fallback_policy`, and `fallback_configs`.
- SDK/API/web tests should include `chat_template_kwargs` as a normal LLM config field.
- Catalog type tests should assert new prompt-template schema fields and `fallback_configs.items.properties.model["x-ag-type-ref"] == "model"`.
- Built-in interface tests should preserve `x-ag-type-ref: "prompt-template"` and defaults.
- Handler tests should cover primary success, retry before fallback, fallback by policy, policy rejection, and final exhaustion.
- Web tests should cover schema rendering/persistence of fallback root fields and fallback model model-selector metadata.
