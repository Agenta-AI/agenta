# QA Plan

## Purpose

WP-B2 changes how prompt messages and JSON-return configuration are rendered. The QA plan must prove three things:

1. The new structured renderers behave correctly in isolation.
2. Completion, chat, and LLM-as-a-judge keep their existing public contracts.
3. Error paths are clear, deterministic, and testable without live providers.

The low-level `render_template(...)` tests from WP-B1 stay in place. WP-B2 adds tests for the layer above it.

## Test Levels

### Pure Unit Tests

These tests target the new renderer module directly. They should not import runtime handlers, secrets, LiteLLM, network clients, or tracing.

Expected file:

- `sdks/python/oss/tests/pytest/unit/test_structured_rendering.py`

Target functions:

- `render_messages(...)`
- `render_json_like(...)`

### Call-Site Contract Tests

These tests prove that existing runtime surfaces use the new renderer without changing their external behavior.

Expected locations:

- Existing `PromptTemplate` tests, or a new focused unit test file beside current SDK tests.
- Existing `sdks/python/oss/tests/pytest/unit/test_auto_ai_critique_v0_runtime.py`, extended for WP-B2.

### Manual Smoke Tests

Manual tests should only cover integration that requires a running app, configured provider, or UI flow. Core rendering behavior belongs in unit tests.

## Happy Paths

### Message Renderer

Test Agenta `Message` objects.

- Render string `content` with `curly`.
- Render string `content` with `fstring`.
- Render string `content` with `jinja2`.
- Preserve `role`, `name`, `tool_calls`, and `tool_call_id`.
- Preserve `content=None`.
- Preserve message order.
- Return the same shape family that was provided, unless the implementation documents a normalized return shape.

Test judge dict messages.

- Render `{"role": "user", "content": "Hello {{name}}"}`.
- Preserve extra non-content fields if present.
- Preserve message order.

Test list content.

- Render a text part with `{"type": "text", "text": "Hello {{name}}"}`.
- Render multiple text parts in the same message.
- Preserve known non-text parts unchanged, including `image_url` and `file`.
- Preserve the order of mixed text and non-text parts.

### JSON Renderer

Test nested JSON-like values.

- Render string values in a dict.
- Render string values in a list.
- Render deeply nested dict and list structures.
- Render string keys when `render_keys=True`.
- Preserve string keys when `render_keys=False`.
- Preserve numbers, booleans, `None`, dicts, and lists when they do not contain template strings.
- Do not mutate the input object.

### PromptTemplate

Test chat and completion behavior through `PromptTemplate.format(...)`.

- Render prompt messages through the shared message renderer.
- Render `llm_config.response_format` through the shared JSON renderer.
- Render fallback config `response_format` if fallback configs can contain response formats.
- Preserve `TemplateFormatError` as the public error type.
- Preserve `input_keys` validation behavior.

### LLM-As-A-Judge

Test `auto_ai_critique_v0(...)` through its raw handler.

- Render judge `prompt_template` messages through the shared message renderer.
- Render variables inside `json_schema` when `response_type == "json_schema"`.
- Preserve `response_format={"type": "text"}` when `response_type == "text"`.
- Preserve `response_format={"type": "json_object"}` when `response_type == "json_object"`.
- Preserve existing context aliases: direct input keys, `inputs`, `outputs`, `prediction`, `ground_truth`, `correct_answer`, `reference`, `trace`, and `parameters`.
- Preserve existing output normalization for dict, numeric, boolean, and invalid outputs.

## Grumpy Paths

### Message Validation

The renderer should fail fast with clear messages.

- Reject a non-message item in the messages list.
- Reject a dict message missing `role`.
- Reject a dict message where `role` is not a string.
- Reject a dict message where `content` is an unsupported type.
- Reject a content part missing `type`.
- Reject a text part where `text` is missing.
- Reject a text part where `text` is not a string.
- Reject an unknown content part type.
- Include the message index in every message-level validation error.
- Include both message index and part index in every content-part validation error.

### Template Errors

Test rendering failures for each format.

- Missing `curly` variable raises a structured render error.
- Missing `fstring` variable raises a structured render error.
- Jinja syntax errors raise.
- Jinja sandbox violations raise.
- Judge wraps render failures as `PromptFormattingV0Error`.
- Chat and completion keep wrapping render failures as `TemplateFormatError`.

### JSON Renderer Errors

Test malformed or unsupported JSON-like input.

