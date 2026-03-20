# PR 4022 Comment Review

> Source: open review threads on PR `Agenta-AI/agenta#4022`
> Date: 2026-03-20
> Scope: one finding entry per currently open review comment

## Status Legend

- `open`: still relevant and should be addressed in code/docs
- `partially-addressed`: concern is still directionally valid, but the branch already improved it
- `deferred-to-migration`: valid, but intentionally postponed to the later migration step
- `fixed-in-branch`: current branch already addresses the issue; thread is stale
- `superseded`: comment targets behavior/design that has since been intentionally dropped or replaced
- `process-only`: PR-title / rollout-scope feedback, not a code defect
- `won't-fix`: low-value optimization or tradeoff intentionally not taken in this PR

## Findings

### sdk/agenta/sdk/decorators/running.py

- `2948797791` | Severity: Medium | Status: `superseded` | The path-normalization bug is real on the current `get_openapi()` helper, but the helper itself targets per-route `openapi.json`, which [plan.G3](./plan.G3.md) explicitly drops. Suggestion: replace/remove the helper in favor of `/inspect`; if kept temporarily, normalize `path` and add timeout/auth.
- `2948797838` | Severity: Medium | Status: `deferred-to-migration` | The `script: dict -> str` signature change is a real backward-compatibility risk for legacy callers that still pass `{content, runtime}`. Suggestion: accept both shapes during the migration window, then contract later.
- `2949000437` | Severity: Medium | Status: `superseded` | Timeout/SSRF concerns are directionally valid, but they apply to a helper that now appears conceptually stale after G3. Suggestion: remove or replace the helper; if retained, set explicit timeouts and constrain call sites.
- `2952354703` | Severity: Medium | Status: `deferred-to-migration` | Same compatibility concern as `2948797838`. Suggestion: keep this open only if the migration window needs dual-shape support.
- `2952354726` | Severity: Medium | Status: `superseded` | Timeout/auth extensibility is valid if `get_openapi()` survives, but the larger issue is that the helper is targeting the wrong discovery surface. Suggestion: replace with an inspect-based helper and design auth around that API instead.
- `2954804833` | Severity: Medium | Status: `superseded` | Duplicate of `2948797791`. Same path-normalization issue on a helper that should likely be retired rather than hardened.
- `2954804871` | Severity: Medium | Status: `superseded` | Duplicate of `2949000437` / `2952354726`. Same timeout/auth concern on a stale helper.
- `2956985931` | Severity: Medium | Status: `superseded` | Duplicate of `2948797791`. Same path-normalization issue.

### sdk/agenta/sdk/__init__.py

- `2948797856` | Severity: Medium | Status: `deferred-to-migration` | The public meaning of `agenta.sdk.types` has changed from backend-generated types to `sdk.utils.types`. Common symbols still resolve, but module identity and backend-only expectations can still break consumers. Suggestion: decide the compatibility story explicitly during migration.
- `2948797879` | Severity: Medium | Status: `deferred-to-migration` | Duplicate of `2948797856`. Same `agenta.sdk.types` compatibility risk.
- `2949000358` | Severity: Low | Status: `process-only` | The PR title is narrower than the diff. Suggestion: update title/description if you want the review/rollout record to match scope; otherwise treat as non-blocking.
- `2952354799` | Severity: Low | Status: `process-only` | Duplicate of `2949000358`. Same PR-scope/title concern.
- `2956985956` | Severity: Medium | Status: `deferred-to-migration` | Same `agenta.sdk.types` compatibility issue, plus `config` removal from `__all__`. Suggestion: record the migration contract explicitly and either keep a transitional alias or document the break.
- `2956985961` | Severity: Medium | Status: `deferred-to-migration` | Duplicate of `2956985956`.

### api/oss/src/core/evaluators/utils.py

