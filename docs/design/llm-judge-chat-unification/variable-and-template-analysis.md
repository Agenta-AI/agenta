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

## Decisions Needed for Unification

- Phase 1 should not broaden the judge config. It should reuse provider resolution and preferably reuse the same message-rendering semantics while preserving the flat `prompt_template` input and existing output parser.
- The shared render helper should accept arbitrary JSON-like context values, not only strings, because current inputs and judge variables can be dicts/lists and `curly` mode intentionally stringifies them only at substitution time.
- The helper should separate message rendering from response-format rendering. Chat/completion currently render `llm_config.response_format`; judge currently does not render `json_schema`. Changing that for judge would be a feature change and should be explicit.
- The helper should not inject temperature or other optional model parameters for judge. Optional kwargs should only be sent when they come from an existing supported config path.
- If we want judge and chat/completion to handle Jinja errors identically, that should be called out as a behavior change and covered by tests. The safer Phase 1 path is to preserve judge's current error behavior unless switching fully to `PromptTemplate` is accepted.
