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
- 2026-05-21: Evaluated `noahmorrison/chevron` and decided not to use it directly because it is too old.
- 2026-05-21: Added `langchain_core.utils.mustache` as the preferred library candidate, with tokenizer-first adoption recommended over blindly using the full renderer.
- 2026-05-21: Added product context: `mustache` is the precursor to nesting handling, applies to prompts and LLM-as-a-judge, and should be the default for newly created apps.
- 2026-05-21: Drafted RFC, implementation plan, QA plan, and status tracking for `mustache`.

## Decisions

- `mustache` is Agenta's variable-substitution mode, not full Mustache.
- `mustache` is the backend prerequisite for cleaner nesting behavior.
- `mustache` must be accepted for normal prompts and LLM-as-a-judge evaluator prompts.
- Newly created apps / prompt configs should explicitly default to `mustache`.
- Do not use `chevron` as the core runtime implementation.
- Prefer evaluating `langchain_core.utils.mustache.tokenize(...)` for parsing tags.
- Use LangChain Core's full `render(...)` only if it satisfies Agenta's resolver, error, and escaping contracts without brittle adaptation.
- Keep `curly` literal-key-first behavior unchanged for existing apps.
- Frontend should hide `curly` from new-app format selection and show it only when an old app already selected it.
- Add a separate nested-only dot resolver for `mustache`.
- Resolve JSONPath / JSON Pointer selector prefixes before normal mustache variable handling.
- Keep JSONPath and JSON Pointer support in `mustache`.
- Add explicit delimiter escaping in `mustache` with backslash escapes.
- Do not retrofit delimiter escaping into `curly` as part of WP-B3.
- Do not silently migrate existing judge revisions to `mustache`.
- Keep legacy missing-format fallbacks separate from new-app defaults.

## Blockers

None.

## Open Questions

- Is adding `langchain-core` acceptable for the SDK after checking transitive dependencies, import cost, package size, and lockfile impact?
- Should unsupported Mustache constructs such as sections and partials raise explicit errors, or pass through as literal text when they do not match Agenta's variable placeholder grammar?
- Should `{{.}}` render the current context root in `mustache`, or should root access remain JSONPath-only via `{{$}}`? Current recommendation: use `{{$}}` and keep `{{.}}` invalid.
- Should minimal frontend type widening ship in WP-B3, or should all frontend acceptance be deferred to WP-F2? Current recommendation: widen only preservation paths that would otherwise corrupt backend configs.

## Next Steps

1. Implement nested-only resolver helpers.
2. Implement `_render_mustache(...)` and widen `TemplateMode`.
3. Widen backend config schemas and handler validation.
4. Locate new app / prompt creation defaults and set them to `mustache` where safe.
5. Add focused unit tests.
6. Run SDK formatting, lint, and focused tests.

## Expected Validation

Run from `sdks/python`:

```bash
uv run ruff format agenta/sdk/utils/templating.py agenta/sdk/utils/resolvers.py agenta/sdk/utils/rendering.py agenta/sdk/utils/types.py agenta/sdk/engines/running/handlers.py agenta/sdk/engines/running/interfaces.py oss/tests/pytest/unit/test_render_template_helper.py oss/tests/pytest/unit/test_structured_rendering.py oss/tests/pytest/unit/test_prompt_template_extensions.py oss/tests/pytest/unit/test_auto_ai_critique_v0_runtime.py
uv run ruff check --fix agenta/sdk/utils/templating.py agenta/sdk/utils/resolvers.py agenta/sdk/utils/rendering.py agenta/sdk/utils/types.py agenta/sdk/engines/running/handlers.py agenta/sdk/engines/running/interfaces.py oss/tests/pytest/unit/test_render_template_helper.py oss/tests/pytest/unit/test_structured_rendering.py oss/tests/pytest/unit/test_prompt_template_extensions.py oss/tests/pytest/unit/test_auto_ai_critique_v0_runtime.py
uv run pytest oss/tests/pytest/unit/test_render_template_helper.py oss/tests/pytest/unit/test_structured_rendering.py oss/tests/pytest/unit/test_prompt_template_extensions.py oss/tests/pytest/unit/test_auto_ai_critique_v0_runtime.py -q
```

If frontend preservation paths are touched, also run from `web`:

```bash
pnpm lint-fix
```
