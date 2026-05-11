# PR 4022 Review

> PR: `Agenta-AI/agenta#4022` (`[feat] Clean up workflows`)
> Branch reviewed locally: `feat/extend-runnables`
> Base compared: `origin/main`
> Review date: 2026-03-25

## Scope

- Reviewed the local branch against `origin/main`.
- Reviewed all currently open GitHub review threads on PR 4022.
- Current GitHub thread state at review time: `81` unresolved threads total, `70` active and `11` outdated (initial review 2026-03-25); 45 additional Copilot threads reviewed 2026-03-26 (IDs `2966112048`–`2991025310`).
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

Update: resolved on branch.
- Per-route `openapi.json` helper was removed from the SDK runtime.
- The canonical runtime discovery surface is `POST {path}/inspect`.

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
| `api/oss/src/core/annotations/service.py` | `2949000424`, `2960191040`, `2962294526`, `2982653419`, `2982653442`, `2982653455` | `fixed`, `open` | The `annotation`-before-assignment issue is fixed. New: edit path ignores references/links — response diverges from persistence (F9). |
| `api/entrypoints/routers.py` | `2954804958`, `2954805038`, `2956986020`, `2956986030`, `2960191383`, `2962186091`, `2964630612`, `2964630626`, `2965828569` | `open`, `process` | The route-removal comments identify a real plan/migration mismatch. The required fix is migration-plan coverage, not a blanket requirement to restore compatibility wrappers; see F1. Title/scope comments remain process-only. |
| `.pre-commit-config.yaml` | `2956985994`, `2960191136`, `2962186131`, `2964630598` | `open-low` | Reproducibility improved, but hooks still depend on local toolchains and whole-workspace execution. Non-blocking. |
| `api/oss/src/core/workflows/service.py` | `2960191195`, `2960191223`, `2962186197` | `open-low` | Boundary blur and N+1 concerns are still real, but secondary to the functional issues above. |
| `api/oss/src/core/tracing/utils/trees.py` | `2960191266`, `2960191298`, `2960191323`, `2960191348`, `2964691012`, `2969327992`, `2969327996`, `2969328001`, `2982653209`, `2982653258` | `open`, `wontfix` | Missing targeted tests still valid (F7). Ordering-change concern has concrete suggestions. Inference-from-links concern is by-design — links are definitionally what makes a trace an annotation (F18). |
| `api/oss/src/core/applications/dtos.py` | `2962186164`, `2962294547`, `2964690962`, `2964690972` | `open` | Confirmed in F4. |
| `api/oss/src/apis/fastapi/tracing/router.py` | `2962186232`, `2964999355`, `2982653342` | `open`, `stale` | The `202` semantics comment is still valid; the spans-router-removal comment is stale. New: edit endpoint uses `delta=1` quota check — should use `delta=0` (F12). |
| `api/oss/src/core/environments/service.py` | `2964690992`, `2965903693`, `2966112048`, `2971482852`, `2982653472`, `2982653494`, `2982653521` | `fixed`, `open-low` | Fixed in F2. New: excessive `log.info` in high-traffic retrieval path — should be `log.debug` (F13 equivalent, low priority). |
| `api/oss/src/apis/fastapi/environments/router.py` | `2966111988` | `fixed` | Fixed in F2 by switching commit validation from truthiness to explicit presence checks. |
| `api/oss/src/services/llm_apps_service.py` | `2965828525`, `2965903647`, `2971482827`, `2971507347`, `2980800330`, `2982653400`, `2984134903`, `2984135015` | `open` | Helper contract mismatch is confirmed across multiple thread iterations. New (HIGH): `2984134903` — logs curl command including `Authorization` header, leaking credentials (F8). |
| `api/oss/src/core/evaluators/service.py` | `2965828550`, `2971482846` | `open` | Confirmed in F3. Additional thread reiterates the deep-merge concern. |
| `api/oss/src/resources/workflows/catalog.py` | `2962294573`, `2964690925`, `2964690953`, `2969327983`, `2969327989`, `2983188509`, `2984134965`, `2991025226` | `open` | Confirmed in F5. Additional threads provide concrete suggestions for both the `or`-semantics fix and the O(n²) metadata-map recomputation. Also new: catalog built at import time makes it static for process lifetime; lazy init suggested. |
| `docs/designs/runnables/plan.md` | `2962186277` | `open` | Confirmed in F1/F7. |
| `docs/designs/runnables/plan.G13.md` | `2962294682` | `open` | Parent-plan anchor and OpenAPI framing still need cleanup. |
| `docs/designs/runnables/runnables-subsystem-layer.md` | `2962294716`, `2964630579` | `open` | Still conflicts with the parent plan's stated discovery contract. |
| `docs/designs/runnables/design-review.md` | `2964630533`, `2964630562` | `open` | Absolute local paths remain in the document. |
| `api/oss/src/apis/fastapi/workflows/router.py` | `2954804899`, `2956986007` | `fixed`, `open-low` | Missing-environment 404 path is fixed. Duplication comment is valid but non-blocking. |
| `api/oss/src/apis/fastapi/applications/router.py` | `2954804934`, `2983188596`, `2991025251` | `fixed`, `open` | Missing-environment 404 path is fixed. New: duplicate `@intercept_exceptions()` on `list_application_catalog_types` (F13). |
| `api/oss/src/core/tracing/service.py` | `2982653283`, `2982653312`, `2982653363`, `2983188576` | `open` | Edit path silently drops references/links (F10). Brittle `conditions[0]` index (F11). |
| `api/oss/src/resources/evaluators/evaluators.py` | `2983188635`, `2984134999` | `open` | Removal of `ground_truth_key` and rename of `advanced` → `x-ag-ui-advanced` may break frontend consumers (F14). |
| `api/oss/src/dbs/postgres/git/dao.py` | `2983188658`, `2984134983`, `2991025273` | `open` | `application_refs` filtering in Python after full DB fetch defeats pagination; missing type guard on `app_ref` (F15). |
| `api/oss/src/utils/helpers.py` | `2984134945` | `open-low` | `urlparse` fails on scheme-less inputs like `localhost:8000` (F16). |
| `api/oss/src/core/evaluations/runtime/locks.py` | `2991025290` | `open-low` | Uses private `caching._pack` helper (F17). |
| `api/oss/databases/postgres/migrations/core/data_migrations/projects.py` | `2966112073`, `2991025310` | `open-low` | Duplicated JSON load logic after removal of `json_importer_helper.py`; use `json.load(f)` with explicit encoding. |
| `api/oss/src/services/legacy_adapter.py` | `2952354675`, `2962186180` | `stale` | The referenced implementation path no longer exists in the current branch shape. |
| `docs/design/legacy-adapter-migration/route-gap-analysis.md` | `2960191060`, `2960191090`, `2960191112` | `fixed` | Repo-relative link fix is already in branch. |

