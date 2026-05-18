# Research

## Current Runtime Map

The live SDK path in this checkout is `sdks/python/agenta/...`.

Relevant files:

- `sdks/python/agenta/sdk/utils/templating.py`
- `sdks/python/agenta/sdk/utils/types.py`
- `sdks/python/agenta/sdk/engines/running/handlers.py`
- `sdks/python/oss/tests/pytest/unit/test_render_template_helper.py`
- `sdks/python/oss/tests/pytest/unit/test_auto_ai_critique_v0_runtime.py`

## Low-Level Renderer

`sdks/python/agenta/sdk/utils/templating.py` owns `render_template(...)`.

It renders one string at a time. It supports `curly`, `fstring`, and `jinja2`. It does not know about messages, response formats, evaluator schemas, provider settings, or handler output parsing.

This is the right boundary for WP-B1. It is not enough for WP-B2, because WP-B2 needs one shared caller for structured prompt messages and JSON-like return configuration.

## Message Shapes

The local Agenta `Message` model lives in `sdks/python/agenta/sdk/utils/types.py`.

Current shape:

- `role`: one of `developer`, `system`, `user`, `assistant`, `tool`, or `function`.
- `content`: `None`, a string, or a list of content parts.
- Supported content parts: `text`, `image_url`, and `file`.
- Other fields include `name`, `tool_calls`, and `tool_call_id`.

Provider APIs also allow structured message content.

OpenAI documentation shows message content as either a string or an array of typed content parts. The current OpenAI docs include text, image, and file-like input parts across the Responses, Chat Completions, and Messages surfaces.

Reference:

- `https://platform.openai.com/docs/guides/chat-completions`
- `https://platform.openai.com/docs/api-reference/chat/create`
- `https://platform.openai.com/docs/api-reference/messages/object`

Anthropic documentation also describes message `content` as either a string or an array of typed content blocks. Those blocks include text, image, `tool_use`, and `tool_result`.

Reference:

- `https://docs.anthropic.com/en/api/messages`
- `https://docs.anthropic.com/en/api/messages-examples`

WP-B2 should not accept arbitrary provider message objects. It should support the local Agenta message contract and the judge's current dict messages. It should render only text-bearing fields and preserve non-text parts unchanged.

## Completion And Chat

`completion_v0(...)` and `chat_v0(...)` live in `sdks/python/agenta/sdk/engines/running/handlers.py`.

Both handlers parse `parameters` into `SinglePromptConfig`. They then call `config.prompt.format(**variables)`.

`PromptTemplate.format(...)` lives in `sdks/python/agenta/sdk/utils/types.py`.

Current `PromptTemplate.format(...)` behavior:

- It validates `input_keys`.
- It loops over `self.messages`.
- It renders each message `content` through `PromptTemplate._format_with_template(...)`.
- It preserves message fields such as `role`, `name`, `tool_calls`, and `tool_call_id`.
- It calls `_format_llm_config(...)`.
- `_format_llm_config(...)` renders variables inside `llm_config.response_format` by recursively walking the JSON-like object.

`PromptTemplate._format_with_template(...)` already calls `render_template(...)`. It converts low-level errors into `TemplateFormatError`. For Jinja errors, it raises.

## Judge

`auto_ai_critique_v0(...)` lives in `sdks/python/agenta/sdk/engines/running/handlers.py`.

The judge keeps a flat evaluator config. It reads:

- `prompt_template`
- `model`
- `response_type`
- `json_schema`
- `correct_answer_key`
- `threshold`
- `version`
- `template_format`

The judge builds its render context in the handler. It exposes direct input keys, `inputs`, `outputs`, `prediction`, `ground_truth`, `correct_answer`, `reference`, `trace`, and `parameters`.

The judge currently renders messages with a local helper named `_format_with_template(...)` in `handlers.py`. That helper calls `render_template(...)`, but it has a special Jinja rule. If Jinja raises a template error, the helper logs a warning and returns the original unrendered content.

The judge builds `response_format` directly from `response_type` and `json_schema`.

Current judge response-format behavior:

- `response_type` becomes `{"type": response_type}`.
- If `response_type == "json_schema"`, the raw `json_schema` is attached.
- Variables inside `json_schema` are not rendered.

## Existing Tests

WP-B1 added direct tests for the low-level renderer and judge runtime patch:

- `test_render_template_helper.py`
- `test_auto_ai_critique_v0_runtime.py`

WP-B2 should keep those tests. It should add tests for the new top-level renderers, because WP-B2 is not about one string. It is about structured message and JSON rendering.
