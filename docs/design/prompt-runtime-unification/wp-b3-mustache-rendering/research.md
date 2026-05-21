# Research

## Current Runtime Map

The live SDK path in this checkout is `sdks/python/agenta/...`.

Relevant files:

- `sdks/python/agenta/sdk/utils/templating.py`
- `sdks/python/agenta/sdk/utils/resolvers.py`
- `sdks/python/agenta/sdk/utils/rendering.py`
- `sdks/python/agenta/sdk/utils/types.py`
- `sdks/python/agenta/sdk/engines/running/handlers.py`
- `sdks/python/agenta/sdk/engines/running/interfaces.py`
- `sdks/python/agenta/sdk/engines/running/builtin.py`
- `sdks/python/oss/tests/pytest/unit/test_render_template_helper.py`
- `sdks/python/oss/tests/pytest/unit/test_structured_rendering.py`
- `sdks/python/oss/tests/pytest/unit/test_prompt_template_extensions.py`
- `sdks/python/oss/tests/pytest/unit/test_auto_ai_critique_v0_runtime.py`

## Current Renderer Stack

`sdks/python/agenta/sdk/utils/templating.py` owns the low-level `render_template(...)` function. It currently supports:

- `curly`
- `fstring`
- `jinja2`

`TemplateMode` is currently:

```python
Literal["curly", "fstring", "jinja2"]
```

`curly` uses `_PLACEHOLDER_RE` from `agenta.sdk.utils.helpers`, then resolves each placeholder with `resolve_any(...)`.

`resolve_any(...)` in `sdks/python/agenta/sdk/utils/resolvers.py` dispatches by prefix:

- `$` -> JSONPath
- `/` -> JSON Pointer
- anything else -> dot notation

The dot-notation resolver currently does literal-key-first lookup. If the context contains a top-level key named `a.b`, then `{{a.b}}` resolves that literal key before trying nested traversal.

That behavior is required for `curly`, because existing apps may have literal dotted variable names. WP-B3 must not remove it.

## Structured Renderer Adoption

WP-B2 already moved the higher-level rendering surfaces onto `render_template(...)`:

- `render_messages(...)` renders prompt message content
- `render_json_like(...)` renders `response_format` and judge `json_schema`
- `PromptTemplate.format(...)` uses both helpers
- `auto_ai_critique_v0(...)` uses both helpers

That means most WP-B3 runtime behavior should land by adding `mustache` to the low-level renderer and widening accepted `template_format` values. The structured renderer should not need format-specific branching beyond accepting the new `TemplateMode`.

## Where Template Formats Are Validated

Backend validation points found in this checkout:

- `sdks/python/agenta/sdk/utils/templating.py`: `TemplateMode` and `render_template(...)`
- `sdks/python/agenta/sdk/utils/types.py`: prompt config models and `PromptTemplate._format_with_template(...)`
- `sdks/python/agenta/sdk/engines/running/handlers.py`: handler-level format checks and judge defaulting
- `sdks/python/agenta/sdk/engines/running/interfaces.py`: schemas that enumerate template formats
- `sdks/python/agenta/sdk/engines/running/builtin.py`: builtin parameters that set `template_format`

Frontend and package touchpoints exist, but WP-B3 should only widen them if needed to preserve backend-driven configs in this PR. WP-B3 owns backend support and new app / prompt defaults. Playground native JSON transport, variable discovery, and hiding legacy `curly` from the selector belong to the frontend follow-up.

Important frontend touchpoints for later:

- `web/packages/agenta-ui/src/Editor/*`
- `web/packages/agenta-ui/src/ChatMessage/*`
- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/*`
- `web/packages/agenta-entities/src/runnable/utils.ts`
- `web/packages/agenta-entities/src/workflow/state/molecule.ts`
- `web/packages/agenta-shared/src/utils/chatPrompts.ts`

## Library Evaluation

`mystace` is the primary library candidate for WP-B3.

PyPI lists:

- version `1.0.1`
- release date `2025-12-19`
- Python `>=3.10`
- claimed compliance with Mustache spec `v1.4.3`

Source:

- `https://pypi.org/project/mystace/`

Why `mystace` fits:

- modern, active Python Mustache library
- clean fit if we want real Mustache behavior instead of a custom subset
- no need to invent our own dot-notation semantics for normal Mustache tags
- only one product-specific extension is needed: JSONPath pre-rendering for tags that start with `{{$`

Why not `chevron`:

- still widely used, but old
- latest release is from `2021-01-02`
- PyPI classifiers only advertise Python support through `3.6`
- older packaging and maintenance profile than we want for a new SDK dependency

Source:

- `https://pypi.org/project/chevron/`
- `https://pypistats.org/packages/chevron`

## Rendering Shape

WP-B3 now has two stages:

1. JSONPath pre-rendering:
   Only tags that start with `{{$` are resolved as JSONPath against the render context.
2. Mustache rendering:
   The resulting template is rendered by `mystace` using normal Mustache behavior.

This is not “JSONPath inside Mustache name resolution.” It is a separate pre-rendering step followed by the Mustache engine.

## JSONPath Pre-Rendering Need

WP-B3 needs a small pass over the template that finds tags whose expression starts with `$` and resolves them through the existing JSONPath helper.

Important constraints:

- only `{{$.…}}`-style tags are intercepted
- no JSON Pointer support in `mustache`
- non-JSONPath tags remain ordinary Mustache tags
- values inserted during the pre-render step should follow the same coercion rules as current string substitution: dict/list -> compact JSON text, everything else -> `str(...)`

## Partial Handling

Partials are the one explicit Mustache feature we should reject.

Why:

- the runtime has no partial registry or template loader model
- “using `mystace`” does not require us to expose partials as a product feature
- a template containing `{{>name}}` should fail clearly instead of producing vague library behavior

Implementation options:

- detect partial tags before `mystace` render and raise a formatting error
- or rely on `mystace` parse/render behavior and normalize it into a clear Agenta formatting error

The first option is preferable because it keeps the product contract deterministic.