### F8. Credential leak in `llm_apps_service` logs

- Severity: `High`
- Category: `Security`
- Evidence:
  - `api/oss/src/services/llm_apps_service.py` — thread `2984134903`
- Description:
  - The service logs a full curl command that includes `Authorization: Secret <token>` in the header dict.
  - Any log aggregation system or audit trail will capture the token in plaintext.
- Impact:
  - Secrets exposed in logs are a real credential leak surface.
- Suggestion:
  - Redact or drop sensitive headers (at minimum `Authorization`, cookies) before logging.
  - Log only non-sensitive metadata (URL, scenario_id, request size).
- Status: `open`

### F9. `annotations/service.py` edit path — references/links response diverges from persistence

- Severity: `Medium`
- Category: `Correctness`
- Evidence:
  - `api/oss/src/core/annotations/service.py` — threads `2982653419`, `2982653442`, `2982653455`
- Description:
  - `edit()` forwards `annotation_edit.references` and `annotation_edit.links` into `_edit_annotation()`, but the returned `updated_annotation` always reuses `annotation.references` / `annotation.links` from the pre-edit fetch.
  - The API response can therefore diverge from what was actually persisted.
- Impact:
  - Callers cannot trust the response to reflect the post-edit state.
- Suggestion:
  - Either (a) keep references/links immutable and remove them from `AnnotationEdit`, or (b) reflect the edited values in the returned object.
- Status: `open`

### F10. `tracing/service.py` edit path silently drops references/links

- Severity: `Medium`
- Category: `Correctness`
- Evidence:
  - `api/oss/src/core/tracing/service.py` — threads `2982653283`, `2982653312`, `2983188576`
- Description:
  - `SimpleTraceEdit` can carry `references` and `links`, but `SimpleTracesService.edit()` always reuses `existing.references` / `existing.links` and ignores the incoming values.
  - The contract implies mutability that is not implemented.
- Impact:
  - Silent data loss for any caller sending updated references/links.
- Suggestion:
  - Either implement the update (with merge semantics) or remove `references`/`links` from `SimpleTraceEdit`.
- Status: `open`

### F11. `tracing/service.py` — `conditions[0]` brittle index assumption

- Severity: `Medium`
- Category: `Correctness`, `Robustness`
- Evidence:
  - `api/oss/src/core/tracing/service.py` — thread `2982653363`
- Description:
  - Code replaces `conditions[0]` assuming `build_simple_trace_query()` always returns a non-empty list with the type condition at index 0.
  - This can become an `IndexError` or an incorrect filter if the internal ordering of `build_simple_trace_query()` changes.
- Impact:
  - Silent wrong filtering or a runtime crash on a code-path change.
- Suggestion:
  - Extend `build_simple_trace_query()` to accept a `trace_types` parameter, or locate the condition by a stable field key rather than a positional index.
- Status: `open`

### F12. `tracing/router.py` — edit endpoint wrongly consumes trace quota

- Severity: `Medium`
- Category: `Correctness`, `API semantics`
- Evidence:
  - `api/oss/src/apis/fastapi/tracing/router.py` — thread `2982653342`
