# RFC: WP-B3 Mustache Rendering

## Summary

WP-B3 adds `mustache` as the fourth prompt template format and makes it the default rendering format for newly created apps / prompt configs.

This is a backend runtime package. It extends the renderer foundation from WP-B1 and the structured renderer from WP-B2. It does not redesign evaluator storage, change playground native JSON transport, or force existing apps to migrate away from `curly`.

`mustache` is also the precursor to consistent nesting handling. Once new apps use `mustache`, `{{a.b}}` has one unambiguous meaning: read `a` as an object and traverse into `b`. Legacy `curly` remains the compatibility mode for old prompts that may have literal dotted variable names.

`mustache` is the clean, forward-looking `{{...}}` variable substitution mode. Its main difference from legacy `curly` is dotted-name semantics:

- `curly`: `{{a.b}}` first checks for a literal top-level key named `a.b`, then falls back to nested traversal.
- `mustache`: `{{a.b}}` always means nested traversal through key `a`, then key `b`.

## Goals

1. Add `mustache` to the SDK renderer stack.
2. Support `mustache` anywhere prompt rendering is configured: completion/chat prompts and LLM-as-a-judge evaluator prompts.
3. Make `mustache` the default format for newly created apps / prompt configs.
4. Keep `curly`, `fstring`, and `jinja2` behavior unchanged for existing configs.
5. Support top-level, nested dot notation, array indexes, JSONPath, and JSON Pointer in `mustache`.
6. Resolve selector-style expressions first, then normal mustache variable expressions.
7. Make whole-object and whole-array insertion render as compact JSON text.
8. Add an explicit literal-brace escape for `mustache`.
9. Extend backend validation and schemas to accept `mustache`.
10. Add focused tests across low-level rendering, structured rendering, chat/completion, and LLM-as-a-judge.

## Non-Goals

WP-B3 does not implement the full Mustache specification.

No sections:

```text
{{#items}}...{{/items}}
```

No partials:

```text
{{> partial}}
```

No lambdas.

No filesystem template loading.

No frontend native JSON transport changes. That belongs to WP-F2.

No broad UI redesign. The frontend package should hide `curly` from the format list for new apps and only show it when an old app already has `curly` selected. Prompt-editor autocomplete and native JSON transport still belong to later frontend packages.

No evaluator config migration. The judge flat config remains valid.

## Dependency Choice

Do not use `noahmorrison/chevron` directly. It is too old for a new SDK runtime dependency.

Prefer evaluating `langchain_core.utils.mustache`.

LangChain Core exposes Mustache tokenizer and renderer utilities in a maintained package:

- `tokenize(template, def_ldel="{{", def_rdel="}}")`
- `render(template, data, partials_dict=..., keep=..., warn=...)`
- `ChevronError`

The reference docs state the module is adapted from Chevron, but it is part of modern `langchain-core`.

The recommended path is tokenizer-first:

1. Use LangChain Core's tokenizer to parse literals and tags.
2. Render only Agenta-supported variable tags through Agenta's resolver and value coercion.
3. Reject or deliberately preserve unsupported Mustache constructs; do not silently enable sections, partials, or lambdas.

Use LangChain Core's full `render(...)` only if implementation research proves it can satisfy Agenta's missing-key behavior, nested-only dotted lookup, JSONPath / JSON Pointer support, and escaping rules without fragile adaptation.

If `langchain-core` is too heavy as an SDK dependency, fall back to a local small renderer. The fallback should still borrow the tokenizer-driven shape rather than grow another regex-only parser.

## Proposed Semantics

### Placeholder Syntax

Supported placeholders:

```text
{{name}}
{{ name }}
{{profile.name}}
{{profile.tags.0}}
{{$}}
{{$.profile.name}}
{{/profile/name}}
```

Whitespace directly inside delimiters is ignored.

Empty placeholders are invalid:

```text
{{}}
{{   }}
```

Newlines inside a placeholder are not supported. Keep the current single-line placeholder behavior unless there is a clear product reason to expand it.

### Dot Notation

Plain names use nested-only dot notation.

Given:

```json
{
  "profile": {"name": "Ada"},
  "profile.name": "literal"
}
```

`mustache` renders:

```text
{{profile.name}} -> Ada
```

It must not return `literal`.

Array indexes use numeric dot segments:

```text
{{profile.tags.0}}
```

Bracket syntax stays unsupported in dot notation:

```text
{{profile.tags[0]}}
```

Use JSONPath when bracket syntax is needed:

```text
{{$.profile.tags[0]}}
```

### Resolution Order

`mustache` resolution should first check selector syntax, then fall back to mustache-style variable/name handling:

1. Expressions starting with `$` resolve as JSONPath.
2. Expressions starting with `/` resolve as JSON Pointer, preserving the current resolver contract.
3. All other expressions resolve through nested-only mustache dot traversal.

This order matters because WP-B3 is the bridge into later nesting work: selector syntax remains explicit, while normal dotted names become object traversal only.

### JSONPath And JSON Pointer

`mustache` keeps the same selector prefixes as `curly`:

- `$...` -> JSONPath.
- `/...` -> JSON Pointer.

The optional dependency behavior should stay the same as current `curly`: if the JSONPath dependency is unavailable, unresolved-selector errors should include the existing install hint.

### Value Coercion

Resolved values are converted at the string-substitution boundary:

- dict/list -> compact JSON text with unicode preserved.
- strings -> unchanged.
- numbers, booleans, null -> `str(value)` behavior, matching current `curly`.

Values are data, not templates. A variable value that contains `{{other}}` must not be rendered recursively.

