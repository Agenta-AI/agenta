# Status

## Current State

WP-B3 is implemented in this workspace.

Implemented:

- `mustache` mode added to the low-level renderer (`templating.py`) on top of `mystace`, with JSONPath pre-rendering for `{{$...}}` tags, partial/empty-placeholder rejection (`MustacheTemplateError`), HTML escaping disabled, and `curly`-compatible coercion (dict/list -> compact JSON).
- `mystace>=1,<2` added as an SDK dependency, loaded lazily via `_load_mystace()`.
- `TemplateMode` widened to `mustache | curly | fstring | jinja2`; structured renderer (`rendering.py`) needed type-only widening with no branching.
- `PromptTemplate` / `AgLLM` / handler / interface schemas accept `mustache`. Pydantic model defaults stay `curly` (legacy fallback); new-app creation surfaces declare `mustache` explicitly.
- LLM-as-a-judge: introduced **version 5** as the mustache default. v2 -> fstring, v3/v4 -> curly remain unchanged. `auto_ai_critique()` builtin now creates `version=5, template_format="mustache"`. Seeded judge presets (hallucination, conciseness, answer_relevancy, faithfulness) bumped from v4 to v5 and now declare `template_format="mustache"` explicitly; the evaluator catalog `settings_template` declares a hidden `template_format` (default `mustache`) and version default `5`.
- Application catalog: chat/completion `prompt_default` and the parameters schema declare `mustache` explicitly.
- Minimal frontend preservation: widened `TemplateFormat` unions in `web/packages/agenta-shared/src/utils/chatPrompts.ts` and `web/packages/agenta-entities/src/runnable/utils.ts` so a backend `mustache` config is recognized for variable extraction instead of coerced to `curly`. Selector-hiding UX deferred to the frontend WP.
- Tests: 219 passing across the four focused SDK unit suites, including mustache rendering, JSONPath pre-render, partial/empty failures, structured rendering, `PromptTemplate.format`, judge messages/json_schema, and version-default pins (v5 -> mustache, v3/v4 -> curly).

Original prep state:

WP-B3 was prepared for implementation in this workspace.

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
- WP-B3 should reuse the existing prompt-formatting error surfaces rather than inventing a parallel error family.
- `TemplateFormatError` remains the SDK-facing prompt template formatting error.
- `PromptFormattingV0Error` remains the LLM-as-a-judge wrapper for prompt rendering failures.
- `mustache` should not reuse `resolve_any(...)` directly because that would reintroduce JSON Pointer and legacy dotted fallback semantics.
- do not silently migrate existing judge revisions to `mustache`.
- keep legacy missing-format fallbacks separate from new-app defaults.
- LLM-as-a-judge gets a new **version 5** whose default format is `mustache`; v2 (fstring) and v3/v4 (curly) are left exactly as they were. New judge creation and seeded presets move to v5 and declare `template_format` explicitly rather than relying on the runtime version default.
- current `input_keys` validation semantics remain in force unless changed deliberately across all prompt formats.

## Blockers

None.

## Open Questions

- ~~Does `mystace` surface partial-tag failures cleanly enough on its own, or should WP-B3 pre-detect `{{>...}}` tags and raise a stable custom formatting error before render?~~ **Resolved: pre-detect.** Both `mystace` and `chevron` render unknown partials as empty text (no error), so WP-B3 pre-detects `{{>...}}` and raises `MustacheTemplateError`. This is product-authored behavior independent of the engine, so it is covered by dedicated grumpy-path tests, not by the engine-parity suite.
- **Engine choice validated by benchmark (2026-05-21):** `mystace` and `chevron` are behaviorally identical (22/22 parity) with comparable performance; `mystace` is retained because it exposes `stringify=` / `html_escape_fn=` hooks the WP-B3 contract needs. See `research.md`. A `render_template`-level engine-parity contract suite (`test_mustache_engine_parity_contract`) pins the guaranteed behavior so a future library swap is caught.
- What is the exact missing-variable contract for normal Mustache tags in Agenta runtime paths? Current code is stricter at the prompt-template boundary than raw Mustache, and WP-B3 should either preserve that strictness or change it deliberately everywhere.
- Should `{{{$...}}}` / unescaped-Mustache forms participate in the JSONPath pre-render pass, or should the pre-pass only handle normal `{{$.…}}` tags?
- Should minimal frontend type widening ship in WP-B3, or should all frontend acceptance be deferred to WP-F2? Current recommendation: widen only preservation paths that would otherwise corrupt backend configs.

## Next Steps

All implementation steps below are done.

1. ~~Implement JSONPath pre-rendering for `{{$.…}}` tags.~~ Done.
2. ~~Implement `_render_mustache(...)` on top of `mystace` and widen `TemplateMode`.~~ Done.
3. ~~Widen backend config schemas and handler validation.~~ Done.
4. ~~Locate new app / prompt creation defaults and set them to `mustache` where safe.~~ Done (chat/completion catalog defaults; judge v5).
5. ~~Add focused unit tests, including sections, partial failure cases, and prompt/judge error normalization.~~ Done.
6. ~~Run SDK formatting, lint, and focused tests.~~ Done (219 passing; ruff clean; `pnpm lint-fix` clean).

Implemented in this PR (frontend selector):

- The prompt template-format picker now offers only `mustache` and `jinja2` for new prompts; legacy `curly` and `fstring` are hidden. A prompt that already stores a legacy format keeps it visible/selectable so it is not silently coerced. Logic lives in `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/templateFormatOptions.ts` (`buildTemplateFormatOptions`) and is pinned by a vitest regression suite (`tests/unit/templateFormatOptions.test.ts`) because hiding curly/fstring was lost in a prior regression.
- Editor/chat-message `TemplateFormat` unions in `@agenta/ui` (`Editor`, `ChatMessage`, token plugins) widened to include `mustache`; mustache tokenizes through the existing `{{ }}` (curly) path.

Deferred to frontend follow-up (WP-Fx):

- Playground native JSON transport and prompt-editor autocomplete for `mustache`.

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
