# Extend Prompt Templates Findings

Scan scope: `973e80146..9420b8779` on `feat/extend-prompt-templates`

Active path: `docs/designs/extend-prompt-templates`

Sources reviewed:

- GitHub PR `#4171` metadata, reviews, comments, and unresolved review threads through 2026-04-27.
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

- PR `#4171` is open with requested changes from frontend and product review.
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

### [OPEN] FPT-006: Backward compatibility needs explicit storage and UI no-op verification

- ID: `FPT-006`
- Origin: `PR #4171 review`
- Lens: `migration`
- Severity: `P1`
- Confidence: `high`
- Status: `open`
- Category: `Compatibility`
- Summary: Review requested proof that new prompt fields do not leak into stored config JSON for old apps that never use fallback, retry, or `chat_template_kwargs`.
- Evidence: The requested cases are no-op commit on an old app, opening Retry/Fallback UI without changing anything, adding then removing a fallback model or resetting defaults, and SDK round-trip compatibility with `PromptTemplate(**old_config).model_dump(exclude_none=True)`.
- Files:
  - `sdk/agenta/sdk/utils/types.py`
  - `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/PromptSchemaControl.tsx`
  - `web/packages/agenta-entities/src/shared/execution/requestBodyBuilder.ts`
- Cause: Adding nullable fields to the schema is not enough if UI default materialization or commit serialization writes empty/default keys back to persisted prompt config.
- Explanation: Old apps should not gain `fallback_llm_configs`, `retry_policy`, `fallback_policy`, or `chat_template_kwargs` just because the branch code parsed or rendered them.
- Suggested Fix: Add an SDK round-trip test for old prompt JSON and a targeted UI/service smoke check that no-op edits and reset-to-default flows omit these keys from committed JSON.
- Alternatives: If full UI automation remains out of scope, document manual verification steps and add lower-level serialization tests for the commit payload builder.
- Sources: PR `#4171` review by `mmabrouk` on 2026-04-22.

### [OPEN] FPT-007: Frontend fallback controls should move under model settings

- ID: `FPT-007`
- Origin: `PR #4171 review`
- Lens: `product`
- Severity: `P2`
- Confidence: `high`
- Status: `open`
- Category: `UX`
- Summary: Product review rejected top-level fallback/retry controls in the prompt action bar and asked to hide this complexity under the model sidebar for power users.
- Evidence: Review stated that the playground is already complex and fallback options should live under the model sidebar, with frontend ownership handed to `ashrafchowdury`. Frontend review also requested stable keys for fallback rows and memoization around new playground config logic.
- Files:
  - `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/PromptSchemaControl.tsx`
  - `web/packages/agenta-entity-ui/src/DrillInView/components/PlaygroundConfigSection.tsx`
- Cause: The first UI implementation made fallback/retry fields discoverable as prompt-root controls, but the product direction is to keep primary prompt editing uncluttered.
- Explanation: Fallback models, retry policy, and provider-specific kwargs are advanced model execution settings. Putting them next to prompt syntax makes the main prompt editor harder to scan and does not match the requested design direction.
- Suggested Fix: Move fallback/retry editing into the model sidebar or an advanced section nested under model settings, using stable item keys and memoized derived values where requested.
- Alternatives: Keep top-level controls only if design accepts them, but that would leave the current requested-changes review unresolved.
- Sources: PR `#4171` reviews by `mmabrouk` and `ardaerzin` on 2026-04-22 and 2026-04-27.

### [OPEN] FPT-008: `chat_template_kwargs` needs clearer product justification and UI treatment

- ID: `FPT-008`
- Origin: `PR #4171 review`
- Lens: `product`
- Severity: `P2`
- Confidence: `medium`
- Status: `open`
- Category: `Completeness`
- Summary: Review questioned whether `chat_template_kwargs` is backed by a real customer request and noted that a raw text field labeled `Chat Template Kwargs` is not useful in the playground.
- Evidence: The PR body links the field to issue `#3996`, and earlier design notes treat it as a strict provider pass-through field. The latest review still asks for the reasoning/customer pull and UI clarity.
- Files:
  - `sdk/agenta/sdk/utils/types.py`
  - `web/packages/agenta-entity-ui/src/DrillInView/components/PlaygroundConfigSection.tsx`
