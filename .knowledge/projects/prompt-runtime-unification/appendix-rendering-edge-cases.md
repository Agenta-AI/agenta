# Appendix: Prompt Rendering Edge Cases

This appendix documents how the Agenta runtime handles the awkward parts of prompt rendering: special characters, escape sequences, ambiguous placeholders, and the boundary between *template* and *variable value*. It complements the [main RFC](README.md) and the per-WP notes in [`wp-b1-runtime-foundation/`](wp-b1-runtime-foundation/).

The goal is operational: when a user asks "why did my prompt render that way?", you should be able to find the answer here.

---

## Mental model

A prompt has two layers:

1. **The template** — author-controlled text with placeholder syntax (`{{name}}`, `{name}`, etc.).
2. **Variable values** — runtime-supplied data that fills the placeholders.

The substitution boundary is one-way and one-pass:

```
template  ──┐
            ├──► render_template ──► rendered text
context  ───┘
```

> **Variable values are inserted as data, not interpreted as templates.** A value of `"{{name}}"` is rendered verbatim — the runtime never re-scans the substituted text for additional placeholders. This is intentional: it makes user input safe to embed in any prompt regardless of whether the input happens to contain syntax that looks like a placeholder.

The single source of truth for substitution is `agenta.sdk.utils.templating.render_template` (see [`sdk/agenta/sdk/utils/templating.py`](../../../sdk/agenta/sdk/utils/templating.py)). All call sites — chat, completion, LLM-as-a-judge, agent loops — funnel through it.

---

## Supported template formats

| Format | Placeholder syntax | Default for | Notes |
|---|---|---|---|
| `curly` | `{{name}}` | All apps today | Non-greedy `{{ ... }}` regex; literal-key-first lookup; no escape mechanism. |
| `fstring` | `{name}` | Legacy compat | Python `str.format`; standard `{{` / `}}` escape. Not recommended for nested JSON. |
| `jinja2` | `{{ name }}` | Apps needing logic | Sandboxed; supports `{% raw %}`, filters, conditionals, loops. |
| `mustache` | `{{name}}` | New apps (after WP-B3) | Greenfield. Will ship with explicit escape rules. Not implemented yet. |

---

## Escape mechanisms

How to include a literal `{` or `}` in the rendered output.

### `fstring`

Standard Python rule: doubled braces escape to single braces.

```text
template:  Show the JSON: {{"name": "{name}"}}
context:   {"name": "Ada"}
output:    Show the JSON: {"name": "Ada"}
```

The runtime relies on `str.format`'s built-in escape; nothing custom. Because `fstring` uses single-brace placeholders (`{name}`), you only need this when you want a literal `{` in the prompt.

### `jinja2`

Two options, picked based on context:

**Raw block** — best for multi-line literal sections such as few-shot examples:

```jinja2
Output should be valid JSON:

{% raw %}
{
  "answer": "{{value}}",
  "confidence": 0.9
}
{% endraw %}

User asked: {{ question }}
```

The raw block emits its contents verbatim — no `{{ ... }}` inside it is treated as a placeholder.

**Inline literal** — best for a single literal:

```jinja2
Mention the placeholder syntax {{ '{{' }}name{{ '}}' }} when teaching the user.
```

Here the Jinja expression `'{{'` evaluates to the literal string `{{`.

### `curly`

**There is no escape mechanism today.** A template containing `{{x}}` will always be treated as a placeholder named `x`. If you need literal `{{` or `}}` in your prompt, switch the template format to `jinja2` and use `{% raw %}…{% endraw %}`.

