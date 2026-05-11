# Extend Prompt Templates Findings

Scan scope: PR `#4171` on `feat/extend-prompt-templates` through local head `84a45784d`

Active path: `docs/designs/extend-prompt-templates`

Sources reviewed:

- GitHub PR `#4171` metadata, reviews, comments, and unresolved review threads through 2026-04-27.
- `docs/designs/extend-prompt-templates/{gap,initial.specs,plan,proposal,research}.md`
- `docs/docs/reference/sdk/01-configuration-management.mdx`
- `docs/docs/reference/sdk/03-custom-workflow.mdx`
- `docs/docs/prompt-engineering/integrating-prompts/07-fallback-models-and-retry.mdx`
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
- Sync on 2026-04-28 found five new Devin doc comments about stale `fallback_llm_configs` and object-shaped `retry_policy` docs; the affected docs were updated locally to `fallback_configs`, `retry_config`, and enum `retry_policy`.

## Notes

- PR `#4171` is open with requested changes from frontend and product review.
- No whitespace errors were found by `git diff --check HEAD~2..HEAD`.
- User decision: `chat_template_kwargs` is a strict 1:1 provider pass-through field.
- User decision: `fallback_llm_configs` was renamed to `fallback_configs` before release; no backward compatibility alias is needed.
- User decision: retry controls are split into `retry_config` for max attempts/delay and `retry_policy` for retryable error categories. Retry defaults to off unless explicitly enabled.
- User decision: prompt fallback fields are normal `data.parameters` fields and must be editable in the web registry or playground like other parameter fields.
- User decision: web tests are out of scope for this work.
- GitHub sync on 2026-04-28 shows the two Devin retry comments, the context fallback comment, the extra kwargs-helper comment, and the `_apply_responses_bridge_if_needed()` comment resolved in GitHub.
- GitHub sync on 2026-04-28 still shows unresolved threads for frontend stable keys/memoization, two `_normalize_*` naming comments, one broad heuristic classification comment, and five docs comments that are fixed locally but not yet resolved in GitHub.
- 2026-04-28: `_normalize_retry_config`, `_normalize_retry_policy`, `_normalize_fallback_policy` renamed to `_coerce_*` — resolves the two naming-comment threads.
- 2026-04-28: `_classify_prompt_retry_error` and `_classify_prompt_fallback_error` renamed to `_classify_retry_error` and `_classify_fallback_error` — removes redundant `_prompt_` infix.
- 2026-04-28: broad text heuristics removed from both classifiers (FPT-010 fixed); four regression tests added.

## Open Questions

No open questions.

## Open Findings

### [CLOSED] FPT-004: Runtime coverage is still narrower than the implementation risk

- ID: `FPT-004`
- Origin: `scan`
- Lens: `verification`
- Severity: `P2`
- Confidence: `medium`
- Status: `fixed`
- Category: `Testing`
- Summary: Runtime fallback matrix was not fully covered by tests.
- Evidence: Previous coverage: default/null behavior, `chat_template_kwargs`, catalog shape, 404/503 classification, one 503 fallback success. Missing: full status-code matrix per policy, retry-before-fallback ordering, local error non-fallback, exhaustion re-raise, retry attempt count.
- Files:
  - `sdk/oss/tests/pytest/unit/test_prompt_template_extensions.py`
- Resolution: Added parametrized matrix tests for all fallback policy × status code combinations (503/500/429/401/403/400/404/422) and all retry policy × status code combinations. Added `test_retry_before_fallback_same_model_retried_first`, `test_fallback_not_triggered_on_local_error`, `test_fallback_exhaustion_raises_last_error`, and `test_retry_exhaustion_raises_after_max_attempts`. 60 tests pass. Web/service/API smoke tests remain out of scope per user decision.
- Sources: `docs/designs/extend-prompt-templates/plan.md`, test scan, user decision.

### [CLOSED] FPT-006: Backward compatibility needs explicit storage and UI no-op verification

- ID: `FPT-006`
- Origin: `PR #4171 review`
- Lens: `migration`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Compatibility`
- Summary: Review requested proof that new prompt fields do not leak into stored config JSON for old apps that never use fallback, retry, or `chat_template_kwargs`.
- Files:
  - `sdk/agenta/sdk/utils/types.py`
  - `sdk/oss/tests/pytest/unit/test_prompt_template_extensions.py`
- Resolution: Added three SDK-level tests: `test_old_prompt_round_trip_omits_new_fields` (builds a `PromptTemplate` from a literal old-style config dict and asserts no new key appears in `model_dump(exclude_none=True)`), `test_default_prompt_serialization_omits_new_fields` (same check for a freshly constructed default template), and `test_retry_config_default_not_serialized` (asserts `retry_config` is `None` on a default prompt and absent from the serialized payload). UI/service no-op verification remains out of scope per user decision; manual steps are accepted as the alternative.
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

### [CLOSED] FPT-010: Error classification still uses broad string heuristics

- ID: `FPT-010`
- Origin: `PR #4171 review`
- Lens: `correctness`
- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: Retry/fallback error classification still contained broad substring heuristics for words such as timeout, network, rate limit, overload, auth, and validation.
- Evidence: GitHub thread `PRRT_kwDOJbjazM5973Ez` on `sdk/agenta/sdk/engines/running/handlers.py`. In `_classify_prompt_fallback_error` and `_classify_prompt_retry_error`, after typed-exception and HTTP status-code checks failed to match, the code fell through to plain text scanning. A local `ValueError("connection string is missing")` would be classified as `"availability"` and trigger a retry or fallback.
- Files:
  - `sdk/agenta/sdk/engines/running/handlers.py`
  - `sdk/oss/tests/pytest/unit/test_prompt_template_extensions.py`
