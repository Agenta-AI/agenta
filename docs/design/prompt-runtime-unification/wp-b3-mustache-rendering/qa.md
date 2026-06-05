# QA Plan

## Purpose

WP-B3 adds a new format that shares `{{...}}` delimiters with legacy `curly`. QA must prove the two modes are intentionally different only where specified and unchanged everywhere else.

The test plan must prove:

1. `mustache` resolves only `{{$.…}}` tags through JSONPath (as inert data, substituted last).
2. `curly` behavior is unchanged.
3. All WP-B2 structured rendering call sites accept `mustache`.
4. New apps / prompt configs default to `mustache` without migrating old configs.
5. Partials fail clearly.

## Test Levels

### Low-Level Renderer Tests

Primary file:

- `sdks/python/oss/tests/pytest/unit/test_render_template_helper.py`

Target:

- `render_template(..., mode="mustache", ...)`

These tests should be pure and should not import runtime handlers.

### Library Adoption Tests

Before locking the implementation, record `mystace` behavior for:

- dotted names
- sections and inverted sections
- comments and unescaped variables
- missing keys
- dict/list values
- partial tags when no partial registry is supplied

### JSONPath Pre-Rendering Tests

These tests can live in `test_render_template_helper.py` or a new focused helper test file.

Target behavior:

- `{{$.profile.name}}` resolves correctly
- `{{$.profile.tags[0]}}` resolves correctly
- only tags starting with `{{$` are intercepted
- `{{name}}` is left for Mustache
- `{{profile.name}}` is left for Mustache

### Structured Renderer Tests

Primary file:

- `sdks/python/oss/tests/pytest/unit/test_structured_rendering.py`

Target:

- `render_messages(..., mode="mustache", ...)`
- `render_json_like(..., mode="mustache", ...)`

### Call-Site Contract Tests

Expected files:

- `sdks/python/oss/tests/pytest/unit/test_prompt_template_extensions.py`
- `sdks/python/oss/tests/pytest/unit/test_auto_ai_critique_v0_runtime.py`

Target:

- `PromptTemplate.format(...)`
- `auto_ai_critique_v0(...)`

## Happy Paths

### Mustache Substitution

- top-level string: `Hello {{name}}`
- inner whitespace: `Hello {{ name }}`
- repeated variable references
- multiple different variables
- multiline template with placeholders on different lines
- unicode values
- number, boolean, and null values

### Mustache Dotted Names

- nested object lookup: `{{profile.name}}`
- deep nested lookup: `{{profile.address.city}}`
- whole object insertion renders compact JSON
- whole list insertion renders compact JSON
- stringified JSON remains a string and is not parsed

### JSONPath Tags

- JSONPath root: `{{$}}`
- JSONPath field: `{{$.profile.name}}`
- JSONPath list index: `{{$.profile.tags[0]}}`
- only `{{$.…}}` tags are handled by the JSONPath pass

### Structured Rendering

- `render_messages(...)` renders string message content with `mustache`
- `render_messages(...)` renders text content parts with `mustache`
- `render_messages(...)` preserves image, file, audio, and refusal parts
- `render_json_like(...)` renders nested schema descriptions with `mustache`
- `render_json_like(...)` renders keys with `mustache` when enabled
- `render_json_like(...)` preserves keys when `render_keys=False`

### PromptTemplate

- prompt messages render with `template_format="mustache"`
- `llm_config.response_format` renders with `mustache`
- fallback `response_format` renders with `mustache`, if current fallback configs support it
- public errors are still wrapped as `TemplateFormatError`

### LLM-As-A-Judge

- judge `prompt_template` renders with `template_format="mustache"`
- judge `json_schema` renders with `mustache`
- newly created judge/app configs can explicitly store `template_format="mustache"`
- judge context aliases work: direct keys, `inputs`, `outputs`, `prediction`, `ground_truth`, `correct_answer`, `reference`, `trace`, and `parameters`
- LLM call is not reached when rendering fails
- existing judge output normalization is unchanged

### New-App Defaults

- new completion app prompt config defaults to `mustache`
- new chat app prompt config defaults to `mustache`
- new evaluator prompt config defaults to `mustache` where the creation path owns an explicit default
- old configs that already declare `curly` remain `curly`
- old configs that declare `fstring` or `jinja2` remain unchanged
- old configs that omit `template_format` use the legacy compatibility fallback, not the new-app default

## Compatibility Tests

These are the most important regression tests.

- `curly` still resolves literal key `a.b` before nested `a -> b`
- `curly` triple-brace and quadruple-brace edge-case tests keep their current expected behavior
- `curly` still has no delimiter escape
- `fstring` escaping with doubled braces is unchanged
- `jinja2` raw blocks are unchanged
- unsupported mode still raises a clear error
- old evaluator v2 still defaults to `fstring`
- old evaluator v3+ still defaults to `curly`
- new evaluator configs write `mustache` explicitly instead of relying on the old runtime fallback
- existing configs without explicit `mustache` render exactly as before

## Grumpy Paths

### Missing And Invalid Variables

- missing top-level variable renders empty (mustache is permissive)
- missing or malformed JSONPath `{{$...}}` expression raises a clear formatting error
- empty placeholder raises an error
- whitespace-only placeholder raises an error

### Unsupported Partials

- partials such as `{{>item}}` raise a clear unsupported-partial formatting error
- the LLM call is not reached if a partial tag is present
- the error should be deterministic and product-authored, not a vague library exception

## Mocking And Isolation

No test should call a live LLM provider.

For judge call-site tests:

- mock `SecretsManager.ensure_secrets_in_workflow`
- mock `SecretsManager.get_provider_settings_from_workflow`
- mock `mockllm.acompletion`
- mock `mockllm.user_aws_credentials_from`
- assert captured `messages` and `response_format`

For `PromptTemplate` tests:

- use in-memory `PromptTemplate`, `Message`, and `ModelConfig` objects
- assert rendered prompt config directly

## Suggested Commands

Run focused SDK tests from `sdks/python`:

```bash
uv run pytest oss/tests/pytest/unit/test_render_template_helper.py -q
uv run pytest oss/tests/pytest/unit/test_structured_rendering.py -q
uv run pytest oss/tests/pytest/unit/test_prompt_template_extensions.py -q
uv run pytest oss/tests/pytest/unit/test_auto_ai_critique_v0_runtime.py -q
```

Run the combined focused set:

```bash
uv run pytest oss/tests/pytest/unit/test_render_template_helper.py oss/tests/pytest/unit/test_structured_rendering.py oss/tests/pytest/unit/test_prompt_template_extensions.py oss/tests/pytest/unit/test_auto_ai_critique_v0_runtime.py -q
```

Run formatting and lint for touched SDK files:

```bash
uv run ruff format <touched files>
uv run ruff check --fix <touched files>
```

If frontend files are touched:

```bash
cd ../../web
pnpm lint-fix
```
