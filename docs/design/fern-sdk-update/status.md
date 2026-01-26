# Status

**Last Updated**: 2026-01-26

## Completed

- [x] PR #3441: API fixes for OpenAPI generation (MERGED to main)
- [x] PR #3442: SDK local tracing types (MERGED to release/v0.78.1, re-applied in PR #3561)
- [x] Created branch `feat/update-fern-sdk-generation`
- [x] Updated `sdk/scripts/setup_fern.sh` (fully automated, includes ruff format)
- [x] Regenerated SDK from https://cloud.agenta.ai/api/openapi.json
- [x] Applied recursive type fixes automatically
- [x] Updated `sdk/agenta/client/__init__.py` (simplified re-export)
- [x] Updated `sdk/agenta/client/Readme.md` (new documentation)
- [x] Removed old `sdk/agenta/client/client.py` wrapper
- [x] Fixed import in `sdk/agenta/sdk/agenta_init.py`
- [x] Applied local types fix to `sdk/agenta/sdk/types.py`
- [x] Created PR #3561
- [x] Fixed ruff formatting (474 files)
- [x] All CI checks passing
- [x] Created structure test suite (66 tests)
- [x] Created integration test suite (46 tests)

## Ready for Review

PR #3561: https://github.com/Agenta-AI/agenta/pull/3561


## Test Results

### Structure Tests (66 tests)

These tests verify imports and client structure without making API calls.

```bash
cd sdk && poetry run pytest tests/test_fern_client.py -v
```

| Category | Tests | Status |
|----------|-------|--------|
| Core client imports | 4 | PASS |
| Types for vault.py | 4 | PASS |
| Types for shared.py | 3 | PASS |
| SDK local types | 4 | PASS |
| Client instantiation | 5 | PASS |
| Apps API methods | 6 | PASS |
| Variants API methods | 14 | PASS |
| Async client sub-modules | 5 | PASS |
| SDK manager imports | 11 | PASS |
| Additional sub-modules | 5 | PASS |
| Type structure | 6 | PASS |

### Integration Tests (54 tests)

These tests make real API calls to `cloud.agenta.ai`. They require `AGENTA_API_KEY` set in the environment. Without it, they skip cleanly.

```bash
AGENTA_API_KEY="your-key" poetry run pytest tests/integration/ -v -m integration
```

| Category | File | Tests | Status |
|----------|------|-------|--------|
| AppManager (sync) | `applications/test_apps_shared_manager.py` | 7 | PASS |
| AppManager (async) | `applications/test_apps_shared_manager.py` | 5 | PASS |
| SharedManager (sync) | `applications/test_apps_shared_manager.py` | 11 | PASS |
| SharedManager (async) | `applications/test_apps_shared_manager.py` | 9 | PASS |
| Response serialization | `applications/test_apps_shared_manager.py` | 4 | PASS |
| Error handling | `applications/test_apps_shared_manager.py` | 2 | PASS |
| Concurrent operations | `applications/test_apps_shared_manager.py` | 2 | PASS |
| Legacy applications | `applications/test_legacy_applications_manager.py` | 1 | PASS |
| Evaluations flow | `evaluations/test_evaluations_flow.py` | 1 | PASS |
| Evaluators | `evaluators/test_evaluators_manager.py` | 1 | PASS |
| Prompts config | `prompts/test_prompt_template_storage.py` | 1 | PASS |
| Testsets | `testsets/test_testsets_manager.py` | 1 | PASS |
| Observability tracing | `tracing/test_observability_traces.py` | 1 | PASS |
| Vault permissions | `vault/test_vault_secrets.py` | 2 | PASS |
| Vault secrets list/read | `vault/test_vault_secrets.py` | 2 | PASS |
| Vault secrets lifecycle | `vault/test_vault_secrets.py` | 2 | PASS |
| Vault serialization | `vault/test_vault_secrets.py` | 2 | PASS |


## Findings and Suggestions

During integration testing, we encountered behaviors that required test adjustments. None of these indicate SDK bugs; they reflect server-side normalization and response shape variations.

### 1. Observability trace response uses tree structure

**Finding:** `fetch_trace(trace_id)` returns `spans=None` even when `count >= 1`. The span data lives under `traces[trace_id].spans[span_name]` instead.

**Impact:** Code that expects a flat `spans` list will fail silently.

**Suggestion:** Document this response shape in the SDK. Consider adding a helper method that extracts spans from either location.

### 2. Span IDs may be normalized by the server

**Finding:** The server sometimes returns `span_id` with UUID-style dashes or different lengths than the client sent.

**Impact:** Exact string matching on span IDs can fail.

**Suggestion:** When comparing span IDs, normalize both sides (strip dashes, truncate to 16 chars). Document this behavior.

### 3. Dotted attribute keys become nested objects

**Finding:** Attributes like `{"sdk.it.phase": "create"}` get transformed into `{"sdk": {"it": {"phase": "create"}}}` on the server.

**Impact:** Direct key lookup fails; callers must traverse nested dicts.

**Suggestion:** Use underscore keys (`sdk_it_phase`) or document the nesting behavior. Consider a utility to flatten/unflatten attribute dicts.

### 4. Testset revision retrieval is inconsistent

**Finding:** `aretrieve(testset_revision_id=rev.id)` returns `None` on some deployments, even when `aretrieve(testset_id=...)` works.

**Impact:** Code relying on revision-based retrieval may break.

**Suggestion:** Prefer testset_id for retrieval. If revision retrieval is needed, use the revision ID returned by a prior `aretrieve(testset_id=...)` call.


## Not Yet Tested

The following SDK features were identified as relying on the Fern client but are not covered by integration tests.

| Feature | Reason | Risk |
|---------|--------|------|
| Workflow invocation with LLM calls | Requires provider API keys and a deployed workflow | Medium |
| Fern `client.evaluations` submodule | SDK evaluations layer uses `authed_api` directly, not Fern | Low |
| Fern `client.testsets` submodule | SDK testsets layer uses `authed_api` directly, not Fern | Low |

To fully test workflow invocation with LLM calls, you would need:

1. A provider API key (OpenAI, Anthropic, etc.) configured in the vault
2. A deployed application with a prompt template
3. An invocation test that calls the workflow and verifies the response

This is out of scope for Fern client validation but would be valuable for end-to-end SDK testing.


## Next Steps

1. Get PR #3561 reviewed and merged
2. Consider adding SDK helpers for the observability quirks (see Findings above)
3. Rotate the API key that was previously committed in test fixtures
