# PR 4022 Synced Findings

> PR: `Agenta-AI/agenta#4022` (`[feat] Clean up workflows`)
> Branch reviewed locally: `feat/extend-runnables`
> Base compared: `origin/main`
> Head synced: `a1659e782`
> Synced on: `2026-03-31`

## Sources

- Local review: `docs/designs/runnables/CR.md`
- Remote PR: `https://github.com/Agenta-AI/agenta/pull/4022`
- Remote review comments and thread state through `2026-03-31`

## Sync Summary

- This file is the canonical synced findings record for PR 4022.
- The local review in `CR.md` already captured nearly all substantive PR feedback through thread IDs `2991025310`.
- The Mar 31, 2026 PR delta did not introduce a new top-level defect beyond the already-confirmed workflow-catalog boolean-override issue.
- Remote thread `3016391904` is a duplicate/source refresh for `F5`.
- Remote thread `3016391939` reiterates the existing low-priority `.pre-commit-config.yaml` reproducibility concern and was not promoted to a new top-level finding.
- Remote thread `3016391966` is process-only scope/title feedback and was not promoted to a code finding.

## Findings

### [CLOSED] F1. Migration framing no longer matches the branch's actual mixed expand/contract behavior

- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`, `Completeness`, `Migration`
- Summary: The runnable plans still present checkpoint 1 as expand-only, while the branch already removes or contracts multiple legacy public surfaces.
- Evidence:
  - `docs/designs/runnables/plan.md:7-18`
  - `docs/designs/runnables/gap.GMigrations.md:1-36`
  - `api/entrypoints/routers.py:523-848`
- Files:
  - `docs/designs/runnables/plan.md`
  - `docs/designs/runnables/gap.GMigrations.md`
  - `api/entrypoints/routers.py`
- Cause: The code rollout and the documented rollout strategy diverged.
- Explanation: Legacy route families are already gone or contracted, and the primary plan and migration backlog now describe checkpoint 1 as mixed expand/contract with explicit migration obligations.
- Impact: Review, migration, and compatibility work can be mis-scoped or missed entirely.
- Suggested Fix: Reframe checkpoint 1 as mixed expand/contract and explicitly track intentional breaks as migration work.
- Alternatives: Restore legacy compatibility shims temporarily, but only if that matches the actual rollout plan.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2954804958`, `2954805038`, `2956986020`, `2956986030`, `2960191383`, `2962186091`, `2964630612`, `2964630626`, `2965828569`

### [OPEN] F3. Evaluator schema hydration can erase hydrated outputs during merge

- Severity: `P2`
- Confidence: `high`
- Status: `open`
- Category: `Correctness`
- Summary: Hydrated `schemas.outputs` can be overwritten by sparse stored `schemas` during normalization.
- Evidence:
  - `api/oss/src/core/evaluators/service.py:957-987`
- Files:
  - `api/oss/src/core/evaluators/service.py`
- Cause: The merge overlays existing stored data after hydration rather than preserving repaired fields.
- Explanation: A stored `schemas` payload like `{}` or `{parameters: ...}` can wipe the hydrated outputs schema.
- Impact: Builtin evaluators can remain schema-incomplete and downstream consumers can observe inconsistent behavior.
- Suggested Fix: Merge existing data first, then overlay repaired fields, or deep-merge `schemas` so `parameters` survive while `outputs` is guaranteed.
- Alternatives: Normalize `schemas` in a dedicated repair helper before the final merge.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2965828550`, `2971482846`

### [OPEN] F4. Application flags no longer enforce `is_evaluator=False`

- Severity: `P2`
- Confidence: `high`
- Status: `needs-user-decision`
- Category: `Correctness`, `Consistency`
- Summary: `ApplicationFlags` and `ApplicationQueryFlags` still claim the application invariant but no longer enforce it.
- Evidence:
  - `api/oss/src/core/applications/dtos.py:84-99`
- Files:
  - `api/oss/src/core/applications/dtos.py`
- Cause: Constructor normalization only forces `is_application=True`.
- Explanation: Callers can construct contradictory DTOs with both `is_application=True` and `is_evaluator=True`.
- Impact: Application-scoped queries become ambiguous and downstream filtering is harder to reason about.
- Suggested Fix: Decide whether the DTO should enforce the invariant or whether the flags are intentionally user-owned booleans that merely default to `False`.
- Alternatives: Fail fast on contradictory inputs instead of silently normalizing, or explicitly document that defaults already provide the intended behavior.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2962186164`, `2962294547`, `2964690962`, `2964690972`

