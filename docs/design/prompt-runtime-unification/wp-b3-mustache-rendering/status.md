# Status

## Current State

WP-B3 is prepared for implementation in this workspace.

WP-B1 is done in PR `Agenta-AI/agenta#4231`.

WP-B2 is done in PR `Agenta-AI/agenta#4331`.

The current checkout already has:

- low-level renderer: `sdks/python/agenta/sdk/utils/templating.py`
- structured renderer: `sdks/python/agenta/sdk/utils/rendering.py`
- resolver helpers: `sdks/python/agenta/sdk/utils/resolvers.py`
- unit coverage for low-level rendering, structured rendering, `PromptTemplate`, and LLM-as-a-judge

## Progress Log

- 2026-05-21: Created the WP-B3 design workspace.
- 2026-05-21: Reviewed the merged WP-B1 and WP-B2 PR summaries.
- 2026-05-21: Mapped current renderer, resolver, handler, schema, and frontend touchpoints in this checkout.
- 2026-05-21: Evaluated Mustache library options and selected `mystace` as the primary candidate.
- 2026-05-21: Clarified the contract: JSONPath pre-rendering only for tags that start with `{{$`, then normal Mustache rendering via `mystace`.
- 2026-05-21: Explicitly excluded partials and defined the expected behavior as a clear formatting error.
- 2026-05-21: Drafted RFC, implementation plan, QA plan, and status tracking for `mustache`.

## Decisions

- `mustache` uses `mystace` for normal Mustache rendering.
- `mustache` must be accepted for normal prompts and LLM-as-a-judge evaluator prompts.
- newly created apps / prompt configs should explicitly default to `mustache`.
- keep `curly` literal-key-first behavior unchanged for existing apps.
- frontend should hide `curly` from new-app format selection and show it only when an old app already selected it.
- only tags that start with `{{$` are pre-rendered through JSONPath.
- no JSON Pointer support is added to `mustache`.
- Mustache dotted names and sections follow `mystace` behavior.
- partials are unsupported and must fail clearly.
- do not silently migrate existing judge revisions to `mustache`.
- keep legacy missing-format fallbacks separate from new-app defaults.

## Blockers

None.

## Open Questions

- Does `mystace` surface partial-tag failures cleanly enough on its own, or should WP-B3 pre-detect `{{>...}}` tags and raise a custom formatting error before render?
- Should minimal frontend type widening ship in WP-B3, or should all frontend acceptance be deferred to WP-F2? Current recommendation: widen only preservation paths that would otherwise corrupt backend configs.

## Next Steps

1. Implement JSONPath pre-rendering for `{{$.…}}` tags.
2. Implement `_render_mustache(...)` on top of `mystace` and widen `TemplateMode`.
3. Widen backend config schemas and handler validation.
4. Locate new app / prompt creation defaults and set them to `mustache` where safe.
5. Add focused unit tests, including partial failure cases.
6. Run SDK formatting, lint, and focused tests.

## Expected Validation

Run from `sdks/python`:

```bash
uv run ruff format agenta/sdk/utils/templating.py agenta/sdk/utils/rendering.py agenta/sdk/utils/types.py agenta/sdk/engines/running/handlers.py agenta/sdk/engines/running/interfaces.py oss/tests/pytest/unit/test_render_template_helper.py oss/tests/pytest/unit/test_structured_rendering.py oss/tests/pytest/unit/test_prompt_template_extensions.py oss/tests/pytest/unit/test_auto_ai_critique_v0_runtime.py
uv run ruff check --fix agenta/sdk/utils/templating.py agenta/sdk/utils/rendering.py agenta/sdk/utils/types.py agenta/sdk/engines/running/handlers.py agenta/sdk/engines/running/interfaces.py oss/tests/pytest/unit/test_render_template_helper.py oss/tests/pytest/unit/test_structured_rendering.py oss/tests/pytest/unit/test_prompt_template_extensions.py oss/tests/pytest/unit/test_auto_ai_critique_v0_runtime.py
uv run pytest oss/tests/pytest/unit/test_render_template_helper.py oss/tests/pytest/unit/test_structured_rendering.py oss/tests/pytest/unit/test_prompt_template_extensions.py oss/tests/pytest/unit/test_auto_ai_critique_v0_runtime.py -q
```

If frontend preservation paths are touched, also run from `web`:

```bash
pnpm lint-fix
```