- Description:
  - The entitlement check for `edit_trace` uses `delta=1` (same as create).
  - Editing an existing trace should not consume quota; the quota ceiling can be hit even when no new data is being produced.
- Suggestion:
  - Use `delta=0` (or skip the quota check) for edit operations.
- Status: `open`

### F13. `applications/router.py` — duplicate `@intercept_exceptions()` decorator

- Severity: `Low`
- Category: `Correctness`, `Maintainability`
- Evidence:
  - `api/oss/src/apis/fastapi/applications/router.py` — threads `2983188596`, `2991025251`
- Description:
  - `list_application_catalog_types` is decorated with `@intercept_exceptions()` twice.
  - Double-wrapping can cause duplicated logging and unpredictable exception interception order.
- Suggestion:
  - Remove the duplicate decorator.
- Status: `open`

### F14. `evaluators/evaluators.py` — `ground_truth_key` removal and key rename are potentially breaking

- Severity: `Medium`
- Category: `Compatibility`
- Evidence:
  - `api/oss/src/resources/evaluators/evaluators.py` — threads `2983188635`, `2984134999`
- Description:
  - `ground_truth_key` was removed from the evaluator schema payload.
  - `advanced` was renamed to `x-ag-ui-advanced`.
  - Frontend code actively used `ground_truth_key` for ground-truth column selection.
- Impact:
  - Any frontend/consumer still reading these keys will silently regress (no ground-truth highlighting, broken UI flag).
- Suggestion:
  - Emit both old and new keys during a transition window, or confirm all consumers were updated in this same PR.
- Status: `open`

### F15. `git/dao.py` — in-Python post-fetch filtering defeats DB pagination

- Severity: `Medium`
- Category: `Performance`, `Correctness`
- Evidence:
  - `api/oss/src/dbs/postgres/git/dao.py` — threads `2983188658`, `2984134983`, `2991025273`
- Description:
  - `application_refs` filtering is applied in Python after fetching the full revision set from the DB.
  - This (a) materializes all revisions in memory and (b) breaks windowing/pagination semantics because the DB-level window is applied before the Python-level filter.
  - Additionally, `app_ref.get(...)` is called without an `isinstance(app_ref, dict)` guard, so non-dict stored values will raise at runtime.
- Suggestion:
  - Push the filter into SQL/JSONB queries, or apply windowing/limits before in-memory filtering.
  - Add type guards before calling `.get()` on JSON-derived objects.
- Status: `open`

### F16. `utils/helpers.py` — `urlparse` fails on scheme-less inputs

- Severity: `Low`
- Category: `Correctness`, `Robustness`
- Evidence:
  - `api/oss/src/utils/helpers.py` — thread `2984134945`
- Description:
  - `urlparse('localhost:8000')` parses `scheme='localhost'` and `hostname=None`, silently skipping the localhost-rewriting path.
  - This changes behavior from the prior substring check.
- Suggestion:
  - Prepend a default scheme when missing (e.g. `http://`) before parsing, or add a fallback extraction when `parsed.hostname is None`.
- Status: `open`

### F17. `evaluations/runtime/locks.py` — uses private `caching._pack`

- Severity: `Low`
- Category: `Maintainability`
- Evidence:
  - `api/oss/src/core/evaluations/runtime/locks.py` — thread `2991025290`
- Description:
  - Lock key generation uses `caching._pack`, a private (underscore-prefixed) helper.
  - Internal implementation changes to `caching` can silently break lock key generation.
- Suggestion:
  - Expose a public `caching.pack(...)` helper, or move the key-packing logic into the locks module.
- Status: `open`

### F18. ~~Trace type inference from links is too broad~~ — by-design

- Severity: `N/A`
- Category: `N/A`
- Evidence:
  - `api/oss/src/core/tracing/utils/trees.py` — threads `2982653209`, `2982653258`
- Description:
  - Link presence is the definitional property that makes a trace an annotation.
  - Inferring annotation type from link presence is therefore correct by design, not a misclassification risk.
- Status: `wontfix`

## Bottom Line

The branch contains substantial forward progress, but it is not review-clean.

The highest-risk remaining issues are:

1. The branch is already doing mixed migration, but the plans still describe checkpoint 1 as expand-only and do not frame intentional breaks as schema/migration work. (F1)
2. Evaluator schema normalization can still drop hydrated `schemas.outputs` when sparse stored `schemas` are merged back in. (F3)
3. **NEW (High):** `llm_apps_service` logs a curl command including the full `Authorization` header — active credential leak. (F8)
4. **NEW (Medium):** `annotations/service.py` and `tracing/service.py` edit paths both silently drop references/links — response diverges from what is persisted. (F9, F10)
5. ~~**NEW (Medium):** Trace type inference relies solely on link presence.~~ — by-design; links define annotations (F18 closed)
6. **NEW (Medium):** `ground_truth_key` removal and key rename in evaluators may break frontend consumers if clients were not updated in this PR. (F14)

F2 is fixed in-branch and covered by targeted unit tests. I would not treat this PR as ready until the remaining open findings are resolved or explicitly dispositioned.