- `2948797935` | Severity: Low | Status: `won't-fix` | `_get_settings_template()` is still O(n) over the evaluator registry. This is real but low-value unless profiling shows it is hot. Suggestion: ignore for now or cache later.
- `2949000451` | Severity: Low | Status: `won't-fix` | Duplicate of `2948797935`.
- `2952354750` | Severity: Low | Status: `won't-fix` | Duplicate of `2948797935`.
- `2954805014` | Severity: Low | Status: `won't-fix` | Duplicate of `2948797935`.
- `2956985981` | Severity: Low | Status: `won't-fix` | Duplicate of `2948797935`.
- `2960191164` | Severity: Low | Status: `won't-fix` | Duplicate of `2948797935`.
- `2962186250` | Severity: Low | Status: `won't-fix` | Duplicate of `2948797935`.
- `2962294599` | Severity: Low | Status: `fixed-in-branch` | The `version` concern is stale. `SimpleEvaluatorData` inherits `WorkflowRevisionData`, which does not require a `version` field, and the SDK-side evaluator models already default versioning where needed. Suggestion: close this thread.
- `2964999366` | Severity: Low | Status: `won't-fix` | Duplicate of `2948797935`.

### api/oss/src/core/invocations/service.py

- `2949000394` | Severity: High | Status: `fixed-in-branch` | The `NameError` concern is stale. `edit()` currently fetches `invocation` before constructing `updated_invocation`. Suggestion: close the thread.
- `2960190986` | Severity: High | Status: `fixed-in-branch` | Duplicate of `2949000394`.
- `2962186211` | Severity: Medium | Status: `open` | `create()` now returns a locally assembled DTO rather than re-fetching persisted state, so server-populated fields can diverge from stored truth. Suggestion: either re-fetch after create or explicitly document that create returns a lightweight synthesized view.
- `2962294499` | Severity: High | Status: `fixed-in-branch` | Duplicate of `2949000394`.
- `2965208073` | Severity: High | Status: `fixed-in-branch` | Duplicate of `2949000394`.

### api/oss/src/core/annotations/service.py

- `2949000424` | Severity: High | Status: `fixed-in-branch` | The `annotation`-before-assignment concern is stale. `edit()` currently uses an already-fetched `annotation`. Suggestion: close the thread.
- `2960191040` | Severity: High | Status: `fixed-in-branch` | Duplicate of `2949000424`.
- `2962294526` | Severity: High | Status: `fixed-in-branch` | Duplicate of `2949000424`.

### api/oss/src/services/legacy_adapter.py

- `2952354675` | Severity: Low | Status: `superseded` | The commented file path is no longer present in the current branch shape, so this specific thread is stale. The underlying concern about nullable commit messages is still worth checking in surviving migration code. Suggestion: close this thread and, if needed, audit the replacement path instead.
- `2962186180` | Severity: Low | Status: `superseded` | Same as `2952354675`. The specific review target is stale in the current branch.

### api/oss/src/apis/fastapi/workflows/router.py

- `2954804899` | Severity: Medium | Status: `fixed-in-branch` | Current code already raises `404 "Environment revision not found."` before dereferencing references. Suggestion: close the thread.
- `2956986007` | Severity: Low | Status: `open` | The deploy flow duplication between workflows/applications is real but not a correctness bug. Suggestion: extract a shared deploy helper if this code starts diverging further.

### api/oss/src/apis/fastapi/applications/router.py

- `2954804934` | Severity: Medium | Status: `fixed-in-branch` | Current code already raises `404 "Environment revision not found."` before dereferencing references. Suggestion: close the thread.

### api/entrypoints/routers.py