- Raise on unresolved variables inside nested values.
- Raise on unresolved variables inside rendered keys.
- Include a location such as `json_schema.schema.properties.label.description` in JSON-renderer errors when possible.
- Do not partially mutate the input object when rendering fails.
- Handle rendered key collisions deliberately. The preferred behavior is to raise.

### Judge Schema Errors

Test schema-specific failure modes.

- If `response_type == "json_schema"` and `json_schema` is not a dict, keep the existing validation error.
- If schema rendering fails, raise `PromptFormattingV0Error` before the LLM call.
- If schema rendering succeeds but the schema is still invalid for the provider, leave that error at the provider boundary. WP-B2 should not become a JSON Schema validator.

## Edge Cases

### Message Content

- Empty string content stays empty.
- Whitespace-only content renders according to the template format and does not get dropped.
- Content with repeated variables renders all occurrences.
- Content with multiline text renders correctly.
- Content with Unicode variable values renders correctly.
- Content with placeholder-shaped values does not recursively render.
- Content with literal braces follows the existing mode rules.

### Content Parts

- A message with only non-text parts remains valid.
- A message with text, image, text preserves order and renders only the text parts.
- A file part with nested metadata is preserved unchanged.
- Tool-call fields on assistant messages are preserved unchanged.
- Tool messages with `tool_call_id` are preserved unchanged.

### JSON-Like Rendering

- Empty dict and empty list remain unchanged.
- Deeply nested lists and dicts render correctly.
- Repeated references render consistently.
- Stringified JSON remains a string. It should not be parsed.
- Whole-object insertion still follows `render_template(...)` behavior.

### Modes

- `curly` keeps literal-key-first behavior.
- `fstring` keeps Python `str.format` behavior.
- `jinja2` raises consistently across all call sites.
- Unsupported mode raises a clear error.

## Compatibility Tests

These tests protect existing users.

- Existing completion prompt with string messages renders the same output as before.
- Existing chat prompt with appended chat history still excludes `messages` from template inputs.
- Existing chat prompt with no variables still works.
- Existing judge v2 defaults to `fstring`.
- Existing judge v3 and v4 default to `curly`.
- Existing judge flat config still works.
- Existing judge schema without placeholders passes through unchanged.
- Existing judge output normalization is unchanged.
- Existing provider settings and secret resolution tests from WP-B1 still pass.

## Testability Review Checks

Use the testability rubric as a design gate for implementation review.

The renderer module should satisfy these checks:

- It has no network, file-system, database, clock, randomness, or provider side effects.
- It does not read secrets or global runtime context.
- It accepts all dependencies through function parameters.
- It returns observable values or typed errors that tests can assert on.
- It does not mutate input messages or JSON-like input objects.
- It keeps validation and rendering deterministic.
- It exposes stable function signatures that are easy to contract-test.
- It keeps handler glue thin. Business rules for structured rendering should live in the renderer module, not inside `auto_ai_critique_v0(...)` or `PromptTemplate.format(...)`.

Reviewers should flag implementation that violates these seams. The minimum acceptable seam is a pure renderer module with typed, inspectable errors.

## Mocking And Isolation

Unit tests should not call live LLM providers.

For judge call-site tests:

- Mock `SecretsManager.ensure_secrets_in_workflow`.
- Mock `SecretsManager.get_provider_settings_from_workflow`.
- Mock `mockllm.acompletion`.
- Mock `mockllm.user_aws_credentials_from`.
- Assert the captured `messages` and `response_format`.
- Assert that the LLM call is not reached when rendering fails.

For `PromptTemplate` tests:

- Use in-memory `PromptTemplate`, `Message`, and `ModelConfig` objects.
- Do not instantiate runtime handlers unless the behavior belongs to the handler contract.

## Suggested Commands

Run focused SDK unit tests:

```bash
cd sdks/python
uv run pytest oss/tests/pytest/unit/test_render_template_helper.py -v
uv run pytest oss/tests/pytest/unit/test_auto_ai_critique_v0_runtime.py -v
uv run pytest oss/tests/pytest/unit/test_structured_rendering.py -v
```

Run any added `PromptTemplate` contract tests in the same unit test suite.

## Manual Smoke Test

Create an LLM-as-a-judge evaluator with `response_type=json_schema`.

Use a schema that contains a variable from the judge context.

Run an evaluation and verify:

- The LLM call receives rendered messages.
- The LLM call receives the rendered schema.
- The result shape stays unchanged.
- A bad Jinja template fails before the LLM call and returns a clear formatting error.