### [CLOSED] F5. Workflow catalog metadata overrides still mishandle explicit `False` and sparse flags

- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`, `Robustness`
- Summary: Catalog enrichment still uses `or` for boolean overrides and direct indexing for inherited flags.
- Evidence:
  - `api/oss/src/resources/workflows/catalog.py:29-37`
  - `api/oss/src/resources/workflows/catalog.py:54-60`
  - `api/oss/tests/pytest/unit/workflows/test_catalog_registry.py`
- Files:
  - `api/oss/src/resources/workflows/catalog.py`
- Cause: Boolean override logic treats `False` as absent, and inherited flags are assumed complete.
- Explanation: The catalog code now uses safe inherited-flag defaults and `is not None` override semantics, so explicit `False` overrides and sparse flag payloads no longer misbehave.
- Impact: Catalog rows can report the wrong archival/recommended state and sparse data can fail unexpectedly.
- Suggested Fix: Use `.get(..., False)` for inherited flags and `is not None` semantics for metadata overrides.
- Alternatives: Normalize flags through a dedicated typed helper before enrichment.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2962294573`, `2964690925`, `2964690953`, `2969327983`, `2969327989`, `2983188509`, `2984134965`, `2991025226`, `3016391904`

### [OPEN] F6. Invocation query path filters invocation traces as evaluators

- Severity: `P2`
- Confidence: `high`
- Status: `needs-user-decision`
- Category: `Correctness`
- Summary: `InvocationsService.query()` seeds `is_evaluator=True`, which can filter out the invocation traces it is supposed to return.
- Evidence:
  - `api/oss/src/core/invocations/service.py:435`
  - `api/oss/src/core/invocations/service.py:706-715`
- Files:
  - `api/oss/src/core/invocations/service.py`
- Cause: Query flags are initialized with evaluator semantics rather than invocation semantics.
- Explanation: Invocation traces created by `_create_invocation()` do not set `is_evaluator=True`.
- Impact: If the compatibility invocation router is remounted, query behavior will be wrong.
- Suggested Fix: Confirm whether invocation and annotation filtering should be link-based instead of reusing evaluator/application/snippet flags, then update the query path accordingly.
- Alternatives: Split invocation-specific filtering into a dedicated query DTO and mapper.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2949000394`, `2960190986`, `2962186211`, `2962294499`, `2965208073`

### [OPEN] F7. Runnable docs still contain stale discovery-contract language

- Severity: `P2`
- Confidence: `high`
- Status: `in-progress`
- Category: `Consistency`, `Maintainability`
- Summary: Several runnable design docs still describe per-route `openapi.json` or paired OpenAPI discovery even though the target contract uses persisted revision truth first and `/inspect` as the runtime fallback.
- Evidence:
  - `docs/designs/runnables/plan.md:86-95`
  - `docs/designs/runnables/runnables-system-layer.md:104-130`
  - `docs/designs/runnables/runnables-function-layer.md:100-111`
- Files:
  - `docs/designs/runnables/plan.md`
  - `docs/designs/runnables/runnables-system-layer.md`
  - `docs/designs/runnables/runnables-function-layer.md`
- Cause: Older design material still described an OpenAPI-based transition shape.
- Explanation: The primary plan and several companion docs are now aligned on persisted revision truth plus `/inspect` fallback, but additional docs may still need cleanup.
- Impact: Reviewers and implementers cannot trust the docs as a single source of truth.
- Suggested Fix: Keep aligning remaining design docs to one contract: persisted revision truth first, `/inspect` only when there is no local revision truth yet or live discovery is explicitly needed.
- Alternatives: None if the branch is committed to `/inspect` as the only runtime discovery route.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2948797791`, `2948797838`, `2949000437`, `2952354703`, `2952354726`, `2954804833`, `2954804871`, `2956985931`, `2962186277`, `2962294682`, `2962294716`, `2964630533`, `2964630562`, `2964630579`

