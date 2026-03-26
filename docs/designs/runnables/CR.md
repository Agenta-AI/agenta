# PR 4022 Review

> PR: `Agenta-AI/agenta#4022` (`[feat] Clean up workflows`)
> Branch reviewed locally: `feat/extend-runnables`
> Base compared: `origin/main`
> Review date: 2026-03-25

## Scope

- Reviewed the local branch against `origin/main`.
- Reviewed all currently open GitHub review threads on PR 4022.
- Current GitHub thread state at review time: `81` unresolved threads total, `70` active and `11` outdated.
- Because the PR touches `1222` files, this review focused on the highest-risk surfaces: public API compatibility, service correctness, SDK/API contract drift, tracing/simple-trace behavior, and runnable design-doc consistency.

## Verification Performed

- `pytest -q oss/tests/pytest/unit/test_llm_apps_service.py` -> `3 passed`
- `pytest -q oss/tests/pytest/unit/tracing/utils/test_simple_traces.py` -> `7 passed`
- `pytest -q oss/tests/pytest/unit/evaluators/test_evaluator_utils.py` -> `19 passed`
- `pytest -q oss/tests/pytest/unit/environments/test_commit_validation.py` -> `4 passed`

### Environment re-check

After reinstalling the SDK from this worktree, the API test environment resolves:

