# Plan

Use one feature branch and one PR for WP-B3. The runtime change is narrow enough to review atomically, but the PR should be strict about compatibility tests because `curly` and `mustache` share delimiter syntax.

## Phase 1: Library Adoption

Adopt `mystace` as the Mustache engine.

Check:

- dependency and lockfile impact
- import cost in SDK startup paths
- behavior for dotted names, sections, inverted sections, comments, delimiter changes, and unescaped variables
- behavior when a partial tag is present and no partial registry is supplied

Milestone: lock `mystace` as the renderer and document partial failure behavior.

## Phase 2: JSONPath Resolution

Add a pass that shields tags starting with `{{$`, then substitutes their resolved values into the rendered output last (never re-parsed).

Milestone: direct tests prove:

- `{{$.…}}` tags are resolved as JSONPath and inserted as inert data
- non-JSONPath tags are left for Mustache rendering
- `curly` still resolves with the existing literal-key-first behavior

## Phase 3: Low-Level Mustache Renderer

Extend `TemplateMode` and `render_template(...)` with `mustache`.

Have `_render_mustache(...)` run:

1. partial detection / partial failure
2. shield `{{$...}}`, `mystace` render, then substitute resolved JSONPath values last

Keep the existing SDK error contract centered on the current prompt-formatting types:

- low-level Mustache-specific failures should normalize into the existing prompt formatting error family
- prompt-template callers should keep surfacing `TemplateFormatError`
- LLM-as-a-judge should keep surfacing `PromptFormattingV0Error`

Do not route `mustache` through `resolve_any(...)` wholesale. `resolve_any(...)` includes JSON Pointer and legacy dotted fallback semantics that belong to `curly`, not to `mustache`.

Milestone: `test_render_template_helper.py` covers JSONPath tags, Mustache variables, sections, dotted names, whole-object insertion, unicode, no recursive rendering, and clear partial failures.

## Phase 4: Runtime Adoption

Widen backend config validation to accept `mustache` for normal prompts and LLM-as-a-judge prompts.

Touchpoints:

- `sdks/python/agenta/sdk/utils/types.py`
- `sdks/python/agenta/sdk/engines/running/handlers.py`
- `sdks/python/agenta/sdk/engines/running/interfaces.py`
- any related builtin prompt config declarations

Milestone: `PromptTemplate.format(...)`, `render_messages(...)`, `render_json_like(...)`, and `auto_ai_critique_v0(...)` all accept `mode="mustache"` without extra branching.

Compatibility rules to preserve while adopting `mustache`:

- keep current top-level input validation behavior for declared `input_keys`
- do not relax unexpected-input or missing-input checks just because Mustache itself is permissive
- make missing-variable behavior explicit and consistent with existing renderer-facing errors

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

If sections and inverted sections remain enabled through `mystace`, treat them as blessed product behavior:

- keep tests for them
- describe them in follow-up user-facing templating docs
- do not leave them as accidental engine leakage

Milestone: docs and code agree on the supported modes and on the `curly` vs `mustache` distinction.
