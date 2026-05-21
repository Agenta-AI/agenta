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

- `$` -> JSONPath.
- `/` -> JSON Pointer.
- anything else -> dot notation.

The dot-notation resolver currently does literal-key-first lookup. If the context contains a top-level key named `a.b`, then `{{a.b}}` resolves that literal key before trying nested traversal.

That behavior is required for `curly`, because existing apps may have literal dotted variable names. WP-B3 must not remove it.

## Structured Renderer Adoption

WP-B2 already moved the higher-level rendering surfaces onto `render_template(...)`:

- `render_messages(...)` renders prompt message content.
- `render_json_like(...)` renders `response_format` and judge `json_schema`.
- `PromptTemplate.format(...)` uses both helpers.
- `auto_ai_critique_v0(...)` uses both helpers.

That means most WP-B3 runtime behavior should land by adding `mustache` to the low-level renderer and widening accepted `template_format` values. The structured renderer should not need format-specific branching beyond accepting the new `TemplateMode`.

## Where Template Formats Are Validated

Backend validation points found in this checkout:

- `sdks/python/agenta/sdk/utils/templating.py`: `TemplateMode` and `render_template(...)`.
- `sdks/python/agenta/sdk/utils/types.py`: prompt config models and `PromptTemplate._format_with_template(...)`.
- `sdks/python/agenta/sdk/engines/running/handlers.py`: handler-level format checks and judge defaulting.
- `sdks/python/agenta/sdk/engines/running/interfaces.py`: schemas that enumerate template formats.
- `sdks/python/agenta/sdk/engines/running/builtin.py`: builtin parameters that set `template_format`.

Frontend and package touchpoints exist, but WP-B3 should only widen them if needed to preserve backend-driven configs in this PR. WP-B3 owns backend support and new app / prompt defaults. Playground native JSON transport, variable discovery, and hiding legacy `curly` from the selector belong to the frontend follow-up.

Important frontend touchpoints for later:

- `web/packages/agenta-ui/src/Editor/*`
- `web/packages/agenta-ui/src/ChatMessage/*`
- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/*`
- `web/packages/agenta-entities/src/runnable/utils.ts`
- `web/packages/agenta-entities/src/workflow/state/molecule.ts`
- `web/packages/agenta-shared/src/utils/chatPrompts.ts`

## Library Evaluation

`noahmorrison/chevron` is a Python implementation of Mustache. Its README says it implements the Mustache templating language and supports rendering strings, files, partials, and lambdas. PyPI lists the latest available package as `0.14.0`, classifies it as beta, and still advertises Python support only through Python 3.6-era classifiers.

Sources:

- `https://github.com/noahmorrison/chevron`
- `https://pypi.org/project/chevron/`

Do not use `chevron` as the WP-B3 runtime dependency. It is too old for a new SDK dependency, and Agenta still needs behavior that Chevron does not own.

LangChain Core exposes `langchain_core.utils.mustache`, with tokenizer and renderer utilities. The current LangChain reference marks the module as current in `langchain-core`, says it has existed since `v0.1`, and documents `render(...)`, `tokenize(...)`, and `ChevronError`. The module is adapted from Chevron, but it is maintained inside a modern package that already targets LLM prompt infrastructure.

Sources:

- `https://reference.langchain.com/python/langchain-core/utils/mustache`
- `https://reference.langchain.com/python/langchain-core/utils/mustache/render`
- `https://reference.langchain.com/v0.3/python/core/utils/langchain_core.utils.mustache.tokenize.html`

Recommendation: evaluate `langchain-core`'s mustache utilities first, but keep Agenta's runtime contract in front of the library contract.

Preferred implementation options, in order:

1. Use `langchain_core.utils.mustache.tokenize(...)` for parsing tags, then render Agenta-supported variable tags through Agenta's resolver and coercion rules.
2. Use `langchain_core.utils.mustache.render(...)` only if we can prove its missing-key behavior, dotted lookup behavior, escaping behavior, and unsupported construct behavior can be made compatible without brittle pre/post-processing.
3. Implement the small renderer locally only if LangChain Core's tokenizer cannot be depended on cleanly or if adding `langchain-core` is too heavy for the SDK.

The tokenizer-first option is the best starting point. It lets Agenta avoid maintaining delimiter parsing while still preserving the important product rules:

- `mustache` is a variable-substitution format, not full Mustache.
- JSONPath and JSON Pointer selectors are Agenta features.
- Dotted names are nested-only in `mustache`.
- Whole dict/list insertion uses Agenta compact JSON coercion.
- Unsupported sections, inverted sections, partials, and lambdas do not silently become product features.

Dependency note: this checkout does not currently depend on `langchain-core` in `sdks/python`, `api`, or `clients/python`. If WP-B3 adds it, the implementation should check package size, transitive dependencies, import cost, and whether the mustache utilities can be imported without pulling in model/provider integrations.

Reasons not to use the full renderer blindly:

- Agenta's `mustache` mode is intentionally not full Mustache. The parent RFC says it is variable substitution with path enhancements, not sections or partials.
- We need JSONPath and JSON Pointer selectors. Standard Mustache renderers do not provide Agenta's selector semantics.
- We need strict nested-only dotted lookup. Standard Mustache lookup behavior must be verified before adoption.
- We need explicit literal-brace escaping that is easy to document and test against current `curly` edge cases.
- Full Mustache supports sections, partials, and lambdas. Those are unnecessary for prompt rendering and expand the runtime surface we would need to harden.

Useful inspiration from LangChain Core:

- Treat `{{name}}` and `{{ name }}` equivalently.
- Use token types to explicitly reject or preserve unsupported constructs.
- Use direct spec-style test cases where the behavior overlaps with Agenta's intended subset.

## Resolver Need

WP-B3 needs a resolver that is identical to current `resolve_any(...)` for JSONPath and JSON Pointer, but different for plain dotted expressions:

- `curly`: keep `resolve_any(...)` and current literal-key-first dot notation.
- `mustache`: use `resolve_any(...)` for `$...` and `/...`, but use a new nested-only dot resolver for plain expressions.

Suggested helper:

```python
def resolve_dot_notation_nested_only(expr: str, data: dict) -> object:
    ...
```

It should share the same error contract as `resolve_dot_notation(...)`:

- missing key or path -> `KeyError`
- malformed expression -> `ValueError`
- no empty placeholder
- no bracket syntax in dot notation

Then:

```python
def resolve_mustache(expr: str, data: dict) -> Any:
    if expr.startswith("$"):
        return resolve_json_path(expr, data)
    if expr.startswith("/"):
        return resolve_json_pointer(expr, data)
    return resolve_dot_notation_nested_only(expr, data)
```

## Escaping Need

`curly` has no escape mechanism today. Existing tests pin behavior such as triple and quadruple braces being parsed as malformed placeholder names.

`mustache` is greenfield and should define a simple literal-brace escape before shipping. Candidate:

- `\{{` -> literal `{{`
- `\}}` -> literal `}}`
- escaped delimiters are restored after variable substitution

This keeps examples such as JSON output instructions readable:

```text
Return JSON exactly like \{{"score": 1, "reason": "..."\}}
```

The implementation should protect escaped delimiters before placeholder extraction, render real placeholders, then restore the protected delimiters. It should also preserve normal backslashes in variable values, following the WP-B1 backslash fix.
