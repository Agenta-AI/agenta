# RFC: WP-B3 Mustache Rendering

## Summary

WP-B3 adds `mustache` as the fourth prompt template format and makes it the default rendering format for newly created apps / prompt configs.

This is a backend runtime package. It extends the renderer foundation from WP-B1 and the structured renderer from WP-B2. It does not redesign evaluator storage, change playground native JSON transport, or force existing apps to migrate away from `curly`.

WP-B3 uses `mystace` for Mustache rendering. Agenta adds one extension around it: tags that start with `{{$` are shielded from the engine, then resolved as JSONPath expressions against the render context and substituted into the output last, as inert data (never re-parsed). Partials are not supported and must fail clearly.

## Goals

1. Add `mustache` to the SDK renderer stack.
2. Support `mustache` anywhere prompt rendering is configured: completion/chat prompts and LLM-as-a-judge evaluator prompts.
3. Make `mustache` the default format for newly created apps / prompt configs.
4. Keep `curly`, `fstring`, and `jinja2` behavior unchanged for existing configs.
5. Resolve only tags that start with `{{$` as JSONPath expressions before Mustache rendering.
6. Run ordinary Mustache rendering through `mystace`.
7. Reject partials clearly.
8. Make whole-object and whole-array insertion render as compact JSON text.
9. Extend backend validation and schemas to accept `mustache`.
10. Add focused tests across JSONPath resolution, Mustache rendering, structured rendering, chat/completion, and LLM-as-a-judge.

## Non-Goals

WP-B3 does not support partials:

```text
{{> partial}}
```

No partial registry or filesystem template loading.

No frontend native JSON transport changes. That belongs to WP-F2.

No broad UI redesign. The frontend package should hide `curly` from the format list for new apps and only show it when an old app already has `curly` selected. Prompt-editor autocomplete and native JSON transport still belong to later frontend packages.

No evaluator config migration. The judge flat config remains valid.

## Dependency Choice

Use `mystace`.

The choice is backed by a head-to-head evaluation of `mystace` (1.0.1) vs `chevron` (0.14.0) — see `research.md` ("Library Evaluation" + "Benchmark"). Summary of the evidence:

- **Behavior is equivalent.** 22/22 benchmark cases produced byte-identical output across variables, dotted/deep-dotted names, sections, inverted sections, comments, delimiter swaps, and triple-brace.
- **Performance is a wash** for prompt rendering (microseconds per render; `chevron` faster on scalars, `mystace` faster on iteration-heavy sections).
- **The deciding factor is integration cleanliness.** WP-B3 needs HTML escaping off and compact-JSON coercion for whole-object insertion. `mystace` exposes `stringify=` and `html_escape_fn=` so both are one-liners; `chevron` exposes neither and would require pre-walking/pre-stringifying the context by hand.
- **Spec-aligned and current.** `mystace` claims Mustache spec v1.4.3 compliance, targets Python >=3.10, and is actively released (1.0.1, 2025-12-19). `chevron`'s last release is 2021 and advertises Python only through 3.6.

`langchain_core.utils.mustache` was considered and rejected: it is a heavy, fast-moving dependency outside its maintainers' core focus, and it implements neither JSONPath nor JSON Pointer selectors (its resolver is dot-splitting only), so it would not satisfy the `{{$...}}` requirement without a custom resolver anyway.

### Mustache Conformance and Deviations

Principle: **follow Mustache to the letter**, deviating only where a stated product requirement demands it. We do not invent a custom dotted-name dialect or a Mustache subset.

There are exactly three intentional deviations from stock Mustache, all delegated to `mystace` configuration or a thin wrapper:

1. **`{{$...}}` JSONPath resolution** — the one additive extension (see Resolution Model below).
2. **HTML escaping off** — prompt text is not HTML, so `{{var}}` is not entity-escaped (`html_escape_fn` passthrough). `{{{var}}}` / `{{&var}}` therefore behave like `{{var}}`.
3. **Compact-JSON coercion** — dict/list values render as compact JSON instead of Python `repr`, to match `curly` (`stringify=`).

Everything else (sections, inverted sections, comments, delimiter swaps, lambdas as data, permissive missing keys) is stock `mystace` behavior. Partials are the only standard feature deliberately **rejected** rather than supported (no registry or template loader; a `{{>...}}` tag raises a clear error).

### JSONPath Compatibility Requirement

Hard requirement: **no regression to the JSONPath functionality `curly` already provides.** `mustache` (and `jinja2`) must resolve `{{$...}}` exactly as `curly` does — same resolution, same coercion, same failure contract. This is enforced by cross-format parity tests (`test_jsonpath_parity_across_formats`, `test_jsonpath_failure_parity_across_formats`) that run identical inputs through all three formats and assert byte-identical output and identical errors.

### Security

