# Status

## Current State

WP-B2 is implemented on branch `feat/wp-b2-rendering-unification`.

The implementation adds a pure structured renderer, adopts it in `PromptTemplate`, adopts it in `auto_ai_critique_v0(...)`, and adds focused unit coverage.

## Progress Log

- 2026-05-14: Created the WP-B2 RFC workspace.
- 2026-05-14: Mapped the current message rendering and response-format rendering call paths.
- 2026-05-14: Proposed the first structured rendering adoption plan.
- 2026-05-14: Revised the plan to use one feature branch and one PR.
- 2026-05-14: Tightened the message-renderer contract. It now supports Agenta `Message` objects and judge dict messages, with validation and explicit content-part handling.
- 2026-05-14: Expanded `qa.md` with happy paths, grumpy paths, edge cases, compatibility coverage, deterministic mocking, and testability review checks.
- 2026-05-14: Implemented `agenta.sdk.utils.rendering` with `render_messages(...)`, `render_json_like(...)`, and `StructuredRenderingError`.
- 2026-05-14: Refactored `PromptTemplate.format(...)` to use the structured renderer while preserving `TemplateFormatError`.
- 2026-05-14: Refactored `auto_ai_critique_v0(...)` to render messages and `json_schema` through the structured renderer.
- 2026-05-14: Aligned judge Jinja behavior to raise instead of silently returning unrendered content.
- 2026-05-14: Added pure renderer tests and call-site coverage.

## Decisions

- WP-B2 should add tests for the structured renderers, not only the low-level string renderer.
- WP-B2 should ship as one feature branch and one PR.
- The structured renderer should sit above `render_template(...)`.
- The structured renderer should not own provider resolution or output parsing.
- The message renderer should not accept arbitrary untyped message collections.
- The message renderer should render text content only and preserve image, file, and other known non-text parts unchanged.
- Judge Jinja errors should raise after migration.
- Existing judge output parsing should stay in `auto_ai_critique_v0(...)`.
- WP-B2 tests should include pure renderer unit tests and call-site contract tests. They should not rely on live providers.

## Blockers

None.

## Open Questions

- None.

## Next Steps

1. Review the implementation diff.
2. Open one PR from `feat/wp-b2-rendering-unification`.
3. Optional manual smoke test with a real LLM-as-a-judge evaluator using `response_type=json_schema`.

## Validation

- `cd sdks/python && uv run ruff format ...`
- `cd sdks/python && uv run ruff check --fix ...`
- `cd sdks/python && uv run pytest oss/tests/pytest/unit -q`
- Result: `411 passed, 3 warnings`.