### [CLOSED] F8. `llm_apps_service` logs credentials in a curl command

- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Security`
- Summary: The service logs a curl command containing the plaintext `Authorization` header.
- Evidence:
  - `api/oss/src/services/llm_apps_service.py:247-263`
- Files:
  - `api/oss/src/services/llm_apps_service.py`
- Cause: Debug logging includes the full header dict without redaction.
- Explanation: Current HEAD no longer shows an active curl log call, and the curl-format helper now redacts sensitive headers so future reuse does not reintroduce the leak.
- Impact: This is an active credential-leak surface.
- Suggested Fix: Redact or drop sensitive headers before logging and keep only non-sensitive request metadata.
- Alternatives: Gate full request logging behind an explicit secure debug mode with redaction.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR thread `2984134903`

### [OPEN] F9. Annotation edit response can diverge from persisted references and links

- Severity: `P2`
- Confidence: `high`
- Status: `blocked`
- Category: `Correctness`
- Summary: `annotations/service.py` forwards edited references and links to persistence but returns the pre-edit values in the response.
- Evidence:
  - `api/oss/src/core/annotations/service.py`
- Files:
  - `api/oss/src/core/annotations/service.py`
- Cause: The response object is built from the pre-edit fetch rather than the edited values.
- Explanation: Persisted state and returned state can diverge.
- Impact: Callers cannot trust the edit response to represent the post-edit entity.
- Suggested Fix: Wait for the contract decision, then either make references/links immutable in the edit contract or reflect the edited values in the returned DTO.
- Alternatives: Re-fetch after edit and build the response from persisted state.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2982653419`, `2982653442`, `2982653455`

### [CLOSED] F10. Simple trace edit silently drops incoming references and links

- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: `SimpleTracesService.edit()` ignores incoming `references` and `links` even though the edit DTO allows them.
- Evidence:
  - `api/oss/src/core/tracing/service.py`
  - `api/oss/tests/pytest/unit/tracing/test_simple_traces_service.py`
- Files:
  - `api/oss/src/core/tracing/service.py`
