# RFC: WP-B2 Message And JSON-Return Rendering

## Summary

WP-B2 adds the shared rendering layer that sits above `render_template(...)`.

WP-B1 gave us one correct way to render a single template string. WP-B2 gives completion, chat, and LLM-as-a-judge one correct way to render prompt messages and JSON-return configuration.

This work should not migrate evaluator storage. It should not add new model controls. It should not change judge output parsing.

## Goals

1. Use one message renderer for completion, chat, and LLM-as-a-judge.
2. Use one JSON-return renderer for chat/completion `response_format` and judge `json_schema`.
3. Render variables inside judge `json_schema`.
4. Make Jinja render failures raise across all services.
5. Preserve existing handler output parsing.
6. Keep old evaluator configs valid.

## Non-Goals

WP-B2 does not add `mustache`. That belongs to WP-B3.

WP-B2 does not change the flat LLM-as-a-judge config shape. Existing evaluator revisions still use `prompt_template`, `model`, `response_type`, `json_schema`, `correct_answer_key`, `threshold`, `version`, and `template_format`.

WP-B2 does not change playground transport. Native JSON transport is frontend work.

WP-B2 does not move judge result normalization into shared code. The judge keeps its own parsing of LLM output into `{score, success}`, `{success}`, dict output, or errors.

## Current Behavior

### Message Rendering

Completion and chat render messages through `PromptTemplate.format(...)`.

The call path is:

```text
completion_v0 / chat_v0
  -> SinglePromptConfig(**parameters)
  -> config.prompt.format(**variables)
  -> PromptTemplate._format_with_template(...)
  -> render_template(...)
```

The prompt object owns message rendering. It also wraps render errors as `TemplateFormatError`.

LLM-as-a-judge renders messages in the handler.

The call path is:

```text
auto_ai_critique_v0
  -> build judge context
  -> local _format_with_template(...)
  -> render_template(...)
```

This second path is why behavior still differs. The judge path has a local Jinja fallback. On Jinja template errors, it logs a warning and sends the unrendered prompt content to the LLM.

### JSON-Return Rendering

Chat and completion render variables inside `llm_config.response_format`.

The call path is:

```text
PromptTemplate.format(...)
  -> _format_llm_config(...)
  -> _substitute_variables(...)
  -> PromptTemplate._format_with_template(...)
```

This recursively renders strings inside JSON-like dicts and lists. It also renders string keys.

LLM-as-a-judge does not do this for `json_schema`.

The current judge path is:

```text
auto_ai_critique_v0
  -> response_type
  -> json_schema
  -> response_format = {"type": response_type, "json_schema": json_schema}
```

If the judge schema contains `{{label}}`, it stays literal today.

## Proposed Design

Add a structured rendering module above `render_template(...)`.

The module should know about two structures:

- Prompt messages.
- JSON-like return configuration.

It should not know about services, provider settings, secrets, evaluator thresholds, or LLM output parsing.

Suggested module:

```text
sdks/python/agenta/sdk/utils/rendering.py
```

Suggested functions:

```python
MessageInput = Message | Mapping[str, Any]

def render_messages(
    *,
    messages: Sequence[MessageInput],
    mode: TemplateMode,
    context: Mapping[str, Any],
) -> list[MessageInput]:
    ...

def render_json_like(
    *,
    json_like: Any,
    mode: TemplateMode,
    context: Mapping[str, Any],
    location: str = "value",
    render_keys: bool = True,
) -> Any:
    ...
```

Do not accept arbitrary message shapes.

The first implementation should support the two shapes we use today:

- Agenta `Message` objects from `PromptTemplate`.
- Dict messages from the judge `prompt_template`.

The renderer should validate every message before rendering.

Validation rules:

- The message must be an Agenta `Message` object or a mapping.
- `role` must exist and must be a string.
- `content` may be `None`, a string, or a list of known content parts.
- A text part must have `type == "text"` and a string `text` field.
- Non-text parts must be known Agenta content parts, such as `image_url` and `file`, and must pass through unchanged.
- Unknown content part types must raise a clear error that names the message index, the part index, and the unsupported `type`.
- Malformed content must raise a clear error that names the message index and the expected shape.

This contract matches the current local `Message` model. It also keeps us aligned with provider APIs that support list content. OpenAI supports string content and arrays of content parts for multimodal input. Anthropic also supports string content and arrays of typed content blocks. The renderer should render text-bearing parts only. It should never try to render image, file, tool, or provider-specific structured blocks as text.

`render_messages(...)` renders message text only. It preserves all other message fields.