- `2954804958` | Severity: Medium | Status: `open` | The removal of legacy `/invocations*` and `/annotations*` route families is an externally visible compatibility break. Suggestion: either add thin wrappers or explicitly document this as planned migration breakage.
- `2954805038` | Severity: Low | Status: `process-only` | PR-title/scope feedback only.
- `2956986020` | Severity: Low | Status: `process-only` | Duplicate PR-title/scope feedback.
- `2956986030` | Severity: Low | Status: `process-only` | Duplicate PR-title/scope feedback.
- `2960191383` | Severity: Low | Status: `process-only` | Duplicate PR-title/scope feedback.
- `2962186091` | Severity: Low | Status: `process-only` | Duplicate PR-title/scope feedback.
- `2964630612` | Severity: Low | Status: `process-only` | Duplicate PR-title/scope feedback.
- `2964630626` | Severity: Low | Status: `process-only` | Duplicate PR-title/scope feedback.
- `2965828569` | Severity: Low | Status: `process-only` | Duplicate PR-title/scope feedback.

### .pre-commit-config.yaml

- `2956985994` | Severity: Low | Status: `open` | The performance concern is still valid: both web hooks still ignore filename passing and run against the whole workspace. Suggestion: decide whether whole-workspace consistency is worth slower commits; if not, switch to filename-driven invocation.
- `2960191136` | Severity: Medium | Status: `partially-addressed` | Reproducibility improved (`python3 -m ruff`, `pnpm exec`, pinned bootstrap installs), but the hooks are still `language: system` and still rely on local toolchains. Suggestion: move to managed hooks only if hermeticity matters more than local simplicity.
- `2962186131` | Severity: Medium | Status: `partially-addressed` | Duplicate of `2960191136`.
- `2964630598` | Severity: Medium | Status: `partially-addressed` | Duplicate of `2960191136`.

### docs/design/legacy-adapter-migration/route-gap-analysis.md

- `2960191060` | Severity: Low | Status: `fixed-in-branch` | The absolute-path issue is already fixed by converting the links to repo-relative paths. Suggestion: close the thread.
- `2960191090` | Severity: Low | Status: `fixed-in-branch` | Duplicate of `2960191060`.
- `2960191112` | Severity: Low | Status: `fixed-in-branch` | Duplicate of `2960191060`.

### api/oss/src/core/workflows/service.py

- `2960191195` | Severity: Medium | Status: `open` | The service imports SDK-internal helpers (`agenta.sdk.engines.running.utils`) directly, which does blur boundaries between API core and SDK internals. Suggestion: move the inference helpers into a shared/core module or a dedicated adapter layer.
- `2960191223` | Severity: Medium | Status: `open` | Duplicate of `2960191195`.
- `2962186197` | Severity: Medium | Status: `open` | `SimpleWorkflowsService.query()` still does an N+1 pattern by calling `fetch()` per row. Suggestion: add a bulk path or limit the hydrated fetch shape when querying lists.

### api/oss/src/core/tracing/utils/trees.py

- `2960191266` | Severity: Medium | Status: `open` | `infer_and_propagate_trace_type_by_trace()` groups spans by trace and rebuilds the output list, which can change input ordering. Suggestion: preserve original order or document that reordering is intentional.
- `2960191298` | Severity: Medium | Status: `open` | Duplicate of `2960191266`.
- `2960191323` | Severity: Medium | Status: `open` | Duplicate of `2960191266`.
- `2960191348` | Severity: Medium | Status: `open` | Duplicate of `2960191266`.
- `2964691012` | Severity: Medium | Status: `open` | The new annotation-vs-invocation classification logic still lacks direct unit coverage. Suggestion: add tests for no-links, has-links, and malformed `ag.type` coercion cases.

### api/oss/src/core/applications/dtos.py

- `2962186164` | Severity: Medium | Status: `open` | `ApplicationFlags` / `ApplicationQueryFlags` claim `is_evaluator=False` in docstrings but no longer enforce it. Suggestion: explicitly force `is_evaluator=False` in constructors.
- `2962294547` | Severity: Medium | Status: `open` | Duplicate of `2962186164`.
- `2964690962` | Severity: Medium | Status: `open` | Duplicate of `2962186164`.
- `2964690972` | Severity: Medium | Status: `open` | Duplicate of `2962186164`.