The cleanest path forward is to add an escape to the upcoming `mustache` format (RFC WP-B3) rather than retrofit `curly`, because the existing `{{ ... }}` regex captures the inner pair of braces in `{{{{x}}}}` as part of the variable name (see [Quadruple braces](#quadruple-braces) below).

### `mustache` (planned)

Will ship with an explicit escape mechanism in WP-B3. Final syntax TBD.

---

## Variable resolution rules (curly)

The `curly` format is the most feature-rich and the most likely to surprise. Resolution order for a placeholder `{{expr}}`:

1. **Literal-key-first.** If `expr` exists as a top-level key in the context — including keys with dots in them — its value is returned. This keeps existing apps that defined variables like `topic.story` working.
2. **JSONPath.** If `expr` starts with `$`, it is resolved as a JSONPath expression (`$.profile.name`, `$.users[0]`, …).
3. **JSON Pointer.** If `expr` starts with `/`, it is resolved as a JSON Pointer (`/profile/name`, `/foo~1bar`, …).
4. **Dot-notation.** Otherwise, `expr` is split on `.` and the path is walked through dicts and lists. Numeric segments index into lists.

### Example

```python
context = {
    "user": {"name": "Ada", "tags": ["alpha", "beta"]},
    "user.email": "ada@example.com",  # literal key with a dot
}
```

| Placeholder | Resolves to | Why |
|---|---|---|
| `{{user}}` | `'{"name": "Ada", "tags": ["alpha", "beta"]}'` | Whole-object insertion |
| `{{user.name}}` | `Ada` | Dot-notation (no literal key matches) |
| `{{user.tags.0}}` | `alpha` | Dot-notation with list index |
| `{{user.email}}` | `ada@example.com` | **Literal-key-first** wins |
| `{{$.user.name}}` | `Ada` | JSONPath |
| `{{/user/name}}` | `Ada` | JSON Pointer |

> **`mustache` will not preserve literal-key-first.** WP-B3 changes the semantics so `{{a.b}}` always means nested access. Apps that rely on dotted literal keys keep `curly`.

### Whole-object insertion

When a placeholder resolves to a `dict` or `list`, it is rendered as compact JSON via `json.dumps(value, ensure_ascii=False)`:

```text
template:  Profile: {{profile}}
context:   {"profile": {"name": "Ada", "tags": ["x", "y"]}}
output:    Profile: {"name": "Ada", "tags": ["x", "y"]}
```

Unicode is preserved (`ensure_ascii=False`), so non-ASCII characters render readably rather than as `\uXXXX` escapes.

### Scalar coercion

| Value type | Rendered as |
|---|---|
| `str` | The string itself |
| `int`, `float` | `str(value)` (`42`, `3.14`) |
| `bool` | `True` / `False` (capitalized — Python's `str` of `True`) |
| `None` | `None` (literal text) |
| `dict`, `list` | Compact JSON (see above) |

### Whitespace inside braces

The runtime trims whitespace inside `{{ ... }}`:

```text
{{name}}      ─┐
{{ name }}     ├─►  same lookup
{{   name  }}  ─┘
```

Whitespace tolerance is symmetric. Note that the simple frontend regex used in `web/packages/agenta-shared/src/utils/chatPrompts.ts` (`/\{\{(\w+)\}\}/g`) does *not* tolerate inner whitespace; the richer extractor in `web/packages/agenta-entities/src/runnable/utils.ts` does. Backend always wins at runtime — frontend extraction is for autocomplete only.

---

## Variable values: what's safe to put in them

Variable values are *data*. They never get re-rendered. Specifically:

| Concern | Behavior |
|---|---|
| Value contains another placeholder (`"{{world}}"`) | Inserted verbatim. Not re-scanned. |
| Value contains backslashes (`"C:\Users"`) | Round-trips with the same number of backslashes. |
| Value contains regex backreference syntax (`"\1\2"`) | Round-trips literally. |
| Value contains LF / CR / Unicode | Inserted verbatim. |
| Value is a dict or list | Rendered as compact JSON. |

> **Backslash trap (fixed 2026-05-01).** Earlier versions of `curly` mode doubled every backslash in values because `_render_curly` defensively called `.replace("\\", "\\\\")`. That escape is unnecessary when `re.sub` is invoked with a function callable (Python's docs are explicit: callable-mode does not interpret backslashes in the return value). The escape has been removed; values now round-trip correctly. A regression test pins the fix: `test_curly_preserves_single_backslash_in_value`.

### Why we don't recursively render

Recursive rendering — substituting placeholders, then re-scanning the result for more placeholders — would be a footgun. A user pasting LLM output back into a variable could accidentally trigger re-substitution against their own context. The single-pass guarantee keeps values inert.

If you actually want a value to be expanded as a sub-template, do it explicitly: render the sub-template separately and pass the result in.

---

## Placeholder regex edge cases

`curly` uses the regex `\{\{\s*(.*?)\s*\}\}` (non-greedy). Several non-obvious patterns:

### Quadruple braces

```text
template:  literal: {{{{x}}}}
expected by user:   literal: {{x}} after substitution
actual:             UnresolvedVariablesError(unresolved={"{{x"})
```

The non-greedy match takes the *first* `{{` and the *first* `}}`, so the captured name is `{{x` — not `x`. The frontend's variable extractor reports `x` as the variable, which means the playground UI can show "variable `x`" while the backend errors out on "variable `{{x`". This is the most common source of confusion when users try to escape braces.

Workaround today: switch to `jinja2` and use `{% raw %}{{x}}{% endraw %}`. Long-term fix lands in `mustache` (WP-B3).

### Triple-left brace

```text
template:  x={{{x}}
captured name: {x   (because the regex matches at position 2-7, eating `{{{x}}`)
```

Same root cause as quadruple. Pinned in `test_curly_triple_left_brace_captures_inner_brace_as_name`.

### Empty placeholder `{{}}`

Rejected with `UnresolvedVariablesError`. Earlier versions silently rendered the entire context dict as JSON because `resolve_dot_notation("", data)` short-circuited to `data`; that was a privacy footgun (any secret in the render context would land in the LLM prompt). Fixed alongside the backslash bug.

```text
template:  hello {{}}
context:   {"secret": "do-not-leak"}
result:    UnresolvedVariablesError(unresolved={""})
```

`{{ }}` (whitespace only) is treated the same way — the inner `.strip()` reduces it to `""`.

### Newlines inside braces

```text
template:  x={{a\nb}}
behavior:  no match (the non-greedy `.` does not match newlines)
result:    template passes through unchanged
```

If you've manually constructed a key named `"a\nb"` in your context, the placeholder won't pick it up. This is fine — newlines in variable names aren't supported anywhere else either.

### Mismatched braces

A bare `{` or `}` is not part of any placeholder and survives unchanged:

```text
template:  alone: { and } here
output:    alone: { and } here
```

### Single-brace inside curly mode

```text
mode: curly
template: literal {x}
output:   literal {x}
```

Single-brace syntax (`{x}`) is the `fstring` form. In `curly` mode it's just text.

---

## Mode-specific gotchas

### `fstring`

Python's `str.format` exposes more than substitution. These all work — pin them in tests, document them in user-facing docs as "advanced":

```text
{x:>10}          # right-align in a 10-character field
{x[0]}           # index into a list
{x.upper}        # attribute access (but won't *call* methods — returns the bound method repr)
```

The attribute-access case is worth noting: `{x.upper}` does *not* call `x.upper()`. It returns the string `<built-in method upper of str object at 0x...>` because `str.format` only does attribute lookup, not invocation. We don't filter this — Python format syntax is what it is — but the test suite pins it so we know if it changes.

### `jinja2`

- **No autoescape.** Prompts go to LLMs as text, not browsers. HTML-special characters (`<`, `>`, `&`) pass through unchanged. Setting autoescape would corrupt LLM input.
- **Sandboxed environment.** Built on `jinja2.sandbox.SandboxedEnvironment`. Attempts to access `__globals__`, `__class__`, `__subclasses__`, etc. raise `TemplateError`. Exploits like `{{ lipsum.__globals__['os'].popen('id').read() }}` are blocked.
- **Default `Undefined` is permissive.** A missing variable renders as the empty string rather than raising. If you need stricter behavior, file a request — we'd need to opt into `jinja2.StrictUndefined`.
- **Jinja errors are mode-specific until WP-B2.** Chat/completion (`PromptTemplate`) raises `TemplateFormatError`. The judge handler (`_format_with_template` in `engines/running/handlers.py`) currently logs the error and returns the original content. WP-B2 aligns both call sites on raise.

### `curly`

- **All-or-nothing.** If even one placeholder can't be resolved, the entire render fails with `UnresolvedVariablesError`. We never emit a partially-substituted string. This protects users from sending prompts with unresolved `{{...}}` to the LLM.
- **Hint suffix.** When unresolved expressions look like JSONPath (`$...`) or JSON Pointer (`/...`) and the `python-jsonpath` package is missing, the error message appends a hint to install it.

---

## Frontend ↔ backend parity

The frontend playground does not render templates server-side. It only:

1. **Extracts variable names** for autocomplete and the variables panel.
2. **Highlights tokens** in the editor (variables in blue, Jinja blocks in purple, comments in gray).

There are two extractor implementations in the frontend:

- A simple regex-based extractor in [`web/packages/agenta-shared/src/utils/chatPrompts.ts`](../../../web/packages/agenta-shared/src/utils/chatPrompts.ts).
- A richer parser-based extractor in [`web/packages/agenta-entities/src/runnable/utils.ts`](../../../web/packages/agenta-entities/src/runnable/utils.ts).

These are stricter than the backend regex (e.g., `\w+` only) and disagree on the same edge cases:

| Template | Frontend simple extractor | Frontend rich extractor | Backend resolution |
|---|---|---|---|
| `{{ name }}` | does not extract | extracts `name` | resolves `name` |
| `{{a.b}}` | does not extract | extracts `a.b` | dot-notation lookup |
| `{{{{x}}}}` | extracts `x` | extracts `x` | tries `{{x}}` → unresolved error |

The mismatches are tracked in WP-F3 (variable autocomplete polish). Backend behavior is canonical at runtime; frontend extraction is purely UX.

### Variable values from the playground

The playground sends variable values via the request body. Today, [`normalizeCompact` in `web/packages/agenta-entities/src/runnable/utils.ts`](../../../web/packages/agenta-entities/src/runnable/utils.ts) stringifies object and array values via `JSON.stringify` before sending — meaning a JSON object set in the playground arrives at the backend as a JSON-encoded string. The runtime then treats it as a string (no nested traversal).

The RFC's requirement is "native JSON stays native until template rendering" — that fix lands in **WP-F2** (frontend execution path). Until then, nested access (`{{profile.name}}`) works in the evaluation service (which preserves native JSON) but not in the playground (which stringifies it).

### Special characters in playground inputs

The playground does not escape `{`, `}`, backslashes, quotes, or any other special character before sending. Whatever the user typed reaches the backend verbatim. This is the right policy — the runtime is the only place that should decide how a value becomes text — but it does mean a user who types `{{name}}` into a variable input will see it appear literally in the rendered prompt (and not be re-substituted, per the variable-values-are-data rule above).

---

## What's pinned by tests

All behaviors in this appendix have a corresponding test in [`sdk/oss/tests/pytest/unit/test_render_template_helper.py`](../../../sdk/oss/tests/pytest/unit/test_render_template_helper.py). When you change rendering, run that file and confirm:

- The "regression pin" tests still pass (backslash, empty placeholder, no recursive rendering).
- The "edge case pin" tests still pass with the same outcomes (quadruple braces, triple braces, etc.).

If you intentionally change one of the pinned behaviors, update the corresponding test *and* this appendix in the same PR. Treat both as the public contract.

---

## Quick reference — "I want to ..."

| Goal | How |
|---|---|
| Use a literal `{` in the rendered output | `fstring` mode + `{{` ; or `jinja2` mode + `{% raw %}` |
| Use a literal `{{x}}` in the rendered output | `jinja2` mode + `{% raw %}{{x}}{% endraw %}` |
| Substitute a variable that contains JSON | Pass a `dict`/`list` directly. Use `{{var}}` for whole-object insertion or `{{var.field}}` for nested access (curly/mustache). |
| Allow user input that may contain `{{...}}` syntax | Just pass it. Values are never re-rendered. |
| Have variables with dots in their names | Use `curly` mode (literal-key-first) or address them via JSON Pointer (`/foo.bar`). |
| Use conditionals or loops | `jinja2` mode. |
| Render an entire context object as JSON | `{{$}}` (JSONPath root) in curly/mustache, or `{{ context | tojson }}` in jinja2 if `context` is bound. |

---

## Changelog

- **2026-05-01** — Fixed two bugs in `_render_curly`: backslash doubling and empty-placeholder context leak. Expanded `test_render_template_helper.py` from 21 to 81 tests covering the cases in this appendix. Added this appendix.
- **2026-04-30** — Extracted `render_template` into `sdk/agenta/sdk/utils/templating.py` (WP-B1).
