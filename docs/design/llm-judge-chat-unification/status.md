# Status

## Current State

Planning workspace created. Scope is limited to custom/all-model support and runtime unification for existing chat/completion and LLM-as-a-judge handlers. The earlier idea of adding broader `llm_config` fields to LLM-as-a-judge is explicitly out of scope for this iteration.

## Progress Log

- Created `docs/design/llm-judge-chat-unification/`.
- Reviewed current `auto_ai_critique_v0`, `completion_v0`, `chat_v0`, `PromptTemplate`, `SecretsManager`, and evaluator frontend transforms.
- Captured implementation plan and QA strategy.
- Updated `qa.md` with a concrete test-addition plan based on `docs/designs/testing/README.md` and SDK/Web testing interface specs.

## Decisions

- Preserve the flat LLM-as-a-judge parameter contract.
- Preserve the LLM-as-a-judge output shape.
- Fix model support by reusing provider settings resolution, not by migrating to `llm_v0`.
- Keep frontend work limited to model-selection transform robustness.
- Do not add temperature, max token, tools, or broader model parameter controls now.
- Primary automated coverage should be SDK unit tests and pure frontend transform tests; full custom-provider execution remains manual/acceptance follow-up unless stable credentials exist.

## Blockers

- None for planning.

## Open Questions

- Where should the shared helper live long-term: inside `handlers.py` near existing handlers, or in a new runtime module to reduce file size?
- Is there an existing SDK/runtime test suite suitable for mocking `SecretsManager` and `mockllm`, or should focused tests be added with local monkeypatching?
- Which runner should own colocated `web/packages/agenta-entities` unit tests if no package-level test command currently exists?

## Next Steps

1. Implement Phase 1 backend patch in `auto_ai_critique_v0`.
2. Add tests for standard and custom provider resolution in judge.
3. Refactor shared helper after baseline tests pass.
4. Add focused frontend transform tests for custom model persistence.
