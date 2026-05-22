# [feat] Add `{{mustache}}` rendering (prompt unification WP-B3)

## Summary

Implements WP-B3 of the prompt runtime unification RFC: adds `mustache` as the fourth prompt `template_format` and makes it the default for newly created apps, prompt configs, and LLM-as-a-judge evaluators. It builds on the low-level renderer from WP-B1 and the structured renderer from WP-B2.

`mustache` is real Mustache (via the `mystace` engine) plus the one Agenta extension every format already carries: tags that start with `{{$` are resolved as JSONPath against the render context. Existing `curly`, `fstring`, and `jinja2` prompts are untouched — old apps keep their declared format, and only *new* creation paths write `mustache`.

This is primarily a backend/SDK package. The frontend changes are the minimal type-and-picker surface needed to load, preserve, and select `mustache`; the larger playground/native-JSON work stays in the frontend follow-up packages (WP-F2/F3).

## What's in it

### SDK rendering (`sdks/python/agenta/sdk/utils/`)

- **`templating.py`** — new `_render_mustache(...)`; `TemplateMode` widened to include `"mustache"`. Rendering follows the same **shield-and-substitute** model the other formats use: `{{$...}}` JSONPath tags are shielded from the engine, the rest is rendered by `mystace`, and the resolved JSONPath values are substituted into the output **last, as inert text — never re-parsed**. Partials (`{{>...}}`), empty placeholders, JSON-Pointer tags, NUL bytes, and engine parse errors fail clearly.
- **`types.py`** — `PromptTemplate` accepts `mustache` and keeps its public `TemplateFormatError` surface for chat/completion callers.
- **`rendering.py`** — type-widening only; `render_messages(...)` / `render_json_like(...)` work unchanged once the mode is accepted.

#### Effect on the other renderers (`curly` / `jinja2` / `fstring`)

Adding `mustache` was done by extracting one shared `{{$...}}` JSONPath helper (`_render_with_jsonpath`) rather than a mustache-only path, so the other formats are touched to varying degrees:

- **`curly` — functionally equivalent.** Its output is unchanged: it already resolved `{{$...}}` as inert data, and `resolvers.py` has zero diff. It is now the *reference* behavior the other two `{{ }}` formats match, rather than a special case.
- **`jinja2` — refactored onto the shared helper, behavior preserved.** `_render_jinja2` no longer renders directly; it routes through `_render_with_jsonpath`, so `{{$...}}` is shielded from Jinja, the engine runs, and resolved values are substituted last as inert data (`{% raw %}` / `{# #}` spans are skipped and left to Jinja). Same rendered output, now sharing curly's JSONPath contract.
- **`fstring` — untouched.** Still `template.format(**context)`; no JSONPath, no change.
- **One error-contract change that spans all formats (but is only newly observable for mustache/jinja2).** The `TemplateFormatError` message for unresolved variables now interpolates the actual `template_format` instead of the hardcoded literal `"curly"` (`types.py`, both the chat/completion and structured paths). For **`curly` the wording is identical to before** ("…in curly template…"). What changed is that, after the JSONPath unification, an unresolved `{{$...}}` tag can now raise `UnresolvedVariablesError` from **mustache** and **jinja2** too — so the interpolation is what keeps *their* error message correctly labeled (previously they would have been mislabeled "curly"). `fstring` never raises this error (it uses `str.format`, surfacing `KeyError`), so for fstring the branch is dormant — the change applies to it in principle but is not currently triggerable.

### Engine config (`sdks/python/agenta/sdk/engines/running/`)

- **`interfaces.py`** — the mustache default lands here for **all three workflow types**:
  - `llm_v0_interface`: the `template_format` schema scalar widens its enum to `["mustache", "curly", "fstring", "jinja2"]` and flips `default` from `curly` to `mustache` (this is what new LLM/completion apps inherit, and the dropdown default).
  - `chat_v0_interface` and `completion_v0_interface`: built-in default config flips `"template_format"` from `curly` to `mustache`.
- **`handlers.py`** — `auto_ai_critique_v0` learns a v5 default of `mustache` (v2 → `fstring`, v3/v4 → `curly` unchanged). An explicit `template_format` always wins over the version default; old judge revisions keep their original behavior.
- **`builtin.py`** — the built-in `auto_ai_critique` template bumps to version `5` / `template_format="mustache"`.

### Backend resource (`api/oss/src/resources/evaluators/evaluators.py`)

- LLM-as-a-judge evaluator definitions bump to version `5` and carry an explicit hidden `template_format: "mustache"` field, so newly created judges render with mustache.

### Error contract

- `MustacheTemplateError` — unsupported partial, empty placeholder, JSON-Pointer tag, NUL byte, or `mystace` parse error.
- `UnresolvedVariablesError` — an unresolved `curly` placeholder **or** a failed `{{$...}}` JSONPath tag, in any of `mustache` / `jinja2` / `curly` (cross-format parity).
- `TemplateFormatError` — the public `PromptTemplate` surface, preserved.

### Frontend (type + picker surface only)

- `template_format` unions widened to include `"mustache"` across the editor token plugin, chat-message components, prompt schema control, and the shared chat-prompt extractor. `mustache` shares curly's `{{name}}` extraction/highlighting path.
- New `templateFormatOptions.ts`: the picker now **offers only `mustache` and `jinja2`** to new prompts. `curly` / `fstring` are legacy — hidden from the picker, but a prompt that already stores one keeps it visible and selectable (no silent coercion). Restores hiding that had regressed; pinned by a unit test.
- Shared `resolveTemplateFormat(...)` is reused in the workflow molecule so `mustache` is preserved instead of coerced.

### Docs

- `rfc.md` — dependency choice (`mystace` vs `chevron`, with `langchain_core` considered and rejected), the three intentional Mustache deviations, the JSONPath compatibility requirement, and the security note (narrow context, never-re-parse).
- `_mustache-templates.mdx` — draft how-to (variables, sections, `{{$...}}`, value coercion, what's unsupported, and escaping literal `{{ }}`).
- `escape-analysis.md` — standalone analysis of the escape question raised in review: no backslash escape exists in `mystace` or `langchain_core`/`chevron`; the canonical literal-brace mechanism is the Mustache delimiter swap (and `{% raw %}` for jinja2). **Decision: document now, defer a backslash escape** unless real demand appears for literal `{{` in curly.
- `findings.md`, `research.md`, `plan.md`, `qa.md`, `status.md`, `README.md` — design workspace and review-findings record.

## Compatibility

- Existing apps remain on their declared format. `curly` / `fstring` / `jinja2` behavior is unchanged.
- Only new creation paths write `mustache`. Old judge revisions keep their per-version default.
- Frontend never coerces a stored legacy format; it stays selectable for prompts that already use it.

## Validation

- `cd sdks/python && uv run ruff format` + `uv run ruff check` — clean.
- `cd sdks/python && uv run pytest oss/tests/pytest/unit -q` — green (mustache coverage across JSONPath resolution, sections, value coercion, partial/empty/JSON-Pointer/NUL rejection, cross-format `{{$...}}` parity, `PromptTemplate`, and LLM-as-a-judge).
- `pnpm --filter @agenta/entity-ui test` — picker and mustache-extraction regression pins pass.
- `pnpm lint-fix` + `types:check` on the touched web packages — clean.