- Cause: The API contract is defined as a provider pass-through, but the user-facing control does not explain or constrain the supported provider-specific parameters.
- Explanation: A generic kwargs field can be technically correct but still unusable for playground users unless it is surfaced as advanced JSON/config with validation, examples, or provider-specific affordances.
- Suggested Fix: Link the PR and docs to issue `#3996`, document concrete Granite/Qwen-style use cases, and move the UI into advanced model settings with a clearer label/help pattern.
- Alternatives: Defer the UI control while keeping SDK/API pass-through if product only needs programmatic support for now.
- Sources: PR `#4171` review by `mmabrouk` on 2026-04-27 and PR body reference to issue `#3996`.

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

### [CLOSED] FPT-005: Retry behavior may change existing prompt-template execution

- ID: `FPT-005`
- Origin: `PR #4171 review`
- Lens: `compatibility`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: Reviewers flagged two retry bugs: `max_retries=1` changed old prompt behavior from one provider attempt to two attempts, and the retry loop retried broad exceptions before classifying retry eligibility.
- Evidence: Devin review noted that `RetryPolicy.max_retries=1` changed old `completion_v0` and `chat_v0` behavior, while the design docs specified `max_retries: int = 0`. A later review also noted `_run_prompt_llm_config_with_retry` caught all `Exception` subclasses and could retry deterministic errors such as missing secrets before propagating.
- Files:
  - `sdk/agenta/sdk/utils/types.py`
  - `sdk/agenta/sdk/engines/running/handlers.py`
  - `sdk/oss/tests/pytest/unit/test_prompt_template_extensions.py`
- Resolution: Fixed by splitting retry controls into `retry_config` (`max_retries`, `delay_ms`) and `retry_policy` (`off`, `availability`, `capacity`, `transient`, `any`), defaulting `max_retries` to `0`, defaulting retry policy to `off`, and classifying retry eligibility inside `_run_prompt_llm_config_with_retry()` before another same-model attempt.
- Verification: `pytest -q sdk/oss/tests/pytest/unit/test_prompt_template_extensions.py` passed, including tests that explicit availability retry retries provider 503s and explicit `any` does not retry deterministic `InvalidSecretsV0Error`.
- Sources: PR `#4171` review comments by `devin-ai-integration[bot]` and `mmabrouk` on 2026-04-22 and 2026-04-27.

### [CLOSED] FPT-009: Fallback policy taxonomy is accepted, but context-window fallback needs coverage

- ID: `FPT-009`
- Origin: `PR #4171 review`
- Lens: `requirements`
- Severity: `P2`
- Confidence: `medium`
- Status: `fixed`
- Category: `Completeness`
- Summary: Product review accepted keeping the current fallback policy shape, but specifically called out context-window-exceeded fallback to a larger model as an important scenario.
- Evidence: Review stated the policy can stay as-is, but also said the most useful fallback may be a context-window exceeded `400` path that falls back to a larger-context model.
- Files:
  - `sdk/agenta/sdk/utils/types.py`
  - `sdk/agenta/sdk/engines/running/handlers.py`
  - `sdk/oss/tests/pytest/unit/test_prompt_template_extensions.py`
- Resolution: Fixed by adding `FallbackPolicy.CONTEXT`, classifying context-window/token-limit provider errors as `context`, and including `context` in the fallback hierarchy before `any`.
- Verification: `pytest -q sdk/oss/tests/pytest/unit/test_prompt_template_extensions.py` passed, including `test_fallback_policy_context_handles_context_window_errors`.
- Sources: PR `#4171` review by `mmabrouk` on 2026-04-27.

## Triage Plan

Recommended next step: address the requested changes in dependency order.

1. Lock compatibility first: verify old prompt configs do not serialize new keys and set retry defaults so old apps keep one-attempt behavior unless configured otherwise.
2. Tighten runtime behavior: classify retryable errors before retrying, add coverage for deterministic/local errors, exhaustion, and context-window provider errors.
3. Rework frontend placement: move fallback/retry/kwargs controls under model settings, keep row keys stable, and avoid writing defaults on no-op edits.
4. Document the feature: include the real `chat_template_kwargs` use case, fallback policy categories, context-window behavior, and backward-compatibility guarantees.
