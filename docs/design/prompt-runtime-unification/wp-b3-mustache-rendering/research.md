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
- only one product-specific extension is needed: JSONPath resolution for tags that start with `{{$`

Why not `chevron`:

- still widely used, but old
- latest release is from `2021-01-02`
- PyPI classifiers only advertise Python support through `3.6`
- older packaging and maintenance profile than we want for a new SDK dependency

Source:

- `https://pypi.org/project/chevron/`
- `https://pypistats.org/packages/chevron`

## Benchmark: `mystace` vs `chevron` (2026-05-21)

We ran a head-to-head suite (`mystace` 1.0.1 vs `chevron` 0.14.0) across
completeness, consistency, soundness, and performance to validate the engine
choice with data rather than packaging signals alone.

### Completeness

Both engines handle the full Mustache feature set identically: variables,
inner-whitespace trimming, dotted and deep-dotted names, sections, truthy/falsy
sections, inverted sections, comments, delimiter swaps (`{{=<% %>=}}`),
triple-brace, ampersand-unescape, and nested sections.

### Consistency

**22/22 test cases produced byte-identical output.** This includes the two
behaviors WP-B3 must override at the integration boundary:

- HTML escaping: both escape `{{var}}` (e.g. `<b>` -> `&lt;b&gt;`).
- dict coercion: both default to Python `repr` (`{'x': 1}`), not compact JSON.

They also agree on the permissive paths: missing keys render empty, partials
with no registry render empty, and `None` renders empty.

### Soundness

Neither engine raised on the tested edge cases (missing keys, partials, falsy
sections, `None`); error surfaces are equivalent. Both are spec-aligned —
`mystace` claims Mustache v1.4.3 compliance, `chevron` is the older de-facto
reference implementation.

### Performance (20k iterations per case)

| case | `mystace` | `chevron` | ratio (chevron/mystace) |
| --- | --- | --- | --- |
| simple variable | 0.183s | 0.086s | 0.47x (chevron ~2x faster) |
| section x10 | 0.520s | 0.593s | 1.14x (mystace faster) |
| deep dotted name | 0.100s | 0.069s | 0.69x (chevron faster) |

`chevron` is faster on simple/scalar templates; `mystace` edges ahead on
iteration-heavy sections. At microseconds per render, the difference is
negligible for prompt rendering.

### Decision

Raw behavior is equivalent on completeness, consistency, and soundness, and
performance is a wash for our workload. The deciding factor is **integration
cleanliness for the WP-B3 contract**:

- WP-B3 requires no HTML escaping (prompt text is not HTML) and compact-JSON
  coercion for whole-object/array insertion (to match `curly`).
- `mystace` exposes `stringify=` and `html_escape_fn=` parameters, so both
  overrides are one-liners passed straight to `render_from_template(...)`.
- `chevron` exposes neither, so the same contract would require pre-walking and
  pre-stringifying the context and working around escaping by hand.

`mystace` is therefore retained as the engine: equal behavior, equivalent
performance, and the exact extension points the contract needs.

## Rendering Shape

WP-B3 resolves `{{$...}}` JSONPath tags as inert data, never re-parsed:

1. Shield: `{{$...}}` tags are hidden from the engine (replaced by sentinels).
2. Render: the engine (`mystace` for `mustache`) renders the rest normally.
3. Substitute: the resolved JSONPath values are inserted into the rendered output last, as literal text.

This is not “JSONPath inside Mustache name resolution,” and it is not a pre-render stage whose output is fed back through the engine. The resolved value is never re-rendered, so it behaves exactly like a plain variable value. This is the handling `curly` already had natively, now unified across `curly` / `mustache` / `jinja2`.

## JSONPath Resolution Need

WP-B3 needs a small pass over the template that finds tags whose expression starts with `$` and resolves them through the existing JSONPath helper.

Important constraints:

- only `{{$.…}}`-style tags are intercepted
- no JSON Pointer support in `mustache`
- non-JSONPath tags remain ordinary Mustache tags
- resolved values should follow the same coercion rules as current string substitution: dict/list -> compact JSON text, everything else -> `str(...)`

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
