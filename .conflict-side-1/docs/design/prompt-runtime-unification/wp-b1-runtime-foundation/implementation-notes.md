# Implementation Notes

## Backend patch shape (Phase 1)

`auto_ai_critique_v0` should keep accepting the same flat parameters.

Replace this pattern:

- retrieve all secrets
- manually copy selected provider keys into LiteLLM globals
- call `litellm.acompletion(model=model, ...)` with hard-coded `temperature=0.01`

With this pattern:

- call `await SecretsManager.ensure_secrets_in_workflow()`
- call `SecretsManager.get_provider_settings_from_workflow(model)`
- if missing, raise `InvalidSecretsV0Error(expected="dict", got=provider_settings, model=model)`
- call the LLM with the resolved provider settings, the rendered `messages`, and the constructed `response_format`. Do not pass `temperature` (or any other unsupported optional kwarg).

Preserve the existing JSON parsing and result normalization after the LLM call.

The temperature change is intentional and behavior-compatible at the evaluator contract level: the flat config and output shape stay unchanged, while the runtime stops sending an unsupported optional provider parameter that some newer models reject.

## Prompt rendering in Phase 1

Keep `auto_ai_critique_v0` using `_format_with_template(...)` for message content during Phase 1. This is the lowest-risk path and directly fixes the custom-model issue without touching the rendering surface.

Aligning the message renderer with chat/completion's `PromptTemplate` is **not** part of WP-B1; it lands in WP-B2.

## Low-level rendering helper (Phase 2)

The helper is the foundation for WP-B2 and WP-B3. Boundary:

```python
def render_template(
    *,
    template: str,
    mode: TemplateMode,   # "curly" | "fstring" | "jinja2"  (+ "mustache" once WP-B3 lands)
    context: Mapping[str, Any],
) -> str:
    ...
```

Properties:

- Pure: no I/O, no service knowledge, no logging side-effects.
- Unit-testable: takes a string and a context, returns a string.
- The single place where mode-specific substitution logic lives. After Phase 2, both `PromptTemplate.format` (chat/completion) and `_format_with_template` (judge) call into it for the per-mode rendering step.

What is **not** in this helper (so the boundary stays clean):

- Provider/secret resolution. Stays where it is in WP-B1; gets factored into a helper as part of broader runtime alignment in later WPs.
- Message-list rendering (iterate prompt messages, render each `content`). Belongs to the message renderer in WP-B2.
- Response-format / `json_schema` rendering. Belongs to the JSON-return renderer in WP-B2.
- Whole-object insertion / compact-JSON-text formatting decisions for non-string context values. Those rules belong to the message renderer (WP-B2) and the JSON-return renderer (WP-B2); the low-level helper just handles the substitution given a rendered context.

## Behavior preservation in Phase 2

The helper extraction must not change existing behavior:

- `curly` keeps literal-key-first lookup, JSONPath, JSON Pointer, dot-notation, and array-index traversal.
- `fstring` keeps Python `str.format` semantics.
- `jinja2` keeps sandboxed-environment behavior. Error behavior (raise vs. silent return) stays as it is in this WP — alignment on raise lands in WP-B2.

## Companion frontend changes

Limited to model-selection transform robustness in `web/packages/agenta-entities/src/runnable/evaluatorTransforms.ts`. Goal: a custom or self-hosted model picked in the evaluator UI persists through nest → flatten cycles and renders correctly in the model selector.

Confirm:

- `model` keeps `x-ag-type-ref: model` through the nested prompt schema.
- Custom model keys from `useLLMProviderConfig()` are valid selections.
- `flattenEvaluatorConfiguration(...)` writes the selected model back to the flat `model` field without dropping it.

Do **not** add new LLM-as-a-judge config controls for `temperature`, max tokens, top p, tools, tool choice, or reasoning effort. Those are out of scope for WP-B1 and would change product behavior.

## Compatibility rules

- Existing evaluator revisions continue to store flat params.
- Existing SDK usage continues to fetch and pass evaluator config as flat params.
- Existing evaluation result shape is unchanged.
- Existing chat/completion behavior is unchanged. The Phase 2 helper extraction is internal — `PromptTemplate.format` and `_format_with_template` keep their public signatures and observable behavior.