- `agenta.sdk.models.workflows.WorkflowRevisionData` from [sdk/agenta/sdk/models/workflows.py](/Users/junaway/Agenta/github/vibes.worktrees/feat-extend-runnables/sdk/agenta/sdk/models/workflows.py#L121)
- `script` annotation as `Optional[str]`

That means the earlier evaluator test failure was caused by an environment mismatch, not by the branch code itself under the intended co-versioned setup.

## Confirmed Findings

### F1. The plans still describe checkpoint 1 as expand-only, but the branch is already doing mixed migration without the required schema/migration framing

- Severity: `High`
- Category: `Correctness`, `Completeness`, `Migration safety`
- Evidence:
  - `docs/designs/runnables/plan.md:7-18`
  - `docs/designs/runnables/gap.GMigrations.md:1-36`
  - `api/entrypoints/routers.py:523-848`
  - `api/oss/src/apis/fastapi/invocations/router.py:34-132`
  - `api/oss/src/apis/fastapi/annotations/router.py`
- Description:
  - The plan explicitly said checkpoint 1 is "expand-only" and "Nothing breaks", but the branch already removes or contracts several legacy public surfaces at the codebase level.
  - At minimum, `/invocations`, `/annotations`, `/apps`, `/variants`, `/containers`, `/configs`, and the non-preview `/environments` surface are no longer mounted from the main API entrypoint.
  - The missing artifact is not mandatory wrapper code for those legacy surfaces. The missing artifact is an explicit migration/schema plan that says how intentional backward-incompatible changes are handled.
- Impact:
  - The implementation no longer matches the documented rollout strategy.
  - Reviewers can incorrectly treat missing compatibility wrappers as the defect, when the real defect is missing migration coverage.
  - Backward-compatibility obligations can fall between code removals and data/schema migration work.
- Suggestion:
  - Update the plans to state that checkpoint 1 is mixed expand/contract.
  - Track intentional backward-incompatible changes through migration/schema work, not through a blanket requirement to preserve legacy code paths.
  - Add or reference the required migration backlog entries for each intentional break.
- Status: `open`

### F2. Environment revision commit validation was fixed in-branch

- Severity: `Medium`
- Category: `Correctness`, `API semantics`
- Evidence:
  - `api/oss/src/apis/fastapi/environments/router.py:1075-1088`
  - `api/oss/src/core/environments/dtos.py:209-220`
  - `api/oss/src/core/environments/service.py:826-842`
  - `api/oss/src/core/environments/service.py:951-971`
  - `api/oss/tests/pytest/unit/environments/test_commit_validation.py:29-135`
- Description:
  - The router now validates `data` and `delta` with explicit `is not None` checks, so empty payload objects are no longer misclassified.
  - `EnvironmentRevisionCommit.slug` is now required with `min_length=1` at the DTO boundary.
  - The service now routes delta commits with explicit presence checks and no longer raises a generic `ValueError` for missing `slug`.
- Impact:
  - Requests with `data={}` or `delta={}` now follow the intended validation path.
  - Missing or empty `slug` now fails as request-model validation instead of surfacing later as a generic service exception.
  - The reviewed GitHub threads on this issue can be closed.
- Suggestion:
  - Close the related review threads and keep the new unit coverage in place.
- Status: `fixed`

### F3. Evaluator schema hydration merge order allows sparse stored schemas to erase hydrated outputs

- Severity: `Medium`
- Category: `Correctness`
- Evidence:
  - `api/oss/src/core/evaluators/service.py:957-987`
- Description:
  - `_normalize_evaluator_data()` hydrates builtin evaluator schemas into `normalized_data_dict`, then overlays `existing_data_dict` on top of it.
  - If stored data contains a partial `schemas` object such as `{}` or `{parameters: ...}`, the later merge overwrites the hydrated `schemas.outputs`.
- Impact:
  - Builtin evaluators can remain or become schema-incomplete even after the normalization path runs.
  - Any downstream code that relies on `schemas.outputs` can see inconsistent behavior.
- Suggestion:
  - Merge existing data first, then overlay the hydrated fields that are being repaired, or deep-merge `schemas` so existing `parameters` survive while `outputs` is guaranteed.
- Status: `open`

### F4. `ApplicationFlags` and `ApplicationQueryFlags` no longer enforce the application's own invariant

- Severity: `Medium`
- Category: `Consistency`, `Correctness`
- Evidence:
  - `api/oss/src/core/applications/dtos.py:84-99`
- Description:
  - The class docstrings still claim `is_application=True, is_evaluator=False`, but the constructors now only force `is_application=True`.
  - Callers can construct application DTOs with `is_evaluator=True`.
- Impact:
  - Application-scoped queries and flags can become contradictory and ambiguous.
  - This weakens the application's filtered-workflow contract and makes downstream filtering harder to reason about.
- Suggestion:
  - Force `is_evaluator=False` in both constructors, not just `is_application=True`.
- Status: `open`

### F5. Workflow catalog enrichment mishandles explicit `False` metadata overrides and sparse inherited flags

- Severity: `Medium`
- Category: `Correctness`, `Robustness`
- Evidence:
  - `api/oss/src/resources/workflows/catalog.py:34-40`
  - `api/oss/src/resources/workflows/catalog.py:58-61`
- Description:
  - `_normalize_preset()` indexes `inherited_flags[...]` directly, which is brittle for partial data.
  - `_enrich_entry()` uses `or` to combine metadata booleans, so an explicit metadata override of `False` cannot override a truthy base flag.
- Impact:
  - Catalog rows can report the wrong archival/recommended state.
  - Sparse registry data can fail harder than necessary.
- Suggestion:
  - Use `.get(..., False)` for inherited flags.
  - Apply `is not None` semantics for metadata boolean overrides.
- Status: `open`

### F6. `InvocationsService.query()` filters invocation traces as if they were evaluators

- Severity: `Medium`
- Category: `Correctness`
- Evidence:
  - `api/oss/src/core/invocations/service.py:435`
  - `api/oss/src/core/invocations/service.py:706-715`
- Description:
  - `query()` seeds `InvocationFlags(is_evaluator=True)`, and those flags are converted directly into `ag.flags.*` filtering for `trace_kind="invocation"`.
  - Invocation traces created by `_create_invocation()` do not set `is_evaluator=True`.
- Impact:
  - If the compatibility invocation router is remounted, its query path will filter out the very invocation traces it is supposed to return.
  - The code is currently latent because `/invocations` is no longer mounted, but it becomes a real bug as soon as compatibility routing is restored.
- Suggestion:
  - Remove the forced evaluator flag from invocation queries.
  - Add direct unit coverage for invocation query filtering before re-exposing the route family.
- Status: `open`

### F7. Runnable docs and helper code still disagree on whether per-route OpenAPI exists

- Severity: `Medium`
- Category: `Consistency`, `Maintainability`
- Evidence:
  - `docs/designs/runnables/plan.md:86-95`
  - `docs/designs/runnables/runnables-subsystem-layer.md:108-118`
  - `docs/designs/runnables/plan.G13.md:42-49`
  - `sdk/agenta/sdk/decorators/running.py:817-829`
  - `docs/designs/runnables/design-review.md:54-56`
- Description:
  - The parent plan says per-route `openapi.json` is dropped and `/inspect` is the sole discovery surface.
  - The subsystem doc and G13 child plan still describe per-route OpenAPI as part of the target model.
  - The SDK still ships a `get_openapi()` helper that builds `{path}/openapi.json`, without path normalization or an explicit timeout.
  - `design-review.md` still contains an absolute local filesystem link.
- Impact:
  - Reviewers and implementers cannot rely on the runnable docs as a single source of truth.
  - The SDK helper preserves an interface the docs say should not be primary.
- Suggestion:
  - Decide one discovery contract and update all runnable docs to match it.
  - If per-route OpenAPI is truly out of scope, remove or deprecate the helper instead of leaving a partially broken API in place.
  - Replace local absolute links with repo-relative links.
- Status: `open`

## Compatibility Note

### C1. `script` shape migration is intentional and out of scope for compatibility

- Severity: `Medium`
- Category: `Compatibility`
- Evidence:
  - [sdk/agenta/sdk/decorators/running.py#L127](/Users/junaway/Agenta/github/vibes.worktrees/feat-extend-runnables/sdk/agenta/sdk/decorators/running.py#L127)
  - [sdk/agenta/sdk/models/workflows.py#L127](/Users/junaway/Agenta/github/vibes.worktrees/feat-extend-runnables/sdk/agenta/sdk/models/workflows.py#L127)
- Description:
  - Under the co-versioned setup, the branch is internally consistent and tests pass.
  - Older clients or stored payloads that still assume the old structured `script` shape are intentionally not being preserved.
- Impact:
  - This is not a current branch breakage in the validated environment.
  - Upgrades from older clients/payloads may break if they still send the legacy shape.
- Suggestion:
  - Keep the new `script: str` contract and document the break explicitly if release notes need to mention it.
- Status: `wontfix`

## Coverage Gaps

- There is no direct unit coverage for the evaluator schema-hydration merge-order problem.
- There is no invocation query coverage even though the query path currently seeds an incorrect filter.
- The tracing-type propagation change now has some surrounding unit coverage, but not the exact no-links / has-links / malformed-attribute cases requested in review.

## Open Review Thread Disposition

Legend:

- `open`: confirmed and still worth addressing in this branch
- `open-low`: valid but low priority / non-blocking
- `fixed`: current branch already addresses it
- `stale`: thread no longer matches current code
- `process`: review-scoping / PR-framing feedback, not a code defect
- `migration`: real compatibility gap, but tied to the larger rollout plan

| Area | Open thread IDs | Disposition | Notes |
| --- | --- | --- | --- |
| `sdk/agenta/sdk/decorators/running.py` | `2948797791`, `2948797838`, `2949000437`, `2952354703`, `2952354726`, `2954804833`, `2954804871`, `2956985931` | `open`, `wontfix` | Helper still has path/timeout issues. The `script` compatibility thread is intentionally out of scope rather than a currently reproducible branch defect. |
| `sdk/agenta/sdk/__init__.py` | `2948797856`, `2948797879`, `2949000358`, `2952354799`, `2956985956`, `2956985961` | `open`, `process` | `agenta.sdk.types` changed meaning and `config` dropped from `__all__`; still a compatibility risk. Title/scope threads remain process feedback only. |
| `api/oss/src/core/evaluators/utils.py` | `2948797935`, `2949000451`, `2952354750`, `2954805014`, `2956985981`, `2960191164`, `2962186250`, `2962294599`, `2964999366` | `open-low`, `stale` | The O(n) registry scan is real but low-value. The earlier local failure here no longer reproduces once the co-versioned SDK is installed. |
| `api/oss/src/core/invocations/service.py` | `2949000394`, `2960190986`, `2962186211`, `2962294499`, `2965208073` | `fixed`, `open-low` | The `NameError` threads are stale; `edit()` fetches the invocation again. The create-return-shape concern is still directionally valid but lower priority than F7. |
| `api/oss/src/core/annotations/service.py` | `2949000424`, `2960191040`, `2962294526` | `fixed` | The `annotation`-before-assignment issue is fixed in current code. |
| `api/entrypoints/routers.py` | `2954804958`, `2954805038`, `2956986020`, `2956986030`, `2960191383`, `2962186091`, `2964630612`, `2964630626`, `2965828569` | `open`, `process` | The route-removal comments identify a real plan/migration mismatch. The required fix is migration-plan coverage, not a blanket requirement to restore compatibility wrappers; see F1. Title/scope comments remain process-only. |
| `.pre-commit-config.yaml` | `2956985994`, `2960191136`, `2962186131`, `2964630598` | `open-low` | Reproducibility improved, but hooks still depend on local toolchains and whole-workspace execution. Non-blocking. |
| `api/oss/src/core/workflows/service.py` | `2960191195`, `2960191223`, `2962186197` | `open-low` | Boundary blur and N+1 concerns are still real, but secondary to the functional issues above. |
| `api/oss/src/core/tracing/utils/trees.py` | `2960191266`, `2960191298`, `2960191323`, `2960191348`, `2964691012` | `open` | Missing targeted tests are still a valid concern; ordering concern is lower confidence but still plausible. |
| `api/oss/src/core/applications/dtos.py` | `2962186164`, `2962294547`, `2964690962`, `2964690972` | `open` | Confirmed in F4. |
| `api/oss/src/apis/fastapi/tracing/router.py` | `2962186232`, `2964999355` | `open`, `stale` | The `202` semantics comment is still valid; the spans-router-removal comment is stale because `SpansRouter` is still mounted. |
| `api/oss/src/core/environments/service.py` | `2964690992`, `2965903693` | `fixed` | Fixed in F2 by moving `slug` enforcement to the DTO boundary and removing the generic service `ValueError`. |
| `api/oss/src/apis/fastapi/environments/router.py` | `2966111988` | `fixed` | Fixed in F2 by switching commit validation from truthiness to explicit presence checks. |
| `api/oss/src/services/llm_apps_service.py` | `2965828525`, `2965903647` | `open-low` | The helper's declared contract is wrong, but the current caller only needs a flat list of input-key names. Worth cleaning up, but not currently a blocker. |
| `api/oss/src/core/evaluators/service.py` | `2965828550` | `open` | Confirmed in F3. |
| `api/oss/src/resources/workflows/catalog.py` | `2962294573`, `2964690925`, `2964690953` | `open` | Confirmed in F5, with the metadata-map recomputation remaining low priority. |
| `docs/designs/runnables/plan.md` | `2962186277` | `open` | Confirmed in F1/F7. |
| `docs/designs/runnables/plan.G13.md` | `2962294682` | `open` | Parent-plan anchor and OpenAPI framing still need cleanup. |
| `docs/designs/runnables/runnables-subsystem-layer.md` | `2962294716`, `2964630579` | `open` | Still conflicts with the parent plan's stated discovery contract. |
| `docs/designs/runnables/design-review.md` | `2964630533`, `2964630562` | `open` | Absolute local paths remain in the document. |
| `api/oss/src/apis/fastapi/workflows/router.py` | `2954804899`, `2956986007` | `fixed`, `open-low` | Missing-environment 404 path is fixed. Duplication comment is valid but non-blocking. |
| `api/oss/src/apis/fastapi/applications/router.py` | `2954804934` | `fixed` | Missing-environment 404 path is fixed. |
| `api/oss/src/services/legacy_adapter.py` | `2952354675`, `2962186180` | `stale` | The referenced implementation path no longer exists in the current branch shape. |
| `docs/design/legacy-adapter-migration/route-gap-analysis.md` | `2960191060`, `2960191090`, `2960191112` | `fixed` | Repo-relative link fix is already in branch. |

## Bottom Line

The branch contains substantial forward progress, but it is not review-clean.

The highest-risk remaining issues are:

1. The branch is already doing mixed migration, but the plans still describe checkpoint 1 as expand-only and do not frame intentional breaks as schema/migration work.
2. Evaluator schema normalization in F3 can still drop hydrated `schemas.outputs` when sparse stored `schemas` are merged back in.

F2 is fixed in-branch and covered by targeted unit tests. I would not treat this PR as ready until the remaining open findings are resolved or explicitly dispositioned.
