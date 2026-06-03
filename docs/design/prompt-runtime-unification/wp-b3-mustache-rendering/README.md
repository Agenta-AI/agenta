# WP-B3 Mustache Rendering

This workstream tracks WP-B3 from the prompt runtime unification RFC.

WP-B3 builds on WP-B1 and WP-B2. WP-B1 extracted the low-level string renderer at `sdks/python/agenta/sdk/utils/templating.py`. WP-B2 added the structured renderer at `sdks/python/agenta/sdk/utils/rendering.py` and routed prompt messages plus JSON-return configuration through it. WP-B3 adds the `mustache` template format to that stack using `mystace`, with JSONPath `{{$...}}` tags resolved as inert data and substituted into the rendered output last (never re-parsed) — the same handling `curly` already had, now unified across `curly` / `mustache` / `jinja2`.

## Scope

- Add `mustache` as a supported backend `template_format`.
- Support `mustache` for both normal prompts and LLM-as-a-judge evaluator prompts.
- Make `mustache` the default rendering format for newly created apps / prompt configs.
- Keep `curly` as the legacy compatibility mode with literal-key-first dotted lookup.
- Pre-render only tags that start with `{{$` as JSONPath expressions against the render context.
- Then run normal Mustache rendering through `mystace`.
- Do not support partials. If `{{>...}}` appears, fail clearly with a formatting error.
- Leave frontend hiding of `curly` from the format selector to the frontend WP: `curly` should only remain visible when it is already selected on an old app.
- Extend SDK tests at the low-level renderer, structured renderer, `PromptTemplate`, and LLM-as-a-judge call sites.

## Files

- `rfc.md` - Technical proposal for `mustache` semantics, compatibility, dependency choice, and rollout.
- `research.md` - Current implementation map, frontend touchpoints, and Mustache library evaluation.
- `plan.md` - Phased execution plan.
- `qa.md` - Test plan.
- `status.md` - Current decisions, blockers, and next steps.
