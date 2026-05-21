# Plan

Use one feature branch and one PR for WP-B3. The runtime change is narrow enough to review atomically, but the PR should be strict about compatibility tests because `curly` and `mustache` share delimiter syntax.

## Phase 1: Resolver Semantics

Add nested-only dot resolution beside the existing literal-key-first resolver.

Milestone: direct tests prove:

- `mustache` resolution checks JSONPath / JSON Pointer selector prefixes before normal mustache variable handling.
- `curly` still resolves a literal key named `a.b` before nested traversal.
- `mustache` resolves `{{a.b}}` through nested traversal only.
- missing keys, empty placeholders, scalar traversal, and list indexes keep the same error style.

## Phase 2: Library Spike

Evaluate `langchain_core.utils.mustache` before writing the renderer.

Check:

- dependency and lockfile impact
- import cost in SDK startup paths
- tokenizer output for variables, sections, inverted sections, partials, comments, delimiter changes, and no-escape tags
- full renderer behavior for missing keys, dotted keys, html escaping, partials, lambdas, and keep/warn options

Milestone: decide between tokenizer-first LangChain Core adoption and a local tokenizer fallback.

## Phase 3: Low-Level Mustache Renderer

Extend `TemplateMode` and `render_template(...)` with `mustache`.

Add delimiter escaping:

- `\{{` -> literal `{{`
- `\}}` -> literal `}}`

Milestone: `test_render_template_helper.py` covers `mustache` top-level values, nested values, arrays, JSONPath, JSON Pointer, whole-object insertion, unicode, no recursive rendering, unresolved variables, unsupported constructs, and escaped delimiters.

## Phase 4: Runtime Adoption

Widen backend config validation to accept `mustache` for normal prompts and LLM-as-a-judge prompts.

Touchpoints:

- `sdks/python/agenta/sdk/utils/types.py`
- `sdks/python/agenta/sdk/engines/running/handlers.py`
- `sdks/python/agenta/sdk/engines/running/interfaces.py`
- any related builtin prompt config declarations

Milestone: `PromptTemplate.format(...)`, `render_messages(...)`, `render_json_like(...)`, and `auto_ai_critique_v0(...)` all accept `mode="mustache"` without extra branching.

## Phase 5: New-App Defaults

Find the app / prompt creation paths that write initial prompt config.

Set newly created app / prompt configs to `template_format="mustache"` explicitly. Keep compatibility fallbacks for old configs separate from new-app defaults.

Milestone: new apps default to `mustache`; existing configs are not rewritten or silently migrated.

## Phase 6: Minimal Frontend Preservation

Search frontend/shared type unions for `curly | fstring | jinja2`.

If a current UI path would drop or coerce a backend `mustache` config, widen that type union and preservation logic. Do not implement the broader WP-Fx behavior in this package.

Track the selector UX separately: the frontend should hide `curly` from the format list unless the current old app already has `curly` selected.

Milestone: existing configs with `template_format="mustache"` can be loaded and preserved without reverting to `curly`.

## Phase 7: Cleanup And Documentation

Update docstrings and comments that list supported formats.

Update the parent RFC tracking index.

Milestone: docs and code agree on the supported modes and on the `curly` vs `mustache` distinction.