- Cause: The edit path always reuses `existing.references` and `existing.links`.
- Explanation: The edit path now applies the incoming references and links instead of always reusing the pre-edit values.
- Impact: Callers can lose edits silently.
- Suggested Fix: Either implement reference/link updates or remove them from the edit DTO.
- Alternatives: Validate and reject edits that attempt to set immutable fields.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2982653283`, `2982653312`, `2983188576`

### [OPEN] F11. Trace query rewriting relies on `conditions[0]`

- Severity: `P2`
- Confidence: `high`
- Status: `open`
- Category: `Correctness`, `Robustness`
- Summary: `tracing/service.py` rewrites `conditions[0]` assuming a stable internal ordering from `build_simple_trace_query()`.
- Evidence:
  - `api/oss/src/core/tracing/service.py:445`
  - `api/oss/src/core/tracing/service.py:1155-1163`
- Files:
  - `api/oss/src/core/tracing/service.py`
- Cause: Positional mutation is used where a stable semantic hook is needed.
- Explanation: The current implementation replaces `conditions[0]` after `build_simple_trace_query()` returns, both in the trace-id extraction path and in the query path, so any future builder reordering can target the wrong condition or fail outright.
- Impact: Wrong filtering or runtime failure on future internal refactors.
- Suggested Fix: Extend the builder to accept `trace_types` explicitly or locate the condition by stable field key.
- Alternatives: Replace post-build mutation with typed query composition.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR thread `2982653363`

### [CLOSED] F12. Trace edit quota check uses create semantics

- Severity: `P2`
- Confidence: `high`
- Status: `wontfix`
- Category: `Correctness`, `API semantics`
- Summary: `tracing/router.py` charges edit operations with `delta=1` rather than edit semantics.
- Evidence:
  - `api/oss/src/apis/fastapi/tracing/router.py`
- Files:
  - `api/oss/src/apis/fastapi/tracing/router.py`
- Cause: The entitlement check was copied from create behavior.
- Explanation: The product decision is that edit is still an ingestion or mutation operation, so both create and edit count toward quota.
- Impact: This is intentional quota behavior, not a contract bug.
- Suggested Fix: None; keep quota accounting on both create and edit.
- Alternatives: Introduce a separate edit quota policy later if product semantics change.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR thread `2982653342`

### [CLOSED] F13. `applications/router.py` wraps one handler with `@intercept_exceptions()` twice

- Severity: `P3`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`, `Maintainability`
- Summary: `list_application_catalog_types` is double-decorated with `@intercept_exceptions()`.
- Evidence:
  - `api/oss/src/apis/fastapi/applications/router.py`
- Files:
  - `api/oss/src/apis/fastapi/applications/router.py`
- Cause: Duplicate decorator application.
- Explanation: Double-wrapping can duplicate logging and alter exception interception order.
- Impact: Unnecessary complexity and potentially noisy error handling.
- Suggested Fix: Remove the duplicate decorator.
- Alternatives: None needed; this is a straightforward cleanup.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2983188596`, `2991025251`

### [OPEN] F14. Evaluator schema keys were renamed/removed without a confirmed consumer migration

- Severity: `P2`
- Confidence: `medium`
- Status: `open`
- Category: `Compatibility`
- Summary: `ground_truth_key` was removed and `advanced` was renamed to `x-ag-ui-advanced`, with known frontend usage of the old keys.
- Evidence:
  - `api/oss/src/resources/evaluators/evaluators.py`
  - `web/packages/agenta-entities/src/workflow/state/evaluatorUtils.ts:457`
  - `web/packages/agenta-entities/src/workflow/state/molecule.ts:579`
- Files:
  - `api/oss/src/resources/evaluators/evaluators.py`
- Cause: Producer-side contract changes were made without an explicit transition window in the review record.
- Explanation: Frontend and other consumers may still read the old keys.
- Impact: Silent UI regressions are possible if consumers were not updated in this PR.
- Suggested Fix: Audit and update active consumers, especially the frontend code that still reads `advanced`; do not add backward-compat emission if the contract break is intentional.
- Alternatives: Explicitly document the breaking change and gate rollout on consumer migration.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2983188635`, `2984134999`

### [OPEN] F15. Git DAO applies `application_refs` filtering after DB fetch

- Severity: `P2`
- Confidence: `high`
- Status: `open`
- Category: `Performance`, `Correctness`
- Summary: `application_refs` filtering is done in Python after fetching revisions, defeating pagination and risking runtime errors on non-dict values.
- Evidence:
  - `api/oss/src/dbs/postgres/git/dao.py:1162-1218`
- Files:
  - `api/oss/src/dbs/postgres/git/dao.py`
