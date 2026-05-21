# WP-B3 Mustache Rendering

This workspace tracks WP-B3 from the prompt runtime unification RFC.

WP-B3 builds on WP-B1 and WP-B2. WP-B1 extracted the low-level string renderer at `sdks/python/agenta/sdk/utils/templating.py`. WP-B2 added the structured renderer at `sdks/python/agenta/sdk/utils/rendering.py` and routed prompt messages plus JSON-return configuration through it. WP-B3 adds the `mustache` template format to that stack as the precursor to consistent nesting handling.

## Scope

- Add `mustache` as a supported backend `template_format`.
- Support `mustache` for both normal prompts and LLM-as-a-judge evaluator prompts.
- Make `mustache` the default rendering format for newly created apps / prompt configs.
- Keep `curly` as the legacy compatibility mode with literal-key-first dotted lookup.
- Make `mustache` use nested-only dotted lookup: `{{a.b}}` resolves key `a`, then child `b`; it must not prefer a literal top-level key named `a.b`.
- Resolve JSONPath-style selectors first, then fall back to mustache variable/name handling.
- Preserve JSONPath (`{{$...}}`) and JSON Pointer (`{{/...}}`) support where the current resolver contract already supports them.
- Define literal-brace escaping for `mustache`.
- Leave frontend hiding of `curly` from the format selector to the frontend WP: `curly` should only remain visible when it is already selected on an old app.
- Extend SDK tests at the low-level renderer, structured renderer, `PromptTemplate`, and LLM-as-a-judge call sites.

## Files

- `rfc.md` - Technical proposal for `mustache` semantics, escaping, compatibility, dependency choice, and rollout.
- `research.md` - Current implementation map, frontend touchpoints, and Mustache library evaluation.
- `plan.md` - Phased execution plan.
- `qa.md` - Test plan.
- `status.md` - Current decisions, blockers, and next steps.
