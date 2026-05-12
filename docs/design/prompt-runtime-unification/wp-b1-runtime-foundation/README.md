# WP-B1 — Runtime Foundation

Implementation tracking for **WP-B1: Secret handling and low-level rendering helper** from the [RFC](../README.md).

## Scope

Per the RFC, this work package delivers three things:

1. **Patch `auto_ai_critique_v0`** to use the shared provider/secret resolution path. Custom and self-hosted models configured in the UI become available to the judge.
2. **Stop sending hard-coded `temperature=0.01`** from the judge LLM call.
3. **Extract a low-level rendering helper** with signature roughly `(template_string, mode, context) -> rendered_string`. Pure, unit-testable, no service knowledge. The substitution modes (`mustache`, `curly`, `fstring`) and `jinja2` all funnel through it.

The helper extraction in (3) is foundation work for WP-B2 (message and JSON-return rendering) and WP-B3 (the `mustache` format) in the RFC. Those are out of scope here.

## Non-Goals

- Do not migrate evaluators to a new config shape; the flat LLM-as-a-judge config contract stays unchanged.
- Do not change evaluator output parsing or result shape.
- Do not introduce new judge config fields (temperature, max tokens, tools, response format controls).
- Do not unify message rendering or JSON-return rendering across services in this WP — that's WP-B2.
- Do not add `mustache` here — that's WP-B3.

## Companion frontend change

The frontend evaluator UI needs to keep allowing custom-model selection so the user can actually pick the models that WP-B1 enables on the backend. Scope is limited to model-selection transform robustness in `web/packages/agenta-entities/src/runnable/evaluatorTransforms.ts`. No new judge UI controls. Tracked here because it ships with WP-B1; broader playground UX work lives in WP-F1/F2/F3 in the RFC.

## Files

- [plan.md](plan.md) — phased implementation plan.
- [implementation-notes.md](implementation-notes.md) — backend patch shape, helper boundary, companion frontend.
- [qa.md](qa.md) — test plan with mocking notes.
- [research.md](research.md) — codebase findings.
- [variable-and-template-analysis.md](variable-and-template-analysis.md) — current input variables, value formats, template behavior across handlers.
- [status.md](status.md) — progress, decisions, blockers, next steps.
