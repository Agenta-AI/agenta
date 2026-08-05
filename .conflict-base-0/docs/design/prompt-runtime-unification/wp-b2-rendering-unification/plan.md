# Plan

Use one feature branch and one PR for WP-B2. The change is atomic enough to review as one unit.

## Phase 1: Structured Renderer Foundation

Create a renderer above `render_template(...)`.

It should render prompt messages and JSON-like return configuration. It should not know about handlers, providers, secrets, or result parsing.

The message renderer should support Agenta `Message` objects and dict messages only. It should validate each message and each content part before rendering.

Milestone: direct unit tests cover message rendering, JSON-like rendering, field preservation, and render errors.

## Phase 2: PromptTemplate Adoption

Refactor `PromptTemplate.format(...)` to use the structured renderer.

Keep public behavior the same for completion and chat.

Milestone: chat and completion still render messages and `response_format` as before, through the shared renderer.

## Phase 3: Judge Adoption

Refactor `auto_ai_critique_v0(...)` to use the structured renderer.

Render judge `json_schema`.

Remove the local silent Jinja fallback.

Milestone: judge messages, judge schema rendering, and Jinja errors use the same rules as chat and completion.

## Phase 4: Cleanup

Remove duplicate local rendering helpers if they are no longer needed.

Keep output parsing in handlers.

Milestone: there is one structured rendering layer and one low-level string rendering layer.