### api/oss/src/apis/fastapi/tracing/router.py

- `2962186232` | Severity: Medium | Status: `open` | Changing `POST /traces` from `201` to `202` and adding `PUT /traces/{trace_id}` is a visible contract change. Suggestion: document migration impact and confirm clients do not assume synchronous creation semantics.
- `2964999355` | Severity: Medium | Status: `fixed-in-branch` | The current branch still mounts `SpansRouter` and exposes spans endpoints, so this comment is stale. Suggestion: close the thread.

### docs/designs/runnables/plan.md

- `2962186277` | Severity: Medium | Status: `open` | The doc still says checkpoint 1 is expand-only, but the PR already includes contract removals/renames and compatibility changes. Suggestion: either narrow the claim or split explicit contract work into a later checkpoint section.

### api/oss/src/resources/workflows/catalog.py

- `2962294573` | Severity: Low | Status: `open` | `_evaluator_metadata_by_key()` is recomputed once per catalog entry during module initialization. Suggestion: compute it once before the list comprehension and reuse it.
- `2964690925` | Severity: Medium | Status: `open` | Using `or` for `archived` / `recommended` prevents explicit `False` metadata from overriding truthy existing values. Suggestion: use `is not None` semantics instead.
- `2964690953` | Severity: Medium | Status: `open` | Indexing `inherited_flags[...]` directly can raise `KeyError` on sparse data. Suggestion: use `.get(..., False)` when normalizing inherited flags.

### docs/designs/runnables/plan.G13.md

- `2962294682` | Severity: Low | Status: `open` | The anchor in the parent-plan link still looks stale relative to the current heading in `plan.md`. Suggestion: update the anchor to the actual generated heading ID or drop the fragile anchor.

### docs/designs/runnables/runnables-subsystem-layer.md

- `2962294716` | Severity: Low | Status: `open` | The doc still advertises `WorkflowRequestFlags` with `stream` even though `plan.md` says stream/batch command flags should leave the primary contract. Suggestion: mark `stream` as temporary or remove it from the target-state description.
- `2964630579` | Severity: Medium | Status: `open` | The doc still presents `{path}/openapi.json` as a target boundary even though G3 drops per-route OpenAPI. Suggestion: rewrite this section so `/inspect` is primary and any OpenAPI mention is explicitly legacy/optional.

### docs/designs/runnables/design-review.md

- `2964630533` | Severity: Low | Status: `open` | The doc still contains absolute `/Users/...` links and a broken `runnables-system-layer.md` reference. Suggestion: convert to repo-relative links and rename the reference to `runnables-subsystem-layer.md`.
- `2964630562` | Severity: Low | Status: `open` | Duplicate of `2964630533`.

### api/oss/src/core/environments/service.py

- `2964690992` | Severity: Medium | Status: `open` | Requiring `slug` in the service via `ValueError` is brittle because callers and request models can still treat it as optional. Suggestion: validate at the API boundary or generate a server-side slug.
- `2965903693` | Severity: Medium | Status: `open` | Same underlying issue as `2964690992`, plus the service-layer `ValueError` can surface as a 500 if unmapped. Suggestion: replace with request validation or a typed domain exception.

### api/oss/src/services/llm_apps_service.py

- `2965828525` | Severity: High | Status: `open` | `find_key_occurrences()` is contractually wrong: it extends `value` directly, loses the `path`, and double-counts recursive results. Suggestion: return structured `{path, value}` matches and remove `results.extend(value)`.
- `2965903647` | Severity: High | Status: `open` | Duplicate of `2965828525`.

### api/oss/src/core/evaluators/service.py

- `2965828550` | Severity: Medium | Status: `open` | The hydration merge order is still wrong: existing sparse `schemas` can overwrite hydrated `schemas.outputs`. Suggestion: merge existing first, then overlay hydrated fields, or deep-merge `schemas`.