### Literal-Brace Escaping

`mustache` should add a simple escape for literal delimiters:

```text
\{{ -> literal {{
\}} -> literal }}
```

Examples:

```text
Hello {{name}} -> Hello Ada
Show a placeholder: \{{name\}} -> Show a placeholder: {{name}}
Return JSON: \{{"score": {{score}}\}} -> Return JSON: {{"score": 1}}
```

Implementation detail: protect escaped delimiters before placeholder extraction, render real placeholders, then restore the escaped delimiters. This prevents escaped braces from being parsed as placeholders.

Do not retrofit this escape into `curly` in WP-B3. That would change legacy behavior. Document that `curly` still has no escape and recommend `mustache` or `jinja2` for new prompts that need literal `{{` / `}}`.

## Implementation Design

### Low-Level Renderer

Extend `sdks/python/agenta/sdk/utils/templating.py`:

```python
TemplateMode = Literal["mustache", "curly", "fstring", "jinja2"]
```

Add `_render_mustache(...)`.

`_render_mustache(...)` should preferably use `langchain_core.utils.mustache.tokenize(...)` to separate literals from tags, then call a `mustache` resolver that never does literal-key-first lookup for dotted expressions.

If tokenizer adoption creates dependency or behavior problems, `_render_mustache(...)` can use a local tokenizer. Avoid depending on LangChain Core's full `render(...)` until the semantic compatibility checks are complete.

Suggested resolver additions in `sdks/python/agenta/sdk/utils/resolvers.py`:

```python
def resolve_dot_notation_nested_only(expr: str, data: dict) -> object:
    ...

def resolve_mustache(expr: str, data: dict) -> Any:
    ...
```

Keep `resolve_any(...)` unchanged for `curly`.

### Structured Renderer

`sdks/python/agenta/sdk/utils/rendering.py` should only need type widening through `TemplateMode`. It should not branch on `mustache`.

The same `render_messages(...)` and `render_json_like(...)` functions should work unchanged once `render_template(...)` accepts the new mode.

### PromptTemplate

Extend prompt config models in `sdks/python/agenta/sdk/utils/types.py` to accept `mustache`.

`PromptTemplate.format(...)` should preserve its public error surface:

- chat/completion still raise `TemplateFormatError` for render failures.
- `mustache` unresolved variables should follow the same wrapping pattern as `curly`.

Default handling:

- New app / prompt creation paths should set `template_format="mustache"`.
- Existing prompt configs keep their declared `template_format`.
- Legacy configs that genuinely omit `template_format` should keep the current compatibility fallback unless the creation path can prove the config is new.
- Backend accepts `mustache` now and should expose it in schemas.

### LLM-As-A-Judge

Extend handler validation so `template_format="mustache"` is accepted for LLM-as-a-judge.

Keep current judge default behavior:

- version `2` defaults to `fstring`.
- version `3+` defaults to `curly`.

Do not silently change existing judge revisions to `mustache`. New evaluator/app creation paths should write `template_format="mustache"` explicitly.

Add tests proving judge prompt messages and `json_schema` render through `mustache` when explicitly configured.

### Engine Interfaces

Widen `template_format` enums in `sdks/python/agenta/sdk/engines/running/interfaces.py` to include `mustache`.

Review builtin configs in `sdks/python/agenta/sdk/engines/running/builtin.py`. Defaults used for newly created app templates should move to `mustache`; compatibility fallbacks for old missing-format configs should stay separate.

### Frontend Follow-Up

The frontend work should hide legacy `curly` from the template-format selector unless the current app already has `curly` selected. That belongs to the frontend package, not the core backend renderer, but WP-B3 must leave enough schema/type support for the frontend to distinguish:

- new app: default `mustache`, no `curly` option shown
- old app with `curly`: keep `curly` selected and visible
- old app with `fstring` / `jinja2`: keep selected value; do not newly promote `curly`

## Compatibility

Existing apps remain on their declared format.

`curly` keeps literal-key-first behavior.

`fstring` keeps Python `str.format` behavior.

`jinja2` keeps sandboxed Jinja behavior and WP-B2's aligned raise-on-error policy.

Newly created apps / prompt configs should explicitly set `template_format="mustache"`. Existing apps remain on their declared format.

## Risks

### Users Expect Full Mustache

Risk: the name `mustache` may imply sections, partials, lambdas, comments, and delimiter changes.

Mitigation: document this as Agenta's Mustache-compatible variable substitution mode, not full Mustache. Reject unsupported constructs clearly instead of silently ignoring them when practical.

### Escaping Ambiguity

Risk: backslash escaping may surprise users who want literal backslashes before placeholders.

Mitigation: add focused tests for single backslashes, Windows paths, regex backreferences, and escaped delimiters. Preserve the WP-B1 guarantee that variable values are not backslash-doubled.

### Frontend Type Drift

Risk: backend accepts `mustache` but frontend unions still only allow `curly | fstring | jinja2`.

Mitigation: in WP-B3, widen only the minimal frontend/shared type surfaces required to load and preserve `mustache` configs. Keep selector hiding, native JSON transport, and discovery semantics for the frontend follow-up.

## Review Checklist

- `mustache` and `curly` tests prove different dotted-key semantics.
- `mustache` tests prove JSONPath and JSON Pointer still work.
- Literal-brace escaping is specified and tested.
- Unsupported Mustache constructs do not accidentally gain behavior.
- Existing `curly` edge-case tests still pass unchanged.
- `PromptTemplate` and judge call-site tests cover `mustache`.
- No live provider calls are required for unit tests.
