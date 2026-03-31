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

## Active Findings

### F1. Migration framing no longer matches the branch's actual mixed expand/contract behavior

- Severity: `P1`
- Confidence: `high`
- Status: `open`
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
- Explanation: Legacy route families are already gone or contracted, but the docs still frame the checkpoint as non-breaking.
- Impact: Review, migration, and compatibility work can be mis-scoped or missed entirely.
- Suggested Fix: Reframe checkpoint 1 as mixed expand/contract and explicitly track intentional breaks as migration work.
- Alternatives: Restore legacy compatibility shims temporarily, but only if that matches the actual rollout plan.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2954804958`, `2954805038`, `2956986020`, `2956986030`, `2960191383`, `2962186091`, `2964630612`, `2964630626`, `2965828569`

### F3. Evaluator schema hydration can erase hydrated outputs during merge

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

### F4. Application flags no longer enforce `is_evaluator=False`

- Severity: `P2`
- Confidence: `high`
- Status: `open`
- Category: `Correctness`, `Consistency`
- Summary: `ApplicationFlags` and `ApplicationQueryFlags` still claim the application invariant but no longer enforce it.
- Evidence:
  - `api/oss/src/core/applications/dtos.py:84-99`
- Files:
  - `api/oss/src/core/applications/dtos.py`
- Cause: Constructor normalization only forces `is_application=True`.
- Explanation: Callers can construct contradictory DTOs with both `is_application=True` and `is_evaluator=True`.
- Impact: Application-scoped queries become ambiguous and downstream filtering is harder to reason about.
- Suggested Fix: Force `is_evaluator=False` in both constructors.
- Alternatives: Fail fast on contradictory inputs instead of silently normalizing.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2962186164`, `2962294547`, `2964690962`, `2964690972`

### F5. Workflow catalog metadata overrides still mishandle explicit `False` and sparse flags

- Severity: `P2`
- Confidence: `high`
- Status: `open`
- Category: `Correctness`, `Robustness`
- Summary: Catalog enrichment still uses `or` for boolean overrides and direct indexing for inherited flags.
- Evidence:
  - `api/oss/src/resources/workflows/catalog.py:29-37`
  - `api/oss/src/resources/workflows/catalog.py:54-58`
- Files:
  - `api/oss/src/resources/workflows/catalog.py`
- Cause: Boolean override logic treats `False` as absent, and inherited flags are assumed complete.
- Explanation: `metadata.archived=False` or `recommended=False` cannot override a truthy base flag, and partial flag dictionaries can raise `KeyError`.
- Impact: Catalog rows can report the wrong archival/recommended state and sparse data can fail unexpectedly.
- Suggested Fix: Use `.get(..., False)` for inherited flags and `is not None` semantics for metadata overrides.
- Alternatives: Normalize flags through a dedicated typed helper before enrichment.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2962294573`, `2964690925`, `2964690953`, `2969327983`, `2969327989`, `2983188509`, `2984134965`, `2991025226`, `3016391904`

### F6. Invocation query path filters invocation traces as evaluators

- Severity: `P2`
- Confidence: `high`
- Status: `open`
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
- Suggested Fix: Remove the forced evaluator flag and add direct unit coverage for invocation filtering.
- Alternatives: Split invocation-specific filtering into a dedicated query DTO and mapper.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2949000394`, `2960190986`, `2962186211`, `2962294499`, `2965208073`

### F7. Runnable docs and helper code still disagree on discovery contract

- Severity: `P2`
- Confidence: `high`
- Status: `open`
- Category: `Consistency`, `Maintainability`
- Summary: The runnable docs disagree on whether per-route `openapi.json` still exists, and the SDK helper still preserves that path.
- Evidence:
  - `docs/designs/runnables/plan.md:86-95`
  - `docs/designs/runnables/runnables-subsystem-layer.md:108-118`
  - `docs/designs/runnables/plan.G13.md:42-49`
  - `sdk/agenta/sdk/decorators/running.py:817-829`
- Files:
  - `docs/designs/runnables/plan.md`
  - `docs/designs/runnables/runnables-subsystem-layer.md`
  - `docs/designs/runnables/plan.G13.md`
  - `sdk/agenta/sdk/decorators/running.py`
  - `docs/designs/runnables/design-review.md`