The render context is explicitly and narrowly constructed; there is no `os.environ`, globals, or wildcard merge, so OS secrets / env vars cannot leak into a prompt:

- normal prompts: context is exactly the invocation's `variables`.
- LLM-as-a-judge: context is a hand-built dict with a fixed key set (parameters, ground truth/reference, inputs, prediction/outputs, trace).

The only bounded risk was cross-field echo *within* that defined context (an untrusted field pulled via `{{$...}}` that itself contains template syntax). The "never re-parse a resolved value" rule in the Resolution Model removes it: resolved values are inserted as inert data and are never rendered a second time.

## Proposed Semantics

### Placeholder Syntax

Supported placeholders:

```text
{{name}}
{{ name }}
{{profile.name}}
{{$}}
{{$.profile.name}}
{{#users}}{{name}}{{/users}}
{{{html}}}
```

Whitespace directly inside delimiters is ignored.

Empty placeholders are invalid:

```text
{{}}
{{   }}
```

Newlines inside a placeholder are not supported. Keep the current single-line placeholder behavior unless there is a clear product reason to expand it.

### Resolution Model

WP-B3 resolves `{{$...}}` JSONPath tags as inert data:

1. Shield `{{$...}}` tags from the engine.
2. Render the rest with `mystace` using normal Mustache behavior.
3. Substitute the resolved JSONPath values into the rendered output last, as literal text — never re-parsed.

This matches the handling `curly` already had, now unified across `curly` / `mustache` / `jinja2`.

Examples:

```text
{{$.profile.name}} -> JSONPath tag (resolved as data)
{{name}} -> Mustache variable
{{profile.name}} -> Mustache dotted name
{{#users}}...{{/users}} -> Mustache section
{{>user}} -> error
```

No JSON Pointer support is added to `mustache`.

### Value Coercion

Resolved values are converted at the string-substitution boundary:

- dict/list -> compact JSON text with unicode preserved
- strings -> unchanged
- numbers, booleans, null -> `str(value)` behavior, matching current `curly`

Values are data, not templates. A variable value that contains `{{other}}` must not be rendered recursively.

### Partial Handling

Partials are not supported.

If a template contains:

```text
{{> user}}
```

WP-B3 should raise a clear formatting error. Do not silently ignore partials, do not attempt to load partial templates from disk, and do not expose a partial registry in runtime config.

## Implementation Design

### Low-Level Renderer

Extend `sdks/python/agenta/sdk/utils/templating.py`:

```python
TemplateMode = Literal["mustache", "curly", "fstring", "jinja2"]
```

Add `_render_mustache(...)`.

`_render_mustache(...)` should:

1. reject partial tags clearly
2. shield `{{$...}}` JSONPath tags, render through `mystace`, then substitute the resolved values into the output last (never re-parsed)

Keep `resolve_any(...)` unchanged for `curly`.

### Structured Renderer

`sdks/python/agenta/sdk/utils/rendering.py` should only need type widening through `TemplateMode`. It should not branch on `mustache`.

The same `render_messages(...)` and `render_json_like(...)` functions should work unchanged once `render_template(...)` accepts the new mode.

### PromptTemplate

Extend prompt config models in `sdks/python/agenta/sdk/utils/types.py` to accept `mustache`.

`PromptTemplate.format(...)` should preserve its public error surface:

- chat/completion still raise `TemplateFormatError` for render failures

Default handling:

- new app / prompt creation paths should set `template_format="mustache"`
- existing prompt configs keep their declared `template_format`
- legacy configs that genuinely omit `template_format` should keep the current compatibility fallback unless the creation path can prove the config is new
- backend accepts `mustache` now and should expose it in schemas

### LLM-As-A-Judge

Extend handler validation so `template_format="mustache"` is accepted for LLM-as-a-judge.

Keep current judge default behavior:

- version `2` defaults to `fstring`
- version `3+` defaults to `curly`

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

### Partial Failure Mode

Risk: a template author uses `{{>partial}}` expecting normal Mustache include behavior.

Mitigation: detect partials and fail clearly with a deterministic formatting error that says partials are unsupported.

### Frontend Type Drift

Risk: backend accepts `mustache` but frontend unions still only allow `curly | fstring | jinja2`.

Mitigation: in WP-B3, widen only the minimal frontend/shared type surfaces required to load and preserve `mustache` configs. Keep selector hiding, native JSON transport, and discovery semantics for the frontend follow-up.

## Review Checklist

- `mustache` tests prove `{{$.…}}` tags are resolved through JSONPath (as inert data, substituted last)
- `mustache` tests prove ordinary tags are rendered by `mystace`
- partial tags fail clearly
- existing `curly` edge-case tests still pass unchanged
- `PromptTemplate` and judge call-site tests cover `mustache`
- no live provider calls are required for unit tests
