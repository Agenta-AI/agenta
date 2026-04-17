# Extend Prompt Templates Findings

Scan scope: `973e80146..9420b8779` on `feat/extend-prompt-templates`

Active path: `docs/designs/extend-prompt-templates`

Sources reviewed:

- `docs/designs/extend-prompt-templates/{gap,initial.specs,plan,proposal,research}.md`
- `sdk/agenta/sdk/utils/types.py`
- `sdk/agenta/sdk/engines/running/handlers.py`
- `sdk/agenta/sdk/engines/running/interfaces.py`
- `api/oss/src/resources/workflows/catalog.py`
- `api/pyproject.toml`
- `web/packages/agenta-entities/src/shared/execution/requestBodyBuilder.ts`
- `web/packages/agenta-entity-ui/src/DrillInView/components/PlaygroundConfigSection.tsx`
- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/PromptSchemaControl.tsx`
- `web/oss/src/components/Playground/Components/Modals/RefinePromptModal/hooks/useRefinePrompt.ts`

Verification run:

- `pytest -q sdk/oss/tests/pytest/unit/test_prompt_template_extensions.py api/oss/tests/pytest/unit/evaluators/test_catalog_types.py` from repo root: SDK tests passed, API import failed with `ModuleNotFoundError: No module named 'oss.src'`.
- `pytest -q oss/tests/pytest/unit/evaluators/test_catalog_types.py` from `api`: failed because `prompt-template` lacked `fallback_llm_configs`.
- `PYTHONPATH=/Users/junaway/Agenta/github/application/sdk:/Users/junaway/Agenta/github/application/api pytest -q oss/tests/pytest/unit/evaluators/test_catalog_types.py` from `api`: passed.
- Manual SDK repro confirmed `PromptTemplate.format()` raises when `chat_template_kwargs` contains an unresolved literal `{{...}}`.
- After fixes, `pytest -q sdk/oss/tests/pytest/unit/test_prompt_template_extensions.py`: passed, 9 tests.
- After fixes, `poetry run python run-tests.py oss/tests/pytest/unit/evaluators/test_catalog_types.py` from `api`: passed, 1 test.
- After fixes, `pnpm --filter @agenta/entity-ui build` from `web`: passed.

## Notes

- No whitespace errors were found by `git diff --check HEAD~2..HEAD`.
- User decision: `chat_template_kwargs` is a strict 1:1 provider pass-through field.
- User decision: prompt fallback fields are normal `data.parameters` fields and must be editable in the web registry or playground like other parameter fields.
- User decision: web tests are out of scope for this work.

## Open Questions

No open questions.

## Open Findings

### [OPEN] FPT-004: Runtime coverage is still narrower than the implementation risk

- ID: `FPT-004`
- Origin: `scan`
- Lens: `verification`
- Severity: `P2`
- Confidence: `medium`
- Status: `open`
- Category: `Testing`
- Summary: The tests now cover SDK data-model defaults, basic fallback movement, catalog shape, and `chat_template_kwargs` 1:1 formatting behavior, but do not yet cover the full runtime fallback matrix: retry ordering, policy categories, no fallback on local errors, exhaustion behavior, and service/API smoke.
- Evidence: `sdk/oss/tests/pytest/unit/test_prompt_template_extensions.py` covers default/null behavior, `chat_template_kwargs` in `to_openai_kwargs()`, fallback model validation, 404 policy classification, one 503 fallback success, and unchanged `chat_template_kwargs` through `PromptTemplate.format()`. The plan still lists additional tests for retry-before-fallback, 5xx/timeout/429/401/403/400/404/422 categories, local prompt errors, final exhaustion, service completion/chat, and API catalog endpoint exposure. The user explicitly excluded web tests from this work.
- Files:
  - `sdk/oss/tests/pytest/unit/test_prompt_template_extensions.py`
  - `api/oss/tests/pytest/unit/evaluators/test_catalog_types.py`
  - `docs/designs/extend-prompt-templates/plan.md`
- Cause: The first implementation added narrow unit coverage but did not follow the full validation matrix for prompt fallback execution.
- Explanation: The feature changes provider-call control flow. Without targeted tests around failure classification, retry boundaries, and final exhaustion, regressions can look like provider flakiness.
- Suggested Fix: Add focused SDK tests for retry/exhaustion/local-error behavior and optional service/API smoke tests. Do not add web tests in this work.
- Alternatives: Accept the remaining runtime matrix as follow-up coverage if this PR only needs the currently added unit guards.
- Sources: `docs/designs/extend-prompt-templates/plan.md`, test scan, user decision.

## Closed Findings

### [CLOSED] FPT-001: API catalog verification needs the local SDK setup

- ID: `FPT-001`
- Origin: `scan`
- Lens: `verification`
- Severity: `P3`
- Confidence: `high`
- Status: `fixed`
- Category: `Testing`
- Summary: API catalog verification depended on running with the branch SDK on the import path. Without that setup, `run-tests.py` could import `api/.venv`'s installed SDK and report stale catalog contents.
- Evidence: The user's full `poetry run python run-tests.py` failed with `KeyError: 'fallback_llm_configs'`. A direct import check showed `agenta.sdk.utils.types` resolving to `api/.venv/lib/python3.11/site-packages/agenta/sdk/utils/types.py`. After updating `api/run-tests.py` to prepend the monorepo `sdk` directory to `PYTHONPATH` for pytest subprocesses, `poetry run python run-tests.py oss/tests/pytest/unit/evaluators/test_catalog_types.py` passed.
- Files:
  - `api/run-tests.py`
  - `api/oss/tests/pytest/unit/evaluators/test_catalog_types.py`
- Resolution: Fixed by making the API test runner prefer the local monorepo SDK when invoking pytest.
- Sources: User run output, focused verification run.

### [CLOSED] FPT-002: `chat_template_kwargs` is not passed through unchanged during prompt formatting

- ID: `FPT-002`
- Origin: `scan`
- Lens: `verification`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: `PromptTemplate.format()` recursively substituted variables inside `llm_config.chat_template_kwargs`, violating the confirmed 1:1 provider pass-through contract.
- Evidence: The implementation called `_substitute_variables()` on `new_llm_config.chat_template_kwargs`, and a manual repro with `chat_template_kwargs={"literal": "{{provider_flag}}"}` raised `TemplateFormatError`.
- Files:
  - `sdk/agenta/sdk/utils/types.py`
  - `sdk/oss/tests/pytest/unit/test_prompt_template_extensions.py`
- Resolution: Fixed by excluding `chat_template_kwargs` from prompt substitution and adding a regression test that verifies primary and fallback `chat_template_kwargs` survive `PromptTemplate.format()` unchanged.
- Sources: `pytest -q sdk/oss/tests/pytest/unit/test_prompt_template_extensions.py`.

### [CLOSED] FPT-003: Fallback root fields are preserved but not editable in the prompt UI

- ID: `FPT-003`
- Origin: `scan`
- Lens: `verification`
- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Category: `Completeness`
- Summary: The prompt editor preserved fallback root fields but did not expose `fallback_llm_configs`, `fallback_policy`, or `retry_policy` for editing.
- Evidence: The user confirmed these fields must be editable in the web registry or playground like any other `data.parameters` field. `PromptSchemaControl` previously returned only messages, tools, response format, and template format controls.
- Files:
  - `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/PromptSchemaControl.tsx`
- Resolution: Fixed by rendering prompt-root controls in `PromptSchemaControl` action-bar popovers. `Retry policy` appears to the right of `Prompt Syntax` and edits `max_retries` plus `delay_ms`; `Fallback policy` opens a popover with the fallback policy select and a list of fallback model dropdowns.
- Sources: `pnpm --filter @agenta/entity-ui build`.

## Triage Plan

Recommended next step: decide whether to backfill the remaining non-web runtime test matrix.

1. If coverage is expanded in this PR, add SDK tests for retry ordering, local-error no-fallback, policy-category coverage, and exhaustion behavior.
2. If coverage is not expanded in this PR, keep `FPT-004` as a follow-up testing item.
3. Do not add web tests in this work.