- Resolution: Deleted the entire text-heuristic fall-through block from both classifiers. Classification is now driven solely by typed exceptions (`TimeoutError`, `httpx.TimeoutException`, `httpx.RequestError`, `InvalidSecretsV0Error`) and HTTP status codes. `_is_context_window_error()` is kept only inside the `status_code in (400, 422)` branch where it was already correctly scoped. Unknown exceptions with no status code return `None` (not classified, not retried, not falling back). Four regression tests added to assert that plain `ValueError`s with incidentally matching text are not classified as retryable or fallback-eligible.
- Sources: PR `#4171` review by `mmabrouk` on 2026-04-27 and current local code scan.

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
- Summary: The prompt editor preserved fallback root fields but did not expose `fallback_configs`, `retry_config`, `retry_policy`, or `fallback_policy` for editing.
- Evidence: The user confirmed these fields must be editable in the web registry or playground like any other `data.parameters` field. `PromptSchemaControl` previously returned only messages, tools, response format, and template format controls.
- Files:
  - `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/PromptSchemaControl.tsx`
- Resolution: Fixed by rendering prompt-root controls in `PromptSchemaControl` action-bar popovers. `Retry policy` appears to the right of `Prompt Syntax` and edits `retry_config.max_retries`, `retry_config.delay_ms`, and `retry_policy`; `Fallback policy` opens a popover with the fallback policy select and a list of fallback model dropdowns.
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

### [CLOSED] FPT-008: `chat_template_kwargs` needs clearer product justification and UI treatment

- ID: `FPT-008`
- Origin: `PR #4171 review`
- Lens: `product`
- Severity: `P2`
- Confidence: `medium`
- Status: `fixed`
- Category: `Completeness`
- Summary: Review questioned whether `chat_template_kwargs` is backed by a real customer request and noted that a raw text field labeled `Chat Template Kwargs` is not useful in the playground.
- Evidence: The PR body links the field to issue `#3996`, design notes treat it as a strict provider pass-through field, and the GitHub thread was resolved after the issue was linked and the design was updated.
- Files:
  - `sdk/agenta/sdk/utils/types.py`
  - `web/packages/agenta-entity-ui/src/DrillInView/components/PlaygroundConfigSection.tsx`
  - `docs/designs/extend-prompt-templates/proposal.md`
- Resolution: Fixed by tying the field to issue `#3996` and keeping it as an advanced model parameter concern. Remaining UI placement work is tracked under `FPT-007`.
- Sources: PR `#4171` review by `mmabrouk` on 2026-04-27, PR body reference to issue `#3996`, and resolved GitHub thread `PRRT_kwDOJbjazM597fx3`.

### [CLOSED] FPT-011: Public docs use stale fallback and retry field names

- ID: `FPT-011`
- Origin: `PR #4171 review`
- Lens: `documentation`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Documentation`
- Summary: Devin review found public docs and examples still used `fallback_llm_configs`, a non-existent `FallbackModelConfig`, and object-shaped `retry_policy` after the SDK moved to `fallback_configs`, `ModelConfig`, `retry_config`, and enum `retry_policy`.
- Evidence: Open GitHub threads `PRRT_kwDOJbjazM5-F_z1`, `PRRT_kwDOJbjazM5-F_2P`, `PRRT_kwDOJbjazM5-F_4M`, `PRRT_kwDOJbjazM5-F_52`, and `PRRT_kwDOJbjazM5-F_7n` all point to stale docs examples and schema tables.
- Files:
  - `docs/docs/reference/sdk/01-configuration-management.mdx`
  - `docs/docs/reference/sdk/03-custom-workflow.mdx`
  - `docs/docs/prompt-engineering/integrating-prompts/07-fallback-models-and-retry.mdx`
  - `docs/designs/extend-prompt-templates/proposal.md`
  - `docs/designs/extend-prompt-templates/initial.specs.md`
  - `docs/designs/extend-prompt-templates/plan.md`
  - `docs/designs/extend-prompt-templates/gap.md`
  - `docs/designs/extend-prompt-templates/research.md`
- Resolution: Fixed locally by replacing stale field names with `fallback_configs`, documenting `retry_config` separately from enum `retry_policy`, replacing `FallbackModelConfig` with `ModelConfig`, and updating design docs to the current SDK contract.
- Verification: Local docs sync and `rg` check no longer find stale public-doc references to `fallback_llm_configs`, `FallbackModelConfig`, or `RetryPolicy(max_retries=...)`; GitHub threads remain unresolved until the branch is pushed and threads are closed.
- Sources: Devin review on PR `#4171` from 2026-04-28 and local docs scan.

## Triage Plan

Recommended next step: address the requested changes in dependency order.

1. Lock compatibility first: verify old prompt configs do not serialize new keys and set retry defaults so old apps keep one-attempt behavior unless configured otherwise.
2. Tighten runtime behavior: classify retryable errors before retrying, add coverage for deterministic/local errors, exhaustion, and context-window provider errors.
3. Rework frontend placement: move fallback/retry/kwargs controls under model settings, keep row keys stable, and avoid writing defaults on no-op edits.
4. Document the feature: include the real `chat_template_kwargs` use case, fallback policy categories, context-window behavior, and backward-compatibility guarantees.