`render_json_like(...)` recursively walks dicts and lists. It renders string values. It renders string keys when `render_keys` is true. Use `render_keys=False` when caller data may contain literal keys that must not be treated as templates. It leaves numbers, booleans, null, dicts, and lists as their original types except for strings that contain templates.

The low-level helper stays responsible for mode rules. The structured renderer only decides where templates can appear inside a message or JSON-like object.

## Error Behavior

The shared message renderer should raise on render errors.

That includes Jinja errors.

This is not just a side effect of sharing code. The shared renderer must choose one policy. WP-B2 chooses raise, because chat and completion already raise, and silent judge fallback can send an invalid prompt to the LLM.

After migration, the judge no longer needs its local silent Jinja behavior. `auto_ai_critique_v0(...)` should catch render failures at the existing boundary and raise `PromptFormattingV0Error`.

## Completion And Chat Changes

`PromptTemplate.format(...)` should keep its public behavior.

Internally, it should call the shared message renderer instead of looping over messages itself.

It should also call the shared JSON renderer for `llm_config.response_format`.

The result should still be a new `PromptTemplate` with rendered messages and rendered `llm_config`.

The error surface should remain `TemplateFormatError` for chat and completion.

## Judge Changes

`auto_ai_critique_v0(...)` should keep the same public inputs and outputs.

It should keep building the same render context.

It should replace the local message loop with `render_messages(...)`.

It should render `json_schema` with `render_json_like(...)` before building `response_format`.

The resulting path should be:

```text
auto_ai_critique_v0
  -> build judge context
  -> render_messages(prompt_template, template_format, context)
  -> render_json_like(json_schema, template_format, context)
  -> mockllm.acompletion(...)
  -> existing judge output normalization
```

The judge should keep `response_type` semantics. If `response_type` is `text` or `json_object`, no schema rendering is needed. If `response_type` is `json_schema`, render the schema first and attach it to `response_format`.

## Backward Compatibility

Existing evaluator revisions remain valid.

The flat judge config remains valid.

Existing judge variables remain valid.

The judge output shape remains valid.

There are two behavior changes.

First, invalid Jinja judge templates will fail instead of sending the original unrendered text to the model. This is intentional. It makes judge behavior match chat and completion. It also prevents silent bad prompts.

Second, placeholders inside judge `json_schema` will render. Existing schemas without placeholders are unchanged. A schema that intentionally contains literal placeholder text such as `{{label}}` will need escaping after the relevant format supports escaping, or it should use `jinja2` raw blocks where possible. This is a small compatibility risk, but it is the purpose of WP-B2.

## Test Strategy

WP-B2 needs tests at the structured renderer layer, not only at the low-level string renderer.

`test_render_template_helper.py` already tests `render_template(...)`. Keep it.

Add new tests for:

- `render_messages(...)` with model messages and dict messages.
- Message field preservation.
- Message content rendering for `curly`, `fstring`, and `jinja2`.
- Jinja errors raising through the shared message renderer.
- `render_json_like(...)` for nested dicts, lists, string keys, and scalar preservation.
- Chat/completion `response_format` rendering through `PromptTemplate.format(...)`.
- Judge `json_schema` rendering through `auto_ai_critique_v0(...)`.
- Judge Jinja failures surfacing as `PromptFormattingV0Error`.
- Judge output normalization staying unchanged.

This is why "tests around rendering" means two layers:

- Existing low-level tests for `render_template(...)`.
- New top-level tests for message and JSON-like rendering.

## Implementation Plan

Build this in one feature branch and one PR. The scope is atomic: add the structured renderer, adopt it in `PromptTemplate`, adopt it in the judge, and add focused tests.

### Step 1: Structured Renderer Foundation

Add `render_messages(...)` and `render_json_like(...)`.

Add direct unit tests for both functions.

### Step 2: Adopt Renderer In PromptTemplate

Change `PromptTemplate.format(...)` to use the structured renderers.

Keep `TemplateFormatError` behavior for chat and completion.

Keep `response_format` rendering behavior.

Add compatibility tests around `PromptTemplate.format(...)`.

### Step 3: Adopt Renderer In LLM-As-A-Judge

Change `auto_ai_critique_v0(...)` to use `render_messages(...)`.

Render judge `json_schema` through `render_json_like(...)`.

Remove the silent Jinja fallback.

Add tests for judge schema rendering, Jinja error behavior, and unchanged output normalization.

## Review Notes

The key review question is not whether `render_template(...)` works. WP-B1 answered that.

The key review question is whether all runtime surfaces now use the same structured rendering layer while keeping their existing contracts.

For chat and completion, the contract is `PromptTemplate.format(...)` plus `TemplateFormatError`.

For judge, the contract is flat evaluator config plus `PromptFormattingV0Error` at the render boundary plus unchanged output normalization.