- Cause: The JSON-derived filter is not pushed into SQL and lacks a type guard before `.get()`.
- Explanation: `query_revisions()` pages the DB result first, then loops through the returned revisions in Python and calls `.get()` on `ref_data["application"]` without first proving that value is a dict, so pagination semantics and malformed-value safety both depend on post-fetch behavior.
- Impact: Pagination semantics and performance degrade, and malformed stored values can raise at runtime.
- Suggested Fix: Push the filter into SQL/JSONB queries and add `isinstance(app_ref, dict)` guards.
- Alternatives: Apply filtering before paging only if the full dataset is guaranteed small, which is not the intended contract here.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2983188658`, `2984134983`, `2991025273`

### [CLOSED] F16. `urlparse` no longer handles scheme-less localhost inputs correctly

- Severity: `P3`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`, `Robustness`
- Summary: `urlparse('localhost:8000')` now yields `hostname=None`, so the localhost-rewrite path is skipped.
- Evidence:
  - `api/oss/src/utils/helpers.py`
  - `api/oss/tests/pytest/unit/test_helpers.py`
- Files:
  - `api/oss/src/utils/helpers.py`
- Cause: The new implementation assumes `urlparse()` will always expose a hostname for local inputs.
- Explanation: The helper now prepends `http://` when no scheme is present before applying localhost rewrite logic.
- Impact: Localhost normalization becomes inconsistent.
- Suggested Fix: Prepend a default scheme when missing or add a hostname fallback path.
- Alternatives: Use a dedicated URL-normalization helper for local development inputs.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR thread `2984134945`

### [CLOSED] F17. Runtime locks depend on a private cache helper

- Severity: `P3`
- Confidence: `high`
- Status: `fixed`
- Category: `Maintainability`
- Summary: `evaluations/runtime/locks.py` uses private `caching._pack` for lock-key generation.
- Evidence:
  - `api/oss/src/core/evaluations/runtime/locks.py`
  - `api/oss/src/utils/caching.py`
  - `api/oss/tests/pytest/unit/test_evaluation_runtime_locks.py`
- Files:
  - `api/oss/src/core/evaluations/runtime/locks.py`
- Cause: The lock implementation depends on an underscore-prefixed internal helper.
- Explanation: The lock code now uses a public cache-packing helper instead of binding directly to the private underscore-prefixed implementation.
- Impact: Hidden coupling and fragile maintenance boundary.
- Suggested Fix: Expose a public pack helper or move the packing logic into the locks module.
- Alternatives: Inline a stable lock-key serializer next to the lock code.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR thread `2991025290`

## Closed Or Accepted Findings

### [CLOSED] F2. Environment revision commit validation

- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Summary: Empty-payload and missing-slug commit validation issues were fixed in-branch and covered by tests.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2964690992`, `2965903693`, `2966111988`, `2966112048`, `2971482852`, `2982653472`, `2982653494`, `2982653521`

### [CLOSED] C1. `script` shape compatibility

- Severity: `P2`
- Confidence: `medium`
- Status: `wontfix`
- Summary: The `script` shape change is treated as an intentional compatibility break under the co-versioned setup.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2948797838`, `2952354703`

### [CLOSED] F18. Trace type inference from links

- Severity: `N/A`
- Confidence: `high`
- Status: `wontfix`
- Summary: Link presence is treated as the definitional property of an annotation trace, so the reported issue is by-design.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2982653209`, `2982653258`

## Non-Promoted Remote Notes

- `.pre-commit-config.yaml` reproducibility concerns remain low-priority and already tracked in the local review thread disposition; the Mar 31 thread `3016391939` does not change the finding set.
- PR scope/title comments remain process-only; the Mar 31 thread `3016391966` reinforces existing scope feedback but is not a code defect.

## Open Questions

- Should the pre-commit reproducibility concern be promoted from thread-disposition-only tracking into a top-level `P3` finding, or remain an open-low note?
- For F3, which schema fields are always inferred versus user-owned, and where should the service stop repairing versus preserving stored values?
- For F4, should application DTOs enforce `is_evaluator=False`, or is the default-false behavior sufficient for the intended contract?
- For F6, should invocation and annotation queries filter on link presence rather than evaluator/application/snippet flags?
