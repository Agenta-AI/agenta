# Variable and Template Analysis

This document captures what data each runtime handler receives, what variables prompts can access, and which template formats are currently honored. It is the decision checklist for unifying rendering without accidentally changing public behavior.

## Current Inputs by Handler

`completion_v0(parameters, inputs)`:

- `parameters` must be a dict with a `prompt` object matching `SinglePromptConfig`.
- `prompt.messages` is a list of message dicts/objects with at least `role` and `content`; optional message fields such as `name`, `tool_calls`, and `tool_call_id` are preserved by `PromptTemplate`.
- `prompt.template_format` can be `curly`, `fstring`, or `jinja2`; default is `curly`.
- `prompt.input_keys` is optional. When present, the runtime requires the exact same key set in `inputs`.
- `prompt.llm_config` can include model parameters such as `model`, `temperature`, `top_p`, `max_tokens`, penalties, `reasoning_effort`, `response_format`, `tools`, and `tool_choice`. `to_openai_kwargs()` only includes values that are non-null.
- `inputs` is a dict. The schema allows additional properties, so values may be strings, dicts, lists, numbers, booleans, or null at runtime even though the Python signature is typed as `Dict[str, str]`.
- Prompt variables are exactly the top-level keys from `inputs`.

`chat_v0(parameters, inputs, messages)`:

- `parameters.prompt` has the same `SinglePromptConfig` shape as completion.
- `inputs` is typed as optional and uses the same additional-properties schema as completion. In the current implementation it effectively must be a dict because the handler calls `inputs.pop("messages", None)` before checking for `None`.
- The chat input schema also permits a `messages` field for normalized chat history.
- The handler removes `inputs["messages"]` before validating `input_keys`, so `messages` is not treated as a template variable through `inputs`.
- If `inputs` is present, prompt messages are formatted with the top-level keys from `inputs`. If `inputs` is absent, prompt messages are not formatted.
- The separate `messages` argument is appended to the formatted prompt's OpenAI `messages` list after prompt rendering. Those appended chat messages are not themselves template-rendered by this handler.

`auto_ai_critique_v0(parameters, inputs, outputs, trace)`:

- `parameters` must stay a flat dict. Relevant fields are `prompt_template`, `model`, `response_type`, `json_schema`, `correct_answer_key`, `threshold`, `version`, and optionally `template_format`.
- `prompt_template` must be a list of message dicts. The current implementation reads `message["role"]` and `message["content"]` only.
- `inputs` must be a dict when provided. Its top-level keys are added directly into the render context, and the full object is also available as `inputs`.
- `outputs` may be a dict or string. It is exposed as both `outputs` and `prediction`.
- If `correct_answer_key` points to a key in `inputs`, that value is exposed as `ground_truth`, `correct_answer`, and `reference`.
- `trace`, when provided, is exposed as `trace`.
- The full flat evaluator config is exposed as `parameters`.

## Variable Value Formats

- Direct input variables keep their original Python/JSON values. For example, an input row field can be a string, number, boolean, dict, list, or null.
- In `curly` mode, dicts and lists are JSON-stringified when inserted into message text. Scalars are converted with `str(...)`.
- In `fstring` mode, Python `str.format(**kwargs)` is used. Nested dict/list traversal is not provided by the formatter except through normal Python format behavior on supplied values.
- In `jinja2` mode, variables are passed to a sandboxed Jinja environment, so templates can access nested dict/list structures using Jinja syntax.
- For chat/completion response formats, `PromptTemplate` recursively substitutes variables inside response-format dict keys and values. Judge currently constructs `response_format` separately and does not template-render `json_schema`.

## Template Formats

`curly`:

- Uses `{{variable}}` placeholders.
- Supports nested access through `resolve_any(...)`, including dot notation, JSONPath, JSON Pointer, and selector-style resolvers where available.
- Raises when placeholders remain unresolved.

`fstring`:

- Uses Python format syntax such as `{variable}`.
- Missing variables raise formatting errors.
- Judge defaults to `fstring` only for `version == "2"`; otherwise it defaults to `curly`.

`jinja2`:

- Uses Jinja syntax such as `{{ variable }}`.
- Renders through `SandboxedEnvironment`.
- Chat/completion raise template errors through `PromptTemplate`. Judge's local helper currently logs Jinja template errors and returns the original content for Jinja-specific `TemplateError`, which is a behavioral difference to decide on before full unification.

## What WP-B1 changes here

- The judge backend patch (Phase 1) does not broaden the judge config. It reuses provider resolution and keeps the existing message-rendering path (`_format_with_template`), the flat `prompt_template` input, and the existing output parser.
- The judge LLM call stops sending `temperature`. Optional kwargs are only sent when they come from an existing supported config path.
- The low-level rendering helper (Phase 2) accepts arbitrary JSON-like context values, not only strings, because current inputs and judge variables can be dicts/lists and `curly` intentionally stringifies them only at substitution time.

## What WP-B1 does **not** change here

The following are out of scope for WP-B1 and tracked in the RFC's WP-B2 / WP-B3:

- Aligning message rendering across services so judge, chat, and completion share one renderer (WP-B2).
- Rendering variables inside `json_schema` / `response_format` (WP-B2).
- Aligning Jinja error behavior across services (WP-B2 — the RFC decides on raise across all services).
- Adding `mustache` as a new template format (WP-B3).

The helper boundary (described in `implementation-notes.md`) is deliberately narrow so these later WPs can layer on top without re-litigating WP-B1's scope.
