# QA Plan

## Purpose

WP-B3 adds a new format that shares `{{...}}` delimiters with legacy `curly`. QA must prove the two modes are intentionally different only where specified and unchanged everywhere else.

The test plan must prove:

1. `mustache` renders the intended selector subset.
2. `curly` behavior is unchanged.
3. All WP-B2 structured rendering call sites accept `mustache`.
4. New apps / prompt configs default to `mustache` without migrating old configs.
5. Literal-brace escaping works without corrupting backslashes or values.

## Test Levels

### Low-Level Renderer Tests

Primary file:

- `sdks/python/oss/tests/pytest/unit/test_render_template_helper.py`

Target:

- `render_template(..., mode="mustache", ...)`

These tests should be pure and should not import runtime handlers.

### Library Spike Tests

Before committing to `langchain-core`, add a small exploratory test or scratch script that records:

- `tokenize(...)` output for normal variables
- `tokenize(...)` output for sections, inverted sections, partials, comments, and no-escape tags
- `render(...)` behavior for missing keys
- `render(...)` behavior for dotted keys when both literal and nested data exist
- `render(...)` behavior for dict/list values
- whether importing `langchain_core.utils.mustache` pulls expensive optional integrations

These checks decide whether WP-B3 uses LangChain Core's tokenizer, LangChain Core's full renderer, or a local fallback.

### Resolver Tests

Resolver tests can live in `test_render_template_helper.py` or a new focused resolver test file.

Target helpers:

- `resolve_dot_notation(...)` for legacy `curly`
- new nested-only resolver for `mustache`
- new `resolve_mustache(...)` dispatcher, if added

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
- unicode variable names, if existing `curly` support allows them
- unicode values
- number, boolean, and null values

### Nested JSON

- nested object lookup: `{{profile.name}}`
- deep nested lookup: `{{profile.address.city}}`
- list index lookup: `{{profile.tags.0}}`
- nested list lookup: `{{matrix.0.1}}`
- whole object insertion renders compact JSON
- whole list insertion renders compact JSON
- stringified JSON remains a string and is not parsed

### Selector Prefixes

- JSONPath root: `{{$}}`
- JSONPath field: `{{$.profile.name}}`
- JSONPath list index: `{{$.profile.tags[0]}}`
- JSON Pointer field: `{{/profile/name}}`
- JSON Pointer escaped slash: `{{/a~1b}}`
- selector prefixes are handled before normal mustache name traversal

### Escaping

- `\{{name\}}` renders literal `{{name}}`
- escaped opening delimiter before normal placeholder
- escaped closing delimiter after normal placeholder
- literal JSON examples with escaped braces
- backslashes in values are preserved
- regex backreference syntax in values is preserved
- Windows-style paths in values are preserved

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
- `mustache` resolves nested `a -> b` even when a literal key `a.b` exists
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

- missing top-level variable raises unresolved-variable error
- missing nested key raises unresolved-variable error
- list index out of range raises unresolved-variable error
- traversal through scalar raises unresolved-variable error
- empty placeholder raises unresolved-variable error
- whitespace-only placeholder raises unresolved-variable error
- malformed dot-notation with brackets raises a clear error

### Unsupported Mustache Constructs

Define expected behavior before implementation, then test it.

Candidate expected behavior:

- section tags such as `{{#items}}` raise an unsupported-construct error
- inverted sections such as `{{^items}}` raise an unsupported-construct error
- closing tags such as `{{/items}}` are ambiguous with JSON Pointer and should be treated carefully
- partials such as `{{>item}}` raise unsupported-construct error
- comments such as `{{! note }}` either pass through or raise, but must be documented

Because Agenta uses `/...` for JSON Pointer, closing-section syntax conflicts with an existing selector prefix. Do not add section support in WP-B3.

### Escaping Failures

- dangling escape before opening delimiter
- escaped opening delimiter with unescaped closing delimiter
- escaped closing delimiter with unescaped opening delimiter
- placeholder-shaped variable value is not rendered recursively
- escaped braces do not hide real unresolved placeholders elsewhere in the template

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