- Cause: The rollout plan and helper/runtime implementation have not been converged on one discovery contract.
- Explanation: The parent plan says `/inspect` is canonical, but child docs and helper code still preserve per-route OpenAPI assumptions.
- Impact: Reviewers and implementers cannot trust the docs as a single source of truth.
- Suggested Fix: Pick one discovery contract and align the docs and helper surface to it.
- Alternatives: Keep both surfaces for one transition window, but document that explicitly.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2948797791`, `2948797838`, `2949000437`, `2952354703`, `2952354726`, `2954804833`, `2954804871`, `2956985931`, `2962186277`, `2962294682`, `2962294716`, `2964630533`, `2964630562`, `2964630579`

### F8. `llm_apps_service` logs credentials in a curl command

- Severity: `P1`
- Confidence: `high`
- Status: `open`
- Category: `Security`
- Summary: The service logs a curl command containing the plaintext `Authorization` header.
- Evidence:
  - `api/oss/src/services/llm_apps_service.py`
- Files:
  - `api/oss/src/services/llm_apps_service.py`
- Cause: Debug logging includes the full header dict without redaction.
- Explanation: Any log sink or audit trail will capture the secret verbatim.
- Impact: This is an active credential-leak surface.
- Suggested Fix: Redact or drop sensitive headers before logging and keep only non-sensitive request metadata.
- Alternatives: Gate full request logging behind an explicit secure debug mode with redaction.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR thread `2984134903`

### F9. Annotation edit response can diverge from persisted references and links

- Severity: `P2`
- Confidence: `high`
- Status: `open`
- Category: `Correctness`
- Summary: `annotations/service.py` forwards edited references and links to persistence but returns the pre-edit values in the response.
- Evidence:
  - `api/oss/src/core/annotations/service.py`
- Files:
  - `api/oss/src/core/annotations/service.py`
- Cause: The response object is built from the pre-edit fetch rather than the edited values.
- Explanation: Persisted state and returned state can diverge.
- Impact: Callers cannot trust the edit response to represent the post-edit entity.
- Suggested Fix: Either make references/links immutable in the edit contract or reflect the edited values in the returned DTO.
- Alternatives: Re-fetch after edit and build the response from persisted state.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2982653419`, `2982653442`, `2982653455`

### F10. Simple trace edit silently drops incoming references and links

- Severity: `P2`
- Confidence: `high`
- Status: `open`
- Category: `Correctness`
- Summary: `SimpleTracesService.edit()` ignores incoming `references` and `links` even though the edit DTO allows them.
- Evidence:
  - `api/oss/src/core/tracing/service.py`
- Files:
  - `api/oss/src/core/tracing/service.py`
- Cause: The edit path always reuses `existing.references` and `existing.links`.
- Explanation: The API contract implies mutability that is not implemented.
- Impact: Callers can lose edits silently.
- Suggested Fix: Either implement reference/link updates or remove them from the edit DTO.
- Alternatives: Validate and reject edits that attempt to set immutable fields.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2982653283`, `2982653312`, `2983188576`

### F11. Trace query rewriting relies on `conditions[0]`

- Severity: `P2`
- Confidence: `high`
- Status: `open`
- Category: `Correctness`, `Robustness`
- Summary: `tracing/service.py` rewrites `conditions[0]` assuming a stable internal ordering from `build_simple_trace_query()`.
- Evidence:
  - `api/oss/src/core/tracing/service.py`
- Files:
  - `api/oss/src/core/tracing/service.py`
- Cause: Positional mutation is used where a stable semantic hook is needed.
- Explanation: Reordering in the query builder can turn this into an `IndexError` or wrong filter.
- Impact: Wrong filtering or runtime failure on future internal refactors.
- Suggested Fix: Extend the builder to accept `trace_types` explicitly or locate the condition by stable field key.
- Alternatives: Replace post-build mutation with typed query composition.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR thread `2982653363`

### F12. Trace edit quota check uses create semantics

- Severity: `P2`
- Confidence: `high`
- Status: `open`
- Category: `Correctness`, `API semantics`
- Summary: `tracing/router.py` charges edit operations with `delta=1` rather than edit semantics.
- Evidence:
  - `api/oss/src/apis/fastapi/tracing/router.py`
- Files:
  - `api/oss/src/apis/fastapi/tracing/router.py`
- Cause: The entitlement check was copied from create behavior.
- Explanation: Editing an existing trace should not consume quota like creating a new one.
- Impact: Existing-trace edits can hit quota ceilings incorrectly.
- Suggested Fix: Use `delta=0` or skip quota enforcement for edit operations.
- Alternatives: Add a separate edit quota policy if edits should be controlled independently.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR thread `2982653342`

### F13. `applications/router.py` wraps one handler with `@intercept_exceptions()` twice

- Severity: `P3`
- Confidence: `high`
- Status: `open`
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

### F14. Evaluator schema keys were renamed/removed without a confirmed consumer migration

- Severity: `P2`
- Confidence: `medium`
- Status: `open`
- Category: `Compatibility`
- Summary: `ground_truth_key` was removed and `advanced` was renamed to `x-ag-ui-advanced`, with known frontend usage of the old keys.
- Evidence:
  - `api/oss/src/resources/evaluators/evaluators.py`
- Files:
  - `api/oss/src/resources/evaluators/evaluators.py`
- Cause: Producer-side contract changes were made without an explicit transition window in the review record.
- Explanation: Frontend and other consumers may still read the old keys.
- Impact: Silent UI regressions are possible if consumers were not updated in this PR.
- Suggested Fix: Emit both old and new keys during a transition window, or prove all consumers were updated together.
- Alternatives: Explicitly document the breaking change and gate rollout on consumer migration.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2983188635`, `2984134999`

### F15. Git DAO applies `application_refs` filtering after DB fetch

- Severity: `P2`
- Confidence: `high`
- Status: `open`
- Category: `Performance`, `Correctness`
- Summary: `application_refs` filtering is done in Python after fetching revisions, defeating pagination and risking runtime errors on non-dict values.
- Evidence:
  - `api/oss/src/dbs/postgres/git/dao.py`
- Files:
  - `api/oss/src/dbs/postgres/git/dao.py`
- Cause: The JSON-derived filter is not pushed into SQL and lacks a type guard before `.get()`.
- Explanation: DB-level windowing happens before the Python-level filter, so results and memory usage are both wrong.
- Impact: Pagination semantics and performance degrade, and malformed stored values can raise at runtime.
- Suggested Fix: Push the filter into SQL/JSONB queries and add `isinstance(app_ref, dict)` guards.
- Alternatives: Apply filtering before paging only if the full dataset is guaranteed small, which is not the intended contract here.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2983188658`, `2984134983`, `2991025273`

### F16. `urlparse` no longer handles scheme-less localhost inputs correctly

- Severity: `P3`
- Confidence: `high`
- Status: `open`
- Category: `Correctness`, `Robustness`
- Summary: `urlparse('localhost:8000')` now yields `hostname=None`, so the localhost-rewrite path is skipped.
- Evidence:
  - `api/oss/src/utils/helpers.py`
- Files:
  - `api/oss/src/utils/helpers.py`
- Cause: The new implementation assumes `urlparse()` will always expose a hostname for local inputs.
- Explanation: Scheme-less local addresses are parsed as schemes.
- Impact: Localhost normalization becomes inconsistent.
- Suggested Fix: Prepend a default scheme when missing or add a hostname fallback path.
- Alternatives: Use a dedicated URL-normalization helper for local development inputs.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR thread `2984134945`

### F17. Runtime locks depend on a private cache helper

- Severity: `P3`
- Confidence: `high`
- Status: `open`
- Category: `Maintainability`
- Summary: `evaluations/runtime/locks.py` uses private `caching._pack` for lock-key generation.
- Evidence:
  - `api/oss/src/core/evaluations/runtime/locks.py`
- Files:
  - `api/oss/src/core/evaluations/runtime/locks.py`
- Cause: The lock implementation depends on an underscore-prefixed internal helper.
- Explanation: Internal cache helper changes can silently break lock-key generation.
- Impact: Hidden coupling and fragile maintenance boundary.
- Suggested Fix: Expose a public pack helper or move the packing logic into the locks module.
- Alternatives: Inline a stable lock-key serializer next to the lock code.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR thread `2991025290`

## Closed Or Accepted Findings

### F2. Environment revision commit validation

- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Summary: Empty-payload and missing-slug commit validation issues were fixed in-branch and covered by tests.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2964690992`, `2965903693`, `2966111988`, `2966112048`, `2971482852`, `2982653472`, `2982653494`, `2982653521`

### C1. `script` shape compatibility

- Severity: `P2`
- Confidence: `medium`
- Status: `wontfix`
- Summary: The `script` shape change is treated as an intentional compatibility break under the co-versioned setup.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2948797838`, `2952354703`

### F18. Trace type inference from links

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
- For F14, do we want an explicit consumer-audit step before deciding whether the compatibility concern is real or already covered elsewhere in the PR?
